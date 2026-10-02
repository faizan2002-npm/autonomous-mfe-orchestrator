// Standalone page so the remote can be developed on its own (http://localhost:5001).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ProfileCard from './ProfileCard';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main className="mx-auto max-w-xl p-8">
      <ProfileCard gatewayUrl={import.meta.env.VITE_GATEWAY_URL || 'http://localhost:4000'}
        apiKey={import.meta.env.VITE_MFE_CONSUMER_KEY ?? ''} canary="on" />
    </main>
  </StrictMode>,
);
