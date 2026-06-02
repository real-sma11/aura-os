import { useState } from "react";
import { Modal, Button } from "@cypher-asi/zui";
import { desktopApi } from "../../shared/api/desktop";
import { useDemoRecordStore, type DemoSetupRequest } from "../../stores/demo-record-store";
import styles from "./RecordDemoSetupModal.module.css";

const WINGET_COMMAND = "winget install Gyan.FFmpeg";

/**
 * Self-service setup prompt for a failed `/record_demo` preflight.
 *
 * Mounted once near the app root; driven by `useDemoRecordStore`. Depending
 * on the failure `kind` it lets the user either locate an ffmpeg binary
 * (validated + persisted backend-side) or open the macOS Screen Recording
 * settings, then retries the original recording with the same instruction
 * and options.
 */
export function RecordDemoSetupModal() {
  const setup = useDemoRecordStore((s) => s.setup);
  const dismissSetup = useDemoRecordStore((s) => s.dismissSetup);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const close = () => {
    if (busy) return;
    setError(null);
    setCopied(false);
    dismissSetup();
  };

  // Re-issue the recording with the original instruction + options. Returns
  // true when it started; otherwise updates the modal with the new failure.
  const retryRecording = async (req: DemoSetupRequest): Promise<boolean> => {
    const res = await desktopApi.startDemoRecording(req.instruction, req.options);
    if (res && res.ok) return true;
    if (res && res.kind) {
      useDemoRecordStore.getState().requestSetup({
        kind: res.kind,
        message: res.error ?? "Demo recording could not start.",
        instruction: req.instruction,
        options: req.options,
      });
    } else {
      setError(res?.error ?? "Demo recording could not start.");
    }
    return false;
  };

  if (!setup) return null;

  const handleLocateFfmpeg = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await desktopApi.pickFile();
      if (!path) {
        setBusy(false);
        return;
      }
      const saved = await desktopApi.setDemoFfmpegPath(path);
      if (!saved.ok) {
        setError(saved.error ?? "That file doesn't look like a working ffmpeg.");
        setBusy(false);
        return;
      }
      if (await retryRecording(setup)) {
        dismissSetup();
        setError(null);
      }
    } catch {
      setError("Couldn't configure ffmpeg. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    setBusy(true);
    setError(null);
    try {
      if (await retryRecording(setup)) {
        dismissSetup();
        setError(null);
      }
    } catch {
      setError("Demo recording could not start. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleOpenScreenRecordingSettings = async () => {
    try {
      await desktopApi.openScreenRecordingSettings();
    } catch {
      // Best-effort; the deep link may be unavailable.
    }
  };

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(WINGET_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  };

  const isFfmpeg = setup.kind === "ffmpeg_missing";
  const title = isFfmpeg ? "FFmpeg required" : "Screen Recording permission";

  return (
    <Modal isOpen onClose={close} title={title} size="sm">
      <div className={styles.content}>
        <p className={styles.message}>{setup.message}</p>

        {isFfmpeg ? (
          <>
            <p className={styles.hint}>
              Install ffmpeg, then retry &mdash; or point AURA at an existing
              ffmpeg executable.
            </p>
            <div className={styles.commandRow}>
              <code className={styles.command}>{WINGET_COMMAND}</code>
              <button
                type="button"
                className={styles.copyButton}
                onClick={handleCopyCommand}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
              <Button variant="primary" onClick={handleLocateFfmpeg} disabled={busy}>
                {busy ? "Working\u2026" : "Locate ffmpeg\u2026"}
              </Button>
              <Button variant="secondary" onClick={handleRetry} disabled={busy}>
                Retry
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.hint}>
              Enable AURA under System Settings &gt; Privacy &amp; Security &gt;
              Screen Recording, then retry.
            </p>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
              <Button
                variant="primary"
                onClick={handleOpenScreenRecordingSettings}
                disabled={busy}
              >
                Open settings
              </Button>
              <Button variant="secondary" onClick={handleRetry} disabled={busy}>
                {busy ? "Working\u2026" : "Retry"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
