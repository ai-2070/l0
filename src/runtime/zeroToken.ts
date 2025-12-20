// Zero-token detection helper for L0

import { hasMeaningfulContent } from "../utils/tokens";

/**
 * Detect if content is effectively zero output
 * This includes empty strings, whitespace-only, or minimal noise
 *
 * @param content - Content to check
 * @returns True if zero-token output detected
 */
export function detectZeroToken(content: string): boolean {
  // Check for null/undefined
  if (!content) {
    return true;
  }

  // Check for empty string
  if (content.length === 0) {
    return true;
  }

  // Check for whitespace only
  if (!hasMeaningfulContent(content)) {
    return true;
  }

  const trimmed = content.trim();

  // Check for only punctuation/special characters
  if (/^[^\w\s]+$/.test(trimmed)) {
    return true;
  }

  // Check for repeated single character
  if (/^(.)\1+$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Detect if stream produced zero output before first meaningful token
 * This is used to distinguish network failures from model failures
 *
 * @param content - Accumulated content
 * @param tokenCount - Number of tokens received
 * @returns True if zero output detected
 */
export function detectZeroTokenBeforeFirstMeaningful(
  content: string,
  tokenCount: number,
): boolean {
  // If we received no tokens, definitely zero output
  if (tokenCount === 0) {
    return true;
  }

  // If we received tokens but no meaningful content
  if (tokenCount > 0 && !hasMeaningfulContent(content)) {
    return true;
  }

  // If we received many tokens but very little content (possible encoding issue)
  if (tokenCount > 10 && content.trim().length < 5) {
    return true;
  }

  return false;
}

/**
 * Check if output finished instantly (possible error indicator)
 *
 * @param startTime - Stream start timestamp
 * @param endTime - Stream end timestamp
 * @param tokenCount - Number of tokens received
 * @returns True if finished suspiciously fast
 */
export function detectInstantFinish(
  startTime: number,
  endTime: number,
  tokenCount: number,
): boolean {
  const duration = endTime - startTime;

  // If completed in less than 100ms with fewer than 5 tokens, suspicious
  if (duration < 100 && tokenCount < 5) {
    return true;
  }

  // If completed in less than 50ms regardless of tokens, suspicious
  if (duration < 50) {
    return true;
  }

  return false;
}

/**
 * Analyze zero-token situation and provide reason
 *
 * @param content - Content received
 * @param tokenCount - Number of tokens
 * @param startTime - Stream start time
 * @param endTime - Stream end time (optional)
 * @returns Analysis result with reason
 */
export function analyzeZeroToken(
  content: string,
  tokenCount: number,
  startTime?: number,
  endTime?: number,
): {
  isZeroToken: boolean;
  reason: string;
  category: "network" | "transport" | "encoding" | "none";
} {
  // Check basic zero token
  if (detectZeroToken(content)) {
    if (tokenCount === 0) {
      return {
        isZeroToken: true,
        reason: "No tokens received - likely network or transport failure",
        category: "network",
      };
    }

    if (tokenCount > 0 && content.trim().length === 0) {
      return {
        isZeroToken: true,
        reason: "Tokens received but no content - possible encoding issue",
        category: "encoding",
      };
    }

    return {
      isZeroToken: true,
      reason: "Only whitespace or noise characters received",
      category: "transport",
    };
  }

  // Check instant finish
  if (startTime && endTime) {
    if (detectInstantFinish(startTime, endTime, tokenCount)) {
      return {
        isZeroToken: true,
        reason:
          "Stream completed suspiciously fast - possible transport failure",
        category: "transport",
      };
    }
  }

  return {
    isZeroToken: false,
    reason: "Valid output detected",
    category: "none",
  };
}

/**
 * Check if content is only newlines/whitespace
 *
 * @param content - Content to check
 * @returns True if only whitespace/newlines
 */
export function isOnlyWhitespace(content: string): boolean {
  if (!content) return true;
  return /^[\s\r\n\t]*$/.test(content);
}

/**
 * Check if content is only punctuation
 *
 * @param content - Content to check
 * @returns True if only punctuation
 */
export function isOnlyPunctuation(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  return trimmed.length > 0 && /^[^\w\s]+$/.test(trimmed);
}

/**
 * Check if stream stalled on first chunk
 * (received partial first token then stopped)
 *
 * @param content - Content received
 * @param tokenCount - Number of tokens
 * @param lastTokenTime - Timestamp of last token
 * @param currentTime - Current timestamp
 * @param stallTimeout - Timeout in ms to consider stalled (default: 5000)
 * @returns True if stalled
 */
export function detectFirstChunkStall(
  content: string,
  tokenCount: number,
  lastTokenTime: number,
  currentTime: number,
  stallTimeout: number = 5000,
): boolean {
  // If we got very few tokens
  if (tokenCount > 0 && tokenCount < 3) {
    const timeSinceLastToken = currentTime - lastTokenTime;

    // And it's been a while since last token
    if (timeSinceLastToken > stallTimeout) {
      // And content is minimal
      if (content.trim().length < 10) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get zero-token error message
 *
 * @param content - Content received
 * @param tokenCount - Number of tokens
 * @returns Error message
 */
export function getZeroTokenErrorMessage(
  content: string,
  tokenCount: number,
): string {
  const analysis = analyzeZeroToken(content, tokenCount);

  if (!analysis.isZeroToken) {
    return "";
  }

  return `Zero-token output detected: ${analysis.reason} (tokens: ${tokenCount}, chars: ${content.length})`;
}
