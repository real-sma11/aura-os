import { FileCode, FileText, FileX } from "lucide-react";
import type { ReactNode } from "react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { langFromPath } from "../../../ide/lang";
import { useHighlightedHtml } from "../../../shared/hooks/use-highlighted-html";
import { TOOL_LABELS, TOOL_PHASE_LABELS } from "../../../constants/tools";
import { decodeCapturedOutput } from "../../../shared/utils/format";
import { Block } from "../Block";
import blockStyles from "../Block.module.css";
import styles from "./renderers.module.css";

function DiffView({
  oldText,
  newText,
  language,
  streaming,
}: {
  oldText: string;
  newText: string;
  language?: string;
  streaming?: boolean;
}) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldHighlighted = useHighlightedHtml(oldText, language);
  const newHighlighted = useHighlightedHtml(newText, language);
  const oldHtmlLines = oldHighlighted.split("\n");
  const newHtmlLines = newHighlighted.split("\n");
  const hasAny = oldText.length > 0 || newText.length > 0;

  return (
    <div className={styles.diffArea}>
      {oldLines.map((_line, i) => (
        <div key={`old-${i}`} className={`${styles.diffLine} ${styles.diffRemoved}`}>
          <span className={styles.lineNum}>{i + 1}</span>
          <span className={styles.diffPrefix}>-</span>
          <span
            className={styles.diffContent}
            dangerouslySetInnerHTML={{ __html: oldHtmlLines[i] ?? "" }}
          />
        </div>
      ))}
      {newLines.map((_line, i) => {
        const isLast = i === newLines.length - 1;
        return (
          <div key={`new-${i}`} className={`${styles.diffLine} ${styles.diffAdded}`}>
            <span className={styles.lineNum}>{i + 1}</span>
            <span className={styles.diffPrefix}>+</span>
            <span
              className={styles.diffContent}
              dangerouslySetInnerHTML={{ __html: newHtmlLines[i] ?? "" }}
            />
            {streaming && isLast && hasAny && (
              <span className={blockStyles.streamCaret} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CodeView({
  content,
  language,
  streaming,
}: {
  content: string;
  language?: string;
  streaming?: boolean;
}) {
  const highlightedHtml = useHighlightedHtml(content, language);
  const htmlLines = highlightedHtml.split("\n");
  const displayLines = content.split("\n");

  return (
    <div className={styles.codeArea}>
      {displayLines.map((_line, i) => {
        const isLast = i === displayLines.length - 1;
        return (
          <div key={i} className={styles.codeLine}>
            <span className={styles.lineNum}>{i + 1}</span>
            <span
              className={styles.codeContent}
              dangerouslySetInnerHTML={{ __html: htmlLines[i] ?? "" }}
            />
            {streaming && isLast && (
              <span className={blockStyles.streamCaret} aria-hidden="true" />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface FileBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function FileBlock({ entry, defaultExpanded }: FileBlockProps) {
  const path = (entry.input.path as string) || "";
  const lang = langFromPath(path);
  const hasPath = path.length > 0;

  const isEdit = entry.name === "edit_file";
  const isWrite = entry.name === "write_file";
  const isRead = entry.name === "read_file";
  const isDelete = entry.name === "delete_file";

  const toolLabel = TOOL_LABELS[entry.name] ?? "File";
  const Icon = isDelete ? FileX : isEdit || isWrite ? FileCode : FileText;

  const oldText = (entry.input.old_text as string) || "";
  const newText = (entry.input.new_text as string) || "";
  const writeContent = (entry.input.content as string) || "";

  // Retry state arrives as first-class fields on `ToolCallEntry` from the
  // `ToolCallRetrying` / `ToolCallFailed` reducers (see
  // `hooks/stream/handlers.ts`). While `retrying` is true the row title
  // reads "<tool> retrying (n/max)…"; once a fresh `ToolCallSnapshot`
  // arrives the reducer clears `retrying` but preserves
  // `retryAttempt`/`retryMax` so a later failure can still report
  // "retried N/max".
  const retryAttempt =
    typeof entry.retryAttempt === "number" && entry.retryAttempt > 0
      ? entry.retryAttempt
      : null;
  const retryMax =
    typeof entry.retryMax === "number" && entry.retryMax > 0
      ? entry.retryMax
      : null;
  const isRetrying = entry.retrying === true;
  const retryExhausted = entry.retryExhausted === true;

  // Coarse classifier: if the failure reason in `entry.result` smells like a
  // transient upstream hiccup, swap the bare tool label for an explanation
  // so the card header carries the actual cause.
  const resultStr =
    entry.isError && typeof entry.result === "string" ? entry.result : "";
  const hasTransientUpstreamHint =
    /stream terminated|internal server error|\b5\d{2}\b|upstream/i.test(resultStr);

  // Title is always the tool name ("Read file", "Edit file", ...). Pending
  // and failure states decorate it inline; the file path moves into the
  // secondary `summary` slot so every block reads "<tool>  <context>".
  const title = (() => {
    if (entry.pending) {
      const base = TOOL_PHASE_LABELS[entry.name] ?? toolLabel;
      if (isRetrying && retryAttempt != null) {
        const max = retryMax ?? "?";
        return `${base} retrying (${retryAttempt}/${max})...`;
      }
      if (retryAttempt != null) {
        const max = retryMax ?? "?";
        return `${base} (retry ${retryAttempt}/${max})`;
      }
      return base;
    }
    if (entry.isError) {
      if (retryExhausted && retryAttempt != null) {
        const max = retryMax ?? "?";
        return `${toolLabel} failed - retried ${retryAttempt}/${max}`;
      }
      if (hasTransientUpstreamHint) {
        return `${toolLabel} failed - transient upstream 5xx`;
      }
      return `${toolLabel} failed`;
    }
    return toolLabel;
  })();

  const fileName = hasPath ? (path.split(/[/\\]/).pop() || path) : "";

  const hasEditContent = oldText.length > 0 || newText.length > 0;
  const hasWriteContent = writeContent.length > 0;
  const hasReadContent = !!entry.result;

  let body: ReactNode = null;
  let copyPayload = "";
  if (isDelete) {
    body = null;
  } else if (isEdit && hasEditContent) {
    body = (
      <DiffView
        oldText={oldText}
        newText={newText}
        language={lang}
        streaming={entry.pending}
      />
    );
    copyPayload = newText;
  } else if (isWrite && hasWriteContent) {
    body = <CodeView content={writeContent} language={lang} streaming={entry.pending} />;
    copyPayload = writeContent;
  } else if (isRead && hasReadContent) {
    // `read_file` results arrive as a JSON envelope
    // `{ ok, stdout: <base64 file contents>, stderr, metadata }`. Decode it
    // so the viewer shows the actual file content (syntax-highlighted by
    // path) rather than a one-line JSON blob with raw base64 inside.
    const decoded = decodeCapturedOutput(entry.result as string);
    if (decoded.ok === false) {
      body = (
        <div className={styles.inlineError}>
          {decoded.stderr || decoded.stdout || "Read failed."}
        </div>
      );
    } else {
      body = <CodeView content={decoded.stdout} language={lang} />;
      copyPayload = decoded.stdout;
    }
  }

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";
  const forcePreview =
    entry.pending && ((isWrite && hasWriteContent) || (isEdit && hasEditContent));

  // Fall back to the visible header text so the icon-only copy slot is
  // always meaningful, even on pending / empty / failed states where
  // there's no file body to grab yet.
  const copyText = copyPayload || fileName || title;

  return (
    <Block
      icon={<Icon size={12} />}
      title={title}
      summary={fileName || undefined}
      status={status}
      defaultExpanded={defaultExpanded || forcePreview}
      forceExpanded={forcePreview}
      autoScroll={entry.pending}
      flushBody
      copy={{
        getText: () => copyText,
        ariaLabel: `Copy ${fileName || toolLabel}`,
      }}
    >
      {body}
      {entry.isError && entry.result ? (
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : null}
    </Block>
  );
}
