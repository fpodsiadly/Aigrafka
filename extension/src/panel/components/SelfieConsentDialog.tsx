import React, { useEffect } from 'react';

import { actionButtonStyle, sectionTitleStyle } from '../styles';

// TODO: replace with the final, approved consent text.
export const SELFIE_CONSENT_TITLE = 'Zgoda na wykorzystanie zdjęcia';
export const SELFIE_CONSENT_TEXT =
    '[Tekst zgody do uzupełnienia] Zanim dodasz zdjęcie, potwierdź, że jest to Twój wizerunek lub masz zgodę ' +
    'osoby na zdjęciu na jego wykorzystanie do wygenerowania wirtualnej przymiarki.';

interface SelfieConsentDialogProps {
    open: boolean;
    onAccept: () => void;
    onCancel: () => void;
}

const SelfieConsentDialog: React.FC<SelfieConsentDialogProps> = ({ open, onAccept, onCancel }) => {
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, onCancel]);

    if (!open) return null;

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
            onClick={onCancel}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="selfie-consent-title"
                aria-describedby="selfie-consent-text"
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
                <div id="selfie-consent-title" style={{ ...sectionTitleStyle, fontSize: 15, marginBottom: 8 }}>
                    {SELFIE_CONSENT_TITLE}
                </div>
                <p id="selfie-consent-text" style={{ margin: '0 0 12px', fontSize: 12, lineHeight: 1.4, color: '#1e1e1e' }}>
                    {SELFIE_CONSENT_TEXT}
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                    <button
                        type="button"
                        onClick={onCancel}
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
                        onClick={onAccept}
                        autoFocus
                        style={{
                            ...actionButtonStyle,
                            flex: 1,
                            padding: '9px 10px',
                            background: '#9b59ff',
                            boxShadow: 'none',
                            borderRadius: 8,
                            fontSize: 12,
                        }}
                    >
                        Akceptuję
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SelfieConsentDialog;
