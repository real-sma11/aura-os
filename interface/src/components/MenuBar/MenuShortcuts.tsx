import { useMenuActions } from "./use-menu-actions";
import { useMenuShortcuts } from "./use-menu-shortcuts";

/**
 * Headless companion to `<MenuBar />` that installs the document-level
 * keyboard shortcut listener without rendering any visible chrome.
 *
 * The visible application menu (`<MenuBar />`) and the global
 * shortcuts it powers (Ctrl+N new window, Ctrl+, settings, F11
 * fullscreen, Ctrl+= / - / 0 zoom, Ctrl+W exit, etc.) both live in the
 * authed standard shell. This headless companion installs the listener
 * independently of the visible bar.
 *
 * Renders `null`. Mount exactly once per authenticated shell to avoid
 * installing duplicate document `keydown` listeners.
 */
export function MenuShortcuts(): null {
  const { actions, isItemDisabled } = useMenuActions();
  useMenuShortcuts({ actions, isItemDisabled });
  return null;
}
