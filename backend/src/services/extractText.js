import fs from "node:fs/promises";
import path from "node:path";
import { PDFParse } from "pdf-parse";

function isMostlySeparator(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  const separatorChars = trimmed.replace(/[=#*-]/g, "");
  return separatorChars.length <= Math.max(2, Math.floor(trimmed.length * 0.08));
}

function looksLikeInstructionTemplate(line) {
  const value = line.trim();
  if (!value) return false;

  // High-confidence prompt/template boilerplate seen in transcript dumps.
  if (/^#+\s*topic:/i.test(value)) return true;
  if (/your job is to/i.test(value)) return true;
  if (/act as (a|an)\b/i.test(value)) return true;
  if (/teacher style/i.test(value)) return true;
  if (/faang/i.test(value)) return true;
  if (/step\s*\d+\s*:/i.test(value)) return true;
  if (/topic identification/i.test(value)) return true;
  if (value.includes("############################")) return true;
  if (value.includes("========================================")) return true;

  // Lines that are basically separators (####, =====, etc.).
  if (value.length >= 8 && isMostlySeparator(value)) return true;

  return false;
}

function sanitizeTranscriptText(value) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const filtered = lines.filter((line) => !looksLikeInstructionTemplate(line));

  // If we removed too much, fall back to the original to avoid wiping real transcripts.
  if (filtered.length < Math.floor(lines.length * 0.4)) {
    return normalized;
  }

  return filtered.join("\n");
}

export function cleanTranscriptText(value) {
  const sanitized = sanitizeTranscriptText(String(value || ""));
  return sanitized.replace(/\n{3,}/g, "\n\n").trim();
}

async function extractTextFromPdf(filePath) {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const parsed = await parser.getText();
  await parser.destroy();
  return cleanTranscriptText(parsed?.text || "");
}

async function extractTextFromPlainFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return cleanTranscriptText(text);
}

export async function extractTextFromFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") {
    return extractTextFromPdf(filePath);
  }

  if ([".txt", ".md", ".json"].includes(extension)) {
    return extractTextFromPlainFile(filePath);
  }

  throw new Error(
    `Unsupported file type "${extension || "unknown"}". Use .txt, .md, .json, or .pdf.`
  );
}

export function extractTextFromPlainText(text) {
  return cleanTranscriptText(text);
}
