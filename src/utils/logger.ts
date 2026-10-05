type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function formatMessage(level: LogLevel, message: string, meta?: any): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger = {
  info: (message: string, meta?: any) => {
    console.log(formatMessage('info', message, meta));
  },
  warn: (message: string, meta?: any) => {
    console.warn(formatMessage('warn', message, meta));
  },
  error: (message: string, meta?: any) => {
    console.error(formatMessage('error', message, meta));
  },
  debug: (message: string, meta?: any) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(formatMessage('debug', message, meta));
    }
  },
};
