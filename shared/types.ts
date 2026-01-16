export interface BodyMetrics {
  height: string;
  chest: string;
  waist: string;
  hips: string;
}

export interface GenerateRequest {
  productUrl: string;
  category: string;
  metrics: BodyMetrics;
  selfieUrl?: string;
}
