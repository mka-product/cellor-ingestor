import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import App from './App.jsx';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import './celnight-theme.css';
import './styles.css';
import './layer-panel.css';

// Dynamically load PrimeReact theme based on saved preference
const savedTheme = localStorage.getItem('celnight-theme') || 'dark';
const primeTheme = savedTheme === 'dark' ? 'lara-dark-blue' : 'lara-light-blue';
const link = document.createElement('link');
link.id = 'prime-react-theme';
link.rel = 'stylesheet';
link.href = `https://cdn.jsdelivr.net/npm/primereact@latest/resources/themes/${primeTheme}/theme.css`;
document.head.appendChild(link);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

