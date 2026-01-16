// Simple message handler for checkout/open backend actions.
const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
