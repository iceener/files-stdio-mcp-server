import type { CallToolResult, ServerContext } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';

/** Public v2 context supplied to tool handlers. */
export type HandlerExtra = ServerContext;

export type ToolHandler<TInput = unknown> = (
  args: TInput,
  context: HandlerExtra,
) => Promise<CallToolResult>;

export interface ToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  handler: ToolHandler<z.infer<TInput>>;
}
