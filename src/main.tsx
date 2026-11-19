import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Schriften lokal mitgeliefert (offline, kein Aufruf an Google): App = Inter, Symbole = Material Symbols,
// Dokumente/PDF zusätzlich Playfair Display (Titel) und DM Mono (Fliesstext).
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/material-symbols-rounded/wght.css'
import '@fontsource/playfair-display/400.css'
import '@fontsource/playfair-display/400-italic.css'
import '@fontsource/playfair-display/700.css'
import '@fontsource/dm-mono/300.css'
import '@fontsource/dm-mono/400.css'
import '@fontsource/dm-mono/400-italic.css'
import '@fontsource/dm-mono/500.css'
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
