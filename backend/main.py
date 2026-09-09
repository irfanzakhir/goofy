import os
import io
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import pymupdf  # PyMuPDF for PDFs
from pptx import Presentation # python-pptx for presentations
from langchain_text_splitters import RecursiveCharacterTextSplitter
from supabase import create_client, Client
from google import genai
from google.genai import types
from pydantic import BaseModel
from typing import Optional
import docx

class ChatRequest(BaseModel):
    user_email: str
    message: str
    chat_id: Optional[str] = None  # None if it's a brand new chat

# Load environment variables
load_dotenv()

app = FastAPI()

# Allow the React/Vite frontend to communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Supabase and Gemini Clients
supabase: Client = create_client(
    os.getenv("SUPABASE_URL"), 
    os.getenv("SUPABASE_SERVICE_KEY")
)
gemini_client = genai.Client()

def extract_text_from_pdf(file_bytes: bytes) -> str:
    doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    return "\n".join([page.get_text() for page in doc])

def extract_text_from_pptx(file_bytes: bytes) -> str:
    prs = Presentation(io.BytesIO(file_bytes))
    text = ""
    for slide in prs.slides:
        for shape in slide.shapes:
            if hasattr(shape, "text"):
                text += shape.text + "\n"
    return text

def extract_text_from_docx(file_bytes: bytes) -> str:
    doc = docx.Document(io.BytesIO(file_bytes))
    return "\n".join([paragraph.text for paragraph in doc.paragraphs])

@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.endswith(('.pdf', '.pptx')):
        raise HTTPException(status_code=400, detail="Only PDF and PPTX supported.")
    
    file_bytes = await file.read()
    
    # 1. Extract Text
    if file.filename.lower().endswith('.pdf'):
        raw_text = extract_text_from_pdf(file_bytes)
    elif file.filename.lower().endswith('.pptx'):
        raw_text = extract_text_from_pptx(file_bytes)
    elif file.filename.lower().endswith(('.doc', '.docx')):
        raw_text = extract_text_from_docx(file_bytes)
    else:
        raise HTTPException(status_code=400, detail="Unsupported file format")
        
    # 2. Chunk the Text
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200
    )
    chunks = text_splitter.split_text(raw_text)
    
    # 3. Embed and Store
    records = []
    for chunk in chunks:
        result = gemini_client.models.embed_content(
            model="gemini-embedding-001",
            contents=chunk,
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
        
        records.append({
            "filename": file.filename,
            "content": chunk,
            "embedding": result.embeddings[0].values
        })
        
    # Push records to Supabase 'documents' table
    if records:
         supabase.table("documents").insert(records).execute()
         
    return {"message": f"Successfully processed {len(chunks)} chunks from {file.filename}"}

@app.post("/chat")
async def chat_with_assistant(request: ChatRequest):
    # 1. Handle Chat Session
    chat_id = request.chat_id
    if not chat_id:
        # Create a new chat session if one doesn't exist
        new_chat = supabase.table("chats").insert({
            "user_email": request.user_email,
            "title": request.message[:40] + "..." # Auto-generate title
        }).execute()
        chat_id = new_chat.data[0]['id']

    # 2. Save User Message to Memory
    supabase.table("messages").insert({
        "chat_id": chat_id,
        "role": "user",
        "content": request.message
    }).execute()

    # 3. Vector Embed the User's Question
    result = gemini_client.models.embed_content(
        model="gemini-embedding-001",
        contents=request.message,
        config=types.EmbedContentConfig(output_dimensionality=768)
    )
    question_embedding = result.embeddings[0].values

    # 4. Search the Supabase Vector Database (RAG)
    # This calls the match_documents RPC function you created in SQL
    matching_docs = supabase.rpc("match_documents", {
        "query_embedding": question_embedding,
        "match_threshold": 0.70, # Only retrieve highly relevant chunks
        "match_count": 5
    }).execute()

    context_text = "\n\n".join([f"Source ({doc['filename']}): {doc['content']}" for doc in matching_docs.data])

    # 5. Retrieve Chat History
    history = supabase.table("messages")\
        .select("*")\
        .eq("chat_id", chat_id)\
        .order("created_at")\
        .limit(10)\
        .execute()

    # 6. Construct the Gemini Prompt
    gemini_history = []
    for msg in history.data[:-1]: 
        gemini_history.append(
            types.Content(
                role="model" if msg['role'] == "assistant" else "user",
                parts=[types.Part.from_text(text=msg['content'])]
            )
        )
        
    system_instruction = f"""
    You are an intelligent study assistant. Answer the user's question based strictly on the provided Context. 
    If the context does not contain the answer, say "I cannot find this in your uploaded study materials."
    
    Context from uploaded documents:
    {context_text}
    """

    chat_session = gemini_client.chats.create(
        model="gemini-3.6-flash",  # Updated from gemini-1.5-flash
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
        ),
        history=gemini_history
    )
    
    # Send the newest message
    response = chat_session.send_message(request.message)

    # 7. Save Assistant Message to Memory
    supabase.table("messages").insert({
        "chat_id": chat_id,
        "role": "assistant",
        "content": response.text
    }).execute()

    return {
        "chat_id": chat_id,
        "response": response.text,
        "sources": [doc['filename'] for doc in matching_docs.data]
    }