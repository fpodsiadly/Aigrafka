import React from 'react';

import { actionButtonStyle } from '../styles';

const PanelHeader = React.memo(({
    logoSrc,
    loggedIn,
    userEmail,
    onLogin,
    onLogout
}: {
    logoSrc?: string;
    loggedIn: boolean;
    userEmail?: string;
    onLogin: () => void;
    onLogout: () => void;
}) => (
    <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        background: '#d9d9d9',
        borderBottom: '2px solid #bdbdbd'
    }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#ffffff', display: 'grid', placeItems: 'center', overflow: 'hidden', border: '2px solid #bfbfbf' }}>
                {logoSrc ? (
                    <img src={logoSrc} alt="AIgrafka" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <span style={{ fontSize: '20px', color: '#7a0606' }}>A</span>
                )}
            </div>
            <div style={{ color: '#1b1b1b', fontSize: '18px', fontWeight: 700, letterSpacing: '0.1px' }}>AIgrafka</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, minWidth: 0 }}>
            <button
                type="button"
                onClick={loggedIn ? onLogout : onLogin}
                style={{
                    ...actionButtonStyle,
                    background: loggedIn ? '#d9a1c5' : '#9b59ff',
                    color: '#ffffff',
                    padding: '7px 10px',
                    borderRadius: 10,
                    boxShadow: 'none'
                }}
            >
                {loggedIn ? 'Wyloguj się' : 'Zaloguj się'}
            </button>
            {loggedIn && userEmail && (
                <div
                    title={userEmail}
                    style={{
                        fontSize: 10,
                        color: '#4b4b4b',
                        maxWidth: 170,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}
                >
                    {userEmail === 'demo@aigrafka.local' ? 'Tryb demo' : `Zalogowano: ${userEmail}`}
                </div>
            )}
        </div>
    </div>
));

PanelHeader.displayName = 'PanelHeader';

export default PanelHeader;
