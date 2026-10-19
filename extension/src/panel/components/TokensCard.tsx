import React from 'react';

import { AuthState } from '../../store/appStore';
import { actionButtonStyle, badge, inputStyle } from '../styles';

interface TokensCardProps {
    auth: AuthState;
    isLoading: boolean;
    demoAccessEnabled: boolean;
    variantCount: number;
    accepted: boolean;
    onTopUp: () => void;
    onLogin: () => void;
    onDemoAccess: () => void;
    onVariantCountChange: (count: number) => void;
    onAcceptedChange: (accepted: boolean) => void;
}

const rowLabelStyle: React.CSSProperties = {
    flex: '0 0 110px',
    maxWidth: '110px',
    fontWeight: 800,
    fontSize: 12,
    color: '#1e1e1e',
    lineHeight: 1.2,
};

const clampVariantCount = (count: number) => Math.min(3, Math.max(1, count));

const TokensCard: React.FC<TokensCardProps> = ({
    auth,
    isLoading,
    demoAccessEnabled,
    variantCount,
    accepted,
    onTopUp,
    onLogin,
    onDemoAccess,
    onVariantCountChange,
    onAcceptedChange,
}) => (
    <div style={{ ...badge, boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={rowLabelStyle}>Tokeny Stylizacji</div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                {auth.loggedIn ? (
                    <>
                        <input
                            style={{
                                ...inputStyle,
                                width: 70,
                                minWidth: 70,
                                textAlign: 'center',
                                padding: '6px 8px',
                                background: '#dcecd6',
                                borderColor: '#c5d9bf',
                            }}
                            value={auth.userId === 'demo' ? 'demo' : auth.tokens}
                            readOnly
                        />
                        {auth.userId === 'demo' ? (
                            <div style={{ flex: 1, fontSize: 10, fontWeight: 700, color: '#4f7f68', textAlign: 'center' }}>
                                Tryb demo
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={onTopUp}
                                disabled={isLoading}
                                style={{
                                    ...actionButtonStyle,
                                    background: isLoading ? '#b7a0e8' : '#9b59ff',
                                    boxShadow: 'none',
                                    padding: '7px 9px',
                                    fontSize: 10,
                                    flex: 1,
                                    cursor: isLoading ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {isLoading ? '...' : 'Dokup tokeny'}
                            </button>
                        )}
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={onLogin}
                            style={{ ...actionButtonStyle, flex: 1, padding: '7px 9px', fontSize: 10, background: '#9b59ff', boxShadow: 'none' }}
                        >
                            Zaloguj się
                        </button>
                        {demoAccessEnabled && (
                            <button
                                type="button"
                                onClick={onDemoAccess}
                                style={{ ...actionButtonStyle, flex: 1, padding: '7px 9px', fontSize: 10, background: '#4f7f68', boxShadow: 'none' }}
                            >
                                Tryb demo
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>

        <div style={{ height: 1, background: '#c7c7c7', margin: '8px 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={rowLabelStyle}>Liczba Stylizacji</div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                    style={{ ...inputStyle, flex: 1, textAlign: 'center', padding: '6px 8px' }}
                    type="number"
                    min={1}
                    max={3}
                    value={variantCount}
                    onChange={(e) => onVariantCountChange(clampVariantCount(Number(e.target.value) || 1))}
                />
                <button
                    type="button"
                    onClick={() => onVariantCountChange(clampVariantCount(variantCount - 1))}
                    style={{ ...actionButtonStyle, background: '#9b59ff', width: 32, minWidth: 32, padding: '5px 0', boxShadow: 'none' }}
                >
                    −
                </button>
                <button
                    type="button"
                    onClick={() => onVariantCountChange(clampVariantCount(variantCount + 1))}
                    style={{ ...actionButtonStyle, background: '#9b59ff', width: 32, minWidth: 32, padding: '5px 0', boxShadow: 'none' }}
                >
                    +
                </button>
            </div>
        </div>

        <div style={{ height: 1, background: '#c7c7c7', margin: '8px 0' }} />

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#1e1e1e', fontSize: '11px', lineHeight: 1.35 }}>
            <input type="checkbox" checked={accepted} onChange={(e) => onAcceptedChange(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
                Potwierdzam prawo do wykorzystania wizerunku i akceptuję{' '}
                <a href="https://aigrafka.pl/regulamin" target="_blank" rel="noreferrer" style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}>
                    Regulamin
                </a>
                {' '}i{' '}
                <a href="https://aigrafka.pl/polityka-prywatnosci" target="_blank" rel="noreferrer" style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}>
                    Politykę prywatności
                </a>
                .
            </span>
        </label>
    </div>
);

export default TokensCard;
