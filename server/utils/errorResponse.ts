/**
 * Utility for creating safe API error responses
 * Prevents leaking internal implementation details in production
 */

import logger from '@server/logger';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Patterns that indicate SAFE, user-friendly error messages
 */
const SAFE_MESSAGE_PATTERNS = [
  /^(not found|invalid|missing|required|failed to|unable to|cannot|unauthorized|forbidden)/i,
  /^(no .+ found|.+ is required|.+ not configured)/i,
  /^(connection|network|timeout)/i,
];

/**
 * Patterns that indicate internal/sensitive error details
 */
const SENSITIVE_PATTERNS = [
  /at\s+\S+\s+\([^)]+\)/i, // Stack trace lines
  /\/home\/|\/root\/|\/var\/|\/usr\/|\/mnt\/|C:\\|D:\\/i, // File paths
  /ENOENT|EACCES|EPERM|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i, // System errors
  /password|secret|token|apikey|api_key|authorization/i, // Credentials
  /node_modules|\.ts:\d+|\.js:\d+/i, // Internal paths/source locations
  /sql|query|database|table|column|constraint/i, // Database internals
  /localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\./i, // Internal IPs
];

/**
 * Check if an error message is safe to show to users
 */
function isSafeMessage(message: string): boolean {
  if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }
  return SAFE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Sanitize an error message for client response
 * In production, only shows messages that are explicitly safe
 */
export function sanitizeErrorMessage(
  error: unknown,
  fallbackMessage = 'An unexpected error occurred'
): string {
  const message = error instanceof Error ? error.message : String(error);

  if (isDev) {
    return message;
  }

  if (isSafeMessage(message)) {
    return message;
  }

  return fallbackMessage;
}

/**
 * Create a standardized error response object
 */
export function createErrorResponse(
  error: unknown,
  label: string,
  userMessage: string
): { error: string; message: string } {
  const fullMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error(`${userMessage}: ${fullMessage}`, {
    label,
    error: fullMessage,
    stack,
  });

  const safeMessage = sanitizeErrorMessage(error, userMessage);

  return {
    error: userMessage,
    message: safeMessage,
  };
}
