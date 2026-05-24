import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { Lane } from "../Lane";
import { PanelSearch } from "../PanelSearch";
import { ModeToggle } from "../ModeToggle";
import { LeftMenu } from "../../features/left-menu";
import { PublicSessionsPanel } from "../../views/public-chat/PublicSessionsPanel";
import { PublicSidebarFooter } from "../../views/public-chat/PublicSidebarFooter";
import { useActiveApp } from "../../hooks/use-active-app";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useSidebarSearchStore } from "../../stores/sidebar-search-store";
import { useSidebarSearch } from "../../hooks/use-sidebar-search";
import { usePublicChatStore } from "../../stores/public-chat-store";
import { apps } from "../../apps/registry";
import type { UIMode } from "../../stores/ui-mode-store";
import shellStyles from "./AuraShell.module.css";
import styles from "./AuraSidebar.module.css";

/**
 * Shared list of apps that contribute a `DesktopLeftMenuPane`. The
 * advanced sidebar body uses `LeftMenu` for these apps and falls
 * back to the app's own `LeftPanel` for everything else — same
 * decision tree DesktopShell ran.
 *
 * `apps/registry` is the canonical bridge between the shared tier
 * and the app modules; this `.flatMap` walks the registry shape
 * without touching individual app implementations.
 */
const sharedDesktopLeftMenuPanes = apps.flatMap((app) => {
  const Pane = app.DesktopLeftMenuPane;
  return Pane ? [{ appId: app.id, Pane }] : [];
});

function usesSharedDesktopLeftMenu(appId: string): boolean {
  return sharedDesktopLeftMenuPanes.some((pane) => pane.appId === appId);
}

const PUBLIC_SEARCH_KEY = "public";

export interface AuraSidebarProps {
  /**
   * Effective UI mode. Drives the body slot, search variant, and
   * `<ModeToggle>` presence — but NOT the wrapping `<aside>`, the
   * `<Lane>` instance, the `.sidebarHeader`, or the `<PanelSearch>`
   * input. Those keep stable DOM identity across every mode flip so
   * the slide-not-snap and search-continuity invariants hold.
   *
   * `<ModeToggle>` is gated to authenticated modes only — it
   * unmounts in `public` and remounts on sign-in. The slide-not-snap
   * invariant is preserved across the in-scope flow (Simple <->
   * Advanced); the public boundary is a discrete login event where
   * a remount is the correct UX.
   */
  mode: UIMode;
}

/**
 * Single `<Lane>` (and single `<aside>` wrapper) mounted across
 * every effective mode. Header slot always renders the
 * `<PanelSearch>` and renders `<ModeToggle>` only in authenticated
 * modes (`simple` / `advanced`). Body slot conditionally renders one
 * of three subtrees based on `mode`.
 *
 * Phase 3 invariants:
 * - The Lane mount, sidebarHeader div, and PanelSearch input retain
 *   reference-stable DOM identity across every mode flip. The
 *   `ModeToggle` keeps reference-stable identity across the
 *   Simple <-> Advanced flip; it remounts across the public <->
 *   authed boundary, where the remount is the correct UX for a
 *   discrete login event.
 * - The sidebar Lane writes its current width to the
 *   `--aura-sidebar-width` CSS variable on `documentElement` so the
 *   public-chat surface's centered AURA visual loop stays aligned
 *   regardless of user resize.
 * - Search query value is lifted into `useSidebarSearchStore` (for
 *   the `public` key) and the existing per-app `useAppUIStore.
 *   sidebarQueries` (for authenticated modes via `useSidebarSearch`)
 *   so typing survives mode flips.
 */
export function AuraSidebar({ mode }: AuraSidebarProps): React.ReactElement {
  const asideRef = useRef<HTMLElement>(null);
  const publicSidebarCollapsed = useAppUIStore((s) => s.publicSidebarCollapsed);
  const isPublic = mode === "public";

  // Publish the active sidebar width (the `<aside>` rather than just
  // the inner Lane) so that when the public Lane is collapsed and
  // the public nav footer is the only thing keeping the aside visible,
  // the chat surface's background video / vignette still re-centers
  // around the actual chrome — not around 0.
  useAuraSidebarWidthCssVar(asideRef);

  return (
    <aside
      ref={asideRef}
      className={shellStyles.sidebar}
      data-testid="aura-sidebar"
      data-ui-mode={mode}
      data-public-sidebar-collapsed={
        isPublic ? (publicSidebarCollapsed ? "true" : "false") : undefined
      }
    >
      <div className={shellStyles.sidebarBody}>
        <Lane
          // Public-mode Lane is collapsible and toggled from the
          // titlebar's left drawer button (`<PanelLeft />`); authed
          // modes keep the legacy always-open resizable behaviour.
          resizable={!isPublic || !publicSidebarCollapsed}
          collapsible={isPublic}
          collapsed={isPublic ? publicSidebarCollapsed : false}
          resizePosition="right"
          defaultWidth={200}
          maxWidth={600}
          storageKey="aura-sidebar"
          header={
            <div
              className={shellStyles.sidebarHeader}
              data-testid="aura-sidebar-header"
            >
              <AuraSidebarSearch mode={mode} />
              {!isPublic && <ModeToggle />}
            </div>
          }
        >
          <SidebarBody mode={mode} />
        </Lane>
      </div>
      {/*
        The public nav footer lives as a direct child of `<aside>`,
        OUTSIDE the collapsible Lane, so the Product / Changelog /
        Feedback / Pricing / Chat links remain visible even when the
        Lane animates to width 0. The aside's column-flex layout
        keeps the footer pinned at the bottom and lets it set the
        aside's natural width when the Lane is collapsed.
      */}
      {isPublic && <PublicSidebarFooter />}
    </aside>
  );
}

function SidebarBody({ mode }: { mode: UIMode }): React.ReactElement {
  if (mode === "public") {
    return <PublicSidebarBody />;
  }
  // Phase 3: simple and advanced share the active-app LeftPanel
  // body. Phase 4's `p4_simple_pin_chat` pins `ChatApp` as the
  // active app whenever `effectiveMode === "simple"`, so the body
  // resolves to ChatAppLeftPanel automatically via `useActiveApp`
  // without the shell needing to import from `apps/*`. The public
  // nav footer only lives inside `PublicSidebarBody` — it never
  // reaches simple/advanced users.
  return <AuthedSidebarBody />;
}

function AuthedSidebarBody(): React.ReactElement {
  const activeApp = useActiveApp();
  const visitedAppIds = useAppUIStore((s) => s.visitedAppIds);

  if (usesSharedDesktopLeftMenu(activeApp.id)) {
    return (
      <LeftMenu
        activeAppId={activeApp.id}
        panes={sharedDesktopLeftMenuPanes}
        visitedAppIds={visitedAppIds}
      />
    );
  }

  return (
    <div
      className={shellStyles.panelActive}
      data-agent-surface="left-panel"
      data-agent-active-app-id={activeApp.id}
      data-agent-active-app-label={activeApp.label}
      aria-label={`${activeApp.label} navigation panel`}
    >
      <activeApp.LeftPanel />
    </div>
  );
}

function PublicSidebarBody(): React.ReactElement {
  const [searchQuery] = useSidebarSearchQueryForKey(PUBLIC_SEARCH_KEY);
  return (
    <div className={styles.publicSessionsBody}>
      <PublicSessionsPanel searchQuery={searchQuery} />
    </div>
  );
}

function AuraSidebarSearch({ mode }: { mode: UIMode }): React.ReactElement {
  if (mode === "public") {
    return <PublicSearchBox />;
  }
  return <AuthedSearchBox />;
}

function PublicSearchBox(): React.ReactElement {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useSidebarSearchQueryForKey(PUBLIC_SEARCH_KEY);
  const createSession = usePublicChatStore((s) => s.createSession);

  // Mirrors the previous LoggedOutShell behaviour — reuse the most
  // recent zero-turn session if one already exists; only mint a new
  // id when every existing session has at least one turn. Keeps the
  // sidebar from accumulating orphan "New chat" rows when the user
  // mashes the "+" button.
  const handleNewChat = useCallback((): void => {
    const { sessions, sessionOrder } = usePublicChatStore.getState();
    const existingEmptyId = sessionOrder.find((id) => {
      const session = sessions[id];
      return session != null && session.turns.length === 0;
    });
    const id = existingEmptyId ?? createSession();
    navigate(`/chat?session=${id}`);
  }, [createSession, navigate]);

  return (
    <PanelSearch
      placeholder="Search"
      value={searchQuery}
      onChange={setSearchQuery}
      action={
        <button
          type="button"
          onClick={handleNewChat}
          aria-label="New chat"
          title="New chat"
          style={NEW_CHAT_BUTTON_STYLE}
        >
          <Plus size={14} />
        </button>
      }
    />
  );
}

const NEW_CHAT_BUTTON_STYLE: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--color-text-primary, inherit)",
  borderRadius: 6,
  width: 24,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
};

function AuthedSearchBox(): React.ReactElement {
  const activeApp = useActiveApp();
  const { query, setQuery, action } = useSidebarSearch();
  return (
    <PanelSearch
      placeholder={activeApp.searchPlaceholder ?? "Search"}
      value={query}
      onChange={setQuery}
      action={action}
    />
  );
}

function useSidebarSearchQueryForKey(
  key: string,
): [string, (value: string) => void] {
  const value = useSidebarSearchStore((s) => s.queries[key] ?? "");
  const setQuery = useSidebarSearchStore((s) => s.setQuery);
  const set = useCallback((next: string): void => setQuery(key, next), [key, setQuery]);
  return [value, set];
}

/**
 * Writes the active sidebar width (the `<aside>` element) to the
 * `--aura-sidebar-width` CSS variable on `<html>` so the public-
 * chat surface (`PublicChatView.module.css`) can offset its
 * centered AURA visual loop / compose panel by half of the
 * sidebar's current width plus the inter-panel gap. The previous
 * implementation hard-coded `calc((-280px - 6px) / 2)` against
 * the old fixed-width sidebar; Phase 3's resizable Lane made
 * that translate magic-number-dependent.
 *
 * Phase 5: the public left drawer can collapse the inner Lane to
 * width 0 while the public nav footer keeps the `<aside>` visible.
 * Measuring the aside (instead of just the Lane) keeps the chat
 * orb correctly centered relative to the actually-rendered
 * sidebar in both expanded and collapsed states.
 *
 * Uses a `ResizeObserver` on the aside ref so the variable
 * updates live as the user drags the lane handle or toggles the
 * drawer. Also publishes `--left-panel-width` for backwards
 * compatibility with the existing DesktopShell-era consumers in
 * `apps/notes/` and `apps/feed/`.
 */
function useAuraSidebarWidthCssVar(
  asideRef: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    let lastWidth = -1;
    const apply = (width: number): void => {
      if (width === lastWidth) return;
      lastWidth = width;
      document.documentElement.style.setProperty(
        "--aura-sidebar-width",
        `${width}px`,
      );
      document.documentElement.style.setProperty(
        "--left-panel-width",
        `${width}px`,
      );
    };
    apply(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const rawWidth =
        entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      apply(Math.round(rawWidth));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [asideRef]);
}
