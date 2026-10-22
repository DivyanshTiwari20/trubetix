type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

const isProduction = process.env.NODE_ENV === "production";

export function log(level: LogLevel, message: string, context?: LogContext): void {
  if (level === "debug" && isProduction) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope: "tubitex",
    message,
    ...(context ?? {}),
  };
  const serialized = JSON.stringify(entry);
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => log("debug", message, context),
  info: (message: string, context?: LogContext) => log("info", message, context),
  warn: (message: string, context?: LogContext) => log("warn", message, context),
  error: (message: string, context?: LogContext) => log("error", message, context),
};
