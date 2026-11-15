import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

declare global {
  interface Window {
    booth: {
      invoke: (channel: string, ...args: unknown[]) => Promise<any>
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void
      send: (channel: string, ...args: unknown[]) => void
    }
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
