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
    tokens: number;
    accepted: boolean;
}

type StorableKey = keyof Pick<FormState, 'height' | 'chest' | 'waist' | 'hips' | 'category' | 'productUrl'>;
type SavedFlags = Partial<Record<StorableKey, boolean>>;

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
    tokens: 5,
    accepted: false,
    ...initialMetrics
};

const apiBase = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000';
const storageKey = 'aigrafka-form';
const placeholderPreview = 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=900&q=80';
const placeholderSelfie = 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=70';

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
                <label
                    title="Zapamiętaj"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        background: '#0f6572',
                        borderRadius: 10,
                        cursor: 'pointer',
                        boxShadow: '0 0 0 1px rgba(255,255,255,0.08)'
                    }}
                >
                    <div
                        style={{
                            width: 18,
                            height: 18,
                            borderRadius: 6,
                            background: '#0f6572',
                            border: 'none',
                            display: 'grid',
                            placeItems: 'center'
                        }}
                        onClick={() => remember(rememberKey)}
                        role="checkbox"
                        aria-checked={Boolean(savedFlags?.[rememberKey])}
                        aria-label="Zapamiętaj"
                        tabIndex={0}
                        onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                remember(rememberKey);
                            }
                        }}
                    >
                        {savedFlags?.[rememberKey] ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 8.6 6.5 11 12 5" stroke="#f6f6f6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        ) : null}
                    </div>
                </label>
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

    const canSubmit = useMemo(() => form.accepted && form.tokens > 0 && !!form.productUrl, [form]);

    useEffect(() => {
        chrome.storage?.local.get([storageKey], result => {
            const stored = result?.[storageKey];
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

    function rememberField(key: StorableKey) {
        const nextValue = !savedFlags[key];
        setSavedFlags(prev => ({ ...prev, [key]: nextValue }));

        if (!chrome?.storage?.local) return;
        chrome.storage.local.get([storageKey], result => {
            const current = result?.[storageKey] ?? {};
            const updated = { ...current };
            if (nextValue) {
                updated[key] = form[key];
            } else {
                delete updated[key];
            }
            chrome.storage.local.set({ [storageKey]: updated });
        });
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        if (!canSubmit) return;

        setStatus('Przygotowujemy stylizację...');
        setIsLoading(true);
        setPreviewUrl('');

        const payload = {
            productUrl: form.productUrl,
            category: form.category,
            metrics: {
                height: form.height,
                chest: form.chest,
                waist: form.waist,
                hips: form.hips
            }
        };

        try {
            const response = await fetch(`${apiBase}/ai/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('API error');
            const data = await response.json();
            setPreviewUrl(data.imageUrl ?? placeholderPreview);
            setStatus(data.message ?? 'Wygenerowano podgląd.');
        } catch (error) {
            console.error(error);
            setPreviewUrl(placeholderPreview);
            setStatus('Tryb demo: używamy przykładowej stylizacji.');
        } finally {
            setIsLoading(false);
            setForm(prev => ({ ...prev, tokens: Math.max(prev.tokens - 1, 0) }));
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
        const text = form.productUrl || previewUrl || 'https://aigrafka.example';
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

    return (
        <div className="aigrafka-shell" style={{ display: 'flex', flexDirection: 'column' }}>
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
                                placeholder="https://sklep/..."
                                type="url"
                                required
                            />
                        </FieldRow>

                        <FieldRow label="Wzrost:" rememberKey="height" remember={rememberField} savedFlags={savedFlags}>
                            <input style={inputStyle} value={form.height} onChange={e => update('height', e.target.value)} />
                        </FieldRow>

                        <FieldRow label="Klatka piersiowa:" rememberKey="chest" remember={rememberField} savedFlags={savedFlags}>
                            <input style={inputStyle} value={form.chest} onChange={e => update('chest', e.target.value)} />
                        </FieldRow>

                        <FieldRow label="Talia:" rememberKey="waist" remember={rememberField} savedFlags={savedFlags}>
                            <input style={inputStyle} value={form.waist} onChange={e => update('waist', e.target.value)} />
                        </FieldRow>

                        <FieldRow label="Biodra:" rememberKey="hips" remember={rememberField} savedFlags={savedFlags}>
                            <input style={inputStyle} value={form.hips} onChange={e => update('hips', e.target.value)} />
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

                    <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 10, alignItems: 'stretch' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {[placeholderPreview, placeholderPreview, placeholderPreview, placeholderPreview].map((src, idx) => (
                                <div key={idx} style={{ width: '100%', aspectRatio: '3 / 4', borderRadius: 12, overflow: 'hidden', border: '2px solid #3b3b3b' }}>
                                    <img src={src} alt="mini" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                </div>
                            ))}
                        </div>

                        <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: '2px solid #3f3f3f', background: '#1a1a1a', minHeight: 360 }}>
                            {isLoading && (
                                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04))', animation: 'aigrafka-shimmer 1.4s linear infinite', zIndex: 2 }} />
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

                    <div style={{ marginTop: 12, background: '#f9f9f9', color: '#181818', borderRadius: 14, padding: '12px 14px', fontSize: 13, lineHeight: 1.5 }}>
                        Wyglądasz doskonale w tej stylizacji, szczególnie w sportowej scenerii. Jednak wybrany produkt nie pasuje do Twoich wymiarów. Zobacz podobne produkty w rozmiarze XXL na stronie tego sklepu.
                    </div>

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

                {status && (
                    <div style={{ marginTop: 4, background: '#2d2d2d', padding: '10px 12px', borderRadius: 12, fontSize: '13px', color: '#f0f0f0', border: '1px solid #373737' }}>
                        {status}
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
