import { useState } from "react";

export default function UploadPanel({ onUpload, loading, activeTranscript }) {
  const [file, setFile] = useState(null);
  const [transcriptText, setTranscriptText] = useState("");
  const [mode, setMode] = useState("file");
  const safeMode = mode ?? "file";
  const safeTranscriptText = transcriptText ?? "";

  function submit(event) {
    event.preventDefault();
    if (safeMode === "file" && file) {
      onUpload({ file });
      return;
    }

    if (safeMode === "paste" && safeTranscriptText.trim()) {
      onUpload({ transcriptText: safeTranscriptText.trim(), transcriptName: "Pasted transcript" });
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h3>Upload Transcript</h3>
      {activeTranscript ? (
        <p className="muted-text">
          Active transcript: <strong>{activeTranscript.transcriptName}</strong>
        </p>
      ) : (
        <p className="muted-text">Upload one transcript first to enable summary, notes, and Q&A.</p>
      )}
      <div className="ingest-toggle">
        <button
          type="button"
          className={safeMode === "file" ? "ghost-btn active-toggle" : "ghost-btn"}
          onClick={() => setMode("file")}
        >
          File
        </button>
        <button
          type="button"
          className={safeMode === "paste" ? "ghost-btn active-toggle" : "ghost-btn"}
          onClick={() => setMode("paste")}
        >
          Paste
        </button>
      </div>
      {safeMode === "file" ? (
        <div className="file-row">
          <input
            type="file"
            accept=".txt,.md,.json,application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <button disabled={loading || !file} type="submit">
            {loading ? "Uploading..." : "Upload"}
          </button>
        </div>
      ) : (
        <div className="paste-row">
          <input
            type="text"
            value={safeTranscriptText}
            placeholder="Paste transcript here and press Upload"
            onChange={(event) => setTranscriptText(event.target.value)}
          />
          <button disabled={loading || !safeTranscriptText.trim()} type="submit">
            {loading ? "Uploading..." : "Upload"}
          </button>
        </div>
      )}
    </form>
  );
}
