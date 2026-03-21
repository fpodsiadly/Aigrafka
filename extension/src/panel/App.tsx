import React, { useEffect, useMemo, useRef, useState } from 'react';
import logo from '../../icons/logo_white.svg';

interface BodyMetrics {
    height: string;
    chest: string;
    waist: string;
    hips: string;
}

interface FormState extends BodyMetrics {
    selfie: File | null;
    category: string;
    fitStyle: 'masculine' | 'feminine' | 'unisex';
    productUrl: string;
    productImage1: File | null;
    productImage2: File | null;
    accepted: boolean;
    variantCount: number;
    modelChoice: 'banana-pro-2';
}

type ProductImageKey = 'productImage1' | 'productImage2';

type StorableKey = keyof Pick<FormState, 'height' | 'chest' | 'waist' | 'hips' | 'category' | 'productUrl' | 'fitStyle'>;
type SavedFlags = Partial<Record<StorableKey, boolean>>;
type Persistable = Pick<FormState, StorableKey>;
const storableKeys: StorableKey[] = ['height', 'chest', 'waist', 'hips', 'fitStyle', 'category', 'productUrl'];

type ApiBase64 = string | { image_base64?: string } | null | undefined;

interface ApiVariant {
    image_base64?: ApiBase64;
    mime_type?: string | null;
    width?: number | null;
    height?: number | null;
    latency_ms?: number | null;
}

interface GenerateResponse {
    status: string;
    image_base64?: ApiBase64;
    mime_type?: string | null;
    model?: string | null;
    variants?: ApiVariant[];
    detail?: string | null;  // error detail when status != 'generated'
}

interface AuthApiResponse {
    access_token: string;
    token_type: string;
    user_id: string;
    email: string;
    tokens: number;
}

interface AuthMeResponse {
    user_id: string;
    email: string;
    tokens: number;
}

interface ProfileResponse {
    userId: string;
    height: string;
    chest: string;
    waist: string;
    hips: string;
    fitStyle?: FormState['fitStyle'] | null;
    consentGiven?: boolean | null;
}

interface GoogleClientIdResponse {
    enabled: boolean;
    client_id?: string | null;
}

declare global {
    interface Window {
        google?: {
            accounts?: {
                id?: {
                    initialize: (options: { client_id: string; callback: (resp: { credential?: string }) => void }) => void;
                    renderButton: (container: HTMLElement, options: {
                        theme?: 'outline' | 'filled_blue' | 'filled_black';
                        size?: 'large' | 'medium' | 'small';
                        text?: 'signin_with' | 'continue_with' | 'signup_with';
                        shape?: 'rectangular' | 'pill' | 'circle' | 'square';
                        width?: number;
                    }) => void;
                };
            };
        };
    }
}

interface VariantPreview {
    url: string;
    mimeType?: string;
    latencyMs?: number;
}

const initialMetrics: BodyMetrics = {
    height: '',
    chest: '',
    waist: '',
    hips: ''
};

const initialState: FormState = {
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

const apiBase = import.meta.env.VITE_API_BASE ?? 'https://api.aigrafka.pl';
const storageKey = 'aigrafka-form-v2';
const authTokenKey = 'aigrafka-auth-token-v1';
let inMemoryAuthToken: string | null = null;
const placeholderPreview = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80';
const SelfieEmpty: React.FC = () => (
    <svg viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
        <rect width="88" height="88" fill="#ececec" />
        <circle cx="44" cy="32" r="14" fill="#c4b0e8" />
        <ellipse cx="44" cy="72" rx="22" ry="16" fill="#c4b0e8" />
        <circle cx="44" cy="32" r="10" fill="#e9e0f8" />
        <path d="M30 72 Q30 54 44 54 Q58 54 58 72" fill="#d6c8f0" />
        <circle cx="40" cy="30" r="2" fill="#7f3bff" />
        <circle cx="48" cy="30" r="2" fill="#7f3bff" />
        <path d="M40 36 Q44 39 48 36" stroke="#7f3bff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
);
const REQUEST_TIMEOUT_MS = 70_000; // Render free tier cold start can be slow; give more headroom
const GENERATION_TIMEOUT_MESSAGE = 'Przekroczono limit czasu oczekiwania na stylizację. Serwer mógł być w stanie cold start — spróbuj ponownie.';

const badge = {
    background: '#e2e2e2',
    color: '#1f1f1f',
    border: '2px solid #bdbdbd',
    borderRadius: '12px',
    padding: '10px 12px'
};

const sectionTitleStyle: React.CSSProperties = {
    fontWeight: 800,
    fontSize: '12px',
    color: '#1c1c1c'
};

const sectionHintStyle: React.CSSProperties = {
    fontSize: '10px',
    color: '#4b4b4b'
};

const inputStyle: React.CSSProperties = {
    flex: 1,
    width: '100%',
    minWidth: 0,
    padding: '7px 9px',
    background: '#ffffff',
    border: '2px solid #c7c7c7',
    borderRadius: 9,
    fontSize: '11px',
    color: '#1e1e1e'
};

const validProductUrl = (url: string) => {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
        return false;
    }
};

const normalizeProductUrl = (url: string) => url.trim().replace(/[|\s]+$/g, '');

const actionButtonStyle: React.CSSProperties = {
    background: '#9b59ff',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: '11px',
    lineHeight: 1.1,
    border: 'none',
    padding: '8px 10px',
    cursor: 'pointer',
    borderRadius: 9,
    transition: 'transform 0.1s ease, box-shadow 0.2s ease'
};

const fieldLabelStyle: React.CSSProperties = {
    flex: '0 0 110px',
    maxWidth: '110px',
    fontWeight: 700,
    fontSize: '11px',
    color: '#1e1e1e',
    lineHeight: 1.2
};

const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '6px',
    marginBottom: '8px'
};

function hasAnyBodyMetrics(metrics: BodyMetrics): boolean {
    return [metrics.height, metrics.chest, metrics.waist, metrics.hips].some(value => value.trim().length > 0);
}

function extractBase64(value: ApiBase64): string | null {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.image_base64 === 'string') return value.image_base64;
    return null;
}

const storage = {
    async get(): Promise<Partial<Persistable>> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.get([storageKey], result => resolve(result?.[storageKey] ?? {}));
            });
        }
        try {
            const raw = localStorage.getItem(storageKey);
            return raw ? (JSON.parse(raw) as Partial<Persistable>) : {};
        } catch (e) {
            return {};
        }
    },
    async set(data: Partial<Persistable>): Promise<void> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.set({ [storageKey]: data }, () => resolve());
            });
        }
        try {
            localStorage.setItem(storageKey, JSON.stringify(data));
        } catch (e) {
            /* ignore */
        }
    }
};

const authStorage = {
    async getToken(): Promise<string | null> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.get([authTokenKey], result => resolve(result?.[authTokenKey] ?? null));
            });
        }
        try { return localStorage.getItem(authTokenKey); } catch { return inMemoryAuthToken; }
    },
    async setToken(token: string): Promise<void> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.set({ [authTokenKey]: token }, () => resolve());
            });
        }
        try { localStorage.setItem(authTokenKey, token); } catch { inMemoryAuthToken = token; }
    },
    async clearToken(): Promise<void> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.remove([authTokenKey], () => resolve());
            });
        }
        try { localStorage.removeItem(authTokenKey); } catch { /* ignore */ }
        inMemoryAuthToken = null;
    }
};

function toDataUrl(base64: string | null, mimeType?: string | null): string {
    if (!base64) return '';
    const mime = mimeType || 'image/jpeg';
    return `data:${mime};base64,${base64}`;
}

function toRequestErrorMessage(error: unknown, fallback: string, signal?: AbortSignal): string {
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

const PanelHeader = ({
    logoSrc,
    loggedIn,
    userEmail,
    onLogin,
    onLogout
}: {
    logoSrc?: string;
    loggedIn: boolean;
    userEmail?: string;
    onLogin: () => void;
    onLogout: () => void;
}) => (
    <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        background: '#d9d9d9',
        borderBottom: '2px solid #bdbdbd'
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#ffffff', display: 'grid', placeItems: 'center', overflow: 'hidden', border: '2px solid #bfbfbf' }}>
                {logoSrc ? (
                    <img src={logoSrc} alt="AIgrafka" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <span style={{ fontSize: '20px', color: '#7a0606' }}>A</span>
                )}
            </div>
            <div style={{ color: '#1b1b1b', fontSize: '18px', fontWeight: 700, letterSpacing: '0.1px' }}>AIgrafka</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, minWidth: 0 }}>
            <button
                type="button"
                onClick={loggedIn ? onLogout : onLogin}
                style={{
                    ...actionButtonStyle,
                    background: loggedIn ? '#d9a1c5' : '#9b59ff',
                    color: '#ffffff',
                    padding: '7px 10px',
                    borderRadius: 10,
                    boxShadow: 'none'
                }}
            >
                {loggedIn ? 'Wyloguj się' : 'Zaloguj się'}
            </button>
            {loggedIn && userEmail && (
                <div
                    title={userEmail}
                    style={{
                        fontSize: 10,
                        color: '#4b4b4b',
                        maxWidth: 170,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}
                >
                    Zalogowano: {userEmail}
                </div>
            )}
        </div>
    </div>
);

const FieldRow = ({
    label,
    children
}: {
    label: string;
    children: React.ReactNode;
}) => (
    <div style={rowStyle}>
        <div style={fieldLabelStyle}>{label}</div>
        <div style={{ flex: '1 1 180px', display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0, width: '100%' }}>{children}</div>
        </div>
    </div>
);

const App: React.FC = () => {
    const [form, setForm] = useState<FormState>(initialState);
    const [status, setStatus] = useState<string>('');
    const [statusTone, setStatusTone] = useState<'success' | 'error'>('success');
    const [previewUrl, setPreviewUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [selfiePreview, setSelfiePreview] = useState<string>('');
    const [productPreview1, setProductPreview1] = useState<string>('');
    const [productPreview2, setProductPreview2] = useState<string>('');
    const [hoveredProductBtn, setHoveredProductBtn] = useState<ProductImageKey | null>(null);
    const [variants, setVariants] = useState<VariantPreview[]>([]);
    const [selectedVariant, setSelectedVariant] = useState<number>(0);
    const [generationMeta, setGenerationMeta] = useState<{ model?: string; latencyMs?: number }>({});
    const [auth, setAuth] = useState<{ loggedIn: boolean; tokens: number; accessToken: string | null; email?: string; userId?: string }>({
        loggedIn: false,
        tokens: 0,
        accessToken: null,
        email: undefined,
        userId: undefined
    });
    const [view, setView] = useState<'form' | 'generating' | 'result'>('form');
    const [showMeasurements, setShowMeasurements] = useState<boolean>(false);
    const [autoExpandedMeasurementsKey, setAutoExpandedMeasurementsKey] = useState<string | null>(null);
    const [storageHydrated, setStorageHydrated] = useState<boolean>(false);
    const [showAuthDialog, setShowAuthDialog] = useState<boolean>(false);
    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [authEmail, setAuthEmail] = useState<string>('');
    const [authPassword, setAuthPassword] = useState<string>('');
    const [authSubmitting, setAuthSubmitting] = useState<boolean>(false);
    const [googleClientId, setGoogleClientId] = useState<string | null>(null);
    const [googleReady, setGoogleReady] = useState<boolean>(false);
    const [googleInitialized, setGoogleInitialized] = useState<boolean>(false);
    const [profileReadyForUser, setProfileReadyForUser] = useState<string | null>(null);
    const [uploadMenuFor, setUploadMenuFor] = useState<ProductImageKey | null>(null);
    const [waitingPulse, setWaitingPulse] = useState<number>(0);
    const [isSharing, setIsSharing] = useState<boolean>(false);
    const [generationError, setGenerationError] = useState<string>('');
    const googleButtonRef = useRef<HTMLDivElement | null>(null);
    const productImage1InputRef = useRef<HTMLInputElement | null>(null);
    const productImage2InputRef = useRef<HTMLInputElement | null>(null);
    const productImage1MenuRef = useRef<HTMLDivElement | null>(null);
    const productImage2MenuRef = useRef<HTMLDivElement | null>(null);
    const storageSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const canSubmit = useMemo(() => {
        const hasProductImage = Boolean(form.productImage1) || Boolean(form.productImage2);
        const hasSelfie = !!form.selfie;
        if (!form.accepted || !hasProductImage || !hasSelfie) return false;
        return auth.loggedIn ? auth.tokens >= form.variantCount : true;
    }, [form, auth]);

    const hasSelfie = Boolean(form.selfie);
    const hasProduct = Boolean(form.productImage1) || Boolean(form.productImage2);
    const measurementsSessionKey = auth.userId ? `user:${auth.userId}` : 'guest';
    const isProfileHydrating = Boolean(auth.loggedIn && auth.userId && profileReadyForUser !== auth.userId);

    useEffect(() => {
        storage.get().then(stored => {
            if (stored) {
                setForm(prev => ({ ...prev, ...stored }));
            }
        }).finally(() => {
            setStorageHydrated(true);
        });
    }, []);

    useEffect(() => {
        if (form.selfie) {
            const url = URL.createObjectURL(form.selfie);
            setSelfiePreview(url);
            return () => URL.revokeObjectURL(url);
        }
        setSelfiePreview('');
        return undefined;
    }, [form.selfie]);

    useEffect(() => {
        if (form.productImage1) {
            const url = URL.createObjectURL(form.productImage1);
            setProductPreview1(url);
            return () => URL.revokeObjectURL(url);
        }
        setProductPreview1('');
        return undefined;
    }, [form.productImage1]);

    useEffect(() => {
        if (form.productImage2) {
            const url = URL.createObjectURL(form.productImage2);
            setProductPreview2(url);
            return () => URL.revokeObjectURL(url);
        }
        setProductPreview2('');
        return undefined;
    }, [form.productImage2]);

    useEffect(() => {
        if (!storageHydrated) return;
        if (isProfileHydrating) return;
        if (autoExpandedMeasurementsKey === measurementsSessionKey) return;

        setShowMeasurements(!hasAnyBodyMetrics(form));
        setAutoExpandedMeasurementsKey(measurementsSessionKey);
    }, [
        storageHydrated,
        isProfileHydrating,
        form.height,
        form.chest,
        form.waist,
        form.hips,
        measurementsSessionKey,
        autoExpandedMeasurementsKey
    ]);

    function update<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm(prev => ({ ...prev, [key]: value }));
    }

    async function loadProfile(userId: string, token: string) {
        try {
            const response = await fetch(`${apiBase}/profile/${userId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) {
                setProfileReadyForUser(userId);
                return;
            }

            const profile: ProfileResponse | null = await response.json();
            if (!profile) {
                setProfileReadyForUser(userId);
                return;
            }

            setForm(prev => ({
                ...prev,
                height: profile.height || prev.height,
                chest: profile.chest || prev.chest,
                waist: profile.waist || prev.waist,
                hips: profile.hips || prev.hips,
                fitStyle: profile.fitStyle === 'feminine' || profile.fitStyle === 'unisex' || profile.fitStyle === 'masculine'
                    ? profile.fitStyle
                    : prev.fitStyle,
                accepted: typeof profile.consentGiven === 'boolean' ? profile.consentGiven : prev.accepted
            }));
        } catch (error) {
            console.error(error);
        } finally {
            setProfileReadyForUser(userId);
        }
    }

    function setStatusSuccess(message: string) {
        setStatusTone('success');
        setStatus(message);
    }

    function setStatusError(message: string) {
        setStatusTone('error');
        setStatus(message);
    }

    async function refreshAuthFromServer(tokenOverride?: string | null): Promise<boolean> {
        const token = tokenOverride ?? auth.accessToken;
        if (!token) {
            setAuth({ loggedIn: false, tokens: 0, accessToken: null, email: undefined, userId: undefined });
            setProfileReadyForUser(null);
            return false;
        }

        try {
            const response = await fetch(`${apiBase}/auth/me`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) {
                await authStorage.clearToken();
                setAuth({ loggedIn: false, tokens: 0, accessToken: null, email: undefined, userId: undefined });
                setProfileReadyForUser(null);
                return false;
            }

            const data: AuthMeResponse = await response.json();
            setAuth({ loggedIn: true, tokens: data.tokens, accessToken: token, email: data.email, userId: data.user_id });
            await loadProfile(data.user_id, token);
            return true;
        } catch (error) {
            console.error(error);
            return false;
        }
    }

    function handleLogin() {
        setAuthMode('login');
        setAuthEmail(auth.email ?? '');
        setAuthPassword('');
        setShowAuthDialog(true);
    }

    function closeAuthDialog() {
        if (authSubmitting) return;
        setShowAuthDialog(false);
    }

    async function handleAuthSubmit(event: React.FormEvent) {
        event.preventDefault();
        const email = authEmail.trim();
        const password = authPassword;

        if (!email.includes('@')) {
            setStatus('Podaj poprawny adres email.');
            return;
        }

        if (password.length < 6) {
            setStatus('Hasło musi mieć co najmniej 6 znaków.');
            return;
        }

        const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login';
        setAuthSubmitting(true);

        try {
            let response = await fetch(`${apiBase}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            if (!response.ok && authMode === 'register' && response.status === 409) {
                response = await fetch(`${apiBase}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
            }

            if (!response.ok) {
                const text = await response.text();
                let message = authMode === 'register' ? 'Nie udało się utworzyć konta.' : 'Nie udało się zalogować.';
                try {
                    const parsed = JSON.parse(text);
                    message = parsed?.detail || message;
                } catch {
                    if (text) message = text;
                }
                throw new Error(message);
            }

            const data: AuthApiResponse = await response.json();
            await authStorage.setToken(data.access_token);
            setAuth({ loggedIn: true, tokens: data.tokens, accessToken: data.access_token, email: data.email, userId: data.user_id });
            await loadProfile(data.user_id, data.access_token);
            setShowAuthDialog(false);
            setStatus(`Zalogowano jako ${data.email}.`);
        } catch (error) {
            console.error(error);
            setStatus(error instanceof Error ? error.message : 'Błąd logowania.');
        } finally {
            setAuthSubmitting(false);
        }
    }

    async function handleGoogleCredential(credential: string) {
        if (!credential) {
            setStatus('Nie udało się pobrać tokenu Google.');
            return;
        }

        setAuthSubmitting(true);
        try {
            const response = await fetch(`${apiBase}/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_token: credential })
            });

            if (!response.ok) {
                const text = await response.text();
                let message = 'Logowanie Google nie powiodło się.';
                try {
                    const parsed = JSON.parse(text);
                    message = parsed?.detail || message;
                } catch {
                    if (text) message = text;
                }
                throw new Error(message);
            }

            const data: AuthApiResponse = await response.json();
            await authStorage.setToken(data.access_token);
            setAuth({ loggedIn: true, tokens: data.tokens, accessToken: data.access_token, email: data.email, userId: data.user_id });
            await loadProfile(data.user_id, data.access_token);
            setShowAuthDialog(false);
            setStatus(`Zalogowano przez Google jako ${data.email}.`);
        } catch (error) {
            console.error(error);
            setStatus(error instanceof Error ? error.message : 'Błąd logowania Google.');
        } finally {
            setAuthSubmitting(false);
        }
    }

    async function handleLogout() {
        await authStorage.clearToken();
        setAuth({ loggedIn: false, tokens: 0, accessToken: null, email: undefined, userId: undefined });
        setProfileReadyForUser(null);
        setForm(prev => ({
            ...prev,
            height: '',
            chest: '',
            waist: '',
            hips: ''
        }));
        setStatus('Wylogowano.');
    }

    async function handleTopUpTokens() {
        if (!auth.loggedIn || !auth.accessToken) {
            setStatus('Najpierw zaloguj się, aby doładować tokeny.');
            return;
        }

        // Always try the dev endpoint first. If the backend has DEV_MODE=true it returns tokens
        // immediately. On production (DEV_MODE=false) it returns 403 → fall through to real checkout.
        try {
            const res = await fetch(`${apiBase}/payments/dev-add-tokens`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${auth.accessToken}` }
            });
            if (res.ok) {
                const data = await res.json() as { ok: boolean; tokens: number };
                setAuth(prev => ({ ...prev, tokens: data.tokens ?? prev.tokens + 5 }));
                setStatusSuccess('Dodano 5 tokenów.');
                return;
            }
            // 403 = DEV_MODE disabled → fall through to payment flow below
            if (res.status !== 403) {
                // Any other error on dev endpoint — just bump locally (offline/unreachable)
                setAuth(prev => ({ ...prev, tokens: prev.tokens + 5 }));
                setStatusSuccess('(offline) Dodano 5 tokenów testowych.');
                return;
            }
        } catch {
            // Network unreachable (e.g. backend offline) → bump locally so dev flow still works
            setAuth(prev => ({ ...prev, tokens: prev.tokens + 5 }));
            setStatusSuccess('(offline) Dodano 5 tokenów testowych.');
            return;
        }

        // DEV_MODE=false → real payment checkout
        try {
            const response = await new Promise<{ ok?: boolean; error?: string }>(resolve => {
                chrome.runtime?.sendMessage?.(
                    {
                        type: 'OPEN_CHECKOUT',
                        pack: 'starter',
                        authToken: auth.accessToken,
                        userId: auth.userId,
                        email: auth.email
                    },
                    result => {
                        if (chrome.runtime?.lastError) {
                            resolve({ ok: false, error: chrome.runtime.lastError.message });
                            return;
                        }
                        resolve(result ?? { ok: false, error: 'Brak odpowiedzi z tła rozszerzenia.' });
                    }
                );
            });

            if (!response?.ok) {
                throw new Error(response?.error || 'Nie udało się rozpocząć płatności.');
            }

            setStatus('Przekierowano do płatności Przelewy24.');
        } catch (error) {
            console.error(error);
            setStatus(error instanceof Error ? error.message : 'Nie udało się doładować tokenów.');
        }
    }

    const fitStyleLabel: Record<FormState['fitStyle'], string> = { masculine: 'mężczyzna', feminine: 'kobieta', unisex: 'unisex' };
    const measurementSummary = `${form.height || '-'}/${form.chest || '-'}/${form.waist || '-'}/${form.hips || '-'}/${fitStyleLabel[form.fitStyle]}`;

    // Debounced persist of storable fields (400 ms after last change)
    useEffect(() => {
        if (!storageHydrated) return;
        if (storageSaveTimerRef.current) clearTimeout(storageSaveTimerRef.current);
        storageSaveTimerRef.current = setTimeout(() => {
            const toPersist: Partial<Persistable> = {};
            storableKeys.forEach(k => {
                (toPersist as Record<string, unknown>)[k] = form[k];
            });
            void storage.set(toPersist as Persistable);
        }, 400);
        return () => {
            if (storageSaveTimerRef.current) clearTimeout(storageSaveTimerRef.current);
        };
    }, [storageHydrated, form.height, form.chest, form.waist, form.hips, form.fitStyle, form.category, form.productUrl]);

    useEffect(() => {
        authStorage.getToken().then(token => {
            if (!token) return;
            refreshAuthFromServer(token);
        });
    }, []);

    useEffect(() => {
        if (!auth.loggedIn || !auth.accessToken || !auth.userId) return;
        if (profileReadyForUser !== auth.userId) return;

        const timeoutId = window.setTimeout(() => {
            fetch(`${apiBase}/profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${auth.accessToken}`
                },
                body: JSON.stringify({
                    userId: auth.userId,
                    height: form.height,
                    chest: form.chest,
                    waist: form.waist,
                    hips: form.hips,
                    fitStyle: form.fitStyle,
                    consentGiven: form.accepted
                })
            }).catch(error => console.error(error));
        }, 450);

        return () => window.clearTimeout(timeoutId);
    }, [
        auth.loggedIn,
        auth.accessToken,
        auth.userId,
        profileReadyForUser,
        form.height,
        form.chest,
        form.waist,
        form.hips,
        form.fitStyle,
        form.accepted
    ]);

    useEffect(() => {
        if (!showAuthDialog) return;

        fetch(`${apiBase}/auth/google/client-id`)
            .then(r => r.ok ? r.json() : null)
            .then((data: GoogleClientIdResponse | null) => {
                if (!data?.enabled || !data.client_id) {
                    setGoogleClientId(null);
                    setGoogleReady(false);
                    return;
                }

                setGoogleClientId(data.client_id);

                if (window.google?.accounts?.id) {
                    setGoogleReady(true);
                    return;
                }

                const existing = document.querySelector('script[data-google-gsi="true"]') as HTMLScriptElement | null;
                if (existing) {
                    existing.addEventListener('load', () => setGoogleReady(true), { once: true });
                    return;
                }

                const script = document.createElement('script');
                script.src = 'https://accounts.google.com/gsi/client';
                script.async = true;
                script.defer = true;
                script.dataset.googleGsi = 'true';
                script.onload = () => setGoogleReady(true);
                script.onerror = () => setStatus('Nie udało się załadować Google Sign-In.');
                document.head.appendChild(script);
            })
            .catch(error => {
                console.error(error);
                setGoogleClientId(null);
                setGoogleReady(false);
            });
    }, [showAuthDialog]);

    useEffect(() => {
        if (!googleReady || !googleClientId || googleInitialized) return;
        if (!window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: response => {
                if (response?.credential) {
                    handleGoogleCredential(response.credential);
                } else {
                    setStatus('Google nie zwrócił poświadczenia.');
                }
            }
        });
        setGoogleInitialized(true);
    }, [googleReady, googleClientId, googleInitialized]);

    useEffect(() => {
        if (!showAuthDialog || !googleInitialized) return;
        if (!googleButtonRef.current || !window.google?.accounts?.id) return;

        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleButtonRef.current, {
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            width: 280
        });
    }, [showAuthDialog, googleInitialized]);

    useEffect(() => {
        if (!showAuthDialog) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeAuthDialog();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [showAuthDialog]);

    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === 'visible' && auth.loggedIn) {
                void refreshAuthFromServer();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [auth.loggedIn, auth.accessToken]);

    async function runGeneration() {
        if (!canSubmit || !form.selfie) return;

        const normalizedProductUrl = form.productUrl ? normalizeProductUrl(form.productUrl) : '';

        const hasProductImage = Boolean(form.productImage1) || Boolean(form.productImage2);
        if (!hasProductImage) {
            setStatusError('Dodaj zdjęcie produktu (pierwsze lub drugie).');
            return;
        }

        if (normalizedProductUrl && !validProductUrl(normalizedProductUrl)) {
            setStatusError('Link do produktu ma nieprawidłowy format (wymagane http/https).');
            return;
        }

        if (auth.loggedIn && auth.tokens < form.variantCount) {
            setStatusError(`Za mało tokenów. Potrzeba: ${form.variantCount}.`);
            return;
        }

        setView('generating');

        setStatus('');
        setGenerationError('');
        setIsLoading(true);
        setPreviewUrl('');
        setVariants([]);
        setSelectedVariant(0);
        setGenerationMeta({});

        const startedAt = performance.now();

        const formData = new FormData();
        if (normalizedProductUrl) {
            formData.append('product_url', normalizedProductUrl);
        }
        if (form.category) {
            formData.append('category', form.category);
        }
        if (form.fitStyle) {
            formData.append('fit_style', form.fitStyle);
        }
        if (form.modelChoice) {
            formData.append('model_choice', form.modelChoice);
        }
        if (form.height) formData.append('height_cm', form.height);
        if (form.chest) formData.append('chest_cm', form.chest);
        if (form.waist) formData.append('waist_cm', form.waist);
        if (form.hips) formData.append('hips_cm', form.hips);

        formData.append('selfie', form.selfie);
        formData.append('variants', String(form.variantCount));
        if (form.productImage1) {
            formData.append('product_image_1', form.productImage1);
        }
        if (form.productImage2) {
            formData.append('product_image_2', form.productImage2);
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(GENERATION_TIMEOUT_MESSAGE), REQUEST_TIMEOUT_MS);

        let succeeded = false;

        try {
            const response = await fetch(`${apiBase}/generate`, {
                method: 'POST',
                body: formData,
                headers: auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : undefined,
                signal: controller.signal
            });

            if (!response.ok) {
                if (response.status === 402) {
                    if (auth.loggedIn) await refreshAuthFromServer();
                }
                const text = await response.text();
                let apiDetail = '';
                try {
                    const parsed = JSON.parse(text);
                    if (parsed?.detail) apiDetail = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
                } catch (e) { /* ignore */ }

                const statusMessages: Record<number, string> = {
                    400: `Nieprawidłowe dane żądania${apiDetail ? ': ' + apiDetail : '.'}`,
                    401: 'Sesja wygasła — zaloguj się ponownie.',
                    402: 'Za mało tokenów stylizacji. Doładuj konto.',
                    403: 'Brak uprawnień do wykonania tej operacji.',
                    413: 'Przesłane zdjęcie jest zbyt duże. Zmniejsz plik poniżej 8 MB.',
                    422: `Błąd walidacji danych${apiDetail ? ': ' + apiDetail : '. Sprawdź poprawność zdjęcia i linku produktu.'}`,
                    429: 'Zbyt wiele żądań. Poczekaj chwilę przed kolejną próbą.',
                    500: 'Błąd wewnętrzny serwera. Spróbuj ponownie za chwilę.',
                    502: 'Serwer chwilowo niedostępny (502). Spróbuj ponownie.',
                    503: 'Serwer jest przeciążony lub startuje (503). Spróbuj za kilka sekund.',
                    504: 'Serwer nie odpowiada w czasie (504). Spróbuj ponownie.',
                };
                const message = statusMessages[response.status]
                    ?? (apiDetail || `Błąd serwera (HTTP ${response.status}).`);
                throw new Error(message);
            }

            const data: GenerateResponse = await response.json();
            const normalizedVariants: VariantPreview[] = (data.variants ?? []).map(variant => {
                const base64 = extractBase64(variant.image_base64);
                return {
                    url: toDataUrl(base64, variant.mime_type ?? data.mime_type),
                    mimeType: variant.mime_type || data.mime_type || undefined,
                    latencyMs: variant.latency_ms ?? undefined
                };
            }).filter(v => Boolean(v.url));

            const isFallback = data.status === 'fallback' || normalizedVariants.length === 0;

            const fallbackBase64 = extractBase64(data.image_base64);
            if (!normalizedVariants.length && fallbackBase64) {
                normalizedVariants.push({
                    url: toDataUrl(fallbackBase64, data.mime_type ?? 'image/jpeg'),
                    mimeType: data.mime_type ?? undefined
                });
            }

            const firstUrl = normalizedVariants[0]?.url || placeholderPreview;
            setVariants(normalizedVariants);
            setSelectedVariant(0);
            setPreviewUrl(firstUrl);
            setGenerationMeta({
                model: data.model ?? undefined,
                latencyMs: normalizedVariants[0]?.latencyMs
            });

            const totalMs = performance.now() - startedAt;
            const backendMs = normalizedVariants[0]?.latencyMs ?? null;
            console.log('[AIgrafka] render complete', {
                total_s: Number((totalMs / 1000).toFixed(2)),
                backend_s: backendMs !== null ? Number((backendMs / 1000).toFixed(2)) : null,
                variants: normalizedVariants.length,
                model: data.model ?? 'unknown'
            });

            const variantCount = normalizedVariants.length || 1;
            setView('result');
            if (isFallback) {
                const detail = data.detail ? `: ${data.detail}` : '';
                const fallbackMsg = `Generacja nieudana${detail}. Spróbuj ponownie.`;
                console.warn('[AIgrafka] generation fallback', { status: data.status, detail: data.detail, model: data.model, variants: normalizedVariants.length });
                setStatusError(fallbackMsg);
                setGenerationError(fallbackMsg);
                succeeded = false;
                setPreviewUrl(placeholderPreview);
                setVariants([]);
            } else {
                setStatusSuccess(`Gotowe: ${variantCount} wariant${variantCount === 1 ? '' : 'y'}.`);
                succeeded = true;
            }
        } catch (error) {
            console.error(error);
            let message = toRequestErrorMessage(error, 'Nie udało się wygenerować stylizacji.', controller.signal);
            if (message.includes('Failed to fetch product page')) {
                message = 'Sklep blokuje pobranie strony produktu. Wklej bezpośredni link do zdjęcia produktu (JPG/PNG) albo spróbuj innego URL produktu.';
            }
            setView('generating');
            setPreviewUrl(placeholderPreview);
            setGenerationError(message);
            setStatusError(message);
        } finally {
            clearTimeout(timeoutId);
            setIsLoading(false);
            if (succeeded && auth.loggedIn) await refreshAuthFromServer();
        }
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setGenerationError('');
        await runGeneration();
    }

    function handleGenerateMore() {
        setGenerationError('');
        void runGeneration();
    }

    async function handleShare() {
        const shareUrl = form.productUrl || previewUrl || undefined;
        const imageUrl = activeVariant?.url || previewUrl || undefined;
        setIsSharing(true);
        try {
            if (navigator.share) {
                if (imageUrl && typeof navigator.canShare === 'function') {
                    try {
                        const response = await fetch(imageUrl);
                        const blob = await response.blob();
                        const extension = blob.type.includes('png') ? 'png' : 'jpg';
                        const file = new File([blob], `aigrafka-stylizacja.${extension}`, { type: blob.type || 'image/jpeg' });

                        const fileWithUrlPayload: ShareData = {
                            title: 'AIgrafka',
                            text: 'Moja stylizacja z AIgrafka',
                            files: [file],
                            url: shareUrl
                        };

                        if (navigator.canShare(fileWithUrlPayload)) {
                            await navigator.share(fileWithUrlPayload);
                            setStatusSuccess('Udostępniono.');
                            return;
                        }

                        const fileOnlyPayload: ShareData = {
                            title: 'AIgrafka',
                            text: 'Moja stylizacja z AIgrafka',
                            files: [file]
                        };
                        if (navigator.canShare(fileOnlyPayload)) {
                            await navigator.share(fileOnlyPayload);
                            setStatusSuccess('Udostępniono.');
                            return;
                        }
                    } catch (fileShareError) {
                        console.error(fileShareError);
                    }
                }

                await navigator.share({
                    title: 'AIgrafka',
                    text: 'Moja stylizacja z AIgrafka',
                    url: shareUrl
                });
                setStatusSuccess('Udostępniono.');
                return;
            }
        } catch (error) {
            console.error(error);
            if (error instanceof DOMException && error.name === 'AbortError') {
                setStatus('Anulowano udostępnianie.');
                return;
            }
        } finally {
            setIsSharing(false);
        }
        await handleCopyLink();
    }

    async function handleCopyLink() {
        const text = form.productUrl || previewUrl || 'https://aigrafka.pl';
        try {
            await navigator.clipboard.writeText(text);
            setStatusSuccess('Skopiowano link.');
        } catch (error) {
            console.error(error);
            setStatusError('Nie udało się skopiować linku.');
        }
    }

    async function handleCopyImage() {
        const target = activeVariant?.url || previewUrl || placeholderPreview;
        if (!target) {
            setStatusError('Brak obrazu do skopiowania.');
            return;
        }

        try {
            if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
                throw new Error('Kopiowanie obrazu nie jest wspierane w tym środowisku.');
            }

            const response = await fetch(target);
            const sourceBlob = await response.blob();

            let imageBlob: Blob = sourceBlob;
            if (sourceBlob.type !== 'image/png') {
                const bitmap = await createImageBitmap(sourceBlob);
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Brak wsparcia dla konwersji obrazu.');
                ctx.drawImage(bitmap, 0, 0);
                imageBlob = await new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob(blob => {
                        if (blob) resolve(blob);
                        else reject(new Error('Nie udało się przygotować obrazu PNG.'));
                    }, 'image/png');
                });
            }

            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': imageBlob })
            ]);
            setStatusSuccess('Skopiowano obraz.');
        } catch (error) {
            console.error(error);
            try {
                await navigator.clipboard.writeText(target);
                setStatusError('Nie można skopiować obrazu. Skopiowano link.');
            } catch (textError) {
                console.error(textError);
                setStatusError('Nie udało się skopiować.');
            }
        }
    }

    function handleDownload() {
        const url = activeVariant?.url || previewUrl;
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        const ext = activeVariant?.mimeType?.includes('png') ? 'png' : 'jpg';
        a.download = `aigrafka-stylizacja.${ext}`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function displayFileName(file: File | null, fallback: string) {
        if (!file) return fallback;
        const name = file.name;
        return name.length > 10 ? `${name.slice(0, 10)}…` : name;
    }

    function handleFileSelect(key: ProductImageKey, file: File | null) {
        update(key, file);
        if (file) {
            setStatus(`Dodano ${file.name}`);
        }
    }

    async function handleDropProduct(key: ProductImageKey, event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();
        const dt = event.dataTransfer;

        if (dt.files && dt.files.length > 0) {
            const file = dt.files[0];
            if (file.size > 8 * 1024 * 1024) {
                setStatusError('Plik jest za duży. Maksymalny rozmiar to 8 MB.');
                return;
            }
            handleFileSelect(key, file);
            return;
        }

        const url = dt.getData('text/uri-list') || dt.getData('text/plain');
        if (url && /^https?:\/\//i.test(url)) {
            try {
                const resp = await fetch(url, { mode: 'cors' });
                const blob = await resp.blob();
                const name = url.split('/').pop()?.split('?')[0] || 'obraz.jpg';
                const fetched = new File([blob], name, { type: blob.type || 'image/jpeg' });
                handleFileSelect(key, fetched);
                return;
            } catch (error) {
                console.error(error);
                setStatus('Nie udało się pobrać obrazu z linku (CORS).');
            }
        }

        setStatus('Upuść plik obrazu lub link http/https.');
    }

    async function captureVisibleTab(): Promise<string> {
        return new Promise((resolve, reject) => {
            chrome.runtime?.sendMessage?.({ type: 'AIGRAFKA_CAPTURE_VISIBLE_TAB' }, (response?: { ok?: boolean; dataUrl?: string; error?: string }) => {
                if (chrome.runtime?.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.ok || !response.dataUrl) {
                    reject(new Error(response?.error || 'Nie udało się przechwycić obrazu strony.'));
                    return;
                }
                resolve(response.dataUrl);
            });
        });
    }

    async function pickAreaOnPage(): Promise<{ x: number; y: number; width: number; height: number } | null> {
        return new Promise(resolve => {
            // Hide the extension panel so it doesn't cover the page
            const panelHost = document.getElementById('aigrafka-extension-root') as HTMLElement | null;
            if (panelHost) panelHost.style.display = 'none';

            // Inject highlight ring CSS into main document (box-shadow overrides page styles)
            const pickStyle = document.createElement('style');
            pickStyle.textContent = `[data-aigrafka-pick]{box-shadow:0 0 0 3px #7c3aed,0 0 0 8px rgba(124,58,237,0.22)!important;cursor:crosshair!important;outline:none!important;}`;
            document.head.appendChild(pickStyle);

            // Non-blocking floating hint bar
            const hint = document.createElement('div');
            hint.textContent = 'Najedź na zdjęcie produktu i kliknij  •  lub zaznacz obszar przeciąganiem  •  ESC = anuluj';
            Object.assign(hint.style, {
                position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(12,8,28,0.93)', color: '#fff', padding: '9px 20px',
                borderRadius: '10px', fontSize: '13px', fontFamily: "'Space Grotesk',system-ui,sans-serif",
                zIndex: '2147483648', pointerEvents: 'none', whiteSpace: 'nowrap',
                boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
            });
            document.body.appendChild(hint);

            let highlighted: HTMLElement | null = null;
            // Drag-to-select state (fallback for areas without <img> elements)
            let dragReady = false;
            let dragActive = false;
            let startX = 0, startY = 0;
            let dragOverlay: HTMLDivElement | null = null;
            let dragSelBox: HTMLDivElement | null = null;

            // Find nearest image-like ancestor
            function findImgEl(el: Element | null): HTMLElement | null {
                let cur: Element | null = el;
                while (cur && cur !== document.body) {
                    const tag = cur.tagName.toLowerCase();
                    if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'picture') return cur as HTMLElement;
                    if (cur.getAttribute('role') === 'img') return cur as HTMLElement;
                    if (cur instanceof HTMLElement && cur.offsetWidth > 50 && cur.offsetHeight > 50) {
                        const bg = getComputedStyle(cur).backgroundImage;
                        if (bg && bg !== 'none' && bg.startsWith('url(')) return cur;
                    }
                    cur = cur.parentElement;
                }
                return null;
            }

            // Peek at element under cursor without the panel blocking hit-testing
            function elementAt(x: number, y: number): Element | null {
                if (panelHost) panelHost.style.visibility = 'hidden';
                const el = document.elementFromPoint(x, y);
                if (panelHost) panelHost.style.visibility = '';
                return el;
            }

            function cleanup(result: { x: number; y: number; width: number; height: number } | null) {
                document.removeEventListener('mousemove', onMouseMove, true);
                document.removeEventListener('mousedown', onMouseDown, true);
                document.removeEventListener('mouseup', onMouseUp, true);
                document.removeEventListener('click', onClick, true);
                document.removeEventListener('keydown', onKeyDown);
                if (highlighted) highlighted.removeAttribute('data-aigrafka-pick');
                pickStyle.remove();
                hint.remove();
                dragOverlay?.remove();
                // Always restore text selection and clear any accidental selection
                document.body.style.userSelect = '';
                (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = '';
                window.getSelection()?.removeAllRanges();
                if (panelHost) panelHost.style.display = '';
                resolve(result);
            }

            function onMouseMove(e: MouseEvent) {
                if (dragActive) {
                    // Update drag selection rectangle
                    const x = Math.min(startX, e.clientX);
                    const y = Math.min(startY, e.clientY);
                    const w = Math.abs(e.clientX - startX);
                    const h = Math.abs(e.clientY - startY);
                    if (dragSelBox) Object.assign(dragSelBox.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
                    return;
                }

                if (dragReady) {
                    // Threshold check: if moved >8px, activate drag overlay
                    if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
                        dragActive = true;
                        dragOverlay = document.createElement('div');
                        Object.assign(dragOverlay.style, { position: 'fixed', inset: '0', zIndex: '2147483648', cursor: 'crosshair', background: 'rgba(0,0,0,0.07)' });
                        dragSelBox = document.createElement('div');
                        Object.assign(dragSelBox.style, {
                            position: 'fixed', border: '2px solid #7c3aed', background: 'rgba(124,58,237,0.11)',
                            pointerEvents: 'none', left: `${Math.min(startX, e.clientX)}px`, top: `${Math.min(startY, e.clientY)}px`,
                            width: `${Math.abs(e.clientX - startX)}px`, height: `${Math.abs(e.clientY - startY)}px`,
                        });
                        dragOverlay.appendChild(dragSelBox);
                        document.body.appendChild(dragOverlay);
                        hint.textContent = 'Przeciągnij aby zaznaczyć obszar  •  ESC = anuluj';
                        if (highlighted) { highlighted.removeAttribute('data-aigrafka-pick'); highlighted = null; }
                    }
                    return;
                }

                // Hover-highlight mode: find and outline the image element under cursor
                const found = findImgEl(elementAt(e.clientX, e.clientY));
                if (highlighted && highlighted !== found) {
                    highlighted.removeAttribute('data-aigrafka-pick');
                    highlighted = null;
                }
                if (found && found !== highlighted) {
                    found.setAttribute('data-aigrafka-pick', '');
                    highlighted = found;
                    hint.textContent = '✓ Kliknij aby wybrać ten obraz  •  lub zaznacz obszar  •  ESC = anuluj';
                } else if (!found) {
                    hint.textContent = 'Najedź na zdjęcie produktu i kliknij  •  lub zaznacz obszar przeciąganiem  •  ESC = anuluj';
                }
            }

            function onMouseDown(e: MouseEvent) {
                if (e.button !== 0 || dragActive) return;
                // Only start drag prep when clicking on a non-image area
                if (!findImgEl(elementAt(e.clientX, e.clientY))) {
                    e.preventDefault(); // prevent text selection on drag start
                    startX = e.clientX; startY = e.clientY;
                    dragReady = true;
                    // Disable text selection globally for the duration of the drag
                    document.body.style.userSelect = 'none';
                    (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';
                }
            }

            function onMouseUp(e: MouseEvent) {
                if (e.button !== 0) return;
                const wasDragActive = dragActive;
                dragReady = false;
                dragActive = false;
                // Restore text selection
                document.body.style.userSelect = '';
                (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = '';
                // Clear any text selection that may have accumulated before drag overlay appeared
                window.getSelection()?.removeAllRanges();
                if (!wasDragActive) return;
                const x = Math.min(startX, e.clientX);
                const y = Math.min(startY, e.clientY);
                const width = Math.abs(e.clientX - startX);
                const height = Math.abs(e.clientY - startY);
                if (width < 12 || height < 12) {
                    dragOverlay?.remove(); dragOverlay = null; dragSelBox = null;
                    hint.textContent = 'Najedź na zdjęcie produktu i kliknij  •  lub zaznacz obszar przeciąganiem  •  ESC = anuluj';
                    return;
                }
                cleanup({ x, y, width, height });
            }

            function onClick(e: MouseEvent) {
                // During drag, mouse-up already handled it
                if (dragActive || dragReady) return;
                const found = findImgEl(elementAt(e.clientX, e.clientY));
                // If not an image element, let the click pass through to the page
                // (gallery arrows, thumbnails, navigation — all still work)
                if (!found) return;
                e.preventDefault();
                e.stopPropagation();
                const r = found.getBoundingClientRect();
                cleanup({
                    x: Math.max(0, r.left),
                    y: Math.max(0, r.top),
                    width: Math.max(12, Math.min(r.width, window.innerWidth - Math.max(0, r.left))),
                    height: Math.max(12, Math.min(r.height, window.innerHeight - Math.max(0, r.top))),
                });
            }

            function onKeyDown(e: KeyboardEvent) {
                if (e.key === 'Escape') cleanup(null);
            }

            document.addEventListener('mousemove', onMouseMove, true);
            document.addEventListener('mousedown', onMouseDown, true);
            document.addEventListener('mouseup', onMouseUp, true);
            document.addEventListener('click', onClick, true);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    async function cropFromScreenshot(dataUrl: string, area: { x: number; y: number; width: number; height: number }): Promise<Blob> {
        const image = new Image();
        image.src = dataUrl;
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('Nie udało się odczytać zrzutu ekranu.'));
        });

        const dpr = window.devicePixelRatio || 1;
        const sx = Math.max(0, Math.round(area.x * dpr));
        const sy = Math.max(0, Math.round(area.y * dpr));
        const sw = Math.max(1, Math.round(area.width * dpr));
        const sh = Math.max(1, Math.round(area.height * dpr));
        const safeW = Math.min(sw, image.width - sx);
        const safeH = Math.min(sh, image.height - sy);

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, safeW);
        canvas.height = Math.max(1, safeH);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Brak wsparcia canvas.');
        context.drawImage(image, sx, sy, safeW, safeH, 0, 0, safeW, safeH);

        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('Nie udało się przyciąć obrazu.'));
            }, 'image/png');
        });
    }

    async function handlePickAreaProduct(key: ProductImageKey) {
        setUploadMenuFor(null);
        try {
            setStatus('Zaznacz obszar zdjęcia produktu na stronie.');
            const area = await pickAreaOnPage();
            if (!area) {
                setStatus('Anulowano zaznaczanie obszaru.');
                return;
            }

            const screenshot = await captureVisibleTab();
            const blob = await cropFromScreenshot(screenshot, area);
            const file = new File([blob], `produkt-${Date.now()}.png`, { type: 'image/png' });
            handleFileSelect(key, file);
            setStatusSuccess('Dodano zdjęcie z zaznaczonego obszaru.');
        } catch (error) {
            console.error(error);
            setStatusError(error instanceof Error ? error.message : 'Nie udało się pobrać zaznaczonego obszaru.');
        }
    }

    function handleChangeParams() {
        setView('form');
        setStatus('Zmień parametry i wygeneruj ponownie.');
        setTimeout(() => {
            const formEl = document.querySelector('form');
            formEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
    }

    const canShare = Boolean(form.productUrl || previewUrl);
    const logoSrc = chrome?.runtime?.getURL?.('icons/logo_white.svg') ?? logo;
    const activeVariant = variants[selectedVariant] || variants[0];
    const mainImage = activeVariant?.url || previewUrl || placeholderPreview;

    useEffect(() => {
        if (selectedVariant > 0 && selectedVariant >= variants.length) {
            setSelectedVariant(0);
        }
    }, [variants, selectedVariant]);

    useEffect(() => {
        if (!uploadMenuFor) return;

        const onPointerDown = (event: MouseEvent) => {
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
            const insideFirst = path.some(node => node instanceof Node && (productImage1MenuRef.current?.contains(node) ?? false));
            const insideSecond = path.some(node => node instanceof Node && (productImage2MenuRef.current?.contains(node) ?? false));

            if (!insideFirst && !insideSecond) {
                setUploadMenuFor(null);
            }
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setUploadMenuFor(null);
            }
        };

        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [uploadMenuFor]);

    useEffect(() => {
        if (!(view === 'generating' && isLoading)) return;
        const timer = window.setInterval(() => {
            setWaitingPulse(prev => (prev + 1) % 3);
        }, 320);
        return () => window.clearInterval(timer);
    }, [view, isLoading]);

    return (
        <div className="aigrafka-shell" style={{ display: 'flex', flexDirection: 'column', background: '#dcdcdc', color: '#1e1e1e', height: 'auto', width: '100%' }}>
            <PanelHeader logoSrc={logoSrc} loggedIn={auth.loggedIn} userEmail={auth.email} onLogin={handleLogin} onLogout={handleLogout} />
            <div style={{ padding: '10px 12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {view === 'form' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1c1c1c' }}>Witaj! Co dziś przymierzymy?</div>
                    </div>
                )}

                {view === 'form' && (
                    <form id="aigrafka-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ ...badge, boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <div style={sectionTitleStyle}>Twoje dane</div>
                                <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 6, background: '#8bb0d6', color: '#ffffff', fontSize: 11, display: 'grid', placeItems: 'center', fontWeight: 800 }}>i</span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', minWidth: 0, flex: '1 1 120px', flexWrap: 'wrap' }}>
                                    <div style={{ fontWeight: 800, fontSize: 13, color: '#1e1e1e' }}>Opis sylwetki</div>
                                    <div style={{ fontWeight: 700, color: '#555', fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                                        {measurementSummary}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowMeasurements(prev => !prev)}
                                    style={{ background: 'transparent', border: '1.5px solid #9b59ff', color: '#7c3aed', fontWeight: 700, fontSize: 10, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                                    aria-expanded={showMeasurements}
                                >
                                    {showMeasurements ? 'Minimalizuj' : 'Zmień opis sylwetki'}
                                </button>
                            </div>

                            {showMeasurements && (
                                <div style={{ marginBottom: 8, background: '#f5f5f5', border: '1.5px solid #d4d4d4', borderRadius: 10, padding: '10px 10px 8px' }}>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>Wzrost (cm)</div>
                                            <input style={{ ...inputStyle, padding: '5px 8px' }} value={form.height} onChange={e => update('height', e.target.value)} inputMode="numeric" placeholder="Podaj wzrost" />
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>Płeć</div>
                                            <select
                                                style={{ ...inputStyle, padding: '5px 8px', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', textAlign: 'center', fontWeight: 700 }}
                                                value={form.fitStyle}
                                                onChange={e => update('fitStyle', e.target.value as FormState['fitStyle'])}
                                            >
                                                <option value="masculine">Mężczyzna</option>
                                                <option value="feminine">Kobieta</option>
                                                <option value="unisex">Unisex</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>Klatka (cm)</div>
                                            <input style={{ ...inputStyle, padding: '5px 8px' }} value={form.chest} onChange={e => update('chest', e.target.value)} inputMode="numeric" placeholder="Klatka" />
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>Talia (cm)</div>
                                            <input style={{ ...inputStyle, padding: '5px 8px' }} value={form.waist} onChange={e => update('waist', e.target.value)} inputMode="numeric" placeholder="Talia" />
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>Biodra (cm)</div>
                                            <input style={{ ...inputStyle, padding: '5px 8px' }} value={form.hips} onChange={e => update('hips', e.target.value)} inputMode="numeric" placeholder="Biodra" />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <FieldRow label="Selfie:">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', width: '100%' }}>
                                    <div style={{ width: 88, height: 88, borderRadius: 12, overflow: 'hidden', border: `2px solid ${selfiePreview ? '#9b59ff' : '#bdbdbd'}`, background: '#f0f0f0', flex: '0 0 88px' }}>
                                        {selfiePreview
                                            ? <img src={selfiePreview} alt="Selfie" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            : <SelfieEmpty />}
                                    </div>
                                    <label
                                        style={{
                                            ...actionButtonStyle,
                                            background: '#9b59ff',
                                            border: '2px solid #7f3bff',
                                            borderRadius: 10,
                                            cursor: 'pointer',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: '100%',
                                            maxWidth: 160,
                                            padding: '10px 12px',
                                            fontSize: 14,
                                            fontWeight: 700
                                        }}
                                    >
                                        {form.selfie ? 'Zmień selfie' : 'Dodaj selfie'}
                                        <input type="file" accept="image/*" onChange={e => update('selfie', e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
                                    </label>
                                </div>
                            </FieldRow>
                        </div>

                        <div style={{ ...badge, boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <div style={sectionTitleStyle}>Wybrany produkt</div>
                                <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 6, background: '#8bb0d6', color: '#ffffff', fontSize: 11, display: 'grid', placeItems: 'center', fontWeight: 800 }}>i</span>
                            </div>

                            <FieldRow label="Link do produktu:">
                                <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                                    <input style={inputStyle} value={form.productUrl} onChange={e => update('productUrl', e.target.value)} placeholder="Wklej link do produktu w celu śledzenia" type="text" />
                                    <button
                                        type="button"
                                        title="Wstaw URL aktywnej karty"
                                        onClick={() => {
                                            chrome?.tabs?.query?.({ active: true, currentWindow: true }, tabs => {
                                                const url = tabs[0]?.url;
                                                if (url && /^https?:\/\//i.test(url)) {
                                                    update('productUrl', url);
                                                }
                                            });
                                        }}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', padding: '7px 9px', fontSize: 10, flexShrink: 0, whiteSpace: 'nowrap', boxShadow: 'none' }}
                                    >
                                        Aktywna karta
                                    </button>
                                </div>
                            </FieldRow>

                            <FieldRow label="Kategoria produktu:">
                                <input style={inputStyle} value={form.category} onChange={e => update('category', e.target.value)} placeholder="Podaj kategorię swojego produktu" />
                            </FieldRow>

                            <FieldRow label="Zdjęcia produktu:">
                                <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                                    <div onDragOver={e => e.preventDefault()} onDrop={e => handleDropProduct('productImage1', e)} style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            ref={productImage1MenuRef}
                                            style={{ position: 'relative' }}
                                            onMouseEnter={() => form.productImage1 && setHoveredProductBtn('productImage1')}
                                            onMouseLeave={() => setHoveredProductBtn(null)}
                                        >
                                            <button
                                                type="button"
                                                aria-label="Pierwsze zdjęcie produktu"
                                                onClick={() => setUploadMenuFor(prev => prev === 'productImage1' ? null : 'productImage1')}
                                                style={{ ...actionButtonStyle, background: form.productImage1 ? '#7f3bff' : '#9b59ff', border: '2px solid #7f3bff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 32, fontSize: 12, position: 'relative' }}
                                            >
                                                {form.productImage1 ? '✓ Pierwsze' : '+ Dodaj pierwsze'}
                                                {form.productImage1 && (
                                                    <span
                                                        role="button"
                                                        aria-label="Usuń pierwsze zdjęcie"
                                                        onClick={e => { e.stopPropagation(); update('productImage1', null); setUploadMenuFor(null); }}
                                                        style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', background: '#ff4444', color: '#fff', fontSize: 10, fontWeight: 900, display: 'grid', placeItems: 'center', lineHeight: 1, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.35)', zIndex: 10 }}
                                                    >×</span>
                                                )}
                                            </button>
                                            {hoveredProductBtn === 'productImage1' && productPreview1 && (
                                                <div style={{ position: 'absolute', bottom: 38, left: '50%', transform: 'translateX(-50%)', zIndex: 50, borderRadius: 10, overflow: 'hidden', border: '2px solid #9b59ff', boxShadow: '0 6px 18px rgba(0,0,0,0.22)', background: '#fff', pointerEvents: 'none' }}>
                                                    <img src={productPreview1} alt="Podgląd" style={{ width: 96, height: 96, objectFit: 'cover', display: 'block' }} />
                                                </div>
                                            )}
                                            <input
                                                ref={productImage1InputRef}
                                                type="file"
                                                accept="image/*"
                                                onChange={e => {
                                                    setUploadMenuFor(null);
                                                    handleFileSelect('productImage1', e.target.files?.[0] ?? null);
                                                }}
                                                style={{ display: 'none' }}
                                            />
                                            {uploadMenuFor === 'productImage1' ? (
                                                <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 30, width: '100%', background: '#ececec', border: '1px solid #c0c0c0', borderRadius: 8, padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setUploadMenuFor(null);
                                                            productImage1InputRef.current?.click();
                                                        }}
                                                        style={{ ...actionButtonStyle, background: '#8f8f8f', padding: '6px 8px', boxShadow: 'none' }}
                                                    >
                                                        Z dysku
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handlePickAreaProduct('productImage1')}
                                                        style={{ ...actionButtonStyle, background: '#9b59ff', padding: '6px 8px', boxShadow: 'none' }}
                                                    >
                                                        Zaznacz obszar
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div onDragOver={e => e.preventDefault()} onDrop={e => handleDropProduct('productImage2', e)} style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            ref={productImage2MenuRef}
                                            title="Drugie zdjęcie jest opcjonalne i pomaga lepiej odwzorować tył ubrania w 3. wariancie."
                                            style={{ position: 'relative' }}
                                            onMouseEnter={() => form.productImage2 && setHoveredProductBtn('productImage2')}
                                            onMouseLeave={() => setHoveredProductBtn(null)}
                                        >
                                            <button
                                                type="button"
                                                aria-label="Drugie zdjęcie produktu (opcjonalne)"
                                                onClick={() => setUploadMenuFor(prev => prev === 'productImage2' ? null : 'productImage2')}
                                                style={{ ...actionButtonStyle, background: form.productImage2 ? '#7f3bff' : '#9b59ff', border: '2px solid #7f3bff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 32, fontSize: 12, position: 'relative' }}
                                            >
                                                {form.productImage2 ? '✓ Drugie' : '+ Dodaj drugie'}
                                                {form.productImage2 && (
                                                    <span
                                                        role="button"
                                                        aria-label="Usuń drugie zdjęcie"
                                                        onClick={e => { e.stopPropagation(); update('productImage2', null); setUploadMenuFor(null); }}
                                                        style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: '50%', background: '#ff4444', color: '#fff', fontSize: 10, fontWeight: 900, display: 'grid', placeItems: 'center', lineHeight: 1, cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.35)', zIndex: 10 }}
                                                    >×</span>
                                                )}
                                            </button>
                                            {hoveredProductBtn === 'productImage2' && productPreview2 && (
                                                <div style={{ position: 'absolute', bottom: 38, left: '50%', transform: 'translateX(-50%)', zIndex: 50, borderRadius: 10, overflow: 'hidden', border: '2px solid #9b59ff', boxShadow: '0 6px 18px rgba(0,0,0,0.22)', background: '#fff', pointerEvents: 'none' }}>
                                                    <img src={productPreview2} alt="Podgląd" style={{ width: 96, height: 96, objectFit: 'cover', display: 'block' }} />
                                                </div>
                                            )}
                                            <input
                                                ref={productImage2InputRef}
                                                type="file"
                                                accept="image/*"
                                                onChange={e => {
                                                    setUploadMenuFor(null);
                                                    handleFileSelect('productImage2', e.target.files?.[0] ?? null);
                                                }}
                                                style={{ display: 'none' }}
                                            />
                                            {uploadMenuFor === 'productImage2' ? (
                                                <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 30, width: '100%', background: '#ececec', border: '1px solid #c0c0c0', borderRadius: 8, padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setUploadMenuFor(null);
                                                            productImage2InputRef.current?.click();
                                                        }}
                                                        style={{ ...actionButtonStyle, background: '#8f8f8f', padding: '6px 8px', boxShadow: 'none' }}
                                                    >
                                                        Z dysku
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void handlePickAreaProduct('productImage2')}
                                                        style={{ ...actionButtonStyle, background: '#9b59ff', padding: '6px 8px', boxShadow: 'none' }}
                                                    >
                                                        Zaznacz obszar
                                                    </button>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            </FieldRow>


                        </div>

                        <div style={{ ...badge, boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ ...fieldLabelStyle, fontWeight: 800, fontSize: 12 }}>Tokeny Stylizacji</div>
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                                    {auth.loggedIn ? (
                                        <>
                                            <input
                                                style={{
                                                    ...inputStyle,
                                                    width: 70,
                                                    minWidth: 70,
                                                    textAlign: 'center',
                                                    padding: '6px 8px',
                                                    background: '#dcecd6',
                                                    borderColor: '#c5d9bf'
                                                }}
                                                value={auth.tokens}
                                                readOnly
                                            />
                                            <button
                                                type="button"
                                                onClick={handleTopUpTokens}
                                                style={{
                                                    ...actionButtonStyle,
                                                    background: '#9b59ff',
                                                    boxShadow: 'none',
                                                    padding: '7px 9px',
                                                    fontSize: 10,
                                                    flex: 1
                                                }}
                                            >
                                                Dokup tokeny
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleLogin}
                                            style={{
                                                ...actionButtonStyle,
                                                flex: 1,
                                                padding: '7px 9px',
                                                fontSize: 10,
                                                background: '#9b59ff',
                                                boxShadow: 'none'
                                            }}
                                        >
                                            Zaloguj się
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div style={{ height: 1, background: '#c7c7c7', margin: '8px 0' }} />

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ ...fieldLabelStyle, fontWeight: 800, fontSize: 12 }}>Liczba Stylizacji</div>
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <input
                                        style={{ ...inputStyle, flex: 1, textAlign: 'center', padding: '6px 8px' }}
                                        type="number"
                                        min={1}
                                        max={3}
                                        value={form.variantCount}
                                        onChange={e => update('variantCount', Math.min(3, Math.max(1, Number(e.target.value) || 1)))}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => update('variantCount', Math.max(1, form.variantCount - 1))}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', width: 32, minWidth: 32, padding: '5px 0', boxShadow: 'none' }}
                                    >
                                        −
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => update('variantCount', Math.min(3, form.variantCount + 1))}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', width: 32, minWidth: 32, padding: '5px 0', boxShadow: 'none' }}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div style={{ height: 1, background: '#c7c7c7', margin: '8px 0' }} />

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#1e1e1e', fontSize: '11px', lineHeight: 1.35 }}>
                                <input type="checkbox" checked={form.accepted} onChange={e => update('accepted', e.target.checked)} style={{ marginTop: 2 }} />
                                <span>
                                    Potwierdzam prawo do wykorzystania wizerunku i akceptuję{' '}
                                    <a href="https://aigrafka.pl/regulamin" target="_blank" rel="noreferrer" style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}>Regulamin</a>
                                    {' '}i{' '}
                                    <a href="https://aigrafka.pl/polityka-prywatnosci" target="_blank" rel="noreferrer" style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}>Politykę prywatności</a>
                                    .
                                </span>
                            </label>
                        </div>

                        <button
                            type="submit"
                            style={{
                                ...actionButtonStyle,
                                width: '100%',
                                padding: '11px 12px',
                                background: canSubmit ? '#9b59ff' : '#b7b7b7',
                                cursor: canSubmit ? 'pointer' : 'not-allowed',
                                boxShadow: 'none',
                                borderRadius: 10,
                                fontSize: 13,
                                fontWeight: 600
                            }}
                            disabled={!canSubmit || isLoading}
                        >
                            {isLoading ? 'Generowanie...' : 'Generuj stylizację!'}
                        </button>
                    </form>
                )}

                {view === 'result' && (
                    <div style={{ ...badge, boxShadow: '0 10px 22px rgba(0,0,0,0.08)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div style={sectionTitleStyle}>Twoja stylizacja</div>
                            {isLoading && <span style={sectionHintStyle}>Renderowanie...</span>}
                        </div>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: '2px solid #9b59ff', background: '#f2f2f2', aspectRatio: '3 / 4', flex: 1, minWidth: 0 }}>
                                {isLoading && (
                                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04))', animation: 'aigrafka-shimmer 1.4s linear infinite', zIndex: 2 }} />
                                )}
                                <img
                                    src={mainImage}
                                    alt="Wygenerowana stylizacja"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover', filter: isLoading ? 'blur(3px)' : 'none', opacity: isLoading ? 0.7 : 1 }}
                                />
                            </div>

                            {variants.length > 1 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 36, flex: '0 0 36px' }}>
                                    {variants.map((variant, idx) => (
                                        <button
                                            key={`${variant.url}-${idx}`}
                                            type="button"
                                            onClick={() => setSelectedVariant(idx)}
                                            style={{
                                                border: idx === selectedVariant ? '2px solid #9b59ff' : '2px solid #c7c7c7',
                                                borderRadius: 8,
                                                padding: 1,
                                                background: '#ffffff',
                                                cursor: 'pointer',
                                                width: '100%'
                                            }}
                                        >
                                            <img src={variant.url} alt={`Wariant ${idx + 1}`} style={{ width: '100%', height: 48, objectFit: 'cover', borderRadius: 5, display: 'block' }} />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button
                                type="button"
                                onClick={handleShare}
                                disabled={!canShare || isSharing}
                                style={{
                                    ...actionButtonStyle,
                                    background: '#9b59ff',
                                    padding: '10px 12px',
                                    flex: 1,
                                    opacity: canShare && !isSharing ? 1 : 0.6
                                }}
                            >
                                {isSharing ? 'Udostępnianie...' : 'Udostępnij'}
                            </button>
                            <button
                                type="button"
                                onClick={handleCopyImage}
                                style={{
                                    ...actionButtonStyle,
                                    background: '#9b59ff',
                                    padding: '10px 12px',
                                    flex: 1
                                }}
                            >
                                Kopiuj
                            </button>
                            <button
                                type="button"
                                onClick={handleDownload}
                                aria-label="Pobierz wygenerowaną stylizację"
                                style={{
                                    ...actionButtonStyle,
                                    background: '#9b59ff',
                                    padding: '10px 12px',
                                    flex: 1
                                }}
                            >
                                Pobierz
                            </button>
                        </div>

                        {status ? (
                            <div
                                role="status"
                                aria-live="polite"
                                style={{
                                    marginTop: 8,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: statusTone === 'success' ? '#0f7a3a' : '#8f1f1f',
                                    background: statusTone === 'success' ? '#e9f8ef' : '#fbe9e9',
                                    border: statusTone === 'success' ? '1px solid #9fd8b7' : '1px solid #e0b0b0',
                                    borderRadius: 10,
                                    padding: '8px 10px'
                                }}
                            >
                                {status}
                            </div>
                        ) : null}

                        {generationMeta.latencyMs ? (
                            <div style={{ fontSize: 10, color: '#7c7c7c', marginTop: 4, textAlign: 'center' }}>
                                <span>{(generationMeta.latencyMs / 1000).toFixed(1)}s</span>
                            </div>
                        ) : null}

                        <div style={{ ...badge, marginTop: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                                <div style={{ ...sectionTitleStyle, fontSize: 10, marginBottom: 0, letterSpacing: 0 }}>Generuj więcej stylizacji tego produktu</div>
                                <span
                                    aria-hidden="true"
                                    style={{
                                        width: 14,
                                        height: 14,
                                        borderRadius: 999,
                                        background: '#7f47ee',
                                        color: '#fff',
                                        fontSize: 10,
                                        fontWeight: 800,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        lineHeight: 1
                                    }}
                                >
                                    i
                                </span>
                            </div>
                            {auth.loggedIn ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                    <div style={{ flex: 1, minWidth: 0, fontWeight: 700, color: '#1e1e1e', fontSize: 11, minHeight: 26, display: 'flex', alignItems: 'center', lineHeight: 1 }}>Tokeny Stylizacji</div>
                                    <input
                                        style={{ ...inputStyle, width: 58, textAlign: 'center', padding: '4px 6px', fontSize: 12, minHeight: 26 }}
                                        value={auth.tokens}
                                        readOnly
                                    />
                                    <button
                                        type="button"
                                        onClick={handleTopUpTokens}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', boxShadow: 'none', padding: '6px 10px', fontSize: 10, borderRadius: 8, width: 96, flexShrink: 0, whiteSpace: 'nowrap' }}
                                    >
                                        Dokup tokeny
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                    <div style={{ flex: 1, minWidth: 0, fontWeight: 700, color: '#1e1e1e', fontSize: 11, minHeight: 26, display: 'flex', alignItems: 'center', lineHeight: 1 }}>Tokeny Stylizacji</div>
                                    <button
                                        type="button"
                                        onClick={handleLogin}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', boxShadow: 'none', padding: '6px 10px', fontSize: 10, borderRadius: 9, flexShrink: 0, whiteSpace: 'nowrap' }}
                                    >
                                        Zaloguj się
                                    </button>
                                </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <div style={{ flex: 1, minWidth: 0, fontWeight: 700, color: '#1e1e1e', fontSize: 11, minHeight: 26, display: 'flex', alignItems: 'center', lineHeight: 1 }}>Liczba Stylizacji</div>
                                <input
                                    style={{ ...inputStyle, width: 58, textAlign: 'center', padding: '4px 6px', fontSize: 12, minHeight: 26 }}
                                    type="number"
                                    min={1}
                                    max={3}
                                    value={form.variantCount}
                                    onChange={e => update('variantCount', Math.min(3, Math.max(1, Number(e.target.value) || 1)))}
                                />
                                <div style={{ display: 'flex', gap: 4, width: 96, flexShrink: 0 }}>
                                    <button
                                        type="button"
                                        onClick={() => update('variantCount', Math.max(1, form.variantCount - 1))}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', flex: 1, padding: '4px 0', boxShadow: 'none', borderRadius: 9, fontSize: 13 }}
                                    >
                                        −
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => update('variantCount', Math.min(3, form.variantCount + 1))}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', flex: 1, padding: '4px 0', boxShadow: 'none', borderRadius: 9, fontSize: 13 }}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div style={{ background: '#ededed', border: '1px solid #c7c7c7', borderRadius: 8, padding: '6px 8px', marginBottom: 8 }}>
                                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: '#1e1e1e', fontSize: '10px', lineHeight: 1.15 }}>
                                    <input type="checkbox" checked={form.accepted} onChange={e => update('accepted', e.target.checked)} style={{ marginTop: 1 }} />
                                    <span style={{ textAlign: 'center', width: '100%', display: 'block' }}>
                                        Potwierdzam prawo do wykorzystania wizerunku i akceptuję{' '}
                                        <a href="https://aigrafka.pl/regulamin" target="_blank" rel="noreferrer" style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}>Regulamin</a>
                                        {' '}i{' '}
                                        <a href="https://aigrafka.pl/polityka-prywatnosci" target="_blank" rel="noreferrer" style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}>Politykę prywatności</a>
                                    </span>
                                </label>
                            </div>

                            <button
                                type="button"
                                onClick={handleGenerateMore}
                                style={{
                                    ...actionButtonStyle,
                                    width: '100%',
                                    padding: '9px 10px',
                                    background: canSubmit ? '#9b59ff' : '#b7b7b7',
                                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                                    boxShadow: 'none',
                                    borderRadius: 9,
                                    fontSize: 12
                                }}
                                disabled={!canSubmit || isLoading}
                            >
                                {isLoading ? 'Generowanie...' : 'Generuj kolejne stylizacje!'}
                            </button>
                        </div>

                        <div style={{ ...badge, marginTop: 12, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <div style={sectionTitleStyle}>Wybierz inny produkt</div>
                            </div>
                            <button
                                type="button"
                                onClick={handleChangeParams}
                                style={{
                                    ...actionButtonStyle,
                                    width: '100%',
                                    padding: '14px 12px',
                                    background: '#9b59ff',
                                    boxShadow: 'none'
                                }}
                            >
                                Zacznij od nowa
                            </button>
                        </div>
                    </div>
                )}

                {view === 'generating' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ ...badge, boxShadow: '0 10px 22px rgba(0,0,0,0.08)', padding: '10px 12px', borderRadius: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                                <div>
                                    <div style={{ color: '#7b48eb', fontWeight: 800, fontSize: 14, letterSpacing: 0.1, lineHeight: 1.1 }}>GENERUJEMY TWOJĄ STYLIZACJĘ</div>
                                    <div style={{ color: '#6f45cc', fontWeight: 700, fontSize: 12, marginTop: 2, lineHeight: 1.15 }}>Nie wyłączaj przeglądarki!</div>
                                    <div style={{ color: '#7d7d7d', fontSize: 11, marginTop: 2, lineHeight: 1.15 }}>Nie powinno to zająć więcej niż 30 sek</div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, marginTop: 2, flexShrink: 0, alignItems: 'center' }}>
                                    {[0, 1, 2].map(dot => {
                                        const active = waitingPulse === dot;
                                        return (
                                            <span
                                                key={dot}
                                                style={{
                                                    width: active ? 9 : 7,
                                                    height: active ? 9 : 7,
                                                    borderRadius: 999,
                                                    background: '#9b59ff',
                                                    opacity: active ? 1 : 0.35,
                                                    boxShadow: active ? '0 0 10px rgba(155,89,255,0.55)' : 'none',
                                                    transform: active ? 'translateY(-1px)' : 'translateY(0)',
                                                    transition: 'all 0.22s ease'
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {generationError ? (
                            <div style={{ ...badge, boxShadow: '0 10px 22px rgba(0,0,0,0.08)' }}>
                                <div style={{ color: '#8f1f1f', fontSize: 11, lineHeight: 1.3, textAlign: 'center', fontWeight: 700, marginBottom: 8 }}>
                                    {generationError}
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                        type="button"
                                        onClick={handleGenerateMore}
                                        style={{
                                            ...actionButtonStyle,
                                            flex: 1,
                                            padding: '9px 10px',
                                            background: canSubmit ? '#9b59ff' : '#b7b7b7',
                                            cursor: canSubmit ? 'pointer' : 'not-allowed',
                                            boxShadow: 'none',
                                            borderRadius: 8,
                                            fontSize: 12
                                        }}
                                        disabled={!canSubmit || isLoading}
                                    >
                                        Spróbuj ponownie
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setGenerationError(''); setView('form'); }}
                                        style={{
                                            ...actionButtonStyle,
                                            flex: 1,
                                            padding: '9px 10px',
                                            background: '#e2e2e2',
                                            color: '#1f1f1f',
                                            boxShadow: 'none',
                                            borderRadius: 8,
                                            fontSize: 12
                                        }}
                                    >
                                        Zacznij od nowa
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ ...badge, boxShadow: '0 10px 22px rgba(0,0,0,0.08)' }}>
                                <div style={{ color: '#5c5c5c', fontSize: 10, lineHeight: 1.25, textAlign: 'center' }}>
                                    Po zakończeniu generowania automatycznie przejdziesz do podglądu stylizacji.
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div style={{ textAlign: 'center', color: '#5b5b5b', fontSize: 9, marginTop: 4 }}>
                    <a href="https://aigrafka.pl" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>AIgrafka.pl</a>
                    {' | '}
                    <a href="https://aigrafka.pl/regulamin" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Regulamin</a>
                    {' | '}
                    <a href="https://aigrafka.pl/polityka-prywatnosci" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Polityka prywatności</a>
                    {' | '}
                    <a href="https://aigrafka.pl/kontakt" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Kontakt</a>
                </div>

            </div>

            {showAuthDialog && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(20,20,20,0.45)',
                        display: 'grid',
                        placeItems: 'center',
                        zIndex: 1000,
                        padding: 16
                    }}
                    onClick={closeAuthDialog}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="auth-dialog-title"
                        style={{
                            width: '100%',
                            maxWidth: 360,
                            background: '#e2e2e2',
                            border: '2px solid #bdbdbd',
                            borderRadius: 16,
                            boxShadow: '0 14px 30px rgba(0,0,0,0.24)',
                            padding: 14
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div id="auth-dialog-title" style={{ ...sectionTitleStyle, fontSize: 15 }}>Konto AIgrafka</div>
                            <button
                                type="button"
                                onClick={closeAuthDialog}
                                style={{
                                    ...actionButtonStyle,
                                    background: '#9b59ff',
                                    width: 34,
                                    height: 34,
                                    padding: 0,
                                    borderRadius: 10,
                                    boxShadow: 'none'
                                }}
                                disabled={authSubmitting}
                            >
                                ×
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                            <button
                                type="button"
                                onClick={() => setAuthMode('login')}
                                style={{
                                    ...actionButtonStyle,
                                    background: authMode === 'login' ? '#9b59ff' : '#b7b7b7',
                                    boxShadow: 'none',
                                    padding: '8px 12px',
                                    flex: 1
                                }}
                                disabled={authSubmitting}
                            >
                                Logowanie
                            </button>
                            <button
                                type="button"
                                onClick={() => setAuthMode('register')}
                                style={{
                                    ...actionButtonStyle,
                                    background: authMode === 'register' ? '#9b59ff' : '#b7b7b7',
                                    boxShadow: 'none',
                                    padding: '8px 12px',
                                    flex: 1
                                }}
                                disabled={authSubmitting}
                            >
                                Rejestracja
                            </button>
                        </div>

                        <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <input
                                style={inputStyle}
                                type="email"
                                placeholder="Email"
                                value={authEmail}
                                onChange={e => setAuthEmail(e.target.value)}
                                autoComplete="email"
                                disabled={authSubmitting}
                            />
                            <input
                                style={inputStyle}
                                type="password"
                                placeholder="Hasło (min. 6 znaków)"
                                value={authPassword}
                                onChange={e => setAuthPassword(e.target.value)}
                                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                                disabled={authSubmitting}
                            />

                            <button
                                type="submit"
                                style={{
                                    ...actionButtonStyle,
                                    background: '#9b59ff',
                                    boxShadow: 'none',
                                    padding: '10px 12px'
                                }}
                                disabled={authSubmitting}
                            >
                                {authSubmitting ? 'Trwa...' : authMode === 'register' ? 'Utwórz konto' : 'Zaloguj się'}
                            </button>

                            {googleClientId && (
                                <div
                                    style={{
                                        background: '#ffffff',
                                        border: '2px solid #c7c7c7',
                                        borderRadius: 999,
                                        padding: '6px 8px',
                                        display: 'grid',
                                        placeItems: 'center'
                                    }}
                                >
                                    {googleReady ? (
                                        <div ref={googleButtonRef} />
                                    ) : (
                                        <div style={{ fontSize: 13, fontWeight: 700, color: '#4b4b4b', padding: '6px 8px' }}>
                                            Ładowanie Google...
                                        </div>
                                    )}
                                </div>
                            )}
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
