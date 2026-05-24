import type { ReactElement } from "react";
import { Avatar } from "../../Avatar";
import styles from "./ProfilePill.module.css";

export type ProfilePillProps = {
  name: string;
  avatarUrl?: string;
  plan?: string;
  onOpenSettings: () => void;
};

export function ProfilePill({
  name,
  avatarUrl,
  plan,
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
      <span className={styles.text}>
        <span className={styles.name}>{name || "Sign in"}</span>
        {plan && <span className={styles.plan}>{plan}</span>}
      </span>
    </button>
  );
}
