import { z } from "zod";
import { logger } from "./logger.js";

export const qaSchema = z.object({
  answer: z.string().min(1),
  sources: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("low"),
  diagram: z.string().optional().default(""),
});

export function validateModelJson(payload) {
  return qaSchema.parse(payload);
}

function stripCodeFences(value) {
  return value
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

function sanitizeJsonLikeString(value) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        result += char;
        escaped = true;
        continue;
      }

      if (char === "\"") {
        result += char;
        inString = false;
        continue;
      }

      if (char === "\n") {
        result += "\\n";
        continue;
      }

      if (char === "\r") {
        result += "\\r";
        continue;
      }

      if (char === "\t") {
        result += "\\t";
        continue;
      }
    } else if (char === "\"") {
      inString = true;
    }

    result += char;
  }

  return result;
}

function extractFirstJsonObject(value) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return "";
}

function tryParseJson(value) {
  if (!value) {
    return null;
  }

  const direct = stripCodeFences(String(value || "").trim());
  const directCandidates = [direct, sanitizeJsonLikeString(direct)];

  for (const candidate of directCandidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the extracted-object path next.
    }
  }

  const extracted = extractFirstJsonObject(direct);
  if (!extracted) {
    return null;
  }

  for (const candidate of [extracted, sanitizeJsonLikeString(extracted)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Fall through.
    }
  }

  return null;
}

export function normalizeModelContent(content) {
  const debugAsk = process.env.DEBUG_ASK === "1";
  const debugAskVerbose = process.env.DEBUG_ASK_VERBOSE === "1";
  const raw =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              typeof part === "string" ? part : (part?.text ?? part?.content ?? "")
            )
            .join("\n")
        : String(content ?? "");

  const parsed = tryParseJson(raw);
  if (parsed) {
    return parsed;
  }

  if (debugAsk) {
    const cleaned = stripCodeFences(raw);
    logger.warn(
      {
        event: "guardrails_json_parse_failed",
        stage: "all_parse_attempts",
        rawLength: cleaned.length,
        ...(debugAskVerbose
          ? { rawPreview: cleaned.slice(0, 220) }
          : {}),
      },
      "ask_debug"
    );
  }

  return {
    answer: "I don't have enough information to answer this question.",
    sources: [],
    confidence: "low",
  };
}
