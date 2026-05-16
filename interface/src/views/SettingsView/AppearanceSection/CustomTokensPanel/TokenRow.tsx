import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { Button } from "@cypher-asi/zui";
import { isValidColorValue, type EditableToken } from "../../../../lib/theme-overrides";
import styles from "./CustomTokensPanel.module.css";

/**
 * `<input type="color">` only supports `#rrggbb`, so derive a safe
 * starter value whenever the token is unset or the current override is
 * a non-hex CSS color. Fallback is mid-grey — it's only shown in the
 * native picker popover, not on the preview swatch.
 */
function toColorInputValue(value: string | undefined): string {
  if (typeof value !== "string") return "#808080";
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#808080";
}

type RowHandlers = {
  draft: string;
  isInvalid: boolean;
  handleTextChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleColorChange: (e: ChangeEvent<HTMLInputElement>) => void;
  handleReset: () => void;
};

function useTokenRowState(
  currentValue: string | undefined,
  onChange: (value: string | null) => void,
): RowHandlers {
  const [draft, setDraft] = useState<string>(currentValue ?? "");
  const [touched, setTouched] = useState<boolean>(false);

  const isInvalid =
    touched && draft.trim().length > 0 && !isValidColorValue(draft);

  const handleTextChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setDraft(next);
      setTouched(true);
      const trimmed = next.trim();
      if (trimmed.length === 0) {
        onChange(null);
      } else if (isValidColorValue(trimmed)) {
        onChange(trimmed);
      } else {
        onChange(null);
      }
    },
    [onChange],
  );

  const handleColorChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setDraft(next);
      setTouched(true);
      onChange(next);
    },
    [onChange],
  );

  const handleReset = useCallback(() => {
    setDraft("");
    setTouched(false);
    onChange(null);
  }, [onChange]);

  return { draft, isInvalid, handleTextChange, handleColorChange, handleReset };
}

export type TokenRowProps = {
  token: EditableToken;
  label: string;
  /** Aria/label suffix for inputs and reset (defaults to {@link label}). */
  controlLabel?: string;
  /** DOM id suffix when multiple rows share the same token. */
  rowKey?: string;
  currentValue: string | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
};

/**
 * One row of the chrome-token editor: preview swatch + native color
 * picker + free-form hex/CSS text input + reset button. Pulled out of
 * {@link CustomTokensPanel} so other Appearance sections (e.g. the
 * icon-select accent) can reuse the same control shape without
 * duplicating the input/validation plumbing.
 */
export function TokenRow({
  token,
  label,
  controlLabel,
  rowKey,
  currentValue,
  onChange,
  disabled = false,
}: TokenRowProps) {
  const { draft, isInvalid, handleTextChange, handleColorChange, handleReset } =
    useTokenRowState(currentValue, onChange);
  const ariaLabel = controlLabel ?? label;
  const inputId = `token-text-${token}${rowKey ? `-${rowKey}` : ""}`;
  const swatchTestId = `token-swatch-${token}${rowKey ? `-${rowKey}` : ""}`;
  const hasOverride = typeof currentValue === "string";
  const swatchStyle = useMemo(
    () => ({ background: hasOverride ? currentValue : `var(${token})` }),
    [hasOverride, currentValue, token],
  );
  const textInputClass = `${styles.textInput}${isInvalid ? ` ${styles.textInputInvalid}` : ""}`;

  return (
    <div className={styles.row}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <div className={styles.controls}>
        <span
          aria-hidden="true"
          className={styles.swatch}
          style={swatchStyle}
          data-testid={swatchTestId}
        />
        <input
          type="color"
          aria-label={`${ariaLabel} color picker`}
          value={toColorInputValue(currentValue)}
          onChange={handleColorChange}
          className={styles.colorInput}
          disabled={disabled}
        />
        <input
          id={inputId}
          type="text"
          spellCheck={false}
          autoComplete="off"
          placeholder={`var(${token})`}
          aria-label={`${ariaLabel} CSS value`}
          aria-invalid={isInvalid || undefined}
          value={draft}
          onChange={handleTextChange}
          className={textInputClass}
          disabled={disabled}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={handleReset}
          aria-label={`Reset ${ariaLabel}`}
          disabled={disabled}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
