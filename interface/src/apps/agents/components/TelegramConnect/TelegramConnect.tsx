import { useCallback, useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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
import { telegramChannelsQueryKey } from "./query-key";
import styles from "./TelegramConnect.module.css";

export interface TelegramConnectProps {
  agent: Agent;
  /** Tightens spacing for placement under the profile card. */
  compact?: boolean;
  /**
   * When provided, the PARENT owns the channels query and this component does
   * not start its own polling observer. This prevents the same `["channels",
   * agentId]` key from being polled by two observers at once (MessagingTab +
   * this component), which caused redundant refetches and re-render jank.
   */
  channels?: ChannelSummary[];
  /** Ask the query owner to refetch (used when this component is parent-managed). */
  onChanged?: () => void;
}

const POLL_INTERVAL_MS = 3_000;
/** Slow cadence used when the endpoint is erroring (e.g. server not yet
 * rebuilt with the channels routes) so a missing/unreachable endpoint never
 * turns into a 3s retry storm that re-renders the whole sidekick. */
const ERROR_BACKOFF_MS = 15_000;

export function TelegramConnect({
  agent,
  compact = false,
  channels: externalChannels,
  onChanged,
}: TelegramConnectProps) {
  const isRemote = agent.machine_type === "remote";
  const agentId = agent.agent_id;
  // When the parent injects `channels`, it owns the polling; we stay passive.
  const parentManaged = externalChannels !== undefined;

  const [link, setLink] = useState<TelegramLinkResult | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const internalQuery = useQuery({
    queryKey: telegramChannelsQueryKey(agentId),
    queryFn: () => api.channels.listChannels(agentId),
    enabled: isRemote && !parentManaged,
    // Keep the last good data on the screen across refetches so rows never
    // flicker to an empty/loading state mid-poll (a source of layout jank).
    placeholderData: keepPreviousData,
    // A failing poll should not fan out into retries; the interval already
    // re-attempts on its own cadence.
    retry: false,
    // Opening the Telegram deep link steals focus; don't let regaining it
    // trigger an extra refetch + re-render.
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      if (query.state.status === "error") return ERROR_BACKOFF_MS;
      const channels = query.state.data?.channels ?? [];
      const hasConnected = channels.some(
        (c) => c.kind === "telegram" && c.status === "connected",
      );
      return hasConnected ? false : POLL_INTERVAL_MS;
    },
  });

  const channels = externalChannels ?? internalQuery.data?.channels;

  const telegramChannel = useMemo<ChannelSummary | null>(
    () => (channels ?? []).find((c) => c.kind === "telegram") ?? null,
    [channels],
  );

  const isConnected = telegramChannel?.status === "connected";
  const needsRelink = telegramChannel?.status === "needs_relink";

  const refreshChannels = useCallback(async () => {
    if (parentManaged) {
      onChanged?.();
    } else {
      await internalQuery.refetch();
    }
  }, [parentManaged, onChanged, internalQuery]);

  const startLink = useCallback(async () => {
    setLinking(true);
    setLinkError(null);
    try {
      const res = await api.channels.linkTelegram(agentId);
      setLink(res);
      // Best-effort: pop Telegram on the same device. Never let a blocked
      // popup throw into the connect flow.
      try {
        window.open(res.deep_link, "_blank", "noopener,noreferrer");
      } catch {
        /* popup blocked — the QR below still works */
      }
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
      await refreshChannels();
    } catch (err) {
      setLinkError(getApiErrorMessage(err));
    } finally {
      setDisconnecting(false);
    }
  }, [agentId, refreshChannels, telegramChannel]);

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
      <div className={styles.connectRow}>
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

        <Button
          variant="primary"
          size="sm"
          onClick={startLink}
          disabled={linking}
          className={styles.connectButton}
        >
          {linking ? (
            <span className={styles.btnInner}>
              <Loader2 size={14} className={styles.spin} />
              Generating link…
            </span>
          ) : needsRelink ? (
            "Reconnect"
          ) : (
            "Connect"
          )}
        </Button>
      </div>

      {needsRelink && (
        <Text size="xs" variant="muted">
          This connection expired. Reconnect to keep messaging this agent.
        </Text>
      )}

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
