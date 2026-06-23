import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign Vite WebSocket error that occurs when HMR is disabled or fails
window.addEventListener("unhandledrejection", (event) => {
  if (event.reason && event.reason.message && event.reason.message.includes("WebSocket closed without opened")) {
    event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
