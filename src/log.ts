import pino from 'pino';
import { loadConfig } from './config.js';

export const log = pino({
  level: loadConfig().LOG_LEVEL,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});
