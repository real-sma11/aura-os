import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Text } from "@cypher-asi/zui";
import { Send, MessageCircle, MessageSquare, Hash, MessagesSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../../../../api/client";
import type { Agent } from "../../../../shared/types";
import {
  TelegramConnect,
  telegramChannelsQueryKey,
} from "../../components/TelegramConnect";
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

  // This tab owns the single polling observer for the agent's channels and
  // feeds the data down to <TelegramConnect> so there is exactly ONE poller
  // per surface (two independent observers on the same key caused the
  // sidekick re-render jank). Options mirror TelegramConnect's: keep previous
  // data across polls, no retry storms, no window-focus refetch, and a slow
  // backoff while the endpoint is erroring.
  const channelsQuery = useQuery({
    queryKey: telegramChannelsQueryKey(agent.agent_id),
    queryFn: () => api.channels.listChannels(agent.agent_id),
    enabled: isRemote,
    placeholderData: keepPreviousData,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      if (query.state.status === "error") return 15_000;
      const channels = query.state.data?.channels ?? [];
      const hasConnected = channels.some(
        (c) => c.kind === "telegram" && c.status === "connected",
      );
      return hasConnected ? false : 3_000;
    },
  });

  const channels = channelsQuery.data?.channels ?? [];
  const telegramConnected = channels.some(
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
          <TelegramConnect
            agent={agent}
            channels={channels}
            onChanged={() => {
              void channelsQuery.refetch();
            }}
          />
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
