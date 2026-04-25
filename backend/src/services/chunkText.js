import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: Number(process.env.CHUNK_SIZE || 500),
  chunkOverlap: Number(process.env.CHUNK_OVERLAP || 100),
});

function normalizeChunkText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeCodeTraceChunk(content) {
  const text = normalizeChunkText(content);
  if (!text) return true;

  const words = text.split(/\s+/).filter(Boolean);
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  const symbols = (text.match(/[=<>[\]{}()|:_-]/g) || []).length;
  const assignmentHits = (text.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*=/g) || []).length;
  const traceHits = (text.match(/\b(iter|step|window|sum|maxsum|count|dummy|tail|head|curr|node)\b/gi) || [])
    .length;

  if (words.length < 10) return true;
  if (letters < 30) return true;
  if (digits > letters * 0.25) return true;
  if (symbols > words.length * 1.2) return true;
  if (assignmentHits >= 2 && traceHits >= 2) return true;
  if (/(→|=>|\+\+|--|✓|⭐)/.test(text) && assignmentHits >= 1) return true;
  return false;
}

export async function chunkText(text, metadata) {
  const createdAtMs = Number(metadata.createdAtMs || Date.now());
  const docs = await splitter.createDocuments([text], [metadata]);
  const cleaned = docs
    .map((doc, index) => ({
      id: `${metadata.docId}-chunk-${index}`,
      content: normalizeChunkText(doc.pageContent),
      metadata: {
        docId: String(metadata.docId),
        filename: String(metadata.filename),
        chunkIndex: index,
        createdAtMs,
      },
    }))
    .filter((chunk) => !looksLikeCodeTraceChunk(chunk.content));

  return cleaned.length ? cleaned : docs.map((doc, index) => ({
    id: `${metadata.docId}-chunk-${index}`,
    content: normalizeChunkText(doc.pageContent),
    metadata: {
      docId: String(metadata.docId),
      filename: String(metadata.filename),
      chunkIndex: index,
      createdAtMs,
    },
  }));
}
