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
    productUrl: string;
    productImage1: File | null;
    productImage2: File | null;
    tokens: number;
    accepted: boolean;
    variantCount: number;
}

type StorableKey = keyof Pick<FormState, 'height' | 'chest' | 'waist' | 'hips' | 'category' | 'productUrl'>;
type SavedFlags = Partial<Record<StorableKey, boolean>>;
const storableKeys: StorableKey[] = ['height', 'chest', 'waist', 'hips', 'category', 'productUrl'];

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
    background: '#232323',
    color: '#f6f6f6',
    border: '1px solid #2f2f2f',
    borderRadius: '12px',
    padding: '10px 12px'
};

const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '9px 10px',
    background: '#d9d9d9',
    border: '1px solid #b9b9b9',
    borderRadius: 10,
    fontSize: '13px',
    color: '#1e1e1e'
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
    background: '#0097a7',
    color: '#f7f7f7',
    fontWeight: 700,
    border: 'none',
    padding: '12px 14px',
    cursor: 'pointer',
    borderRadius: 12,
    transition: 'transform 0.1s ease, box-shadow 0.2s ease'
};

const fieldLabelStyle: React.CSSProperties = {
    width: '90px',
    fontWeight: 700,
    fontSize: '12px',
    color: '#f7f7f7',
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
    async get(): Promise<Partial<FormState>> {
        if (chrome?.storage?.local) {
            return new Promise(resolve => {
                chrome.storage.local.get([storageKey], result => resolve(result?.[storageKey] ?? {}));
            });
        }
        try {
            const raw = localStorage.getItem(storageKey);
            return raw ? (JSON.parse(raw) as Partial<FormState>) : {};
        } catch (e) {
            return {};
        }
    },
    async set(data: Partial<FormState>): Promise<void> {
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

const PanelHeader = ({ logoSrc }: { logoSrc?: string }) => (
    <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 18px',
        background: 'linear-gradient(135deg, #2e2e2e, #1f1f1f)',
        borderBottom: '1px solid #2c2c2c'
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#f5f5f5', display: 'grid', placeItems: 'center', boxShadow: '0 6px 16px rgba(0,0,0,0.35)', overflow: 'hidden', border: '1px solid #dcdcdc' }}>
                {logoSrc ? (
                    <img src={logoSrc} alt="Aigrafka" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <span style={{ fontSize: '20px', color: '#7a0606' }}>A</span>
                )}
            </div>
            <div style={{ color: '#e9e323', fontSize: '24px', fontWeight: 800, letterSpacing: '0.2px' }}>Aigrafka</div>
        </div>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#7a0606', display: 'grid', placeItems: 'center', color: '#ffcf00', fontSize: '22px', boxShadow: '0 6px 16px rgba(0,0,0,0.35)' }}>🧵</div>
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
            {rememberKey && remember && (
                <button
                    type="button"
                    title="Zablokuj pole"
                    aria-pressed={Boolean(savedFlags?.[rememberKey])}
                    aria-label={savedFlags?.[rememberKey] ? 'Odblokuj zapamiętane pole' : 'Zablokuj i zapamiętaj pole'}
                    onClick={() => remember(rememberKey)}
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        borderRadius: 10,
                        cursor: 'pointer',
                        border: '1px solid #0a3b44',
                        background: savedFlags?.[rememberKey] ? '#0f8d9c' : '#0f6572',
                        boxShadow: '0 0 0 1px rgba(255,255,255,0.08)'
                    }}
                >
                    {savedFlags?.[rememberKey] ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="#f6f6f6" strokeWidth="2" strokeLinecap="round" />
                            <rect x="6" y="11" width="12" height="9" rx="2" stroke="#f6f6f6" strokeWidth="2" />
                            <path d="M12 14v3" stroke="#f6f6f6" strokeWidth="2" strokeLinecap="round" />
                            <circle cx="12" cy="13.5" r="0.6" fill="#f6f6f6" />
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M9 11V8a3 3 0 0 1 5.83-1" stroke="#f6f6f6" strokeWidth="2" strokeLinecap="round" />
                            <rect x="6" y="11" width="12" height="9" rx="2" stroke="#f6f6f6" strokeWidth="2" />
                            <path d="M12 14v3" stroke="#f6f6f6" strokeWidth="2" strokeLinecap="round" />
                            <circle cx="12" cy="13.5" r="0.6" fill="#f6f6f6" />
                        </svg>
                    )}
                </button>
            )}
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

    const canSubmit = useMemo(() => {
        const hasProduct = Boolean(form.productUrl) || Boolean(form.productImage1) || Boolean(form.productImage2);
        return form.accepted && form.tokens > 0 && hasProduct && !!form.selfie;
    }, [form]);

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

    // Auto-sync locked fields to storage whenever they change
    useEffect(() => {
        const toPersist: Partial<FormState> = {};
        storableKeys.forEach(k => {
            if (savedFlags[k]) {
                toPersist[k] = form[k];
            }
        });
        storage.set(toPersist);
    }, [form, savedFlags]);

    function rememberField(key: StorableKey) {
        const nextValue = !savedFlags[key];
        setSavedFlags(prev => ({ ...prev, [key]: nextValue }));

        storage.get().then(current => {
            const updated = { ...current } as Partial<FormState>;
            if (nextValue) {
                updated[key] = form[key];
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
            if (succeeded) {
                setForm(prev => ({ ...prev, tokens: Math.max(prev.tokens - 1, 0) }));
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
        await handleCopy();
    }

    async function handleCopy() {
        const text = form.productUrl || previewUrl || 'https://aigrafka.pl';
        try {
            await navigator.clipboard.writeText(text);
            setStatus('Skopiowano do schowka.');
        } catch (error) {
            console.error(error);
            setStatus('Nie udało się skopiować.');
        }
    }

    const canShare = Boolean(form.productUrl || previewUrl);
    const rememberedHint = 'Zapamiętaj zapisuje dane lokalnie w przeglądarce.';

    const logoSrc = chrome?.runtime?.getURL?.('icons/logo.svg') ?? logo;
    const activeVariant = variants[selectedVariant] || variants[0];

    return (
        <div className="aigrafka-shell" style={{ display: 'flex', flexDirection: 'column', background: '#181818', color: '#f5f5f5', height: '100%', width: '100%' }}>
            <PanelHeader logoSrc={logoSrc} />
            <div style={{ flex: 1, padding: '12px 12px 40px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <StatPill tokens={form.tokens} />

                <div style={{ ...badge, background: '#2f2f2f', border: '1px solid #3a3a3a', boxShadow: '0 12px 30px rgba(0,0,0,0.28)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ fontWeight: 800, color: '#f4f4f4' }}>Twoje dane</div>
                        <span style={{ fontSize: '12px', color: '#c7c7c7' }}>{rememberedHint}</span>
                    </div>

                    <form onSubmit={handleSubmit}>
                        <FieldRow label="Selfie:">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                                <div style={{ width: 72, height: 72, borderRadius: 12, overflow: 'hidden', border: '2px solid #4a4a4a', background: '#1c1c1c' }}>
                                    <img
                                        src={selfiePreview || placeholderSelfie}
                                        alt="Selfie"
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                    />
                                </div>
                                <label
                                    style={{
                                        ...actionButtonStyle,
                                        background: '#0f5763',
                                        color: '#f5f5f5',
                                        padding: '10px 12px',
                                        border: '1px solid #0a3b44',
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

                        <FieldRow label="Kategoria ubioru:" rememberKey="category" remember={rememberField} savedFlags={savedFlags}>
                            <input
                                style={inputStyle}
                                value={form.category}
                                onChange={e => update('category', e.target.value)}
                                placeholder="np. kurtka narciarska"
                            />
                        </FieldRow>

                        <FieldRow label="Link do produktu:" rememberKey="productUrl" remember={rememberField} savedFlags={savedFlags}>
                            <input
                                style={inputStyle}
                                value={form.productUrl}
                                onChange={e => update('productUrl', e.target.value)}
                                placeholder="https://reserved.com/... (opcjonalne jeśli wgrasz zdjęcia)"
                                type="url"
                            />
                        </FieldRow>

                        <div style={{ margin: '4px 0 10px', color: '#cfcfcf', fontSize: 12 }}>
                            Możesz podać link <strong>lub</strong> wgrać 1-2 zdjęcia produktu, aby przyspieszyć generowanie.
                        </div>

                        <FieldRow label="Zdjęcie produktu 1:">
                            <label
                                style={{
                                    ...actionButtonStyle,
                                    background: '#0f6572',
                                    color: '#f5f5f5',
                                    padding: '10px 12px',
                                    border: '1px solid #0a3b44',
                                    borderRadius: 10,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    minWidth: 140,
                                    justifyContent: 'center'
                                }}
                            >
                                <span>{form.productImage1 ? form.productImage1.name : 'Dodaj zdjęcie'}</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={e => update('productImage1', e.target.files?.[0] ?? null)}
                                    style={{ display: 'none' }}
                                />
                            </label>
                        </FieldRow>

                        <FieldRow label="Zdjęcie produktu 2:">
                            <label
                                style={{
                                    ...actionButtonStyle,
                                    background: '#0f6572',
                                    color: '#f5f5f5',
                                    padding: '10px 12px',
                                    border: '1px solid #0a3b44',
                                    borderRadius: 10,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    minWidth: 140,
                                    justifyContent: 'center'
                                }}
                            >
                                <span>{form.productImage2 ? form.productImage2.name : 'Dodaj zdjęcie'}</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={e => update('productImage2', e.target.files?.[0] ?? null)}
                                    style={{ display: 'none' }}
                                />
                            </label>
                        </FieldRow>

                        <FieldRow label="Warianty AI:">
                            <input
                                style={{ ...inputStyle, maxWidth: 120 }}
                                type="number"
                                min={1}
                                max={4}
                                value={form.variantCount}
                                onChange={e => update('variantCount', Math.min(4, Math.max(1, Number(e.target.value) || 1)))}
                            />
                        </FieldRow>

                        <FieldRow label="Wzrost:" rememberKey="height" remember={rememberField} savedFlags={savedFlags}>
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

                        <FieldRow label="Klatka piersiowa:" rememberKey="chest" remember={rememberField} savedFlags={savedFlags}>
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

                        <FieldRow label="Talia:" rememberKey="waist" remember={rememberField} savedFlags={savedFlags}>
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

                        <FieldRow label="Biodra:" rememberKey="hips" remember={rememberField} savedFlags={savedFlags}>
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

                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 10px', color: '#f5f5f5', fontSize: '13px' }}>
                            <input type="checkbox" checked={form.accepted} onChange={e => update('accepted', e.target.checked)} />
                            Akceptuję regulamin usługi i potwierdzam prawo do wykorzystania danych.
                        </label>

                        <button
                            type="submit"
                            style={{
                                ...actionButtonStyle,
                                width: '100%',
                                padding: '12px 10px',
                                background: canSubmit ? '#00b0ff' : '#5a5a5a',
                                cursor: canSubmit ? 'pointer' : 'not-allowed',
                                boxShadow: canSubmit ? '0 12px 28px rgba(0,176,255,0.25)' : 'none'
                            }}
                            disabled={!canSubmit || isLoading}
                        >
                            {isLoading ? 'Generowanie...' : 'Generuj stylizację'}
                        </button>
                    </form>
                </div>

                <div style={{ ...badge, background: '#2c2c2c', border: '1px solid #363636', boxShadow: '0 10px 26px rgba(0,0,0,0.24)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ fontWeight: 800, color: '#f3f3f3' }}>Podgląd stylizacji</div>
                        {isLoading && <span style={{ fontSize: 12, color: '#cfcfcf' }}>Renderowanie...</span>}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: '2px solid #3f3f3f', background: '#1a1a1a', minHeight: 360, aspectRatio: '3 / 4' }}>
                            {isLoading && (
                                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04))', animation: 'aigrafka-shimmer 1.4s linear infinite', zIndex: 2 }} />
                            )}
                            {activeVariant && (
                                <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.55)', color: '#f5f5f5', padding: '8px 10px', borderRadius: 12, fontSize: 12, border: '1px solid rgba(255,255,255,0.08)', zIndex: 3 }}>
                                    <span>{generationMeta.model ?? 'Gemini'}</span>
                                    {variants.length > 1 ? <span style={{ marginLeft: 8 }}>• {selectedVariant + 1}/{variants.length}</span> : null}
                                    {activeVariant?.latencyMs ? <span style={{ marginLeft: 8 }}>{Math.round(activeVariant.latencyMs)} ms</span> : null}
                                </div>
                            )}
                            <img
                                src={previewUrl || placeholderPreview}
                                alt="Wygenerowana stylizacja"
                                style={{ width: '100%', height: '100%', objectFit: 'cover', filter: isLoading ? 'blur(3px)' : 'none', opacity: isLoading ? 0.7 : 1 }}
                            />
                            {!isLoading && (
                                <div style={{ position: 'absolute', bottom: 14, left: 14, display: 'flex', gap: 10 }}>
                                    <button
                                        type="button"
                                        onClick={handleShare}
                                        disabled={!canShare}
                                        style={{
                                            ...actionButtonStyle,
                                            background: '#f5f5f5',
                                            color: '#111',
                                            padding: '12px 14px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            opacity: canShare ? 1 : 0.6
                                        }}
                                    >
                                        <span>Udostępnij</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCopy}
                                        style={{
                                            ...actionButtonStyle,
                                            background: '#0fb361',
                                            padding: '12px 14px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 8
                                        }}
                                    >
                                        <span>Do schowka</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {status ? (
                        <div style={{ marginTop: 12, background: '#f9f9f9', color: '#181818', borderRadius: 14, padding: '12px 14px', fontSize: 13, lineHeight: 1.5, boxShadow: '0 6px 14px rgba(0,0,0,0.08)' }}>
                            {status}
                        </div>
                    ) : null}

                    <button
                        type="button"
                        onClick={() => form.productUrl && window.open(form.productUrl, '_blank')}
                        style={{
                            ...actionButtonStyle,
                            background: '#00b0ff',
                            width: '100%',
                            marginTop: 10,
                            boxShadow: '0 12px 26px rgba(0,176,255,0.25)'
                        }}
                    >
                        Zobacz dopasowane produkty
                    </button>
                </div>

            </div>
        </div>
    );
};

export default App;
