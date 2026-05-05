import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './monaco';
import App from './App';
import { I18nProvider } from './i18n';
import { ensureRuntimeApi } from './runtime';
import './styles.css';

ensureRuntimeApi();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </I18nProvider>
  </React.StrictMode>,
);
