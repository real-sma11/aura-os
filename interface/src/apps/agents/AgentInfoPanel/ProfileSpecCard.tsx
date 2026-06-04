import { useMemo } from "react";
import type { Agent } from "../../../shared/types";
import { useOrgStore } from "../../../stores/org-store";
import { useRemoteAgentState } from "../../../hooks/use-remote-agent-state";
import { useEnvironmentInfo } from "../../../hooks/use-environment-info";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { BRAND_ICONS } from "./profile-card-texture";
import type { ProfileSectionLink } from "./ProfileCard3D";
import styles from "./AgentInfoPanel.module.css";

/** Shorten an on-chain address for display, e.g. `0x9469…412f`. */
function truncateAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

interface SpecRow {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}

export interface ProfileSpecCardProps {
  agent: Agent;
  sections: ProfileSectionLink[];
}

/**
 * DOM companion to the 3D metal card: a worn-metal-styled panel that carries the
 * detail rows (Organization, IP, Wallet), the messaging-channel logos, and the
 * clickable Skills/Connectors/Permissions navigation that previously lived on
 * the lower part of the WebGL backplate.
 */
export function ProfileSpecCard({ agent, sections }: ProfileSpecCardProps) {
  const orgName = useOrgStore((s) =>
    agent.org_id ? s.orgs.find((o) => o.org_id === agent.org_id)?.name ?? null : null,
  );

  // IP: remote agents expose a VM endpoint; local agents fall back to the host
  // machine IP. Both hooks are called unconditionally (rules of hooks).
  const remote = useRemoteAgentState(
    agent.machine_type === "remote" ? agent.agent_id : undefined,
  );
  const env = useEnvironmentInfo();
  const ip =
    agent.machine_type === "remote"
      ? remote.data?.endpoint ?? null
      : env.data?.ip ?? null;

  const rows = useMemo<SpecRow[]>(() => {
    const list: SpecRow[] = [
      { label: "Organization", value: orgName ?? "—" },
      { label: "IP", value: ip ?? "—", mono: true },
    ];
    if (agent.wallet_address) {
      list.push({
        label: "Wallet",
        value: truncateAddress(agent.wallet_address),
        mono: true,
        title: agent.wallet_address,
      });
    }
    return list;
  }, [orgName, ip, agent.wallet_address]);

  return (
    <div className={styles.specCard}>
      <span className={styles.specCardSheen} aria-hidden="true" />
      <div className={styles.specRows}>
        {rows.map((row) => (
          <div key={row.label} className={styles.specRow}>
            <span className={styles.specLabel}>{row.label}</span>
            <span
              className={`${styles.specValue} ${row.mono ? styles.specValueMono : ""}`}
              title={row.title}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.specChannels} aria-label="Messaging channels">
        {BRAND_ICONS.map((icon) => (
          <svg
            key={icon.name}
            className={styles.specChannelIcon}
            viewBox={`0 0 ${icon.size ?? 24} ${icon.size ?? 24}`}
            role="img"
            aria-label={icon.name}
          >
            <path d={icon.path} fill="currentColor" />
          </svg>
        ))}
      </div>

      <div className={styles.specLinks}>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={styles.specLink}
            onClick={() => useAgentSidekickStore.getState().setActiveTab(section.id)}
          >
            <span className={styles.specLinkLabel}>{section.label}</span>
            <span className={styles.specLinkCount}>{section.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
