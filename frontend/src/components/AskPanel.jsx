import { useState } from "react";

export default function AskPanel({ onAsk, loading, disabled }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("summary");
  const safeMode = mode ?? "summary";
  const safeQuery = query ?? "";

  function submit(event) {
    event.preventDefault();
    if (safeMode === "question" && !safeQuery.trim()) {
      return;
    }

    onAsk({ mode: safeMode, query: safeQuery.trim() });
  }

  return (
    <form onSubmit={submit} className="card">
      <h3>Ask</h3>
      <label htmlFor="mode">Mode</label>
      <select
        id="mode"
        value={safeMode}
        disabled={disabled}
        onChange={(event) => setMode(event.target.value)}
        style={{ width: "100%", margin: "8px 0 12px" }}
      >
        <option value="summary">Summary</option>
        <option value="notes">Notes</option>
        <option value="question">Question</option>
      </select>
      <textarea
        value={safeQuery}
        rows={4}
        placeholder={
          safeMode === "question"
            ? "Ask a question from the transcript..."
            : "Optional focus, like decisions, blockers, or topics..."
        }
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
      />
      <button
        type="submit"
        disabled={disabled || loading || (safeMode === "question" && !safeQuery.trim())}
      >
        {loading ? "Generating..." : safeMode === "question" ? "Ask" : "Generate"}
      </button>
    </form>
  );
}
