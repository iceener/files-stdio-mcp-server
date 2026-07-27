import { config, type LogLevel } from '../config/env.js';

interface LogData {
  message: string;
  [key: string]: unknown;
}

/** Stdio-safe logger. All diagnostics are emitted to stderr. */
class Logger {
  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3,
  };

  private log(level: LogLevel, loggerName: string, data: LogData): void {
    if (this.levelPriority[level] < this.levelPriority[config.LOG_LEVEL]) return;

    const timestamp = new Date().toISOString();
    const { message, ...rest } = data;
    const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    console.error(`[${timestamp}] [${level.toUpperCase()}] [${loggerName}] ${message}${extra}`);
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

export const logger = new Logger();
