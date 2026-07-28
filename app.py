import os
import re
import json
import uuid
from flask import Flask, request, jsonify, render_template, session
from flask_cors import CORS
from dotenv import load_dotenv
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import google.generativeai as genai
from groq import Groq
from skills_db import skills_list

# Imports from modular utilities shown in screenshots
from utils.pdf_reader import extract_text as extract_pdf_text_pypdf
from utils.docx_reader import extract_docx_text
from utils.vector_store import create_vector_store
from utils.rag_chat import answer_question
from utils.quiz_generator import generate_quiz as utils_generate_quiz
from utils.flashcard_generator import generate_flashcards as utils_generate_flashcards
from utils.summary_generator import generate_summary as utils_generate_summary
from utils.study_plan import create_study_plan as utils_create_study_plan

# LangChain/FAISS imports needed locally in app.py for loading indices
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "edusphere-secret-key-1324!#*&")
CORS(app)

# Configuration
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

import sqlite3

# Initialize SQLite database
def init_db():
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            filename TEXT,
            index_dir TEXT,
            chunk_count INTEGER,
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS study_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target TEXT,
            duration TEXT,
            hours TEXT,
            level TEXT,
            plan_text TEXT,
            progress INTEGER DEFAULT 0,
            pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

# Initial database load
def load_db_to_memory():
    try:
        init_db()
        conn = sqlite3.connect("database.db")
        cursor = conn.cursor()
        cursor.execute("SELECT id, filename, index_dir, chunk_count FROM documents")
        for row in cursor.fetchall():
            DOCUMENTS_STORE[row[0]] = {
                "filename": row[1],
                "index_dir": row[2],
                "chunk_count": row[3]
            }
        conn.close()
    except Exception as e:
        print(f"Database load error: {e}")

# In-memory stores
# Format: { doc_id: { "filename": str, "index_dir": str, "chunk_count": int } }
DOCUMENTS_STORE = {}
load_db_to_memory()

# Fallback Helper: Extract text from PDF using pdfplumber if pypdf is empty
def extract_pdf_text_pdfplumber(path):
    import pdfplumber
    text = ""
    try:
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        return text.lower()
    except Exception as e:
        print(f"pdfplumber extraction error: {e}")
        return ""

# Helper: Match skills from a text body
def extract_skills(text):
    found_skills = []
    text_lower = text.lower()
    for skill in skills_list:
        skill_escaped = re.escape(skill)
        if "+" in skill or "#" in skill or "." in skill:
            pattern = rf"\b{skill_escaped}"
        else:
            pattern = rf"\b{skill_escaped}\b"
        
        if re.search(pattern, text_lower):
            found_skills.append(skill)
    return sorted(list(set(found_skills)))

# Helper: Identify configured API credentials and return client
def get_llm_provider():
    groq_key = request.headers.get("X-Groq-API-Key") or session.get("GROQ_API_KEY") or os.environ.get("GROQ_API_KEY")
    if groq_key:
        return "groq", groq_key
        
    gemini_key = request.headers.get("X-Gemini-API-Key") or session.get("GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        return "gemini", gemini_key
        
    return None, None

def call_llm(prompt, system_instruction=None, history=None):
    provider, key = get_llm_provider()
    if not provider:
        raise ValueError("No LLM API Key configured. Please add one in Settings.")
        
    if provider == "groq":
        try:
            client = Groq(api_key=key)
            messages = []
            if system_instruction:
                messages.append({"role": "system", "content": system_instruction})
            if history:
                for h in history:
                    role = "user" if h.get("role") == "user" else "assistant"
                    messages.append({"role": role, "content": h.get("text", "")})
            messages.append({"role": "user", "content": prompt})
            
            chat_completion = client.chat.completions.create(
                messages=messages,
                model="llama-3.3-70b-versatile",
                temperature=0.7
            )
            return chat_completion.choices[0].message.content
        except Exception as e:
            try:
                chat_completion = client.chat.completions.create(
                    messages=messages,
                    model="llama-3.1-8b-instant",
                    temperature=0.7
                )
                return chat_completion.choices[0].message.content
            except Exception as e2:
                raise RuntimeError(f"Groq API Error: {str(e2)}")
                
    elif provider == "gemini":
        try:
            genai.configure(api_key=key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            
            if history:
                formatted_history = []
                for h in history:
                    role = "user" if h.get("role") == "user" else "model"
                    formatted_history.append({"role": role, "parts": [h.get("text", "")]})
                chat_session = model.start_chat(history=formatted_history)
                prefix = f"System Instruction: {system_instruction}. " if system_instruction else ""
                response = chat_session.send_message(prefix + prompt)
                return response.text
            else:
                full_prompt = f"System Instruction: {system_instruction}\n\n{prompt}" if system_instruction else prompt
                response = model.generate_content(full_prompt)
                return response.text
        except Exception as e:
            raise RuntimeError(f"Gemini API Error: {str(e)}")

# Routes

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/check-key', methods=['GET'])
def check_key():
    provider, _ = get_llm_provider()
    return jsonify({
        "configured": provider is not None,
        "provider": provider or "none"
    })

@app.route('/api/save-key', methods=['POST'])
def save_key():
    data = request.json or {}
    api_key = data.get("api_key", "").strip()
    provider = data.get("provider", "groq").strip()
    
    if not api_key:
        return jsonify({"success": False, "error": "API key cannot be empty"}), 400
    
    key_name = "GROQ_API_KEY" if provider == "groq" else "GEMINI_API_KEY"
    session[key_name] = api_key
    os.environ[key_name] = api_key
    
    try:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
        lines = []
        key_found = False
        if os.path.exists(env_path):
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip().startswith(f"{key_name}="):
                        lines.append(f"{key_name}={api_key}\n")
                        key_found = True
                    else:
                        lines.append(line)
        if not key_found:
            lines.append(f"{key_name}={api_key}\n")
            
        with open(env_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)
            
        return jsonify({"success": True, "message": f"{provider.upper()} API key saved successfully to .env and active session!"})
    except Exception as e:
        print(f"Could not save key to .env file: {e}")
        return jsonify({"success": True, "message": f"{provider.upper()} API key active for current session."})

@app.route('/api/analyze-resume', methods=['POST'])
def analyze_resume():
    if 'resume' not in request.files:
        return jsonify({"error": "No resume file uploaded"}), 400
        
    file = request.files['resume']
    jd = request.form.get('job_description', '').strip()
    
    if file.filename == '':
        return jsonify({"error": "No resume file selected"}), 400
        
    if not jd:
        return jsonify({"error": "Job description is required"}), 400
        
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    
    # Extract text using modular pdf_reader / docx_reader
    if filename.endswith(".pdf"):
        resume_text = extract_pdf_text_pypdf(filepath)
        if not resume_text or not resume_text.strip():
            resume_text = extract_pdf_text_pdfplumber(filepath)
    elif filename.endswith(".docx"):
        resume_text = extract_docx_text(filepath)
    else:
        os.remove(filepath)
        return jsonify({"error": "Unsupported file format. Please upload PDF or DOCX."}), 400
        
    # Clean up file after reading
    try:
        os.remove(filepath)
    except Exception as e:
        print(f"Error removing temporary file: {e}")
        
    if not resume_text or not resume_text.strip():
        return jsonify({"error": "Failed to extract text from resume. Ensure it is not scanned or empty."}), 400
        
    # Skill extraction
    resume_skills = extract_skills(resume_text)
    jd_skills = extract_skills(jd)
    
    # Skill comparison
    matched_skills = list(set(resume_skills).intersection(set(jd_skills)))
    missing_skills = list(set(jd_skills) - set(resume_skills))
    
    # Calculate similarity score using CountVectorizer as shown in Screenshot 29
    ats_score = 0.0
    similarity = 0.0
    try:
        cv = CountVectorizer()
        matrix = cv.fit_transform([resume_text, jd])
        similarity = cosine_similarity(matrix)[0][1]
    except Exception as e:
        print(f"CountVectorizer similarity error: {e}")
        
    # Weighted ATS matching: 70% skill match coverage, 30% general text similarity
    if jd_skills:
        skill_match_ratio = len(matched_skills) / len(jd_skills)
        ats_score = round((0.7 * skill_match_ratio + 0.3 * similarity) * 100, 2)
    else:
        ats_score = round(similarity * 100, 2)
        
    # Safeguard minimum score if skills matched
    if matched_skills and ats_score < 10.0:
        ats_score = min(35.0, 10.0 * len(matched_skills))
        
    # Call LLM for personalized suggestions
    suggestions = ""
    try:
        prompt = f"""
        Analyze the following student resume details and job requirements to provide a structured skill gap feedback.
        
        Resume Skills Extracted: {', '.join(resume_skills) if resume_skills else 'None detected'}
        Job Requirements Skills Extracted: {', '.join(jd_skills) if jd_skills else 'None detected'}
        Missing Skills: {', '.join(missing_skills) if missing_skills else 'None identified'}
        Current ATS Match Score: {ats_score}%
        
        Provide your response in clean Markdown with the following sections:
        1. **Executive Summary**: A brief, encouraging 2-3 sentence overview of the student's compatibility.
        2. **Critical Gaps & Learning Roadmap**: Group the missing skills into logical learning areas (e.g., Programming, Cloud, Data Science) and lay out a clear progression path.
        3. **Specific Recommendations**: Suggest free/popular online course platforms (Coursera, Udemy, YouTube, etc.), textbooks, or project ideas to build these missing skills.
        4. **Resume Improvement Tips**: Direct advice on how the student can better showcase their achievements or reformat their resume (e.g. keywords, layout, action verbs) to improve their ATS score.
        """
        suggestions = call_llm(prompt, system_instruction="You are an expert ATS Analyzer and Career Coach.")
    except Exception as e:
        suggestions = f"### Study Suggestions\n*Please add a valid Groq or Gemini API Key in the Settings tab to generate personalized suggestions and roadmaps. Error: {str(e)}*"

    return jsonify({
        "ats_score": ats_score,
        "resume_skills": resume_skills,
        "job_description_skills": jd_skills,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "suggestions": suggestions
    })

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json or {}
    message = data.get("message", "").strip()
    history = data.get("history", [])
    
    if not message:
        return jsonify({"error": "Message is required"}), 400
        
    try:
        system_instruction = "You are LastMinute.AI, a helpful, encouraging, and highly intelligent academic tutor and study assistant for students. Help them understand complex concepts, solve coding problems, explain equations, and give study tips. Keep answers concise, clear, and structured using markdown."
        response_text = call_llm(message, system_instruction=system_instruction, history=history)
        return jsonify({
            "response": response_text,
            "success": True
        })
    except Exception as e:
        return jsonify({"error": f"LLM API Error: {str(e)}"}), 500

@app.route('/api/study-assistant/plan', methods=['POST'])
def generate_study_plan():
    data = request.json or {}
    target_role = data.get("target_role", "").strip()
    duration = int(data.get("duration_weeks", "4"))
    hours_per_week = int(data.get("hours_per_week", "10"))
    skill_level = data.get("skill_level", "Beginner").strip()
    current_skills = data.get("current_skills", "").strip()
    
    if not target_role:
        return jsonify({"error": "Target role or topic is required"}), 400
        
    try:
        response_text = utils_create_study_plan(target_role, duration, hours_per_week, skill_level, current_skills)
        return jsonify({"plan": response_text, "success": True})
    except Exception as e:
        return jsonify({"error": f"LLM API Error: {str(e)}"}), 500

@app.route('/api/study-assistant/quiz', methods=['POST'])
def generate_quiz_and_flashcards():
    data = request.json or {}
    topic = data.get("topic", "").strip()
    
    if not topic:
        return jsonify({"error": "Topic is required"}), 400
        
    try:
        # Call both generator utilities
        quiz_data = utils_generate_quiz(topic)
        flashcard_data = utils_generate_flashcards(topic)
        
        # Merge results into a single payload
        return jsonify({
            "mcqs": quiz_data.get("mcqs", []),
            "flashcards": flashcard_data.get("flashcards", [])
        })
    except Exception as e:
        print(f"Error generating quiz/flashcards: {e}")
        return jsonify({"error": f"Failed to generate study materials: {str(e)}"}), 500

# RAG Vision OCR helper using LLM multi-modal APIs
def extract_image_text_via_ai(filepath):
    provider, key = get_llm_provider()
    if not provider:
        return "Error: No API Key configured. Please add an API Key in settings to enable image OCR parsing."
        
    if provider == "gemini":
        try:
            import google.generativeai as genai
            genai.configure(api_key=key)
            model = genai.GenerativeModel('gemini-1.5-flash')
            
            with open(filepath, "rb") as f:
                image_data = f.read()
                
            mime = "image/jpeg" if filepath.lower().endswith((".jpg", ".jpeg")) else "image/png"
            image_parts = [
                {
                    "mime_type": mime,
                    "data": image_data
                }
            ]
            
            prompt = "Transcribe all visible text, handwriting, and equations in this image accurately. Output only the transcription, do not summarize."
            response = model.generate_content([prompt, image_parts[0]])
            return response.text
        except Exception as e:
            print(f"Gemini OCR error: {e}")
            return f"Gemini OCR Failed: {str(e)}"
            
    elif provider == "groq":
        try:
            import base64
            from groq import Groq
            client = Groq(api_key=key)
            
            with open(filepath, "rb") as f:
                image_base64 = base64.b64encode(f.read()).decode("utf-8")
                
            mime = "image/jpeg" if filepath.lower().endswith((".jpg", ".jpeg")) else "image/png"
            
            chat_completion = client.chat.completions.create(
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Transcribe all visible text, handwriting, and equations in this image accurately. Output only the transcription, do not summarize."},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime};base64,{image_base64}",
                                },
                            },
                        ],
                    }
                ],
                model="llama-3.2-11b-vision-preview",
            )
            return chat_completion.choices[0].message.content
        except Exception as e:
            print(f"Groq Vision OCR error: {e}")
            return f"Groq Vision OCR Failed: {str(e)}"
            
    return "Unsupported OCR provider. Please configure Google Gemini or Groq in Settings."

# RAG Upload endpoint using modular vector_store.py
@app.route('/api/upload-document', methods=['POST'])
def upload_document():
    if 'document' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
        
    file = request.files['document']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
        
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    
    # Extract text using modular helpers
    text = ""
    filename_lower = filename.lower()
    if filename_lower.endswith(".pdf"):
        text = extract_pdf_text_pypdf(filepath)
        if not text or not text.strip():
            text = extract_pdf_text_pdfplumber(filepath)
    elif filename_lower.endswith(".docx"):
        text = extract_docx_text(filepath)
    elif filename_lower.endswith(".txt"):
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                text = f.read()
        except Exception as e:
            print(f"Error reading txt: {e}")
    elif filename_lower.endswith((".png", ".jpg", ".jpeg")):
        text = extract_image_text_via_ai(filepath)
    else:
        os.remove(filepath)
        return jsonify({"error": "Unsupported file format. Please upload PDF, DOCX, TXT, PNG, JPG, or JPEG."}), 400
        
    # Clean up file after reading
    try:
        os.remove(filepath)
    except Exception as e:
        print(f"Error removing temporary file: {e}")
        
    if not text or not text.strip():
        return jsonify({"error": "Could not extract readable text from document"}), 400
        
    try:
        # Create vector store using standard utility (which saves to 'faiss_index' internally)
        # But we save it to a unique directory per file so we can support multiple active documents
        doc_id = str(uuid.uuid4())
        index_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"faiss_index_{doc_id}")
        
        # We can temporarily patch the vector_store save dir or write custom wrapper
        # Here we initialize the split & FAISS directly using same parameter logic
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        chunks = splitter.split_text(text)
        
        embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
        db = FAISS.from_texts(chunks, embeddings)
        db.save_local(index_dir)
        
        DOCUMENTS_STORE[doc_id] = {
            "filename": filename,
            "index_dir": index_dir,
            "chunk_count": len(chunks)
        }
        
        # Save to SQLite persistence
        try:
            conn = sqlite3.connect("database.db")
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO documents (id, filename, index_dir, chunk_count) VALUES (?, ?, ?, ?)",
                (doc_id, filename, index_dir, len(chunks))
            )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error persisting document to SQLite: {e}")
        
        return jsonify({
            "success": True,
            "document_id": doc_id,
            "filename": filename,
            "chunk_count": len(chunks)
        })
    except Exception as e:
        print(f"FAISS indexing error: {e}")
        return jsonify({"error": f"Failed to index document: {str(e)}"}), 500

# Documents list fetcher
@app.route('/api/documents', methods=['GET'])
def get_all_documents():
    docs_list = []
    for k, v in DOCUMENTS_STORE.items():
        docs_list.append({
            "id": k,
            "name": v["filename"],
            "chunks": v["chunk_count"]
        })
    return jsonify({"success": True, "documents": docs_list})

# Study Goals APIs
@app.route('/api/goals', methods=['GET'])
def get_goals():
    try:
        conn = sqlite3.connect("database.db")
        cursor = conn.cursor()
        cursor.execute("SELECT id, target, duration, hours, level, progress FROM study_plans")
        goals = []
        for row in cursor.fetchall():
            goals.append({
                "id": row[0],
                "target": row[1],
                "duration": row[2],
                "hours": row[3],
                "level": row[4],
                "progress": row[5]
            })
        conn.close()
        return jsonify({"success": True, "goals": goals})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/goals', methods=['POST'])
def save_goal():
    data = request.json or {}
    target = data.get("target", "").strip()
    duration = data.get("duration", "").strip()
    hours = data.get("hours", "10").strip()
    level = data.get("level", "Beginner").strip()
    plan_text = data.get("plan_text", "").strip()
    
    if not target:
        return jsonify({"success": False, "error": "Target is required"}), 400
        
    try:
        conn = sqlite3.connect("database.db")
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM study_plans WHERE target = ?", (target,))
        existing = cursor.fetchone()
        if existing:
            conn.close()
            return jsonify({"success": True, "message": "Goal already exists."})
            
        cursor.execute(
            "INSERT INTO study_plans (target, duration, hours, level, plan_text, progress) VALUES (?, ?, ?, ?, ?, ?)",
            (target, duration, hours, level, plan_text, 0)
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "Goal pinned successfully!"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/goals/update', methods=['POST'])
def update_goal_progress():
    data = request.json or {}
    target = data.get("target", "").strip()
    progress = data.get("progress", 0)
    
    try:
        conn = sqlite3.connect("database.db")
        cursor = conn.cursor()
        cursor.execute("UPDATE study_plans SET progress = ? WHERE target = ?", (progress, target))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# RAG Query endpoint modified for index merging
@app.route('/api/query-document', methods=['POST'])
def query_document():
    data = request.json or {}
    doc_ids = data.get("document_ids", [])
    question = data.get("question", "").strip()
    
    # Compatibility support
    if not doc_ids and data.get("document_id"):
        doc_ids = [data.get("document_id")]
        
    if not doc_ids or not question:
        return jsonify({"error": "Document selection and question are required"}), 400
        
    try:
        embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
        
        merged_db = None
        for doc_id in doc_ids:
            if doc_id in DOCUMENTS_STORE:
                index_dir = DOCUMENTS_STORE[doc_id]["index_dir"]
                db = FAISS.load_local(index_dir, embeddings, allow_dangerous_deserialization=True)
                if merged_db is None:
                    merged_db = db
                else:
                    merged_db.merge_from(db)
                    
        if merged_db is None:
            return jsonify({"error": "No valid documents loaded"}), 404
            
        docs = merged_db.similarity_search(question, k=4)
        response_text = answer_question(docs, question)
        sources = [doc.page_content for doc in docs]
        
        return jsonify({
            "answer": response_text,
            "sources": sources,
            "success": True
        })
    except Exception as e:
        print(f"RAG search error: {e}")
        return jsonify({"error": f"LLM API Error: {str(e)}"}), 500

def secure_filename(filename):
    filename = os.path.basename(filename)
    filename = re.sub(r'[^a-zA-Z0-9._-]', '_', filename)
    return filename

if __name__ == "__main__":
    app.run(debug=True, port=5000)
