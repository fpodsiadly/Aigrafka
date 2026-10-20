import { useCallback, useEffect, useRef, useState } from 'react';

import { useAppStore } from '../../store/appStore';
import { getGenerationJob, isGenerateJobAccepted, submitGenerate } from '../api';
import { getCategoryError } from '../garmentPolicy';
import {
    describeFallback,
    describeGenerationError,
    describeSuccess,
    pollGenerationJob,
    toVariantPreviews,
} from '../generation';
import { FormState, GenerateResponse, VariantPreview } from '../types';
import {
    base64ToObjectUrl,
    extractBase64,
    normalizeProductUrl,
    placeholderPreview,
    revokeObjectUrl,
    toRequestErrorMessage,
    validProductUrl,
} from '../utils';

interface UseGenerationArgs {
    form: FormState;
    canSubmit: boolean;
    refreshAuthFromServer: () => Promise<boolean>;
}

function buildGenerateFormData(form: FormState & { selfie: File }, productUrl: string, fresh: boolean): FormData {
    const formData = new FormData();
    // "Generate more" must render new images instead of returning cached ones.
    if (fresh) formData.append('fresh', 'true');
    if (productUrl) formData.append('product_url', productUrl);
    if (form.category) formData.append('category', form.category);
    if (form.fitStyle) formData.append('fit_style', form.fitStyle);
    if (form.modelChoice) formData.append('model_choice', form.modelChoice);
    if (form.height) formData.append('height_cm', form.height);
    if (form.chest) formData.append('chest_cm', form.chest);
    if (form.waist) formData.append('waist_cm', form.waist);
    if (form.hips) formData.append('hips_cm', form.hips);
    formData.append('selfie', form.selfie);
    formData.append('variants', String(form.variantCount));
    if (form.productImage1) formData.append('product_image_1', form.productImage1);
    if (form.productImage2) formData.append('product_image_2', form.productImage2);
    if (form.productInfo?.name) formData.append('product_name', form.productInfo.name);
    if (form.productInfo?.details) formData.append('product_details', form.productInfo.details);
    return formData;
}

export default function useGeneration({ form, canSubmit, refreshAuthFromServer }: UseGenerationArgs) {
    const auth = useAppStore((state) => state.auth);
    const view = useAppStore((state) => state.view);
    const setView = useAppStore((state) => state.setView);
    const variants = useAppStore((state) => state.variants);
    const setVariants = useAppStore((state) => state.setVariants);
    const selectedVariant = useAppStore((state) => state.selectedVariant);
    const setSelectedVariant = useAppStore((state) => state.setSelectedVariant);
    const setPreviewUrl = useAppStore((state) => state.setPreviewUrl);
    const isLoading = useAppStore((state) => state.isLoading);
    const setIsLoading = useAppStore((state) => state.setIsLoading);
    const setGenerationError = useAppStore((state) => state.setGenerationError);
    const setStatusSuccess = useAppStore((state) => state.setStatusSuccess);
    const setStatusError = useAppStore((state) => state.setStatusError);
    const setGenerationMeta = useAppStore((state) => state.setGenerationMeta);
    const resetGenerationState = useAppStore((state) => state.resetGenerationState);

    const [waitingPulse, setWaitingPulse] = useState<number>(0);
    const [elapsedSec, setElapsedSec] = useState<number>(0);
    const objectUrlsRef = useRef<string[]>([]);
    const isGeneratingRef = useRef(false);

    const revokeVariantUrls = useCallback(() => {
        objectUrlsRef.current.forEach(revokeObjectUrl);
        objectUrlsRef.current = [];
    }, []);

    const showVariants = useCallback(
        (previews: VariantPreview[]) => {
            // Release blob URLs from earlier previews before tracking the new ones.
            revokeVariantUrls();
            objectUrlsRef.current = previews.map((v) => v.url).filter((u) => u.startsWith('blob:'));
            setVariants(previews);
        },
        [revokeVariantUrls, setVariants]
    );

    useEffect(() => revokeVariantUrls, [revokeVariantUrls]);

    useEffect(() => {
        if (selectedVariant > 0 && selectedVariant >= variants.length) {
            setSelectedVariant(0);
        }
    }, [variants, selectedVariant, setSelectedVariant]);

    useEffect(() => {
        if (!(view === 'generating' && isLoading)) return;
        const timer = window.setInterval(() => {
            setWaitingPulse((prev) => (prev + 1) % 3);
        }, 320);
        return () => window.clearInterval(timer);
    }, [view, isLoading]);

    useEffect(() => {
        setElapsedSec(0);
        if (!isLoading) return;
        const interval = window.setInterval(() => {
            setElapsedSec((prev) => prev + 1);
        }, 1000);
        return () => window.clearInterval(interval);
    }, [isLoading]);

    async function runGeneration({ fresh = false }: { fresh?: boolean } = {}) {
        if (isGeneratingRef.current) return;
        if (!canSubmit || !form.selfie) return;

        const categoryError = getCategoryError(form.category, form.fitStyle);
        if (categoryError) {
            setStatusError(categoryError);
            return;
        }
        const normalizedProductUrl = form.productUrl ? normalizeProductUrl(form.productUrl) : '';
        const hasProductImage = Boolean(form.productImage1) || Boolean(form.productImage2);
        if (!hasProductImage) {
            setStatusError('Dodaj zdjęcie produktu (pierwsze lub drugie).');
            return;
        }
        if (normalizedProductUrl && !validProductUrl(normalizedProductUrl)) {
            setStatusError('Link do produktu ma nieprawidłowy format (wymagane http/https).');
            return;
        }
        if (auth.loggedIn && auth.tokens < form.variantCount) {
            setStatusError(`Za mało tokenów. Potrzeba: ${form.variantCount}.`);
            return;
        }

        resetGenerationState();
        setGenerationError('');
        const startedAt = performance.now();
        const formData = buildGenerateFormData({ ...form, selfie: form.selfie }, normalizedProductUrl, fresh);

        let succeeded = false;
        let shownPartial = false;

        isGeneratingRef.current = true;
        try {
            const submitted = await submitGenerate(formData, auth.accessToken);
            const data: GenerateResponse = isGenerateJobAccepted(submitted)
                ? await pollGenerationJob(submitted.job_id, {
                      getJob: (jobId) => getGenerationJob(jobId, auth.accessToken),
                      onProgress: (partial) => {
                          const previews = toVariantPreviews(partial);
                          if (!previews.length) return;
                          showVariants(previews);
                          if (!shownPartial) {
                              shownPartial = true;
                              setPreviewUrl(previews[0].url);
                              setView('result');
                          }
                      },
                  })
                : submitted;

            const normalizedVariants = toVariantPreviews(data.variants ?? [], data.mime_type);
            const isFallback = data.status === 'fallback' || data.status === 'refused' || normalizedVariants.length === 0;
            const fallbackBase64 = extractBase64(data.image_base64);
            if (!normalizedVariants.length && fallbackBase64) {
                normalizedVariants.push({
                    url: base64ToObjectUrl(fallbackBase64, data.mime_type ?? 'image/jpeg'),
                    mimeType: data.mime_type ?? undefined,
                });
            }

            showVariants(normalizedVariants);
            setPreviewUrl(normalizedVariants[0]?.url || placeholderPreview);
            setGenerationMeta({
                model: data.model ?? undefined,
                latencyMs: normalizedVariants[0]?.latencyMs,
            });

            if (import.meta.env.DEV) {
                const totalMs = performance.now() - startedAt;
                const backendMs = normalizedVariants[0]?.latencyMs ?? null;
                console.log('[AIgrafka] render complete', {
                    total_s: Number((totalMs / 1000).toFixed(2)),
                    backend_s: backendMs !== null ? Number((backendMs / 1000).toFixed(2)) : null,
                    variants: normalizedVariants.length,
                    model: data.model ?? 'unknown',
                });
            }

            const variantCount = normalizedVariants.length || 1;
            setView('result');
            if (isFallback) {
                const fallbackMsg = describeFallback(data);
                if (import.meta.env.DEV) {
                    console.warn('[AIgrafka] generation fallback', {
                        status: data.status,
                        detail: data.detail,
                        model: data.model,
                        variants: normalizedVariants.length,
                    });
                }
                setStatusError(fallbackMsg);
                setGenerationError(fallbackMsg);
                // Nothing to show: use the error screen with "try again" instead
                // of an empty result card.
                if (!normalizedVariants.length) {
                    setPreviewUrl(placeholderPreview);
                    setView('generating');
                }
            } else {
                setStatusSuccess(describeSuccess(variantCount, data.refunded_tokens ?? 0));
                succeeded = true;
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            console.error(error);
            const message = describeGenerationError(
                toRequestErrorMessage(error, 'Nie udało się wygenerować stylizacji.')
            );
            setStatusError(message);
            // Keep variants that already arrived visible; only fall back to the
            // error screen when nothing could be shown.
            if (!shownPartial) {
                setView('generating');
                setPreviewUrl(placeholderPreview);
                setGenerationError(message);
            }
        } finally {
            isGeneratingRef.current = false;
            setIsLoading(false);
            if ((succeeded || shownPartial) && auth.loggedIn) await refreshAuthFromServer();
        }
    }

    return { runGeneration, elapsedSec, waitingPulse };
}
