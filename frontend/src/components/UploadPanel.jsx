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
    <form onSubmit={submit} className="card upload-card">
      <p className="eyebrow">Transcript Input</p>
      <h3>Upload Transcript</h3>
      {activeTranscript ? (
        <p className="upload-active">
          Active transcript: <strong>{activeTranscript.transcriptName}</strong>
        </p>
      ) : (
        <p className="upload-description">
          Add one transcript to unlock summaries, structured notes, and grounded Q&A.
        </p>
      )}

      <div className="ingest-toggle upload-toggle">
        <button
          type="button"
          className={safeMode === "file" ? "ghost-btn upload-toggle-btn active-toggle" : "ghost-btn upload-toggle-btn"}
          onClick={() => setMode("file")}
        >
          Upload file
        </button>
        <button
          type="button"
          className={safeMode === "paste" ? "ghost-btn upload-toggle-btn active-toggle" : "ghost-btn upload-toggle-btn"}
          onClick={() => setMode("paste")}
        >
          Paste text
        </button>
      </div>

      {safeMode === "file" ? (
        <div className="upload-pane">
          <label className="upload-field-label" htmlFor="transcript-upload">
            Select transcript file
          </label>
          <div className="file-row upload-file-row">
            <input
              id="transcript-upload"
              type="file"
              accept=".txt,.md,.json,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </div>
          {file ? <p className="upload-file-meta">Selected: {file.name}</p> : null}
          <div className="upload-actions">
            <button disabled={loading || !file} type="submit">
              {loading ? "Uploading..." : "Upload transcript"}
            </button>
          </div>
        </div>
      ) : (
        <div className="upload-pane">
          <label className="upload-field-label" htmlFor="transcript-paste">
            Paste transcript
          </label>
          <textarea
            id="transcript-paste"
            value={safeTranscriptText}
            className="upload-textarea"
            placeholder="Paste transcript content here..."
            onChange={(event) => setTranscriptText(event.target.value)}
          />
          <div className="upload-actions">
            <button disabled={loading || !safeTranscriptText.trim()} type="submit">
              {loading ? "Uploading..." : "Upload transcript"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
