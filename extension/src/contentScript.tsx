import React from 'react';
import { createRoot, Root } from 'react-dom/client';

const CONTAINER_ID = 'aigrafka-extension-root';
let root: Root | null = null;

function removePanel() {
  const existing = document.getElementById(CONTAINER_ID);
  if (root) {
    root.unmount();
    root = null;
  }
  if (existing) {
    existing.remove();
    return true;
  }
  return false;
}

async function injectPanel() {
  if (document.getElementById(CONTAINER_ID)) return;

  const logoPatternUrl = chrome.runtime.getURL('icons/logo_white.svg');

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

  const shadow = host.attachShadow({ mode: 'closed' });
  const mount = document.createElement('div');
  mount.id = 'aigrafka-panel-root';
  mount.style.width = '100%';
  mount.style.height = 'fit-content';

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; font-family: 'Space Grotesk', 'Segoe UI', system-ui, sans-serif; }
    #aigrafka-panel-root { width: 100%; height: fit-content; }
    .aigrafka-shell {
      width: 100%;
      height: fit-content;
      min-height: 0;
      max-width: none;
      max-height: calc(100vh - 12px);
      background-color: #d2d2d2;
      background-image: url('${logoPatternUrl}');
      background-repeat: repeat;
      background-size: 72px 72px;
      background-position: 0 0;
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

  const [{ default: App }, { ErrorBoundary }] = await Promise.all([
    import('./panel/App'),
    import('./panel/ErrorBoundary'),
  ]);
  root = createRoot(mount);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
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
