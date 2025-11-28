// Rule, violation, and state types
export interface Rule {
  name: string;
  validate: (content: string) => Violation[];
}

export interface Violation {
  rule: string;
  message: string;
  position?: number;
}

export interface GuardrailState {
  violations: Violation[];
}
