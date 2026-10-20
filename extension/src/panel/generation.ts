import { ApiVariant, GenerateJobStatus, GenerateResponse, VariantPreview } from './types';
import { GENERATION_TIMEOUT_MESSAGE, base64ToObjectUrl, extractBase64 } from './utils';

export const JOB_POLL_INTERVAL_MS = 1500;
// Generous upper bound: three chained variants on a cold server can take minutes.
export const JOB_TIMEOUT_MS = 5 * 60 * 1000;

export function toVariantPreviews(variants: (ApiVariant | null)[], fallbackMimeType?: string | null): VariantPreview[] {
    return variants
        .filter((variant): variant is ApiVariant => variant !== null)
        .map((variant) => {
            const base64 = extractBase64(variant.image_base64);
            return {
                url: variant.image_url || base64ToObjectUrl(base64, variant.mime_type ?? fallbackMimeType),
                mimeType: variant.mime_type || fallbackMimeType || undefined,
                latencyMs: variant.latency_ms ?? undefined,
            };
        })
        .filter((variant) => Boolean(variant.url));
}

export function describeGenerationError(message: string): string {
    if (message === 'interrupted') {
        return 'Generowanie zostało przerwane przez restart serwera. Tokeny zwrócono — spróbuj ponownie.';
    }
    if (message.includes('Failed to fetch product page')) {
        return 'Sklep blokuje pobranie strony produktu. Wklej bezpośredni link do zdjęcia produktu (JPG/PNG) albo spróbuj innego URL produktu.';
    }
    if (message.includes('incompatible_category:masculine_intimate')) {
        return 'Bielizna, stroje kąpielowe i kreacje intymne nie są dostępne dla mężczyzn.';
    }
    if (message.includes('incompatible_category:masculine_feminine')) {
        return 'Ta kategoria damska nie jest dostępna dla mężczyzn.';
    }
    if (message.includes('category_required')) return 'Wybierz kategorię produktu.';
    if (message.includes('invalid_category')) return 'Wybrana kategoria produktu jest nieobsługiwana.';
    return message;
}

// `detail` is a stable code from the backend; raw provider errors stay in server logs.
export function describeFallback(data: Pick<GenerateResponse, 'status' | 'detail'>): string {
    if (data.status === 'refused' || data.detail === 'content_policy') {
        return 'Ten produkt nie może zostać wygenerowany — polityka moderacji treści nie pozwala na tę kombinację zdjęcia i produktu.';
    }
    if (data.detail === 'service_unavailable') {
        return 'Usługa generowania jest chwilowo niedostępna. Spróbuj ponownie za kilka minut — tokeny za tę próbę nie zostały pobrane.';
    }
    return 'Generacja nieudana. Spróbuj ponownie — tokeny za tę próbę nie zostały pobrane.';
}

export function describeSuccess(variantCount: number, refundedTokens: number): string {
    const ready = `Gotowe: ${variantCount} wariant${variantCount === 1 ? '' : 'y'}.`;
    if (refundedTokens <= 0) return ready;
    const tokens = refundedTokens === 1 ? 'token' : refundedTokens < 5 ? 'tokeny' : 'tokenów';
    return `${ready} Zwrócono ${refundedTokens} ${tokens} za warianty, które się nie udały lub nie wymagały ponownego generowania.`;
}

interface PollOptions {
    getJob: (jobId: string) => Promise<GenerateJobStatus>;
    // Called with the variants that are ready so far (null = still rendering).
    onProgress?: (variants: (ApiVariant | null)[]) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    intervalMs?: number;
    timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll an async generation job until it completes, reporting partial variants. */
export async function pollGenerationJob(jobId: string, options: PollOptions): Promise<GenerateResponse> {
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;
    const deadline = now() + (options.timeoutMs ?? JOB_TIMEOUT_MS);
    let reportedReady = -1;

    while (now() < deadline) {
        const job = await options.getJob(jobId);
        if (job.status === 'completed' && job.result) {
            return { ...job.result, variants: (job.result.variants ?? []).filter((v): v is ApiVariant => v !== null) };
        }
        if (job.status === 'failed') {
            throw new Error(job.error || 'Generacja nieudana. Spróbuj ponownie.');
        }
        const partial = job.result?.variants ?? [];
        const ready = partial.filter((variant) => variant !== null).length;
        if (ready > reportedReady) {
            reportedReady = ready;
            options.onProgress?.(partial);
        }
        await sleep(options.intervalMs ?? JOB_POLL_INTERVAL_MS);
    }
    throw new Error(GENERATION_TIMEOUT_MESSAGE);
}
