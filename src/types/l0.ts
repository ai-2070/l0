// Top-level runtime types
export interface L0Config {
  apiKey?: string;
  model?: string;
  temperature?: number;
}

export interface L0Response {
  content: string;
  metadata?: Record<string, any>;
}
