import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const level = process.env.LOG_LEVEL || 'info';
const transport = (process.env.LOG_TRANSPORT || 'console') as 'console' | 'file' | 'both';
const logDir = process.env.LOG_DIR || './logs';
const maxFiles = process.env.LOG_MAX_FILES || '14d';

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple(),
  ),
});

const fileTransport = new DailyRotateFile({
  dirname: logDir,
  filename: 'app-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxFiles,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
});

const transports: winston.transport[] = [];
if (transport === 'console' || transport === 'both') transports.push(consoleTransport);
if (transport === 'file' || transport === 'both') transports.push(fileTransport);
if (transports.length === 0) transports.push(consoleTransport);

export const logger = winston.createLogger({ level, transports });
