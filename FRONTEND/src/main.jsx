import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { TBDataProvider } from './context/TBDataContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TBDataProvider>
      <App />
    </TBDataProvider>
  </StrictMode>,
)
