import { useState, useRef, useEffect } from 'react'
import { Stethoscope, Syringe, Send, Paperclip, BrainCircuit, Loader2, Trash2, MessageSquare, Plus, FileText, Menu, X } from 'lucide-react'
import { supabase } from './supabase'
import * as THREE from 'three'
window.THREE = THREE
// @ts-ignore
import DOTS from 'vanta/src/vanta.dots'



const initialGreetings = [
  "Sup Doc! I'm Goofy. Upload your 2,000-page Robbins Pathology PDF, and I'll pretend I read it.",
  "Welcome back. I’ve had 6 shots of espresso and I'm ready to hallucinate some anatomy facts.",
  "Drop your pharmacology slides here. I promise I won't mix up the generic and brand names... much.",
  "Goofy AI online. Let's compress 5 years of medical school into a 5-minute panic session.",
  "Upload your notes. Let's figure out if it's lupus. (Spoiler: It's never lupus.)"
]

const footerJokes = [
  "Side effects of Goofy AI may include accidental passing of exams.",  
  "Warning: Goofy AI is not a substitute for actually attending your clinical rotations.",
  "Goofy AI: Because crying in the library is better with a digital friend.",
  "Consult your attending physician if your study session lasts more than 48 hours.",
  "May cause sudden urges to diagnose your family members at Thanksgiving."
]

export default function App() {
  // Auth & Layout State
  const [session, setSession] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const vantaRef = useRef(null)
  const [vantaEffect, setVantaEffect] = useState(null)

  useEffect(() => {
    // Only initialize if the user is logged in and the panel exists
    if (session && !vantaEffect && vantaRef.current) {
      setVantaEffect(
        DOTS({
          el: vantaRef.current,
          THREE: THREE, // Crucial for React integration
          mouseControls: true,
          touchControls: true,
          gyroControls: false,
          minHeight: 200.00,
          minWidth: 200.00,
          scale: 1.00,
          scaleMobile: 1.00,
          color: 0x559030,
          color2: 0x2d580b,
          backgroundColor: 0xdecc6a,
          size: 5.30,
          spacing: 37.00
        })
      )
    }
    
    // Cleanup function to destroy the animation when navigating away
    return () => {
      if (vantaEffect) {
        vantaEffect.destroy()
        setVantaEffect(null)
      }
    }
  }, [session, vantaEffect])
  
  // Sidebar Data State
  const [chatList, setChatList] = useState([])
  const [fileList, setFileList] = useState([])
  
  // Active Chat State
  const [messages, setMessages] = useState(() => [
    { role: 'assistant', content: initialGreetings[Math.floor(Math.random() * initialGreetings.length)] }
  ])
  const [footerJoke] = useState(() => footerJokes[Math.floor(Math.random() * footerJokes.length)])
  const [input, setInput] = useState('')
  const [chatId, setChatId] = useState(null)
  const [isTyping, setIsTyping] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  
  const chatEndRef = useRef(null)

  // 1. Auth Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  // 2. Load Sidebar Data when Session exists
  useEffect(() => {
    if (session) {
      fetchSidebarData()
    }
  }, [session])

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const fetchSidebarData = async () => {
    try {
      const email = session.user.email
      const [chatsRes, filesRes] = await Promise.all([
        fetch(`https://goofy-vucm.onrender.com/user_chats?user_email=${email}`),
        fetch(`https://goofy-vucm.onrender.com/user_files?user_email=${email}`)
      ])
      const chatsData = await chatsRes.json()
      const filesData = await filesRes.json()
      
      setChatList(chatsData.chats || [])
      setFileList(filesData.files || [])
    } catch (error) {
      console.error("Failed to load sidebar data", error)
    }
  }

  const handleNewChat = () => {
    setChatId(null)
    setMessages([{ role: 'assistant', content: "Fresh session! What are we studying now?" }])
    if (window.innerWidth < 768) setSidebarOpen(false) // Close sidebar on mobile
  }

  const loadPreviousChat = async (id) => {
    setChatId(id)
    if (window.innerWidth < 768) setSidebarOpen(false)
    try {
      const res = await fetch(`https://goofy-vucm.onrender.com/chat_history/${id}`)
      const data = await res.json()
      if (data.messages) {
        setMessages(data.messages)
      }
    } catch (error) {
      console.error("Failed to load chat", error)
    }
  }

  const deleteChat = async (e, id) => {
    e.stopPropagation() // Prevent loading the chat when clicking delete
    if (!window.confirm("Delete this chat?")) return
    
    await fetch(`https://goofy-vucm.onrender.com/chat/${id}?user_email=${session.user.email}`, { method: 'DELETE' })
    if (chatId === id) handleNewChat()
    fetchSidebarData()
  }

  const deleteFile = async (filename) => {
    if (!window.confirm(`Delete ${filename} from your AI memory?`)) return
    
    await fetch(`https://goofy-vucm.onrender.com/file?filename=${encodeURIComponent(filename)}&user_email=${session.user.email}`, { method: 'DELETE' })
    fetchSidebarData()
  }

  // Existing Upload and Chat Functions
  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('user_email', session.user.email)

    try {
      const response = await fetch('https://goofy-vucm.onrender.com/upload', {
        method: 'POST',
        body: formData,
      })
      if (response.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Got it! Successfully ingested ${file.name}. Bring on the questions.` }])
        fetchSidebarData() // Refresh file list
      }
    } catch (error) {
      console.error("Upload error:", error)
    } finally {
      setIsUploading(false)
      e.target.value = null 
    }
  }

  const handleSend = async (e) => {
    e.preventDefault()
    if (!input.trim()) return

    const userMsg = input
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setInput('')
    setIsTyping(true)

    try {
      const response = await fetch('https://goofy-vucm.onrender.com/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: session.user.email,
          message: userMsg,
          chat_id: chatId
        })
      })

      const data = await response.json()
      if (!chatId && data.chat_id) {
        setChatId(data.chat_id)
        fetchSidebarData() // Refresh chat list if it was a new chat
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch (error) {
      console.error("Chat error:", error)
    } finally {
      setIsTyping(false)
    }
  }

  // Login Screen
  if (!session) {
    return (
      <div className="min-h-screen bg-goofy-beige flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center space-y-6">
          <div className="bg-goofy-darkgreen w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Stethoscope size={40} className="animate-heartbeat" />
          </div>
          <h1 className="text-3xl font-bold text-goofy-darkgreen">Goofy AI</h1>
          <button 
            onClick={() => supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin }})}
            className="w-full py-3 px-4 bg-white border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 flex justify-center gap-2 cursor-pointer transition-colors"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    )
  }

  // Main Split Layout
  return (
    <div className="h-screen flex bg-medico-pattern text-goofy-brown font-sans overflow-hidden">
      
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} absolute md:relative z-20 w-72 h-full bg-goofy-darkgreen text-goofy-beige flex flex-col transition-transform duration-300 shadow-2xl`}>
        
        <div className="p-4 flex items-center justify-between border-b border-goofy-beige/10">
          <div className="flex items-center gap-2">
            <Stethoscope size={24} />
            <span className="font-bold text-lg tracking-wide">Goofy AI</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden opacity-70 hover:opacity-100 cursor-pointer">
            <X size={24} />
          </button>
        </div>

        <div className="p-4">
          <button onClick={handleNewChat} className="w-full flex items-center gap-2 bg-goofy-beige/10 hover:bg-goofy-beige/20 text-goofy-beige px-4 py-3 rounded-xl transition-colors font-medium cursor-pointer">
            <Plus size={20} /> New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin">
          
          {/* Recent Chats */}
          <div>
            <h3 className="text-xs font-bold text-goofy-beige/50 uppercase tracking-wider mb-2">Recent Chats</h3>
            <div className="space-y-1">
              {chatList.map(chat => (
                <div key={chat.id} onClick={() => loadPreviousChat(chat.id)} className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${chatId === chat.id ? 'bg-goofy-beige/20' : 'hover:bg-goofy-beige/10'}`}>
                  <div className="flex items-center gap-3 overflow-hidden">
                    <MessageSquare size={16} className="opacity-70 flex-shrink-0" />
                    <span className="text-sm truncate opacity-90">{chat.title}</span>
                  </div>
                  <button onClick={(e) => deleteChat(e, chat.id)} className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all p-1 cursor-pointer">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Uploaded Files */}
          <div>
            <h3 className="text-xs font-bold text-goofy-beige/50 uppercase tracking-wider mb-2">Memory Bank</h3>
            <div className="space-y-1">
              {fileList.map(file => (
                <div key={file} className="group flex items-center justify-between p-2 rounded-lg hover:bg-goofy-beige/10 transition-colors">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <FileText size={16} className="opacity-70 flex-shrink-0" />
                    <span className="text-xs truncate opacity-90">{file}</span>
                  </div>
                  <button onClick={() => deleteFile(file)} className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all p-1 cursor-pointer">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-goofy-beige/10 text-xs">
          <button onClick={() => supabase.auth.signOut()} className="w-full text-center py-2 opacity-70 hover:opacity-100 transition-opacity cursor-pointer">
            Sign Out ({session.user.email})
          </button>
        </div>
      </div>

      {/* Main Chat Area (Vanta Target) */}
      <div ref={vantaRef} className="flex-1 flex flex-col h-full relative w-full overflow-hidden">
        
        {/* Transparent wrapper to keep chat content above the Vanta canvas */}
        <div className="relative z-10 flex flex-col h-full w-full bg-white/40 backdrop-blur-sm">
          
          {/* Mobile Header */}
          <div className="md:hidden flex items-center gap-4 p-4 bg-white/80 border-b border-goofy-brown/10">
            <button onClick={() => setSidebarOpen(true)} className="text-goofy-darkgreen cursor-pointer">
              <Menu size={24} />
            </button>
            <h1 className="font-bold text-lg text-goofy-darkgreen">Goofy AI</h1>
          </div>

          {/* Chat Window */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] md:max-w-[75%] p-4 rounded-2xl ${
                  msg.role === 'user' 
                    ? 'bg-goofy-lightgreen text-white rounded-br-none' 
                    : 'bg-white/90 border border-goofy-brown/10 text-goofy-brown rounded-bl-none shadow-sm'
                }`}>
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white/90 border border-goofy-brown/10 text-goofy-brown p-4 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-2">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-sm">Synthesizing caffeine...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-white/80 border-t border-goofy-brown/10">
            <form onSubmit={handleSend} className="max-w-4xl mx-auto flex gap-2">
              <label className={`cursor-pointer p-3 rounded-xl transition-colors flex items-center justify-center group relative ${
                isUploading ? 'bg-goofy-lightgreen/50 cursor-not-allowed' : 'bg-goofy-darkgreen hover:bg-goofy-lightgreen'
              } text-goofy-beige flex-shrink-0`}>
                <input type="file" className="hidden" accept=".pdf,.pptx,.doc,.docx" onChange={handleFileUpload} disabled={isUploading} />
                {isUploading ? <Loader2 size={24} className="animate-spin" /> : <Paperclip size={24} />}
              </label>

              <input 
                type="text" value={input} onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a medical question..." 
                disabled={isTyping || isUploading}
                className="flex-1 bg-white border-2 border-goofy-brown/10 rounded-xl px-4 py-2 focus:outline-none focus:border-goofy-lightgreen disabled:bg-gray-100"
              />

              <button type="submit" disabled={isTyping || isUploading || !input.trim()} className="p-3 bg-goofy-brown text-white rounded-xl hover:bg-goofy-darkgreen disabled:bg-goofy-brown/50 flex-shrink-0 cursor-pointer">
                <Send size={24} />
              </button>
            </form>
            <div className="text-center mt-2 text-xs text-goofy-brown/50 flex items-center justify-center gap-1">
              <Syringe size={12} /> {footerJoke}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}