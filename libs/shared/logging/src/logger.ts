import { currentContext, type RequestContext } from '@rifad/request-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Receives one complete JSON line per entry; the default writes info/debug to stdout and warn/error to stderr. */
export type LogSink = (level: LogLevel, line: string) => void;

export interface LoggerOptions {
  readonly runtime: string;
  readonly minLevel?: LogLevel;
  readonly sink?: LogSink;
  readonly now?: () => Date;
}

export const REDACTED = '[REDACTED]';
const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const eventPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
/** Key names whose values are never logged (credentials, sessions, card data, cashier PINs). */
const sensitiveKey = /pass(?:word|phrase)|secret|token|authori[sz]ation|cookie|api[-_]?key|private[-_]?key|credential|pin(?:[-_]?code)?$|^pan$|card[-_]?number|cvv|cvc|track[-_]?data|iban|^otp|otp$/i;
const contextFields = ['requestId', 'correlationId', 'organizationId', 'branchId', 'deviceId', 'userId'] as const;
const limits = { depth: 5, keys: 50, items: 50, string: 1024 };

function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Masks card-number-like digit runs (13–19 digits, optional spaces/dashes, Luhn-valid) inside free text. */
function maskCardNumbers(value: string): string {
  return value.replace(/\b\d(?:[ -]?\d){12,18}\b/g, match => luhn(match.replace(/[ -]/g, '')) ? REDACTED : match);
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    const masked = maskCardNumbers(value);
    return masked.length > limits.string ? masked.slice(0, limits.string) + '…[truncated]' : masked;
  }
  if (typeof value !== 'object') return typeof value === 'undefined' ? undefined : '[' + typeof value + ']';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : 'Invalid Date';
  // Error messages and stacks can embed SQL, payloads or provider responses; only identity is logged.
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return { name: value.name, ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}) };
  }
  if (seen.has(value)) return '[circular]';
  if (depth >= limits.depth) return '[depth-limit]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, limits.items).map(item => sanitize(item, depth + 1, seen));
      return value.length > limits.items ? [...items, '[+' + (value.length - limits.items) + ' items]'] : items;
    }
    const output: Record<string, unknown> = {};
    const entries = Object.entries(value);
    for (const [key, item] of entries.slice(0, limits.keys)) {
      output[key] = sensitiveKey.test(key) ? REDACTED : sanitize(item, depth + 1, seen);
    }
    if (entries.length > limits.keys) output['[truncated]'] = entries.length - limits.keys + ' keys';
    return output;
  } finally {
    seen.delete(value);
  }
}

/** Redacts and bounds arbitrary log fields; exported so other adapters can apply the same policy. */
export function redact(fields: LogFields): Record<string, unknown> {
  return sanitize(fields, 0, new WeakSet()) as Record<string, unknown>;
}

const defaultSink: LogSink = (level, line) => {
  (level === 'warn' || level === 'error' ? process.stderr : process.stdout).write(line + '\n');
};

function contextOf(context: RequestContext | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const field of contextFields) {
    const value = context?.[field];
    if (value !== undefined) output[field] = value;
  }
  return output;
}

/**
 * Structured JSON logger (M0-023). Each line carries time (UTC), level, runtime, event and the
 * active request context; caller fields are redacted and cannot overwrite these reserved fields.
 */
export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const threshold = order[options.minLevel ?? 'info'];
  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    if (order[level] < threshold) return;
    if (!eventPattern.test(event)) throw new TypeError('Log event must be a lowercase dotted name');
    const entry = { ...redact(fields), time: now().toISOString(), level, runtime: options.runtime, event, ...contextOf(currentContext()) };
    sink(level, JSON.stringify(entry));
  };
  return Object.freeze({
    debug: (event: string, fields?: LogFields) => write('debug', event, fields),
    info: (event: string, fields?: LogFields) => write('info', event, fields),
    warn: (event: string, fields?: LogFields) => write('warn', event, fields),
    error: (event: string, fields?: LogFields) => write('error', event, fields),
  });
}
