import { PanelLeft } from "lucide-react";
import { Button } from "@cypher-asi/zui";
import styles from "./AuraShell.module.css";

/**
 * The shared `<PanelLeft />` drawer toggle. Mirrors the right-side
 * sidekick toggle in `WindowControls.tsx` 1:1 so the two drawers feel
 * like a symmetric affordance pair — same ZUI `Button` props, same
 * `aria-pressed` contract (open=true, collapsed=false), and the same
 * `[aria-pressed="true"]` neutral-text override defined in
 * `AuraShell.module.css` under `.publicSidebarToggle`. The class name
 * is shared (and therefore "public" in name only) because the styling
 * rule is identical regardless of which collapse state field the
 * caller is bound to.
 *
 * Extracted into its own module (rather than living in `AuraTitlebar`)
 * so the public bottom taskbar can reuse it without pulling in the
 * titlebar's heavy dependency chain.
 */
export function SidebarDrawerToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <Button
      variant="ghost"
      size="sm"
      rounded="md"
      iconOnly
      selected={!collapsed}
      title="Toggle sidebar"
      aria-label="Toggle sidebar"
      aria-pressed={!collapsed}
      className={styles.publicSidebarToggle}
      onClick={onToggle}
    >
      <PanelLeft size={14} strokeWidth={2} />
    </Button>
  );
}
