
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
    image_url?: string | null;
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
    telemetry?: {
        upload_ms: number;
        rate_limit_ms: number;
        normalize_ms: number;
        redis_ms: number;
        product_fetch_ms: number;
        gemini_ms: number;
        response_encode_ms: number;
        total_ms: number;
        cache_hit: boolean;
    };
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

export interface VariantPreview {
    url: string;
    mimeType?: string;
    latencyMs?: number;
}
