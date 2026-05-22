import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
} from "react";
import { ArrowUp, Plus } from "lucide-react";
import styles from "./PublicComposeInput.module.css";

/**
 * `PublicComposeInput` — minimal compose input dedicated to the public
 * (logged-out) chat surface.
 *
 * Replaces the heavy authenticated `DesktopChatInputBar` for the public
 * view. The public dispatch path (see `usePublicChat`) does not consume
 * attachments, projects, slash commands, or per-turn model overrides,
 * so all that chrome was dead weight here. This component renders only
 * what the reference visual calls for:
 *
 *   - a `+` affordance on the left (visual placeholder for now — public
 *     dispatch does not accept attachments today; wiring it up is a
 *     follow-up)
 *   - an auto-growing textarea
 *   - a circular send button (or a stop button while a turn is streaming)
 *
 * The component is intentionally self-contained — it owns its own
 * textarea ref, focus handle, and Enter-to-send behavior — so the
 * public chat surface no longer has to carry the full `InputBarShell`
 * layout machinery.
 */
export interface PublicComposeInputHandle {
  focus: () => void;
}

export interface PublicComposeInputProps {
  input: string;
  onInputChange: (next: string) => void;
  onSend: (content: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  /** Disables the textarea + send button (e.g. while gated). */
  disabled?: boolean;
  /** Override the placeholder; defaults to "Ask anything privately…". */
  placeholder?: string;
}

const DEFAULT_PLACEHOLDER = "Ask anything privately\u2026";
const TEXTAREA_MAX_HEIGHT_PX = 200;

export const PublicComposeInput = memo(
  forwardRef<PublicComposeInputHandle, PublicComposeInputProps>(
    function PublicComposeInput(
      {
        input,
        onInputChange,
        onSend,
        onStop,
        isStreaming,
        disabled = false,
        placeholder = DEFAULT_PLACEHOLDER,
      },
      ref,
    ) {
      const textareaRef = useRef<HTMLTextAreaElement>(null);

      useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus(),
      }));

      // Auto-grow the textarea as the user types, capped at
      // `TEXTAREA_MAX_HEIGHT_PX` so a long paste doesn't push the pill
      // off-screen. We measure on every value change rather than via
      // ResizeObserver because the only width changes that matter
      // (viewport resizes) already trigger a relayout pass.
      useEffect(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
      }, [input]);

      const trimmed = input.trim();
      const canSend = trimmed.length > 0 && !disabled;

      const handleSubmit = useCallback(() => {
        if (!canSend) return;
        onSend(input);
      }, [canSend, input, onSend]);

      const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit();
          }
        },
        [handleSubmit],
      );

      return (
        <form
          className={styles.composeForm}
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          data-agent-surface="public-compose-input"
        >
          <div
            className={styles.composeContainer}
            data-disabled={disabled ? "true" : undefined}
          >
            <button
              type="button"
              className={styles.attachButton}
              aria-label="Attach (coming soon)"
              tabIndex={-1}
              disabled={disabled}
            >
              <Plus size={16} strokeWidth={1.75} />
            </button>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              disabled={disabled}
              aria-label="Compose"
              data-agent-field="public-chat-input"
            />
            {isStreaming ? (
              <button
                type="button"
                className={`${styles.sendButton} ${styles.stopButton}`}
                onClick={onStop}
                aria-label="Stop"
              >
                <span className={styles.stopGlyph} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                className={styles.sendButton}
                disabled={!canSend}
                aria-label="Send"
              >
                <ArrowUp size={16} strokeWidth={2} />
              </button>
            )}
          </div>
        </form>
      );
    },
  ),
);
