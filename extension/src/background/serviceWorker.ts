// Simple message handler for checkout/open backend actions.
const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000';

async function setBadge(text: string, color: string) {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch (e) {
    /* ignore */
  }
  // auto-clear after 3s
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(() => null);
  }, 3000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'AIGRAFKA_CAPTURE_VISIBLE_TAB') {
    chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: 'png' }, dataUrl => {
      if (chrome.runtime.lastError || !dataUrl) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'Capture failed' });
        return;
      }
      sendResponse({ ok: true, dataUrl });
    });
    return true;
  }

  if (message?.type === 'OPEN_CHECKOUT') {
    // Placeholder: ask backend for Stripe Checkout URL.
    fetch(`${apiBase}/payments/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack: 'starter' })
    })
      .then(resp => resp.json())
      .then(data => {
        if (data?.checkoutUrl) {
          chrome.tabs.create({ url: data.checkoutUrl });
        }
        sendResponse({ ok: true });
      })
      .catch(() => sendResponse({ ok: false }));
    return true; // keep channel alive
  }
  return false;
});

// Allow users to click the toolbar icon to inject/open the panel on demand.
chrome.action.onClicked.addListener(async tab => {
  if (!tab.id) return;

  const url = tab.url ?? '';
  let allow = false;
  try {
    const u = new URL(url);
    allow = u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:';
  } catch (e) {
    /* ignore parse error */
  }
  if (!allow) {
    console.warn('[AIgrafka] inject skipped: unsupported tab URL', url);
    void setBadge('X', '#c62828');
    return;
  }
  try {
    await setBadge('…', '#1565c0');
    // Try toggle/ping first (content script should be auto-injected).
    const ping = await chrome.tabs.sendMessage(tab.id, { type: 'AIGRAFKA_TOGGLE_PANEL' }).catch(() => null);
    if (ping && ping.ok) {
      await setBadge('ON', '#2e7d32');
      return;
    }
    // Content script is declared in the manifest and should already be present.
    await setBadge('OFF', '#ef6c00');
  } catch (err) {
    console.error('[AIgrafka] inject failed', err);
    void setBadge('ERR', '#c62828');
  }
});
