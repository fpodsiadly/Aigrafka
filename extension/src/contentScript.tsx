import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './panel/App';

const CONTAINER_ID = 'aigrafka-extension-root';

function injectPanel() {
    if (document.getElementById(CONTAINER_ID)) return;

    const host = document.createElement('div');
    host.id = CONTAINER_ID;
    host.style.position = 'fixed';
    host.style.top = '80px';
    host.style.right = '24px';
    host.style.zIndex = '2147483647';
    host.style.width = '360px';
    host.style.height = '640px';

    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    mount.id = 'aigrafka-panel-root';

    const style = document.createElement('style');
    style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    .aigrafka-shell {
      width: 360px;
      height: 640px;
      border-radius: 20px;
      background: #4a4a4a;
      box-shadow: 0 12px 32px rgba(0,0,0,0.35);
      overflow: hidden;
      color: #f5f5f5;
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
