import { z } from 'zod';

/**
 * Common reusable schemas for input validation.
 */

// ─────────────────────────────────────────────────────────────
// Schema Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Create a strict object schema that rejects unknown keys.
 *
 * Use this for tool inputs to catch typos and prevent unexpected data.
 *
 * @example
 * const MyInputSchema = strictObject({
 *   name: z.string(),
 *   age: z.number().optional(),
 * });
 */
export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

/**
 * Parse with strict mode - rejects unknown keys and provides detailed errors.
 */
export function strictParse<T extends z.ZodType>(
  schema: T,
  data: unknown,
): z.SafeParseReturnType<z.input<T>, z.output<T>> {
  return schema.safeParse(data);
}

// ─────────────────────────────────────────────────────────────
// Common Primitives
// ─────────────────────────────────────────────────────────────

/** Non-empty string with trimming */
export const nonEmptyString = z
  .string()
  .min(1)
  .transform((s) => s.trim());

/** URL string validation */
export const urlString = z.string().url();

/** HTTP method */
export const httpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** HTTP headers as JSON string (easier for MCP Inspector forms) */
export const httpHeadersJson = z
  .string()
  .optional()
  .describe('Headers as JSON object, e.g. {"Authorization": "Bearer xxx"}');

/** Positive integer */
export const positiveInt = z.number().int().positive();

/** Non-negative integer */
export const nonNegativeInt = z.number().int().min(0);

/** UUID v4 */
export const uuid = z.string().uuid();

/** ISO date string */
export const isoDate = z.string().datetime();

/** Email address */
export const email = z.string().email();

/** Pagination parameters */
export const paginationParams = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe('Maximum items to return'),
  offset: z.number().int().min(0).default(0).describe('Number of items to skip'),
});

/** Standard ID parameter */
export const idParam = z.object({
  id: nonEmptyString.describe('Unique identifier'),
});
