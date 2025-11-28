// Unified event shapes and types
export interface Event {
  type: string;
  timestamp: number;
  data?: any;
}

export type EventHandler = (event: Event) => void;
