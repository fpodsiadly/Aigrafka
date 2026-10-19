import React from 'react';

import { ApiBase64, BodyMetrics, FormState, Persistable } from './types';

export const initialMetrics: BodyMetrics = {
    height: '',
    chest: '',
    waist: '',
    hips: ''
};

export const initialState: FormState = {
    selfie: null,
    category: '',
    fitStyle: 'unisex',
    modelChoice: 'banana-pro-2',
    productUrl: '',
    productImage1: null,
    productImage2: null,
    accepted: false,
    variantCount: 1,
    ...initialMetrics
};

export const apiBase = import.meta.env.VITE_API_BASE ?? 'https://api.aigrafka.pl';
const storageKey = '****************';
const authTokenKey = '**********************';
let inMemoryAuthToken: string | null = null;
export const placeholderPreview = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80';
export const SelfieEmpty: React.FC = () => (
    <svg viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
        <circle cx="44" cy="44" r="44" fill="#d5d5d5" />
        <circle cx="44" cy="34" r="12" fill="#b0b0b0" />
        <ellipse cx="44" cy="68" rx="20" ry="14" fill="#b0b0b0" />
    </svg>
);
export const GENERATION_TIMEOUT_MESSAGE = 'Przekroczono limit czasu oczekiwania na stylizację. Serwer mógł być w stanie cold start — spróbuj ponownie.';


export const validProductUrl = (url: string) => {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
};

export const normalizeProductUrl = (url: string) => url.trim().replace(/[|\s]+$/g, '');

export { isSafeExternalUrl } from './safeUrl';

export function hasAnyBodyMetrics(metrics: BodyMetrics): boolean {
    return [metrics.height, metrics.chest, metrics.waist, metrics.hips].some(value => value.trim().length > 0);
}

export function extractBase64(value: ApiBase64): string | null {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.image_base64 === 'string') return value.image_base64;
    return null;
}

export const storage = {
    async get(): Promise<Partial<Persistable>> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.get([storageKey], result => resolve(result?.[storageKey] ?? {}));
            });
        }
        try {
            const raw = localStorage.getItem(storageKey);
            return raw ? (JSON.parse(raw) as Partial<Persistable>) : {};
        } catch {
            return {};
        }
    },
    async clear(): Promise<void> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => chrome.storage.local.remove([storageKey], () => resolve()));
        }
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    },
    async set(data: Partial<Persistable>): Promise<void> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.set({ [storageKey]: data }, () => resolve());
            });
        }
        try {
            localStorage.setItem(storageKey, JSON.stringify(data));
        } catch {
            /* ignore */
        }
    }
};

// The auth token is a bearer credential. It must never touch the host page's
// localStorage (readable by the page and any XSS on it). Use chrome.storage.local
// (isolated to the extension) and fall back to in-memory only.
export const authStorage = {
    async getToken(): Promise<string | null> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.get([authTokenKey], result => resolve(result?.[authTokenKey] ?? null));
            });
        }
        return inMemoryAuthToken;
    },
    async setToken(token: string): Promise<void> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.set({ [authTokenKey]: token }, () => resolve());
            });
        }
        inMemoryAuthToken = token;
    },
    async clearToken(): Promise<void> {
        inMemoryAuthToken = null;
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.remove([authTokenKey], () => resolve());
            });
        }
    }
};

const selfieStorageKey = '******************';
// Biometric selfie is cached only to prefill the form; expire it so it is not
// retained indefinitely.
const SELFIE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const selfieStorage = {
    async save(file: File): Promise<void> {
        return new Promise(resolve => {
            const img = new Image();
            const objUrl = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(objUrl);
                const MAX = 800;
                const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(); return; }
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                const payload = { dataUrl, savedAt: Date.now() };
                if (chrome?.storage?.local) {
                    chrome.storage.local.set({ [selfieStorageKey]: payload }, () => resolve());
                } else {
                    try { localStorage.setItem(selfieStorageKey, JSON.stringify(payload)); } catch { /* quota exceeded */ }
                    resolve();
                }
            };
            img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(); };
            img.src = objUrl;
        });
    },
    async load(): Promise<File | null> {
        let payload: { dataUrl: string; savedAt?: number } | null = null;
        if (chrome?.storage?.local) {
            payload = await new Promise(resolve => {
                chrome.storage.local.get([selfieStorageKey], result => resolve(result?.[selfieStorageKey] ?? null));
            });
        } else {
            try {
                const raw = localStorage.getItem(selfieStorageKey);
                payload = raw ? JSON.parse(raw) : null;
            } catch { payload = null; }
        }
        if (!payload?.dataUrl) return null;
        // Enforce retention: drop and purge the cached biometric selfie once it
        // is older than the retention window (or when it lacks a timestamp).
        if (!payload.savedAt || Date.now() - payload.savedAt > SELFIE_RETENTION_MS) {
            await this.clear();
            return null;
        }
        try {
            const res = await fetch(payload.dataUrl);
            const blob = await res.blob();
            return new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
        } catch { return null; }
    },
    async clear(): Promise<void> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => chrome.storage.local.remove([selfieStorageKey], () => resolve()));
        }
        try { localStorage.removeItem(selfieStorageKey); } catch { /* ignore */ }
    }
};

export function toDataUrl(base64: string | null, mimeType?: string | null): string {
    if (!base64) return '';
    const mime = mimeType || 'image/jpeg';
    return `data:${mime};base64,${base64}`;
}

// Decode base64 into a Blob and return a short-lived blob: URL. Keeps large
// image bytes off the React state/heap (vs. multi-MB data: strings). Caller
// MUST revokeObjectUrl(...) when the URL is no longer displayed.
export function base64ToObjectUrl(base64: string | null, mimeType?: string | null): string {
    if (!base64) return '';
    const mime = mimeType || 'image/jpeg';
    try {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch {
        return toDataUrl(base64, mimeType);
    }
}

export function revokeObjectUrl(url: string | null | undefined): void {
    if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}

export function toRequestErrorMessage(error: unknown, fallback: string, signal?: AbortSignal): string {
    if (error instanceof DOMException && error.name === 'AbortError') {
        const reason = signal?.reason;
        if (typeof reason === 'string' && reason.trim()) return reason;
        if (reason instanceof Error && reason.message) return reason.message;
        return 'Przekroczono limit czasu. Spróbuj ponownie.';
    }

    if (error instanceof TypeError) {
        const msg = error.message.toLowerCase();
        if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
            return 'Brak połączenia z serwerem AIgrafka. Sprawdź internet lub spróbuj ponownie za chwilę.';
        }
        if (msg.includes('cors')) {
            return 'Błąd CORS — serwer nie zezwolił na połączenie z tej strony. Odśwież rozszerzenie.';
        }
    }

    if (error instanceof Error && error.message) return error.message;
    return fallback;
}

