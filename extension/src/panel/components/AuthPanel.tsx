import React from 'react';

import { actionButtonStyle, inputStyle, sectionTitleStyle } from '../styles';

interface AuthPanelProps {
    showAuthDialog: boolean;
    authMode: 'login' | 'register';
    authEmail: string;
    authPassword: string;
    authSubmitting: boolean;
    demoAccessEnabled: boolean;
    googleClientId: string | null;
    googleReady: boolean;
    googleInitialized: boolean;
    googleButtonRef: React.RefObject<HTMLDivElement>;
    onCloseDialog: () => void;
    onToggleMode: (mode: 'login' | 'register') => void;
    onEmailChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onSubmit: (event: React.FormEvent) => void;
    onDemoAccess: () => void;
}

const AuthPanel: React.FC<AuthPanelProps> = ({
    showAuthDialog,
    authMode,
    authEmail,
    authPassword,
    authSubmitting,
    demoAccessEnabled,
    googleClientId,
    googleReady,
    googleInitialized,
    googleButtonRef,
    onCloseDialog,
    onToggleMode,
    onEmailChange,
    onPasswordChange,
    onSubmit,
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

                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button
                        type="button"
                        onClick={() => onToggleMode('login')}
                        style={{
                            ...actionButtonStyle,
                            background: authMode === 'login' ? '#9b59ff' : '#b7b7b7',
                            boxShadow: 'none',
                            padding: '8px 12px',
                            flex: 1,
                        }}
                        disabled={authSubmitting}
                    >
                        Logowanie
                    </button>
                    <button
                        type="button"
                        onClick={() => onToggleMode('register')}
                        style={{
                            ...actionButtonStyle,
                            background: authMode === 'register' ? '#9b59ff' : '#b7b7b7',
                            boxShadow: 'none',
                            padding: '8px 12px',
                            flex: 1,
                        }}
                        disabled={authSubmitting}
                    >
                        Rejestracja
                    </button>
                </div>

                <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                        style={inputStyle}
                        type="email"
                        placeholder="Email"
                        value={authEmail}
                        onChange={(e) => onEmailChange(e.target.value)}
                        autoComplete="email"
                        disabled={authSubmitting}
                    />
                    <input
                        style={inputStyle}
                        type="password"
                        placeholder="Hasło (min. 6 znaków)"
                        value={authPassword}
                        onChange={(e) => onPasswordChange(e.target.value)}
                        autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                        disabled={authSubmitting}
                    />

                    <button
                        type="submit"
                        style={{
                            ...actionButtonStyle,
                            background: '#9b59ff',
                            boxShadow: 'none',
                            padding: '10px 12px',
                        }}
                        disabled={authSubmitting}
                    >
                        {authSubmitting ? 'Trwa...' : authMode === 'register' ? 'Utwórz konto' : 'Zaloguj się'}
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

                    {googleClientId && (
                        <div
                            style={{
                                background: '#ffffff',
                                border: '2px solid #c7c7c7',
                                borderRadius: 999,
                                padding: '6px 8px',
                                display: 'grid',
                                placeItems: 'center',
                            }}
                        >
                            {googleReady && googleInitialized ? (
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
    );
};

export default AuthPanel;
