import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import 'maplibre-gl/dist/maplibre-gl.css';
import './index.css';
import App from './App';
import { loadAll } from './data/load';

loadAll();
// Dev-only handle for debugging in the browser console.
if (import.meta.env.DEV) import('./store').then(({ useApp }) => Object.assign(window, { rx: useApp }));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
