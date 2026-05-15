//! Shared newtypes and serde shapes for the public-endpoint family.
//!
//! Kept minimal so phase-2 handlers (`chat`, `image`, `video`,
//! `model3d`) all consume the same vocabulary. Everything is
//! `pub(crate)` per the rules-rust public-API discipline.

use std::net::IpAddr;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Stable opaque identifier for a single anonymous browser. Issued by
/// the phase-2 `POST /api/public/setup` handler and embedded into the
/// guest JWT's `sub` claim. Treated as opaque text everywhere — the
/// guest token is the source of truth, this type just gives the
/// codebase a strong-typed handle to it.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct GuestId(pub(crate) String);

impl GuestId {
    /// Borrow the wrapped id as a string slice.
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for GuestId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Per-guest turn counter. Bounded by [`super::PUBLIC_TURN_LIMIT`].
/// Wrapped in a newtype so we never confuse it with the per-IP daily
/// counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct PublicTurnCount(pub(crate) u32);

impl PublicTurnCount {
    pub(crate) const fn zero() -> Self {
        Self(0)
    }

    pub(crate) const fn get(self) -> u32 {
        self.0
    }
}

/// SHA-256(IP) truncated to 16 bytes. Used as the `DashMap` key in the
/// per-IP daily limiter so we never persist or log the raw caller IP.
/// Hex-encoded for tracing via [`Self::to_hex`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct IpHash([u8; 16]);

impl IpHash {
    /// Hash an [`IpAddr`] (v4 or v6) down to a stable 16-byte fingerprint.
    pub(crate) fn from_ip(ip: IpAddr) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(ip.to_string().as_bytes());
        let digest = hasher.finalize();
        let mut bytes = [0u8; 16];
        bytes.copy_from_slice(&digest[..16]);
        Self(bytes)
    }

    /// Lower-hex string for inclusion in tracing fields. Never include
    /// the raw IP in logs — only this hash.
    pub(crate) fn to_hex(self) -> String {
        hex::encode(self.0)
    }
}

/// Which modality a public turn is targeting. Used for tracing in
/// phase 1; phase 2 / 3 handlers branch on this to pick the upstream
/// router proxy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PublicModality {
    Chat,
    Image,
    Video,
    Model3d,
}

impl PublicModality {
    /// Stable lower-snake-case string used in tracing fields.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Image => "image",
            Self::Video => "video",
            Self::Model3d => "model3d",
        }
    }
}

/// Decoded payload of a guest JWT.
///
/// The phase-2 `POST /api/public/setup` handler signs tokens with this
/// shape; the [`crate::state::AuthGuestJwt`] extractor decodes them
/// back. Field names mirror the standard `jsonwebtoken` claim layout
/// (`sub`, `exp`) plus a discriminator [`Self::role`] that
/// `AuthJwt`-protected routes use to reject misuse of guest
/// credentials against authenticated endpoints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct GuestClaims {
    /// Guest id (the same value held by [`GuestId`]).
    pub(crate) sub: String,
    /// Always `"guest"` for tokens issued by the public-setup handler.
    pub(crate) role: String,
    /// Unix-seconds expiry. Required by [`jsonwebtoken::Validation`].
    pub(crate) exp: u64,
}

impl GuestClaims {
    /// Discriminator string the phase-2 setup handler stamps on every
    /// issued token. Centralised here so the `AuthJwt` reject-guest
    /// check and the `AuthGuestJwt` accept check stay in agreement.
    pub(crate) const ROLE: &'static str = "guest";

    /// Borrow the `sub` claim as a typed [`GuestId`] without a clone
    /// at the public API boundary. The interior `String` is still
    /// borrowed.
    pub(crate) fn guest_id(&self) -> GuestId {
        GuestId(self.sub.clone())
    }

    /// True when the token is correctly stamped as a guest token.
    pub(crate) fn is_guest(&self) -> bool {
        self.role == Self::ROLE
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn ip_hash_is_stable_per_ip() {
        let ip = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1));
        assert_eq!(IpHash::from_ip(ip), IpHash::from_ip(ip));
    }

    #[test]
    fn ip_hash_differs_across_ips() {
        let a = IpHash::from_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)));
        let b = IpHash::from_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2)));
        assert_ne!(a, b);
    }

    #[test]
    fn modality_round_trips_via_str() {
        for m in [
            PublicModality::Chat,
            PublicModality::Image,
            PublicModality::Video,
            PublicModality::Model3d,
        ] {
            assert!(!m.as_str().is_empty());
        }
    }

    #[test]
    fn guest_claims_role_matches_constant() {
        let claims = GuestClaims {
            sub: "g-abc".to_string(),
            role: GuestClaims::ROLE.to_string(),
            exp: 0,
        };
        assert!(claims.is_guest());
        assert_eq!(claims.guest_id().as_str(), "g-abc");
    }
}
