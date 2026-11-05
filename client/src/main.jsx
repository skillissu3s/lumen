import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import './styles/ui.css'
import './styles/app.css'
import App from './App.jsx'

// the page itself, kept for opening without a connection (not in the desktop
// app, whose own server is always there)
if (import.meta.env.PROD && 'serviceWorker' in navigator && !window.lumenDesktop) navigator.serviceWorker.register('./sw.js').catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
