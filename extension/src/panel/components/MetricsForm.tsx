import React from 'react';

import { FormState } from '../types';
import { inputStyle, sectionTitleStyle } from '../styles';
import InfoTooltip from './InfoTooltip';

const METRICS_INFO =
    'Twoje dane posłużą do przygotowania wizualizacji.\n\n' +
    'W każdej chwili możesz zmienić wprowadzone dane. Pamiętaj, że wprowadzane dane muszą być zgodne ' +
    'z postanowieniami Regulaminu i Polityki Prywatności.';

interface MetricsFormProps {
    height: string;
    chest: string;
    waist: string;
    hips: string;
    fitStyle: FormState['fitStyle'];
    inputHeight: string;
    inputChest: string;
    inputWaist: string;
    inputHips: string;
    showMeasurements: boolean;
    measurementSummary: string;
    onToggleMeasurements: () => void;
    onMetricChange: (key: 'height' | 'chest' | 'waist' | 'hips', value: string) => void;
    onFitStyleChange: (value: FormState['fitStyle']) => void;
}

const MetricsForm: React.FC<MetricsFormProps> = ({
    fitStyle,
    inputHeight,
    inputChest,
    inputWaist,
    inputHips,
    showMeasurements,
    measurementSummary,
    onToggleMeasurements,
    onMetricChange,
    onFitStyleChange,
}) => (
    <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={sectionTitleStyle}>Twoje dane</div>
            <InfoTooltip label="Informacje o danych sylwetki" content={METRICS_INFO} />
        </div>

        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 6,
                flexWrap: 'wrap',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'baseline',
                    minWidth: 0,
                    flex: '1 1 120px',
                    flexWrap: 'wrap',
                }}
            >
                <div style={{ fontWeight: 800, fontSize: 13, color: '#1e1e1e' }}>Opis sylwetki</div>
                <div
                    style={{
                        fontWeight: 700,
                        color: '#555',
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: 11,
                    }}
                >
                    {measurementSummary}
                </div>
            </div>
            <button
                type="button"
                onClick={onToggleMeasurements}
                style={{
                    background: 'transparent',
                    border: '1.5px solid #9b59ff',
                    color: '#7c3aed',
                    fontWeight: 700,
                    fontSize: 10,
                    padding: '5px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                }}
                aria-expanded={showMeasurements}
            >
                {showMeasurements ? 'Minimalizuj' : 'Zmień opis sylwetki'}
            </button>
        </div>

        {showMeasurements && (
            <div
                style={{
                    marginBottom: 8,
                    background: '#f5f5f5',
                    border: '1.5px solid #d4d4d4',
                    borderRadius: 10,
                    padding: '10px 10px 8px',
                }}
            >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                    <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>
                            Wzrost (cm)
                        </div>
                        <input
                            style={{ ...inputStyle, padding: '5px 8px' }}
                            value={inputHeight}
                            onChange={(e) => onMetricChange('height', e.target.value)}
                            inputMode="numeric"
                            placeholder="Podaj wzrost"
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>Płeć</div>
                        <select
                            aria-label="Płeć"
                            style={{
                                ...inputStyle,
                                padding: '5px 8px',
                                appearance: 'none',
                                WebkitAppearance: 'none',
                                MozAppearance: 'none',
                                textAlign: 'center',
                                fontWeight: 700,
                            }}
                            value={fitStyle}
                            onChange={(e) => onFitStyleChange(e.target.value as FormState['fitStyle'])}
                        >
                            <option value="masculine">Mężczyzna</option>
                            <option value="feminine">Kobieta</option>
                            <option value="unisex">Unisex</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                    <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>
                            Klatka (cm)
                        </div>
                        <input
                            style={{ ...inputStyle, padding: '5px 8px' }}
                            value={inputChest}
                            onChange={(e) => onMetricChange('chest', e.target.value)}
                            inputMode="numeric"
                            placeholder="Klatka"
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>
                            Talia (cm)
                        </div>
                        <input
                            style={{ ...inputStyle, padding: '5px 8px' }}
                            value={inputWaist}
                            onChange={(e) => onMetricChange('waist', e.target.value)}
                            inputMode="numeric"
                            placeholder="Talia"
                        />
                    </div>
                    <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#4b4b4b', marginBottom: 3 }}>
                            Biodra (cm)
                        </div>
                        <input
                            style={{ ...inputStyle, padding: '5px 8px' }}
                            value={inputHips}
                            onChange={(e) => onMetricChange('hips', e.target.value)}
                            inputMode="numeric"
                            placeholder="Biodra"
                        />
                    </div>
                </div>
            </div>
        )}
    </>
);

export default MetricsForm;
