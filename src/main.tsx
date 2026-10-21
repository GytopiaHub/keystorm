import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { useGame } from './state/store';

// End-to-end tests read the store to find words drawn on the canvas.
if (new URLSearchParams(window.location.search).has('e2e')) {
  (window as unknown as { keystorm: typeof useGame }).keystorm = useGame;
}

createRoot(document.getElementById('root')!).render(<App />);
