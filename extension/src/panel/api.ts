import { apiBase } from './utils';
import {
    AuthApiResponse,
    AuthMeResponse,
    GenerateJobResponse,
    GenerateResponse,
    GoogleClientIdResponse,
    JobStatusResponse,
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

async function serializeFormData(formData: FormData): Promise<ApiBody> {
    const entries = await Promise.all(Array.from(formData.entries()).map(async ([name, value]) => {
        if (typeof value === 'string') return { name, kind: 'text' as const, value };
        return {
            name,
            kind: 'file' as const,
            filename: value.name,
            contentType: value.type || 'application/octet-stream',
            base64: await toBase64(value),
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

export async function authLogin(email: string, password: string): Promise<AuthApiResponse> {
    const response = await apiRequest('/auth/login', {
        method: 'POST',
        body: { email, password },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(formatApiError(text, 'Nie udało się zalogować.'));
    }
    return parseJson<AuthApiResponse>(response);
}

export async function authRegister(email: string, password: string): Promise<AuthApiResponse> {
    const response = await apiRequest('/auth/register', {
        method: 'POST',
        body: { email, password },
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(formatApiError(text, 'Nie udało się utworzyć konta.'));
    }
    return parseJson<AuthApiResponse>(response);
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

export async function submitGenerate(formData: FormData, token?: string | null): Promise<GenerateJobResponse> {
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
        throw new Error(`Błąd generowania (HTTP ${response.status}).`);
    }
    return parseJson<GenerateJobResponse>(response);
}

export async function pollJobStatus(
    jobId: string,
    token?: string | null,
    signal?: AbortSignal,
): Promise<GenerateResponse> {
    const maxAttempts = 180; // 6 minutes at 2s interval
    let attempts = 0;

    return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            fn();
        };

        const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')));

        if (signal) {
            if (signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }

        const check = async () => {
            attempts++;
            try {
                const headers: Record<string, string> = {};
                if (token) {
                    headers.Authorization = `Bearer ${token}`;
                }
                if (signal?.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }
                const res = await apiRequest(`/jobs/${encodeURIComponent(jobId)}`, { headers });
                if (!res.ok) {
                    if (res.status === 404) {
                        finish(() => reject(new Error('Job nie został znaleziony.')));
                        return;
                    }
                    throw new Error(`Błąd sprawdzania statusu (HTTP ${res.status}).`);
                }
                const job = parseJson<JobStatusResponse>(res);
                if (job.status === 'completed') {
                    if (job.result) {
                        finish(() => resolve(job.result as GenerateResponse));
                    } else {
                        finish(() => reject(new Error('Job zakończony, ale brak wyniku.')));
                    }
                    return;
                }
                if (job.status === 'failed') {
                    finish(() => reject(new Error(job.error || 'Generacja nieudana.')));
                    return;
                }
                if (attempts >= maxAttempts) {
                    finish(() => reject(new Error('Przekroczono limit czasu oczekiwania na stylizację.')));
                    return;
                }
                timer = setTimeout(check, 2000);
            } catch (err) {
                finish(() => reject(err));
            }
        };
        check();
    });
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

export async function getGoogleClientId(): Promise<GoogleClientIdResponse> {
    const response = await apiRequest('/auth/google/client-id');
    if (!response.ok) {
        throw new Error('Nie udało się pobrać konfiguracji Google.');
    }
    return parseJson<GoogleClientIdResponse>(response);
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
        const text = await response.text();
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
