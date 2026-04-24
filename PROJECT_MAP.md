# Project Map

Purpose: quick orientation for future work without re-scanning the entire repo.

## What this project is

Transcript Summarizer & Notes Maker (RAG) app:
- Backend: Node.js + Express + LangChain + Chroma
- Frontend: React + Vite
- Core flow: upload transcript -> clean/extract text -> chunk -> embed -> store in Chroma -> ask summary/notes/question -> retrieve -> LLM JSON answer

## Top-level folders

- `backend/`: API, RAG pipeline, tests
- `frontend/`: UI and API client
- `chroma-data/`: local Chroma persistence (generated runtime data)
- `backend/uploads/`: uploaded PDFs (generated runtime data)

## Critical run path (backend)

1. `backend/src/server.js`
   - Loads env files
   - Registers routes: `/upload`, `/ask`, `/health`

2. `backend/src/routes/upload.js`
   - Accepts `multipart/form-data` field `transcript`
   - Calls:
     - `extractTextFromPdf` -> `services/extractText.js`
     - `chunkText` -> `services/chunkText.js`
     - `embedTexts` -> `services/embeddings.js`
     - `upsertChunks` -> `services/vectorStore.js`

3. `backend/src/routes/ask.js`
   - Accepts `{ query }`
   - Calls:
     - `retrieveTopK` -> `services/retriever.js`
     - `buildQaPrompt` -> `services/promptBuilder.js`
     - Groq LLM invoke
     - `normalizeModelContent` + `validateModelJson` -> `services/guardrails.js`
   - Returns fallback answer on retrieval/LLM failure

## Backend services map

- `services/extractText.js`: PDF text extraction via `pdf-parse`
- `services/chunkText.js`: chunking (`RecursiveCharacterTextSplitter`)
- `services/embeddings.js`:
  - Uses Gemini embeddings when `GEMINI_API_KEY` exists
  - Falls back to deterministic local embedding if unavailable
- `services/vectorStore.js`: Chroma client, upsert/query collection
- `services/retriever.js`: query embedding + vector similarity lookup
- `services/promptBuilder.js`: strict JSON QA prompt template
- `services/guardrails.js`: parse/validate model JSON output with `zod`
- `services/fallback.js`: canonical low-confidence fallback response
- `services/logger.js`: `pino` logger and timing wrapper

## Frontend map

- `frontend/src/main.ts`: mounts React app
- `frontend/src/App.jsx`: page state and orchestration
- `frontend/src/api/client.js`: Axios client and API wrappers
- `frontend/src/components/UploadPanel.jsx`: PDF upload form
- `frontend/src/components/AskPanel.jsx`: question input form
- `frontend/src/components/ResultView.jsx`: answer, copy/fullscreen, diagnostics
- `frontend/src/components/SystemStatus.jsx`: backend health + error display
- `frontend/src/style.css`: global and component styling

## API contract summary

- `GET /health` -> `{ status, service }`
- `POST /upload` (multipart, field `transcript`) -> `{ docId, transcriptName, extractedLength, chunksStored }`
- `POST /ask` (json `{ mode, query }`) -> `{ answer, sources, confidence, mode, diagnostics? }`

## Environment and config touchpoints

Primary reference:
- `.env.example`

Most used variables:
- `PORT`, `VITE_API_BASE_URL`
- `CHROMA_URL`, `CHROMA_COLLECTION`
- `GROQ_API_KEY`, `GEMINI_API_KEY`
- `CHUNK_SIZE`, `CHUNK_OVERLAP`, `RETRIEVAL_TOP_K`
- `CHAT_MODEL`, `TEMPERATURE`, `MIN_ANSWER_CHARS`, `MIN_ANSWER_PARAGRAPHS`
- `SUMMARY_BATCH_SIZE`, `SUMMARY_MAX_CHUNKS`, `SUMMARY_BATCH_CONCURRENCY`, `QUESTION_TOP_K`

## Tests

- `backend/test/services.test.js`
  - Validates chunk metadata behavior
  - Validates guardrail normalization/parsing behavior

## Routine navigation guidance

Use these first when debugging:
1. Backend behavior issue -> `backend/src/routes/*.js` then `backend/src/services/*.js`
2. UI behavior issue -> `frontend/src/App.jsx` then specific component
3. API mismatch issue -> `frontend/src/api/client.js` + backend route

Usually ignore unless needed:
- `backend/node_modules/`
- `frontend/node_modules/`
- `frontend/dist/`
- `backend/uploads/`
- `chroma-data/`

## Commands

Backend:
- `cd backend`
- `npm run dev`
- `npm test`
- `npm run reset:db` (clear and recreate Chroma collection)

Frontend:
- `cd frontend`
- `npm run dev`
