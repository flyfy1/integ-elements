import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// entrance animation once per session
try {
  if (!sessionStorage.getItem('el-entered')) {
    document.documentElement.classList.add('entering')
    sessionStorage.setItem('el-entered', '1')
    setTimeout(() => document.documentElement.classList.remove('entering'), 1200)
  }
} catch { /* storage blocked */ }

const root = document.getElementById('root')!
createRoot(root).render(<StrictMode><App /></StrictMode>)
document.getElementById('static')?.remove()
document.getElementById('static-foot')?.remove()

if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js') })
}
