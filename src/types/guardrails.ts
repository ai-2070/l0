// Guardrails types
export interface GuardrailConfig {
  enabled: boolean;
  rules?: string[];
}

export interface GuardrailResult {
  passed: boolean;
  violations: string[];
}
