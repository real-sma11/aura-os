//! Permission reconciliation and CEO repair for [`AgentService`].
//!
//! aura-network has historically round-tripped the `permissions`
//! column inconsistently. The helpers here are read-time guards that
//! keep the local shadow honest and rescue the canonical CEO bundle
//! when both sides drop the column.

use aura_os_core::{Agent, AgentId, AgentPermissions};

use super::AgentService;

impl AgentService {
    /// Record the org's canonical CEO `agent_id` for read-time repair.
    ///
    /// Called from `setup_ceo_agent` after every bootstrap so that
    /// [`Self::reconcile_permissions_with_shadow`] can still
    /// recognise this agent as the CEO even after the user renames
    /// it. Best-effort — failures are swallowed because the shadow
    /// remains a cache and the GET-side safety net
    /// ([`AgentPermissions::normalized_for_identity`]) still catches
    /// the common "name+role still CEO/CEO" case.
    pub fn remember_ceo_agent_id(&self, agent_id: &AgentId) {
        let value = agent_id.to_string().into_bytes();
        if let Err(err) = self.store.put_setting(Self::CEO_AGENT_ID_KEY, &value) {
            tracing::warn!(
                agent_id = %agent_id,
                error = %err,
                "failed to persist bootstrapped CEO agent_id"
            );
        }
    }

    /// Read the org's canonical CEO `agent_id`, if one has been
    /// persisted by a prior `setup_ceo_agent` run.
    pub fn bootstrapped_ceo_agent_id(&self) -> Option<AgentId> {
        let bytes = self.store.get_setting(Self::CEO_AGENT_ID_KEY).ok()?;
        let s = std::str::from_utf8(&bytes).ok()?;
        s.parse::<AgentId>().ok()
    }

    /// Read-time counterpart to the PUT-side reconciliation in
    /// `handlers::agents::crud::update_agent`.
    ///
    /// aura-network has historically round-tripped the `permissions`
    /// column inconsistently: the upstream either never persisted it
    /// (older deployments) or silently drops it from the response
    /// JSON on `GET /agents` / `GET /agents/:id`. When that happens,
    /// `network_agent_to_core` / `agent_from_network` produce an
    /// `Agent` whose `permissions` bundle is empty (`capabilities:
    /// []`, universe scope) — and every caller that then writes the
    /// agent through [`Self::save_agent_shadow`] clobbers the
    /// freshly-saved local bundle. That's the "toggles survive the
    /// session but vanish after an app restart" regression.
    ///
    /// This helper repairs the common case: if the freshly-fetched
    /// bundle is empty *and* the local shadow has a non-empty
    /// bundle, adopt the shadow's bundle before persisting or
    /// returning. The PUT side already applies the symmetric "trust
    /// what we just sent" rule when the PUT response fails to echo
    /// the submitted bundle, so both round-trips now treat the local
    /// shadow as the fallback source of truth for `permissions`
    /// whenever aura-network drops the column.
    ///
    /// There is also a last-resort repair for the CEO SuperAgent:
    /// when both the network response *and* the local shadow are
    /// empty (classic "already-corrupted by the pre-fix PUT flow"
    /// scenario) but the agent matches the `agent_id` stamped by
    /// `setup_ceo_agent` via [`Self::remember_ceo_agent_id`], restore
    /// the canonical [`AgentPermissions::ceo_preset`]. This lets
    /// users who renamed their CEO (e.g. to "Orion") recover the
    /// preset without re-running bootstrap.
    ///
    /// Deliberately scoped to `permissions` — every other column on
    /// the network response is still authoritative.
    pub fn reconcile_permissions_with_shadow(&self, agent: &mut Agent) {
        if !agent.permissions.is_empty() {
            // Upstream did round-trip the bundle. If we previously
            // flagged it as broken, the flag is stale — clear it so
            // the safety net can re-engage with fresh diagnostics if
            // the regression ever returns.
            self.clear_upstream_drops_permissions_sentinel();
            return;
        }
        let upstream_known_broken = self.upstream_drops_permissions_sentinel();
        let shadow_permissions = match self.get_agent_local(&agent.agent_id) {
            Ok(s) if !s.permissions.is_empty() => Some(s.permissions),
            _ => None,
        };
        if let Some(shadow) = shadow_permissions {
            // First encounter for this agent this process: log + try
            // to heal upstream. Subsequent encounters still adopt the
            // shadow (correct behavior — the safety net is the
            // contract), but skip the WARN and the PUT to avoid log
            // spam and no-op writes when upstream genuinely cannot
            // persist the column.
            //
            // When the persisted sentinel is set we've already
            // observed (in a prior process) that upstream drops the
            // column on writes too, so skip the per-agent WARN and
            // the doomed PUT entirely. A single boot-time INFO
            // (emitted from `log_upstream_drops_sentinel_once`)
            // summarizes the situation across all agents instead.
            let first_attempt = self.note_permission_heal_attempt(&agent.agent_id);
            if first_attempt && !upstream_known_broken {
                tracing::warn!(
                    agent_id = %agent.agent_id,
                    shadow_capabilities = shadow.capabilities.len(),
                    "aura-network response did not include a `permissions` bundle; using last-known shadow value and scheduling one-shot upstream heal"
                );
                self.try_heal_permissions_upstream(agent.agent_id, shadow.clone());
            } else if upstream_known_broken {
                self.log_upstream_drops_sentinel_once();
            }
            agent.permissions = shadow;
            return;
        }
        // Both sides are empty. Last-resort: if this is the
        // bootstrapped CEO for the org, restore the canonical preset.
        // The `normalized_for_identity` helper on the incoming
        // `NetworkAgent` already handles the "still named CEO"
        // sub-case, so reaching here means the user renamed (common
        // "Orion"-style tweak) *and* their shadow got wiped by the
        // pre-fix PUT flow.
        if let Some(ceo_id) = self.bootstrapped_ceo_agent_id() {
            if ceo_id == agent.agent_id {
                let first_attempt = self.note_permission_heal_attempt(&agent.agent_id);
                if first_attempt && !upstream_known_broken {
                    tracing::warn!(
                        agent_id = %agent.agent_id,
                        "restoring CEO preset from bootstrap-stamped agent_id (both network and shadow had empty permissions); scheduling one-shot upstream heal"
                    );
                    self.try_heal_permissions_upstream(
                        agent.agent_id,
                        AgentPermissions::ceo_preset(),
                    );
                } else if upstream_known_broken {
                    self.log_upstream_drops_sentinel_once();
                }
                agent.permissions = AgentPermissions::ceo_preset();
            }
        }
    }

    /// True iff a prior process observed that aura-network drops the
    /// `permissions` column on its PUT response (the most reliable
    /// detector — see [`Self::PERMISSIONS_UPSTREAM_DROPS_KEY`]).
    fn upstream_drops_permissions_sentinel(&self) -> bool {
        self.store
            .get_setting(Self::PERMISSIONS_UPSTREAM_DROPS_KEY)
            .is_ok()
    }

    /// Clear the "upstream drops `permissions` column" sentinel and
    /// log a one-shot INFO if the sentinel was set. Called from the
    /// non-empty branch of [`Self::reconcile_permissions_with_shadow`]
    /// and from the successful-heal branch of
    /// [`Self::try_heal_permissions_upstream`] so a fixed upstream
    /// rearms the safety net automatically.
    fn clear_upstream_drops_permissions_sentinel(&self) {
        if !self.upstream_drops_permissions_sentinel() {
            return;
        }
        if self
            .store
            .delete_setting(Self::PERMISSIONS_UPSTREAM_DROPS_KEY)
            .is_ok()
        {
            tracing::info!(
                "aura-network now round-trips the `permissions` column; cleared the 'upstream-drops-column' sentinel"
            );
        }
    }

    /// Emit a single boot-time INFO line summarizing that the
    /// permissions safety net is engaged because the persisted
    /// sentinel says upstream drops the column. Subsequent agents in
    /// the same process stay silent — the dedup avoids per-agent
    /// noise that the WARN flow used to produce.
    fn log_upstream_drops_sentinel_once(&self) {
        static SENTINEL_LOGGED: std::sync::atomic::AtomicBool =
            std::sync::atomic::AtomicBool::new(false);
        if !SENTINEL_LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            tracing::info!(
                "aura-network is known (from a prior process) to drop the `permissions` column; serving permissions from the local shadow without scheduling upstream heals. Sentinel auto-clears the next time upstream returns a non-empty bundle."
            );
        }
    }

    /// Atomically record that we've attempted (or are about to
    /// attempt) an upstream permissions heal for `agent_id`. Returns
    /// `true` on the first call for an agent in this process, `false`
    /// on every subsequent call. Callers use the `true` return as the
    /// "log + spawn PUT" trigger; the underlying shadow-adoption keeps
    /// running unconditionally so the in-memory bundle stays correct
    /// even when we've stopped logging / writing.
    pub(super) fn note_permission_heal_attempt(&self, agent_id: &AgentId) -> bool {
        match self.permission_heal_attempted.lock() {
            Ok(mut guard) => guard.insert(*agent_id),
            Err(poisoned) => {
                // Poisoned lock means a prior caller panicked while
                // holding the set. The data structure is still
                // structurally valid (poison is advisory), so we
                // recover and proceed. Treat poison as "first
                // attempt" so the heal still runs once.
                let mut guard = poisoned.into_inner();
                guard.insert(*agent_id)
            }
        }
    }

    /// Best-effort one-shot heal: PUT the supplied `permissions`
    /// bundle back to aura-network so the upstream record stops
    /// returning an empty bundle on subsequent GETs.
    ///
    /// Why this exists: the read-time safety net keeps the in-memory
    /// view correct, but every refresh still observes the same
    /// upstream drift and re-runs the fallback. When aura-network
    /// genuinely persists the column but its serializer omits it on
    /// reads, a single PUT teaches the upstream to round-trip cleanly
    /// from then on. When aura-network doesn't persist the column at
    /// all, the PUT is harmless — the safety net continues handling
    /// every future GET unchanged, and the per-process dedup set in
    /// [`Self::note_permission_heal_attempt`] keeps us from spamming
    /// no-op writes on every poll cycle.
    ///
    /// All paths fail soft: missing network client, missing JWT, or
    /// no active tokio runtime each short-circuit silently. The PUT
    /// itself runs on a detached task so callers (which are usually
    /// already inside a request handler) don't block on it.
    fn try_heal_permissions_upstream(&self, agent_id: AgentId, permissions: AgentPermissions) {
        let Some(client) = self.network_client.clone() else {
            return;
        };
        let Ok(jwt) = self.get_jwt() else {
            tracing::debug!(
                agent_id = %agent_id,
                "skipping upstream permissions heal: no JWT available"
            );
            return;
        };
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            tracing::debug!(
                agent_id = %agent_id,
                "skipping upstream permissions heal: no active tokio runtime"
            );
            return;
        };
        let agent_id_str = agent_id.to_string();
        let submitted_capabilities = permissions.capabilities.len();
        // Clone for the detached task so it can update the persisted
        // "upstream drops the column" sentinel based on the PUT
        // outcome — set on confirmed-empty response, cleared on
        // confirmed round-trip success.
        let store = self.store.clone();
        handle.spawn(async move {
            let req = aura_os_network::UpdateAgentRequest {
                permissions: Some(permissions),
                ..Default::default()
            };
            match client.update_agent(&agent_id_str, &jwt, &req).await {
                Ok(net_agent) if net_agent.permissions.is_empty() => {
                    // Upstream accepted the PUT but its response
                    // didn't echo the bundle. Either the column isn't
                    // persisted or the serializer drops it on both
                    // read and write paths. Either way, future GETs
                    // will keep returning empty and the safety net
                    // will keep filling in from the shadow — but the
                    // dedup set will suppress further PUTs. Persist
                    // the sentinel so subsequent process boots skip
                    // the per-agent WARN + heal-PUT storm entirely.
                    let _ = store.put_setting(Self::PERMISSIONS_UPSTREAM_DROPS_KEY, b"1");
                    tracing::warn!(
                        agent_id = %agent_id_str,
                        submitted_capabilities,
                        "upstream permissions heal PUT returned an empty `permissions` bundle; aura-network appears to drop the column on writes too (persisted sentinel will silence per-agent heals on next boot)"
                    );
                }
                Ok(_) => {
                    // Upstream did round-trip the bundle — clear any
                    // stale sentinel from a prior broken deployment
                    // so we don't keep suppressing diagnostics if the
                    // regression returns.
                    if store
                        .get_setting(Self::PERMISSIONS_UPSTREAM_DROPS_KEY)
                        .is_ok()
                    {
                        let _ = store.delete_setting(Self::PERMISSIONS_UPSTREAM_DROPS_KEY);
                        tracing::info!(
                            agent_id = %agent_id_str,
                            "upstream permissions heal PUT succeeded and round-tripped the bundle; cleared the 'upstream-drops-column' sentinel"
                        );
                    }
                    tracing::info!(
                        agent_id = %agent_id_str,
                        submitted_capabilities,
                        "upstream permissions heal PUT succeeded; aura-network should now round-trip the bundle on subsequent GETs"
                    );
                }
                Err(err) => {
                    tracing::warn!(
                        agent_id = %agent_id_str,
                        error = %err,
                        "upstream permissions heal PUT failed; local shadow continues serving as the source of truth"
                    );
                }
            }
        });
    }
}
