// Simple message handler for checkout/open backend actions.
const apiBase = import.meta.env.VITE_API_BASE ?? 'https://api.aigrafka.pl';

type ApiBody =
  | { kind: 'json'; value: unknown }
  | {
      kind: 'form';
      entries: Array<
        | { name: string; kind: 'text'; value: string }
        | { name: string; kind: 'file'; filename: string; contentType: string; base64: string }
      >;
    };

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function proxyApiRequest(message: {
  path?: unknown;
  method?: unknown;
  headers?: unknown;
  body?: ApiBody;
}): Promise<{ ok: boolean; status: number; text: string }> {
  if (typeof message.path !== 'string' || !message.path.startsWith('/') || message.path.startsWith('//')) {
    return { ok: false, status: 400, text: 'Nieprawidłowa ścieżka API.' };
  }
  const method = typeof message.method === 'string' ? message.method : 'GET';
  const headers = typeof message.headers === 'object' && message.headers !== null
    ? message.headers as Record<string, string>
    : {};
  let body: FormData | string | undefined;
  if (message.body?.kind === 'json') {
    body = JSON.stringify(message.body.value);
    headers['Content-Type'] = 'application/json';
  } else if (message.body?.kind === 'form') {
    const form = new FormData();
    for (const entry of message.body.entries) {
      if (entry.kind === 'text') form.append(entry.name, entry.value);
      else form.append(
        entry.name,
        new Blob([decodeBase64(entry.base64)], { type: entry.contentType }),
        entry.filename,
      );
    }
    body = form;
  }
  const response = await fetch(`${apiBase}${message.path}`, { method, headers, body });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

async function setBadge(text: string, color: string) {
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    /* ignore */
  }
  // auto-clear after 3s
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(() => null);
  }, 3000);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages originating from this extension's own content
  // scripts/pages; reject anything else (defense against spoofed senders).
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  if (message?.type === 'AIGRAFKA_CAPTURE_VISIBLE_TAB') {
    chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: 'png' })
      .then(dataUrl => sendResponse({ ok: true, dataUrl }))
      .catch(e => sendResponse({ ok: false, error: e?.message || 'Capture failed' }));
    return true;
  }

  if (message?.type === 'AIGRAFKA_API_REQUEST') {
    proxyApiRequest(message)
      .then(sendResponse)
      .catch((error: Error) => sendResponse({ ok: false, status: 503, text: error.message || 'Backend unavailable' }));
    return true;
  }

  if (message?.type === 'AIGRAFKA_GET_ACTIVE_TAB_URL') {
    chrome.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        const url = tabs[0]?.url;
        if (url && /^https?:\/\//i.test(url)) {
          sendResponse({ ok: true, url });
          return;
        }
        sendResponse({ ok: false, error: 'Aktywna karta nie zawiera adresu HTTP.' });
      })
      .catch(error => sendResponse({ ok: false, error: error?.message || 'Nie udało się odczytać aktywnej karty.' }));
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
  } catch {
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
