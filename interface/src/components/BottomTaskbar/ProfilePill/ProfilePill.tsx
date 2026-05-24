import type { ReactElement } from "react";
import { Avatar } from "../../Avatar";
import styles from "./ProfilePill.module.css";

export type ProfilePillProps = {
  name: string;
  avatarUrl?: string;
  onOpenSettings: () => void;
};

export function ProfilePill({
  name,
  avatarUrl,
  onOpenSettings,
}: ProfilePillProps): ReactElement {
  return (
    <button
      type="button"
      className={styles.profilePill}
      onClick={onOpenSettings}
      aria-label="Open settings"
      title={name || "Settings"}
    >
      <Avatar type="user" size={24} avatarUrl={avatarUrl} name={name} />
      <span className={styles.name}>{name || "Sign in"}</span>
    </button>
  );
}
