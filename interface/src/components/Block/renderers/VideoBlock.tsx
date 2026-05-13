import { Film } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { Block } from "../Block";
import styles from "./renderers.module.css";

function parseResult(result: string | null | undefined): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

interface VideoBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function VideoBlock({ entry, defaultExpanded }: VideoBlockProps) {
  const data = parseResult(entry.result);
  const payload = data?.payload && typeof data.payload === "object"
    ? data.payload as Record<string, unknown>
    : null;
  // The harness normalizes video_url → imageUrl, so check imageUrl first.
  // Also check videoUrl / video_url as aliases for robustness.
  const videoUrl = (
    data?.imageUrl ??
    data?.videoUrl ??
    data?.video_url ??
    data?.url ??
    payload?.imageUrl ??
    payload?.videoUrl ??
    payload?.video_url ??
    payload?.url
  ) as string | undefined;
  const model = (data as { meta?: { model?: string } } | null)?.meta?.model;
  const prompt =
    (data?.prompt as string | undefined) ??
    ((data as { meta?: { prompt?: string } } | null)?.meta?.prompt) ??
    (entry.input.prompt as string | undefined);

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";

  if (videoUrl && status === "done") {
    return (
      <div className={styles.generatedVideoResult}>
        <video
          src={videoUrl}
          className={styles.generatedVideoPlayer}
          controls
          playsInline
          preload="metadata"
        />
      </div>
    );
  }

  return (
    <Block
      icon={<Film size={12} />}
      title="Generated video"
      badge={model ?? "Video"}
      status={status}
      defaultExpanded={defaultExpanded ?? true}
    >
      <div className={styles.mediaWrap}>
        {videoUrl ? (
          <video
            src={videoUrl}
            className={styles.mediaImage}
            controls
            playsInline
            preload="metadata"
          />
        ) : entry.pending ? (
          <div className={styles.listEmpty}>Generating…</div>
        ) : (
          <div className={styles.listEmpty}>No video returned.</div>
        )}
        {prompt ? <div className={styles.mediaCaption}>Prompt: {prompt}</div> : null}
      </div>
    </Block>
  );
}
