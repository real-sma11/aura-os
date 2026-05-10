import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { File } from "lucide-react";
import { filterProjectFiles, type ProjectFile } from "./useProjectFiles";
import styles from "./ChatInputBar.module.css";

interface Props {
  query: string;
  files: ProjectFile[];
  onSelect: (file: ProjectFile) => void;
  onClose: () => void;
}

export const FileMentionMenu = memo(function FileMentionMenu({
  query,
  files,
  onSelect,
  onClose,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => filterProjectFiles(files, query), [files, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const active = listRef.current?.querySelector(
      `.${styles.slashMenuItemActive}`,
    ) as HTMLElement | null;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (filtered.length === 0) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          onClose();
        }
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopImmediatePropagation();
          setActiveIndex((i) => (i + 1) % filtered.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopImmediatePropagation();
          setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          e.stopImmediatePropagation();
          onSelect(filtered[activeIndex]);
          break;
        case "Escape":
          e.preventDefault();
          e.stopImmediatePropagation();
          onClose();
          break;
      }
    },
    [filtered, activeIndex, onSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  if (filtered.length === 0) {
    return (
      <div className={styles.slashMenu} ref={listRef}>
        <div className={styles.mentionMenuEmpty}>No matching files</div>
      </div>
    );
  }

  return (
    <div className={styles.slashMenu} ref={listRef}>
      {filtered.map((file, i) => (
        <button
          key={file.path}
          type="button"
          className={`${styles.slashMenuItem} ${styles.mentionMenuItem} ${i === activeIndex ? styles.slashMenuItemActive : ""}`}
          onMouseEnter={() => setActiveIndex(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(file);
          }}
        >
          <File size={12} className={styles.mentionMenuIcon} />
          <span className={styles.slashMenuItemLabel}>{file.name}</span>
          <span className={styles.slashMenuItemDesc}>{file.relativePath}</span>
        </button>
      ))}
    </div>
  );
});
