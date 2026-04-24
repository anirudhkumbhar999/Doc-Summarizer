import express from "express";
import { ChatGroq } from "@langchain/groq";
import { retrieveTopK } from "../services/retriever.js";
import { buildBatchSynthesisPrompt, buildRagPrompt } from "../services/promptBuilder.js";
import { fallbackResponse } from "../services/fallback.js";
import { normalizeModelContent, validateModelJson } from "../services/guardrails.js";
import { getChunksByDocId } from "../services/vectorStore.js";
import { logger, withTiming } from "../services/logger.js";

const router = express.Router();
const llm = new ChatGroq({
  model: process.env.CHAT_MODEL || "llama-3.1-8b-instant",
  temperature: Number(process.env.TEMPERATURE || 0.2),
  apiKey: process.env.GROQ_API_KEY,
});
const minAnswerChars = Number(process.env.MIN_ANSWER_CHARS || 280);
const minAnswerParagraphs = Number(process.env.MIN_ANSWER_PARAGRAPHS || 2);
const allowedModes = new Set(["summary", "notes", "question"]);
const summaryBatchSize = Number(process.env.SUMMARY_BATCH_SIZE || 12);
const summaryMaxChunks = Number(process.env.SUMMARY_MAX_CHUNKS || 48);
const summaryBatchConcurrency = Number(process.env.SUMMARY_BATCH_CONCURRENCY || 3);
const questionTopK = Number(process.env.QUESTION_TOP_K || 8);
const hasRemoteModel = Boolean(process.env.GROQ_API_KEY?.trim());
const groqJsonMode = process.env.GROQ_JSON_MODE !== "0";
const debugAsk = process.env.DEBUG_ASK === "1";
const debugAskVerbose = process.env.DEBUG_ASK_VERBOSE === "1";

function previewText(value, maxLength = 300) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function generateStructuredAnswer(prompt, context = {}) {
  const modelResult = await withTiming("llm_generate", () =>
    llm.invoke(
      prompt,
      groqJsonMode ? { response_format: { type: "json_object" } } : undefined
    )
  );
  const rawContent =
    typeof modelResult.content === "string"
      ? modelResult.content
      : Array.isArray(modelResult.content)
        ? modelResult.content
            .map((part) =>
              typeof part === "string" ? part : (part?.text ?? part?.content ?? "")
            )
            .join("\n")
        : String(modelResult.content ?? "");

  if (debugAsk) {
    const rawMeta = {
      rawLength: rawContent.length,
      hasJsonFence: /```json/i.test(rawContent),
      hasCodeFence: /```/.test(rawContent),
      hasMermaid: /```mermaid/i.test(rawContent),
    };
    logger.info(
      {
        event: "llm_raw_output",
        context,
        jsonMode: groqJsonMode,
        ...rawMeta,
        ...(debugAskVerbose ? { rawPreview: previewText(rawContent, 220) } : {}),
      },
      "ask_debug"
    );
  }

  const parsed = normalizeModelContent(modelResult.content);
  const validated = validateModelJson(parsed);

  if (debugAsk) {
    logger.info(
      {
        event: "llm_parsed_output",
        context,
        parsedKeys: Object.keys(parsed || {}),
        answerLength: validated.answer.length,
        sourceCount: Array.isArray(validated.sources) ? validated.sources.length : 0,
        confidence: validated.confidence,
        ...(debugAskVerbose
          ? { answerPreview: previewText(validated.answer, 220) }
          : {}),
      },
      "ask_debug"
    );
  }

  return validated;
}

function paragraphCount(answer) {
  return answer
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function queryForMode(mode, query) {
  if (mode === "question") {
    return query;
  }

  if (mode === "notes") {
    return "transcript notes key points action items topics";
  }

  return "transcript summary key decisions outcomes";
}

function chunkArray(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function minCharsForMode(mode) {
  if (mode === "summary") return Math.max(minAnswerChars, 420);
  if (mode === "notes") return Math.max(minAnswerChars, 360);
  return minAnswerChars;
}

function pickSummaryChunks(chunks, maxChunks) {
  if (chunks.length <= maxChunks) {
    return chunks;
  }

  const picks = [];
  const usedIndexes = new Set();

  for (let slot = 0; slot < maxChunks; slot += 1) {
    const index = Math.min(
      chunks.length - 1,
      Math.floor((slot * chunks.length) / maxChunks)
    );

    if (!usedIndexes.has(index)) {
      picks.push(chunks[index]);
      usedIndexes.add(index);
    }
  }

  return picks.sort(
    (left, right) =>
      Number(left.metadata?.chunkIndex ?? 0) - Number(right.metadata?.chunkIndex ?? 0)
  );
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function normalizeSourcesFromContext(sources, answer, retrieved) {
  const allowed = new Set(retrieved.map((_, index) => `chunk_${index}`));
  const normalized = (Array.isArray(sources) ? sources : []).filter((source) =>
    allowed.has(source)
  );

  if (normalized.length) {
    return [...new Set(normalized)];
  }

  const matchedInAnswer = [...answer.matchAll(/chunk_(\d+)/g)]
    .map((match) => `chunk_${match[1]}`)
    .filter((source) => allowed.has(source));

  if (matchedInAnswer.length) {
    return [...new Set(matchedInAnswer)];
  }

  return retrieved.slice(0, 3).map((_chunk, index) => `chunk_${index}`);
}

function refineInstruction(mode, minChars, minParagraphs) {
  return `Important: rewrite your previous output and improve quality.
- Keep strict JSON.
- Answer length must be at least ${minChars} characters.
- Use at least ${minParagraphs} paragraphs with explicit blank lines ("\\n\\n").
- Follow the required ${mode} section structure.
- Make it clear and chat-style, not terse.`;
}

function isCanonicalFailure(answer) {
  return (
    answer === "I couldn't build a grounded response from the current transcript context." ||
    answer === "I don't have enough information to answer this question."
  );
}

function isFallbackPayload(payload) {
  return Boolean(payload?.fallbackReason);
}

async function generateLongFormFromChunks({ mode, query, chunks }) {
  if (!hasRemoteModel) {
    return fallbackResponse("llm_unavailable");
  }

  const selectedChunks = pickSummaryChunks(chunks, summaryMaxChunks);
  const batches = chunkArray(selectedChunks, summaryBatchSize);
  const partials = (
    await mapWithConcurrency(batches, summaryBatchConcurrency, async (batch) => {
      try {
        const partial = await generateStructuredAnswer(
          buildRagPrompt({ mode, query, chunks: batch }),
          {
            stage: "long_form_batch",
            mode,
            batchChunkCount: batch.length,
            totalChunkCount: chunks.length,
          }
        );
        return isCanonicalFailure(partial.answer) ? null : partial;
      } catch (error) {
        if (debugAsk) {
          logger.warn(
            {
              event: "long_form_batch_failed",
              mode,
              batchChunkCount: batch.length,
              error: error.message,
            },
            "ask_debug"
          );
        }
        return null;
      }
    })
  ).filter(Boolean);

  if (!partials.length) {
    return fallbackResponse("llm_or_retrieval_failure");
  }

  if (partials.length === 1) {
    return partials[0];
  }

  return generateStructuredAnswer(
    buildBatchSynthesisPrompt({
      mode,
      query,
      partialAnswers: partials.map((item) => item.answer),
    }),
    {
      stage: "long_form_synthesis",
      mode,
      partialCount: partials.length,
      totalChunkCount: chunks.length,
    }
  ).catch(() => fallbackResponse("llm_or_retrieval_failure"));
}

async function refineLongFormAnswer({ mode, query, answer }) {
  return generateStructuredAnswer(
    `${buildBatchSynthesisPrompt({
      mode,
      query,
      partialAnswers: [answer],
    })}\n\n${refineInstruction(mode, minCharsForMode(mode), minAnswerParagraphs)}`,
    {
      stage: "long_form_refine",
      mode,
      answerLength: answer.length,
    }
  ).catch(() => null);
}

router.post("/", async (req, res) => {
  const { query = "", mode = "question", docId = "" } = req.body || {};
  if (!allowedModes.has(mode)) {
    return res.status(400).json({ error: "mode must be one of: summary, notes, question" });
  }

  if (!docId.trim()) {
    return res.status(400).json({
      ...fallbackResponse("missing_transcript"),
      mode,
    });
  }

  if (mode === "question" && !query.trim()) {
    return res.status(400).json({ error: "query is required when mode=question" });
  }

  try {
    let retrieved = [];
    let totalChunks = 0;
    let safe;

    if (debugAsk) {
      logger.info(
        {
          event: "ask_request_start",
          mode,
          docId,
          queryPreview: previewText(query, 160),
        },
        "ask_debug"
      );
    }

    if (!hasRemoteModel) {
      return res.status(200).json({
        ...fallbackResponse("llm_unavailable"),
        mode,
        diagnostics: { docId },
      });
    }

    if (mode === "question") {
      const retrievalQuery = queryForMode(mode, query);
      retrieved = await withTiming("retrieve_context", () =>
        retrieveTopK(retrievalQuery, questionTopK, docId)
      );
      if (!retrieved.length) {
        return res.json({
          ...fallbackResponse("no_relevant_context"),
          mode,
          diagnostics: { topK: 0, results: [], docId },
        });
      }

      const prompt = buildRagPrompt({ mode, query, chunks: retrieved });
      try {
        safe = await generateStructuredAnswer(prompt, {
          stage: "question",
          mode,
          retrievedCount: retrieved.length,
        });
      } catch (error) {
        if (debugAsk) {
          logger.warn(
            { event: "question_generation_failed", mode, error: error.message },
            "ask_debug"
          );
        }
        safe = fallbackResponse("llm_or_retrieval_failure");
      }
    } else {
      retrieved = await withTiming("load_transcript_chunks", () => getChunksByDocId(docId));
      totalChunks = retrieved.length;
      if (!retrieved.length) {
        return res.json({
          ...fallbackResponse("no_relevant_context"),
          mode,
          diagnostics: { topK: 0, results: [], docId },
        });
      }

      safe = await withTiming("long_form_generation", () =>
        generateLongFormFromChunks({ mode, query, chunks: retrieved })
      );
    }

    if (!retrieved.length) {
      return res.json({
        ...fallbackResponse("no_relevant_context"),
        mode,
        diagnostics: { topK: 0, results: [], docId },
      });
    }

    const targetMinChars = minCharsForMode(mode);
    const isFallback = isFallbackPayload(safe);
    const shortAnswer =
      safe.answer.length < targetMinChars &&
      !isCanonicalFailure(safe.answer) &&
      !isFallback;
    const tooFewParagraphs =
      paragraphCount(safe.answer) < minAnswerParagraphs &&
      !isCanonicalFailure(safe.answer) &&
      !isFallback;

    if (shortAnswer || tooFewParagraphs) {
      if (mode === "question") {
        try {
          safe = await generateStructuredAnswer(
            `${buildRagPrompt({ mode, query, chunks: retrieved })}\n\n${refineInstruction(
              mode,
              targetMinChars,
              minAnswerParagraphs
            )}`,
            {
              stage: "question_refine",
              mode,
              retrievedCount: retrieved.length,
              priorAnswerLength: safe.answer.length,
            }
          );
        } catch (error) {
          if (debugAsk) {
            logger.warn(
              { event: "question_refine_failed", mode, error: error.message },
              "ask_debug"
            );
          }
          safe = fallbackResponse("llm_or_retrieval_failure");
        }
      } else {
        const refined = await refineLongFormAnswer({
          mode,
          query,
          answer: safe.answer,
        });
        if (refined && !isCanonicalFailure(refined.answer)) {
          safe = refined;
        }
      }
    }

    const keepSourcesEmpty =
      isFallbackPayload(safe) || isCanonicalFailure(safe.answer);
    const safeWithNormalizedSources = {
      ...safe,
      sources: keepSourcesEmpty
        ? []
        : normalizeSourcesFromContext(safe.sources, safe.answer, retrieved),
    };

    if (debugAsk) {
      logger.info(
        {
          event: "ask_response_ready",
          mode,
          isFallback,
          fallbackReason: safeWithNormalizedSources.fallbackReason,
          answerLength: safeWithNormalizedSources.answer.length,
          sourceCount: safeWithNormalizedSources.sources.length,
          chunkCount: retrieved.length,
          totalChunkCount: totalChunks || undefined,
          shortAnswer,
          tooFewParagraphs,
          ...(debugAskVerbose
            ? { answerPreview: previewText(safeWithNormalizedSources.answer, 220) }
            : {}),
        },
        "ask_debug"
      );
    }

    return res.json({
      ...safeWithNormalizedSources,
      mode,
      diagnostics: {
        topK: mode === "question" ? retrieved.length : undefined,
        chunkCount: retrieved.length,
        totalChunkCount: mode === "question" ? undefined : totalChunks,
        processedChunkCount:
          mode === "question" ? undefined : Math.min(retrieved.length, summaryMaxChunks),
        docId,
        results: retrieved.slice(0, 20).map((chunk) => ({
          id: chunk.id,
          distance: chunk.distance,
          docId: chunk.metadata?.docId,
          chunkIndex: chunk.metadata?.chunkIndex,
        })),
      },
    });
  } catch (error) {
    logger.error(
      {
        event: "ask_route_failed",
        mode,
        docId,
        error: error.message,
      },
      "ask_debug"
    );
    return res.status(200).json({
      ...fallbackResponse("llm_or_retrieval_failure"),
      mode,
      error: error.message,
    });
  }
});

export default router;
