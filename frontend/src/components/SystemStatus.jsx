export default function SystemStatus({ health, error }) {
  const backendConnected = Boolean(health);
  const llmReady = Boolean(health?.llm?.ready);
  const vectorStoreMode = health?.vectorStore?.activeMode || "unknown";

  return (
    <section className="card">
      <h3>Status</h3>
      <div className="status-grid">
        <div className="status-row">
          <span className="status-label">Backend</span>
          <span
            className={`status-pill ${backendConnected ? "success" : "neutral"}`}
          >
            {backendConnected ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">Service</span>
          <span className="status-text">
            {health?.service || "transcript-summarizer-backend"}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">LLM</span>
          <span className={`status-pill ${llmReady ? "success" : "warning"}`}>
            {llmReady ? "Ready" : "Missing key"}
          </span>
        </div>
        <div className="status-row">
          <span className="status-label">Provider</span>
          <span className="status-text">{health?.llm?.provider || "groq"}</span>
        </div>
        <div className="status-row">
          <span className="status-label">Vector store</span>
          <span className="status-text">{vectorStoreMode}</span>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
