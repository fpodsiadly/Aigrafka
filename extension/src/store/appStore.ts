import { create } from 'zustand';

import type { VariantPreview } from '../panel/types';

export interface AuthState {
    loggedIn: boolean;
    tokens: number;
    accessToken: string | null;
    email?: string;
    userId?: string;
}

interface AppState {
    auth: AuthState;
    view: 'form' | 'generating' | 'result';
    variants: VariantPreview[];
    selectedVariant: number;
    previewUrl: string;
    isLoading: boolean;
    generationError: string;
    status: string;
    statusTone: 'success' | 'error';
    generationMeta: { model?: string; latencyMs?: number };

    setAuth: (patch: Partial<AuthState>) => void;
    setView: (view: 'form' | 'generating' | 'result') => void;
    setVariants: (variants: VariantPreview[]) => void;
    setSelectedVariant: (index: number) => void;
    setPreviewUrl: (url: string) => void;
    setIsLoading: (loading: boolean) => void;
    setGenerationError: (error: string) => void;
    setStatusSuccess: (message: string) => void;
    setStatusError: (message: string) => void;
    setGenerationMeta: (meta: { model?: string; latencyMs?: number }) => void;
    resetGenerationState: () => void;
}

const initialAuth: AuthState = {
    loggedIn: false,
    tokens: 0,
    accessToken: null,
    email: undefined,
    userId: undefined,
};

export const useAppStore = create<AppState>((set) => ({
    auth: { ...initialAuth },
    view: 'form',
    variants: [],
    selectedVariant: 0,
    previewUrl: '',
    isLoading: false,
    generationError: '',
    status: '',
    statusTone: 'success',
    generationMeta: {},

    setAuth: (patch) => set((state) => ({ auth: { ...state.auth, ...patch } })),
    setView: (view) => set({ view }),
    setVariants: (variants) => set({ variants }),
    setSelectedVariant: (selectedVariant) => set({ selectedVariant }),
    setPreviewUrl: (previewUrl) => set({ previewUrl }),
    setIsLoading: (isLoading) => set({ isLoading }),
    setGenerationError: (generationError) => set({ generationError }),
    setStatusSuccess: (status) => set({ status, statusTone: 'success' }),
    setStatusError: (status) => set({ status, statusTone: 'error' }),
    setGenerationMeta: (generationMeta) => set({ generationMeta }),
    resetGenerationState: () => set({
        view: 'generating',
        status: '',
        generationError: '',
        isLoading: true,
        previewUrl: '',
        variants: [],
        selectedVariant: 0,
        generationMeta: {},
    }),
}));
