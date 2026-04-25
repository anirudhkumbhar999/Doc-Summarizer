import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { extractTextFromFile, extractTextFromPlainText } from "../services/extractText.js";
import { chunkText } from "../services/chunkText.js";
import { embedTexts } from "../services/embeddings.js";
import { upsertChunks } from "../services/vectorStore.js";
import { withTiming } from "../services/logger.js";

const router = express.Router();
const uploadDir = process.env.UPLOAD_DIR || "uploads";
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const allowedExtensions = new Set([".txt", ".md", ".json", ".pdf"]);
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.has(extension)) {
      cb(null, true);
      return;
    }

    cb(new Error("Unsupported file type. Use .txt, .md, .json, or .pdf."));
  },
});

router.post("/", upload.single("transcript"), async (req, res) => {
  const pastedText = typeof req.body?.transcriptText === "string" ? req.body.transcriptText : "";

  if (!req.file && !pastedText.trim()) {
    return res.status(400).json({ error: "No transcript uploaded or pasted." });
  }

  try {
    await fs.mkdir(uploadDir, { recursive: true });
    const docId = uuidv4();
    const createdAtMs = Date.now();
    const transcriptName = req.file?.originalname || req.body?.transcriptName || "Pasted transcript";

    const text = req.file
      ? await withTiming("extract_text", () => extractTextFromFile(path.resolve(req.file.path)))
      : await withTiming("clean_pasted_text", () => extractTextFromPlainText(pastedText));

    if (!text) {
      return res.status(422).json({ error: "No extractable text found in transcript." });
    }

    const chunks = await withTiming("chunk_text", () =>
      chunkText(text, { docId, filename: transcriptName, createdAtMs })
    );
    const nonEmptyChunks = chunks.filter((chunk) => chunk.content?.trim());
    if (!nonEmptyChunks.length) {
      return res.status(422).json({
        error: "No meaningful text chunks generated from transcript.",
      });
    }

    const vectors = await withTiming("embed_chunks", () =>
      embedTexts(nonEmptyChunks.map((chunk) => chunk.content))
    );
    await withTiming("vector_upsert", () => upsertChunks(nonEmptyChunks, vectors));

    return res.json({
      docId,
      transcriptName,
      extractedLength: text.length,
      chunksStored: nonEmptyChunks.length,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Transcript processing failed.",
      details: error.message,
    });
  }
});

export default router;
