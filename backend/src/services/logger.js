import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export function withTiming(label, fn) {
  const start = Date.now();
  return Promise.resolve(fn()).finally(() => {
    logger.info({ label, durationMs: Date.now() - start }, "timing");
  });
}
