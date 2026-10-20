import React, { useRef, useState } from 'react';

import { actionButtonStyle } from '../styles';
import { SelfieEmpty } from '../utils';
import SelfieConsentDialog from './SelfieConsentDialog';

interface SelfieUploadProps {
    selfie: File | null;
    selfiePreview: string;
    onSelfieChange: (file: File | null) => void;
    onSelfieClear: () => void;
    onSizeError?: (maxSizeMb: number) => void;
    maxSizeMb?: number;
}

const SelfieUpload: React.FC<SelfieUploadProps> = ({
    selfie,
    selfiePreview,
    onSelfieChange,
    onSelfieClear,
    onSizeError,
    maxSizeMb = 8,
}) => {
    // The file picker opens only after the user accepts the consent dialog.
    const inputRef = useRef<HTMLInputElement>(null);
    const [consentOpen, setConsentOpen] = useState(false);

    function handleConsentAccepted() {
        setConsentOpen(false);
        inputRef.current?.click();
    }

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', width: '100%' }}>
            <div style={{ position: 'relative', width: 88, height: 88, flex: '0 0 88px' }}>
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: 12,
                        overflow: 'hidden',
                        border: `2px solid ${selfiePreview ? '#9b59ff' : '#bdbdbd'}`,
                        background: '#f0f0f0',
                    }}
                >
                    {selfiePreview ? (
                        <img src={selfiePreview} alt="Selfie" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                        <SelfieEmpty />
                    )}
                </div>
                {selfiePreview && (
                    <button
                        type="button"
                        onClick={onSelfieClear}
                        style={{
                            position: 'absolute',
                            top: -6,
                            right: -6,
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: '#ff4444',
                            color: '#fff',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            lineHeight: 1,
                        }}
                        title="Usuń selfie"
                    >
                        ×
                    </button>
                )}
            </div>
            <button
                type="button"
                onClick={() => setConsentOpen(true)}
                style={{
                    ...actionButtonStyle,
                    background: '#9b59ff',
                    border: '2px solid #7f3bff',
                    borderRadius: 10,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    maxWidth: 160,
                    padding: '10px 12px',
                    fontSize: 14,
                    fontWeight: 700,
                }}
            >
                {selfie ? 'Zmień selfie' : 'Dodaj selfie'}
            </button>
            <input
                ref={inputRef}
                type="file"
                aria-label="Wgraj zdjęcie selfie"
                accept="image/*"
                onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    if (!file) return;
                    if (file.size > maxSizeMb * 1024 * 1024) {
                        onSizeError?.(maxSizeMb);
                        return;
                    }
                    onSelfieChange(file);
                }}
                style={{ display: 'none' }}
            />
            <SelfieConsentDialog
                open={consentOpen}
                onAccept={handleConsentAccepted}
                onCancel={() => setConsentOpen(false)}
            />
        </div>
    );
};

export default SelfieUpload;
