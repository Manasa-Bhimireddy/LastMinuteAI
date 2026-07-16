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

# In-memory document session cache
DOCUMENTS_STORE = {}

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
    if filename.endswith(".pdf"):
        text = extract_pdf_text(filepath)
        if not text or not text.strip():
            text = extract_pdf_text_pdfplumber(filepath)
    elif filename.endswith(".docx"):
        text = extract_docx_text(filepath)
    elif filename.endswith(".txt"):
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                text = f.read()
        except Exception as e:
            print(f"Error reading txt: {e}")
    else:
        os.remove(filepath)
        return jsonify({"error": "Unsupported file format. Use PDF, DOCX, or TXT."}), 400
        
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
        
        return jsonify({
            "success": True,
            "document_id": doc_id,
            "filename": filename,
            "chunk_count": len(chunks)
        })
    except Exception as e:
        print(f"Indexing error: {e}")
        return jsonify({"error": f"Failed to index document: {str(e)}"}), 500

@app.route("/api/query", methods=["POST"])
def query():
    data = request.json or {}
    doc_id = data.get("document_id", "").strip()
    question = data.get("question", "").strip()
    
    if not doc_id or not question:
        return jsonify({"error": "Document ID and question are required"}), 400
        
    if doc_id not in DOCUMENTS_STORE:
        return jsonify({"error": "Document not found or expired"}), 404
        
    doc_data = DOCUMENTS_STORE[doc_id]
    index_dir = doc_data["index_dir"]
    
    try:
        embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
        db = FAISS.load_local(index_dir, embeddings, allow_dangerous_deserialization=True)
        
        # similarity search
        docs = db.similarity_search(question, k=4)
        
        # generate answer using rag_chat utility helper
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
