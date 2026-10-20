import { describe, expect, it, vi } from 'vitest';

import {
    describeFallback,
    describeGenerationError,
    describeSuccess,
    pollGenerationJob,
    toVariantPreviews,
} from './generation';
import { GenerateJobStatus } from './types';
import { GENERATION_TIMEOUT_MESSAGE } from './utils';

describe('toVariantPreviews', () => {
    it('keeps ready variants with an image URL and skips pending or empty ones', () => {
        const previews = toVariantPreviews([
            { image_url: 'https://api.test/images/a', mime_type: 'image/webp', latency_ms: 1200 },
            null,
            { image_url: null, mime_type: 'image/webp' },
        ]);

        expect(previews).toEqual([{ url: 'https://api.test/images/a', mimeType: 'image/webp', latencyMs: 1200 }]);
    });
});

describe('describeSuccess', () => {
    it('mentions refunded tokens only when there were any', () => {
        expect(describeSuccess(2, 0)).toBe('Gotowe: 2 warianty.');
        expect(describeSuccess(3, 1)).toContain('Zwrócono 1 token ');
        expect(describeSuccess(3, 2)).toContain('Zwrócono 2 tokeny');
    });
});

describe('error messages', () => {
    it('translates backend category errors', () => {
        expect(describeGenerationError('incompatible_category:masculine_intimate')).toContain('nie są dostępne dla mężczyzn');
        expect(describeGenerationError('category_required')).toBe('Wybierz kategorię produktu.');
        expect(describeGenerationError('interrupted')).toContain('Tokeny zwrócono');
        expect(describeGenerationError('Something else')).toBe('Something else');
    });

    it('explains content policy refusals', () => {
        expect(describeFallback({ status: 'refused' })).toContain('polityka moderacji');
        expect(describeFallback({ status: 'fallback', detail: 'service_unavailable' })).toContain('chwilowo niedostępna');
        expect(describeFallback({ status: 'fallback', detail: 'generation_failed' })).toContain('Generacja nieudana.');
        expect(describeFallback({ status: 'fallback', detail: 'RESOURCE_EXHAUSTED raw' })).not.toContain('RESOURCE');
    });
});

function jobSequence(statuses: GenerateJobStatus[]) {
    const getJob = vi.fn<(jobId: string) => Promise<GenerateJobStatus>>();
    statuses.forEach((status) => getJob.mockResolvedValueOnce(status));
    return getJob;
}

const noSleep = () => Promise.resolve();

describe('pollGenerationJob', () => {
    it('reports partial variants once each and resolves with the completed result', async () => {
        const first = { image_url: 'https://api.test/images/1', mime_type: 'image/webp' };
        const second = { image_url: 'https://api.test/images/2', mime_type: 'image/webp' };
        const getJob = jobSequence([
            { id: 'job', status: 'running', result: { status: 'running', variants: [null, null] } },
            { id: 'job', status: 'running', result: { status: 'running', variants: [first, null] } },
            { id: 'job', status: 'running', result: { status: 'running', variants: [first, null] } },
            { id: 'job', status: 'completed', result: { status: 'generated', model: 'm', variants: [first, second] } },
        ]);
        const onProgress = vi.fn();

        const result = await pollGenerationJob('job', { getJob, onProgress, sleep: noSleep });

        expect(result.status).toBe('generated');
        expect(result.variants).toEqual([first, second]);
        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenLastCalledWith([first, null]);
    });

    it('rejects with the job error when the job fails', async () => {
        const getJob = jobSequence([{ id: 'job', status: 'failed', error: 'Generation failed.' }]);

        await expect(pollGenerationJob('job', { getJob, sleep: noSleep })).rejects.toThrow('Generation failed.');
    });

    it('gives up after the timeout', async () => {
        let clock = 0;
        const getJob = vi.fn(async () => ({ id: 'job', status: 'pending' }));

        await expect(
            pollGenerationJob('job', {
                getJob,
                sleep: async (ms) => {
                    clock += ms;
                },
                now: () => clock,
                intervalMs: 1000,
                timeoutMs: 3000,
            })
        ).rejects.toThrow(GENERATION_TIMEOUT_MESSAGE);
        expect(getJob).toHaveBeenCalledTimes(3);
    });
});
