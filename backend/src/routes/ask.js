import express from "express";
import { ChatGroq } from "@langchain/groq";
import { retrieveTopK } from "../services/retriever.js";
import { buildRepairPrompt, buildResponsePrompt } from "../services/promptBuilder.js";
import { fallbackResponse } from "../services/fallback.js";
import { normalizeModelContent, validateModelJson } from "../services/guardrails.js";
import { getChunksByDocId } from "../services/vectorStore.js";
import { logger, withTiming } from "../services/logger.js";

const router = express.Router();
const hasRemoteModel = Boolean(process.env.GROQ_API_KEY?.trim());
const groqJsonMode = process.env.GROQ_JSON_MODE !== "0";
const debugAsk = process.env.DEBUG_ASK === "1";
const debugAskVerbose = process.env.DEBUG_ASK_VERBOSE === "1";
const llm = hasRemoteModel
  ? new ChatGroq({
      model: process.env.CHAT_MODEL || "llama-3.1-8b-instant",
      temperature: Number(process.env.TEMPERATURE || 0.2),
      apiKey: process.env.GROQ_API_KEY,
    })
  : null;

const allowedModes = new Set(["summary", "notes", "question"]);
const baseMinAnswerChars = Number(process.env.MIN_ANSWER_CHARS || 280);
const questionTopK = Number(process.env.QUESTION_TOP_K || 8);
const summaryContextLimit = Math.max(
  8,
  Math.min(Number(process.env.SUMMARY_MAX_CHUNKS || 14), 18)
);
const notesContextLimit = Math.max(
  10,
  Math.min(Number(process.env.SUMMARY_MAX_CHUNKS || 16), 20)
);

function previewText(value, maxLength = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getRawModelContent(content) {
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part) =>
            typeof part === "string" ? part : (part?.text ?? part?.content ?? "")
          )
          .join("\n")
      : String(content ?? "");
}

function isCanonicalFailure(answer) {
  return (
    answer === "I couldn't build a grounded response from the current transcript context." ||
    answer === "I don't have enough information to answer this question."
  );
}

function paragraphCount(answer) {
  return String(answer || "")
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function minCharsForMode(mode) {
  if (mode === "summary") return Math.max(baseMinAnswerChars, 420);
  if (mode === "notes") return Math.max(baseMinAnswerChars, 360);
  return Math.max(baseMinAnswerChars, 220);
}

function sampleDistributedChunks(chunks, count) {
  if (chunks.length <= count) {
    return chunks;
  }

  const picks = [];
  const usedIndexes = new Set();

  for (let slot = 0; slot < count; slot += 1) {
    const index = Math.min(
      chunks.length - 1,
      Math.floor((slot * chunks.length) / count)
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

function mergeUniqueChunks(chunks) {
  const seen = new Set();
  return chunks.filter((chunk) => {
    if (!chunk?.id || seen.has(chunk.id)) {
      return false;
    }
    seen.add(chunk.id);
    return true;
  });
}

function normalizeSourcesFromContext(sources, answer, contextChunks) {
  const allowed = new Set(contextChunks.map((_, index) => `chunk_${index}`));
  const normalized = (Array.isArray(sources) ? sources : []).filter((source) =>
    allowed.has(source)
  );

  if (normalized.length) {
    return [...new Set(normalized)];
  }

  const matchedInAnswer = [...String(answer || "").matchAll(/chunk_(\d+)/g)]
    .map((match) => `chunk_${match[1]}`)
    .filter((source) => allowed.has(source));

  if (matchedInAnswer.length) {
    return [...new Set(matchedInAnswer)];
  }

  return contextChunks.slice(0, Math.min(3, contextChunks.length)).map((_, index) => `chunk_${index}`);
}

async function chooseContextChunks({ mode, query, docId }) {
  const allChunks = await withTiming("load_transcript_chunks", () => getChunksByDocId(docId));
  if (!allChunks.length) {
    return {
      allChunks: [],
      selectedChunks: [],
      selectionStrategy: "empty",
    };
  }

  if (mode === "question") {
    const selectedChunks = await withTiming("retrieve_context", () =>
      retrieveTopK(query, questionTopK, docId)
    );

    return {
      allChunks,
      selectedChunks,
      selectionStrategy: "retrieval",
    };
  }

  const baseLimit = mode === "notes" ? notesContextLimit : summaryContextLimit;
  const distributed = sampleDistributedChunks(allChunks, baseLimit);

  if (!query.trim()) {
    return {
      allChunks,
      selectedChunks: distributed,
      selectionStrategy: "distributed",
    };
  }

  const focused = await withTiming("retrieve_focus_context", () =>
    retrieveTopK(`${mode} ${query}`, Math.min(questionTopK, 6), docId)
  );

  return {
    allChunks,
    selectedChunks: mergeUniqueChunks([...focused, ...distributed]).slice(0, baseLimit + 4),
    selectionStrategy: "focused+distributed",
  };
}

async function invokeModel(prompt, { jsonMode, context }) {
  const modelResult = await withTiming(
    jsonMode ? "llm_generate_json" : "llm_generate_plain",
    () =>
      llm.invoke(
        prompt,
        jsonMode ? { response_format: { type: "json_object" } } : undefined
      )
  );

  const rawContent = getRawModelContent(modelResult.content);
  const normalized = normalizeModelContent(rawContent);
  const payload = validateModelJson(normalized);

  if (debugAsk) {
    logger.info(
      {
        event: "llm_attempt_complete",
        attempt: jsonMode ? "json_mode" : "plain_mode",
        context,
        rawLength: rawContent.length,
        answerLength: payload.answer.length,
        confidence: payload.confidence,
        ...(debugAskVerbose
          ? {
              rawPreview: previewText(rawContent),
              answerPreview: previewText(payload.answer),
            }
          : {}),
      },
      "ask_debug"
    );
  }

  return { rawContent, payload };
}

async function generateStructuredResponse({
  mode,
  query,
  transcriptLabel,
  chunks,
  extraInstruction = "",
}) {
  const prompt = buildResponsePrompt({
    mode,
    query,
    transcriptLabel,
    chunks,
    extraInstruction,
  });

  let lastRawContent = "";

  if (groqJsonMode) {
    try {
      const result = await invokeModel(prompt, {
        jsonMode: true,
        context: { mode, stage: "primary", chunkCount: chunks.length },
      });
      lastRawContent = result.rawContent;
      if (!isCanonicalFailure(result.payload.answer)) {
        return result.payload;
      }
    } catch (error) {
      if (debugAsk) {
        logger.warn(
          { event: "llm_json_mode_failed", mode, error: error.message },
          "ask_debug"
        );
      }
    }
  }

  try {
    const result = await invokeModel(prompt, {
      jsonMode: false,
      context: { mode, stage: "plain_retry", chunkCount: chunks.length },
    });
    lastRawContent = result.rawContent;
    if (!isCanonicalFailure(result.payload.answer)) {
      return result.payload;
    }
  } catch (error) {
    if (debugAsk) {
      logger.warn(
        { event: "llm_plain_mode_failed", mode, error: error.message },
        "ask_debug"
      );
    }
  }

  if (lastRawContent.trim()) {
    try {
      const repair = await invokeModel(buildRepairPrompt(lastRawContent), {
        jsonMode: groqJsonMode,
        context: { mode, stage: "repair" },
      });
      if (!isCanonicalFailure(repair.payload.answer)) {
        return repair.payload;
      }
    } catch (error) {
      if (debugAsk) {
        logger.warn(
          { event: "llm_repair_failed", mode, error: error.message },
          "ask_debug"
        );
      }
    }

    return validateModelJson(normalizeModelContent(lastRawContent));
  }

  return fallbackResponse("llm_or_retrieval_failure");
}

async function maybeExpandAnswer({ mode, query, transcriptLabel, chunks, payload }) {
  const answer = String(payload?.answer || "").trim();
  if (!answer || payload?.fallbackReason || isCanonicalFailure(answer)) {
    return payload;
  }

  const targetMinChars = minCharsForMode(mode);
  const tooShort = answer.length < targetMinChars;
  const tooFlat = paragraphCount(answer) < (mode === "question" ? 2 : 3);

  if (!tooShort && !tooFlat) {
    return payload;
  }

  try {
    const expanded = await generateStructuredResponse({
      mode,
      query,
      transcriptLabel,
      chunks,
      extraInstruction: [
        `Your previous draft was too short or too flat.`,
        `Expand it into a stronger ${mode} response.`,
        `Keep it grounded in the transcript context only.`,
        `Previous draft: ${answer}`,
      ].join("\n"),
    });

    if (expanded.answer.length > answer.length && !isCanonicalFailure(expanded.answer)) {
      return expanded;
    }
  } catch (error) {
    if (debugAsk) {
      logger.warn(
        { event: "llm_expand_failed", mode, error: error.message },
        "ask_debug"
      );
    }
  }

  return payload;
}

router.post("/", async (req, res) => {
  const { query = "", mode = "question", docId = "" } = req.body || {};

  if (!allowedModes.has(mode)) {
    return res.status(400).json({ error: "mode must be one of: summary, notes, question" });
  }

  if (!String(docId || "").trim()) {
    return res.status(400).json({
      ...fallbackResponse("missing_transcript"),
      mode,
    });
  }

  if (mode === "question" && !String(query || "").trim()) {
    return res.status(400).json({ error: "query is required when mode=question" });
  }

  if (!hasRemoteModel) {
    return res.status(200).json({
      ...fallbackResponse("llm_unavailable"),
      mode,
      diagnostics: { docId },
    });
  }

  try {
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

    const { allChunks, selectedChunks, selectionStrategy } = await chooseContextChunks({
      mode,
      query: String(query || ""),
      docId: String(docId || ""),
    });

    if (!allChunks.length) {
      return res.status(200).json({
        ...fallbackResponse("no_relevant_context"),
        mode,
        diagnostics: {
          docId,
          chunkCount: 0,
          totalChunkCount: 0,
          selectionStrategy,
        },
      });
    }

    if (!selectedChunks.length) {
      return res.status(200).json({
        ...fallbackResponse("no_relevant_context"),
        mode,
        diagnostics: {
          docId,
          chunkCount: 0,
          totalChunkCount: allChunks.length,
          selectionStrategy,
        },
      });
    }

    const transcriptLabel =
      String(selectedChunks[0]?.metadata?.filename || allChunks[0]?.metadata?.filename || "Transcript");

    let payload = await generateStructuredResponse({
      mode,
      query: String(query || ""),
      transcriptLabel,
      chunks: selectedChunks,
    });

    payload = await maybeExpandAnswer({
      mode,
      query: String(query || ""),
      transcriptLabel,
      chunks: selectedChunks,
      payload,
    });

    const keepSourcesEmpty =
      Boolean(payload.fallbackReason) || isCanonicalFailure(payload.answer);

    const response = {
      ...payload,
      mode,
      sources: keepSourcesEmpty
        ? []
        : normalizeSourcesFromContext(payload.sources, payload.answer, selectedChunks),
      diagnostics: {
        docId,
        transcriptName: transcriptLabel,
        chunkCount: selectedChunks.length,
        totalChunkCount: allChunks.length,
        selectionStrategy,
        results: selectedChunks.slice(0, 20).map((chunk) => ({
          id: chunk.id,
          docId: chunk.metadata?.docId,
          chunkIndex: chunk.metadata?.chunkIndex,
          filename: chunk.metadata?.filename,
        })),
      },
    };

    if (debugAsk) {
      logger.info(
        {
          event: "ask_response_ready",
          mode,
          chunkCount: response.diagnostics.chunkCount,
          totalChunkCount: response.diagnostics.totalChunkCount,
          fallbackReason: response.fallbackReason,
          answerLength: response.answer.length,
          sourceCount: response.sources.length,
          selectionStrategy,
          ...(debugAskVerbose ? { answerPreview: previewText(response.answer) } : {}),
        },
        "ask_debug"
      );
    }

    return res.status(200).json(response);
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
      diagnostics: {
        docId,
      },
    });
  }
});

export default router;
