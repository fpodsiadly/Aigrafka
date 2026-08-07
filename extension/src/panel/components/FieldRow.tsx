import React from 'react';

import { fieldLabelStyle, rowStyle } from '../styles';

const FieldRow = ({
    label,
    children
}: {
    label: string;
    children: React.ReactNode;
}) => (
    <div style={rowStyle}>
        <div style={fieldLabelStyle}>{label}</div>
        <div style={{ flex: '1 1 180px', display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0, width: '100%' }}>{children}</div>
        </div>
    </div>
);


export default FieldRow;
