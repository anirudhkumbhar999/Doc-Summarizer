import { embedQueryText } from "./embeddings.js";
import { getChunksByDocId, querySimilar } from "./vectorStore.js";

export async function retrieveTopK(
  query,
  topK = Number(process.env.RETRIEVAL_TOP_K || 5),
  docId
) {
  const [queryVector, allChunks] = await Promise.all([
    embedQueryText(query),
    getChunksByDocId(docId),
  ]);
  const vectorCandidates = await querySimilar(queryVector, Math.max(topK * 4, topK), docId);
  const ranked = rerankChunks(query, allChunks, vectorCandidates);
  return ranked.slice(0, topK);
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
}

function chunkQualityScore(content) {
  const text = String(content || "");
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  const punctuation = (text.match(/[=<>[\]{}()|:_-]/g) || []).length;
  const words = tokenize(text).length;

  let score = 0;
  if (words >= 12) score += 2;
  if (letters >= 80) score += 2;
  if (digits > letters * 0.2) score -= 3;
  if (punctuation > words) score -= 2;
  if (/(iter|step|window|sum|maxsum|count|dummy|tail|head|curr|node)\b/i.test(text)) score -= 2;
  if (/your job is|act as|teacher style|faang|topic identification/i.test(text)) score -= 4;
  return score;
}

function sentenceShapeScore(content) {
  const text = String(content || "");
  let score = 0;
  if (/[.!?]/.test(text)) score += 2;
  if ((text.match(/[A-Z][a-z]+/g) || []).length >= 2) score += 1;
  if (text.length >= 120 && text.length <= 900) score += 2;
  if (/your job is|act as|teacher style|faang|topic identification/i.test(text)) score -= 6;
  return score;
}

function rerankChunks(query, allChunks, vectorCandidates) {
  const queryTerms = new Set(tokenize(query));
  const vectorDistanceById = new Map(vectorCandidates.map((chunk) => [chunk.id, chunk.distance]));

  return allChunks
    .map((chunk) => {
      const contentTerms = tokenize(chunk.content);
      const overlap = contentTerms.reduce((total, term) => total + (queryTerms.has(term) ? 1 : 0), 0);
      const lexicalBoost = Math.min(12, overlap * 2);
      const qualityBoost = chunkQualityScore(chunk.content);
      const shapeBoost = sentenceShapeScore(chunk.content);
      const distance = vectorDistanceById.get(chunk.id);
      const distanceBoost = Number.isFinite(distance) ? Math.max(0, 8 - Number(distance)) : 0;

      return {
        ...chunk,
        distance,
        rerankScore: lexicalBoost + qualityBoost + shapeBoost + distanceBoost,
      };
    })
    .sort((left, right) => right.rerankScore - left.rerankScore);
}
