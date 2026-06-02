import { memo } from "react";
import { FolderOpen } from "lucide-react";
import type {
  DemoRecordOptions,
  RecordResolution,
  RecordTarget,
} from "../../../../shared/api/desktop";
import styles from "./DemoRecordSettings.module.css";

interface Props {
  value: DemoRecordOptions;
  onChange: (next: DemoRecordOptions) => void;
  onPickBackground: () => void;
}

const RESOLUTION_OPTIONS: { id: RecordResolution; label: string }[] = [
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
  { id: "1440p", label: "1440p" },
];

const TARGET_OPTIONS: { id: RecordTarget; label: string }[] = [
  { id: "x", label: "X / Twitter" },
  { id: "raw", label: "Raw capture" },
];

/**
 * Presentational, fully-controlled settings panel for the
 * `/record_demo` command. Renders the resolution / target selects, the
 * window-on-background toggle, and the custom-background control; all
 * mutations are surfaced through `onChange` (value + onChange) so the
 * owner holds the single source of truth. The native file picker is
 * driven by the parent via `onPickBackground`.
 */
function DemoRecordSettingsImpl({ value, onChange, onPickBackground }: Props) {
  const backgroundLabel = value.backgroundPath
    ? value.backgroundPath.split(/[\\/]/).pop() || value.backgroundPath
    : "Default";

  return (
    <div
      className={styles.panel}
      data-agent-surface="demo-record-settings"
    >
      <div className={styles.field}>
        <label className={styles.label} htmlFor="demo-record-resolution">
          Resolution
        </label>
        <select
          id="demo-record-resolution"
          className={styles.select}
          aria-label="Recording resolution"
          value={value.resolution}
          onChange={(e) =>
            onChange({
              ...value,
              resolution: e.target.value as RecordResolution,
            })
          }
        >
          {RESOLUTION_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="demo-record-target">
          Output
        </label>
        <select
          id="demo-record-target"
          className={styles.select}
          aria-label="Output format"
          value={value.target}
          onChange={(e) =>
            onChange({ ...value, target: e.target.value as RecordTarget })
          }
        >
          {TARGET_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Background</span>
        <div className={styles.backgroundControl}>
          <span className={styles.backgroundName} title={backgroundLabel}>
            {backgroundLabel}
          </span>
          <button
            type="button"
            className={styles.chooseButton}
            onClick={onPickBackground}
            aria-label="Choose background image"
          >
            <FolderOpen size={12} />
            Choose…
          </button>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Frame on background</span>
        <button
          type="button"
          role="switch"
          aria-checked={value.windowOnBackground}
          aria-label="Frame window on background"
          className={`${styles.toggle} ${
            value.windowOnBackground ? styles.toggleOn : ""
          }`}
          onClick={() =>
            onChange({
              ...value,
              windowOnBackground: !value.windowOnBackground,
            })
          }
        >
          <span className={styles.toggleKnob} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Computer use</span>
        <button
          type="button"
          role="switch"
          aria-checked={value.computerUse}
          aria-label="Enable computer use"
          className={`${styles.toggle} ${
            value.computerUse ? styles.toggleOn : ""
          }`}
          onClick={() =>
            onChange({
              ...value,
              computerUse: !value.computerUse,
            })
          }
        >
          <span className={styles.toggleKnob} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export const DemoRecordSettings = memo(DemoRecordSettingsImpl);
