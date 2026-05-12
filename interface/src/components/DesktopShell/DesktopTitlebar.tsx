import { Button } from "@cypher-asi/zui";
import { Server } from "lucide-react";
import { OrgSelector } from "../OrgSelector";
import { WindowControls } from "../WindowControls";
import { MenuBar } from "../MenuBar";
import { ShellTitlebar } from "../ShellTitlebar";
import { UpdatePill } from "../UpdateBanner";
import { EarnCreditsButton } from "../EarnCreditsButton";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useDesktopLogoColor } from "../../hooks/use-desktop-logo-color";
import styles from "./DesktopShell.module.css";

interface DesktopTitlebarProps {
  sidekickCollapsed: boolean;
  onToggleSidekick: () => void;
  onOpenHostSettings: () => void;
}

export function DesktopTitlebar({
  sidekickCollapsed,
  onToggleSidekick,
  onOpenHostSettings,
}: DesktopTitlebarProps) {
  const { features } = useAuraCapabilities();
  const { color: logoColor } = useDesktopLogoColor();

  return (
    <ShellTitlebar
      icon={
        <span className={`${styles.titleLeading} titlebar-no-drag`}>
          <OrgSelector variant="icon" />
          <MenuBar />
        </span>
      }
      title={
        <span className={`titlebar-center ${styles.titleCenter}`}>
          <div
            className={styles.titleLogo}
            role="img"
            aria-label="AURA"
            style={logoColor ? { ["--desktop-logo-color" as string]: logoColor } : undefined}
          />
        </span>
      }
      actions={
        <div
          className={styles.titleActions}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <UpdatePill />
          {features.hostRetargeting && (
            <Button
              variant="ghost"
              size="sm"
              rounded="md"
              iconOnly
              aria-label="Open host settings"
              onClick={onOpenHostSettings}
            >
              <Server size={14} strokeWidth={2} />
            </Button>
          )}
          <EarnCreditsButton />
          <WindowControls
            sidekickCollapsed={sidekickCollapsed}
            onToggleSidekick={onToggleSidekick}
          />
        </div>
      }
    />
  );
}
