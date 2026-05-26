import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { useOrgStore } from "../../stores/org-store";
import { Building2, ChevronDown, Plus, Settings } from "lucide-react";
import { Button, Input, Modal } from "@cypher-asi/zui";
import { useClickOutside } from "../../shared/hooks/use-click-outside";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { Avatar } from "../Avatar";
import styles from "./OrgSelector.module.css";

// Rough per-row height used for the dropdown's flip-up math: avatar
// row padding + line-height of `.item` lands at ~30px. We use this
// to estimate the menu's rendered height before it actually mounts,
// so the first paint already lands in the correct half of the
// viewport when there isn't room below the trigger (e.g. the icon
// variant lives in the bottom taskbar, where opening down would
// clip the menu off-screen).
const DROPDOWN_ITEM_HEIGHT = 30;
const DROPDOWN_DIVIDER_HEIGHT = 9;
const DROPDOWN_VERTICAL_PADDING = 8;
const DROPDOWN_MAX_HEIGHT = 240;
const DROPDOWN_VIEWPORT_BUFFER = 8;

export function OrgSelector({
  variant = "default",
}: {
  variant?: "default" | "drawer" | "icon";
} = {}) {
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const { orgs, activeOrg, switchOrg, createOrg } = useOrgStore(
    useShallow((s) => ({ orgs: s.orgs, activeOrg: s.activeOrg, switchOrg: s.switchOrg, createOrg: s.createOrg })),
  );
  const { inputRef: newNameRef, initialFocusRef, autoFocus } = useModalInitialFocus<HTMLInputElement>();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const iconTriggerRef = useRef<HTMLButtonElement>(null);
  const iconDropdownRef = useRef<HTMLDivElement>(null);

  const isIcon = variant === "icon";
  useClickOutside(
    isIcon ? [iconTriggerRef, iconDropdownRef] : dropdownRef,
    useCallback(() => setDropdownOpen(false), []),
    dropdownOpen,
  );

  // `null` means "not yet positioned" — we gate the portal render
  // on a non-null value so the menu never paints at the default
  // top-left of the viewport for the one frame before the layout
  // effect runs. Mirrors `Select.tsx`'s `pos` gate pattern.
  const [iconDropdownPos, setIconDropdownPos] = useState<{ top: number; left: number } | null>(null);

  // Estimate the dropdown's rendered height from the items it will
  // contain (one row per org + "New Team" + "Team Settings" rows + a
  // divider + the vertical padding from `.dropdown`), capped at the
  // CSS `max-height: 240px`. Used both for the initial-paint
  // placement and for any later reposition triggered by scroll /
  // resize while open.
  const estimateIconDropdownHeight = useCallback((): number => {
    const itemCount = orgs.length + 2; // orgs + "New Team" + "Team Settings"
    const naive =
      itemCount * DROPDOWN_ITEM_HEIGHT +
      DROPDOWN_DIVIDER_HEIGHT +
      DROPDOWN_VERTICAL_PADDING;
    return Math.min(DROPDOWN_MAX_HEIGHT, naive);
  }, [orgs.length]);

  const repositionIconDropdown = useCallback((): void => {
    const triggerRect = iconTriggerRef.current?.getBoundingClientRect();
    if (!triggerRect) return;
    // Prefer the measured DOM height once the dropdown is mounted;
    // fall back to the row-count estimate for the very first paint.
    const measuredHeight = iconDropdownRef.current?.offsetHeight;
    const dropdownHeight = measuredHeight ?? estimateIconDropdownHeight();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    // Open downward when there is room below; otherwise flip above
    // the trigger. Falls back to whichever side has more room when
    // neither side can fit the menu entirely (rare — only on very
    // short viewports). The `max-height: 240px` in the CSS still
    // owns the final scroll behaviour.
    const openDownward =
      spaceBelow >= dropdownHeight + DROPDOWN_VIEWPORT_BUFFER ||
      spaceBelow >= spaceAbove;
    const top = openDownward
      ? triggerRect.bottom
      : Math.max(DROPDOWN_VIEWPORT_BUFFER, triggerRect.top - dropdownHeight);
    setIconDropdownPos({ top, left: triggerRect.left });
  }, [estimateIconDropdownHeight]);

  // Position the menu (and keep it pinned to the trigger if the
  // user scrolls or resizes while it's open) so the icon variant
  // can flip above its trigger when it sits at the bottom of the
  // viewport — e.g. the team selector in the bottom taskbar.
  // Reset position when the menu closes so the next open starts
  // from a clean "not yet positioned" state and re-gates the portal.
  useEffect(() => {
    if (!dropdownOpen || !isIcon) {
      if (iconDropdownPos !== null) setIconDropdownPos(null);
      return;
    }
    repositionIconDropdown();
    window.addEventListener("scroll", repositionIconDropdown, true);
    window.addEventListener("resize", repositionIconDropdown);
    return () => {
      window.removeEventListener("scroll", repositionIconDropdown, true);
      window.removeEventListener("resize", repositionIconDropdown);
    };
    // `iconDropdownPos` is intentionally omitted: this effect owns
    // the lifecycle (compute on open, clear on close) and reading
    // it would cause a redundant re-run after every reposition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropdownOpen, isIcon, repositionIconDropdown]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const org = await createOrg(newName.trim());
      switchOrg(org.org_id);
      setNewName("");
      setShowCreate(false);
    } catch (err) {
      console.error("Failed to create org", err);
    } finally {
      setCreating(false);
    }
  };

  const containerClass =
    variant === "icon"
      ? styles.iconContainer
      : variant === "drawer"
        ? `${styles.container} ${styles.drawerContainer}`
        : styles.container;

  const dropdownClass =
    variant === "icon" ? `${styles.dropdown} ${styles.iconDropdown}` : styles.dropdown;

  const dropdownItems = (
    <>
      {orgs.map((org) => (
        <button
          key={org.org_id}
          type="button"
          className={`${styles.item} ${org.org_id === activeOrg?.org_id ? styles.active : ""}`}
          onClick={() => {
            switchOrg(org.org_id);
            setDropdownOpen(false);
          }}
        >
          <Avatar avatarUrl={org.avatar_url} name={org.name} type="team" size={16} />
          <span>{org.name}</span>
        </button>
      ))}
      <div className={styles.divider} />
      <button
        type="button"
        className={styles.item}
        onClick={() => {
          setDropdownOpen(false);
          setShowCreate(true);
        }}
      >
        <Plus size={12} />
        <span>New Team</span>
      </button>
      <button
        type="button"
        className={styles.item}
        onClick={() => {
          setDropdownOpen(false);
          openOrgSettings();
        }}
      >
        <Settings size={12} />
        <span>Team Settings</span>
      </button>
    </>
  );

  return (
    <div className={containerClass} ref={isIcon ? undefined : dropdownRef} onDoubleClick={isIcon ? (e) => e.stopPropagation() : undefined}>
      {isIcon ? (
        <button
          ref={iconTriggerRef}
          type="button"
          className={styles.iconTrigger}
          onClick={() => setDropdownOpen((v) => !v)}
          title={activeOrg?.name ?? "My Team"}
          aria-label="Switch team"
        >
          <Avatar
            avatarUrl={activeOrg?.avatar_url}
            name={activeOrg?.name ?? "My Team"}
            type="team"
            size={20}
          />
        </button>
      ) : (
        <button
          type="button"
          className={`${styles.trigger} ${variant === "drawer" ? styles.drawerTrigger : ""}`}
          onClick={() => setDropdownOpen((v) => !v)}
        >
          {variant === "drawer" && <Building2 size={14} className={styles.triggerIcon} />}
          <span className={styles.name}>{activeOrg?.name ?? "My Team"}</span>
          <ChevronDown size={12} className={styles.chevron} />
        </button>
      )}

      {dropdownOpen && !isIcon && (
        <div className={dropdownClass}>{dropdownItems}</div>
      )}

      {dropdownOpen && isIcon && iconDropdownPos && createPortal(
        <div
          ref={iconDropdownRef}
          className={dropdownClass}
          style={{ top: iconDropdownPos.top, left: iconDropdownPos.left }}
        >
          {dropdownItems}
        </div>,
        document.body,
      )}

      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Team"
        size="sm"
        initialFocusRef={initialFocusRef}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </>
        }
      >
        <Input
          ref={newNameRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          placeholder="Team name"
          autoFocus={autoFocus}
        />
      </Modal>
    </div>
  );
}
