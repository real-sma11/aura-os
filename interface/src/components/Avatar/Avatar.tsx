import { useState } from "react";
import { Bot, Building2, User } from "lucide-react";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  avatarUrl?: string;
  name?: string;
  type: "user" | "agent" | "team";
  size: number;
  /** Pre-resolved dot status (e.g. "running", "idle", "error"). */
  status?: string;
  /** When true, dot renders purple regardless of status. */
  isLocal?: boolean;
  /**
   * When true, render a rotating ring around the avatar and pulse the
   * status dot. Wired from the loop-activity store at the call site so
   * the avatar can be a "this entity is actively working" indicator.
   */
  busy?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}

export function Avatar({ avatarUrl, name, type, size, status, isLocal, busy, className, style, onClick }: AvatarProps) {
  const iconSize = Math.round(size * 0.5);
  const isAgent = type === "agent";
  const isTeam = type === "team";
  const [broken, setBroken] = useState(false);
  const showImage = avatarUrl && !broken;
  const fallback = isAgent
    ? <Bot size={iconSize} />
    : isTeam
      ? <Building2 size={iconSize} />
      : <User size={iconSize} />;
  const showDot = !!status || isLocal;

  return (
    <div
      className={`${styles.avatarWrap} ${className ?? ""}`}
      style={{ width: size, height: size, ...style }}
      onClick={onClick}
    >
      <div className={styles.avatar} data-agent={isAgent} data-team={isTeam}>
        {showImage ? (
          <img src={avatarUrl} alt={name ?? type} onError={() => setBroken(true)} />
        ) : (
          fallback
        )}
      </div>
      {busy && (
        <span className={styles.busyRing} aria-hidden="true" data-testid="avatar-busy-ring">
          <svg viewBox="0 0 32 32" className={styles.busyRingSvg}>
            <circle cx="16" cy="16" r="15" />
          </svg>
        </span>
      )}
      {showDot && (
        <span
          className={styles.statusDot}
          data-status={status ?? "idle"}
          data-machine={isLocal ? "local" : undefined}
          data-busy={busy ? "true" : undefined}
        />
      )}
    </div>
  );
}
