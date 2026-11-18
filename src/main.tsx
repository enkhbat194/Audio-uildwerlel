import { createRoot } from 'react-dom/client';
import './index.css';

// The free-hosting PoC must NEVER import or mount the production App, which
// initializes Firebase OAuth/Firestore and exposes client-side Drive actions.
// Vite resolves this at build time; the POC chunk has no production auth imports.
const appModule = import.meta.env.VITE_FREE_HOSTING_POC === 'true'
  ? import('./FreeHostingPreview')
  : import('./App');

void appModule.then(({ default: App }) => {
  createRoot(document.getElementById('root')!).render(<App />);
});
