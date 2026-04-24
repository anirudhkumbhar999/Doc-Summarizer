import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import pinoHttp from "pino-http";
import uploadRoute from "./routes/upload.js";
import askRoute from "./routes/ask.js";
import { logger } from "./services/logger.js";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});
dotenv.config({
  path: path.resolve(process.cwd(), "..", ".env"),
  override: false,
});
dotenv.config({
  path: path.resolve(process.cwd(), "..", ".env.example"),
  override: false,
});

const app = express();
const port = Number(process.env.PORT || 4100);
const uploadDir = process.env.UPLOAD_DIR || "uploads";
const logHttpAccess = process.env.LOG_HTTP_ACCESS === "1";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(
  pinoHttp({
    logger,
    autoLogging: logHttpAccess
      ? {
          ignore: (req) => req.url === "/health",
        }
      : false,
    serializers: {
      req: (req) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  })
);

app.get("/health", (_req, res) => {
  const llmReady = Boolean(process.env.GROQ_API_KEY?.trim());

  res.json({
    status: "ok",
    service: "transcript-summarizer-backend",
    llm: {
      provider: "groq",
      ready: llmReady,
      status: llmReady ? "ready" : "missing_key",
    },
  });
});

app.use("/upload", uploadRoute);
app.use("/ask", askRoute);

app.use((err, _req, res, _next) => {
  logger.error({ err }, "unhandled_error");
  res.status(500).json({ error: "Internal server error" });
});

await fs.mkdir(uploadDir, { recursive: true });
app.listen(port, () => {
  logger.info({ port }, "backend_started");
});
