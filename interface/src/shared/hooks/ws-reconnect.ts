export interface ReconnectConfig {
  /**
   * The WebSocket URL. May be a function so callers can recompute it on
   * every (re)connect attempt — e.g. to append a `?since=<seq>` cursor
   * that reflects the newest event processed before the disconnect.
   */
  url: string | (() => string);
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export function createReconnectingWebSocket(
  config: ReconnectConfig,
  onMessage: (data: string) => void,
  onStatusChange: (connected: boolean) => void,
): { close: () => void } {
  let ws: WebSocket | null = null;
  let delay = config.initialDelay;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (stopped) return;
    try {
      const url = typeof config.url === "function" ? config.url() : config.url;
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      delay = config.initialDelay;
      onStatusChange(true);
    };

    ws.onmessage = (event) => {
      onMessage(event.data);
    };

    ws.onclose = () => {
      onStatusChange(false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      onStatusChange(false);
      ws?.close();
    };
  }

  function scheduleReconnect() {
    if (stopped) return;
    reconnectTimer = setTimeout(() => {
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
      connect();
    }, delay);
  }

  connect();

  return {
    close() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
