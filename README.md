# Transcript Summarizer & Notes Maker (RAG)

Full-stack RAG app using Express + React + LangChain + Chroma.

## What It Does
- Upload or paste transcript content (`.txt`, `.md`, `.json`, `.pdf`)
- Clean, chunk, embed, and store transcript chunks in Chroma
- Generate:
  - `summary`
  - `notes`
  - `question` answers
- Enforce structured JSON output with guardrails and fallback handling
- Show results in chat-style UI with diagnostics

## Stack
- Backend: Node.js + Express + LangChain + Chroma
- Frontend: React + Vite
- LLM: Groq (`ChatGroq`)
- Embeddings:
  - Gemini embeddings when `GEMINI_API_KEY` is configured
  - deterministic local fallback embeddings otherwise

## Prerequisites
- Node.js 20+
- Chroma running at `http://localhost:8000`
- Valid Groq API key (`GROQ_API_KEY`)

## Setup
1. Create `.env` at repo root (copy from `.env.example`).
2. Backend:
   - `cd backend`
   - `npm install`
   - `npm run dev`
3. Frontend:
   - `cd frontend`
   - `npm install`
   - `npm run dev`

## Required/Important Env Vars
Use root `.env` (no leading spaces before keys).

```env
GROQ_API_KEY=your_groq_key
CHROMA_URL=http://localhost:8000
PORT=4100
GROQ_JSON_MODE=1
DEBUG_ASK=0
DEBUG_ASK_VERBOSE=0
LOG_HTTP_ACCESS=0
```

Other useful tuning vars:
- `SUMMARY_BATCH_SIZE`
- `SUMMARY_MAX_CHUNKS`
- `SUMMARY_BATCH_CONCURRENCY`
- `QUESTION_TOP_K`
- `MIN_ANSWER_CHARS`
- `MIN_ANSWER_PARAGRAPHS`

## API Contract
- `GET /health`
- `POST /upload` (`multipart/form-data`)
  - file field: `transcript`
  - or text fields: `transcriptText`, optional `transcriptName`
  - returns: `{ docId, transcriptName, extractedLength, chunksStored }`
- `POST /ask` (`application/json`)
  - body: `{ mode: "summary|notes|question", query?: string, docId: string }`
  - `query` is required only for `mode="question"`

## Notes on Output Reliability
- Groq JSON mode (`GROQ_JSON_MODE=1`) is enabled to reduce malformed output.
- Guardrails attempt to recover JSON from common malformed model responses.
- On unrecoverable generation/parse failure, backend returns fallback response with low confidence.
- Fallback responses now keep `sources: []` (no synthetic chunk sources).

## Debugging
Minimal high-signal debug:
```env
DEBUG_ASK=1
DEBUG_ASK_VERBOSE=0
LOG_HTTP_ACCESS=0
```

Verbose model-output preview (temporary):
```env
DEBUG_ASK_VERBOSE=1
```

## Tests
Run in backend:
- `npm test`

## Reset Vector DB (Clean State)
Run in backend:
- `npm run reset:db`
