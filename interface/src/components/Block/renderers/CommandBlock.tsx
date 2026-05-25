import { SquareTerminal } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { decodeCapturedOutput } from "../../../shared/utils/format";
import { TOOL_LABELS } from "../../../constants/tools";
import { Block } from "../Block";
import styles from "./renderers.module.css";

interface CommandBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

/**
 * Build a clipboard-friendly transcript of a run_command call so the
 * always-on header copy icon yields a useful paste even when the body
 * is collapsed. Includes the prompt, the command, stdout, stderr, and
 * the exit code in shell-style format.
 */
function buildCopyText(
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number | null,
): string {
  const lines: string[] = [];
  lines.push(`$ ${command || ""}`);
  if (stdout) lines.push(stdout);
  if (stderr) lines.push(stderr);
  if (exitCode !== null) lines.push(`# exit ${exitCode}`);
  return lines.join("\n");
}

export function CommandBlock({ entry, defaultExpanded }: CommandBlockProps) {
  const command = (entry.input.command as string) || "";
  const { stdout, stderr, exitCode } = decodeCapturedOutput(entry.result);
  const hasOutput = !!stdout || !!stderr;

  const isError = entry.isError || (exitCode !== null && exitCode !== 0);
  const status = entry.pending ? "pending" : isError ? "error" : "done";
  const toolLabel = TOOL_LABELS[entry.name] ?? "Run command";

  const trailing = exitCode !== null ? (
    <span className={isError ? styles.exitError : styles.exitOk}>
      EXIT {exitCode}
    </span>
  ) : null;

  return (
    <Block
      icon={<SquareTerminal size={12} />}
      title={toolLabel}
      summary={
        <>
          <span className={styles.cmdPrompt}>$</span>
          <span className={styles.cmdLine}>{command || "…"}</span>
        </>
      }
      status={status}
      trailing={trailing}
      defaultExpanded={defaultExpanded || entry.pending}
      forceExpanded={entry.pending}
      autoScroll={entry.pending}
      flushBody
      copy={{
        getText: () => buildCopyText(command, stdout, stderr, exitCode),
        ariaLabel: `Copy ${command || toolLabel}`,
      }}
    >
      {hasOutput ? (
        <div style={{ padding: "6px 10px" }}>
          {stdout ? <div className={styles.cmdOutput}>{stdout}</div> : null}
          {stderr ? (
            <div className={`${styles.cmdOutput} ${styles.cmdStderr}`}>{stderr}</div>
          ) : null}
        </div>
      ) : entry.isError && entry.result ? (
        <div className={styles.inlineError}>{String(entry.result).slice(0, 240)}</div>
      ) : (
        <div className={styles.listEmpty}>No output.</div>
      )}
    </Block>
  );
}
