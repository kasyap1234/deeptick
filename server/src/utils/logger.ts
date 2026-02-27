import pino from 'pino';
import { config } from '../config/index.js';

function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack,
      cause: value.cause != null ? serializeError(value.cause) : undefined,
    };
  }
  return value;
}

export const logger = pino({
  level: config.LOG_LEVEL,
  serializers: {
    error: serializeError,
    err: serializeError,
  },
  transport: config.isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    pid: process.pid,
    env: config.NODE_ENV,
  },
});

export default logger;
