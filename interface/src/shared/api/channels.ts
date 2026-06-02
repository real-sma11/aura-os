import { apiFetch } from "./core"

export interface TelegramLinkResult {
  code: string
  deep_link: string
  bot_username: string
}

export type ChannelStatus = "connected" | "needs_relink"

export interface ChannelSummary {
  channel_id: string
  kind: string
  chat_id: string
  status: ChannelStatus
  created_at: string
}

export const channelsApi = {
  linkTelegram: (agentId: string) =>
    apiFetch<TelegramLinkResult>(
      `/api/agents/${agentId}/channels/telegram/link`,
      { method: "POST" },
    ),

  listChannels: (agentId: string) =>
    apiFetch<{ channels: ChannelSummary[] }>(
      `/api/agents/${agentId}/channels`,
    ),

  disconnectChannel: (agentId: string, channelId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/agents/${agentId}/channels/${encodeURIComponent(channelId)}`,
      { method: "DELETE" },
    ),
}
