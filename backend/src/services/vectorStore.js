import { ChromaClient } from "chromadb";

const chromaUrl = new URL(process.env.CHROMA_URL || "http://localhost:8000");
const client = new ChromaClient({
  host: chromaUrl.hostname,
  port: Number(chromaUrl.port || (chromaUrl.protocol === "https:" ? 443 : 80)),
  ssl: chromaUrl.protocol === "https:",
});
const collectionName = process.env.CHROMA_COLLECTION || "docs";
let collectionPromise;

async function getCollection() {
  if (!collectionPromise) {
    collectionPromise = client.getOrCreateCollection({
      name: collectionName,
      embeddingFunction: null,
    });
  }

  return collectionPromise;
}

export async function resetCollection() {
  await client.deleteCollection({ name: collectionName });
  collectionPromise = client.getOrCreateCollection({
    name: collectionName,
    embeddingFunction: null,
  });
  await collectionPromise;
}

function normalizeWhere(docId) {
  return docId ? { docId } : undefined;
}

export async function upsertChunks(chunks, vectors) {
  const collection = await getCollection();
  await collection.upsert({
    ids: chunks.map((c) => c.id),
    documents: chunks.map((c) => c.content),
    metadatas: chunks.map((c) => c.metadata),
    embeddings: vectors,
  });
}

export async function querySimilar(vector, topK = 5, docId) {
  const collection = await getCollection();
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
}

export async function getChunksByDocId(docId, batchSize = 100) {
  const collection = await getCollection();
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
}
