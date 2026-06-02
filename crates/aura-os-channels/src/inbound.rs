use async_trait::async_trait;

/// A normalized inbound message lifted off a transport (Telegram, etc.) and
/// handed to the bridge runtime.
///
/// Transport-specific framing (update ids, message ids, entities) is dropped
/// here so the runtime stays platform-agnostic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundMessage {
    /// Platform-native chat id, stringified.
    pub chat_id: String,
    /// The message body. For a `/start <code>` command this is the raw text
    /// as received; consumers should prefer [`InboundMessage::start_payload`].
    pub text: String,
    /// `Some("<code>")` when the message is a `/start <code>` command. The
    /// payload may be an empty string for a bare `/start`.
    pub start_payload: Option<String>,
}

/// Sink for normalized inbound messages.
///
/// A [`crate::ChatConnector`]'s transport loop calls [`InboundHandler::on_message`]
/// for every inbound chat message; the bridge runtime implements this to route
/// the message to the linked agent (or to a linking flow).
#[async_trait]
pub trait InboundHandler: Send + Sync {
    async fn on_message(&self, msg: InboundMessage);
}

/// Parse raw message `text` into the optional `/start` payload.
///
/// Returns `Some(payload)` when `text` is a `/start` command (the payload is
/// the trimmed remainder, possibly empty), otherwise `None`. Pure helper so
/// the parsing rule can be unit-tested without a transport.
pub fn parse_inbound(text: &str) -> Option<String> {
    let trimmed = text.trim_start();
    if let Some(rest) = trimmed.strip_prefix("/start") {
        // Accept "/start", "/start <code>" but not "/startfoo".
        if rest.is_empty() {
            Some(String::new())
        } else if let Some(first) = rest.chars().next() {
            if first.is_whitespace() {
                Some(rest.trim().to_string())
            } else {
                None
            }
        } else {
            Some(String::new())
        }
    } else {
        None
    }
}

/// Build an [`InboundMessage`] from a raw chat id and text, applying the
/// `/start` payload-detection rule via [`parse_inbound`].
pub fn build_inbound(chat_id: impl Into<String>, text: impl Into<String>) -> InboundMessage {
    let text = text.into();
    let start_payload = parse_inbound(&text);
    InboundMessage {
        chat_id: chat_id.into(),
        text,
        start_payload,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_inbound_detects_bare_start() {
        assert_eq!(parse_inbound("/start"), Some(String::new()));
        assert_eq!(parse_inbound("/start "), Some(String::new()));
    }

    #[test]
    fn parse_inbound_extracts_payload() {
        assert_eq!(parse_inbound("/start abc123"), Some("abc123".to_string()));
        assert_eq!(
            parse_inbound("  /start   code-9  "),
            Some("code-9".to_string())
        );
    }

    #[test]
    fn parse_inbound_ignores_non_start() {
        assert_eq!(parse_inbound("hello"), None);
        assert_eq!(parse_inbound("/startfoo"), None);
        assert_eq!(parse_inbound("/help"), None);
    }

    #[test]
    fn build_inbound_sets_payload() {
        let msg = build_inbound("123", "/start xyz");
        assert_eq!(msg.chat_id, "123");
        assert_eq!(msg.text, "/start xyz");
        assert_eq!(msg.start_payload, Some("xyz".to_string()));

        let plain = build_inbound("123", "hi there");
        assert_eq!(plain.start_payload, None);
    }
}
