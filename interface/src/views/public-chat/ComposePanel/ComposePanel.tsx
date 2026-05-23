import { MockAuraApp } from "../MockAuraApp";
import type { ChatPalette } from "../MockAuraApp/derive-chat-palette";
import styles from "./ComposePanel.module.css";

export interface ComposePanelProps {
  /**
   * Forwarded straight through to `MockAuraApp`. Lets the parent
   * (`PublicChatView`) swap the wallpaper inside the hero frame
   * when the active persona theme supplies a static image,
   * without `ComposePanel` having to know about persona state.
   */
  readonly desktopBackgroundUrl?: string | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional
   * `object-position` for the wallpaper `<img>` (only meaningful
   * when `desktopBackgroundUrl` is set). The parent picks the
   * value from `PersonaTheme.desktopBackgroundPosition`.
   */
  readonly desktopBackgroundPosition?: string | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional
   * `object-fit` for the wallpaper `<img>` — `"cover"` (default)
   * or `"contain"`. The parent picks the value from
   * `PersonaTheme.desktopBackgroundFit`.
   */
  readonly desktopBackgroundFit?: "cover" | "contain" | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional solid
   * color painted behind the wallpaper `<img>`. The parent picks
   * the value from `PersonaTheme.desktopBackgroundColor`.
   */
  readonly desktopBackgroundColor?: string | null;
  /**
   * Forwarded straight through to `MockAuraApp`. Optional CSS
   * scale multiplier for the wallpaper `<img>`. The parent picks
   * the value from `PersonaTheme.desktopBackgroundScale`.
   */
  readonly desktopBackgroundScale?: number | null;
  /**
   * Forwarded straight through to `MockAuraApp`. The parent
   * (`PublicChatView`) derives this from the active persona's
   * `siteBackgroundColor` via `deriveChatPalette`; this layer
   * stays palette-agnostic so a future host can drop in its own
   * persona swap without touching the panel.
   */
  readonly chatPalette?: ChatPalette | null;
}

/**
 * Empty-state hero stack for the public chat view. Phase 0 reduces
 * this to a thin layout shell that centers the decorative
 * `MockAuraApp` (a flat 16:10 wallpaper rectangle with the scripted
 * DM windows floating inside) in the available empty-state area.
 *
 * The actual `PublicComposeInput` is rendered by `PublicChatView`
 * in its bottom-anchored `.inputBarSlot` (the SAME slot used by the
 * populated transcript layout) so the rounded input pill is pinned
 * to the bottom of the screen in both empty and populated states.
 * That symmetry eliminates any layout jump in the input's vertical
 * position when the visitor sends their first message.
 *
 * Phases 1 and 2 will reintroduce mock chrome on top of the
 * wallpaper (real `ShellTitlebar` overlay plus three bottom dock
 * pills) — none of that lives in this file. The helper-prompt pills
 * that previously sat above a fake taskbar were removed in phase 0
 * along with the rest of the mock chrome.
 */
export function ComposePanel({
  desktopBackgroundUrl = null,
  desktopBackgroundPosition = null,
  desktopBackgroundFit = null,
  desktopBackgroundColor = null,
  desktopBackgroundScale = null,
  chatPalette = null,
}: ComposePanelProps = {}): React.ReactElement {
  return (
    <div
      className={styles.composePanel}
      role="region"
      aria-label="Start a new conversation"
    >
      <MockAuraApp
        desktopBackgroundUrl={desktopBackgroundUrl}
        desktopBackgroundPosition={desktopBackgroundPosition}
        desktopBackgroundFit={desktopBackgroundFit}
        desktopBackgroundColor={desktopBackgroundColor}
        desktopBackgroundScale={desktopBackgroundScale}
        chatPalette={chatPalette}
      />
    </div>
  );
}
