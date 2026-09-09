import os
import io
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
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

class DeleteRequest(BaseModel):
    user_email: str

# Load environment variables
load_dotenv()

app = FastAPI()

# Allow the React/Vite frontend to communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://127.0.0.1:5173",
        "https://goofy-five.vercel.app" 
    ],
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
async def upload_document(file: UploadFile = File(...), user_email: str = Form(...)):
    if not file.filename.lower().endswith(('.pdf', '.pptx', '.doc', '.docx')):
        raise HTTPException(status_code=400, detail="Only PDF, PPTX, and DOCX supported.")
    
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
            "embedding": result.embeddings[0].values,
            "user_email": user_email  # Associates chunks with the logged-in user
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
    matching_docs = supabase.rpc("match_documents", {
        "query_embedding": question_embedding,
        "match_threshold": 0.70, 
        "match_count": 5,
        "p_user_email": request.user_email # Filters search by user email
    }).execute()

    context_text = "\n\n".join([f"Context: {doc['content']}" for doc in matching_docs.data])

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
    You are Goofy AI, a severely caffeinated medical study assistant. 
    First, attempt to answer the user's question using the provided Context from their uploaded documents. 
    If the context DOES NOT contain the answer, use your general medical knowledge and the internet to answer, but briefly warn the user that you are pulling this from outside their uploaded notes.
    Maintain your witty, helpful persona.
    
    Context from uploaded documents:
    {context_text}
    """

    chat_session = gemini_client.chats.create(
        model="gemini-3.6-flash", 
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            tools=[{"google_search": {}}] # Enables live internet fetching
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
        "sources": [] 
    }

@app.post("/clear_data")
async def clear_user_data(request: DeleteRequest):
    # 1. Delete all document vectors (This frees the 500MB DB limit)
    supabase.table("documents").delete().eq("user_email", request.user_email).execute()
    
    # 2. Get user's chat IDs to delete associated messages
    user_chats = supabase.table("chats").select("id").eq("user_email", request.user_email).execute()
    chat_ids = [chat['id'] for chat in user_chats.data]
    
    if chat_ids:
        supabase.table("messages").delete().in_("chat_id", chat_ids).execute()
        
    # 3. Delete the chat sessions
    supabase.table("chats").delete().eq("user_email", request.user_email).execute()
    
    return {"message": "Storage reclaimed successfully."}

# --- NEW GRANULAR ENDPOINTS FOR SIDEBAR ---

@app.get("/user_chats")
async def get_user_chats(user_email: str):
    # Fetch chat IDs and titles, newest first
    response = supabase.table("chats").select("id, title").eq("user_email", user_email).order("created_at", desc=True).execute()
    return {"chats": response.data}

@app.get("/chat_history/{chat_id}")
async def get_chat_history(chat_id: str):
    # Fetch previous messages for a specific chat
    response = supabase.table("messages").select("role, content").eq("chat_id", chat_id).order("created_at").execute()
    return {"messages": response.data}

@app.delete("/chat/{chat_id}")
async def delete_chat(chat_id: str, user_email: str):
    # Delete messages first, then the chat session
    supabase.table("messages").delete().eq("chat_id", chat_id).execute()
    supabase.table("chats").delete().eq("id", chat_id).eq("user_email", user_email).execute()
    return {"message": "Chat deleted"}

@app.get("/user_files")
async def get_user_files(user_email: str):
    # Fetch all chunks, then use Python set() to get unique filenames
    response = supabase.table("documents").select("filename").eq("user_email", user_email).execute()
    filenames = list(set([doc['filename'] for doc in response.data]))
    return {"files": filenames}

@app.delete("/file")
async def delete_file(filename: str, user_email: str):
    # Delete all vector chunks associated with this specific file and user
    supabase.table("documents").delete().eq("filename", filename).eq("user_email", user_email).execute()
    return {"message": "File deleted"}