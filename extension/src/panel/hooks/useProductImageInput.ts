import React from 'react';

import { useAppStore } from '../../store/appStore';
import { captureVisibleTab, cropFromScreenshot, fetchImageViaExtension, pickAreaOnPage } from '../capture';
import { ProductImageKey } from '../types';
import { isSafeExternalUrl } from '../utils';

const MAX_PRODUCT_FILE_BYTES = 8 * 1024 * 1024;

/** Product image input: file picker, drag & drop and picking an image on the page. */
export default function useProductImageInput(onImage: (key: ProductImageKey, file: File | null) => void) {
    const setStatusSuccess = useAppStore((state) => state.setStatusSuccess);
    const setStatusError = useAppStore((state) => state.setStatusError);

    function handleFileSelect(key: ProductImageKey, file: File | null) {
        onImage(key, file);
        if (file) {
            setStatusSuccess(`Dodano ${file.name}`);
        }
    }

    async function handleDropProduct(key: ProductImageKey, event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();
        const dt = event.dataTransfer;

        if (dt.files && dt.files.length > 0) {
            const file = dt.files[0];
            if (file.size > MAX_PRODUCT_FILE_BYTES) {
                setStatusError('Plik jest za duży. Maksymalny rozmiar to 8 MB.');
                return;
            }
            handleFileSelect(key, file);
            return;
        }

        const url = dt.getData('text/uri-list') || dt.getData('text/plain');
        if (url && /^https?:\/\//i.test(url)) {
            if (!isSafeExternalUrl(url)) {
                setStatusError('Ten adres nie jest dozwolony (adresy lokalne/prywatne są blokowane).');
                return;
            }
            try {
                handleFileSelect(key, await fetchImageViaExtension(url));
            } catch (error) {
                console.error(error);
                setStatusError(error instanceof Error ? error.message : 'Nie udało się pobrać obrazu z linku.');
            }
            return;
        }

        setStatusError('Upuść plik obrazu lub link http/https.');
    }

    async function handlePickAreaProduct(key: ProductImageKey) {
        try {
            setStatusSuccess('Kliknij zdjęcie produktu albo zaznacz obszar na stronie.');
            const picked = await pickAreaOnPage();
            if (!picked) {
                setStatusSuccess('Anulowano zaznaczanie obszaru.');
                return;
            }
            // Prefer the original image file in full resolution; a screenshot crop
            // is limited to screen resolution and may include page overlays.
            if (picked.imageUrl) {
                try {
                    handleFileSelect(key, await fetchImageViaExtension(picked.imageUrl));
                    setStatusSuccess('Dodano zdjęcie produktu w pełnej rozdzielczości.');
                    return;
                } catch (error) {
                    console.warn('[AIgrafka] full-resolution image unavailable, using screenshot', error);
                }
            }
            const screenshot = await captureVisibleTab();
            const blob = await cropFromScreenshot(screenshot, picked.area);
            handleFileSelect(key, new File([blob], `produkt-${Date.now()}.png`, { type: 'image/png' }));
            setStatusSuccess('Dodano zdjęcie z zaznaczonego obszaru.');
        } catch (error) {
            console.error(error);
            setStatusError(error instanceof Error ? error.message : 'Nie udało się pobrać zaznaczonego obszaru.');
        }
    }

    return { handleFileSelect, handleDropProduct, handlePickAreaProduct };
}
