import React, { useEffect, useState } from 'react';

interface PanelFooterProps {
    onDeleteMyData: () => Promise<void>;
}

const linkStyle: React.CSSProperties = { color: 'inherit', textDecoration: 'none' };
const CONFIRM_WINDOW_MS = 5000;

const PanelFooter: React.FC<PanelFooterProps> = ({ onDeleteMyData }) => {
    // Two-step confirmation inline: a native confirm() would block the host page.
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!confirming) return;
        const timeoutId = window.setTimeout(() => setConfirming(false), CONFIRM_WINDOW_MS);
        return () => window.clearTimeout(timeoutId);
    }, [confirming]);

    async function handleDeleteClick() {
        if (!confirming) {
            setConfirming(true);
            return;
        }
        setConfirming(false);
        setDeleting(true);
        try {
            await onDeleteMyData();
        } finally {
            setDeleting(false);
        }
    }

    return (
        <div style={{ textAlign: 'center', color: '#5b5b5b', fontSize: 9, marginTop: 4 }}>
            <a href="https://aigrafka.pl" target="_blank" rel="noreferrer" style={linkStyle}>
                AIgrafka.pl
            </a>
            {' | '}
            <a href="https://aigrafka.pl/regulamin" target="_blank" rel="noreferrer" style={linkStyle}>
                Regulamin
            </a>
            {' | '}
            <a href="https://aigrafka.pl/polityka-prywatnosci" target="_blank" rel="noreferrer" style={linkStyle}>
                Polityka prywatności
            </a>
            {' | '}
            <a href="https://aigrafka.pl/kontakt" target="_blank" rel="noreferrer" style={linkStyle}>
                Kontakt
            </a>
            {' | '}
            <button
                type="button"
                onClick={() => void handleDeleteClick()}
                disabled={deleting}
                style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    font: 'inherit',
                    color: confirming ? '#8f1f1f' : 'inherit',
                    fontWeight: confirming ? 700 : 400,
                    cursor: deleting ? 'wait' : 'pointer',
                }}
            >
                {deleting ? 'Usuwanie...' : confirming ? 'Na pewno? Kliknij ponownie' : 'Usuń moje dane'}
            </button>
        </div>
    );
};

export default PanelFooter;
