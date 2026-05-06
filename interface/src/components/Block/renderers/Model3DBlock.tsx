import { Box, Download } from "lucide-react";
import { lazy, Suspense } from "react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { Block } from "../Block";
import styles from "./renderers.module.css";

// Lazy-load the Three.js scene + GLTF loader so the chat bundle does
// not pull them in until a `generate_3d_model` block actually mounts.
// Keeps the cold transcript paint cheap for non-3D conversations.
const WebGLViewer = lazy(() =>
  import("../../../apps/aura3d/WebGLViewer/WebGLViewer").then((m) => ({
    default: m.WebGLViewer,
  })),
);

function parseResult(result: string | null | undefined): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

interface Model3DBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function Model3DBlock({ entry, defaultExpanded }: Model3DBlockProps) {
  const data = parseResult(entry.result);
  const glbUrl = (data?.glbUrl ?? data?.glb_url) as string | undefined;
  const polyCount = data?.polyCount as number | undefined;
  const resultStatus = data?.status as string | undefined;

  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";

  // Success branch: bypass the collapsible `Block` wrapper entirely so
  // the WebGLViewer renders unconditionally — matches `ImageBlock`'s
  // success-state pattern. Without this, the embedded viewer was hidden
  // whenever the bubble re-mounted in a non-just-finalized state (any
  // navigation away and back), forcing users to "close and reopen the
  // app" before the scene appeared.
  if (glbUrl && status === "done") {
    return (
      <div
        className={styles.generatedModel3DResult}
        data-agent-surface="chat-3d-model-viewer"
        data-agent-proof="generated-3d-model-visible"
      >
        <div className={styles.generatedModel3DViewer}>
          <Suspense
            fallback={
              <div className={styles.model3dViewerFallback}>Loading viewer…</div>
            }
          >
            <WebGLViewer glbUrl={glbUrl} showGrid showTexture />
          </Suspense>
        </div>
        <div className={styles.generatedModel3DMeta}>
          {polyCount != null ? (
            <span className={styles.generatedModel3DPolyCount}>
              {polyCount.toLocaleString()} polys
            </span>
          ) : null}
          <a
            href={glbUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.generatedModel3DDownload}
            aria-label="Download GLB"
          >
            <Download size={11} aria-hidden="true" />
            <span>Download GLB</span>
          </a>
        </div>
      </div>
    );
  }

  // Pending / error / no-glb fall back to the standard Block chrome so
  // the user gets the cooking spinner / status header until the success
  // path takes over.
  return (
    <Block
      icon={<Box size={12} />}
      title="Generated 3D model"
      badge={polyCount != null ? `${polyCount.toLocaleString()} polys` : "3D"}
      status={status}
      defaultExpanded={defaultExpanded ?? true}
    >
      <div className={styles.mediaWrap}>
        {entry.pending ? (
          <div className={styles.listEmpty}>Generating…</div>
        ) : (
          <div className={styles.listEmpty}>No model returned.</div>
        )}
        {resultStatus && resultStatus !== "success" ? (
          <div className={styles.mediaCaption}>Status: {resultStatus}</div>
        ) : null}
      </div>
    </Block>
  );
}
