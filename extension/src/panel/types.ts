
export interface BodyMetrics {
    height: string;
    chest: string;
    waist: string;
    hips: string;
}

export interface FormState extends BodyMetrics {
    selfie: File | null;
    category: string;
    fitStyle: 'masculine' | 'feminine' | 'unisex';
    productUrl: string;
    productImage1: File | null;
    productImage2: File | null;
    accepted: boolean;
    variantCount: number;
    modelChoice: 'banana-pro-2';
}

export type ProductImageKey = 'productImage1' | 'productImage2';

export type StorableKey = keyof Pick<FormState, 'height' | 'chest' | 'waist' | 'hips' | 'category' | 'productUrl' | 'fitStyle'>;
export type Persistable = Pick<FormState, StorableKey>;
export const storableKeys: StorableKey[] = ['height', 'chest', 'waist', 'hips', 'fitStyle', 'category', 'productUrl'];

export type ApiBase64 = string | { image_base64?: string } | null | undefined;

export interface ApiVariant {
    image_base64?: ApiBase64;
    mime_type?: string | null;
    width?: number | null;
    height?: number | null;
    latency_ms?: number | null;
}

export interface GenerateResponse {
    status: string;
    image_base64?: ApiBase64;
    mime_type?: string | null;
    model?: string | null;
    variants?: ApiVariant[];
    detail?: string | null;  // error detail when status != 'generated'
}

export interface ShareData {
    title?: string;
    text?: string;
    url?: string;
    files?: File[];
}

export interface AuthApiResponse {
    access_token: string;
    token_type: string;
    user_id: string;
    email: string;
    tokens: number;
}

export interface AuthMeResponse {
    user_id: string;
    email: string;
    tokens: number;
}

export interface ProfileResponse {
    userId: string;
    height: string;
    chest: string;
    waist: string;
    hips: string;
    fitStyle?: FormState['fitStyle'] | null;
    consentGiven?: boolean | null;
}

export interface GoogleClientIdResponse {
    enabled: boolean;
    client_id?: string | null;
}

declare global {
    interface Window {
        google?: {
            accounts?: {
                id?: {
                    initialize: (options: { client_id: string; callback: (resp: { credential?: string }) => void }) => void;
                    renderButton: (container: HTMLElement, options: {
                        theme?: 'outline' | 'filled_blue' | 'filled_black';
                        size?: 'large' | 'medium' | 'small';
                        text?: 'signin_with' | 'continue_with' | 'signup_with';
                        shape?: 'rectangular' | 'pill' | 'circle' | 'square';
                        width?: number;
                    }) => void;
                };
            };
        };
    }
}

export interface VariantPreview {
    url: string;
    mimeType?: string;
    latencyMs?: number;
}
