// Stream types
export interface StreamChunk {
  content: string;
  done: boolean;
}

export type StreamHandler = (chunk: StreamChunk) => void;
