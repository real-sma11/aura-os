import { createContext } from "react";

/**
 * Signals whether the surrounding left-menu pane is the currently-active one.
 *
 * The keep-alive `LeftMenu` shell mounts every visited pane and hides the
 * inactive ones with `display: none`. Lists inside a pane need a reliable,
 * geometry-independent signal for "I just became visible" so they can replay
 * their reveal cascade on an Agents <-> Projects switch. `LeftMenu` provides
 * this; `useSidebarListReveal` consumes it.
 *
 * Defaults to `true` so standalone usages without a provider (mobile library,
 * tests) keep their normal mount-time reveal behavior.
 */
export const LeftMenuPaneActiveContext = createContext<boolean>(true);
