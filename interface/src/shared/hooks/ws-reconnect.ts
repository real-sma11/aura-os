export interface ReconnectConfig {
  /**
   * The WebSocket URL. May be a function so callers can recompute it on
   * every (re)connect attempt — e.g. to append a `?since=<seq>` cursor
   * that reflects the newest event processed before the disconnect, or
   * to mint a fresh short-lived `?ticket=` (see `mintWsTicket`) so the
   * long-lived JWT never appears in the URL. The function may be async
   * for that reason.
   */
  url: string | (() => string | Promise<string>);
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

  function openSocket(url: string) {
    // The URL may have been resolved asynchronously (e.g. while minting
    // a connect ticket); bail if the consumer closed us in the meantime.
    if (stopped) return;
    try {
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

  function connect() {
    if (stopped) return;
    let resolved: string | Promise<string>;
    try {
      resolved = typeof config.url === "function" ? config.url() : config.url;
    } catch {
      scheduleReconnect();
      return;
    }
    // Keep the synchronous path synchronous (string / sync-function
    // URLs open the socket immediately); only defer when the builder is
    // genuinely async (ticket minting).
    if (typeof resolved === "string") {
      openSocket(resolved);
    } else {
      resolved.then(openSocket).catch(() => scheduleReconnect());
    }
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
