import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initI18n, setLanguage } from './i18n.ts';
import { trackSettings } from './settings.ts';
import './styles.css';

const settings = await window.rezzo.invoke('settings:get');
await initI18n(settings.uiLanguage);
setLanguage(settings.uiLanguage);
trackSettings(settings);
window.rezzo.on('settings:changed', (s) => setLanguage(s.uiLanguage));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
