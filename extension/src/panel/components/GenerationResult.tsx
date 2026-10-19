import React from 'react';

import { FormState } from '../types';
import { AuthState } from '../../store/appStore';
import { actionButtonStyle, badge, inputStyle, sectionHintStyle, sectionTitleStyle } from '../styles';
import { placeholderPreview } from '../utils';

interface GenerationResultProps {
    view: 'form' | 'generating' | 'result';
    isLoading: boolean;
    generationError: string;
    elapsedSec: number;
    waitingPulse: number;
    variants: { url: string; mimeType?: string; latencyMs?: number }[];
    selectedVariant: number;
    previewUrl: string;
    generationMeta: { model?: string; latencyMs?: number };
    status: string;
    statusTone: 'success' | 'error';
    form: FormState;
    auth: AuthState;
    canSubmit: boolean;
    canShare: boolean;
    onVariantSelect: (index: number) => void;
    onGenerateMore: () => void;
    onChangeParams: () => void;
    onShare: () => void;
    onCopyImage: () => void;
    onDownload: () => void;
    onAcceptedChange: (accepted: boolean) => void;
    onVariantCountChange: (count: number) => void;
    onTopUp: () => void;
    onLogin: () => void;
}

const GenerationResult: React.FC<GenerationResultProps> = ({
    view,
    isLoading,
    generationError,
    elapsedSec,
    waitingPulse,
    variants,
    selectedVariant,
    previewUrl,
    generationMeta,
    status,
    statusTone,
    form,
    auth,
    canSubmit,
    canShare,
    onVariantSelect,
    onGenerateMore,
    onChangeParams,
    onShare,
    onCopyImage,
    onDownload,
    onAcceptedChange,
    onVariantCountChange,
    onTopUp,
    onLogin,
}) => {
    const activeVariant = variants[selectedVariant] || variants[0];
    const mainImage = activeVariant?.url || previewUrl || placeholderPreview;
    // With async generation the first variant is shown while the rest render.
    const isRenderingMainImage = isLoading && !activeVariant;
    const pendingVariants = Math.max(0, form.variantCount - variants.length);

    if (view === 'generating') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ ...badge, boxShadow: '0 10px 22px rgba(0,0,0,0.08)', padding: '10px 12px', borderRadius: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                        <div>
                            {generationError ? (
                                <div style={{ color: '#8f1f1f', fontWeight: 800, fontSize: 14, letterSpacing: 0.1, lineHeight: 1.1 }}>
                                    BŁĄD GENEROWANIA
                                </div>
                            ) : (
                                <>
                                    <div style={{ color: '#7b48eb', fontWeight: 800, fontSize: 14, letterSpacing: 0.1, lineHeight: 1.1 }}>
                                        GENERUJEMY TWOJĄ STYLIZACJĘ
                                    </div>
                                    <div style={{ color: '#6f45cc', fontWeight: 700, fontSize: 12, marginTop: 2, lineHeight: 1.15 }}>
                                        Nie wyłączaj przeglądarki!
                                    </div>
                                    <div style={{ color: '#7d7d7d', fontSize: 11, marginTop: 2, lineHeight: 1.15 }}>
                                        {elapsedSec > 0 ? `Trwa generowanie... ${elapsedSec}s` : 'Zazwyczaj zajmuje 30–90 sekund'}
                                    </div>
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 2, flexShrink: 0, alignItems: 'center' }}>
                            {[0, 1, 2].map((dot) => {
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
                                            transition: 'all 0.22s ease',
                                        }}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </div>

                {generationError ? (
                    <div style={{ ...badge, boxShadow: '0 10px 22px rgba(0,0,0,0.08)' }}>
                        <div
                            style={{
                                color: '#8f1f1f',
                                fontSize: 11,
                                lineHeight: 1.3,
                                textAlign: 'center',
                                fontWeight: 700,
                                marginBottom: 8,
                            }}
                        >
                            {generationError}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <button
                                type="button"
                                onClick={onGenerateMore}
                                style={{
                                    ...actionButtonStyle,
                                    flex: 1,
                                    padding: '9px 10px',
                                    background: canSubmit ? '#9b59ff' : '#b7b7b7',
                                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                                    boxShadow: 'none',
                                    borderRadius: 8,
                                    fontSize: 12,
                                }}
                                disabled={!canSubmit || isLoading}
                            >
                                Spróbuj ponownie
                            </button>
                            <button
                                type="button"
                                onClick={onChangeParams}
                                style={{
                                    ...actionButtonStyle,
                                    flex: 1,
                                    padding: '9px 10px',
                                    background: '#e2e2e2',
                                    color: '#1f1f1f',
                                    boxShadow: 'none',
                                    borderRadius: 8,
                                    fontSize: 12,
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
        );
    }

    if (view !== 'result') return null;

    return (
        <div style={{ ...badge, boxShadow: '0 10px 22px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={sectionTitleStyle}>Twoja stylizacja</div>
                {isLoading && (
                    <span style={sectionHintStyle}>
                        {isRenderingMainImage || pendingVariants === 0
                            ? 'Renderowanie...'
                            : `Generuję kolejne warianty (${variants.length}/${form.variantCount})...`}
                    </span>
                )}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div
                    style={{
                        position: 'relative',
                        borderRadius: 16,
                        overflow: 'hidden',
                        border: '2px solid #9b59ff',
                        background: '#f2f2f2',
                        aspectRatio: '3 / 4',
                        flex: 1,
                        minWidth: 0,
                    }}
                >
                    {isRenderingMainImage && (
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                background: 'linear-gradient(120deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
                                animation: 'aigrafka-shimmer 1.4s linear infinite',
                                zIndex: 2,
                            }}
                        />
                    )}
                    <img
                        src={mainImage}
                        alt="Wygenerowana stylizacja"
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            filter: isRenderingMainImage ? 'blur(3px)' : 'none',
                            opacity: isRenderingMainImage ? 0.7 : 1,
                        }}
                    />
                </div>

                {variants.length > 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 36, flex: '0 0 36px' }}>
                        {variants.map((variant, idx) => (
                            <button
                                key={`${variant.url}-${idx}`}
                                type="button"
                                onClick={() => onVariantSelect(idx)}
                                style={{
                                    border: idx === selectedVariant ? '2px solid #9b59ff' : '2px solid #c7c7c7',
                                    borderRadius: 8,
                                    padding: 1,
                                    background: '#ffffff',
                                    cursor: 'pointer',
                                    width: '100%',
                                }}
                            >
                                <img
                                    src={variant.url}
                                    alt={`Wariant ${idx + 1}`}
                                    style={{ width: '100%', height: 48, objectFit: 'cover', borderRadius: 5, display: 'block' }}
                                />
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                    type="button"
                    onClick={onShare}
                    disabled={!canShare}
                    style={{
                        ...actionButtonStyle,
                        background: '#9b59ff',
                        padding: '10px 12px',
                        flex: 1,
                        opacity: canShare ? 1 : 0.6,
                    }}
                >
                    Udostępnij
                </button>
                <button
                    type="button"
                    onClick={onCopyImage}
                    style={{
                        ...actionButtonStyle,
                        background: '#9b59ff',
                        padding: '10px 12px',
                        flex: 1,
                    }}
                >
                    Kopiuj
                </button>
                <button
                    type="button"
                    onClick={onDownload}
                    aria-label="Pobierz wygenerowaną stylizację"
                    style={{
                        ...actionButtonStyle,
                        background: '#9b59ff',
                        padding: '10px 12px',
                        flex: 1,
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
                        padding: '8px 10px',
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
                    <div style={{ ...sectionTitleStyle, fontSize: 10, marginBottom: 0, letterSpacing: 0 }}>
                        Generuj więcej stylizacji tego produktu
                    </div>
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
                            lineHeight: 1,
                        }}
                    >
                        i
                    </span>
                </div>
                {auth.loggedIn ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <div
                            style={{
                                flex: 1,
                                minWidth: 0,
                                fontWeight: 700,
                                color: '#1e1e1e',
                                fontSize: 11,
                                minHeight: 26,
                                display: 'flex',
                                alignItems: 'center',
                                lineHeight: 1,
                            }}
                        >
                            Tokeny Stylizacji
                        </div>
                        <input
                            style={{ ...inputStyle, width: 58, textAlign: 'center', padding: '4px 6px', fontSize: 12, minHeight: 26 }}
                            value={auth.tokens}
                            readOnly
                        />
                        <button
                            type="button"
                            onClick={onTopUp}
                            style={{
                                ...actionButtonStyle,
                                background: '#9b59ff',
                                boxShadow: 'none',
                                padding: '6px 10px',
                                fontSize: 10,
                                borderRadius: 8,
                                width: 96,
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                            }}
                        >
                            Dokup tokeny
                        </button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <div
                            style={{
                                flex: 1,
                                minWidth: 0,
                                fontWeight: 700,
                                color: '#1e1e1e',
                                fontSize: 11,
                                minHeight: 26,
                                display: 'flex',
                                alignItems: 'center',
                                lineHeight: 1,
                            }}
                        >
                            Tokeny Stylizacji
                        </div>
                        <button
                            type="button"
                            onClick={onLogin}
                            style={{
                                ...actionButtonStyle,
                                background: '#9b59ff',
                                boxShadow: 'none',
                                padding: '6px 10px',
                                fontSize: 10,
                                borderRadius: 9,
                                flexShrink: 0,
                                whiteSpace: 'nowrap',
                            }}
                        >
                            Zaloguj się
                        </button>
                    </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <div
                        style={{
                            flex: 1,
                            minWidth: 0,
                            fontWeight: 700,
                            color: '#1e1e1e',
                            fontSize: 11,
                            minHeight: 26,
                            display: 'flex',
                            alignItems: 'center',
                            lineHeight: 1,
                        }}
                    >
                        Liczba Stylizacji
                    </div>
                    <input
                        style={{ ...inputStyle, width: 58, textAlign: 'center', padding: '4px 6px', fontSize: 12, minHeight: 26 }}
                        type="number"
                        min={1}
                        max={3}
                        value={form.variantCount}
                        onChange={(e) => onVariantCountChange(Math.min(3, Math.max(1, Number(e.target.value) || 1)))}
                    />
                    <div style={{ display: 'flex', gap: 4, width: 96, flexShrink: 0 }}>
                        <button
                            type="button"
                            onClick={() => onVariantCountChange(Math.max(1, form.variantCount - 1))}
                            style={{
                                ...actionButtonStyle,
                                background: '#9b59ff',
                                flex: 1,
                                padding: '4px 0',
                                boxShadow: 'none',
                                borderRadius: 9,
                                fontSize: 13,
                            }}
                        >
                            −
                        </button>
                        <button
                            type="button"
                            onClick={() => onVariantCountChange(Math.min(3, form.variantCount + 1))}
                            style={{
                                ...actionButtonStyle,
                                background: '#9b59ff',
                                flex: 1,
                                padding: '4px 0',
                                boxShadow: 'none',
                                borderRadius: 9,
                                fontSize: 13,
                            }}
                        >
                            +
                        </button>
                    </div>
                </div>

                <div style={{ background: '#ededed', border: '1px solid #c7c7c7', borderRadius: 8, padding: '6px 8px', marginBottom: 8 }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: '#1e1e1e', fontSize: '10px', lineHeight: 1.15 }}>
                        <input
                            type="checkbox"
                            checked={form.accepted}
                            onChange={(e) => onAcceptedChange(e.target.checked)}
                            style={{ marginTop: 1 }}
                        />
                        <span style={{ textAlign: 'center', width: '100%', display: 'block' }}>
                            Potwierdzam prawo do wykorzystania wizerunku i akceptuję{' '}
                            <a
                                href="https://aigrafka.pl/regulamin"
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}
                            >
                                Regulamin
                            </a>
                            {' '}i{' '}
                            <a
                                href="https://aigrafka.pl/polityka-prywatnosci"
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}
                            >
                                Politykę prywatności
                            </a>
                        </span>
                    </label>
                </div>

                <button
                    type="button"
                    onClick={onGenerateMore}
                    style={{
                        ...actionButtonStyle,
                        width: '100%',
                        padding: '9px 10px',
                        background: canSubmit ? '#9b59ff' : '#b7b7b7',
                        cursor: canSubmit ? 'pointer' : 'not-allowed',
                        boxShadow: 'none',
                        borderRadius: 9,
                        fontSize: 12,
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
                    onClick={onChangeParams}
                    style={{
                        ...actionButtonStyle,
                        width: '100%',
                        padding: '14px 12px',
                        background: '#9b59ff',
                        boxShadow: 'none',
                    }}
                >
                    Zacznij od nowa
                </button>
            </div>
        </div>
    );
};

export default GenerationResult;
