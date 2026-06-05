use thiserror::Error;

/// Errors surfaced by the channels layer.
///
/// Kept deliberately small and string-backed so it can cross the
/// store/transport boundary without leaking foreign error types into the
/// public API.
#[derive(Debug, Error)]
pub enum ChannelError {
    #[error("store error: {0}")]
    Store(String),
    #[error("transport error: {0}")]
    Transport(String),
    #[error("agent error: {0}")]
    Agent(String),
    #[error("not found")]
    NotFound,
    #[error("serde error: {0}")]
    Serde(String),
}

impl From<aura_os_store::StoreError> for ChannelError {
    fn from(error: aura_os_store::StoreError) -> Self {
        ChannelError::Store(error.to_string())
    }
}

impl From<serde_json::Error> for ChannelError {
    fn from(error: serde_json::Error) -> Self {
        ChannelError::Serde(error.to_string())
    }
}
