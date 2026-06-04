use aura_os_core::AgentPermissions;
use aura_os_network::NetworkAgent;

use super::super::agent_from_network;

fn blank_network_agent(name: &str, role: Option<&str>) -> NetworkAgent {
    NetworkAgent {
        id: "00000000-0000-0000-0000-000000000001".to_string(),
        name: name.to_string(),
        role: role.map(|s| s.to_string()),
        personality: None,
        system_prompt: None,
        skills: None,
        icon: None,
        harness: None,
        machine_type: None,
        vm_id: None,
        wallet_address: None,
        user_id: "user-1".to_string(),
        org_id: None,
        profile_id: None,
        tags: None,
        listing_status: None,
        expertise: None,
        jobs: None,
        revenue_usd: None,
        reputation: None,
        permissions: AgentPermissions::default(),
        intent_classifier: None,
        created_at: None,
        updated_at: None,
    }
}

#[test]
fn agent_from_network_fills_ceo_preset_when_permissions_missing() {
    // Regression: older aura-network deployments didn't persist the
    // `permissions` column, so a CEO record round-tripped with an
    // empty bundle. The read-time safety net must restore the CEO
    // preset so `is_ceo_preset()`-gated callers behave correctly.
    let net = blank_network_agent("CEO", Some("CEO"));
    assert!(
        !net.permissions.is_ceo_preset(),
        "precondition: network record is not yet the preset"
    );

    let agent = agent_from_network(&net);

    assert!(
        agent.permissions.is_ceo_preset(),
        "empty CEO bundles are repaired to the canonical preset"
    );
    // CEO agents no longer ship an IntentClassifierSpec — the
    // read-time repair path preserves whatever the network record
    // carries (typically `None`) rather than synthesising the old
    // canonical classifier. See CEO_CORE_TOOLS for the rationale.
    assert!(
        agent.intent_classifier.is_none(),
        "read-time repair no longer fills a canonical classifier"
    );
}

#[test]
fn agent_from_network_ceo_preset_matches_case_insensitively() {
    // Historical CEO records may have lowercase / mixed-case name or
    // role fields. The safety net mirrors the case-insensitive
    // matching in `looks_like_ceo`.
    let net = blank_network_agent("ceo", Some("ceo"));
    let agent = agent_from_network(&net);
    assert!(agent.permissions.is_ceo_preset());
}

#[test]
fn agent_from_network_leaves_non_ceo_empty_permissions_alone() {
    // Only the CEO is upgraded by the read-time safety net; agents whose
    // `(name, role)` doesn't match the strict CEO identity keep their empty
    // bundle so the Permissions tab stays the single source of truth for what
    // they're allowed to do.
    let cases = vec![
        blank_network_agent("CEO", Some("Coach")),
        blank_network_agent("Eve", Some("CEO")),
        blank_network_agent("Regular", None),
    ];
    for net in cases {
        let agent = agent_from_network(&net);
        assert!(
            !agent.permissions.is_ceo_preset(),
            "non-CEO records must not be promoted to the preset"
        );
        assert!(
            agent.permissions.capabilities.is_empty(),
            "non-CEO records keep their persisted (empty) capability set"
        );
        assert!(
            agent.intent_classifier.is_none(),
            "no classifier should be synthesized for non-CEO agents"
        );
    }
}

#[test]
fn wallet_address_survives_both_serde_boundaries_and_the_conversion() {
    // The agent's on-chain wallet (set by aura-network from the zOS
    // provisioning call) must cross two serde boundaries without being
    // dropped: aura-network emits camelCase `walletAddress` (its Agent model
    // is `rename_all = "camelCase"`), and the server re-serializes the core
    // Agent as snake_case `wallet_address` for the frontend. Pin both wire
    // keys so a future rename can't silently break the chain.
    const ADDR: &str = "0x94695c64F52cCFc7a6dC2Ea68Af41A82C5E7412f";
    let mut net = blank_network_agent("Atlas", Some("Engineer"));
    net.wallet_address = Some(ADDR.to_string());

    // NetworkAgent's wire key is camelCase (matches aura-network) and round-trips.
    let net_json = serde_json::to_value(&net).expect("serialize NetworkAgent");
    assert_eq!(
        net_json["walletAddress"], ADDR,
        "NetworkAgent uses camelCase on the wire"
    );
    let net: NetworkAgent = serde_json::from_value(net_json).expect("round-trip NetworkAgent");

    // The conversion carries it onto the core Agent...
    let agent = agent_from_network(&net);
    assert_eq!(agent.wallet_address.as_deref(), Some(ADDR));

    // ...which serializes the snake_case key the frontend reads.
    let agent_json = serde_json::to_value(&agent).expect("serialize core Agent");
    assert_eq!(
        agent_json["wallet_address"], ADDR,
        "core Agent uses snake_case for the frontend"
    );

    // Absent (and not a stray key) on records without a provisioned wallet.
    let bare = agent_from_network(&blank_network_agent("Bare", None));
    assert_eq!(bare.wallet_address, None);
}

#[test]
fn agent_from_network_preserves_existing_ceo_preset() {
    // When aura-network *does* persist the preset, the safety net is
    // a no-op and must not churn the intent classifier either.
    let mut net = blank_network_agent("CEO", Some("CEO"));
    net.permissions = AgentPermissions::ceo_preset();

    let agent = agent_from_network(&net);

    assert!(agent.permissions.is_ceo_preset());
    assert!(
        agent.intent_classifier.is_none(),
        "preserved-preset path doesn't synthesize a classifier on its own"
    );
}
