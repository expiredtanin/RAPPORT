import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/global.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

document.addEventListener('contextmenu', e => e.preventDefault())

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary fullscreen>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
