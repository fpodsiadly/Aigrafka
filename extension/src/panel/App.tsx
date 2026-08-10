import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logo from '../../icons/logo_white.svg';

import { useAppStore } from '../store/appStore';

import {
    FormState,
    GenerateResponse,
    ProductImageKey,
    VariantPreview,
} from './types';
import {
    authStorage,
    base64ToObjectUrl,
    extractBase64,
    hasAnyBodyMetrics,
    initialState,
    normalizeProductUrl,
    placeholderPreview,
    revokeObjectUrl,
    selfieStorage,
    storage,
    toRequestErrorMessage,
    validProductUrl,
} from './utils';
import {
    authLogin,
    authRegister,
    authMe,
    devAddTokens,
    getDemoAccessStatus,
    googleLogin,
    loadProfile,
    pollJobStatus,
    saveProfile,
    startDemoAccess,
    startCheckout,
    submitGenerate,
} from './api';
import { actionButtonStyle, badge, inputStyle } from './styles';
import useDebouncedCallback from './hooks/useDebouncedCallback';
import { captureVisibleTab, cropFromScreenshot, pickAreaOnPage } from './capture';

import AuthPanel from './components/AuthPanel';
import FieldRow from './components/FieldRow';
import GenerationResult from './components/GenerationResult';
import MetricsForm from './components/MetricsForm';
import PanelHeader from './components/PanelHeader';
import ProductForm from './components/ProductForm';
import SelfieUpload from './components/SelfieUpload';

const App: React.FC = () => {
    const [form, setForm] = useState<FormState>(initialState);

    const auth = useAppStore((state) => state.auth);
    const setAuth = useAppStore((state) => state.setAuth);
    const view = useAppStore((state) => state.view);
    const setView = useAppStore((state) => state.setView);
    const variants = useAppStore((state) => state.variants);
    const setVariants = useAppStore((state) => state.setVariants);
    const selectedVariant = useAppStore((state) => state.selectedVariant);
    const setSelectedVariant = useAppStore((state) => state.setSelectedVariant);
    const previewUrl = useAppStore((state) => state.previewUrl);
    const setPreviewUrl = useAppStore((state) => state.setPreviewUrl);
    const isLoading = useAppStore((state) => state.isLoading);
    const setIsLoading = useAppStore((state) => state.setIsLoading);
    const generationError = useAppStore((state) => state.generationError);
    const setGenerationError = useAppStore((state) => state.setGenerationError);
    const status = useAppStore((state) => state.status);
    const statusTone = useAppStore((state) => state.statusTone);
    const setStatusSuccess = useAppStore((state) => state.setStatusSuccess);
    const setStatusError = useAppStore((state) => state.setStatusError);
    const generationMeta = useAppStore((state) => state.generationMeta);
    const setGenerationMeta = useAppStore((state) => state.setGenerationMeta);
    const resetGenerationState = useAppStore((state) => state.resetGenerationState);

    const [selfiePreview, setSelfiePreview] = useState<string>('');
    const [productPreview1, setProductPreview1] = useState<string>('');
    const [productPreview2, setProductPreview2] = useState<string>('');
    const [storageHydrated, setStorageHydrated] = useState<boolean>(false);
    const [showMeasurements, setShowMeasurements] = useState<boolean>(false);
    const [autoExpandedMeasurementsKey, setAutoExpandedMeasurementsKey] = useState<string | null>(null);
    const [showAuthDialog, setShowAuthDialog] = useState<boolean>(false);
    const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
    const [authEmail, setAuthEmail] = useState<string>('');
    const [authPassword, setAuthPassword] = useState<string>('');
    const [authSubmitting, setAuthSubmitting] = useState<boolean>(false);
    const [demoAccessEnabled, setDemoAccessEnabled] = useState<boolean>(false);
    const [googleClientId, setGoogleClientId] = useState<string | null>(null);
    const [googleReady, setGoogleReady] = useState<boolean>(false);
    const [googleInitialized, setGoogleInitialized] = useState<boolean>(false);
    const [profileReadyForUser, setProfileReadyForUser] = useState<string | null>(null);
    const [waitingPulse, setWaitingPulse] = useState<number>(0);
    const [elapsedSec, setElapsedSec] = useState<number>(0);
    const [inputHeight, setInputHeight] = useState<string>(form.height);
    const [inputChest, setInputChest] = useState<string>(form.chest);
    const [inputWaist, setInputWaist] = useState<string>(form.waist);
    const [inputHips, setInputHips] = useState<string>(form.hips);
    const [inputProductUrl, setInputProductUrl] = useState<string>(form.productUrl);
    const [inputCategory, setInputCategory] = useState<string>(form.category);
    const googleButtonRef = useRef<HTMLDivElement>(null);
    const storageSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pollAbortRef = useRef<AbortController | null>(null);
    const objectUrlsRef = useRef<string[]>([]);

    const revokeVariantUrls = useCallback(() => {
        objectUrlsRef.current.forEach(revokeObjectUrl);
        objectUrlsRef.current = [];
    }, []);

    const debouncedUpdateHeight = useDebouncedCallback((value: string) => updateForm('height', value), 300);
    const debouncedUpdateChest = useDebouncedCallback((value: string) => updateForm('chest', value), 300);
    const debouncedUpdateWaist = useDebouncedCallback((value: string) => updateForm('waist', value), 300);
    const debouncedUpdateHips = useDebouncedCallback((value: string) => updateForm('hips', value), 300);
    const debouncedUpdateProductUrl = useDebouncedCallback((value: string) => updateForm('productUrl', value), 300);
    const debouncedUpdateCategory = useDebouncedCallback((value: string) => updateForm('category', value), 300);

    const canSubmit = useMemo(() => {
        const hasProductImage = Boolean(form.productImage1) || Boolean(form.productImage2);
        const hasSelfie = !!form.selfie;
        if (!form.accepted || !hasProductImage || !hasSelfie) return false;
        return auth.loggedIn ? auth.tokens >= form.variantCount : true;
    }, [form, auth]);

    const fitStyleLabel: Record<FormState['fitStyle'], string> = {
        masculine: 'mężczyzna',
        feminine: 'kobieta',
        unisex: 'unisex',
    };
    const measurementSummary = `${form.height || '-'}/${form.chest || '-'}/${form.waist || '-'}/${form.hips || '-'}/${fitStyleLabel[form.fitStyle]}`;
    const measurementsSessionKey = auth.userId ? `user:${auth.userId}` : 'guest';
    const isProfileHydrating = Boolean(auth.loggedIn && auth.userId && profileReadyForUser !== auth.userId);
    const logoSrc = chrome?.runtime?.getURL?.('icons/logo_white.svg') ?? logo;
    const canShare = Boolean(form.productUrl || previewUrl);

    function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    const handleMetricChange = useCallback(
        (key: 'height' | 'chest' | 'waist' | 'hips', value: string) => {
            if (key === 'height') {
                setInputHeight(value);
                debouncedUpdateHeight(value);
            } else if (key === 'chest') {
                setInputChest(value);
                debouncedUpdateChest(value);
            } else if (key === 'waist') {
                setInputWaist(value);
                debouncedUpdateWaist(value);
            } else {
                setInputHips(value);
                debouncedUpdateHips(value);
            }
        },
        [debouncedUpdateHeight, debouncedUpdateChest, debouncedUpdateWaist, debouncedUpdateHips]
    );

    const handleProductUrlChange = useCallback(
        (value: string) => {
            setInputProductUrl(value);
            debouncedUpdateProductUrl(value);
        },
        [debouncedUpdateProductUrl]
    );

    const handleCategoryChange = useCallback(
        (value: string) => {
            setInputCategory(value);
            debouncedUpdateCategory(value);
        },
        [debouncedUpdateCategory]
    );

    useEffect(() => {
        Promise.all([storage.get(), selfieStorage.load()]).then(([stored, selfieFile]) => {
            if (stored) {
                setForm((prev) => ({ ...prev, ...stored }));
            }
            if (selfieFile) {
                setForm((prev) => ({ ...prev, selfie: selfieFile }));
            }
        }).finally(() => {
            setStorageHydrated(true);
        });
    }, []);

    useEffect(() => {
        if (form.selfie) {
            const url = URL.createObjectURL(form.selfie);
            setSelfiePreview(url);
            return () => URL.revokeObjectURL(url);
        }
        setSelfiePreview('');
        return undefined;
    }, [form.selfie]);

    useEffect(() => {
        if (form.productImage1) {
            const url = URL.createObjectURL(form.productImage1);
            setProductPreview1(url);
            return () => URL.revokeObjectURL(url);
        }
        setProductPreview1('');
        return undefined;
    }, [form.productImage1]);

    useEffect(() => {
        if (form.productImage2) {
            const url = URL.createObjectURL(form.productImage2);
            setProductPreview2(url);
            return () => URL.revokeObjectURL(url);
        }
        setProductPreview2('');
        return undefined;
    }, [form.productImage2]);

    useEffect(() => {
        setInputHeight(form.height);
        setInputChest(form.chest);
        setInputWaist(form.waist);
        setInputHips(form.hips);
        setInputProductUrl(form.productUrl);
        setInputCategory(form.category);
    }, [form.height, form.chest, form.waist, form.hips, form.productUrl, form.category]);

    useEffect(() => {
        if (!storageHydrated) return;
        if (isProfileHydrating) return;
        if (autoExpandedMeasurementsKey === measurementsSessionKey) return;

        setShowMeasurements(!hasAnyBodyMetrics(form));
        setAutoExpandedMeasurementsKey(measurementsSessionKey);
        // Only body-metric fields should retrigger this; full `form` would fire on unrelated edits.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        storageHydrated,
        isProfileHydrating,
        form.height,
        form.chest,
        form.waist,
        form.hips,
        measurementsSessionKey,
        autoExpandedMeasurementsKey,
    ]);

    const hydrateProfile = useCallback(async (userId: string, token: string) => {
        try {
            const profile = await loadProfile(userId, token);
            if (!profile) {
                setProfileReadyForUser(userId);
                return;
            }
            setForm((prev) => ({
                ...prev,
                height: profile.height || prev.height,
                chest: profile.chest || prev.chest,
                waist: profile.waist || prev.waist,
                hips: profile.hips || prev.hips,
                fitStyle:
                    profile.fitStyle === 'feminine' || profile.fitStyle === 'unisex' || profile.fitStyle === 'masculine'
                        ? profile.fitStyle
                        : prev.fitStyle,
                accepted: typeof profile.consentGiven === 'boolean' ? profile.consentGiven : prev.accepted,
            }));
        } catch (error) {
            console.error(error);
        } finally {
            setProfileReadyForUser(userId);
        }
    }, []);

    const refreshAuthFromServer = useCallback(async (tokenOverride?: string | null): Promise<boolean> => {
        const token = tokenOverride ?? auth.accessToken;
        if (!token) {
            setAuth({ loggedIn: false, tokens: 0, accessToken: null, email: undefined, userId: undefined });
            setProfileReadyForUser(null);
            return false;
        }

        try {
            const data = await authMe(token);
            setAuth({ loggedIn: true, tokens: data.tokens, accessToken: token, email: data.email, userId: data.user_id });
            await hydrateProfile(data.user_id, token);
            return true;
        } catch (error) {
            console.error(error);
            await authStorage.clearToken();
            setAuth({ loggedIn: false, tokens: 0, accessToken: null, email: undefined, userId: undefined });
            setProfileReadyForUser(null);
            return false;
        }
    }, [auth.accessToken, hydrateProfile, setAuth]);

    const handleLogin = useCallback(() => {
        setAuthMode('login');
        setAuthEmail(auth.email ?? '');
        setAuthPassword('');
        setShowAuthDialog(true);
    }, [auth.email]);

    const handleDemoAccess = useCallback(async () => {
        setAuthSubmitting(true);
        try {
            const data = await startDemoAccess();
            await authStorage.setToken(data.access_token);
            setAuth({ loggedIn: true, tokens: data.tokens, accessToken: data.access_token, email: data.email, userId: data.user_id });
            setShowAuthDialog(false);
            setStatusSuccess('Włączono Tryb demo. Generacje nie wymagają płatności.');
        } catch (error) {
            setStatusError(error instanceof Error ? error.message : 'Tryb demo jest niedostępny.');
        } finally {
            setAuthSubmitting(false);
        }
    }, [setAuth, setStatusError, setStatusSuccess]);

    const closeAuthDialog = useCallback(() => {
        if (authSubmitting) return;
        setShowAuthDialog(false);
    }, [authSubmitting]);

    async function handleAuthSubmit(event: React.FormEvent) {
        event.preventDefault();
        const email = authEmail.trim();
        const password = authPassword;

        if (!email.includes('@')) {
            setStatusError('Podaj poprawny adres email.');
            return;
        }
        if (password.length < 6) {
            setStatusError('Hasło musi mieć co najmniej 6 znaków.');
            return;
        }

        setAuthSubmitting(true);
        try {
            let data: Awaited<ReturnType<typeof authRegister>>;
            try {
                data = await (authMode === 'register' ? authRegister(email, password) : authLogin(email, password));
            } catch (error) {
                if (authMode === 'register' && error instanceof Error && error.message.toLowerCase().includes('409')) {
                    data = await authLogin(email, password);
                } else {
                    throw error;
                }
            }
            await authStorage.setToken(data.access_token);
            setAuth({ loggedIn: true, tokens: data.tokens, accessToken: data.access_token, email: data.email, userId: data.user_id });
            await hydrateProfile(data.user_id, data.access_token);
            setShowAuthDialog(false);
            setStatusSuccess(`Zalogowano jako ${data.email}.`);
        } catch (error) {
            console.error(error);
            setStatusError(error instanceof Error ? error.message : 'Błąd logowania.');
        } finally {
            setAuthSubmitting(false);
        }
    }

    const handleGoogleCredential = useCallback(async (credential: string) => {
        if (!credential) {
            setStatusError('Nie udało się pobrać tokenu Google.');
            return;
        }
        setAuthSubmitting(true);
        try {
            const data = await googleLogin(credential);
            await authStorage.setToken(data.access_token);
            setAuth({ loggedIn: true, tokens: data.tokens, accessToken: data.access_token, email: data.email, userId: data.user_id });
            await hydrateProfile(data.user_id, data.access_token);
            setShowAuthDialog(false);
            setStatusSuccess(`Zalogowano przez Google jako ${data.email}.`);
        } catch (error) {
            console.error(error);
            setStatusError(error instanceof Error ? error.message : 'Błąd logowania Google.');
        } finally {
            setAuthSubmitting(false);
        }
    }, [hydrateProfile, setAuth, setStatusError, setStatusSuccess]);

    const handleLogout = useCallback(async () => {
        await authStorage.clearToken();
        setAuth({ loggedIn: false, tokens: 0, accessToken: null, email: undefined, userId: undefined });
        setProfileReadyForUser(null);
        setForm((prev) => ({ ...prev, height: '', chest: '', waist: '', hips: '' }));
        setStatusSuccess('Wylogowano.');
    }, [setAuth, setStatusSuccess]);

    async function handleTopUpTokens() {
        if (!auth.loggedIn || !auth.accessToken) {
            setStatusError('Najpierw zaloguj się, aby doładować tokeny.');
            return;
        }
        setIsLoading(true);
        try {
            try {
                const data = await devAddTokens(auth.accessToken);
                setAuth({ tokens: data.tokens ?? auth.tokens + 5 });
                setStatusSuccess('Dodano 5 tokenów.');
                return;
            } catch (error) {
                if (error instanceof Error && error.message.includes('403')) {
                    // fall through to real checkout
                } else {
                    setStatusError('Błąd doładowania tokenów. Spróbuj ponownie.');
                    return;
                }
            }

            try {
                const response = await startCheckout(auth.accessToken, 'starter', auth.userId, auth.email);
                if (!response?.ok) {
                    throw new Error(response?.error || 'Nie udało się rozpocząć płatności.');
                }
                setStatusSuccess('Przekierowano do płatności Przelewy24.');
            } catch (error) {
                console.error(error);
                setStatusError(error instanceof Error ? error.message : 'Nie udało się doładować tokenów.');
            }
        } finally {
            setIsLoading(false);
        }
    }

    // Debounced persist of storable fields (400 ms after last change)
    useEffect(() => {
        if (!storageHydrated) return;
        if (storageSaveTimerRef.current) clearTimeout(storageSaveTimerRef.current);
        storageSaveTimerRef.current = setTimeout(() => {
            const toPersist: Partial<FormState> = {};
            const storableKeys: (keyof FormState)[] = ['height', 'chest', 'waist', 'hips', 'fitStyle', 'category', 'productUrl'];
            storableKeys.forEach((k) => {
                (toPersist as Record<string, unknown>)[k] = form[k];
            });
            void storage.set(toPersist);
        }, 400);
        return () => {
            if (storageSaveTimerRef.current) clearTimeout(storageSaveTimerRef.current);
        };
        // Only storable fields should retrigger persistence; full `form` would over-fire.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageHydrated, form.height, form.chest, form.waist, form.hips, form.fitStyle, form.category, form.productUrl]);

    useEffect(() => {
        getDemoAccessStatus().then(setDemoAccessEnabled).catch(() => setDemoAccessEnabled(false));
    }, []);

    useEffect(() => {
        authStorage.getToken().then((token) => {
            if (!token) return;
            refreshAuthFromServer(token);
        });
    }, [refreshAuthFromServer]);

    useEffect(() => {
        if (!auth.loggedIn || !auth.accessToken || !auth.userId) return;
        if (profileReadyForUser !== auth.userId) return;

        const timeoutId = window.setTimeout(() => {
            saveProfile(auth.accessToken as string, {
                userId: auth.userId as string,
                height: form.height,
                chest: form.chest,
                waist: form.waist,
                hips: form.hips,
                fitStyle: form.fitStyle,
                consentGiven: form.accepted,
            }).catch((error) => console.error(error));
        }, 450);

        return () => window.clearTimeout(timeoutId);
    }, [
        auth.loggedIn,
        auth.accessToken,
        auth.userId,
        profileReadyForUser,
        form.height,
        form.chest,
        form.waist,
        form.hips,
        form.fitStyle,
        form.accepted,
    ]);

    useEffect(() => {
        if (!showAuthDialog) return;

        // Google GIS injects a remote script, which MV3 extension CSP blocks.
        // Keep the email/password flow available until chrome.identity OAuth is wired.
        setGoogleClientId(null);
        setGoogleReady(false);
        setGoogleInitialized(false);
    }, [showAuthDialog]);

    useEffect(() => {
        if (!googleReady || !googleClientId || googleInitialized) return;
        if (!window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: (response) => {
                if (response?.credential) {
                    handleGoogleCredential(response.credential);
                } else {
                    setStatusError('Google nie zwrócił poświadczenia.');
                }
            },
        });
        setGoogleInitialized(true);
    }, [googleReady, googleClientId, googleInitialized, handleGoogleCredential, setStatusError]);

    useEffect(() => {
        if (!showAuthDialog || !googleInitialized) return;
        if (!googleButtonRef.current || !window.google?.accounts?.id) return;

        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleButtonRef.current, {
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            width: 280,
        });
    }, [showAuthDialog, googleInitialized]);

    useEffect(() => {
        if (!showAuthDialog) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeAuthDialog();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [showAuthDialog, closeAuthDialog]);

    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === 'visible' && auth.loggedIn) {
                void refreshAuthFromServer();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [auth.loggedIn, refreshAuthFromServer]);

    async function pollJob(jobId: string): Promise<GenerateResponse> {
        pollAbortRef.current?.abort();
        const controller = new AbortController();
        pollAbortRef.current = controller;
        return pollJobStatus(jobId, auth.accessToken, controller.signal);
    }

    useEffect(() => {
        return () => {
            pollAbortRef.current?.abort();
            revokeVariantUrls();
        };
    }, [revokeVariantUrls]);

    async function runGeneration() {
        if (!canSubmit || !form.selfie) return;

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
        setElapsedSec(0);
        const startedAt = performance.now();

        const formData = new FormData();
        if (normalizedProductUrl) formData.append('product_url', normalizedProductUrl);
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

        let succeeded = false;

        try {
            const response = await submitGenerate(formData, auth.accessToken);
            const data = await pollJob(response.job_id);

            // Release blob URLs from a previous generation before creating new ones.
            revokeVariantUrls();

            const normalizedVariants: VariantPreview[] = (data.variants ?? [])
                .map((variant) => {
                    const base64 = extractBase64(variant.image_base64);
                    return {
                        url: base64ToObjectUrl(base64, variant.mime_type ?? data.mime_type),
                        mimeType: variant.mime_type || data.mime_type || undefined,
                        latencyMs: variant.latency_ms ?? undefined,
                    };
                })
                .filter((v) => Boolean(v.url));

            const isFallback = data.status === 'fallback' || data.status === 'refused' || normalizedVariants.length === 0;
            const fallbackBase64 = extractBase64(data.image_base64);
            if (!normalizedVariants.length && fallbackBase64) {
                normalizedVariants.push({
                    url: base64ToObjectUrl(fallbackBase64, data.mime_type ?? 'image/jpeg'),
                    mimeType: data.mime_type ?? undefined,
                });
            }

            objectUrlsRef.current = normalizedVariants.map((v) => v.url).filter((u) => u.startsWith('blob:'));

            const firstUrl = normalizedVariants[0]?.url || placeholderPreview;
            setVariants(normalizedVariants);
            setSelectedVariant(0);
            setPreviewUrl(firstUrl);
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
                let fallbackMsg: string;
                if (data.status === 'refused' || data.detail === 'content_policy') {
                    fallbackMsg = 'Ten produkt nie może zostać wygenerowany — polityka moderacji treści nie pozwala na tę kombinację zdjęcia i produktu.';
                } else {
                    const detail = data.detail ? `: ${data.detail}` : '';
                    fallbackMsg = `Generacja nieudana${detail}. Spróbuj ponownie.`;
                }
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
                succeeded = false;
                if (normalizedVariants.length > 0) {
                    setPreviewUrl(normalizedVariants[0].url);
                    setVariants(normalizedVariants);
                } else {
                    setPreviewUrl(placeholderPreview);
                    setVariants([]);
                }
            } else {
                setStatusSuccess(`Gotowe: ${variantCount} wariant${variantCount === 1 ? '' : 'y'}.`);
                succeeded = true;
            }
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            console.error(error);
            let message = toRequestErrorMessage(error, 'Nie udało się wygenerować stylizacji.');
            if (message.includes('Failed to fetch product page')) {
                message = 'Sklep blokuje pobranie strony produktu. Wklej bezpośredni link do zdjęcia produktu (JPG/PNG) albo spróbuj innego URL produktu.';
            }
            if (message.includes('incompatible_category:masculine_swimwear')) {
                message = 'Wybrana kategoria produktu (strój kąpielowy / bielizna) nie jest dostępna dla kroju męskiego. Zmień kategorię lub styl dopasowania.';
            }
            setView('generating');
            setPreviewUrl(placeholderPreview);
            setGenerationError(message);
            setStatusError(message);
        } finally {
            setIsLoading(false);
            if (succeeded && auth.loggedIn) await refreshAuthFromServer();
        }
    }

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setGenerationError('');
        await runGeneration();
    }

    function handleGenerateMore() {
        setGenerationError('');
        void runGeneration();
    }

    async function handleShare() {
        const shareUrl = form.productUrl || previewUrl || undefined;
        const imageUrl = variants[selectedVariant]?.url || previewUrl || undefined;
        try {
            if (navigator.share) {
                if (imageUrl && typeof navigator.canShare === 'function') {
                    try {
                        const response = await fetch(imageUrl);
                        const blob = await response.blob();
                        const extension = blob.type.includes('png') ? 'png' : 'jpg';
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
        const text = form.productUrl || previewUrl || 'https://aigrafka.pl';
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

    function handleDownload() {
        const url = variants[selectedVariant]?.url || previewUrl;
        if (!url) return;
        const a = document.createElement('a');
        a.href = url;
        const ext = variants[selectedVariant]?.mimeType?.includes('png') ? 'png' : 'jpg';
        a.download = `aigrafka-stylizacja.${ext}`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function handleFileSelect(key: ProductImageKey, file: File | null) {
        updateForm(key, file);
        if (file) {
            setStatusSuccess(`Dodano ${file.name}`);
        }
    }

    async function handleDropProduct(key: ProductImageKey, event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();
        const dt = event.dataTransfer;

        if (dt.files && dt.files.length > 0) {
            const file = dt.files[0];
            if (file.size > 8 * 1024 * 1024) {
                setStatusError('Plik jest za duży. Maksymalny rozmiar to 8 MB.');
                return;
            }
            handleFileSelect(key, file);
            return;
        }

        const url = dt.getData('text/uri-list') || dt.getData('text/plain');
        if (url && /^https?:\/\//i.test(url)) {
            try {
                const resp = await fetch(url, { mode: 'cors' });
                const blob = await resp.blob();
                const name = url.split('/').pop()?.split('?')[0] || 'obraz.jpg';
                const fetched = new File([blob], name, { type: blob.type || 'image/jpeg' });
                handleFileSelect(key, fetched);
                return;
            } catch (error) {
                console.error(error);
                setStatusError('Nie udało się pobrać obrazu z linku (CORS).');
            }
        }

        setStatusError('Upuść plik obrazu lub link http/https.');
    }


    async function handlePickAreaProduct(key: ProductImageKey) {
        try {
            setStatusSuccess('Zaznacz obszar zdjęcia produktu na stronie.');
            const area = await pickAreaOnPage();
            if (!area) {
                setStatusSuccess('Anulowano zaznaczanie obszaru.');
                return;
            }
            const screenshot = await captureVisibleTab();
            const blob = await cropFromScreenshot(screenshot, area);
            const file = new File([blob], `produkt-${Date.now()}.png`, { type: 'image/png' });
            handleFileSelect(key, file);
            setStatusSuccess('Dodano zdjęcie z zaznaczonego obszaru.');
        } catch (error) {
            console.error(error);
            setStatusError(error instanceof Error ? error.message : 'Nie udało się pobrać zaznaczonego obszaru.');
        }
    }

    function handleChangeParams() {
        setForm((prev) => ({
            ...prev,
            selfie: null,
            productImage1: null,
            productImage2: null,
            productUrl: '',
        }));
        setSelfiePreview('');
        setProductPreview1('');
        setProductPreview2('');
        setGenerationError('');
        setStatusSuccess('');
        setView('form');
        void selfieStorage.clear();
    }

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
        if (!isLoading) {
            setElapsedSec(0);
            return;
        }
        setElapsedSec(0);
        const interval = window.setInterval(() => {
            setElapsedSec((prev) => prev + 1);
        }, 1000);
        return () => window.clearInterval(interval);
    }, [isLoading]);

    return (
        <div className="aigrafka-shell" style={{ display: 'flex', flexDirection: 'column', background: '#dcdcdc', color: '#1e1e1e', height: 'auto', width: '100%' }}>
            <PanelHeader logoSrc={logoSrc} loggedIn={auth.loggedIn} userEmail={auth.email} onLogin={handleLogin} onLogout={handleLogout} />
            <div style={{ padding: '10px 12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {view === 'form' && <div style={{ fontSize: 12, fontWeight: 700, color: '#1c1c1c' }}>Witaj! Co dziś przymierzymy?</div>}

                {view === 'form' && (
                    <form id="aigrafka-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ ...badge, boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
                            <MetricsForm
                                height={form.height}
                                chest={form.chest}
                                waist={form.waist}
                                hips={form.hips}
                                fitStyle={form.fitStyle}
                                inputHeight={inputHeight}
                                inputChest={inputChest}
                                inputWaist={inputWaist}
                                inputHips={inputHips}
                                showMeasurements={showMeasurements}
                                measurementSummary={measurementSummary}
                                onToggleMeasurements={() => setShowMeasurements((prev) => !prev)}
                                onMetricChange={handleMetricChange}
                                onFitStyleChange={(value) => updateForm('fitStyle', value)}
                            />

                            <FieldRow label="Selfie:">
                                <SelfieUpload
                                    selfie={form.selfie}
                                    selfiePreview={selfiePreview}
                                    onSelfieChange={(file) => {
                                        updateForm('selfie', file);
                                        if (file) void selfieStorage.save(file);
                                    }}
                                    onSelfieClear={() => {
                                        updateForm('selfie', null);
                                        setSelfiePreview('');
                                        void selfieStorage.clear();
                                    }}
                                    onSizeError={(maxSizeMb) => setStatusError(`Selfie jest za duże (maks. ${maxSizeMb} MB).`)}
                                />
                            </FieldRow>
                        </div>

                        <div style={{ ...badge, boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <div style={{ fontWeight: 800, fontSize: 12, color: '#1c1c1c' }}>Wybrany produkt</div>
                                <span
                                    aria-hidden="true"
                                    style={{
                                        width: 16,
                                        height: 16,
                                        borderRadius: 6,
                                        background: '#8bb0d6',
                                        color: '#ffffff',
                                        fontSize: 11,
                                        display: 'grid',
                                        placeItems: 'center',
                                        fontWeight: 800,
                                    }}
                                >
                                    i
                                </span>
                            </div>

                            <ProductForm
                                productUrl={form.productUrl}
                                category={form.category}
                                inputProductUrl={inputProductUrl}
                                inputCategory={inputCategory}
                                productImage1={form.productImage1}
                                productImage2={form.productImage2}
                                productPreview1={productPreview1}
                                productPreview2={productPreview2}
                                onProductUrlChange={handleProductUrlChange}
                                onCategoryChange={handleCategoryChange}
                                onFileSelect={handleFileSelect}
                                onDropProduct={handleDropProduct}
                                onPickAreaProduct={handlePickAreaProduct}
                                onActiveTabUrl={() => {
                                    chrome.runtime.sendMessage(
                                        { type: 'AIGRAFKA_GET_ACTIVE_TAB_URL' },
                                        (response?: { ok?: boolean; url?: string; error?: string }) => {
                                            if (chrome.runtime.lastError) {
                                                setStatusError(chrome.runtime.lastError.message);
                                                return;
                                            }
                                            if (response?.ok && response.url) {
                                                updateForm('productUrl', response.url);
                                                return;
                                            }
                                            setStatusError(response?.error || 'Nie udało się odczytać aktywnej karty.');
                                        }
                                    );
                                }}
                            />
                        </div>

                        <div style={{ ...badge, boxShadow: '0 8px 16px rgba(0,0,0,0.08)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: '0 0 110px', maxWidth: '110px', fontWeight: 800, fontSize: 12, color: '#1e1e1e', lineHeight: 1.2 }}>
                                    Tokeny Stylizacji
                                </div>
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                                    {auth.loggedIn ? (
                                        <>
                                            <input
                                                style={{
                                                    ...inputStyle,
                                                    width: 70,
                                                    minWidth: 70,
                                                    textAlign: 'center',
                                                    padding: '6px 8px',
                                                    background: '#dcecd6',
                                                    borderColor: '#c5d9bf',
                                                }}
                                                value={auth.userId === 'demo' ? 'demo' : auth.tokens}
                                                readOnly
                                            />
                                            {auth.userId === 'demo' ? (
                                                <div style={{ flex: 1, fontSize: 10, fontWeight: 700, color: '#4f7f68', textAlign: 'center' }}>
                                                    Tryb demo
                                                </div>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={handleTopUpTokens}
                                                    disabled={isLoading}
                                                    style={{
                                                        ...actionButtonStyle,
                                                        background: isLoading ? '#b7a0e8' : '#9b59ff',
                                                        boxShadow: 'none',
                                                        padding: '7px 9px',
                                                        fontSize: 10,
                                                        flex: 1,
                                                        cursor: isLoading ? 'not-allowed' : 'pointer',
                                                    }}
                                                >
                                                    {isLoading ? '...' : 'Dokup tokeny'}
                                                </button>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                onClick={handleLogin}
                                                style={{ ...actionButtonStyle, flex: 1, padding: '7px 9px', fontSize: 10, background: '#9b59ff', boxShadow: 'none' }}
                                            >
                                                Zaloguj się
                                            </button>
                                            {demoAccessEnabled && (
                                                <button
                                                    type="button"
                                                    onClick={handleDemoAccess}
                                                    style={{ ...actionButtonStyle, flex: 1, padding: '7px 9px', fontSize: 10, background: '#4f7f68', boxShadow: 'none' }}
                                                >
                                                    Tryb demo
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>

                            <div style={{ height: 1, background: '#c7c7c7', margin: '8px 0' }} />

                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ flex: '0 0 110px', maxWidth: '110px', fontWeight: 800, fontSize: 12, color: '#1e1e1e', lineHeight: 1.2 }}>
                                    Liczba Stylizacji
                                </div>
                                <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <input
                                        style={{ ...inputStyle, flex: 1, textAlign: 'center', padding: '6px 8px' }}
                                        type="number"
                                        min={1}
                                        max={3}
                                        value={form.variantCount}
                                        onChange={(e) => updateForm('variantCount', Math.min(3, Math.max(1, Number(e.target.value) || 1)))}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => updateForm('variantCount', Math.max(1, form.variantCount - 1))}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', width: 32, minWidth: 32, padding: '5px 0', boxShadow: 'none' }}
                                    >
                                        −
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateForm('variantCount', Math.min(3, form.variantCount + 1))}
                                        style={{ ...actionButtonStyle, background: '#9b59ff', width: 32, minWidth: 32, padding: '5px 0', boxShadow: 'none' }}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            <div style={{ height: 1, background: '#c7c7c7', margin: '8px 0' }} />

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#1e1e1e', fontSize: '11px', lineHeight: 1.35 }}>
                                <input type="checkbox" checked={form.accepted} onChange={(e) => updateForm('accepted', e.target.checked)} style={{ marginTop: 2 }} />
                                <span>
                                    Potwierdzam prawo do wykorzystania wizerunku i akceptuję{' '}
                                    <a href="https://aigrafka.pl/regulamin" target="_blank" rel="noreferrer" style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}>
                                        Regulamin
                                    </a>
                                    {' '}i{' '}
                                    <a href="https://aigrafka.pl/polityka-prywatnosci" target="_blank" rel="noreferrer" style={{ color: '#6f45cc', fontWeight: 700, textDecoration: 'none' }}>
                                        Politykę prywatności
                                    </a>
                                    .
                                </span>
                            </label>
                        </div>

                        <button
                            type="submit"
                            style={{
                                ...actionButtonStyle,
                                width: '100%',
                                padding: '11px 12px',
                                background: canSubmit ? '#9b59ff' : '#b7b7b7',
                                cursor: canSubmit ? 'pointer' : 'not-allowed',
                                boxShadow: 'none',
                                borderRadius: 10,
                                fontSize: 13,
                                fontWeight: 600,
                            }}
                            disabled={!canSubmit || isLoading}
                        >
                            {isLoading ? 'Generowanie...' : 'Generuj stylizację!'}
                        </button>
                    </form>
                )}

                {view !== 'form' && (
                    <GenerationResult
                        view={view}
                        isLoading={isLoading}
                        generationError={generationError}
                        elapsedSec={elapsedSec}
                        waitingPulse={waitingPulse}
                        variants={variants}
                        selectedVariant={selectedVariant}
                        previewUrl={previewUrl}
                        generationMeta={generationMeta}
                        status={status}
                        statusTone={statusTone}
                        form={form}
                        auth={auth}
                        canSubmit={canSubmit}
                        canShare={canShare}
                        onVariantSelect={setSelectedVariant}
                        onGenerateMore={handleGenerateMore}
                        onChangeParams={handleChangeParams}
                        onShare={handleShare}
                        onCopyImage={handleCopyImage}
                        onDownload={handleDownload}
                        onAcceptedChange={(accepted) => updateForm('accepted', accepted)}
                        onVariantCountChange={(count) => updateForm('variantCount', count)}
                        onTopUp={handleTopUpTokens}
                        onLogin={handleLogin}
                    />
                )}

                <div style={{ textAlign: 'center', color: '#5b5b5b', fontSize: 9, marginTop: 4 }}>
                    <a href="https://aigrafka.pl" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                        AIgrafka.pl
                    </a>
                    {' | '}
                    <a href="https://aigrafka.pl/regulamin" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                        Regulamin
                    </a>
                    {' | '}
                    <a href="https://aigrafka.pl/polityka-prywatnosci" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                        Polityka prywatności
                    </a>
                    {' | '}
                    <a href="https://aigrafka.pl/kontakt" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                        Kontakt
                    </a>
                </div>
            </div>

            <AuthPanel
                showAuthDialog={showAuthDialog}
                authMode={authMode}
                authEmail={authEmail}
                authPassword={authPassword}
                authSubmitting={authSubmitting}
                demoAccessEnabled={demoAccessEnabled}
                googleClientId={googleClientId}
                googleReady={googleReady}
                googleInitialized={googleInitialized}
                googleButtonRef={googleButtonRef}
                onCloseDialog={closeAuthDialog}
                onToggleMode={setAuthMode}
                onEmailChange={setAuthEmail}
                onPasswordChange={setAuthPassword}
                onSubmit={handleAuthSubmit}
                onDemoAccess={handleDemoAccess}
            />
        </div>
    );
};

export default App;
