import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './panel/App';

const CONTAINER_ID = 'aigrafka-extension-root';

function injectPanel() {
    if (document.getElementById(CONTAINER_ID)) return;

    const host = document.createElement('div');
    host.id = CONTAINER_ID;
    host.style.position = 'fixed';
    host.style.top = '64px';
    host.style.right = '6px';
    host.style.zIndex = '2147483647';
    host.style.width = 'min(330px, calc(100vw - 12px))';
    host.style.height = 'min(720px, calc(100vh - 12px))';
    host.style.maxHeight = 'calc(100vh - 12px)';
    host.style.maxWidth = 'calc(100vw - 12px)';

    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    mount.id = 'aigrafka-panel-root';

    const style = document.createElement('style');
    style.textContent = `
    :host { all: initial; }
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; font-family: 'Space Grotesk', 'DM Sans', 'Segoe UI', sans-serif; }
    .aigrafka-shell {
      width: 100%;
      height: 100%;
      max-width: 320px;
      max-height: 680px;
      border-radius: 18px;
      background: #3a3a3a;
      box-shadow: 0 16px 40px rgba(0,0,0,0.38);
      overflow: hidden;
      color: #f5f5f5;
      border: 1px solid #2a2a2a;
      transform: scale(0.9);
      transform-origin: top right;
    }
    @keyframes aigrafka-shimmer {
      0% { transform: translateX(-30%); opacity: 0.8; }
      50% { opacity: 1; }
      100% { transform: translateX(30%); opacity: 0.8; }
    }
  `;

    shadow.appendChild(style);
    shadow.appendChild(mount);
    document.body.appendChild(host);

    const root = createRoot(mount);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}

injectPanel();
