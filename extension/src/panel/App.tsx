import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import logo from '../../icons/logo_white.svg';

import { useAppStore } from '../store/appStore';

import { FormState } from './types';
import { hasAnyBodyMetrics, initialState, selfieStorage, storage } from './utils';
import { actionButtonStyle, badge } from './styles';
import useDebouncedCallback from './hooks/useDebouncedCallback';
import useAuthSession from './hooks/useAuthSession';
import useGeneration from './hooks/useGeneration';
import useProductImageInput from './hooks/useProductImageInput';
import useResultActions from './hooks/useResultActions';
import { getCategoryError, toCategoryText } from './garmentPolicy';

import AuthPanel from './components/AuthPanel';
import FieldRow from './components/FieldRow';
import GenerationResult from './components/GenerationResult';
import MetricsForm from './components/MetricsForm';
import PanelFooter from './components/PanelFooter';
import PanelHeader from './components/PanelHeader';
import ProductForm from './components/ProductForm';
import SelfieUpload from './components/SelfieUpload';
import InfoTooltip from './components/InfoTooltip';
import TokensCard from './components/TokensCard';

const PRODUCT_INFO =
    'Wprowadzone informacje o produkcie posłużą do przygotowania wizualizacji. ' +
    'Upewnij się, że dane, które wprowadzisz, dotyczą pojedynczego produktu.\n\n' +
    'Pamiętaj, że wprowadzane dane muszą być zgodne z postanowieniami Regulaminu i Polityki Prywatności.';

const App: React.FC = () => {
    const [form, setForm] = useState<FormState>(initialState);

    const view = useAppStore((state) => state.view);
    const setView = useAppStore((state) => state.setView);
    const variants = useAppStore((state) => state.variants);
    const selectedVariant = useAppStore((state) => state.selectedVariant);
    const setSelectedVariant = useAppStore((state) => state.setSelectedVariant);
    const previewUrl = useAppStore((state) => state.previewUrl);
    const isLoading = useAppStore((state) => state.isLoading);
    const generationError = useAppStore((state) => state.generationError);
    const setGenerationError = useAppStore((state) => state.setGenerationError);
    const status = useAppStore((state) => state.status);
    const statusTone = useAppStore((state) => state.statusTone);
    const setStatusSuccess = useAppStore((state) => state.setStatusSuccess);
    const setStatusError = useAppStore((state) => state.setStatusError);
    const generationMeta = useAppStore((state) => state.generationMeta);

    const [selfiePreview, setSelfiePreview] = useState<string>('');
    const [productPreview1, setProductPreview1] = useState<string>('');
    const [productPreview2, setProductPreview2] = useState<string>('');
    const [storageHydrated, setStorageHydrated] = useState<boolean>(false);
    const [showMeasurements, setShowMeasurements] = useState<boolean>(false);
    const [autoExpandedMeasurementsKey, setAutoExpandedMeasurementsKey] = useState<string | null>(null);
    const [inputHeight, setInputHeight] = useState<string>(form.height);
    const [inputChest, setInputChest] = useState<string>(form.chest);
    const [inputWaist, setInputWaist] = useState<string>(form.waist);
    const [inputHips, setInputHips] = useState<string>(form.hips);
    const [inputProductUrl, setInputProductUrl] = useState<string>(form.productUrl);
    const [inputCategory, setInputCategory] = useState<string>(form.category);
    const storageSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const {
        auth,
        isProfileHydrating,
        showAuthDialog,
        authSubmitting,
        demoAccessEnabled,
        refreshAuthFromServer,
        handleLogin,
        handleDemoAccess,
        closeAuthDialog,
        handleGoogleLogin,
        handleLogout,
        handleTopUpTokens,
        handleDeleteMyData,
    } = useAuthSession({ form, setForm });

    const canSubmit = useMemo(() => {
        const hasProductImage = Boolean(form.productImage1) || Boolean(form.productImage2);
        const hasSelfie = !!form.selfie;
        if (!form.accepted || !hasProductImage || !hasSelfie || getCategoryError(form.category, form.fitStyle)) return false;
        return auth.loggedIn ? auth.tokens >= form.variantCount : true;
    }, [form, auth]);

    const { runGeneration, elapsedSec, waitingPulse } = useGeneration({ form, canSubmit, refreshAuthFromServer });
    const { handleShare, handleCopyImage, handleDownload } = useResultActions(form.productUrl);
    const { handleFileSelect, handleDropProduct, handlePickAreaProduct } = useProductImageInput((key, file) =>
        updateForm(key, file)
    );

    const debouncedUpdateHeight = useDebouncedCallback((value: string) => updateForm('height', value), 300);
    const debouncedUpdateChest = useDebouncedCallback((value: string) => updateForm('chest', value), 300);
    const debouncedUpdateWaist = useDebouncedCallback((value: string) => updateForm('waist', value), 300);
    const debouncedUpdateHips = useDebouncedCallback((value: string) => updateForm('hips', value), 300);
    const debouncedUpdateProductUrl = useDebouncedCallback((value: string) => updateForm('productUrl', value), 300);
    const debouncedUpdateCategory = useDebouncedCallback((value: string) => updateForm('category', value), 300);

    const fitStyleLabel: Record<FormState['fitStyle'], string> = {
        masculine: 'mężczyzna',
        feminine: 'kobieta',
        unisex: 'unisex',
    };
    const measurementSummary = `${form.height || '-'}/${form.chest || '-'}/${form.waist || '-'}/${form.hips || '-'}/${fitStyleLabel[form.fitStyle]}`;
    const measurementsSessionKey = auth.userId ? `user:${auth.userId}` : 'guest';
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
            const error = getCategoryError(value, form.fitStyle);
            if (error) setStatusError(error);
            else setStatusSuccess('');
        },
        [debouncedUpdateCategory, form.fitStyle, setStatusError, setStatusSuccess]
    );

    const handleFitStyleChange = useCallback(
        (value: FormState['fitStyle']) => {
            updateForm('fitStyle', value);
            const error = getCategoryError(form.category, value);
            if (error) setStatusError(error);
            else setStatusSuccess('');
        },
        [form.category, setStatusError, setStatusSuccess]
    );

    useEffect(() => {
        Promise.all([storage.get(), selfieStorage.load()]).then(([stored, selfieFile]) => {
            if (stored) {
                setForm((prev) => ({
                    ...prev,
                    ...stored,
                    category: stored.category ? toCategoryText(stored.category) : prev.category,
                }));
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

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setGenerationError('');
        await runGeneration();
    }

    function handleGenerateMore() {
        setGenerationError('');
        void runGeneration();
    }

    // Start over with another product: the selfie and measurements stay, so the
    // user does not have to upload them again for every garment.
    function handleChangeParams() {
        setForm((prev) => ({
            ...prev,
            productImage1: null,
            productImage2: null,
            productUrl: '',
        }));
        setProductPreview1('');
        setProductPreview2('');
        setGenerationError('');
        setStatusSuccess('');
        setView('form');
    }

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
                                onFitStyleChange={handleFitStyleChange}
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
                                <InfoTooltip label="Informacje o wybranym produkcie" content={PRODUCT_INFO} />
                            </div>

                            <ProductForm
                                productUrl={form.productUrl}
                                category={form.category}
                                inputProductUrl={inputProductUrl}
                                inputCategory={inputCategory}
                                categoryError={inputCategory ? getCategoryError(inputCategory, form.fitStyle) : null}
                                fitStyle={form.fitStyle}
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
                                                setStatusError(chrome.runtime.lastError.message || 'Nie udało się odczytać aktywnej karty.');
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

                        <TokensCard
                            auth={auth}
                            isLoading={isLoading}
                            demoAccessEnabled={demoAccessEnabled}
                            variantCount={form.variantCount}
                            accepted={form.accepted}
                            onTopUp={handleTopUpTokens}
                            onLogin={handleLogin}
                            onDemoAccess={handleDemoAccess}
                            onVariantCountChange={(count) => updateForm('variantCount', count)}
                            onAcceptedChange={(accepted) => updateForm('accepted', accepted)}
                        />

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

                <PanelFooter onDeleteMyData={handleDeleteMyData} />
            </div>

            <AuthPanel
                showAuthDialog={showAuthDialog}
                authSubmitting={authSubmitting}
                demoAccessEnabled={demoAccessEnabled}
                onCloseDialog={closeAuthDialog}
                onGoogleLogin={() => void handleGoogleLogin()}
                onDemoAccess={handleDemoAccess}
            />
        </div>
    );
};

export default App;
