import { useCallback, useRef } from "react";
import { FileText } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { useHighlightedHtml } from "../../../shared/hooks/use-highlighted-html";
import { useMarkdownCopy } from "../../../shared/hooks/use-markdown-copy";
import { specFilename } from "../../../shared/utils/format";
import { CopyButton } from "../../CopyButton";
import { Block } from "../Block";
import blockStyles from "../Block.module.css";
import styles from "./renderers.module.css";

interface SpecBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function SpecBlock({ entry, defaultExpanded }: SpecBlockProps) {
  const title = (entry.input.title as string) || "";
  const filename = specFilename(title);
  const toolContent = (entry.input.markdown_contents as string) || "";
  const draftPreview = (entry.input.draft_preview as string) || "";
  const content = toolContent || draftPreview;
  const highlightedHtml = useHighlightedHtml(content, "markdown");

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";
  const showCopyToolbar = content.length > 0 && !entry.pending;

  // Select+copy of the whole spec body should yield the *original*
  // markdown source rather than the highlighted-HTML rendering --
  // otherwise pasting into Obsidian gets a soup of `<span class="hljs-...">`
  // text with broken indentation. Partial selections fall through to
  // the browser default.
  const codeAreaRef = useRef<HTMLDivElement>(null);
  const getMarkdown = useCallback(() => content, [content]);
  useMarkdownCopy(codeAreaRef, getMarkdown);

  return (
    <Block
      icon={<FileText size={12} />}
      title={filename}
      badge={entry.name === "update_spec" ? "Update" : "Spec"}
      status={status}
      defaultExpanded={defaultExpanded || entry.pending}
      forceExpanded={entry.pending}
      autoScroll={entry.pending}
      flushBody
      trailing={
        showCopyToolbar ? (
          <CopyButton getMarkdown={() => content} ariaLabel={`Copy ${filename}`} />
        ) : undefined
      }
    >
      <div ref={codeAreaRef} className={styles.codeArea}>
        <pre>
          <code
            className="hljs language-markdown"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
          {entry.pending && (
            <span className={blockStyles.streamCaret} aria-hidden="true" />
          )}
        </pre>
      </div>
      {entry.isError && entry.result ? (
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : null}
    </Block>
  );
}
