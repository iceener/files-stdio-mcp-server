/**
 * Type exports for MCP server.
 *
 * Import types from here for consistent usage across the codebase:
 *
 * @example
 * import type { HandlerExtra, ProgressToken, CancellationToken } from '../types/index.js';
 */

// Context types
export type {
  CancellationToken,
  HandlerExtraInfo,
  ProgressParams,
  ProgressToken,
  RequestContext,
  RequestHandlerExtra,
} from './context.js';

export { createCancellationToken } from './context.js';

// Handler types
export type {
  HandlerExtra,
  PromptDefinition,
  PromptHandler,
  ResourceDefinition,
  ResourceHandler,
  ResourceTemplateDefinition,
  ToolDefinition,
  ToolHandler,
} from './handlers.js';
