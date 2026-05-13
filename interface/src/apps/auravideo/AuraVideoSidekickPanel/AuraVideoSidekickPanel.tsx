import { useCallback, useState } from "react";
import { Spinner } from "@cypher-asi/zui";
import { Film } from "lucide-react";
import {
  useAuraVideoStore,
  type GeneratedVideo,
} from "../../../stores/auravideo-store";
import { EmptyState } from "../../../components/EmptyState";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../../../components/SidekickItemContextMenu";
import styles from "./AuraVideoSidekickPanel.module.css";

function VideoThumb({ video }: { video: GeneratedVideo }) {
  const [failed, setFailed] = useState(false);

  if (failed || !video.videoUrl) {
    return (
      <div className={styles.thumbIcon}>
        <Film size={20} />
      </div>
    );
  }

  return (
    <video
      src={`${video.videoUrl}#t=0.5`}
      className={styles.thumbImage}
      muted
      preload="auto"
      playsInline
      onError={() => setFailed(true)}
    />
  );
}

export function AuraVideoSidekickPanel() {
  const videos = useAuraVideoStore((s) => s.videos);
  const currentVideo = useAuraVideoStore((s) => s.currentVideo);
  const isGenerating = useAuraVideoStore((s) => s.isGenerating);
  const selectVideo = useAuraVideoStore((s) => s.selectVideo);
  const deleteVideo = useAuraVideoStore((s) => s.deleteVideo);

  const resolveMenuTarget = useCallback(
    (nodeId: string): GeneratedVideo | null =>
      videos.find((v) => v.id === nodeId) ?? null,
    [videos],
  );

  const { menu, menuRef, handleContextMenu, closeMenu } =
    useSidekickItemContextMenu<GeneratedVideo>({
      resolveItem: resolveMenuTarget,
    });

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target || actionId !== "delete") return;
      deleteVideo(target.id);
    },
    [menu, closeMenu, deleteVideo],
  );

  const pendingTile = isGenerating ? (
    <div className={styles.thumb} key="pending">
      <div className={styles.thumbPending}>
        <Spinner size="sm" />
      </div>
    </div>
  ) : null;

  if (videos.length === 0 && !isGenerating) {
    return <EmptyState>No videos yet</EmptyState>;
  }

  return (
    <div className={styles.panel} onContextMenu={handleContextMenu}>
      <div className={styles.sectionTitle}>Videos</div>
      <div className={styles.grid}>
        {pendingTile}
        {videos.map((video) => (
          <button
            key={video.id}
            id={video.id}
            type="button"
            className={`${styles.thumb} ${currentVideo?.id === video.id ? styles.thumbSelected : ""}`}
            onClick={() => selectVideo(video.id)}
            title={video.prompt}
          >
            <VideoThumb video={video} />
          </button>
        ))}
      </div>
      {menu && (
        <SidekickItemContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          onAction={handleMenuAction}
          actions={["delete"]}
        />
      )}
    </div>
  );
}
