// Einstieg der Server-App-Oberfläche. Schriften lokal (keine Google-Fonts-Aufrufe): Inter für die UI,
// Archivo Black für den Schriftzug, Material Symbols Rounded für Symbole.
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/archivo-black'
import 'material-symbols/rounded.css'
import App from './App.jsx'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
