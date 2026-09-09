import { useState, useRef, useEffect } from 'react'
import { Stethoscope, Syringe, Send, Paperclip, BrainCircuit, Loader2 } from 'lucide-react'
import { supabase } from './supabase'

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
  // Auth State
  const [session, setSession] = useState(null)
  
  // Chat State
  const [messages, setMessages] = useState(() => [
    { role: 'assistant', content: initialGreetings[Math.floor(Math.random() * initialGreetings.length)] }
  ])
  const [footerJoke] = useState(() => footerJokes[Math.floor(Math.random() * footerJokes.length)])
  const [input, setInput] = useState('')
  const [chatId, setChatId] = useState(null)
  const [isTyping, setIsTyping] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  
  const chatEndRef = useRef(null)

  // 1. Listen for Google Login/Logout events
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Auto-scroll to the newest message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Auth Functions
  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({ 
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    })
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setIsUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('https://goofy-vucm.onrender.com/upload', {
        method: 'POST',
        body: formData,
      })
      
      if (response.ok) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Got it! Successfully ingested ${file.name}. Bring on the questions.` }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Ugh, I choked on that file. Make sure it is a PDF or PPTX.' }])
      }
    } catch (error) {
      console.error("Upload error:", error)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Server connection failed. Is the backend running?' }])
    } finally {
      setIsUploading(false)
      e.target.value = null // Reset file input
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
          user_email: session.user.email, // Now uses the actual logged-in user's email!
          message: userMsg,
          chat_id: chatId
        })
      })

      const data = await response.json()
      
      // Save the chat_id so the backend remembers the conversation history
      if (data.chat_id) setChatId(data.chat_id)
      
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch (error) {
      console.error("Chat error:", error)
      setMessages(prev => [...prev, { role: 'assistant', content: 'My brain flatlined. Check the backend connection.' }])
    } finally {
      setIsTyping(false)
    }
  }

  // If user is NOT logged in, show the Login Screen
  if (!session) {
    return (
      <div className="min-h-screen bg-goofy-beige flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center space-y-6">
          <div className="bg-goofy-darkgreen w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Stethoscope size={40} className="text-goofy-beige" />
          </div>
          <h1 className="text-3xl font-bold text-goofy-darkgreen">Goofy AI</h1>
          <p className="text-goofy-brown">Your caffeinated medical study assistant.</p>
          
          <button 
            onClick={signInWithGoogle}
            className="w-full py-3 px-4 bg-white border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
            Sign in with Google
          </button>
        </div>
      </div>
    )
  }

  // If user IS logged in, show the Main App
  return (
    <div className="min-h-screen bg-medico-pattern flex flex-col items-center p-4 sm:p-8 font-sans text-goofy-brown">
      
      {/* Header */}
      <header className="w-full max-w-3xl flex items-center justify-between bg-goofy-darkgreen text-goofy-beige p-4 rounded-t-2xl shadow-lg border-b-4 border-goofy-brown">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-goofy-beige text-goofy-darkgreen rounded-full animate-caffeine-jitters">
            <Stethoscope size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-wide">Goofy AI</h1>
            <p className="text-xs opacity-80">Your severely caffeinated study buddy</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={signOut}
            className="text-xs font-semibold bg-goofy-brown/80 hover:bg-goofy-brown px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            Sign Out
          </button>
          <BrainCircuit size={32} className="opacity-50 hidden sm:block" />
        </div>
      </header>

      {/* Chat Window */}
      <div className="w-full max-w-3xl flex-1 bg-white/90 backdrop-blur-sm border-x-2 border-goofy-brown/20 p-4 overflow-y-auto min-h-[60vh] flex flex-col gap-4 shadow-xl">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-2xl ${
              msg.role === 'user' 
                ? 'bg-goofy-lightgreen text-white rounded-br-none' 
                : 'bg-goofy-beige border-2 border-goofy-brown/10 text-goofy-brown rounded-bl-none shadow-sm'
            }`}>
              <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-goofy-beige border-2 border-goofy-brown/10 text-goofy-brown p-3 rounded-2xl rounded-bl-none shadow-sm flex gap-2 items-center">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Synthesizing caffeine...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <form onSubmit={handleSend} className="w-full max-w-3xl bg-goofy-beige p-3 flex gap-2 rounded-b-2xl shadow-lg border-t-2 border-goofy-brown/20 relative">
        
        <label className={`cursor-pointer p-3 rounded-xl transition-colors flex items-center justify-center group relative ${
          isUploading ? 'bg-goofy-lightgreen/50 cursor-not-allowed' : 'bg-goofy-darkgreen hover:bg-goofy-lightgreen'
        } text-goofy-beige`}>
          <input 
            type="file" 
            className="hidden" 
            accept=".pdf,.pptx,.doc,.docx" 
            onChange={handleFileUpload}
            disabled={isUploading}
          />
          {isUploading ? <Loader2 size={24} className="animate-spin" /> : <Paperclip size={24} />}
          <span className="absolute bottom-full mb-2 w-max bg-goofy-brown text-white text-xs p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
            {isUploading ? 'Uploading...' : 'Upload PDF, PPTX, DOC (Max 50MB)'}
          </span>
        </label>

        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me about the Krebs Cycle (please don't)..." 
          disabled={isTyping || isUploading}
          className="flex-1 bg-white border-2 border-goofy-brown/20 rounded-xl px-4 py-2 focus:outline-none focus:border-goofy-lightgreen text-goofy-brown placeholder-goofy-brown/50 disabled:bg-gray-100"
        />

        <button 
          type="submit" 
          disabled={isTyping || isUploading || !input.trim()}
          className="p-3 bg-goofy-brown text-white rounded-xl hover:bg-goofy-darkgreen transition-colors disabled:bg-goofy-brown/50 cursor-pointer"
        >
          <Send size={24} />
        </button>
      </form>

      {/* Footer Joke */}
      <div className="mt-4 text-goofy-brown/60 flex items-center gap-2 text-sm font-medium">
        <Syringe size={16} />
        <span>{footerJoke}</span>
      </div>

    </div>
  )
}