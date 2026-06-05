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

// The Telegram bridge (poller + link store) is a single authority on the prod
// control-plane, so these calls must target it even on desktop, where the
// general host is the bundled local server. `useControlPlane` routes them to
// the cloud origin (see `resolveControlPlaneUrl`).
export const channelsApi = {
  linkTelegram: (agentId: string) =>
    apiFetch<TelegramLinkResult>(
      `/api/agents/${agentId}/channels/telegram/link`,
      { method: "POST", useControlPlane: true },
    ),

  listChannels: (agentId: string) =>
    apiFetch<{ channels: ChannelSummary[] }>(
      `/api/agents/${agentId}/channels`,
      { useControlPlane: true },
    ),

  disconnectChannel: (agentId: string, channelId: string) =>
    apiFetch<{ ok: boolean }>(
      `/api/agents/${agentId}/channels/${encodeURIComponent(channelId)}`,
      { method: "DELETE", useControlPlane: true },
    ),
}
