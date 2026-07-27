import type { CallToolResult } from '@modelcontextprotocol/server';
import { logger } from './logger.js';

export {
  ProtocolError as McpError,
  ProtocolErrorCode as McpErrorCode,
} from '@modelcontextprotocol/server';

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

export function toolError(
  message: string,
  code: ToolErrorCode = ToolErrorCodes.INTERNAL,
  details?: Record<string, unknown>,
): CallToolResult {
  logger.error('tool', { message, code, ...details });
  const errorInfo = details ? `\n\nDetails: ${JSON.stringify(details, null, 2)}` : '';
  return {
    isError: true,
    content: [{ type: 'text', text: `Error [${code}]: ${message}${errorInfo}` }],
  };
}

export function validationError(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): CallToolResult {
  const formatted = issues
    .map((issue) => `  - ${issue.path.map(String).join('.')}: ${issue.message}`)
    .join('\n');
  return toolError(`Invalid input:\n${formatted}`, ToolErrorCodes.VALIDATION, {
    issues: issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

export function cancelledError(message = 'Operation cancelled'): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

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
      return toolError(
        error instanceof Error ? error.message : String(error),
        ToolErrorCodes.INTERNAL,
      );
    }
  };
}

export function assertTool(
  condition: unknown,
  message: string,
  code: ToolErrorCode = ToolErrorCodes.INTERNAL,
  details?: Record<string, unknown>,
): asserts condition {
  if (!condition) throw new ToolError(message, code, details);
}
