import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import dotenv from "dotenv";
import path from "node:path";
import { logger } from "./logger.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env"), override: false });
dotenv.config({
  path: path.resolve(process.cwd(), "..", ".env.example"),
  override: false,
});

const embeddingModel = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAIEmbeddings({
      model: process.env.EMBEDDING_MODEL || "text-embedding-004",
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null;

const FALLBACK_DIMENSION = 256;

function fallbackEmbed(text) {
  const vector = new Array(FALLBACK_DIMENSION).fill(0);
  if (!text) {
    return vector;
  }
  for (let index = 0; index < text.length; index += 1) {
    const charCode = text.charCodeAt(index);
    vector[index % FALLBACK_DIMENSION] += (charCode % 31) / 31;
  }
  return vector;
}

function hasValidEmbedding(vector) {
  return (
    Array.isArray(vector) &&
    vector.length > 0 &&
    vector.every((value) => typeof value === "number" && Number.isFinite(value))
  );
}

export async function embedTexts(texts) {
  if (embeddingModel) {
    const vectors = await embeddingModel.embedDocuments(texts);
    if (
      Array.isArray(vectors) &&
      vectors.length === texts.length &&
      vectors.every(hasValidEmbedding)
    ) {
      return vectors;
    }
  }

  logger.warn(
    "Gemini embeddings unavailable/invalid; using deterministic fallback embeddings."
  );
  return texts.map((text) => fallbackEmbed(text));
}

export async function embedQueryText(query) {
  const [vector] = await embedTexts([query]);
  return vector;
}
