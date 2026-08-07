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

export async function authLogin(email: string, password: string): Promise<AuthApiResponse> {
    const response = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
        const text = await response.text();
        let message = 'Nie udało się zalogować.';
        try {
            const parsed = JSON.parse(text);
            message = parsed?.detail || message;
        } catch {
            if (text) message = text;
        }
        throw new Error(message);
    }
    return response.json() as Promise<AuthApiResponse>;
}

export async function authRegister(email: string, password: string): Promise<AuthApiResponse> {
    const response = await fetch(`${apiBase}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
        const text = await response.text();
        let message = 'Nie udało się utworzyć konta.';
        try {
            const parsed = JSON.parse(text);
            message = parsed?.detail || message;
        } catch {
            if (text) message = text;
        }
        throw new Error(message);
    }
    return response.json() as Promise<AuthApiResponse>;
}

export async function authMe(token: string): Promise<AuthMeResponse> {
    const response = await fetch(`${apiBase}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Błąd weryfikacji sesji (HTTP ${response.status}).`);
    }
    return response.json() as Promise<AuthMeResponse>;
}

export async function submitGenerate(formData: FormData, token?: string | null): Promise<GenerateJobResponse> {
    const headers: Record<string, string> = {};
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${apiBase}/generate`, {
        method: 'POST',
        body: formData,
        headers,
    });
    if (!response.ok) {
        throw new Error(`Błąd generowania (HTTP ${response.status}).`);
    }
    return response.json() as Promise<GenerateJobResponse>;
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
                const res = await fetch(`${apiBase}/jobs/${jobId}`, { headers, signal });
                if (!res.ok) {
                    if (res.status === 404) {
                        finish(() => reject(new Error('Job nie został znaleziony.')));
                        return;
                    }
                    throw new Error(`Błąd sprawdzania statusu (HTTP ${res.status}).`);
                }
                const job: JobStatusResponse = await res.json();
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
    const response = await fetch(`${apiBase}/profile/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        return null;
    }
    return response.json() as Promise<ProfileResponse | null>;
}

export async function saveProfile(token: string, data: ProfileResponse): Promise<void> {
    await fetch(`${apiBase}/profile`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
    });
}

export async function devAddTokens(token: string): Promise<{ ok: boolean; tokens: number }> {
    const response = await fetch(`${apiBase}/payments/dev-add-tokens`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Błąd doładowania tokenów (HTTP ${response.status}).`);
    }
    return response.json() as Promise<{ ok: boolean; tokens: number }>;
}

export async function getGoogleClientId(): Promise<GoogleClientIdResponse> {
    const response = await fetch(`${apiBase}/auth/google/client-id`);
    if (!response.ok) {
        throw new Error('Nie udało się pobrać konfiguracji Google.');
    }
    return response.json() as Promise<GoogleClientIdResponse>;
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
    const response = await fetch(`${apiBase}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: credential }),
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
    return response.json() as Promise<AuthApiResponse>;
}
