import React from 'react';

import { actionButtonStyle, sectionTitleStyle } from '../styles';

interface AuthPanelProps {
    showAuthDialog: boolean;
    authSubmitting: boolean;
    demoAccessEnabled: boolean;
    onCloseDialog: () => void;
    onGoogleLogin: () => void;
    onDemoAccess: () => void;
}

const AuthPanel: React.FC<AuthPanelProps> = ({
    showAuthDialog,
    authSubmitting,
    demoAccessEnabled,
    onCloseDialog,
    onGoogleLogin,
    onDemoAccess,
}) => {
    if (!showAuthDialog) return null;

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
            onClick={onCloseDialog}
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
                    padding: 14,
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div id="auth-dialog-title" style={{ ...sectionTitleStyle, fontSize: 15 }}>
                        Konto AIgrafka
                    </div>
                    <button
                        type="button"
                        onClick={onCloseDialog}
                        style={{
                            ...actionButtonStyle,
                            background: '#9b59ff',
                            width: 34,
                            height: 34,
                            padding: 0,
                            borderRadius: 10,
                            boxShadow: 'none',
                        }}
                        disabled={authSubmitting}
                    >
                        ×
                    </button>
                </div>

                <div style={{ color: '#4b4b4b', fontSize: 12, lineHeight: 1.45, marginBottom: 12 }}>
                    Logowanie i utworzenie konta odbywa się przez Google.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button
                        type="button"
                        onClick={onGoogleLogin}
                        style={{
                            ...actionButtonStyle,
                            background: '#ffffff',
                            color: '#3c4043',
                            border: '1px solid #dadce0',
                            boxShadow: 'none',
                            padding: '10px 12px',
                        }}
                        disabled={authSubmitting}
                    >
                        {authSubmitting ? 'Logowanie...' : 'Kontynuuj z Google'}
                    </button>

                    {demoAccessEnabled && (
                        <button
                            type="button"
                            onClick={onDemoAccess}
                            style={{
                                ...actionButtonStyle,
                                background: '#4f7f68',
                                boxShadow: 'none',
                                padding: '9px 12px',
                            }}
                            disabled={authSubmitting}
                        >
                            Wypróbuj w trybie demo
                        </button>
                    )}

                    {demoAccessEnabled && (
                        <div style={{ color: '#5b5b5b', fontSize: 10, lineHeight: 1.35, textAlign: 'center' }}>
                            Bez rejestracji i płatności. Dane demo nie są zapisywane na koncie.
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default AuthPanel;
