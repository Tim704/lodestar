import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import { ThemeProvider } from './theme';
import './styles.css';

// theme is applied pre-paint by the inline script in index.html (CONTRACT §8);
// ThemeProvider takes over from there for runtime switching.

// §8.4 — capture the install prompt before any page mounts; Settings surfaces it
declare global {
  interface Window {
    __lodestarInstall?: Event & { prompt: () => Promise<void> };
  }
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__lodestarInstall = e as Window['__lodestarInstall'];
  window.dispatchEvent(new Event('lodestar-install-ready'));
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
