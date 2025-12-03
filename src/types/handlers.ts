/**
 * Handler type definitions for MCP tools, prompts, and resources.
 *
 * These types ensure consistent signatures across all handlers
 * and proper typing for the SDK's extra context.
 */

import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  GetPromptResult,
  ReadResourceResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

/**
 * The extra context type that SDK provides to handlers.
 */
export type HandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Tool handler function signature.
 *
 * @param args - Validated input arguments
 * @param extra - SDK-provided context with signal, progress, notifications
 */
export type ToolHandler<TInput = unknown> = (
  args: TInput,
  extra: HandlerExtra,
) => Promise<CallToolResult>;

/**
 * Tool definition with schema and handler.
 */
export interface ToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  /** Unique tool name (snake_case recommended) */
  name: string;
  /** Human-readable description for LLM */
  description: string;
  /** Zod schema for input validation */
  inputSchema: TInput;
  /** Optional Zod schema for structured output */
  outputSchema?: TOutput;
  /** Handler function */
  handler: ToolHandler<z.infer<TInput>>;
}

/**
 * Prompt handler function signature.
 *
 * @param args - Prompt arguments
 * @param extra - SDK-provided context
 */
export type PromptHandler<TArgs = unknown> = (
  args: TArgs,
  extra: HandlerExtra,
) => Promise<GetPromptResult>;

/**
 * Prompt definition with schema and handler.
 */
export interface PromptDefinition<TArgs extends z.ZodType = z.ZodType> {
  /** Unique prompt name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Zod schema for arguments */
  argsSchema?: TArgs;
  /** Handler function */
  handler: PromptHandler<z.infer<TArgs>>;
}

/**
 * Resource handler function signature.
 *
 * @param uri - The resource URI being read
 * @param extra - SDK-provided context
 */
export type ResourceHandler = (uri: URL, extra: HandlerExtra) => Promise<ReadResourceResult>;

/**
 * Static resource definition.
 */
export interface ResourceDefinition {
  /** Resource name */
  name: string;
  /** Fixed URI for this resource */
  uri: string;
  /** Human-readable description */
  description: string;
  /** MIME type of the content */
  mimeType: string;
  /** Handler function */
  handler: ResourceHandler;
}

/**
 * Resource template definition for dynamic URIs.
 */
export interface ResourceTemplateDefinition {
  /** Template name */
  name: string;
  /** URI template pattern, e.g., "files:///{path}" */
  uriTemplate: string;
  /** Human-readable description */
  description: string;
  /** MIME type of the content */
  mimeType: string;
  /** List all available resource instances */
  list?: () => Promise<Array<{ uri: string; name: string; mimeType?: string }>>;
  /** Autocomplete callbacks for template variables */
  complete?: Record<string, (value: string) => Promise<string[]>>;
  /** Handler function */
  handler: (
    uri: URL,
    variables: Record<string, string>,
    extra: HandlerExtra,
  ) => Promise<ReadResourceResult>;
}
