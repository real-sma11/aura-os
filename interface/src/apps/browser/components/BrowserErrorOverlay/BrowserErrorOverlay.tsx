import { useMemo, useState } from "react";
import { Button } from "@cypher-asi/zui";
import type { NavError } from "../../../../shared/api/browser";
import styles from "./BrowserErrorOverlay.module.css";

export interface BrowserErrorOverlayProps {
  error: NavError;
  /**
   * Invoked when the user clicks "Ask Agent". When omitted the button is
   * rendered disabled so hosts that don't expose an agent surface don't
   * ship a dead control.
   */
  onAskAgent?: (error: NavError) => void;
  /**
   * Invoked when the user clicks "Reload". Hides the button when absent.
   */
  onReload?: () => void;
}

/**
 * Derive a user-friendly host label from a possibly-malformed URL.
 *
 * We mirror Chrome's error page, which shows the host the user intended
 * to reach even if the URL fails to parse. Falls back to the whole URL
 * string so we never render "unknown".
 */
function hostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * Translate an error payload into a short headline suitable for the
 * overlay title. HTTP failures synthesized from main-frame 4xx/5xx
 * responses get tailored copy keyed off `http_status`; everything else
 * falls through to the existing Chromium `net::ERR_*` mapping.
 */
function headlineFor(errorText: string, httpStatus: number | null): string {
  if (httpStatus !== null) {
    if (httpStatus === 404) return "This page can't be found";
    if (httpStatus >= 500) return "The server returned an error";
    if (httpStatus >= 400) return "This page can't be loaded";
  }
  const key = errorText.replace(/^net::/, "");
  switch (key) {
    case "ERR_NAME_NOT_RESOLVED":
    case "ERR_NAME_RESOLUTION_FAILED":
    case "ERR_INTERNET_DISCONNECTED":
    case "ERR_ADDRESS_UNREACHABLE":
    case "ERR_ADDRESS_INVALID":
    case "ERR_CONNECTION_REFUSED":
    case "ERR_CONNECTION_CLOSED":
    case "ERR_CONNECTION_RESET":
    case "ERR_CONNECTION_ABORTED":
    case "ERR_CONNECTION_FAILED":
    case "ERR_CONNECTION_TIMED_OUT":
    case "ERR_TIMED_OUT":
    case "ERR_NETWORK_CHANGED":
      return "Can't connect to server";
    case "ERR_CERT_COMMON_NAME_INVALID":
    case "ERR_CERT_DATE_INVALID":
    case "ERR_CERT_AUTHORITY_INVALID":
    case "ERR_CERT_INVALID":
    case "ERR_CERT_REVOKED":
    case "ERR_SSL_PROTOCOL_ERROR":
      return "Your connection isn't private";
    case "ERR_BLOCKED_BY_CLIENT":
    case "ERR_BLOCKED_BY_RESPONSE":
      return "This page was blocked";
    case "ERR_TOO_MANY_REDIRECTS":
      return "Too many redirects";
    case "ERR_EMPTY_RESPONSE":
      return "The server didn't send any data";
    case "ERR_HTTP_RESPONSE_CODE_FAILURE":
      return "The server returned an error";
    case "ERR_ABORTED":
      return "Page load was cancelled";
    default:
      return "Can't load page";
  }
}

function subtitleFor(error: NavError): string {
  const host = hostLabel(error.url);
  // Prefer the HTTP status when present so the parenthetical reads
  // `(404)` instead of the Chromium `net_error` numeric `(-379)`.
  const numeric =
    typeof error.http_status === "number"
      ? error.http_status
      : typeof error.code === "number"
        ? error.code
        : null;
  const codeSuffix = numeric !== null ? ` (${numeric})` : "";
  return `Could not reach ${host}.${codeSuffix}`;
}

export function BrowserErrorOverlay({
  error,
  onAskAgent,
  onReload,
}: BrowserErrorOverlayProps) {
  const [showDetails, setShowDetails] = useState(false);

  const httpStatus =
    typeof error.http_status === "number" ? error.http_status : null;
  const headline = useMemo(
    () => headlineFor(error.error_text, httpStatus),
    [error.error_text, httpStatus],
  );
  const subtitle = useMemo(() => subtitleFor(error), [error]);

  return (
    <div
      className={styles.root}
      role="alert"
      aria-live="polite"
      data-testid="browser-error-overlay"
    >
      <div className={styles.content}>
        <h1 className={styles.title}>{headline}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAskAgent?.(error)}
            disabled={!onAskAgent}
          >
            Ask Agent
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
          >
            {showDetails ? "Hide Details" : "Show Details"}
          </Button>
          {onReload && (
            <Button variant="primary" size="sm" onClick={onReload}>
              Reload
            </Button>
          )}
        </div>
        {showDetails && (
          <dl className={styles.details}>
            <div className={styles.detailsRow}>
              <dt>URL</dt>
              <dd>{error.url}</dd>
            </div>
            <div className={styles.detailsRow}>
              <dt>Error</dt>
              <dd>{error.error_text}</dd>
            </div>
            {typeof error.code === "number" && (
              <div className={styles.detailsRow}>
                <dt>Code</dt>
                <dd>{error.code}</dd>
              </div>
            )}
            {httpStatus !== null && (
              <div className={styles.detailsRow}>
                <dt>HTTP</dt>
                <dd>{httpStatus}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}
