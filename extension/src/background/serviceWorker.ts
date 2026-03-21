// Simple message handler for checkout/open backend actions.
const apiBase = import.meta.env.VITE_API_BASE ?? 'https://api.aigrafka.pl';

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
    chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: 'png' })
      .then(dataUrl => sendResponse({ ok: true, dataUrl }))
      .catch(e => sendResponse({ ok: false, error: e?.message || 'Capture failed' }));
    return true;
  }

  if (message?.type === 'OPEN_CHECKOUT') {
    // Ask backend for checkout URL (Przelewy24/other provider).
    fetch(`${apiBase}/payments/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(message?.authToken ? { Authorization: `Bearer ${message.authToken}` } : {})
      },
      body: JSON.stringify({
        pack: message?.pack || 'starter',
        userId: message?.userId,
        email: message?.email
      })
    })
      .then(async resp => {
        if (!resp.ok) {
          const text = await resp.text();
          let message = text || 'Checkout request failed';
          try {
            const parsed = JSON.parse(text);
            if (parsed?.detail) message = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
          } catch {
            /* ignore parse */
          }
          throw new Error(message);
        }
        return resp.json();
      })
      .then(data => {
        if (data?.checkoutUrl) {
          chrome.tabs.create({ url: data.checkoutUrl });
          sendResponse({ ok: true });
          return;
        }
        sendResponse({ ok: false, error: 'Backend nie zwrócił checkoutUrl.' });
      })
      .catch((error: Error) => sendResponse({ ok: false, error: error?.message || 'Nie udało się otworzyć checkout.' }));
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
