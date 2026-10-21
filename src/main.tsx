import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/exo-2/latin-700.css';
import '@fontsource/exo-2/latin-900.css';
import '@fontsource/orbitron/latin-900.css';
import './index.css';
import { useGame } from './state/store';

// End-to-end tests read the store to find words drawn on the canvas.
if (new URLSearchParams(window.location.search).has('e2e')) {
  (window as unknown as { keystorm: typeof useGame }).keystorm = useGame;
}

createRoot(document.getElementById('root')!).render(<App />);
