import os
import re
import uuid
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

# Standalone imports from utils
from utils.pdf_reader import extract_text as extract_pdf_text
from utils.docx_reader import extract_docx_text
from utils.vector_store import create_vector_store
from utils.rag_chat import answer_question

# LangChain community FAISS and embeddings
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS

load_dotenv()

app = Flask(__name__)

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

# In-memory document session cache
DOCUMENTS_STORE = {}
load_db_to_memory()

# Fallback pdf parser
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
        print(f"pdfplumber error: {e}")
        return ""

def get_standalone_llm_provider():
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key:
        return "groq", groq_key
        
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if gemini_key:
        return "gemini", gemini_key
        
    return None, None

def extract_image_text_via_ai(filepath):
    provider, key = get_standalone_llm_provider()
    if not provider:
        return "Error: No API Key configured. Please add an API Key to your .env file to enable image OCR parsing."
        
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
            
    return "Unsupported OCR provider."

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/upload", methods=["POST"])
def upload():
    if 'document' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
        
    file = request.files['document']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400
        
    filename = file.filename
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    
    # Read content
    text = ""
    filename_lower = filename.lower()
    if filename_lower.endswith(".pdf"):
        text = extract_pdf_text(filepath)
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
        return jsonify({"error": "Unsupported file format. Use PDF, DOCX, TXT, PNG, JPG, or JPEG."}), 400
        
    # Clean up file after reading
    try:
        os.remove(filepath)
    except Exception as e:
        print(f"Error removing temporary file: {e}")
        
    if not text or not text.strip():
        return jsonify({"error": "Could not extract readable text from document"}), 400
        
    try:
        # Create vector store
        # Here we save a local FAISS index inside uploads/faiss_index_{doc_id}
        doc_id = str(uuid.uuid4())
        index_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"faiss_index_{doc_id}")
        
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
        
        # Save to SQLite database
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
            print(f"Error persisting to SQLite: {e}")
        
        return jsonify({
            "success": True,
            "document_id": doc_id,
            "filename": filename,
            "chunk_count": len(chunks)
        })
    except Exception as e:
        print(f"Indexing error: {e}")
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

@app.route("/api/query", methods=["POST"])
def query():
    data = request.json or {}
    doc_ids = data.get("document_ids", [])
    question = data.get("question", "").strip()
    
    # Compatibility support
    if not doc_ids and data.get("document_id"):
        doc_ids = [data.get("document_id")]
        
    if not doc_ids or not question:
        return jsonify({"error": "Document ID and question are required"}), 400
        
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
            return jsonify({"error": "No active documents found or loaded"}), 404
            
        docs = merged_db.similarity_search(question, k=4)
        answer = answer_question(docs, question)
        
        return jsonify({
            "success": True,
            "answer": answer,
            "sources": [doc.page_content for doc in docs]
        })
    except Exception as e:
        print(f"Search error: {e}")
        return jsonify({"error": f"Search execution failed: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5004)
