import test from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "../src/services/chunkText.js";
import {
  normalizeModelContent,
  validateModelJson,
} from "../src/services/guardrails.js";

test("chunkText returns chunk metadata", async () => {
  const text = "A".repeat(1200);
  const chunks = await chunkText(text, { docId: "doc-1", filename: "test.pdf" });
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].metadata.docId, "doc-1");
  assert.equal(chunks[0].metadata.filename, "test.pdf");
});

test("guardrails normalize invalid JSON", async () => {
  const normalized = normalizeModelContent("not json");
  const parsed = validateModelJson(normalized);
  assert.equal(parsed.confidence, "low");
});

test("guardrails parse fenced JSON output", async () => {
  const normalized = normalizeModelContent(`\`\`\`json
{
  "answer": "RAG summary content",
  "sources": ["chunk_0", "chunk_1"],
  "confidence": "high",
  "diagram": ""
}
\`\`\``);

  const parsed = validateModelJson(normalized);
  assert.equal(parsed.answer, "RAG summary content");
  assert.deepEqual(parsed.sources, ["chunk_0", "chunk_1"]);
  assert.equal(parsed.confidence, "high");
});

test("guardrails parse JSON when model appends extra markdown", async () => {
  const normalized = normalizeModelContent(`\`\`\`json
{
  "answer": "Response Generation Failure Analysis",
  "sources": ["partial_0"],
  "confidence": "high",
  "diagram": "\`\`\`mermaid
graph LR
    A[Transcript Found] -->|Failed Response Generation|> B[Retry Moment]
\`\`\`"
}
\`\`\`

**Summary Report**
Extra text after JSON`);

  const parsed = validateModelJson(normalized);
  assert.equal(parsed.answer, "Response Generation Failure Analysis");
  assert.deepEqual(parsed.sources, ["partial_0"]);
  assert.equal(parsed.confidence, "high");
  assert.ok(parsed.diagram.includes("mermaid"));
});
