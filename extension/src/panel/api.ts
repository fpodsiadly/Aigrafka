import { apiBase } from './utils';
import {
    AuthApiResponse,
    AuthMeResponse,
    GenerateResponse,
    ProfileResponse,
} from './types';

export { apiBase };

type ApiResponse = { ok: boolean; status: number; text: string };
type ApiBody =
    | { kind: 'json'; value: unknown }
    | {
        kind: 'form';
        entries: Array<
            | { name: string; kind: 'text'; value: string }
            | { name: string; kind: 'file'; filename: string; contentType: string; base64: string }
        >;
    };

function toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Nie udało się odczytać pliku.'));
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
        reader.readAsDataURL(file);
    });
}

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;
const IMAGE_QUALITY = 0.88;

async function compressImage(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) return file;

    try {
        const bitmap = await createImageBitmap(file);
        try {
            const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d');
            if (!context) return file;
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY);
            });
            if (!blob || (scale === 1 && blob.size >= file.size)) return file;
            const filename = file.name.replace(/\.[^.]+$/, '') || 'image';
            return new File([blob], `${filename}.jpg`, { type: blob.type, lastModified: file.lastModified });
        } finally {
            bitmap.close();
        }
    } catch {
        return file;
    }
}

async function serializeFormData(formData: FormData): Promise<ApiBody> {
    const entries = await Promise.all(Array.from(formData.entries()).map(async ([name, value]) => {
        if (typeof value === 'string') return { name, kind: 'text' as const, value };
        if (value.size > MAX_SOURCE_IMAGE_BYTES) {
            throw new Error(`Plik „${value.name}” jest za duży (maks. ${MAX_SOURCE_IMAGE_BYTES / (1024 * 1024)} MB).`);
        }
        const file = await compressImage(value);
        if (file.size > MAX_UPLOAD_BYTES) {
            throw new Error(`Plik „${file.name}” jest za duży (maks. ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB).`);
        }
        return {
            name,
            kind: 'file' as const,
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            base64: await toBase64(file),
        };
    }));
    return { kind: 'form', entries };
}

async function apiRequest(
    path: string,
    options: { method?: string; headers?: Record<string, string>; body?: unknown | FormData } = {},
): Promise<ApiResponse> {
    const body: ApiBody | undefined = options.body instanceof FormData
        ? await serializeFormData(options.body)
        : options.body === undefined ? undefined : { kind: 'json', value: options.body };
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: 'AIGRAFKA_API_REQUEST', path, method: options.method, headers: options.headers, body },
            (response: ApiResponse | undefined) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response) {
                    reject(new Error('Brak odpowiedzi z tła rozszerzenia.'));
                    return;
                }
                resolve(response);
            },
        );
    });
}

function parseJson<T>(response: ApiResponse): T {
    return JSON.parse(response.text) as T;
}

export async function getDemoAccessStatus(): Promise<boolean> {
    const response = await apiRequest('/auth/demo');
    if (!response.ok) return false;
    return parseJson<{ enabled: boolean }>(response).enabled;
}

export async function startDemoAccess(): Promise<AuthApiResponse> {
    const response = await apiRequest('/auth/demo', { method: 'POST' });
    if (!response.ok) throw new Error(formatApiError(response.text, 'Tryb demo jest niedostępny.'));
    return parseJson<AuthApiResponse>(response);
}

function formatApiError(text: string, fallback: string): string {
    try {
        const parsed = JSON.parse(text) as { detail?: unknown };
        if (typeof parsed.detail === 'string' && parsed.detail) return parsed.detail;
        if (Array.isArray(parsed.detail)) return parsed.detail.map(String).join('; ');
    } catch {
        // Use plain-text response below.
    }
    return text || fallback;
}

export async function authMe(token: string): Promise<AuthMeResponse> {
    const response = await apiRequest('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Błąd weryfikacji sesji (HTTP ${response.status}).`);
    }
    return parseJson<AuthMeResponse>(response);
}

export async function submitGenerate(formData: FormData, token?: string | null): Promise<GenerateResponse> {
    const headers: Record<string, string> = {};
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const response = await apiRequest('/generate', {
        method: 'POST',
        body: formData,
        headers,
    });
    if (!response.ok) {
        throw new Error(formatApiError(response.text, `Błąd generowania (HTTP ${response.status}).`));
    }
    return parseJson<GenerateResponse>(response);
}

export async function loadProfile(userId: string, token: string): Promise<ProfileResponse | null> {
    const response = await apiRequest(`/profile/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        return null;
    }
    return parseJson<ProfileResponse>(response);
}

export async function saveProfile(token: string, data: ProfileResponse): Promise<void> {
    const response = await apiRequest('/profile', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
        },
        body: data,
    });
    if (!response.ok) throw new Error(formatApiError(response.text, 'Nie udało się zapisać profilu.'));
}

export async function devAddTokens(token: string): Promise<{ ok: boolean; tokens: number }> {
    const response = await apiRequest('/payments/dev-add-tokens', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Błąd doładowania tokenów (HTTP ${response.status}).`);
    }
    return parseJson<{ ok: boolean; tokens: number }>(response);
}

export async function startCheckout(
    token: string,
    pack: string,
    userId: string | undefined,
    email: string | undefined
): Promise<{ ok?: boolean; error?: string }> {
    return new Promise(resolve => {
        chrome.runtime?.sendMessage?.(
            {
                type: 'OPEN_CHECKOUT',
                pack,
                authToken: token,
                userId,
                email,
            },
            result => {
                if (chrome.runtime?.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                    return;
                }
                resolve(result ?? { ok: false, error: 'Brak odpowiedzi z tła rozszerzenia.' });
            }
        );
    });
}

export async function googleLogin(credential: string): Promise<AuthApiResponse> {
    const response = await apiRequest('/auth/google', {
        method: 'POST',
        body: { id_token: credential },
    });
    if (!response.ok) {
        const text = response.text;
        let message = 'Logowanie Google nie powiodło się.';
        try {
            const parsed = JSON.parse(text);
            message = parsed?.detail || message;
        } catch {
            if (text) message = text;
        }
        throw new Error(message);
    }
    return parseJson<AuthApiResponse>(response);
}
