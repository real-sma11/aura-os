import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Text, Button } from "@cypher-asi/zui";
import { Send, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../../../../api/client";
import { ApiClientError } from "../../../../shared/api/core";
import { getApiErrorMessage } from "../../../../shared/utils/api-errors";
import type {
  ChannelSummary,
  TelegramLinkResult,
} from "../../../../shared/api/channels";
import type { Agent } from "../../../../shared/types";
import styles from "./TelegramConnect.module.css";

export interface TelegramConnectProps {
  agent: Agent;
  /** Tightens spacing for placement under the profile card. */
  compact?: boolean;
}

const POLL_INTERVAL_MS = 3_000;

export function TelegramConnect({ agent, compact = false }: TelegramConnectProps) {
  const isRemote = agent.machine_type === "remote";
  const agentId = agent.agent_id;

  const [link, setLink] = useState<TelegramLinkResult | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const channelsQuery = useQuery({
    queryKey: ["channels", agentId],
    queryFn: () => api.channels.listChannels(agentId),
    enabled: isRemote,
    // Keep polling while we don't yet have a connected telegram channel so a
    // scan/deep-link completion on the phone flips the UI without a reload.
    refetchInterval: (query) => {
      const channels = query.state.data?.channels ?? [];
      const hasConnected = channels.some(
        (c) => c.kind === "telegram" && c.status === "connected",
      );
      return hasConnected ? false : POLL_INTERVAL_MS;
    },
  });

  const telegramChannel = useMemo<ChannelSummary | null>(() => {
    const channels = channelsQuery.data?.channels ?? [];
    return channels.find((c) => c.kind === "telegram") ?? null;
  }, [channelsQuery.data]);

  const isConnected = telegramChannel?.status === "connected";
  const needsRelink = telegramChannel?.status === "needs_relink";

  const startLink = useCallback(async () => {
    setLinking(true);
    setLinkError(null);
    try {
      const res = await api.channels.linkTelegram(agentId);
      setLink(res);
      window.open(res.deep_link, "_blank");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 503) {
        setLinkError(
          "Telegram bot isn't configured on this server yet. Ask an admin to set it up.",
        );
      } else {
        setLinkError(getApiErrorMessage(err));
      }
    } finally {
      setLinking(false);
    }
  }, [agentId]);

  const disconnect = useCallback(async () => {
    if (!telegramChannel) return;
    setDisconnecting(true);
    try {
      await api.channels.disconnectChannel(agentId, telegramChannel.channel_id);
      setLink(null);
      await channelsQuery.refetch();
    } catch (err) {
      setLinkError(getApiErrorMessage(err));
    } finally {
      setDisconnecting(false);
    }
  }, [agentId, channelsQuery, telegramChannel]);

  const rootClass = compact
    ? `${styles.root} ${styles.compact}`
    : styles.root;

  if (!isRemote) {
    return (
      <div className={rootClass} data-telegram-connect="disabled">
        <div className={styles.header}>
          <Send size={16} className={styles.brandIcon} />
          <Text size="sm" weight="medium">Telegram</Text>
        </div>
        <Text size="xs" variant="muted">Available for remote agents only</Text>
      </div>
    );
  }

  if (isConnected && telegramChannel) {
    return (
      <div className={rootClass} data-telegram-connect="connected">
        <div className={styles.header}>
          <Send size={16} className={styles.brandIcon} />
          <Text size="sm" weight="medium">Telegram</Text>
          <span className={styles.connectedPill}>
            <CheckCircle2 size={12} />
            Connected
          </span>
        </div>
        <Text size="xs" variant="muted" className={styles.chatId}>
          Chat {telegramChannel.chat_id}
        </Text>
        {linkError && (
          <Text size="xs" className={styles.errorText}>{linkError}</Text>
        )}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="sm"
            onClick={disconnect}
            disabled={disconnecting}
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass} data-telegram-connect="connect">
      <div className={styles.header}>
        <Send size={16} className={styles.brandIcon} />
        <Text size="sm" weight="medium">Telegram</Text>
        {needsRelink && (
          <span className={styles.relinkPill}>
            <AlertTriangle size={12} />
            Needs reconnect
          </span>
        )}
      </div>

      {needsRelink && (
        <Text size="xs" variant="muted">
          This connection expired. Reconnect to keep messaging this agent.
        </Text>
      )}

      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          onClick={startLink}
          disabled={linking}
        >
          {linking ? (
            <span className={styles.btnInner}>
              <Loader2 size={14} className={styles.spin} />
              Generating link…
            </span>
          ) : needsRelink ? (
            "Reconnect"
          ) : (
            "Connect to Telegram"
          )}
        </Button>
      </div>

      {linkError && (
        <Text size="xs" className={styles.errorText}>{linkError}</Text>
      )}

      {link && (
        <div className={styles.qrBlock}>
          <div className={styles.qrFrame}>
            <QRCodeSVG value={link.deep_link} size={compact ? 120 : 148} />
          </div>
          <Text size="xs" variant="muted" className={styles.qrCaption}>
            Scan to connect from your phone
          </Text>
          <span className={styles.waiting}>
            <Loader2 size={12} className={styles.spin} />
            Waiting for confirmation…
          </span>
        </div>
      )}
    </div>
  );
}
