/**
 * Progress notification utilities for long-running operations.
 *
 * Usage in tool handlers:
 *
 * @example
 * handler: async (args, extra) => {
 *   const progress = createProgressReporter(extra);
 *
 *   for (let i = 0; i < items.length; i++) {
 *     if (extra.signal.aborted) {
 *       return cancelledError();
 *     }
 *
 *     await progress.report(i + 1, items.length, `Processing ${items[i].name}`);
 *     await processItem(items[i]);
 *   }
 *
 *   return { content: [{ type: 'text', text: 'Done' }] };
 * }
 */

import type { HandlerExtra } from '../types/index.js';

/**
 * Progress reporter for sending updates to client.
 */
export interface ProgressReporter {
  /** Whether the client requested progress notifications */
  readonly enabled: boolean;

  /**
   * Report progress to the client.
   *
   * @param progress - Current progress value (must increase monotonically)
   * @param total - Total expected value (optional, enables percentage)
   * @param message - Human-readable status (optional)
   */
  report(progress: number, total?: number, message?: string): Promise<void>;
}

/**
 * Create a progress reporter from handler extra context.
 *
 * If the client didn't request progress (no progressToken), the reporter
 * is a no-op to avoid unnecessary overhead.
 */
export function createProgressReporter(extra: HandlerExtra): ProgressReporter {
  const progressToken = extra._meta?.progressToken;

  if (!progressToken) {
    // Client didn't request progress - return no-op reporter
    return {
      enabled: false,
      report: async () => {},
    };
  }

  return {
    enabled: true,
    report: async (progress: number, total?: number, message?: string) => {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken,
          progress,
          ...(total !== undefined && { total }),
          ...(message !== undefined && { message }),
        },
      });
    },
  };
}

/**
 * Send a single progress notification directly.
 *
 * Prefer `createProgressReporter` for multiple updates in a loop.
 */
export async function sendProgress(
  extra: HandlerExtra,
  progress: number,
  total?: number,
  message?: string,
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (!progressToken) return;

  await extra.sendNotification({
    method: 'notifications/progress',
    params: {
      progressToken,
      progress,
      ...(total !== undefined && { total }),
      ...(message !== undefined && { message }),
    },
  });
}

/**
 * Helper to check if operation should continue or abort.
 *
 * @throws Error if signal is aborted
 */
export function throwIfAborted(signal: AbortSignal, message = 'Operation cancelled'): void {
  if (signal.aborted) {
    const error = new Error(message);
    error.name = 'AbortError';
    throw error;
  }
}

/**
 * Check if signal is aborted without throwing.
 */
export function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
