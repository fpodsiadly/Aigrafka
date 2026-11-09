import React, { useEffect, useState } from 'react';

import { getPack } from '../api';
import { PURCHASE_DIGITAL_CONTENT_CONSENT, PURCHASE_TERMS_CONSENT, TokenPack, describePack } from '../purchase';
import { actionButtonStyle, sectionTitleStyle } from '../styles';

interface PurchaseDialogProps {
    open: boolean;
    submitting: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

const consentLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 11,
    lineHeight: 1.35,
    color: '#1e1e1e',
    marginBottom: 8,
};

const PurchaseDialog: React.FC<PurchaseDialogProps> = ({ open, submitting, onConfirm, onClose }) => {
    const [pack, setPack] = useState<TokenPack | null>(null);
    const [packError, setPackError] = useState('');
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [digitalContentAccepted, setDigitalContentAccepted] = useState(false);

    useEffect(() => {
        if (!open) return;
        // Consents are given per purchase, never remembered.
        setTermsAccepted(false);
        setDigitalContentAccepted(false);
        setPackError('');
        getPack()
            .then(setPack)
            .catch(() => setPackError('Nie udało się pobrać ceny pakietu. Spróbuj ponownie.'));
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !submitting) onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, submitting, onClose]);

    if (!open) return null;

    const canPay = Boolean(pack) && termsAccepted && digitalContentAccepted && !submitting;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(20,20,20,0.45)',
                display: 'grid',
                placeItems: 'center',
                zIndex: 1000,
                padding: 16,
            }}
            onClick={() => !submitting && onClose()}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="purchase-dialog-title"
                style={{
                    width: '100%',
                    maxWidth: 360,
                    background: '#e2e2e2',
                    border: '2px solid #bdbdbd',
                    borderRadius: 16,
                    boxShadow: '0 14px 30px rgba(0,0,0,0.24)',
                    padding: 14,
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div id="purchase-dialog-title" style={{ ...sectionTitleStyle, fontSize: 15, marginBottom: 8 }}>
                    Dokup tokeny
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: '#1e1e1e' }}>
                    {pack ? describePack(pack) : packError || 'Pobieranie ceny...'}
                </p>

                <label style={consentLabelStyle}>
                    <input
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(e) => setTermsAccepted(e.target.checked)}
                        style={{ marginTop: 2 }}
                    />
                    <span>{PURCHASE_TERMS_CONSENT}</span>
                </label>
                <label style={consentLabelStyle}>
                    <input
                        type="checkbox"
                        checked={digitalContentAccepted}
                        onChange={(e) => setDigitalContentAccepted(e.target.checked)}
                        style={{ marginTop: 2 }}
                    />
                    <span>{PURCHASE_DIGITAL_CONTENT_CONSENT}</span>
                </label>

                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        style={{
                            ...actionButtonStyle,
                            flex: 1,
                            padding: '9px 10px',
                            background: '#d0d0d0',
                            color: '#1f1f1f',
                            boxShadow: 'none',
                            borderRadius: 8,
                            fontSize: 12,
                        }}
                    >
                        Anuluj
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={!canPay}
                        style={{
                            ...actionButtonStyle,
                            flex: 1,
                            padding: '9px 10px',
                            background: canPay ? '#9b59ff' : '#b7b7b7',
                            cursor: canPay ? 'pointer' : 'not-allowed',
                            boxShadow: 'none',
                            borderRadius: 8,
                            fontSize: 12,
                        }}
                    >
                        {submitting ? 'Przekierowanie...' : 'Przejdź do płatności'}
                    </button>
                </div>
                <div style={{ marginTop: 8, fontSize: 10, color: '#5b5b5b', textAlign: 'center' }}>
                    Płatność obsługuje Przelewy24.
                </div>
            </div>
        </div>
    );
};

export default PurchaseDialog;
