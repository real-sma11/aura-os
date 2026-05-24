import { useState } from "react";
import styles from "./IdeView.module.css";

interface Props {
  name: string;
  isDir: boolean;
  onConfirm: () => Promise<string | null>;
  onCancel: () => void;
}

export function ConfirmDeleteDialog({ name, isDir, onConfirm, onCancel }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    const err = await onConfirm();
    if (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className={styles.dialogOverlay} onClick={onCancel} onKeyDown={handleKeyDown}>
      <div className={styles.dialogBox} onClick={(e) => e.stopPropagation()}>
        <label className={styles.dialogLabel}>Are you sure?</label>
        <p className={styles.dialogText}>
          Delete {isDir ? "folder" : "file"} <strong>{name}</strong>?{" "}
          {isDir && "All contents will be permanently removed."}
        </p>
        {error && <span className={styles.dialogError}>{error}</span>}
        <div className={styles.dialogActions}>
          <button className={styles.dialogButton} onClick={onCancel} disabled={submitting} autoFocus>
            Cancel
          </button>
          <button className={styles.dialogButtonDanger} onClick={handleConfirm} disabled={submitting}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
