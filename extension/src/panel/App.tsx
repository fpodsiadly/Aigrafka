import React, { useEffect, useMemo, useState } from 'react';
import logo from '../../icons/logo.svg';

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
    tokens: number;
    accepted: boolean;
    variantCount: number;
    modelChoice: 'banana' | 'banana-pro';
}

type StorableKey = keyof Pick<FormState, 'height' | 'chest' | 'waist' | 'hips' | 'category' | 'productUrl' | 'fitStyle' | 'modelChoice'>;
type SavedFlags = Partial<Record<StorableKey, boolean>>;
type Persistable = Pick<FormState, StorableKey>;
const storableKeys: StorableKey[] = ['height', 'chest', 'waist', 'hips', 'category', 'productUrl', 'fitStyle', 'modelChoice'];

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
}

interface VariantPreview {
    url: string;
    mimeType?: string;
    latencyMs?: number;
}

const initialMetrics: BodyMetrics = {
    height: '186',
    chest: '120',
    waist: '100',
    hips: '100'
};

const initialState: FormState = {
    selfie: null,
    category: 'Komplet dresowy',
    fitStyle: 'masculine',
    modelChoice: 'banana',
    productUrl: '',
    productImage1: null,
    productImage2: null,
    tokens: 5,
    accepted: false,
    variantCount: 2,
    ...initialMetrics
};

const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000';
const storageKey = 'aigrafka-form-v2';
const placeholderPreview = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80';
const placeholderSelfie = 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=70';
const REQUEST_TIMEOUT_MS = 70_000; // Render free tier cold start can be slow; give more headroom

const badge = {
    background: '#e2e2e2',
    color: '#1f1f1f',
    border: '2px solid #bdbdbd',
    borderRadius: '14px',
    padding: '12px 14px'
};

const sectionTitleStyle: React.CSSProperties = {
    fontWeight: 800,
    fontSize: '14px',
    color: '#1c1c1c'
};

const sectionHintStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#4b4b4b'
};

const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '9px 10px',
    background: '#ffffff',
    border: '2px solid #c7c7c7',
    borderRadius: 10,
    fontSize: '13px',
    color: '#1e1e1e'
};

const dropZoneStyle: React.CSSProperties = {
    border: '2px dashed #b8b8b8',
    borderRadius: 12,
    padding: '10px',
    background: '#f2f2f2',
    color: '#2a2a2a',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    justifyContent: 'space-between'
};

const validReserved = (url: string) => {
    try {
        const u = new URL(url);
        return u.hostname.endsWith('reserved.com');
    } catch (e) {
        return false;
    }
};

const actionButtonStyle: React.CSSProperties = {
    background: '#9b59ff',
    color: '#ffffff',
    fontWeight: 700,
    border: 'none',
    padding: '12px 14px',
    cursor: 'pointer',
    borderRadius: 12,
    transition: 'transform 0.1s ease, box-shadow 0.2s ease'
};

const fieldLabelStyle: React.CSSProperties = {
    width: '110px',
    fontWeight: 700,
    fontSize: '12px',
    color: '#1e1e1e',
    lineHeight: 1.2
};

const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px'
};

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

function toDataUrl(base64: string | null, mimeType?: string | null): string {
    if (!base64) return '';
    const mime = mimeType || 'image/jpeg';
    return `data:${mime};base64,${base64}`;
}

const PanelHeader = ({
    logoSrc,
    loggedIn,
    onLogin,
    onLogout
}: {
    logoSrc?: string;
    loggedIn: boolean;
    onLogin: () => void;
    onLogout: () => void;
}) => (
    <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        background: '#d9d9d9',
        borderBottom: '2px solid #bdbdbd'
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#ffffff', display: 'grid', placeItems: 'center', overflow: 'hidden', border: '2px solid #bfbfbf' }}>
                {logoSrc ? (
                    <img src={logoSrc} alt="Aigrafka" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <span style={{ fontSize: '20px', color: '#7a0606' }}>A</span>
                )}
            </div>
            <div style={{ color: '#1b1b1b', fontSize: '24px', fontWeight: 800, letterSpacing: '0.2px' }}>Aigrafka</div>
        </div>
        <button
            type="button"
            onClick={loggedIn ? onLogout : onLogin}
            style={{
                ...actionButtonStyle,
                background: loggedIn ? '#d9a1c5' : '#9b59ff',
                color: '#ffffff',
                padding: '10px 14px',
                borderRadius: 10,
                boxShadow: 'none'
            }}
        >
            {loggedIn ? 'Wyloguj się' : 'Rejestracja'}
        </button>
    </div>
);

const StatPill = ({ tokens }: { tokens: number }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...badge }}>
        <span style={{ fontWeight: 700, color: '#e5e5e5' }}>Tokeny stylizacji:</span>
        <span style={{ background: '#00b943', color: '#0f1a0f', fontWeight: 800, padding: '6px 10px', borderRadius: 8, minWidth: 40, textAlign: 'center' }}>{tokens}</span>
        <button
            style={{ ...actionButtonStyle, background: '#00e676', color: '#0f2e17', padding: '10px 12px', boxShadow: '0 8px 20px rgba(0,230,118,0.25)' }}
            onClick={() => chrome.runtime?.sendMessage?.({ type: 'OPEN_CHECKOUT' })}
        >
            Dokup tokeny
        </button>
    </div>
);

const FieldRow = ({
    label,
    children,
    rememberKey,
    remember,
    savedFlags
}: {
    label: string;
    children: React.ReactNode;
    rememberKey?: StorableKey;
    remember?: (key: StorableKey) => void;
    savedFlags?: SavedFlags;
}) => (
    <div style={rowStyle}>
        <div style={fieldLabelStyle}>{label}</div>
        <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, justifyContent: 'space-between' }}>
            <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
    </div>
);

const App: React.FC = () => {
    const [form, setForm] = useState<FormState>(initialState);
    const [status, setStatus] = useState<string>('');
    const [previewUrl, setPreviewUrl] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [savedFlags, setSavedFlags] = useState<SavedFlags>({});
    const [selfiePreview, setSelfiePreview] = useState<string>('');
    const [variants, setVariants] = useState<VariantPreview[]>([]);
    const [selectedVariant, setSelectedVariant] = useState<number>(0);
    const [generationMeta, setGenerationMeta] = useState<{ model?: string; latencyMs?: number }>({});
    const [auth, setAuth] = useState<{ loggedIn: boolean; tokens: number }>({ loggedIn: false, tokens: 0 });
    const [view, setView] = useState<'form' | 'result'>('form');
    const [showMeasurements, setShowMeasurements] = useState<boolean>(false);

    const canSubmit = useMemo(() => {
        const hasProduct = Boolean(form.productUrl) || Boolean(form.productImage1) || Boolean(form.productImage2);
        const hasSelfie = !!form.selfie;
        if (!form.accepted || !hasProduct || !hasSelfie) return false;
        return auth.loggedIn ? auth.tokens > 0 : true;
    }, [form, auth]);

    const hasSelfie = Boolean(form.selfie);
    const hasProduct = Boolean(form.productUrl) || Boolean(form.productImage1) || Boolean(form.productImage2);

    useEffect(() => {
        storage.get().then(stored => {
            if (stored) {
                setForm(prev => ({ ...prev, ...stored }));
                const marks = Object.keys(stored).reduce<SavedFlags>((acc, key) => ({
                    ...acc,
                    [key as StorableKey]: true
                }), {});
                setSavedFlags(marks);
            }
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

    function update<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm(prev => ({ ...prev, [key]: value }));
    }

    function handleLogin() {
        setAuth({ loggedIn: true, tokens: 5 });
        setStatus('Zalogowano (demo).');
    }

    function handleLogout() {
        setAuth({ loggedIn: false, tokens: 0 });
        setStatus('Wylogowano.');
    }

    function handleTopUpTokens() {
        setAuth(prev => ({ ...prev, tokens: prev.tokens + 10 }));
        setStatus('Dodano 10 tokenów (demo).');
    }

    function getModelCostText() {
        return form.modelChoice === 'banana-pro' ? 'BLIK: 1,00 zł (Banana Pro)' : 'BLIK: 0,50 zł (Banana)';
    }

    const measurementSummary = `${form.height || '-'} / ${form.chest || '-'} / ${form.waist || '-'} / ${form.hips || '-'} cm`;

    async function handlePayBlik() {
        // Placeholder for real payment integration
        setStatus(`Opłata ${getModelCostText()} (symulacja BLIK)...`);
    }

    // Auto-sync locked fields to storage whenever they change
    useEffect(() => {
        const toPersist: Partial<Persistable> = {};
        storableKeys.forEach(k => {
            if (savedFlags[k]) {
                (toPersist as any)[k] = form[k];
            }
        });
        storage.set(toPersist);
    }, [form, savedFlags]);

    function rememberField(key: StorableKey) {
        const nextValue = !savedFlags[key];
        setSavedFlags(prev => ({ ...prev, [key]: nextValue }));

        storage.get().then(current => {
            const updated = { ...current } as Partial<Persistable>;
            if (nextValue) {
                (updated as any)[key] = form[key];
            } else {
                delete updated[key];
            }
            storage.set(updated);
        });
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!canSubmit || !form.selfie) return;

        const hasProduct = Boolean(form.productUrl) || Boolean(form.productImage1) || Boolean(form.productImage2);
        if (!hasProduct) {
            setStatus('Podaj link z reserved.com lub wgraj zdjęcie produktu (1-2).');
            return;
        }

        if (form.productUrl && !validReserved(form.productUrl)) {
            setStatus('Podaj link z domeny reserved.com.');
            return;
        }

        if (auth.loggedIn && auth.tokens <= 0) {
            setStatus('Brak tokenów. Dokup tokeny, aby kontynuować.');
            return;
        }

        if (!auth.loggedIn) {
            await handlePayBlik();
        }

        setView('result');

        setStatus('Przygotowujemy stylizację...');
        setIsLoading(true);
        setPreviewUrl('');
        setVariants([]);
        setSelectedVariant(0);
        setGenerationMeta({});

        const startedAt = performance.now();

        const formData = new FormData();
        if (form.productUrl) {
            formData.append('product_url', form.productUrl);
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
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let succeeded = false;

        try {
            const response = await fetch(`${apiBase}/generate`, {
                method: 'POST',
                body: formData,
                signal: controller.signal
            });

            if (!response.ok) {
                const text = await response.text();
                let message = text || 'API error';
                try {
                    const parsed = JSON.parse(text);
                    if (parsed?.detail) message = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
                } catch (e) {
                    /* ignore parse */
                }
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
            console.log('[Aigrafka] render complete', {
                total_s: Number((totalMs / 1000).toFixed(2)),
                backend_s: backendMs !== null ? Number((backendMs / 1000).toFixed(2)) : null,
                variants: normalizedVariants.length,
                model: data.model ?? 'unknown'
            });

            const variantCount = normalizedVariants.length || 1;
            const latencyText = normalizedVariants[0]?.latencyMs ? ` • ${Math.round(normalizedVariants[0].latencyMs)} ms` : '';
            const modelText = data.model ? ` • ${data.model}` : '';
            if (isFallback) {
                setStatus(`Generacja nie powiodła się (model: ${data.model ?? 'brak'}). Sprawdź klucz/model i spróbuj ponownie.`);
                succeeded = false;
                setPreviewUrl(placeholderPreview);
                setVariants([]);
            } else {
                setStatus(`Wygenerowano (${variantCount} wariant${variantCount === 1 ? '' : 'y'})${modelText}${latencyText}`);
                succeeded = true;
            }
        } catch (error) {
            console.error(error);
            const message = error instanceof DOMException && error.name === 'AbortError'
                ? 'Przekroczono limit czasu (70s). Backend może się wybudzać (Render free), spróbuj ponownie.'
                : error instanceof Error
                    ? error.message || 'Nie udało się wygenerować podglądu.'
                    : 'Nie udało się wygenerować podglądu.';
            setPreviewUrl(placeholderPreview);
            setStatus(message);
        } finally {
            clearTimeout(timeoutId);
            setIsLoading(false);
            if (succeeded && auth.loggedIn) {
                setAuth(prev => ({ ...prev, tokens: Math.max(prev.tokens - 1, 0) }));
            }
        }
    }

    async function handleShare() {
        const target = form.productUrl || previewUrl;
        try {
            if (navigator.share) {
                await navigator.share({ title: 'Przymierzator', url: target });
                setStatus('Link udostępniony.');
                return;
            }
        } catch (error) {
            console.error(error);
        }
        await handleCopyLink();
    }

    async function handleCopyLink() {
        const text = form.productUrl || previewUrl || 'https://aigrafka.pl';
        try {
            await navigator.clipboard.writeText(text);
            setStatus('Link skopiowany do schowka.');
        } catch (error) {
            console.error(error);
            setStatus('Nie udało się skopiować linku.');
        }
    }

    async function handleCopyImage() {
        const target = activeVariant?.url || previewUrl || placeholderPreview;
        if (!target) {
            setStatus('Brak obrazu do skopiowania.');
            return;
        }

        try {
            const response = await fetch(target);
            const blob = await response.blob();
            const mimeType = blob.type || activeVariant?.mimeType || 'image/png';
            await navigator.clipboard.write([
                new ClipboardItem({ [mimeType]: blob })
            ]);
            setStatus('Obraz skopiowany do schowka.');
        } catch (error) {
            console.error(error);
            try {
                await navigator.clipboard.writeText(target);
                setStatus('Nie udało się skopiować obrazu, skopiowano adres.');
            } catch (textError) {
                console.error(textError);
                setStatus('Nie udało się skopiować.');
            }
        }
    }

    function displayFileName(file: File | null, fallback: string) {
        if (!file) return fallback;
        const name = file.name;
        return name.length > 10 ? `${name.slice(0, 10)}…` : name;
    }

    function handleFileSelect(key: 'productImage1' | 'productImage2', file: File | null) {
        update(key, file);
        if (file) {
            setStatus(`Dodano ${file.name}`);
        }
    }

    async function handleDropProduct(key: 'productImage1' | 'productImage2', event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();
        const dt = event.dataTransfer;

        if (dt.files && dt.files.length > 0) {
            handleFileSelect(key, dt.files[0]);
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

    function handleChangeParams() {
        setView('form');
        setStatus('Zmień parametry i wygeneruj ponownie.');
        setTimeout(() => {
            const formEl = document.querySelector('form');
            formEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
    }

    const canShare = Boolean(form.productUrl || previewUrl);
    const logoSrc = chrome?.runtime?.getURL?.('icons/logo.svg') ?? logo;
    const activeVariant = variants[selectedVariant] || variants[0];
    const mainImage = activeVariant?.url || previewUrl || placeholderPreview;

    useEffect(() => {
        if (selectedVariant > 0 && selectedVariant >= variants.length) {
            setSelectedVariant(0);
        }
    }, [variants, selectedVariant]);

    return (
        <div className="aigrafka-shell" style={{ display: 'flex', flexDirection: 'column', background: '#dcdcdc', color: '#1e1e1e', height: '100%', width: '100%' }}>
            <PanelHeader logoSrc={logoSrc} loggedIn={auth.loggedIn} onLogin={handleLogin} onLogout={handleLogout} />
            <div style={{ flex: 1, padding: '14px 14px 140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {view === 'form' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#1c1c1c' }}>Witaj! Co dziś przymierzymy?</div>
                        <div style={sectionHintStyle}>Uzupełnij dane, dodaj produkt i wygeneruj stylizację.</div>
                    </div>
                )}

                {view === 'form' && (
                    <div style={{ ...badge, boxShadow: '0 10px 22px rgba(0,0,0,0.08)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={sectionTitleStyle}>Twoje dane</div>
                                <span style={{ width: 16, height: 16, borderRadius: 6, background: '#8bb0d6', color: '#ffffff', fontSize: 11, display: 'grid', placeItems: 'center', fontWeight: 800 }}>i</span>
                            </div>
                        </div>

                        <form id="aigrafka-form" onSubmit={handleSubmit}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <div style={{ fontWeight: 700, color: '#1e1e1e' }}>Twoje wymiary</div>
                                    <div style={{ fontWeight: 800, color: '#1e1e1e' }}>{measurementSummary}</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowMeasurements(prev => !prev)}
                                    style={{
                                        ...actionButtonStyle,
                                        background: '#9b59ff',
                                        padding: '8px 12px',
                                        borderRadius: 10,
                                        boxShadow: 'none'
                                    }}
                                    aria-expanded={showMeasurements}
                                >
                                    {showMeasurements ? 'Schowaj wymiary' : 'Zmień wymiary'}
                                </button>
                            </div>

                            {showMeasurements && (
                                <>
                                    <FieldRow label="Wzrost:">
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <input
                                                style={{ ...inputStyle, paddingRight: 36 }}
                                                value={form.height}
                                                onChange={e => update('height', e.target.value)}
                                                inputMode="numeric"
                                            />
                                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#4d4d4d', fontWeight: 700, fontSize: 12 }}>cm</span>
                                        </div>
                                    </FieldRow>

                                    <FieldRow label="Klatka piersiowa:">
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <input
                                                style={{ ...inputStyle, paddingRight: 36 }}
                                                value={form.chest}
                                                onChange={e => update('chest', e.target.value)}
                                                inputMode="numeric"
                                            />
                                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#4d4d4d', fontWeight: 700, fontSize: 12 }}>cm</span>
                                        </div>
                                    </FieldRow>

                                    <FieldRow label="Talia:">
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <input
                                                style={{ ...inputStyle, paddingRight: 36 }}
                                                value={form.waist}
                                                onChange={e => update('waist', e.target.value)}
                                                inputMode="numeric"
                                            />
                                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#4d4d4d', fontWeight: 700, fontSize: 12 }}>cm</span>
                                        </div>
                                    </FieldRow>

                                    <FieldRow label="Biodra:">
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <input
                                                style={{ ...inputStyle, paddingRight: 36 }}
                                                value={form.hips}
                                                onChange={e => update('hips', e.target.value)}
                                                inputMode="numeric"
                                            />
                                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#4d4d4d', fontWeight: 700, fontSize: 12 }}>cm</span>
                                        </div>
                                    </FieldRow>
                                </>
                            )}
                            <FieldRow label="Selfie:">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                                    <div style={{ width: 72, height: 72, borderRadius: 12, overflow: 'hidden', border: '2px solid #bdbdbd', background: '#f0f0f0' }}>
                                        <img
                                            src={selfiePreview || placeholderSelfie}
                                            alt="Selfie"
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                    </div>
                                    <label
                                        style={{
                                            ...actionButtonStyle,
                                            background: '#9b59ff',
                                            color: '#ffffff',
                                            padding: '10px 12px',
                                            border: '2px solid #7f3bff',
                                            borderRadius: 10,
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            minWidth: 120,
                                            justifyContent: 'center'
                                        }}
                                    >
                                        <span>{form.selfie ? 'Zmień selfie' : 'Dodaj selfie'}</span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={e => update('selfie', e.target.files?.[0] ?? null)}
                                            style={{ display: 'none' }}
                                        />
                                    </label>
                                </div>
                            </FieldRow>

                            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={sectionTitleStyle}>Wybrany produkt</div>
                                <span style={{ width: 16, height: 16, borderRadius: 6, background: '#8bb0d6', color: '#ffffff', fontSize: 11, display: 'grid', placeItems: 'center', fontWeight: 800 }}>i</span>
                            </div>

                            <FieldRow label="Link do produktu:">
                                <input
                                    style={inputStyle}
                                    value={form.productUrl}
                                    onChange={e => update('productUrl', e.target.value)}
                                    placeholder="https://reserved.com/..."
                                    type="url"
                                />
                            </FieldRow>

                            <FieldRow label="Kategoria produktu:">
                                <input
                                    style={inputStyle}
                                    value={form.category}
                                    onChange={e => update('category', e.target.value)}
                                    placeholder="np. kurtka"
                                />
                            </FieldRow>

                            <FieldRow label="Zdjęcia produktu:">
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <div
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={e => handleDropProduct('productImage1', e)}
                                    >
                                        <label
                                            style={{
                                                ...actionButtonStyle,
                                                background: '#9b59ff',
                                                color: '#ffffff',
                                                padding: '8px 12px',
                                                border: '2px solid #7f3bff',
                                                borderRadius: 10,
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                minWidth: 120,
                                                justifyContent: 'center',
                                                fontSize: 12
                                            }}
                                        >
                                            + Dodaj pierwsze
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={e => handleFileSelect('productImage1', e.target.files?.[0] ?? null)}
                                                style={{ display: 'none' }}
                                            />
                                        </label>
                                    </div>
                                    <div
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={e => handleDropProduct('productImage2', e)}
                                    >
                                        <label
                                            style={{
                                                ...actionButtonStyle,
                                                background: '#9b59ff',
                                                color: '#ffffff',
                                                padding: '8px 12px',
                                                border: '2px solid #7f3bff',
                                                borderRadius: 10,
                                                fontWeight: 700,
                                                cursor: 'pointer',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                minWidth: 120,
                                                justifyContent: 'center',
                                                fontSize: 12
                                            }}
                                        >
                                            + Dodaj drugie
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={e => handleFileSelect('productImage2', e.target.files?.[0] ?? null)}
                                                style={{ display: 'none' }}
                                            />
                                        </label>
                                    </div>
                                </div>
                            </FieldRow>

                            <details style={{ marginTop: 8, background: '#ededed', borderRadius: 12, border: '2px solid #c7c7c7', padding: '8px 10px' }}>
                                <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#2a2a2a' }}>Ustawienia AI</summary>
                                <div style={{ marginTop: 8 }}>
                                    <FieldRow label="Styl kroju:">
                                        <select
                                            style={{ ...inputStyle, paddingRight: 10 }}
                                            value={form.fitStyle}
                                            onChange={e => update('fitStyle', e.target.value as FormState['fitStyle'])}
                                        >
                                            <option value="masculine">Męski</option>
                                            <option value="feminine">Damski</option>
                                            <option value="unisex">Unisex</option>
                                        </select>
                                    </FieldRow>

                                    <FieldRow label="Model AI:">
                                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                                <input
                                                    type="radio"
                                                    name="modelChoice"
                                                    value="banana"
                                                    checked={form.modelChoice === 'banana'}
                                                    onChange={e => update('modelChoice', e.target.value as FormState['modelChoice'])}
                                                />
                                                <span>Banana</span>
                                            </label>
                                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                                <input
                                                    type="radio"
                                                    name="modelChoice"
                                                    value="banana-pro"
                                                    checked={form.modelChoice === 'banana-pro'}
                                                    onChange={e => update('modelChoice', e.target.value as FormState['modelChoice'])}
                                                />
                                                <span>Banana Pro</span>
                                            </label>
                                        </div>
                                    </FieldRow>
                                </div>
                            </details>

                            <div style={{ background: '#ededed', border: '2px solid #c7c7c7', borderRadius: 12, padding: '10px 12px', margin: '14px 0 10px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#1e1e1e', fontSize: '13px' }}>
                                    <input type="checkbox" checked={form.accepted} onChange={e => update('accepted', e.target.checked)} />
                                    Potwierdzam prawo do wykorzystania wizerunku i akceptuję Regulamin i Politykę Prywatności.
                                </label>
                            </div>
                        </form>
                    </div>

                )}

                {view === 'form' && (
                    <div style={{ ...badge, boxShadow: '0 8px 18px rgba(0,0,0,0.08)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={sectionTitleStyle}>{auth.loggedIn ? 'Tokeny Stylizacji' : 'Płatność jednorazowa'}</div>
                            <span style={sectionHintStyle}>{auth.loggedIn ? 'Bank tokenów' : 'BLIK per generacja'}</span>
                        </div>
                        {auth.loggedIn ? (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                                <div style={{ background: '#ffffff', border: '2px solid #c7c7c7', borderRadius: 10, padding: '8px 12px', fontWeight: 800, minWidth: 64, textAlign: 'center' }}>{auth.tokens}</div>
                                <button
                                    type="button"
                                    onClick={handleTopUpTokens}
                                    style={{ ...actionButtonStyle, background: '#9b59ff', boxShadow: 'none', padding: '10px 14px' }}
                                >
                                    Dokup tokeny
                                </button>
                            </div>
                        ) : (
                            <div style={{ marginTop: 10, fontSize: 13, color: '#2a2a2a' }}>
                                Jednorazowa płatność: <strong>{getModelCostText()}</strong>
                            </div>
                        )}
                    </div>
                )}

                {view === 'form' && (
                    <div style={{ ...badge, boxShadow: '0 8px 18px rgba(0,0,0,0.08)' }}>
                        <div style={sectionTitleStyle}>Liczba stylizacji</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                            <button
                                type="button"
                                onClick={() => update('variantCount', Math.max(1, form.variantCount - 1))}
                                style={{ ...actionButtonStyle, background: '#9b59ff', width: 44, padding: '8px 0', boxShadow: 'none' }}
                            >
                                −
                            </button>
                            <input
                                style={{ ...inputStyle, maxWidth: 80, textAlign: 'center' }}
                                type="number"
                                min={1}
                                max={4}
                                value={form.variantCount}
                                onChange={e => update('variantCount', Math.min(4, Math.max(1, Number(e.target.value) || 1)))}
                            />
                            <button
                                type="button"
                                onClick={() => update('variantCount', Math.min(4, form.variantCount + 1))}
                                style={{ ...actionButtonStyle, background: '#9b59ff', width: 44, padding: '8px 0', boxShadow: 'none' }}
                            >
                                +
                            </button>
                        </div>
                    </div>
                )}

                {view === 'result' && (
                    <div style={{ ...badge, boxShadow: '0 10px 22px rgba(0,0,0,0.08)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div style={sectionTitleStyle}>Twoja stylizacja</div>
                            {isLoading && <span style={sectionHintStyle}>Renderowanie...</span>}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'start' }}>
                            <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: '2px solid #9b59ff', background: '#f2f2f2', minHeight: 360, aspectRatio: '3 / 4' }}>
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {variants.map((variant, idx) => (
                                        <button
                                            key={variant.url}
                                            type="button"
                                            onClick={() => setSelectedVariant(idx)}
                                            style={{
                                                border: idx === selectedVariant ? '2px solid #9b59ff' : '2px solid #c7c7c7',
                                                borderRadius: 10,
                                                padding: 2,
                                                background: '#ffffff',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <img src={variant.url} alt={`Wariant ${idx + 1}`} style={{ width: 66, height: 88, objectFit: 'cover', borderRadius: 6 }} />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                            <button
                                type="button"
                                onClick={handleShare}
                                disabled={!canShare}
                                style={{
                                    ...actionButtonStyle,
                                    background: '#9b59ff',
                                    padding: '12px 14px',
                                    flex: 1,
                                    opacity: canShare ? 1 : 0.6
                                }}
                            >
                                Udostępnij
                            </button>
                            <button
                                type="button"
                                onClick={handleCopyImage}
                                style={{
                                    ...actionButtonStyle,
                                    background: '#9b59ff',
                                    padding: '12px 14px',
                                    flex: 1
                                }}
                            >
                                Kopiuj
                            </button>
                            <button
                                type="button"
                                onClick={handleCopyLink}
                                style={{
                                    ...actionButtonStyle,
                                    background: '#9b59ff',
                                    padding: '12px 14px',
                                    width: 48
                                }}
                            >
                                !
                            </button>
                        </div>

                        {status ? (
                            <div style={{ marginTop: 12, background: '#ffffff', color: '#1e1e1e', borderRadius: 14, padding: '10px 12px', fontSize: 13, border: '2px solid #c7c7c7' }}>
                                {status}
                            </div>
                        ) : null}

                        <div style={{ ...badge, marginTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <div style={sectionTitleStyle}>Generuj więcej stylizacji tego produktu</div>
                                <span style={{ width: 16, height: 16, borderRadius: 6, background: '#8bb0d6', color: '#ffffff', fontSize: 11, display: 'grid', placeItems: 'center', fontWeight: 800 }}>i</span>
                            </div>
                            {auth.loggedIn ? (
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                                    <div style={{ background: '#ffffff', border: '2px solid #c7c7c7', borderRadius: 10, padding: '8px 12px', fontWeight: 800, minWidth: 64, textAlign: 'center' }}>{auth.tokens}</div>
                                    <button
                                        type="button"
                                        onClick={handleTopUpTokens}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', boxShadow: 'none', padding: '10px 14px' }}
                                    >
                                        Dokup tokeny
                                    </button>
                                </div>
                            ) : (
                                <div style={{ marginBottom: 10, fontSize: 13, color: '#2a2a2a' }}>
                                    Jednorazowa płatność: <strong>{getModelCostText()}</strong>
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                                <button
                                    type="button"
                                    onClick={() => update('variantCount', Math.max(1, form.variantCount - 1))}
                                    style={{ ...actionButtonStyle, background: '#9b59ff', width: 44, padding: '8px 0', boxShadow: 'none' }}
                                >
                                    −
                                </button>
                                <input
                                    style={{ ...inputStyle, maxWidth: 80, textAlign: 'center' }}
                                    type="number"
                                    min={1}
                                    max={4}
                                    value={form.variantCount}
                                    onChange={e => update('variantCount', Math.min(4, Math.max(1, Number(e.target.value) || 1)))}
                                />
                                <button
                                    type="button"
                                    onClick={() => update('variantCount', Math.min(4, form.variantCount + 1))}
                                    style={{ ...actionButtonStyle, background: '#9b59ff', width: 44, padding: '8px 0', boxShadow: 'none' }}
                                >
                                    +
                                </button>
                            </div>

                            <div style={{ background: '#ededed', border: '2px solid #c7c7c7', borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#1e1e1e', fontSize: '13px' }}>
                                    <input type="checkbox" checked={form.accepted} onChange={e => update('accepted', e.target.checked)} />
                                    Potwierdzam prawo do wykorzystania wizerunku i akceptuję Regulamin i Politykę Prywatności.
                                </label>
                            </div>

                            <button
                                type="submit"
                                form="aigrafka-form"
                                style={{
                                    ...actionButtonStyle,
                                    width: '100%',
                                    padding: '14px 12px',
                                    background: canSubmit ? '#9b59ff' : '#b7b7b7',
                                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                                    boxShadow: 'none'
                                }}
                                disabled={!canSubmit || isLoading}
                            >
                                Generuj kolejne stylizacje!
                            </button>
                        </div>

                        <div style={{ ...badge, marginTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <div style={sectionTitleStyle}>Wybierz inny produkt</div>
                                <span style={{ width: 16, height: 16, borderRadius: 6, background: '#8bb0d6', color: '#ffffff', fontSize: 11, display: 'grid', placeItems: 'center', fontWeight: 800 }}>i</span>
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

            </div>
            {view === 'form' && (
                <div style={{ position: 'sticky', bottom: 0, left: 0, right: 0, padding: '12px 12px 16px', background: '#dcdcdc', borderTop: '2px solid #bdbdbd' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#1e1e1e', fontSize: 12 }}>
                            <span>{auth.loggedIn ? `Tokeny: ${auth.tokens}` : `Koszt: ${getModelCostText()}`}</span>
                            <span>{form.variantCount} stylizacje</span>
                        </div>
                        <button
                            type="submit"
                            form="aigrafka-form"
                            style={{
                                ...actionButtonStyle,
                                width: '100%',
                                padding: '14px 12px',
                                background: canSubmit ? '#9b59ff' : '#b7b7b7',
                                cursor: canSubmit ? 'pointer' : 'not-allowed',
                                boxShadow: 'none'
                            }}
                            disabled={!canSubmit || isLoading}
                        >
                            {isLoading ? 'Generowanie...' : 'Generuj stylizację'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
