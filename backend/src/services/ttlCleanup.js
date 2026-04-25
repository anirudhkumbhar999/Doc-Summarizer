import { logger } from "./logger.js";
import { purgeExpiredDocs } from "./vectorStore.js";

const DEFAULT_TTL_MINUTES = 60;
const DEFAULT_CLEANUP_INTERVAL_MINUTES = 5;
const MIN_INTERVAL_MS = 30_000;

export function startVectorTtlCleanup() {
  const ttlMinutes = Number(process.env.VECTOR_TTL_MINUTES || DEFAULT_TTL_MINUTES);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    logger.info({ ttlMinutes }, "vector_ttl_cleanup_disabled");
    return () => {};
  }

  const cleanupIntervalMinutes = Number(
    process.env.VECTOR_CLEANUP_INTERVAL_MINUTES || DEFAULT_CLEANUP_INTERVAL_MINUTES
  );
  const cleanupIntervalMs = Math.max(
    MIN_INTERVAL_MS,
    Math.floor(cleanupIntervalMinutes * 60_000)
  );
  const ttlMs = ttlMinutes * 60_000;

  let isRunning = false;
  async function runCleanup(trigger) {
    if (isRunning) {
      return;
    }

    isRunning = true;
    const startedAt = Date.now();
    try {
      const stats = await purgeExpiredDocs(ttlMs);
      const durationMs = Date.now() - startedAt;
      if (stats.deletedDocCount > 0) {
        logger.info(
          { trigger, ttlMinutes, durationMs, ...stats },
          "vector_ttl_cleanup_deleted_expired_docs"
        );
      } else {
        logger.debug(
          { trigger, ttlMinutes, durationMs, ...stats },
          "vector_ttl_cleanup_noop"
        );
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      logger.error(
        { trigger, durationMs, error: error.message },
        "vector_ttl_cleanup_failed"
      );
    } finally {
      isRunning = false;
    }
  }

  const timer = setInterval(() => {
    void runCleanup("interval");
  }, cleanupIntervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  void runCleanup("startup");
  logger.info(
    {
      ttlMinutes,
      cleanupIntervalMinutes: cleanupIntervalMs / 60_000,
    },
    "vector_ttl_cleanup_started"
  );

  return () => clearInterval(timer);
}
