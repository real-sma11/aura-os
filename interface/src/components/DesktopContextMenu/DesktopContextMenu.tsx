import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Image, Palette, Settings as SettingsIcon } from "lucide-react";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { useUIModalStore } from "../../stores/ui-modal-store";
import styles from "./DesktopContextMenu.module.css";

type ContextMenuItemId = "theme" | "set-background" | "settings";

const CONTEXT_MENU_ITEMS: MenuItem[] = [
  { id: "theme", label: "Theme", icon: <Palette size={14} /> },
  { id: "set-background", label: "Background", icon: <Image size={14} /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={14} /> },
];

// Estimated maximum menu footprint. Used so we can pre-anchor the overlay to
// the bottom/right edge when the click is in the lower/right half of the
// viewport, which avoids any visible flash before the zui Menu's own
// off-screen clamp runs.
const ESTIMATED_MENU_WIDTH = 220;
const ESTIMATED_MENU_HEIGHT = 132;
const VIEWPORT_PADDING = 8;

interface MenuPosition {
  x: number;
  y: number;
}

function computeOverlayStyle(position: MenuPosition): CSSProperties {
  if (typeof window === "undefined") {
    return { left: position.x, top: position.y };
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const style: CSSProperties = {};

  const wouldOverflowBottom =
    position.y + ESTIMATED_MENU_HEIGHT > viewportHeight - VIEWPORT_PADDING;
  if (wouldOverflowBottom) {
    style.bottom = Math.max(VIEWPORT_PADDING, viewportHeight - position.y);
  } else {
    style.top = position.y;
  }

  const wouldOverflowRight =
    position.x + ESTIMATED_MENU_WIDTH > viewportWidth - VIEWPORT_PADDING;
  if (wouldOverflowRight) {
    style.right = Math.max(VIEWPORT_PADDING, viewportWidth - position.x);
  } else {
    style.left = position.x;
  }

  return style;
}

export interface UseDesktopContextMenuResult {
  /**
   * Spread/attach to the element that should react to right-clicks. Callers
   * are responsible for any pre-filtering (e.g. ignoring clicks on child
   * buttons) before invoking this handler.
   */
  handleContextMenu: (event: ReactMouseEvent) => void;
  /** Element to render (typically near the consumer's root). */
  menuElement: ReactNode;
  /** Imperatively dismiss the menu (e.g. on route change). */
  dismiss: () => void;
}

export function useDesktopContextMenu(): UseDesktopContextMenuResult {
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const openOrgTheme = useUIModalStore((s) => s.openOrgTheme);
  const openOrgBackground = useUIModalStore((s) => s.openOrgBackground);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => setPosition(null), []);

  const handleContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setPosition({ x: event.clientX, y: event.clientY });
  }, []);

  useEffect(() => {
    if (!position) return;
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (overlayRef.current && overlayRef.current.contains(event.target as Node)) return;
      setPosition(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPosition(null);
      }
    };
    const handleResize = () => setPosition(null);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleResize);
    window.addEventListener("blur", handleResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("blur", handleResize);
    };
  }, [position]);

  const handleSelect = useCallback(
    (id: string) => {
      const action = id as ContextMenuItemId;
      setPosition(null);
      if (action === "theme") {
        openOrgTheme();
      } else if (action === "set-background") {
        openOrgBackground();
      } else if (action === "settings") {
        openOrgSettings();
      }
    },
    [openOrgSettings, openOrgTheme, openOrgBackground],
  );

  const overlayStyle = useMemo(
    () => (position ? computeOverlayStyle(position) : null),
    [position],
  );

  const menuElement = useMemo(() => {
    if (typeof document === "undefined") return null;
    if (!position || !overlayStyle) return null;
    const portalChildren = (
      <div ref={overlayRef} className={styles.overlay} style={overlayStyle}>
        <Menu
          items={CONTEXT_MENU_ITEMS}
          onChange={handleSelect}
          background="solid"
          border="solid"
          rounded="md"
          width={200}
          isOpen
        />
      </div>
    );
    return createPortal(portalChildren, document.body);
  }, [position, overlayStyle, handleSelect]);

  return { handleContextMenu, menuElement, dismiss };
}
