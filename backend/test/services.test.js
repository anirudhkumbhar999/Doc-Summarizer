import test from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "../src/services/chunkText.js";
import {
  normalizeModelContent,
  validateModelJson,
} from "../src/services/guardrails.js";
import { buildResponsePrompt } from "../src/services/promptBuilder.js";

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

test("guardrails salvage plain text answer when JSON is missing", async () => {
  const normalized = normalizeModelContent(`Summary of the transcript

The speaker explains the main idea and then lists the practical steps.`);
  const parsed = validateModelJson(normalized);
  assert.match(parsed.answer, /The speaker explains/);
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

test("prompt builder includes transcript metadata and chunk ids", async () => {
  const prompt = buildResponsePrompt({
    mode: "summary",
    query: "focus on decisions",
    transcriptLabel: "demo.txt",
    chunks: [
      {
        content: "The team decided to ship the API first and move auth cleanup to next week.",
        metadata: { chunkIndex: 3, filename: "demo.txt" },
      },
    ],
  });

  assert.match(prompt, /Transcript: demo\.txt/);
  assert.match(prompt, /User focus: focus on decisions/);
  assert.match(prompt, /\[chunk_0\]/);
  assert.match(prompt, /ship the API first/);
});
