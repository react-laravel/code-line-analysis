import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './monaco';
import App from './App';
import { I18nProvider } from './i18n';
import { ensureRuntimeApi } from './runtime';
import { applyInitialTheme, ThemeProvider } from './theme';
import './styles.css';

ensureRuntimeApi();
applyInitialTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
