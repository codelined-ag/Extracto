import type { ProviderKind } from "@/lib/api-types";

export type PricingSource =
  | "openrouter-live"
  | "mistral-static"
  | "litellm-mirror"
  | "ollama-local"
  | "user-override"
  | "unknown";

export interface ModelPricing {
  inputCostPerToken: number;
  outputCostPerToken: number;
  inputCostPerImage: number;
  inputCostPerPage: number;
  flatPerRequest: number;
  source: PricingSource;
  lastVerified?: string;
  warnings: string[];
}

export interface OcrCostBreakdown {
  inputCost: number;
  outputCost: number;
  imageCost: number;
  flatRequestCost: number;
  perPageRate: number;
  totalCost: number;
  pricing: ModelPricing;
  pageCount: number;
  outputTokensPerPage: number;
  inputTokensPerPage: number;
}

export interface OcrCostInput {
  provider: ProviderKind;
  apiEndpoint: string;
  model: string;
  pageCount: number;
  outputTokensPerPage: number;
  inputTokensPerPage: number;
}

export interface OcrEstimateRequest {
  files: Array<{ pageCount: number; fileName?: string }>;
  provider?: ProviderKind;
  model?: string;
  apiEndpoint?: string;
  postProcessing?: {
    enabled?: boolean;
    model?: string;
    outputFormat?: "markdown" | "json";
  };
  outputTokensPerPage?: number;
  inputTokensPerPage?: number;
}

export interface OcrEstimateFile {
  fileName?: string;
  pageCount: number;
  cost: OcrCostBreakdown;
}

export interface OcrEstimateResponse {
  currency: "USD";
  totalPages: number;
  total: number;
  perPage: number;
  ocr: OcrCostBreakdown;
  postProcessing?: OcrCostBreakdown | null;
  files: OcrEstimateFile[];
  assumptions: {
    outputTokensPerPage: number;
    inputTokensPerPage: number;
    postProcessingOutputTokensPerPage: number;
  };
  warnings: string[];
}
