import React, { useMemo, useState } from 'react';

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

const fieldLabelStyle: React.CSSProperties = {
    width: '120px',
    fontWeight: 700,
    fontSize: '13px',
    color: '#f7f7f7',
    lineHeight: 1.2
};

const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '10px 12px',
    background: '#d9d9d9',
    border: 'none',
    fontSize: '14px'
};

const actionButtonStyle: React.CSSProperties = {
    background: '#0097a7',
    color: '#f7f7f7',
    fontWeight: 700,
    border: 'none',
    padding: '14px 16px',
    cursor: 'pointer'
};

const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '10px'
};

const PanelHeader = () => (
    <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: '#3c3c3c',
        borderBottom: '1px solid #2e2e2e'
    }}>
        <div style={{ color: '#d7d913', fontSize: '24px', fontWeight: 700 }}>Przymierzator</div>
        <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#7a0606', display: 'grid', placeItems: 'center', color: '#ffcf00', fontSize: '22px' }}>🧵</div>
    </div>
);

const StatPill = ({ tokens }: { tokens: number }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, color: '#f5f5f5' }}>Tokeny przymiarki:</span>
        <span style={{ background: '#00b943', color: '#0f1a0f', fontWeight: 800, padding: '6px 10px', borderRadius: 6 }}>{tokens}</span>
        <button style={{ ...actionButtonStyle, background: '#00e676', color: '#093311', padding: '8px 10px' }} onClick={() => chrome.runtime?.sendMessage?.({ type: 'OPEN_CHECKOUT' })}>
            Dokup tokeny
        </button>
    </div>
);

const App: React.FC = () => {
    const [form, setForm] = useState<FormState>(initialState);
    const [status, setStatus] = useState<string>('');
    const [previewUrl, setPreviewUrl] = useState<string>('');
    const canSubmit = useMemo(() => form.accepted && form.tokens > 0 && !!form.productUrl, [form]);

    function update<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm(prev => ({ ...prev, [key]: value }));
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setStatus('Trwa generowanie stylizacji...');

        try {
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

            const response = await fetch(`${apiBase}/ai/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('API error');
            const data = await response.json();
            setPreviewUrl(data.imageUrl ?? '');
            setStatus(data.message ?? 'Wygenerowano podgląd.');
        } catch (error) {
            console.error(error);
            setStatus('Nie udało się wygenerować stylizacji.');
        }
    }

    return (
        <div className="aigrafka-shell" style={{ display: 'flex', flexDirection: 'column' }}>
            <PanelHeader />
            <div style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
                <StatPill tokens={form.tokens} />

                <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
                    <div style={{ ...rowStyle }}>
                        <div style={fieldLabelStyle}>Selfie:</div>
                        <input style={inputStyle} type="file" accept="image/*" onChange={e => update('selfie', e.target.files?.[0] ?? null)} />
                    </div>

                    <div style={rowStyle}>
                        <div style={fieldLabelStyle}>Kategoria ubioru:</div>
                        <input style={inputStyle} value={form.category} onChange={e => update('category', e.target.value)} placeholder="np. kurtka narciarska" />
                    </div>

                    <div style={rowStyle}>
                        <div style={fieldLabelStyle}>Link do produktu:</div>
                        <input style={inputStyle} value={form.productUrl} onChange={e => update('productUrl', e.target.value)} placeholder="https://sklep/..." />
                    </div>

                    <div style={rowStyle}>
                        <div style={fieldLabelStyle}>Wzrost:</div>
                        <input style={inputStyle} value={form.height} onChange={e => update('height', e.target.value)} />
                    </div>

                    <div style={rowStyle}>
                        <div style={fieldLabelStyle}>Klatka piersiowa:</div>
                        <input style={inputStyle} value={form.chest} onChange={e => update('chest', e.target.value)} />
                    </div>

                    <div style={rowStyle}>
                        <div style={fieldLabelStyle}>Brzuch:</div>
                        <input style={inputStyle} value={form.waist} onChange={e => update('waist', e.target.value)} />
                    </div>

                    <div style={rowStyle}>
                        <div style={fieldLabelStyle}>Biodra:</div>
                        <input style={inputStyle} value={form.hips} onChange={e => update('hips', e.target.value)} />
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0', color: '#f5f5f5', fontSize: '13px' }}>
                        <input type="checkbox" checked={form.accepted} onChange={e => update('accepted', e.target.checked)} />
                        Akceptuję regulamin usługi i potwierdzam prawo do wykorzystania danych.
                    </label>

                    <button type="submit" style={{ ...actionButtonStyle, width: '100%', padding: '14px 12px', background: canSubmit ? '#00b0ff' : '#5a5a5a', cursor: canSubmit ? 'pointer' : 'not-allowed' }} disabled={!canSubmit}>
                        Generuj stylizację
                    </button>
                </form>

                {status && (
                    <div style={{ marginTop: 12, background: '#2d2d2d', padding: '10px 12px', borderRadius: 10, fontSize: '13px' }}>
                        {status}
                    </div>
                )}

                {previewUrl && (
                    <div style={{ marginTop: 12 }}>
                        <img src={previewUrl} alt="Wygenerowana stylizacja" style={{ width: '100%', borderRadius: 14 }} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
