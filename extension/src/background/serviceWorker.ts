// Prefer the public API domain. Fall back to Render when DNS, proxy, or the
// custom domain is unavailable. Resolve before requests instead of retrying a
// failed POST, which could duplicate generation or payment operations.
const primaryApiBase = import.meta.env.VITE_API_BASE ?? 'https://api.aigrafka.pl';
const fallbackApiBase = 'https://aigrafka.onrender.com';
const API_BASE_CACHE_MS = 60_000;
let resolvedApiBase: string | null = null;
let resolvedApiBaseExpiresAt = 0;
let apiBaseResolution: Promise<string> | null = null;

async function isHealthy(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveApiBase(): Promise<string> {
  if (resolvedApiBase && Date.now() < resolvedApiBaseExpiresAt) return resolvedApiBase;
  if (apiBaseResolution) return apiBaseResolution;

  apiBaseResolution = (async () => {
    const selected = await isHealthy(primaryApiBase) ? primaryApiBase : fallbackApiBase;
    resolvedApiBase = selected;
    resolvedApiBaseExpiresAt = Date.now() + API_BASE_CACHE_MS;
    return selected;
  })();

  try {
    return await apiBaseResolution;
  } finally {
    apiBaseResolution = null;
  }
}

async function getGoogleCredential(): Promise<string> {
  const apiBase = await resolveApiBase();
  const configResponse = await fetch(`${apiBase}/auth/google/client-id`, { cache: 'no-store' });
  if (!configResponse.ok) throw new Error('Nie udało się pobrać konfiguracji Google.');
  const config = await configResponse.json() as { enabled?: boolean; client_id?: string };
  if (!config.enabled || !config.client_id) throw new Error('Logowanie Google nie jest skonfigurowane.');

  const redirectUri = chrome.identity.getRedirectURL('google');
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: config.client_id,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    interactive: true,
  });
  if (!redirectUrl) throw new Error('Google nie zwrócił danych logowania.');

  const result = new URL(redirectUrl);
  const response = new URLSearchParams(result.hash.slice(1));
  if (response.get('state') !== state) throw new Error('Nieprawidłowy stan logowania Google.');
  const error = response.get('error');
  if (error) throw new Error(error === 'access_denied' ? 'Anulowano logowanie Google.' : `Błąd Google: ${error}`);
  const credential = response.get('id_token');
  if (!credential) throw new Error('Google nie zwrócił tokenu tożsamości.');
  return credential;
}

type ApiBody =
  | { kind: 'json'; value: unknown }
  | {
      kind: 'form';
      entries: Array<
        | { name: string; kind: 'text'; value: string }
        | { name: string; kind: 'file'; filename: string; contentType: string; base64: string }
      >;
    };

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
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
  const ALLOWED_METHODS = new Set(['GET', 'POST']);
  const method = (typeof message.method === 'string' ? message.method : 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return { ok: false, status: 405, text: 'Niedozwolona metoda API.' };
  }
  // Only forward a safe allowlist of request headers. Content-Type is set by
  // the body handling below; never forward arbitrary caller-supplied headers.
  const incoming = typeof message.headers === 'object' && message.headers !== null
    ? message.headers as Record<string, string>
    : {};
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming)) {
    if (name.toLowerCase() === 'authorization' && typeof value === 'string') headers.Authorization = value;
  }
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
  const apiBase = await resolveApiBase();
  const response = await fetch(`${apiBase}${message.path}`, { method, headers, body });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

// Only open checkout URLs on trusted payment hosts, so a tampered/buggy backend
// response cannot redirect the user to a phishing domain.
const ALLOWED_CHECKOUT_HOSTS = new Set([
  'secure.przelewy24.pl',
  'sandbox.przelewy24.pl',
  'example.com', // demo mode placeholder
]);

function isAllowedCheckoutUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' && ALLOWED_CHECKOUT_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
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
    const capture = sender.tab?.windowId === undefined
      ? chrome.tabs.captureVisibleTab({ format: 'png' })
      : chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
    capture
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

  if (message?.type === 'AIGRAFKA_GOOGLE_LOGIN') {
    getGoogleCredential()
      .then(credential => sendResponse({ ok: true, credential }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message || 'Błąd logowania Google.' }));
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
    resolveApiBase()
      .then(apiBase => fetch(`${apiBase}/payments/checkout`, {
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
      }))
      .then(data => {
        if (data?.checkoutUrl && isAllowedCheckoutUrl(data.checkoutUrl)) {
          chrome.tabs.create({ url: data.checkoutUrl });
          sendResponse({ ok: true });
          return;
        }
        if (data?.checkoutUrl) {
          sendResponse({ ok: false, error: 'Niezaufany adres płatności — przerwano.' });
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
