import { useMemo, useState } from "react";

const COLLAPSED_CHARS = 4000;

function parseAnswerBlocks(text) {
  const lines = String(text || "").split("\n");
  const blocks = [];
  let paragraphLines = [];
  let listItems = [];
  let codeLines = [];
  let codeLang = "";
  let inCode = false;

  function flushParagraph() {
    if (!paragraphLines.length) return;
    blocks.push({ type: "paragraph", content: paragraphLines.join(" ").trim() });
    paragraphLines = [];
  }

  function flushList() {
    if (!listItems.length) return;
    blocks.push({ type: "list", items: [...listItems] });
    listItems = [];
  }

  function flushCode() {
    if (!codeLines.length) return;
    blocks.push({
      type: codeLang === "mermaid" ? "diagram" : "code",
      language: codeLang,
      content: codeLines.join("\n"),
    });
    codeLines = [];
    codeLang = "";
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().startsWith("```")) {
      const fence = line.trim().slice(3).trim().toLowerCase();
      if (!inCode) {
        flushParagraph();
        flushList();
        inCode = true;
        codeLang = fence;
      } else {
        flushCode();
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^#{2,3}\s+/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", content: trimmed.replace(/^#{2,3}\s+/, "").trim() });
      continue;
    }

    if (trimmed.startsWith("- ") || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      listItems.push(trimmed.replace(/^(-|\d+\.)\s+/, "").trim());
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();
  return blocks;
}

function groupSections(blocks) {
  const sections = [];
  let current = { title: "", blocks: [] };

  for (const block of blocks) {
    if (block.type === "heading") {
      if (current.title || current.blocks.length) {
        sections.push(current);
      }
      current = { title: block.content, blocks: [] };
      continue;
    }

    current.blocks.push(block);
  }

  if (current.title || current.blocks.length) {
    sections.push(current);
  }

  return sections.filter((section) => section.title || section.blocks.length);
}

function AnswerBody({ text, prefix, suppressDiagrams }) {
  const blocks = useMemo(() => parseAnswerBlocks(text), [text]);
  const sections = useMemo(() => groupSections(blocks), [blocks]);

  const renderedSections = sections
    .map((section, sectionIndex) => {
      const renderedBlocks = section.blocks
        .map((block, index) => {
          if (block.type === "list") {
            return (
              <ul key={`${prefix}-l-${sectionIndex}-${index}`}>
                {block.items.map((item, itemIndex) => (
                  <li key={`${prefix}-li-${sectionIndex}-${index}-${itemIndex}`}>{item}</li>
                ))}
              </ul>
            );
          }

          if (block.type === "diagram") {
            if (suppressDiagrams) {
              return null;
            }
            return (
              <div key={`${prefix}-d-${sectionIndex}-${index}`} className="diagram-block">
                <div className="diagram-label">Diagram</div>
                <pre>
                  <code>{block.content}</code>
                </pre>
              </div>
            );
          }

          if (block.type === "code") {
            return (
              <pre key={`${prefix}-c-${sectionIndex}-${index}`} className="code-block">
                <code>{block.content}</code>
              </pre>
            );
          }

          return (
            <p key={`${prefix}-p-${sectionIndex}-${index}`}>{block.content || "\u00A0"}</p>
          );
        })
        .filter(Boolean);

      if (!renderedBlocks.length && !section.title) {
        return null;
      }

      if (!renderedBlocks.length && suppressDiagrams) {
        return null;
      }

      return (
        <section key={`${prefix}-section-${sectionIndex}`} className="answer-section">
          {section.title ? <h4 className="section-title">{section.title}</h4> : null}
          <div className="section-content">{renderedBlocks}</div>
        </section>
      );
    })
    .filter(Boolean);

  return renderedSections;
}

function AssistantMessage({ message, activeTranscript }) {
  const answer = message.answer || "No response generated.";
  const sources = Array.isArray(message.sources) ? message.sources : [];
  const sourceCount = sources.length;
  const transcriptLabel = activeTranscript?.transcriptName || message.diagnostics?.transcriptName || "Current transcript";
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const isLong = answer.length > COLLAPSED_CHARS;
  const visibleAnswer =
    expanded || !isLong ? answer : `${answer.slice(0, COLLAPSED_CHARS)}...`;

  async function copyAnswer() {
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className="message-row assistant-row">
      <div className="avatar">AI</div>
      <div className="message-bubble assistant-bubble">
        <div className="executive-strip">
          <div className="executive-strip-main">
            <div className="executive-title">{message.title || "Assistant Response"}</div>
            <div className="executive-subtitle">{transcriptLabel}</div>
          </div>
          <div className="executive-strip-meta">
            <span className="meta-pill">mode: {message.mode || "response"}</span>
            <span className="meta-pill">confidence: {message.confidence || "low"}</span>
            <span className="meta-pill">sources: {sourceCount}</span>
            {message.diagnostics?.chunkCount ? (
              <span className="meta-pill">chunks: {message.diagnostics.chunkCount}</span>
            ) : null}
          </div>
        </div>

        <div className="message-toolbar">
          <div>
            <p className="message-role">Assistant</p>
            <p className="message-subtitle">{message.mode || "Structured response"}</p>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="ghost-btn" onClick={copyAnswer}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="ghost-btn" onClick={() => setFullscreen(true)}>
              Expand
            </button>
          </div>
        </div>

        <div className="assistant-content">
          <AnswerBody
            text={visibleAnswer}
            prefix={message.id}
            suppressDiagrams={Boolean(message.diagram)}
          />
        </div>

        {message.diagram ? (
          <div className="diagram-block external-diagram">
            <div className="diagram-label">Diagram</div>
            <pre>
              <code>{message.diagram}</code>
            </pre>
          </div>
        ) : null}

        {isLong ? (
          <button
            type="button"
            className="inline-btn"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : "Continue reading"}
          </button>
        ) : null}

        <div className="message-meta">
          <span className="meta-pill">confidence: {message.confidence || "low"}</span>
          {message.diagnostics?.chunkCount ? (
            <span className="meta-pill">chunks: {message.diagnostics.chunkCount}</span>
          ) : null}
          {sources.length ? (
            <span className="meta-pill">sources: {sources.slice(0, 4).join(", ")}</span>
          ) : null}
        </div>

        {fullscreen ? (
          <div className="answer-modal-backdrop" onClick={() => setFullscreen(false)}>
            <div className="answer-modal" onClick={(event) => event.stopPropagation()}>
              <div className="answer-modal-header">
                <h3>Full Response</h3>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setFullscreen(false)}
                >
                  Close
                </button>
              </div>
              <div className="answer-modal-content">
                <AnswerBody
                  text={answer}
                  prefix={`${message.id}-modal`}
                  suppressDiagrams={Boolean(message.diagram)}
                />
                {message.diagram ? (
                  <div className="diagram-block external-diagram">
                    <div className="diagram-label">Diagram</div>
                    <pre>
                      <code>{message.diagram}</code>
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function UserMessage({ message }) {
  return (
    <article className="message-row user-row">
      <div className="message-bubble user-bubble">
        <p className="message-role">You</p>
        <p>{message.answer}</p>
      </div>
    </article>
  );
}

function SystemMessage({ message }) {
  return (
    <article className="message-row system-row">
      <div className="message-bubble system-bubble">
        <p className="message-role">{message.title || "System"}</p>
        <p>{message.answer}</p>
      </div>
    </article>
  );
}

export default function ResultView({ messages, loading, hasTranscript, activeTranscript }) {
  if (!messages.length && !loading) {
    return (
      <section className="chat-empty">
        <h3>{hasTranscript ? "Ready for transcript analysis" : "Upload a transcript to begin"}</h3>
        <p>
          {hasTranscript
            ? "Ask for a summary, structured notes, or a grounded answer."
            : "This workspace will render long-form answers in a chat-style layout after the transcript is indexed."}
        </p>
      </section>
    );
  }

  return (
    <section className="chat-thread">
      {messages.map((message) => {
        if (message.role === "user") {
          return <UserMessage key={message.id} message={message} />;
        }

        if (message.role === "system") {
          return <SystemMessage key={message.id} message={message} />;
        }

        return <AssistantMessage key={message.id} message={message} activeTranscript={activeTranscript} />;
      })}

      {loading ? (
        <article className="message-row assistant-row">
          <div className="avatar">AI</div>
          <div className="message-bubble assistant-bubble loading-bubble">
            <p className="message-role">Assistant</p>
            <div className="typing-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        </article>
      ) : null}
    </section>
  );
}
