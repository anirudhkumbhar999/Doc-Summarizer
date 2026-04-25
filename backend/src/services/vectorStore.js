import { ChromaClient } from "chromadb";
import { logger } from "./logger.js";

const collectionName = process.env.CHROMA_COLLECTION || "docs";
const configuredStoreMode = String(process.env.VECTOR_STORE_MODE || "auto").toLowerCase();
const storeMode = ["auto", "chroma", "memory"].includes(configuredStoreMode)
  ? configuredStoreMode
  : "auto";

const memoryVectors = new Map();

let runtimeStore = storeMode === "memory" ? "memory" : "chroma";
let collectionPromise;
let chromaClient = null;

function cloneMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  return { ...metadata };
}

function createChromaClient() {
  const chromaUrl = new URL(process.env.CHROMA_URL || "http://localhost:8000");
  return new ChromaClient({
    host: chromaUrl.hostname,
    port: Number(chromaUrl.port || (chromaUrl.protocol === "https:" ? 443 : 80)),
    ssl: chromaUrl.protocol === "https:",
  });
}

function normalizeWhere(docId) {
  return docId ? { docId } : undefined;
}

function isConnectionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("failed to connect to chromadb") ||
    message.includes("connect econnrefused") ||
    message.includes("econnrefused") ||
    message.includes("fetch failed") ||
    message.includes("networkerror")
  );
}

function toHelpfulChromaError(error) {
  const baseMessage = String(error?.message || "Unknown Chroma error");
  return new Error(
    `${baseMessage}. Chroma is unavailable. Start Chroma at CHROMA_URL or set VECTOR_STORE_MODE=memory to run without Chroma.`
  );
}

function switchToMemoryFallback(error, operationName) {
  if (runtimeStore === "memory") {
    return;
  }

  runtimeStore = "memory";
  collectionPromise = null;
  chromaClient = null;
  logger.warn(
    {
      operation: operationName,
      storeMode,
      error: error?.message,
    },
    "vector_store_fallback_to_memory"
  );
}

async function getCollection() {
  if (!collectionPromise) {
    if (!chromaClient) {
      chromaClient = createChromaClient();
    }
    collectionPromise = chromaClient.getOrCreateCollection({
      name: collectionName,
      embeddingFunction: null,
    });
  }

  return collectionPromise;
}

async function withStoreOperation(operationName, chromaOperation, memoryOperation) {
  if (runtimeStore === "memory") {
    return memoryOperation();
  }

  try {
    const collection = await getCollection();
    return await chromaOperation(collection);
  } catch (error) {
    if (storeMode === "auto" && isConnectionError(error)) {
      switchToMemoryFallback(error, operationName);
      return memoryOperation();
    }

    throw toHelpfulChromaError(error);
  }
}

function cosineDistance(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) {
    return 1;
  }

  const size = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < size; index += 1) {
    const leftValue = Number(left[index]) || 0;
    const rightValue = Number(right[index]) || 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (!leftNorm || !rightNorm) {
    return 1;
  }

  const similarity = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  return 1 - similarity;
}

function getMemoryChunksByDocId(docId) {
  const chunks = [];
  for (const item of memoryVectors.values()) {
    if (docId && item.metadata?.docId !== docId) {
      continue;
    }
    chunks.push({
      id: item.id,
      content: item.content,
      metadata: cloneMetadata(item.metadata),
    });
  }

  return chunks.sort(
    (left, right) =>
      Number(left.metadata?.chunkIndex ?? 0) - Number(right.metadata?.chunkIndex ?? 0)
  );
}

export function getVectorStoreRuntime() {
  return {
    configuredMode: storeMode,
    activeMode: runtimeStore,
  };
}

export async function resetCollection() {
  if (runtimeStore === "memory") {
    memoryVectors.clear();
    return;
  }

  try {
    if (!chromaClient) {
      chromaClient = createChromaClient();
    }
    await chromaClient.deleteCollection({ name: collectionName });
    collectionPromise = chromaClient.getOrCreateCollection({
      name: collectionName,
      embeddingFunction: null,
    });
    await collectionPromise;
  } catch (error) {
    if (storeMode === "auto" && isConnectionError(error)) {
      switchToMemoryFallback(error, "resetCollection");
      memoryVectors.clear();
      return;
    }
    throw toHelpfulChromaError(error);
  }
}

export async function deleteChunksByDocId(docId) {
  await withStoreOperation(
    "deleteChunksByDocId",
    async (collection) => {
      await collection.delete({ where: normalizeWhere(docId) });
    },
    async () => {
      for (const [id, item] of memoryVectors.entries()) {
        if (item.metadata?.docId === docId) {
          memoryVectors.delete(id);
        }
      }
    }
  );
}

export async function upsertChunks(chunks, vectors) {
  await withStoreOperation(
    "upsertChunks",
    async (collection) => {
      await collection.upsert({
        ids: chunks.map((chunk) => chunk.id),
        documents: chunks.map((chunk) => chunk.content),
        metadatas: chunks.map((chunk) => chunk.metadata),
        embeddings: vectors,
      });
    },
    async () => {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        memoryVectors.set(chunk.id, {
          id: chunk.id,
          content: chunk.content,
          metadata: cloneMetadata(chunk.metadata),
          embedding: Array.isArray(vectors[index]) ? [...vectors[index]] : [],
        });
      }
    }
  );
}

export async function querySimilar(vector, topK = 5, docId) {
  return withStoreOperation(
    "querySimilar",
    async (collection) => {
      const result = await collection.query({
        queryEmbeddings: [vector],
        nResults: topK,
        where: normalizeWhere(docId),
      });

      const documents = result.documents?.[0] || [];
      const metadatas = result.metadatas?.[0] || [];
      const distances = result.distances?.[0] || [];
      const ids = result.ids?.[0] || [];

      return documents.map((content, index) => ({
        id: ids[index],
        content,
        metadata: metadatas[index],
        distance: distances[index],
      }));
    },
    async () => {
      const candidates = [];
      for (const item of memoryVectors.values()) {
        if (docId && item.metadata?.docId !== docId) {
          continue;
        }

        candidates.push({
          id: item.id,
          content: item.content,
          metadata: cloneMetadata(item.metadata),
          distance: cosineDistance(vector, item.embedding),
        });
      }

      return candidates.sort((left, right) => left.distance - right.distance).slice(0, topK);
    }
  );
}

export async function getChunksByDocId(docId, batchSize = 100) {
  return withStoreOperation(
    "getChunksByDocId",
    async (collection) => {
      const chunks = [];
      let offset = 0;

      while (true) {
        const result = await collection.get({
          where: normalizeWhere(docId),
          include: ["documents", "metadatas"],
          limit: batchSize,
          offset,
        });

        const documents = result.documents || [];
        const metadatas = result.metadatas || [];
        const ids = result.ids || [];

        if (!documents.length) {
          break;
        }

        for (let index = 0; index < documents.length; index += 1) {
          chunks.push({
            id: ids[index],
            content: documents[index],
            metadata: metadatas[index],
          });
        }

        if (documents.length < batchSize) {
          break;
        }

        offset += batchSize;
      }

      return chunks.sort(
        (left, right) =>
          Number(left.metadata?.chunkIndex ?? 0) - Number(right.metadata?.chunkIndex ?? 0)
      );
    },
    async () => getMemoryChunksByDocId(docId)
  );
}

export async function purgeExpiredDocs(ttlMs, batchSize = 200) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return {
      scannedDocCount: 0,
      expiredDocCount: 0,
      deletedDocCount: 0,
    };
  }

  if (runtimeStore === "memory") {
    const cutoffMs = Date.now() - ttlMs;
    const firstSeenDocTimestampById = new Map();

    for (const item of memoryVectors.values()) {
      const docId = String(item.metadata?.docId || "").trim();
      if (!docId) {
        continue;
      }
      const createdAtMs = Number(item.metadata?.createdAtMs);
      if (!Number.isFinite(createdAtMs)) {
        continue;
      }

      const existing = firstSeenDocTimestampById.get(docId);
      if (existing === undefined || createdAtMs < existing) {
        firstSeenDocTimestampById.set(docId, createdAtMs);
      }
    }

    const expiredDocIds = [];
    for (const [docId, createdAtMs] of firstSeenDocTimestampById.entries()) {
      if (createdAtMs <= cutoffMs) {
        expiredDocIds.push(docId);
      }
    }

    for (const docId of expiredDocIds) {
      for (const [id, item] of memoryVectors.entries()) {
        if (item.metadata?.docId === docId) {
          memoryVectors.delete(id);
        }
      }
    }

    return {
      scannedDocCount: firstSeenDocTimestampById.size,
      expiredDocCount: expiredDocIds.length,
      deletedDocCount: expiredDocIds.length,
    };
  }

  return withStoreOperation(
    "purgeExpiredDocs",
    async (collection) => {
      const cutoffMs = Date.now() - ttlMs;
      const firstSeenDocTimestampById = new Map();
      let offset = 0;

      while (true) {
        const result = await collection.get({
          include: ["metadatas"],
          limit: batchSize,
          offset,
        });

        const metadatas = result.metadatas || [];
        if (!metadatas.length) {
          break;
        }

        for (const metadata of metadatas) {
          const docId = String(metadata?.docId || "").trim();
          if (!docId) {
            continue;
          }

          const createdAtMs = Number(metadata?.createdAtMs);
          if (!Number.isFinite(createdAtMs)) {
            continue;
          }

          const existing = firstSeenDocTimestampById.get(docId);
          if (existing === undefined || createdAtMs < existing) {
            firstSeenDocTimestampById.set(docId, createdAtMs);
          }
        }

        if (metadatas.length < batchSize) {
          break;
        }

        offset += batchSize;
      }

      const expiredDocIds = [];
      for (const [docId, createdAtMs] of firstSeenDocTimestampById.entries()) {
        if (createdAtMs <= cutoffMs) {
          expiredDocIds.push(docId);
        }
      }

      for (const docId of expiredDocIds) {
        await collection.delete({ where: normalizeWhere(docId) });
      }

      return {
        scannedDocCount: firstSeenDocTimestampById.size,
        expiredDocCount: expiredDocIds.length,
        deletedDocCount: expiredDocIds.length,
      };
    },
    async () => ({
      scannedDocCount: 0,
      expiredDocCount: 0,
      deletedDocCount: 0,
    })
  );
}
