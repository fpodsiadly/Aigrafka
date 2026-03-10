import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './panel/App';

const CONTAINER_ID = 'aigrafka-extension-root';
let root: Root | null = null;
let hostEl: HTMLElement | null = null;

function removePanel() {
  const existing = document.getElementById(CONTAINER_ID);
  if (root) {
    root.unmount();
    root = null;
  }
  if (existing) {
    existing.remove();
    hostEl = null;
    return true;
  }
  return false;
}

function injectPanel() {
  if (document.getElementById(CONTAINER_ID)) return;

  const logoPatternUrl = chrome.runtime.getURL('icons/logo_white.svg');
  const textPatternSvg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="110" viewBox="0 0 220 110"><text x="20" y="62" fill="rgba(255,255,255,0.55)" font-size="44" font-family="Space Grotesk, Segoe UI, sans-serif">aigrafka.pl</text></svg>'
  );
  const textPatternUrl = `data:image/svg+xml,${textPatternSvg}`;

  const host = document.createElement('div');
  host.id = CONTAINER_ID;
  host.style.position = 'fixed';
  host.style.top = '16px';
  host.style.right = '6px';
  host.style.zIndex = '2147483647';
  host.style.width = 'min(330px, calc(100vw - 12px))';
  host.style.height = 'fit-content';
  host.style.minHeight = '0';
  host.style.maxHeight = 'calc(100vh - 12px)';
  host.style.maxWidth = 'calc(100vw - 12px)';
  host.style.borderRadius = '18px';
  host.style.background = '#d2d2d2';
  host.style.border = '1px solid #2a2a2a';
  host.style.boxShadow = '0 16px 40px rgba(0,0,0,0.38)';
  host.style.overflow = 'hidden';

  const shadow = host.attachShadow({ mode: 'open' });
  const mount = document.createElement('div');
  mount.id = 'aigrafka-panel-root';
  mount.style.width = '100%';
  mount.style.height = 'fit-content';

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; font-family: 'Space Grotesk', 'DM Sans', 'Segoe UI', sans-serif; }
    #aigrafka-panel-root { width: 100%; height: fit-content; }
    .aigrafka-shell {
      width: 100%;
      height: fit-content;
      min-height: 0;
      max-width: none;
      max-height: calc(100vh - 12px);
      background-color: #d2d2d2;
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.08)),
        url('${textPatternUrl}'),
        url('${logoPatternUrl}');
      background-repeat: repeat, repeat, repeat;
      background-size: auto, 220px 110px, 88px 88px;
      background-position: 0 0, 0 0, 20px 18px;
      overflow-x: hidden;
      overflow-y: auto;
      color: #1e1e1e;
      transform: none;
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
  hostEl = host;

  root = createRoot(mount);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

// Toggle on demand from the action button.
console.info('[AIgrafka] content script loaded');

if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'AIGRAFKA_PING') {
      sendResponse({ ok: true, from: 'content-script' });
      return true;
    }
    if (message?.type === 'AIGRAFKA_TOGGLE_PANEL') {
      const removed = removePanel();
      if (!removed) {
        injectPanel();
      }
      sendResponse({ ok: true, toggled: true, visible: !removed });
      return true;
    }
    return false;
  });
}
