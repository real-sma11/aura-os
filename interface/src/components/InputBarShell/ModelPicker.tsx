import {
  memo,
  useCallback,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import styles from "./InputBarShell.module.css";

export interface ModelOptionLike {
  id: string;
  label: string;
}

export interface ModelPickerProps {
  /** Display label for the trigger button (e.g. the active model name). */
  selectedLabel: string;
  /**
   * When true (default), the button is interactive and opens the menu.
   * When false, the button is rendered as plain text (no chevron, no menu).
   */
  isInteractive?: boolean;
  /**
   * Render-prop for the menu content. Receives a `close` callback so menu
   * items can dismiss the dropdown after selection.
   */
  renderMenu: (close: () => void) => ReactNode;
  /** Show a chevron icon next to the label. Defaults to `isInteractive`. */
  showChevron?: boolean;
  /** Extra props for the trigger button (e.g. data-attrs). */
  triggerProps?: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type" | "className"> & {
    [dataAttr: `data-${string}`]: string | number | boolean | undefined;
  };
  /** Extra className appended to the wrapper. */
  className?: string;
  /** Extra className appended to the trigger button. */
  buttonClassName?: string;
  /**
   * Called when the menu opens. Use for menu-local state resets (e.g.
   * collapsing a "show all" subview); the picker preserves focus on
   * whatever element was active before the click, so consumers should
   * not blur the textarea here.
   */
  onOpen?: () => void;
}

/**
 * Reusable model picker used by both `ChatInputBar` and the aura3d
 * `PromptInput`. Owns the trigger button + dropdown chrome (positioning,
 * click-outside dismissal). Menu items are supplied by the caller via
 * `renderMenu` so each consumer can render flat / grouped / featured
 * variants while sharing the visual style.
 */
export const ModelPicker = memo(function ModelPicker({
  selectedLabel,
  isInteractive = true,
  renderMenu,
  showChevron,
  triggerProps,
  className,
  buttonClassName,
  onOpen,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest("[data-model-menu-root='true']")
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const handleClick = useCallback(() => {
    if (!isInteractive) return;
    setOpen((v) => {
      const next = !v;
      if (next) onOpen?.();
      return next;
    });
  }, [isInteractive, onOpen]);

  const wrapperClass = [styles.modelMenuWrap, className].filter(Boolean).join(" ");
  const buttonClass = [styles.modelButton, buttonClassName].filter(Boolean).join(" ");
  const chevron = showChevron ?? isInteractive;

  // Keep the user's prior focus target (typically the chat textarea)
  // active when interacting with the picker. Buttons grab focus on
  // mousedown by default; preventDefault on the bubbled mousedown
  // event suppresses the focus change while still firing the click,
  // so opening the menu and selecting a model both leave the caret
  // exactly where the user left it. Mirrors the pattern used by
  // `SlidingPills` for the mode bar.
  const handleMouseDownPreserveFocus = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
    },
    [],
  );

  return (
    <div className={wrapperClass} data-model-menu-root="true">
      <button
        {...triggerProps}
        type="button"
        className={buttonClass}
        onMouseDown={isInteractive ? handleMouseDownPreserveFocus : undefined}
        onClick={isInteractive ? handleClick : undefined}
        aria-haspopup={isInteractive ? "menu" : undefined}
        aria-expanded={isInteractive ? open : undefined}
        style={isInteractive ? undefined : { cursor: "default" }}
      >
        {selectedLabel}
        {chevron && <ChevronDown size={10} />}
      </button>
      {open && isInteractive && (
        <div onMouseDown={handleMouseDownPreserveFocus} style={{ display: "contents" }}>
          {renderMenu(close)}
        </div>
      )}
    </div>
  );
});
