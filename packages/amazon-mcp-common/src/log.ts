export type LogLevel = 'silent' | 'error' | 'info' | 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3,
};

const SENSITIVE_KEY =
  /^(authorization|cookie|.*token.*|.*secret.*|.*password.*|client_secret|clientSecret)$/i;

type LogSink = (level: Exclude<LogLevel, 'silent'>, message: string) => void;

let sink: LogSink = defaultSink;

function defaultSink(level: Exclude<LogLevel, 'silent'>, message: string): void {
  if (level === 'error') {
    console.error(message);
    return;
  }
  console.log(message);
}

export function setLogSink(next: LogSink | undefined): void {
  sink = next ?? defaultSink;
}

export function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'silent' || normalized === 'error' || normalized === 'info' || normalized === 'debug') {
    return normalized;
  }
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info';
}

export function getLogLevel(): LogLevel {
  return parseLogLevel(process.env.MCP_LOG_LEVEL);
}

export function logError(event: string, details?: unknown): void {
  writeLog('error', event, details);
}

export function logInfo(event: string, details?: unknown): void {
  writeLog('info', event, details);
}

export function logDebug(event: string, details?: unknown): void {
  writeLog('debug', event, details);
}

function writeLog(level: Exclude<LogLevel, 'silent'>, event: string, details?: unknown): void {
  if (LEVEL_RANK[getLogLevel()] < LEVEL_RANK[level]) {
    return;
  }
  const prefix = `[${level}] ${event}`;
  if (details === undefined) {
    sink(level, prefix);
    return;
  }
  sink(level, `${prefix} ${safeJson(redact(details))}`);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[truncated]';
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(entry, depth + 1);
  }
  return output;
}

export function summarizeJsonRpc(body: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(body)) {
    return {
      batch: true,
      calls: body.map((entry) => summarizeJsonRpc(entry)).filter(Boolean),
    };
  }
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const message = body as Record<string, unknown>;
  const method = typeof message.method === 'string' ? message.method : undefined;
  if (!method && message.result === undefined && message.error === undefined) {
    return undefined;
  }
  const summary: Record<string, unknown> = {};
  if (message.id !== undefined) {
    summary.id = message.id;
  }
  if (method) {
    summary.method = method;
  }
  if (message.params !== undefined) {
    summary.params = redact(message.params);
  }
  if (message.error !== undefined) {
    summary.error = redact(message.error);
  }
  return summary;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}
