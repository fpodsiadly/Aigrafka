import React, { useEffect, useRef, useState } from 'react';

import { actionButtonStyle, inputStyle } from '../styles';
import { ProductImageKey } from '../types';
import FieldRow from './FieldRow';

interface ProductFormProps {
    productUrl: string;
    category: string;
    inputProductUrl: string;
    inputCategory: string;
    productImage1: File | null;
    productImage2: File | null;
    productPreview1: string;
    productPreview2: string;
    onProductUrlChange: (value: string) => void;
    onCategoryChange: (value: string) => void;
    onFileSelect: (key: ProductImageKey, file: File | null) => void;
    onDropProduct: (key: ProductImageKey, event: React.DragEvent<HTMLDivElement>) => void;
    onPickAreaProduct: (key: ProductImageKey) => void;
    onActiveTabUrl: () => void;
}

const ProductForm: React.FC<ProductFormProps> = ({
    inputProductUrl,
    inputCategory,
    productImage1,
    productImage2,
    productPreview1,
    productPreview2,
    onProductUrlChange,
    onCategoryChange,
    onFileSelect,
    onDropProduct,
    onPickAreaProduct,
    onActiveTabUrl,
}) => {
    const [hoveredProductBtn, setHoveredProductBtn] = useState<ProductImageKey | null>(null);
    const [uploadMenuFor, setUploadMenuFor] = useState<ProductImageKey | null>(null);
    const productImage1InputRef = useRef<HTMLInputElement | null>(null);
    const productImage2InputRef = useRef<HTMLInputElement | null>(null);
    const productImage1MenuRef = useRef<HTMLDivElement | null>(null);
    const productImage2MenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!uploadMenuFor) return;

        const onPointerDown = (event: MouseEvent) => {
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
            const insideFirst = path.some(
                (node) => node instanceof Node && (productImage1MenuRef.current?.contains(node) ?? false)
            );
            const insideSecond = path.some(
                (node) => node instanceof Node && (productImage2MenuRef.current?.contains(node) ?? false)
            );

            if (!insideFirst && !insideSecond) {
                setUploadMenuFor(null);
            }
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setUploadMenuFor(null);
            }
        };

        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('mousedown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [uploadMenuFor]);

    const renderImageSlot = (key: ProductImageKey, preview: string, label: string, optionalHint?: string) => {
        const isSet = key === 'productImage1' ? productImage1 : productImage2;
        const menuRef = key === 'productImage1' ? productImage1MenuRef : productImage2MenuRef;
        const inputRef = key === 'productImage1' ? productImage1InputRef : productImage2InputRef;

        return (
            <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDropProduct(key, e)}
                style={{ flex: 1, minWidth: 0 }}
            >
                <div
                    ref={menuRef}
                    title={optionalHint}
                    style={{ position: 'relative' }}
                    onMouseEnter={() => isSet && setHoveredProductBtn(key)}
                    onMouseLeave={() => setHoveredProductBtn(null)}
                >
                    <button
                        type="button"
                        aria-label={label}
                        onClick={() => setUploadMenuFor((prev) => (prev === key ? null : key))}
                        style={{
                            ...actionButtonStyle,
                            background: isSet ? '#7f3bff' : '#9b59ff',
                            border: '2px solid #7f3bff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '100%',
                            minHeight: 32,
                            fontSize: 12,
                            position: 'relative',
                        }}
                    >
                        {isSet ? `✓ ${label}` : `+ Dodaj ${label.toLowerCase()}`}
                        {isSet && (
                            <span
                                role="button"
                                aria-label={`Usuń ${label.toLowerCase()} zdjęcie`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onFileSelect(key, null);
                                    setUploadMenuFor(null);
                                }}
                                style={{
                                    position: 'absolute',
                                    top: -6,
                                    right: -6,
                                    width: 16,
                                    height: 16,
                                    borderRadius: '50%',
                                    background: '#ff4444',
                                    color: '#fff',
                                    fontSize: 10,
                                    fontWeight: 900,
                                    display: 'grid',
                                    placeItems: 'center',
                                    lineHeight: 1,
                                    cursor: 'pointer',
                                    boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                                    zIndex: 10,
                                }}
                            >
                                ×
                            </span>
                        )}
                    </button>
                    {hoveredProductBtn === key && preview && (
                        <div
                            style={{
                                position: 'absolute',
                                bottom: 38,
                                left: '50%',
                                transform: 'translateX(-50%)',
                                zIndex: 50,
                                borderRadius: 10,
                                overflow: 'hidden',
                                border: '2px solid #9b59ff',
                                boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
                                background: '#fff',
                                pointerEvents: 'none',
                            }}
                        >
                            <img
                                src={preview}
                                alt="Podgląd"
                                style={{ width: 96, height: 96, objectFit: 'cover', display: 'block' }}
                            />
                        </div>
                    )}
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                            setUploadMenuFor(null);
                            onFileSelect(key, e.target.files?.[0] ?? null);
                        }}
                        style={{ display: 'none' }}
                    />
                    {uploadMenuFor === key ? (
                        <div
                            style={{
                                position: 'absolute',
                                top: 36,
                                left: 0,
                                zIndex: 30,
                                width: '100%',
                                background: '#ececec',
                                border: '1px solid #c0c0c0',
                                borderRadius: 8,
                                padding: 4,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    setUploadMenuFor(null);
                                    inputRef.current?.click();
                                }}
                                style={{ ...actionButtonStyle, background: '#8f8f8f', padding: '6px 8px', boxShadow: 'none' }}
                            >
                                Z dysku
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setUploadMenuFor(null);
                                    onPickAreaProduct(key);
                                }}
                                style={{ ...actionButtonStyle, background: '#9b59ff', padding: '6px 8px', boxShadow: 'none' }}
                            >
                                Zaznacz obszar
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>
        );
    };

    return (
        <>
            <FieldRow label="Link do produktu:">
                <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                    <input
                        style={inputStyle}
                        value={inputProductUrl}
                        onChange={(e) => onProductUrlChange(e.target.value)}
                        placeholder="Wklej link do produktu w celu śledzenia"
                        type="text"
                    />
                    <button
                        type="button"
                        title="Wstaw URL aktywnej karty"
                        onClick={onActiveTabUrl}
                        style={{
                            ...actionButtonStyle,
                            background: '#9b59ff',
                            padding: '7px 9px',
                            fontSize: 10,
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                            boxShadow: 'none',
                        }}
                    >
                        Aktywna karta
                    </button>
                </div>
            </FieldRow>

            <FieldRow label="Kategoria produktu:">
                <input
                    style={inputStyle}
                    value={inputCategory}
                    onChange={(e) => onCategoryChange(e.target.value)}
                    placeholder="Podaj kategorię swojego produktu"
                />
            </FieldRow>

            <FieldRow label="Zdjęcia produktu:">
                <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                    {renderImageSlot('productImage1', productPreview1, 'Pierwsze')}
                    {renderImageSlot(
                        'productImage2',
                        productPreview2,
                        'Drugie',
                        'Drugie zdjęcie jest opcjonalne i pomaga lepiej odwzorować tył ubrania w 3. wariancie.'
                    )}
                </div>
            </FieldRow>
        </>
    );
};

export default ProductForm;
