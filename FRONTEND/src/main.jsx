import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './theme.jsx'
import { reloadOnceForStaleChunk } from './utils/staleChunk.js'

// A page file from an older deploy failed to load: reload once to get the new version.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadOnceForStaleChunk({ storage: window.sessionStorage, reload: () => window.location.reload() })) {
    event.preventDefault()
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
