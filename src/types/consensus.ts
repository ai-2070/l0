// Types for L0 Consensus API - Multi-generation consensus for correctness

import type { z } from "zod";
import type { L0Result } from "./l0";
import type { StructuredResult } from "./structured";

/**
 * Consensus options
 */
export interface ConsensusOptions<T extends z.ZodTypeAny = z.ZodTypeAny> {
  /**
   * Stream factories to run for consensus
   * Each factory should return a stream (typically from streamText)
   */
  streams: Array<() => Promise<any>>;

  /**
   * Optional schema for structured consensus
   * If provided, outputs are validated and compared field-by-field
   */
  schema?: T;

  /**
   * Consensus strategy
   * @default 'majority'
   */
  strategy?: ConsensusStrategy;

  /**
   * Similarity threshold for text-based consensus (0-1)
   * @default 0.8
   */
  threshold?: number;

  /**
   * How to resolve conflicts when models disagree
   * @default 'vote'
   */
  resolveConflicts?: ConflictResolution;

  /**
   * Weights for each stream (for 'weighted' strategy)
   * Array must match streams length
   */
  weights?: number[];

  /**
   * Minimum agreement ratio required (0-1)
   * @default 0.6
   */
  minimumAgreement?: number;

  /**
   * Timeout for entire consensus operation (ms)
   */
  timeout?: number;

  /**
   * Abort signal for cancellation
   */
  signal?: AbortSignal;

  /**
   * Enable monitoring/telemetry
   */
  monitoring?: {
    enabled?: boolean;
    metadata?: Record<string, any>;
  };

  /**
   * Callback when all streams complete
   */
  onComplete?: (outputs: ConsensusOutput[]) => void | Promise<void>;

  /**
   * Callback for consensus calculation
   */
  onConsensus?: (result: ConsensusResult<any>) => void | Promise<void>;

  /**
   * Metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Consensus strategy
 */
export type ConsensusStrategy =
  | "majority" // Take what majority agrees on
  | "unanimous" // All must agree (strictest)
  | "weighted" // Weight by model/confidence
  | "best"; // Choose highest confidence output

/**
 * Conflict resolution strategy
 */
export type ConflictResolution =
  | "vote" // Take majority vote
  | "merge" // Combine all information
  | "fail" // Throw error on disagreement
  | "best"; // Choose highest confidence

/**
 * Result from consensus operation
 */
export interface ConsensusResult<T = any> {
  /**
   * Final consensus output
   */
  consensus: T;

  /**
   * Overall confidence score (0-1)
   * 1.0 = perfect agreement
   * 0.0 = complete disagreement
   */
  confidence: number;

  /**
   * Individual outputs from all streams
   */
  outputs: ConsensusOutput[];

  /**
   * What all models agreed on
   */
  agreements: Agreement[];

  /**
   * Where models disagreed
   */
  disagreements: Disagreement[];

  /**
   * Detailed analysis
   */
  analysis: ConsensusAnalysis;

  /**
   * Consensus type (text or structured)
   */
  type: "text" | "structured";

  /**
   * Field-level consensus (only for structured)
   */
  fieldConsensus?: FieldConsensus;

  /**
   * Execution status
   */
  status: "success" | "partial" | "failed";

  /**
   * Error if consensus failed
   */
  error?: Error;

  /**
   * Metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Single output from a stream
 */
export interface ConsensusOutput {
  /**
   * Index of this output
   */
  index: number;

  /**
   * Raw text output
   */
  text: string;

  /**
   * Parsed data (if structured)
   */
  data?: any;

  /**
   * L0 result (undefined for structured results or errors)
   */
  l0Result?: L0Result;

  /**
   * Structured result (if schema provided)
   */
  structuredResult?: StructuredResult<any>;

  /**
   * Status of this output
   */
  status: "success" | "error";

  /**
   * Error if output failed
   */
  error?: Error;

  /**
   * Execution duration (ms)
   */
  duration: number;

  /**
   * Weight assigned to this output
   */
  weight: number;

  /**
   * Similarity scores with other outputs
   */
  similarities?: number[];
}

/**
 * Agreement between outputs
 */
export interface Agreement {
  /**
   * Content that was agreed upon
   */
  content: string | any;

  /**
   * Path to this agreement (for structured)
   */
  path?: string;

  /**
   * How many outputs agreed (count)
   */
  count: number;

  /**
   * Agreement ratio (0-1)
   */
  ratio: number;

  /**
   * Indices of outputs that agreed
   */
  indices: number[];

  /**
   * Type of agreement
   */
  type: AgreementType;
}

/**
 * Type of agreement
 */
export type AgreementType =
  | "exact" // Exact match
  | "similar" // Fuzzy match (high similarity)
  | "structural" // Same structure (for objects)
  | "semantic"; // Same meaning (estimated)

/**
 * Disagreement between outputs
 */
export interface Disagreement {
  /**
   * Path to disagreement (for structured)
   */
  path?: string;

  /**
   * Different values
   */
  values: Array<{
    value: any;
    count: number;
    indices: number[];
  }>;

  /**
   * Severity of disagreement
   */
  severity: DisagreementSeverity;

  /**
   * How it was resolved
   */
  resolution?: string;

  /**
   * Confidence in resolution (0-1)
   */
  resolutionConfidence?: number;
}

/**
 * Severity of disagreement
 */
export type DisagreementSeverity =
  | "minor" // Small differences, likely acceptable
  | "moderate" // Noticeable differences
  | "major" // Significant conflict
  | "critical"; // Complete disagreement

/**
 * Consensus analysis
 */
export interface ConsensusAnalysis {
  /**
   * Total outputs
   */
  totalOutputs: number;

  /**
   * Successful outputs
   */
  successfulOutputs: number;

  /**
   * Failed outputs
   */
  failedOutputs: number;

  /**
   * Number of identical outputs
   */
  identicalOutputs: number;

  /**
   * Pairwise similarity scores
   */
  similarityMatrix: number[][];

  /**
   * Average similarity across all pairs
   */
  averageSimilarity: number;

  /**
   * Minimum similarity
   */
  minSimilarity: number;

  /**
   * Maximum similarity
   */
  maxSimilarity: number;

  /**
   * Total agreements found
   */
  totalAgreements: number;

  /**
   * Total disagreements found
   */
  totalDisagreements: number;

  /**
   * Strategy used
   */
  strategy: ConsensusStrategy;

  /**
   * Conflict resolution used
   */
  conflictResolution: ConflictResolution;

  /**
   * Total execution time (ms)
   */
  duration: number;
}

/**
 * Field-level consensus (for structured outputs)
 */
export interface FieldConsensus {
  /**
   * Consensus per field
   */
  fields: Record<string, FieldAgreement>;

  /**
   * Overall field agreement ratio (0-1)
   */
  overallAgreement: number;

  /**
   * Fields with full agreement
   */
  agreedFields: string[];

  /**
   * Fields with disagreement
   */
  disagreedFields: string[];
}

/**
 * Agreement on a single field
 */
export interface FieldAgreement {
  /**
   * Field path
   */
  path: string;

  /**
   * Consensus value for this field
   */
  value: any;

  /**
   * Agreement ratio (0-1)
   */
  agreement: number;

  /**
   * Vote counts
   */
  votes: Record<string, number>;

  /**
   * All values seen
   */
  values: any[];

  /**
   * Whether field had unanimous agreement
   */
  unanimous: boolean;

  /**
   * Confidence in this field's consensus (0-1)
   */
  confidence: number;
}

/**
 * Options for text-based consensus
 */
export interface TextConsensusOptions {
  /**
   * Similarity threshold
   */
  threshold: number;

  /**
   * Strategy
   */
  strategy: ConsensusStrategy;

  /**
   * Conflict resolution
   */
  resolveConflicts: ConflictResolution;

  /**
   * Weights for each output
   */
  weights: number[];
}

/**
 * Options for structured consensus
 */
export interface StructuredConsensusOptions {
  /**
   * Schema
   */
  schema: z.ZodTypeAny;

  /**
   * Strategy
   */
  strategy: ConsensusStrategy;

  /**
   * Conflict resolution
   */
  resolveConflicts: ConflictResolution;

  /**
   * Weights for each output
   */
  weights: number[];

  /**
   * Minimum agreement
   */
  minimumAgreement: number;
}

/**
 * Preset consensus configurations
 */
export interface ConsensusPreset {
  name: string;
  strategy: ConsensusStrategy;
  threshold: number;
  resolveConflicts: ConflictResolution;
  minimumAgreement: number;
}

/**
 * Strict consensus - all must agree
 */
export const strictConsensus: Partial<ConsensusOptions> = {
  strategy: "unanimous",
  threshold: 1.0,
  resolveConflicts: "fail",
  minimumAgreement: 1.0,
};

/**
 * Standard consensus - majority rules
 */
export const standardConsensus: Partial<ConsensusOptions> = {
  strategy: "majority",
  threshold: 0.8,
  resolveConflicts: "vote",
  minimumAgreement: 0.6,
};

/**
 * Lenient consensus - flexible agreement
 */
export const lenientConsensus: Partial<ConsensusOptions> = {
  strategy: "majority",
  threshold: 0.7,
  resolveConflicts: "merge",
  minimumAgreement: 0.5,
};

/**
 * Best-of consensus - choose highest quality
 */
export const bestConsensus: Partial<ConsensusOptions> = {
  strategy: "best",
  threshold: 0.8,
  resolveConflicts: "best",
  minimumAgreement: 0.5,
};
