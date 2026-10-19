import { useAppStore } from '../../store/appStore';
import { placeholderPreview } from '../utils';

// Generated images are WebP since branding moved to post-processing.
export function imageFileExtension(mimeType: string): string {
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('webp')) return 'webp';
    return 'jpg';
}

/** Share, copy and download actions for the selected generated variant. */
export default function useResultActions(productUrl: string) {
    const variants = useAppStore((state) => state.variants);
    const selectedVariant = useAppStore((state) => state.selectedVariant);
    const previewUrl = useAppStore((state) => state.previewUrl);
    const setStatusSuccess = useAppStore((state) => state.setStatusSuccess);
    const setStatusError = useAppStore((state) => state.setStatusError);

    async function handleShare() {
        const shareUrl = productUrl || previewUrl || undefined;
        const imageUrl = variants[selectedVariant]?.url || previewUrl || undefined;
        try {
            if (navigator.share) {
                if (imageUrl && typeof navigator.canShare === 'function') {
                    try {
                        const response = await fetch(imageUrl);
                        const blob = await response.blob();
                        const extension = imageFileExtension(blob.type);
                        const file = new File([blob], `aigrafka-stylizacja.${extension}`, { type: blob.type || 'image/jpeg' });

                        const fileWithUrlPayload = {
                            title: 'AIgrafka',
                            text: 'Moja stylizacja z AIgrafka',
                            files: [file],
                            url: shareUrl,
                        };

                        if (navigator.canShare(fileWithUrlPayload)) {
                            await navigator.share(fileWithUrlPayload);
                            setStatusSuccess('Udostępniono.');
                            return;
                        }

                        const fileOnlyPayload = {
                            title: 'AIgrafka',
                            text: 'Moja stylizacja z AIgrafka',
                            files: [file],
                        };
                        if (navigator.canShare(fileOnlyPayload)) {
                            await navigator.share(fileOnlyPayload);
                            setStatusSuccess('Udostępniono.');
                            return;
                        }
                    } catch (fileShareError) {
                        console.error(fileShareError);
                    }
                }

                await navigator.share({
                    title: 'AIgrafka',
                    text: 'Moja stylizacja z AIgrafka',
                    url: shareUrl,
                });
                setStatusSuccess('Udostępniono.');
                return;
            }
        } catch (error) {
            console.error(error);
            if (error instanceof DOMException && error.name === 'AbortError') {
                setStatusError('Anulowano udostępnianie.');
                return;
            }
        }
        await handleCopyLink();
    }

    async function handleCopyLink() {
        const text = productUrl || previewUrl || 'https://aigrafka.pl';
        try {
            await navigator.clipboard.writeText(text);
            setStatusSuccess('Skopiowano link.');
        } catch (error) {
            console.error(error);
            setStatusError('Nie udało się skopiować linku.');
        }
    }

    async function handleCopyImage() {
        const target = variants[selectedVariant]?.url || previewUrl || placeholderPreview;
        if (!target) {
            setStatusError('Brak obrazu do skopiowania.');
            return;
        }
        try {
            if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
                throw new Error('Kopiowanie obrazu nie jest wspierane w tym środowisku.');
            }
            const response = await fetch(target);
            const sourceBlob = await response.blob();

            let imageBlob: Blob = sourceBlob;
            if (sourceBlob.type !== 'image/png') {
                const bitmap = await createImageBitmap(sourceBlob);
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Brak wsparcia dla konwersji obrazu.');
                ctx.drawImage(bitmap, 0, 0);
                imageBlob = await new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob((blob) => {
                        if (blob) resolve(blob);
                        else reject(new Error('Nie udało się przygotować obrazu PNG.'));
                    }, 'image/png');
                });
            }

            await navigator.clipboard.write([new ClipboardItem({ 'image/png': imageBlob })]);
            setStatusSuccess('Skopiowano obraz.');
        } catch (error) {
            console.error(error);
            try {
                await navigator.clipboard.writeText(target);
                setStatusError('Nie można skopiować obrazu. Skopiowano link.');
            } catch (textError) {
                console.error(textError);
                setStatusError('Nie udało się skopiować.');
            }
        }
    }

    async function handleDownload() {
        const url = variants[selectedVariant]?.url || previewUrl;
        if (!url) return;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            const ext = imageFileExtension(blob.type);
            a.download = `aigrafka-stylizacja.${ext}`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
        } catch (error) {
            console.error(error);
            setStatusError('Nie udało się pobrać obrazu.');
        }
    }

    return { handleShare, handleCopyImage, handleDownload };
}
