import { Button, useTheme } from "@cypher-asi/zui";
import type { CSSProperties } from "react";
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
  splitScreenActive: boolean;
  onToggleSplitScreen?: () => void;
  onOpenHostSettings: () => void;
}

export function DesktopTitlebar({
  sidekickCollapsed,
  onToggleSidekick,
  splitScreenActive,
  onToggleSplitScreen,
  onOpenHostSettings,
}: DesktopTitlebarProps) {
  const { features } = useAuraCapabilities();
  const { resolvedTheme } = useTheme();
  const { color: logoColor, pulseEnabled, pulseMode, pulseSpeed, pulseFromColor, sweepReversed, pauseDuration } = useDesktopLogoColor();

  const themeDefault = resolvedTheme === "light" ? "#000000" : "#ffffff";
  const toColor = logoColor || themeDefault;
  const fromColor = pulseFromColor || themeDefault;
  const totalDuration = `${pulseSpeed + pauseDuration}s`;

  let logoElement: React.ReactNode;
  if (!pulseEnabled) {
    logoElement = (
      <div
        className={styles.titleLogo}
        role="img"
        aria-label="AURA"
        style={logoColor ? { "--desktop-logo-color": logoColor } as CSSProperties : undefined}
      />
    );
  } else if (pulseMode === "fade") {
    logoElement = (
      <div
        className={styles.titleLogo}
        role="img"
        aria-label="AURA"
        style={{
          "--logo-pulse-from": fromColor,
          "--logo-pulse-to": toColor,
          animation: `aura-logo-fade ${totalDuration} ease-in-out infinite`,
        } as CSSProperties}
      />
    );
  } else {
    const sweepAnim = sweepReversed ? "aura-logo-sweep-rev" : "aura-logo-sweep";
    logoElement = (
      <div className={styles.titleLogoWrapper} role="img" aria-label="AURA">
        <div
          className={styles.titleLogoLayer}
          style={{ "--desktop-logo-color": fromColor } as CSSProperties}
        />
        <div
          className={styles.titleLogoLayer}
          style={{
            "--desktop-logo-color": toColor,
            animation: `${sweepAnim} ${totalDuration} ease-in-out infinite`,
          } as CSSProperties}
        />
      </div>
    );
  }

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
          {logoElement}
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
            splitScreenActive={splitScreenActive}
            onToggleSplitScreen={onToggleSplitScreen}
          />
        </div>
      }
    />
  );
}
