import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Đảm bảo có element root trong HTML
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found in HTML');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
