import React, { useId, useState } from 'react';

interface InfoTooltipProps {
    content: string;
    label: string;
}

const InfoTooltip: React.FC<InfoTooltipProps> = ({ content, label }) => {
    const [visible, setVisible] = useState(false);
    const tooltipId = useId();

    return (
        <span
            style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
            onMouseEnter={() => setVisible(true)}
            onMouseLeave={() => setVisible(false)}
        >
            <button
                type="button"
                aria-label={label}
                aria-describedby={visible ? tooltipId : undefined}
                onFocus={() => setVisible(true)}
                onBlur={() => setVisible(false)}
                style={{
                    width: 20,
                    height: 20,
                    padding: 0,
                    border: 0,
                    borderRadius: 6,
                    background: '#8bb0d6',
                    color: '#ffffff',
                    fontSize: 14,
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 800,
                    cursor: 'help',
                }}
            >
                i
            </button>
            {visible && (
                <span
                    id={tooltipId}
                    role="tooltip"
                    style={{
                        position: 'absolute',
                        top: 26,
                        left: -100,
                        zIndex: 100,
                        width: 280,
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: '#262626',
                        color: '#ffffff',
                        boxShadow: '0 6px 18px rgba(0, 0, 0, 0.25)',
                        fontSize: 11,
                        fontWeight: 500,
                        lineHeight: 1.45,
                        whiteSpace: 'pre-line',
                    }}
                >
                    {content}
                </span>
            )}
        </span>
    );
};

export default InfoTooltip;
