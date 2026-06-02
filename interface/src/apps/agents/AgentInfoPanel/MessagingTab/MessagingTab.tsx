import { useQuery } from "@tanstack/react-query";
import { Text } from "@cypher-asi/zui";
import { Send, MessageCircle, MessageSquare, Hash, MessagesSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../../../../api/client";
import type { Agent } from "../../../../shared/types";
import { TelegramConnect } from "../../components/TelegramConnect";
import panelStyles from "../AgentInfoPanel.module.css";
import styles from "./MessagingTab.module.css";

interface MessagingTabProps {
  agent: Agent;
}

interface ComingSoonConnector {
  id: string;
  name: string;
  Icon: LucideIcon;
}

const COMING_SOON: ComingSoonConnector[] = [
  { id: "signal", name: "Signal", Icon: MessageCircle },
  { id: "whatsapp", name: "WhatsApp", Icon: MessageSquare },
  { id: "slack", name: "Slack", Icon: MessagesSquare },
  { id: "discord", name: "Discord", Icon: Hash },
];

export function MessagingTab({ agent }: MessagingTabProps) {
  const isRemote = agent.machine_type === "remote";

  // Mirror TelegramConnect's polling so the header chip reflects connection
  // state; react-query dedupes this against the component's own query.
  const channelsQuery = useQuery({
    queryKey: ["channels", agent.agent_id],
    queryFn: () => api.channels.listChannels(agent.agent_id),
    enabled: isRemote,
    refetchInterval: (query) => {
      const channels = query.state.data?.channels ?? [];
      const hasConnected = channels.some(
        (c) => c.kind === "telegram" && c.status === "connected",
      );
      return hasConnected ? false : 3_000;
    },
  });

  const telegramConnected = (channelsQuery.data?.channels ?? []).some(
    (c) => c.kind === "telegram" && c.status === "connected",
  );

  return (
    <>
      <div className={panelStyles.section}>
        <Text size="xs" variant="muted" weight="medium">Connectors</Text>
        <Text size="xs" variant="muted">
          Message this agent from your favorite chat apps.
        </Text>
      </div>

      <div className={styles.connectorList}>
        <div className={styles.connector}>
          <div className={styles.connectorRow}>
            <Send size={16} className={styles.connectorIcon} />
            <span className={styles.connectorName}>Telegram</span>
            <span
              className={`${styles.statusChip} ${
                telegramConnected ? styles.statusConnected : styles.statusAvailable
              }`}
            >
              {telegramConnected ? "Connected" : "Available"}
            </span>
          </div>
          <TelegramConnect agent={agent} />
        </div>

        {COMING_SOON.map(({ id, name, Icon }) => (
          <div key={id} className={`${styles.connector} ${styles.connectorDisabled}`}>
            <div className={styles.connectorRow}>
              <Icon size={16} className={styles.connectorIcon} />
              <span className={styles.connectorName}>{name}</span>
              <span className={`${styles.statusChip} ${styles.statusSoon}`}>
                Coming soon
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
