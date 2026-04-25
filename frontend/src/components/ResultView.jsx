import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const COLLAPSED_CHARS = 4000;

function describeFallbackReason(reason) {
  if (reason === "no_relevant_context") {
    return "The backend could not find enough transcript context for this request.";
  }

  if (reason === "llm_unavailable") {
    return "The LLM is not configured, so generation could not run.";
  }

  if (reason === "llm_or_retrieval_failure") {
    return "Generation failed after context was loaded. The backend returned a fallback response.";
  }

  if (reason === "missing_transcript") {
    return "No transcript is currently active for this request.";
  }

  return "This response was produced from a degraded backend path.";
}

function normalizeDiagramSource(value) {
  return String(value || "")
    .replace(/^```(?:mermaid)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

function normalizeAnswerText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/([^\n])\s+(?=\*\s+\[chunk_\d+\])/g, "$1\n")
    .replace(/([^\n])\s+(?=(?:[-*+]\s))/g, "$1\n")
    .replace(/([^\n])\s+(?=\d+\.\s)/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDiagramNode(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^([A-Za-z0-9_./-]+)\s*(?:\[(.*)\]|\(\((.*)\)\)|\((.*)\)|\{(.*)\})?$/);

  if (!match) {
    return {
      id: text || "node",
      label: text || "Node",
      shape: "rect",
    };
  }

  const [, id, square, dblParen, paren, brace] = match;
  const label = square || dblParen || paren || brace || id;
  let shape = "rect";
  if (dblParen) shape = "pill";
  if (paren) shape = "rounded";
  if (brace) shape = "diamond";

  return {
    id,
    label: label.replace(/\s+/g, " ").trim(),
    shape,
  };
}

function parseDiagramEdge(line) {
  const patterns = [
    /^(.*?)\s*-->\s*(?:\|(.+?)\|\s*)?(.*?)$/,
    /^(.*?)\s*-.->\s*(?:\|(.+?)\|\s*)?(.*?)$/,
    /^(.*?)\s*==>\s*(?:\|(.+?)\|\s*)?(.*?)$/,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    return {
      fromRaw: match[1].trim(),
      label: (match[2] || "").trim(),
      toRaw: match[3].trim(),
    };
  }

  return null;
}

function parseMermaidFlowchart(source) {
  const cleaned = normalizeDiagramSource(source);
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));

  let direction = "TD";
  if (/^graph\s+(TD|TB|LR|RL|BT)\b/i.test(lines[0] || "")) {
    direction = (lines.shift().match(/^graph\s+(TD|TB|LR|RL|BT)\b/i)?.[1] || "TD").toUpperCase();
  }

  const nodes = new Map();
  const edges = [];
  const orderedNodeIds = [];

  function rememberNode(raw, preferredIndex) {
    const node = parseDiagramNode(raw);
    if (!nodes.has(node.id)) {
      nodes.set(node.id, {
        ...node,
        order: preferredIndex,
      });
      orderedNodeIds.push(node.id);
    }
    return nodes.get(node.id);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const edge = parseDiagramEdge(line);
    if (!edge) {
      const node = rememberNode(line, index);
      if (node && !orderedNodeIds.includes(node.id)) {
        orderedNodeIds.push(node.id);
      }
      continue;
    }

    const from = rememberNode(edge.fromRaw, index * 2);
    const to = rememberNode(edge.toRaw, index * 2 + 1);
    edges.push({
      from: from.id,
      to: to.id,
      label: edge.label,
    });
  }

  const orderedNodes = orderedNodeIds
    .map((id) => nodes.get(id))
    .filter(Boolean)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));

  return {
    direction,
    nodes: orderedNodes,
    edges,
  };
}

function DiagramNode({ node }) {
  return (
    <div className={`diagram-node shape-${node.shape || "rect"}`}>
      <div className="diagram-node-label">{node.label}</div>
    </div>
  );
}

function RenderedDiagram({ diagram }) {
  const model = useMemo(() => parseMermaidFlowchart(diagram), [diagram]);

  if (!model.nodes.length && !model.edges.length) {
    return (
      <div className="diagram-fallback">
        <pre>
          <code>{normalizeDiagramSource(diagram)}</code>
        </pre>
      </div>
    );
  }

  const isHorizontal = model.direction === "LR" || model.direction === "RL";
  const orderedNodes = isHorizontal && model.direction === "RL"
    ? [...model.nodes].reverse()
    : model.nodes;
  const stepEdges = orderedNodes
    .map((node, index) => {
      const nextNode = orderedNodes[index + 1];
      if (!nextNode) {
        return null;
      }

      return (
        model.edges.find((edge) => edge.from === node.id && edge.to === nextNode.id) ||
        model.edges.find((edge) => edge.from === node.id) ||
        null
      );
    })
    .filter(Boolean);

  return (
    <div className="diagram-frame">
      <div className="diagram-frame-header">
        <span className="diagram-frame-title">Flowchart</span>
        <span className="diagram-frame-direction">{model.direction}</span>
      </div>
      <div className={`diagram-flowchart ${isHorizontal ? "horizontal" : "vertical"}`}>
        {orderedNodes.map((node, index) => {
          const connector = stepEdges[index];
          const isLast = index === orderedNodes.length - 1;

          return (
            <div className={`diagram-step ${isHorizontal ? "horizontal" : "vertical"}`} key={node.id}>
              <div className="diagram-step-index">{index + 1}</div>
              <DiagramNode node={node} />
              {!isLast ? (
                <div className={`diagram-connector ${isHorizontal ? "horizontal" : "vertical"}`}>
                  <span className="diagram-connector-line" />
                  <span className="diagram-arrow-head" />
                  {connector?.label ? (
                    <span className="diagram-edge-label">{connector.label}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderInlineContent(text, keyPrefix) {
  const value = String(text || "");
  const parts = [];
  const pattern =
    /(`[^`]+`)|(\*\*([^*]+)\*\*)|(\*([^*\n]+)\*)|(_([^_\n]+)_)|(\[(chunk_\d+)\])|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of value.matchAll(pattern)) {
    const [fullMatch, inlineCode, boldMatch, boldText, italicStarMatch, italicStarText, italicUnderscoreMatch, italicUnderscoreText, chunkMatch, chunkText, linkMatch, linkText, linkUrl] = match;
    const startIndex = match.index ?? 0;

    if (startIndex > lastIndex) {
      parts.push(value.slice(lastIndex, startIndex));
    }

    const key = `${keyPrefix}-inline-${matchIndex}`;
    if (inlineCode) {
      parts.push(<code key={key}>{inlineCode.slice(1, -1)}</code>);
    } else if (boldMatch) {
      parts.push(<strong key={key}>{boldText}</strong>);
    } else if (italicStarMatch || italicUnderscoreMatch) {
      parts.push(<em key={key}>{italicStarText || italicUnderscoreText}</em>);
    } else if (chunkMatch) {
      parts.push(<code key={key}>{chunkText}</code>);
    } else if (linkMatch) {
      parts.push(
        <a key={key} href={linkUrl} target="_blank" rel="noreferrer">
          {linkText}
        </a>
      );
    } else {
      parts.push(fullMatch);
    }

    lastIndex = startIndex + fullMatch.length;
    matchIndex += 1;
  }

  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }

  return parts.length ? parts : value;
}

function parseAnswerBlocks(text) {
  const lines = normalizeAnswerText(text).split("\n");
  const blocks = [];
  let paragraphLines = [];
  let listItems = [];
  let listType = "";
  let codeLines = [];
  let codeLang = "";
  let inCode = false;
  let quoteLines = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    blocks.push({ type: "paragraph", content: paragraphLines.join(" ").trim() });
    paragraphLines = [];
  }

  function flushList() {
    if (!listItems.length) return;
    blocks.push({ type: "list", ordered: listType === "ordered", items: [...listItems] });
    listItems = [];
    listType = "";
  }

  function flushQuote() {
    if (!quoteLines.length) return;
    blocks.push({ type: "quote", content: quoteLines.join("\n").trim() });
    quoteLines = [];
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
        flushQuote();
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
      flushQuote();
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      blocks.push({
        type: "heading",
        level: headingMatch?.[1]?.length || 2,
        content: headingMatch?.[2]?.trim() || trimmed,
      });
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({ type: "hr" });
      continue;
    }

    if (/^\*\*[^*].*[^*]\*\*$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({
        type: "heading",
        level: 3,
        content: trimmed.replace(/^\*\*|\*\*$/g, "").trim(),
      });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      quoteLines.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "unordered") {
        flushList();
      }
      listType = "unordered";
      listItems.push(trimmed.replace(/^[-*+]\s+/, "").trim());
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      if (listType && listType !== "ordered") {
        flushList();
      }
      listType = "ordered";
      listItems.push(trimmed.replace(/^\d+\.\s+/, "").trim());
      continue;
    }

    flushList();
    flushQuote();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushQuote();
  flushCode();
  return blocks;
}

function AnswerBody({ text, prefix, suppressDiagrams }) {
  const blocks = useMemo(() => parseAnswerBlocks(text), [text]);

  return blocks
    .map((block, index) => {
      if (block.type === "heading") {
        const HeadingTag = `h${Math.min(Math.max(block.level || 2, 1), 4)}`;
        return (
          <HeadingTag key={`${prefix}-h-${index}`} className="section-title markdown-heading">
            {renderInlineContent(block.content, `${prefix}-h-${index}`)}
          </HeadingTag>
        );
      }

      if (block.type === "list") {
        const ListTag = block.ordered ? "ol" : "ul";
        return (
          <ListTag key={`${prefix}-l-${index}`} className="markdown-list">
            {block.items.map((item, itemIndex) => (
              <li key={`${prefix}-li-${index}-${itemIndex}`}>
                {renderInlineContent(item, `${prefix}-li-${index}-${itemIndex}`)}
              </li>
            ))}
          </ListTag>
        );
      }

      if (block.type === "quote") {
        return (
          <blockquote key={`${prefix}-q-${index}`} className="markdown-quote">
            {block.content.split("\n").map((line, lineIndex) => (
              <p key={`${prefix}-q-${index}-${lineIndex}`}>
                {renderInlineContent(line, `${prefix}-q-${index}-${lineIndex}`)}
              </p>
            ))}
          </blockquote>
        );
      }

      if (block.type === "hr") {
        return <hr key={`${prefix}-hr-${index}`} className="markdown-rule" />;
      }

      if (block.type === "diagram") {
        if (suppressDiagrams) {
          return null;
        }
        return (
          <div key={`${prefix}-d-${index}`} className="diagram-block">
            <div className="diagram-label">Diagram</div>
            <RenderedDiagram diagram={block.content} />
            <details className="diagram-source">
              <summary>View raw diagram</summary>
              <pre>
                <code>{normalizeDiagramSource(block.content)}</code>
              </pre>
            </details>
          </div>
        );
      }

      if (block.type === "code") {
        return (
          <pre key={`${prefix}-c-${index}`} className="code-block">
            <code>{block.content}</code>
          </pre>
        );
      }

      return (
        <p key={`${prefix}-p-${index}`}>
          {renderInlineContent(block.content || "\u00A0", `${prefix}-p-${index}`)}
        </p>
      );
    })
    .filter(Boolean);
}

function AssistantMessage({ message, activeTranscript }) {
  const answer = message.answer || "No response generated.";
  const sources = Array.isArray(message.sources) ? message.sources : [];
  const transcriptLabel =
    activeTranscript?.transcriptName || message.diagnostics?.transcriptName || "Current transcript";
  const fallbackReason = message.fallbackReason || "";
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canPortal, setCanPortal] = useState(false);
  const isLong = answer.length > COLLAPSED_CHARS;
  const visibleAnswer =
    expanded || !isLong ? answer : `${answer.slice(0, COLLAPSED_CHARS)}...`;

  useEffect(() => {
    setCanPortal(true);
  }, []);

  useEffect(() => {
    if (!fullscreen) return undefined;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setFullscreen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [fullscreen]);

  async function copyAnswer() {
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className="message-row assistant-row" data-assistant-id={message.id}>
      <div className="avatar">AI</div>
      <div className="message-bubble assistant-bubble">
        <div className="chatgpt-header">
          <div className="chatgpt-header-main">
            <p className="message-role">Assistant</p>
            <p className="message-subtitle">{transcriptLabel}</p>
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
          {fallbackReason ? (
            <div className="assistant-warning">
              <p className="assistant-warning-title">Response warning</p>
              <p>{describeFallbackReason(fallbackReason)}</p>
            </div>
          ) : null}
          {message.error ? (
            <div className="assistant-warning subtle">
              <p className="assistant-warning-title">Backend detail</p>
              <p>{message.error}</p>
            </div>
          ) : null}
          <AnswerBody
            text={visibleAnswer}
            prefix={message.id}
            suppressDiagrams={Boolean(message.diagram)}
          />
        </div>

        {message.diagram ? (
          <div className="diagram-block external-diagram">
            <div className="diagram-label">Diagram</div>
            <RenderedDiagram diagram={message.diagram} />
            <details className="diagram-source">
              <summary>View raw diagram</summary>
              <pre>
                <code>{normalizeDiagramSource(message.diagram)}</code>
              </pre>
            </details>
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
          <span className="meta-pill">{message.mode || "response"}</span>
          <span className="meta-pill">confidence {message.confidence || "low"}</span>
          {message.diagnostics?.selectionStrategy ? (
            <span className="meta-pill">{message.diagnostics.selectionStrategy}</span>
          ) : null}
          {message.diagnostics?.chunkCount ? (
            <span className="meta-pill">{message.diagnostics.chunkCount} chunks</span>
          ) : null}
          {sources.length ? (
            <span className="meta-pill">{sources.length} sources</span>
          ) : null}
        </div>

        {fullscreen && canPortal
          ? createPortal(
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
                        <RenderedDiagram diagram={message.diagram} />
                        <details className="diagram-source">
                          <summary>View raw diagram</summary>
                          <pre>
                            <code>{normalizeDiagramSource(message.diagram)}</code>
                          </pre>
                        </details>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}
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
  const threadRef = useRef(null);
  const lastAssistantIdRef = useRef("");

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;

    if (loading) {
      thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
      return;
    }

    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");

    if (!lastAssistant) return;
    if (lastAssistant.id === lastAssistantIdRef.current) return;

    lastAssistantIdRef.current = lastAssistant.id;
    const target = thread.querySelector(`[data-assistant-id="${lastAssistant.id}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
    }
  }, [messages, loading]);

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
    <section className="chat-thread" ref={threadRef}>
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
