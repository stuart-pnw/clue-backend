// ============================================
// STRUCTURED LOGGING
// JSON format for production, pretty for dev
// ============================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  [key: string]: any;
}

const isProduction = process.env.NODE_ENV === 'production';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info') as LogLevel;

const LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_VALUES[level] >= LEVEL_VALUES[LOG_LEVEL];
}

function formatLog(entry: LogEntry): string {
  if (isProduction) {
    return JSON.stringify(entry);
  }
  
  const { timestamp, level, message, service, ...rest } = entry;
  const color = {
    debug: '\x1b[36m',  // cyan
    info: '\x1b[32m',   // green
    warn: '\x1b[33m',   // yellow
    error: '\x1b[31m',  // red
  }[level];
  const reset = '\x1b[0m';
  
  let output = `${color}[${level.toUpperCase()}]${reset} [${service}] ${message}`;
  
  if (Object.keys(rest).length > 0) {
    output += ` ${JSON.stringify(rest)}`;
  }
  
  return output;
}

function log(level: LogLevel, service: string, message: string, data?: Record<string, any>): void {
  if (!shouldLog(level)) return;
  
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service,
    ...data,
  };
  
  const output = formatLog(entry);
  
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

// ============================================
// LOGGER CLASS
// ============================================

export class Logger {
  constructor(private service: string) {}
  
  debug(message: string, data?: Record<string, any>): void {
    log('debug', this.service, message, data);
  }
  
  info(message: string, data?: Record<string, any>): void {
    log('info', this.service, message, data);
  }
  
  warn(message: string, data?: Record<string, any>): void {
    log('warn', this.service, message, data);
  }
  
  error(message: string, error?: Error | Record<string, any>): void {
    if (error instanceof Error) {
      log('error', this.service, message, {
        error: error.message,
        stack: error.stack,
      });
    } else {
      log('error', this.service, message, error);
    }
  }
  
  // Create child logger with additional context
  child(context: Record<string, any>): ContextLogger {
    return new ContextLogger(this.service, context);
  }
}

class ContextLogger {
  constructor(
    private service: string,
    private context: Record<string, any>
  ) {}
  
  debug(message: string, data?: Record<string, any>): void {
    log('debug', this.service, message, { ...this.context, ...data });
  }
  
  info(message: string, data?: Record<string, any>): void {
    log('info', this.service, message, { ...this.context, ...data });
  }
  
  warn(message: string, data?: Record<string, any>): void {
    log('warn', this.service, message, { ...this.context, ...data });
  }
  
  error(message: string, error?: Error | Record<string, any>): void {
    if (error instanceof Error) {
      log('error', this.service, message, {
        ...this.context,
        error: error.message,
        stack: error.stack,
      });
    } else {
      log('error', this.service, message, { ...this.context, ...error });
    }
  }
}

// ============================================
// PRE-CONFIGURED LOGGERS
// ============================================

export const authLogger = new Logger('Auth');
export const clueLogger = new Logger('Clues');
export const learnLogger = new Logger('Learn');
export const billingLogger = new Logger('Billing');
export const jobLogger = new Logger('Jobs');
export const apiLogger = new Logger('API');

// ============================================
// REQUEST LOGGING MIDDLEWARE
// ============================================

export function requestLogger() {
  return async (c: any, next: () => Promise<void>) => {
    const start = Date.now();
    const requestId = crypto.randomUUID();
    
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    
    await next();
    
    const duration = Date.now() - start;
    const status = c.res.status;
    
    const logData = {
      request_id: requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status,
      duration_ms: duration,
      user_id: c.get('userId'),
    };
    
    if (status >= 500) {
      apiLogger.error('Request failed', logData);
    } else if (status >= 400) {
      apiLogger.warn('Request error', logData);
    } else {
      apiLogger.info('Request completed', logData);
    }
  };
}
