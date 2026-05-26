import type { ReactElement } from "react";
import { Avatar } from "../../Avatar";
import { PlanBadge, type PaidPlan } from "./PlanBadge";
import styles from "./ProfilePill.module.css";

export type ProfilePlan = PaidPlan | "mortal";

export type ProfilePillProps = {
  name: string;
  avatarUrl?: string;
  onOpenSettings: () => void;
  /**
   * Subscription tier driving the trailing `<PlanBadge />`. Anything
   * that isn't a paid plan (`mortal`, `undefined`) renders no badge.
   */
  plan?: ProfilePlan;
};

const PAID_PLANS: readonly PaidPlan[] = ["pro", "crusader", "sage"];

function isPaidPlan(plan: ProfilePlan | undefined): plan is PaidPlan {
  return plan !== undefined && (PAID_PLANS as readonly string[]).includes(plan);
}

export function ProfilePill({
  name,
  avatarUrl,
  onOpenSettings,
  plan,
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
      {isPaidPlan(plan) && <PlanBadge plan={plan} />}
    </button>
  );
}
