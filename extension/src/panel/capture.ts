export async function captureVisibleTab(): Promise<string> {
    return new Promise((resolve, reject) => {
        chrome.runtime?.sendMessage?.(
            { type: 'AIGRAFKA_CAPTURE_VISIBLE_TAB' },
            (response?: { ok?: boolean; dataUrl?: string; error?: string }) => {
                if (chrome.runtime?.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.ok || !response.dataUrl) {
                    reject(new Error(response?.error || 'Nie udało się przechwycić obrazu strony.'));
                    return;
                }
                resolve(response.dataUrl);
            }
        );
    });
}

export interface PickedArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PickResult {
    area: PickedArea;
    // Full-resolution source of the clicked image element, when one was clicked.
    imageUrl: string | null;
}

// Tokenise per the HTML spec: a URL runs until whitespace (URLs may contain
// commas, e.g. CDN transforms) and its optional descriptor runs until a comma.
function parseSrcset(srcset: string): { url: string; descriptor: string }[] {
    const candidates: { url: string; descriptor: string }[] = [];
    let position = 0;
    while (position < srcset.length) {
        while (position < srcset.length && /[\s,]/.test(srcset[position])) position += 1;
        const urlStart = position;
        while (position < srcset.length && !/\s/.test(srcset[position])) position += 1;
        let url = srcset.slice(urlStart, position);
        if (!url) break;
        let descriptor = '';
        if (url.endsWith(',')) {
            url = url.replace(/,+$/, '');
        } else {
            const descriptorStart = position;
            while (position < srcset.length && srcset[position] !== ',') position += 1;
            descriptor = srcset.slice(descriptorStart, position).trim();
        }
        candidates.push({ url, descriptor: descriptor || '1x' });
    }
    return candidates;
}

/**
 * Pick the widest candidate from a `srcset` attribute, resolved against `baseUrl`.
 * Density descriptors (2x) are ranked like widths; candidates without a
 * descriptor count as 1x.
 */
export function pickLargestSrcsetUrl(srcset: string, baseUrl: string): string | null {
    let best: { url: string; score: number } | null = null;
    for (const { url: rawUrl, descriptor } of parseSrcset(srcset)) {
        const value = parseFloat(descriptor);
        if (Number.isNaN(value)) continue;
        const score = descriptor.endsWith('x') ? value * 1000 : value;
        if (!best || score > best.score) {
            try {
                best = { url: new URL(rawUrl, baseUrl).href, score };
            } catch {
                /* skip malformed candidate */
            }
        }
    }
    return best?.url ?? null;
}

function backgroundImageUrl(element: Element): string | null {
    const match = getComputedStyle(element).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
    return match?.[1] || null;
}

/** Resolve the highest-resolution image URL behind a picked element. */
export function resolveBestImageUrl(element: Element, baseUrl: string = document.baseURI): string | null {
    const img = element instanceof HTMLPictureElement ? element.querySelector('img') : element;
    let url: string | null = null;
    if (img instanceof HTMLImageElement) {
        const sources = img.parentElement instanceof HTMLPictureElement
            ? Array.from(img.parentElement.querySelectorAll('source')).map((source) => source.srcset)
            : [];
        for (const srcset of [img.srcset, ...sources]) {
            url = srcset ? pickLargestSrcsetUrl(srcset, baseUrl) : null;
            if (url) break;
        }
        url = url || img.currentSrc || img.src || null;
    } else if (element instanceof HTMLVideoElement) {
        url = element.poster || null;
    } else {
        url = backgroundImageUrl(element);
    }
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;
    try {
        return new URL(url, baseUrl).href;
    } catch {
        return null;
    }
}

/**
 * Download an image through the extension service worker, which may read any
 * host thanks to host_permissions (a page-context fetch would hit CORS).
 */
export async function fetchImageViaExtension(url: string): Promise<File> {
    const response = await new Promise<{ ok?: boolean; base64?: string; contentType?: string; error?: string } | undefined>(
        (resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'AIGRAFKA_FETCH_IMAGE', url }, (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(result);
            });
        }
    );
    if (!response?.ok || !response.base64 || !response.contentType) {
        throw new Error(response?.error || 'Nie udało się pobrać zdjęcia produktu.');
    }
    const binary = atob(response.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const extension = response.contentType.split('/')[1]?.split(/[;+]/)[0] || 'jpg';
    return new File([bytes], `produkt-${Date.now()}.${extension}`, { type: response.contentType });
}

export async function pickAreaOnPage(): Promise<PickResult | null> {
    return new Promise((resolve) => {
        const panelHost = document.getElementById('aigrafka-extension-root') as HTMLElement | null;
        if (panelHost) panelHost.style.display = 'none';

        const pickStyle = document.createElement('style');
        pickStyle.textContent = `[data-aigrafka-pick]{box-shadow:0 0 0 3px #7c3aed,0 0 0 8px rgba(124,58,237,0.22)!important;cursor:crosshair!important;outline:none!important;}`;
        document.head.appendChild(pickStyle);

        const hint = document.createElement('div');
        hint.textContent = 'Najedź na zdjęcie produktu i kliknij  •  lub zaznacz obszar przeciąganiem  •  ESC = anuluj';
        Object.assign(hint.style, {
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(12,8,28,0.93)',
            color: '#fff',
            padding: '9px 20px',
            borderRadius: '10px',
            fontSize: '13px',
            fontFamily: "'Space Grotesk',system-ui,sans-serif",
            zIndex: '2147483648',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
        });
        document.body.appendChild(hint);

        let highlighted: HTMLElement | null = null;
        let dragReady = false;
        let dragActive = false;
        let startX = 0,
            startY = 0;
        let dragOverlay: HTMLDivElement | null = null;
        let dragSelBox: HTMLDivElement | null = null;

        function findImgEl(el: Element | null): HTMLElement | null {
            let cur: Element | null = el;
            while (cur && cur !== document.body) {
                const tag = cur.tagName.toLowerCase();
                if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'picture') return cur as HTMLElement;
                if (cur.getAttribute('role') === 'img') return cur as HTMLElement;
                if (cur instanceof HTMLElement && cur.offsetWidth > 50 && cur.offsetHeight > 50) {
                    const bg = getComputedStyle(cur).backgroundImage;
                    if (bg && bg !== 'none' && bg.startsWith('url(')) return cur;
                }
                cur = cur.parentElement;
            }
            return null;
        }

        function elementAt(x: number, y: number): Element | null {
            if (panelHost) panelHost.style.visibility = 'hidden';
            const el = document.elementFromPoint(x, y);
            if (panelHost) panelHost.style.visibility = '';
            return el;
        }

        function cleanup(result: PickResult | null) {
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mousedown', onMouseDown, true);
            document.removeEventListener('mouseup', onMouseUp, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onKeyDown);
            if (highlighted) highlighted.removeAttribute('data-aigrafka-pick');
            pickStyle.remove();
            hint.remove();
            dragOverlay?.remove();
            document.body.style.userSelect = '';
            (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = '';
            window.getSelection()?.removeAllRanges();
            if (panelHost) panelHost.style.display = '';
            resolve(result);
        }

        function onMouseMove(e: MouseEvent) {
            if (dragActive) {
                const x = Math.min(startX, e.clientX);
                const y = Math.min(startY, e.clientY);
                const w = Math.abs(e.clientX - startX);
                const h = Math.abs(e.clientY - startY);
                if (dragSelBox) Object.assign(dragSelBox.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
                return;
            }

            if (dragReady) {
                if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
                    dragActive = true;
                    dragOverlay = document.createElement('div');
                    Object.assign(dragOverlay.style, {
                        position: 'fixed',
                        inset: '0',
                        zIndex: '2147483648',
                        cursor: 'crosshair',
                        background: 'rgba(0,0,0,0.07)',
                    });
                    dragSelBox = document.createElement('div');
                    Object.assign(dragSelBox.style, {
                        position: 'fixed',
                        border: '2px solid #7c3aed',
                        background: 'rgba(124,58,237,0.11)',
                        pointerEvents: 'none',
                        left: `${Math.min(startX, e.clientX)}px`,
                        top: `${Math.min(startY, e.clientY)}px`,
                        width: `${Math.abs(e.clientX - startX)}px`,
                        height: `${Math.abs(e.clientY - startY)}px`,
                    });
                    dragOverlay.appendChild(dragSelBox);
                    document.body.appendChild(dragOverlay);
                    hint.textContent = 'Przeciągnij aby zaznaczyć obszar  •  ESC = anuluj';
                    if (highlighted) {
                        highlighted.removeAttribute('data-aigrafka-pick');
                        highlighted = null;
                    }
                }
                return;
            }

            const found = findImgEl(elementAt(e.clientX, e.clientY));
            if (highlighted && highlighted !== found) {
                highlighted.removeAttribute('data-aigrafka-pick');
                highlighted = null;
            }
            if (found && found !== highlighted) {
                found.setAttribute('data-aigrafka-pick', '');
                highlighted = found;
                hint.textContent = '✓ Kliknij aby wybrać ten obraz  •  lub zaznacz obszar  •  ESC = anuluj';
            } else if (!found) {
                hint.textContent = 'Najedź na zdjęcie produktu i kliknij  •  lub zaznacz obszar przeciąganiem  •  ESC = anuluj';
            }
        }

        function onMouseDown(e: MouseEvent) {
            if (e.button !== 0 || dragActive) return;
            if (!findImgEl(elementAt(e.clientX, e.clientY))) {
                e.preventDefault();
                startX = e.clientX;
                startY = e.clientY;
                dragReady = true;
                document.body.style.userSelect = 'none';
                (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';
            }
        }

        function onMouseUp(e: MouseEvent) {
            if (e.button !== 0) return;
            const wasDragActive = dragActive;
            dragReady = false;
            dragActive = false;
            document.body.style.userSelect = '';
            (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = '';
            window.getSelection()?.removeAllRanges();
            if (!wasDragActive) return;
            const x = Math.min(startX, e.clientX);
            const y = Math.min(startY, e.clientY);
            const width = Math.abs(e.clientX - startX);
            const height = Math.abs(e.clientY - startY);
            if (width < 12 || height < 12) {
                dragOverlay?.remove();
                dragOverlay = null;
                dragSelBox = null;
                hint.textContent = 'Najedź na zdjęcie produktu i kliknij  •  lub zaznacz obszar przeciąganiem  •  ESC = anuluj';
                return;
            }
            cleanup({ area: { x, y, width, height }, imageUrl: null });
        }

        function onClick(e: MouseEvent) {
            if (dragActive || dragReady) return;
            const found = findImgEl(elementAt(e.clientX, e.clientY));
            if (!found) return;
            e.preventDefault();
            e.stopPropagation();
            const r = found.getBoundingClientRect();
            cleanup({
                area: {
                    x: Math.max(0, r.left),
                    y: Math.max(0, r.top),
                    width: Math.max(12, Math.min(r.width, window.innerWidth - Math.max(0, r.left))),
                    height: Math.max(12, Math.min(r.height, window.innerHeight - Math.max(0, r.top))),
                },
                imageUrl: resolveBestImageUrl(found),
            });
        }

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') cleanup(null);
        }

        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('mouseup', onMouseUp, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown);
    });
}

export async function cropFromScreenshot(dataUrl: string, area: PickedArea): Promise<Blob> {
    const image = new Image();
    image.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Nie udało się odczytać zrzutu ekranu.'));
    });

    const dpr = window.devicePixelRatio || 1;
    const sx = Math.max(0, Math.round(area.x * dpr));
    const sy = Math.max(0, Math.round(area.y * dpr));
    const sw = Math.max(1, Math.round(area.width * dpr));
    const sh = Math.max(1, Math.round(area.height * dpr));
    const safeW = Math.min(sw, image.width - sx);
    const safeH = Math.min(sh, image.height - sy);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, safeW);
    canvas.height = Math.max(1, safeH);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Brak wsparcia canvas.');
    context.drawImage(image, sx, sy, safeW, safeH, 0, 0, safeW, safeH);

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Nie udało się przyciąć obrazu.'));
        }, 'image/png');
    });
}
