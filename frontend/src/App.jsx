import { useEffect, useState } from "react";
import "./style.css";
import { askQuestion, checkHealth, uploadDocument } from "./api/client";
import UploadPanel from "./components/UploadPanel";
import AskPanel from "./components/AskPanel";
import ResultView from "./components/ResultView";
import SystemStatus from "./components/SystemStatus";

const SESSION_STORAGE_KEY = "transcript-rag-session-v1";

function createMessage(message) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...message,
  };
}

function loadSession() {
  if (typeof window === "undefined") {
    return { messages: [], activeTranscript: null };
  }

  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return { messages: [], activeTranscript: null };
    }

    const parsed = JSON.parse(raw);
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      activeTranscript:
        parsed.activeTranscript && typeof parsed.activeTranscript === "object"
          ? parsed.activeTranscript
          : null,
    };
  } catch {
    return { messages: [], activeTranscript: null };
  }
}

const initialSession = loadSession();

export default function App() {
  const [health, setHealth] = useState(null);
  const [messages, setMessages] = useState(initialSession.messages);
  const [activeTranscript, setActiveTranscript] = useState(initialSession.activeTranscript);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    checkHealth()
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ messages, activeTranscript })
    );
  }, [messages, activeTranscript]);

  async function handleUpload(payload) {
    setUploading(true);
    setError("");
    try {
      const data = await uploadDocument(payload);
      setActiveTranscript(data);
      setMessages([
        createMessage({
          role: "system",
          title: "Transcript Ready",
          answer: `Loaded ${data.transcriptName}. You can now generate a summary, notes, or ask questions about this transcript.`,
          diagnostics: data,
        }),
        createMessage({
          role: "assistant",
          mode: "summary",
          title: "Transcript Imported",
          answer: `## Ready\n\nYour transcript has been processed and indexed.\n\n## Details\n- File: ${data.transcriptName}\n- Chunks stored: ${data.chunksStored}\n- Extracted length: ${data.extractedLength} characters`,
          confidence: "high",
          sources: [data.docId],
          diagnostics: data,
        }),
      ]);
    } catch (err) {
      const serverError = err.response?.data?.error;
      const serverDetails = err.response?.data?.details;
      setError(serverDetails ? `${serverError}: ${serverDetails}` : serverError || err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleAsk(payload) {
    if (!activeTranscript?.docId) {
      setError("Upload a transcript first.");
      return;
    }

    const userText =
      payload.mode === "question"
        ? payload.query
        : payload.query
          ? `${payload.mode}: ${payload.query}`
          : `${payload.mode}: use the full transcript`;

    setMessages((current) => [
      ...current,
      createMessage({
        role: "user",
        answer: userText,
        mode: payload.mode,
      }),
    ]);
    setAsking(true);
    setError("");
    try {
      const data = await askQuestion({ ...payload, docId: activeTranscript.docId });
      setMessages((current) => [
        ...current,
        createMessage({
          role: "assistant",
          ...data,
        }),
      ]);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setAsking(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-panel brand-panel">
          <p className="eyebrow">RAG Workspace</p>
          <h1>Transcript Summarizer</h1>
          <p className="muted-text">
            Upload one transcript, then generate polished summaries, notes, and grounded answers.
          </p>
        </div>
        <SystemStatus health={health} error={error} />
        <UploadPanel
          onUpload={handleUpload}
          loading={uploading}
          activeTranscript={activeTranscript}
        />
        <AskPanel
          onAsk={handleAsk}
          loading={asking}
          disabled={!activeTranscript || uploading}
        />
      </aside>

      <section className="chat-stage">
        <div className="chat-stage-header">
          <div>
            <p className="eyebrow">Conversation</p>
            <h2>Transcript Chat</h2>
          </div>
          {activeTranscript ? (
            <div className="active-pill">{activeTranscript.transcriptName}</div>
          ) : (
            <div className="active-pill inactive">No transcript loaded</div>
          )}
        </div>

        <ResultView
          messages={messages}
          loading={asking}
          hasTranscript={Boolean(activeTranscript)}
          activeTranscript={activeTranscript}
        />
      </section>
    </main>
  );
}
