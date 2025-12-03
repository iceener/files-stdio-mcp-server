import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import { config, type LogLevel } from '../config/env.js';

/**
 * Structured log data
 */
interface LogData {
  message: string;
  [key: string]: unknown;
}

/**
 * Logger that outputs to stderr and optionally sends MCP log notifications.
 *
 * Note: stdout is reserved for MCP protocol messages, so all logs go to stderr.
 */
class Logger {
  private server?: McpServer;
  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3,
  };

  /**
   * Set the MCP server instance to enable sending log notifications to the client.
   */
  setServer(server: McpServer): void {
    this.server = server;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[config.LOG_LEVEL];
  }

  private formatLog(level: LogLevel, logger: string, data: LogData): string {
    const timestamp = new Date().toISOString();
    const { message, ...rest } = data;
    const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${logger}] ${message}${extra}`;
  }

  private log(level: LogLevel, loggerName: string, data: LogData): void {
    if (!this.shouldLog(level)) return;

    // Always log to stderr (stdout is for MCP protocol)
    const formatted = this.formatLog(level, loggerName, data);
    console.error(formatted);

    // Also send to MCP client if connected
    this.sendMcpLog(level, loggerName, data);
  }

  private sendMcpLog(level: LogLevel, loggerName: string, data: LogData): void {
    if (!this.server) return;

    const mcpLevel = this.toMcpLevel(level);

    // Fire and forget - don't await to avoid blocking
    this.server.server
      .sendLoggingMessage({
        level: mcpLevel,
        logger: loggerName,
        data,
      })
      .catch(() => {
        // Ignore errors from logging - we don't want logging to crash the server
      });
  }

  private toMcpLevel(level: LogLevel): LoggingLevel {
    switch (level) {
      case 'debug':
        return 'debug';
      case 'info':
        return 'info';
      case 'warning':
        return 'warning';
      case 'error':
        return 'error';
    }
  }

  debug(logger: string, data: LogData): void {
    this.log('debug', logger, data);
  }

  info(logger: string, data: LogData): void {
    this.log('info', logger, data);
  }

  warning(logger: string, data: LogData): void {
    this.log('warning', logger, data);
  }

  error(logger: string, data: LogData): void {
    this.log('error', logger, data);
  }
}

/** Global logger instance */
export const logger = new Logger();
