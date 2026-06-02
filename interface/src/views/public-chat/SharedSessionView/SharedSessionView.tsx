import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LLMOutput } from "../../../apps/chat/components/LLMOutput";
import {
  ShareNotFoundError,
  getPublicShare,
  isValidShareToken,
} from "../../../shared/api/shares";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import { buildDisplayEvents } from "../../../utils/build-display-messages";
import styles from "./SharedSessionView.module.css";

/**
 * Read-only viewer for a public `/s/:shareToken` conversation.
 *
 * Reads the `:shareToken` route param, validates its `t_<32hex>` shape,
 * fetches the transcript from the PUBLIC `GET /api/public/share/:token`
 * endpoint (no auth header — see `getPublicShare`), and renders the
 * turns through the same `LLMOutput` path the live chat uses so a shared
 * conversation reads consistently. There is no action row, no input bar,
 * and no regenerate — this surface is strictly read-only.
 *
 * The view reads its param itself via the router hook, so it takes no
 * props and can be mounted unchanged inside either the public-mode shell
 * (`PublicMarketingPanel`) or the authenticated `AuraShell`.
 */
type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly events: DisplaySessionEvent[] }
  | { readonly status: "not-found" }
  | { readonly status: "error" };

export function SharedSessionView(): React.ReactElement {
  const { shareToken } = useParams<{ shareToken: string }>();
  const token = shareToken ?? "";

  return (
    <section className={styles.root} aria-label="Shared conversation">
      <div className={styles.column}>
        {isValidShareToken(token) ? (
          // Key on the token so a navigation between two share links
          // remounts the loader with a fresh `loading` state instead of
          // synchronously resetting state inside an effect.
          <SharedSessionLoader key={token} token={token} />
        ) : (
          <ShareMessage
            heading="This share link is unavailable"
            body="The conversation may have been unshared or the link is incorrect."
          />
        )}
      </div>
    </section>
  );
}

function SharedSessionLoader({
  token,
}: {
  token: string;
}): React.ReactElement {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void getPublicShare(token)
      .then((events) => {
        if (!active) return;
        setState({ status: "ready", events: buildDisplayEvents(events) });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(
          error instanceof ShareNotFoundError
            ? { status: "not-found" }
            : { status: "error" },
        );
      });

    return () => {
      active = false;
    };
  }, [token]);

  return <SharedSessionContent state={state} />;
}

function SharedSessionContent({
  state,
}: {
  state: LoadState;
}): React.ReactElement {
  if (state.status === "loading") {
    return (
      <p className={styles.status} role="status" aria-live="polite">
        Loading shared conversation…
      </p>
    );
  }

  if (state.status === "not-found") {
    return (
      <ShareMessage
        heading="This share link is unavailable"
        body="The conversation may have been unshared or the link is incorrect."
      />
    );
  }

  if (state.status === "error") {
    return (
      <ShareMessage
        heading="Something went wrong"
        body="We couldn't load this shared conversation. Please try again later."
      />
    );
  }

  if (state.events.length === 0) {
    return (
      <ShareMessage
        heading="This conversation is empty"
        body="There are no messages to show in this shared conversation."
      />
    );
  }

  return (
    <>
      {state.events.map((event) => (
        <SharedTranscriptTurn key={event.clientId ?? event.id} event={event} />
      ))}
    </>
  );
}

function ShareMessage({
  heading,
  body,
}: {
  heading: string;
  body: string;
}): React.ReactElement {
  return (
    <div className={styles.emptyState} role="status">
      <h1 className={styles.heading}>{heading}</h1>
      <p className={styles.status}>{body}</p>
    </div>
  );
}

function SharedTranscriptTurn({
  event,
}: {
  event: DisplaySessionEvent;
}): React.ReactElement {
  const isUser = event.role === "user";
  const rowClass = isUser
    ? `${styles.row} ${styles.rowUser}`
    : `${styles.row} ${styles.rowAssistant}`;

  return (
    <div className={rowClass}>
      <div className={styles.bubble}>
        {isUser ? (
          event.content
        ) : (
          <LLMOutput
            content={event.content}
            timeline={event.timeline}
            toolCalls={event.toolCalls}
            thinkingText={event.thinkingText}
            thinkingDurationMs={event.thinkingDurationMs}
            artifactRefs={event.artifactRefs}
            isStreaming={false}
            className={styles.assistantOutput}
          />
        )}
      </div>
    </div>
  );
}
