/** Shared react-query key for an agent's messaging channels. Kept in its own
 * module so both the owning tab and the connect component reference the exact
 * same key (a single polling observer per surface) without tripping the
 * react-refresh "only export components" rule. */
export const telegramChannelsQueryKey = (agentId: string) =>
  ["channels", agentId] as const;
