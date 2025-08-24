import React from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  return React.createElement('div', null, 'AI Chat Frontend Placeholder')
}

const container = document.getElementById('root') || document.createElement('div')
container.id = 'root'
document.body.appendChild(container)
createRoot(container).render(React.createElement(App))
