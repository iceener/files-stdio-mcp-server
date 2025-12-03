import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from './logger.js';

// Re-export SDK error types for protocol-level errors
export { ErrorCode as McpErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Application-level error codes for tool failures.
 *
 * Use these for tool-level errors that should be returned as CallToolResult.
 * For protocol-level errors (like method not found), use McpError with McpErrorCode.
 */
export const ToolErrorCodes = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMIT: 'RATE_LIMIT',
  TIMEOUT: 'TIMEOUT',
  INTERNAL: 'INTERNAL_ERROR',
  EXTERNAL_API: 'EXTERNAL_API_ERROR',
  CANCELLED: 'CANCELLED',
} as const;

export type ToolErrorCode = (typeof ToolErrorCodes)[keyof typeof ToolErrorCodes];

/**
 * Tool error with structured information.
 *
 * Throw this in tool handlers for structured error handling.
 */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: ToolErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/**
 * Create a standard error result for tool calls.
 *
 * @example
 * return toolError('User not found', 'NOT_FOUND', { userId: 123 });
 */
export function toolError(
  message: string,
  code: ToolErrorCode = ToolErrorCodes.INTERNAL,
  details?: Record<string, unknown>,
): CallToolResult {
  logger.error('tool', { message, code, ...details });

  const errorInfo = details ? `\n\nDetails: ${JSON.stringify(details, null, 2)}` : '';

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Error [${code}]: ${message}${errorInfo}`,
      },
    ],
  };
}

/**
 * Create a validation error result from Zod issues.
 *
 * @example
 * const parsed = schema.safeParse(input);
 * if (!parsed.success) {
 *   return validationError(parsed.error.issues);
 * }
 */
export function validationError(
  issues: Array<{ path: Array<string | number>; message: string }>,
): CallToolResult {
  const formatted = issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  return toolError(`Invalid input:\n${formatted}`, ToolErrorCodes.VALIDATION, {
    issues: issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

/**
 * Create a cancellation error result.
 */
export function cancelledError(message = 'Operation cancelled'): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

/**
 * Wrap an async function with error handling for tools.
 * Catches exceptions and converts them to proper error results.
 *
 * @example
 * handler: wrapHandler(async (args) => {
 *   // your logic here
 *   return { content: [...] };
 * })
 */
export function wrapHandler<T>(
  fn: (args: T) => Promise<CallToolResult>,
): (args: T) => Promise<CallToolResult> {
  return async (args: T): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (error) {
      if (error instanceof ToolError) {
        return toolError(error.message, error.code, error.details);
      }

      const message = error instanceof Error ? error.message : String(error);
      return toolError(message, ToolErrorCodes.INTERNAL);
    }
  };
}

/**
 * Assert a condition, throwing ToolError if false.
 *
 * @example
 * assertTool(user !== null, 'User not found', 'NOT_FOUND');
 */
export function assertTool(
  condition: unknown,
  message: string,
  code: ToolErrorCode = ToolErrorCodes.INTERNAL,
  details?: Record<string, unknown>,
): asserts condition {
  if (!condition) {
    throw new ToolError(message, code, details);
  }
}
