//! `GET /api/public/commit-stats` — cached, optionally-authenticated
//! commit-count aggregation for the marketing `/changelog` page.
//!
//! The SPA used to fan out 14 *unauthenticated* requests straight to
//! the GitHub REST API per cold load (7 repos x {all-time, this-month}).
//! GitHub's unauthenticated budget is only 60 req/hr/IP, shared across
//! every visitor behind a NAT plus page reloads — so the stats card
//! reliably hit `403 rate limit exceeded` and rendered `0`.
//!
//! This same-origin endpoint moves the fan-out server-side where it can
//! (a) attach an optional `GITHUB_API_TOKEN` for the 5000 req/hr
//! authenticated budget and (b) cache the aggregate for a TTL window so
//! repeat visitors never touch GitHub. The PST month boundary stays on
//! the client (it owns the tested `pstMonthStartIso` helper) and arrives
//! as the `since` query param; the cache is keyed on that value so it
//! stays correct across a month rollover.
//!
//! Graceful-degrade contract (mirrors `public_models` / `feedback`):
//! per-repo failures are absorbed and surfaced via `partial: true`, and
//! a totally failed refresh serves the last cached aggregate when one
//! exists rather than blanking the card.

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::Json;
use chrono::{Datelike, TimeZone, Utc};
use futures_util::future::join_all;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::warn;

use crate::state::AppState;

const GITHUB_API_BASE: &str = "https://api.github.com";
const GITHUB_OWNER: &str = "cypher-asi";
/// Optional personal-access / fine-grained token. When present the
/// server-side fan-out runs against GitHub's 5000 req/hr authenticated
/// budget instead of the 60 req/hr unauthenticated one.
const GITHUB_TOKEN_ENV: &str = "GITHUB_API_TOKEN";
/// How long an aggregate stays fresh before the next request triggers a
/// refresh. 30 minutes keeps the card lively without ever approaching
/// even the unauthenticated budget (one refresh = 14 requests).
const CACHE_TTL: Duration = Duration::from_secs(30 * 60);
/// Per-request upstream timeout so a hung GitHub edge can't pin the
/// shared refresh lock for the full client timeout.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Public AURA repositories whose commits roll up into the changelog
/// totals. Kept in sync with `AURA_PUBLIC_REPOS` in
/// `interface/src/api/marketing/github-commits.ts`.
const AURA_PUBLIC_REPOS: &[&str] = &[
    "aura-os",
    "aura-harness",
    "aura-router",
    "aura-network",
    "aura-storage",
    "aura-swarm",
    "aura-website",
];

#[derive(Debug, Deserialize)]
pub(crate) struct CommitStatsQuery {
    /// ISO-8601 instant marking the start of the current PST month,
    /// computed client-side by `pstMonthStartIso`. Optional: when
    /// missing or unparseable the server falls back to the start of the
    /// current UTC month so the card still renders a sane this-month
    /// total.
    pub since: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoCommitCounts {
    this_month: u64,
    all_time: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveCommitStats {
    commits_this_month: u64,
    commits_all_time: u64,
    per_repo: BTreeMap<String, RepoCommitCounts>,
    fetched_at: String,
    /// True when at least one per-repo fetch failed. Totals still
    /// reflect the successful repos; the client decides whether to
    /// surface the partial state.
    partial: bool,
}

struct CacheEntry {
    stored_at: Instant,
    stats: LiveCommitStats,
}

/// Process-wide cache keyed on the effective `since` value. Holding the
/// `Mutex` across the refresh await also dedupes concurrent cold
/// requests (stampede control) — acceptable for a low-traffic marketing
/// endpoint and strictly better for GitHub's budget.
fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `GET /api/public/commit-stats`. Returns the cached aggregate when
/// fresh, otherwise refreshes from GitHub and caches the result. Never
/// errors: a failed refresh serves the last cached value (or a
/// zeroed-but-`partial` aggregate when the cache is cold).
pub(crate) async fn pub_commit_stats(
    State(state): State<AppState>,
    Query(query): Query<CommitStatsQuery>,
) -> Json<LiveCommitStats> {
    let since = normalize_since(query.since.as_deref());

    let mut guard = cache().lock().await;

    if let Some(entry) = guard.get(&since) {
        if entry.stored_at.elapsed() < CACHE_TTL {
            return Json(entry.stats.clone());
        }
    }

    let token = std::env::var(GITHUB_TOKEN_ENV)
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    let stats = fetch_commit_stats(&state.http_client, &since, token.as_deref()).await;

    // A fully failed refresh (every repo errored) shouldn't clobber a
    // previously-good cache entry — serve the stale value instead so a
    // transient GitHub blip doesn't blank the card.
    let everything_failed = stats.partial && stats.commits_all_time == 0;
    if everything_failed {
        if let Some(entry) = guard.get(&since) {
            warn!("commit-stats refresh failed; serving stale cached aggregate");
            return Json(entry.stats.clone());
        }
    }

    guard.insert(
        since,
        CacheEntry {
            stored_at: Instant::now(),
            stats: stats.clone(),
        },
    );

    Json(stats)
}

/// Validate the client-provided `since` (RFC-3339) and fall back to the
/// start of the current UTC month when absent or malformed.
fn normalize_since(raw: Option<&str>) -> String {
    if let Some(value) = raw {
        let trimmed = value.trim();
        if chrono::DateTime::parse_from_rfc3339(trimmed).is_ok() {
            return trimmed.to_string();
        }
    }
    let now = Utc::now();
    Utc.with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
        .single()
        .unwrap_or(now)
        .to_rfc3339()
}

async fn fetch_commit_stats(
    client: &reqwest::Client,
    since: &str,
    token: Option<&str>,
) -> LiveCommitStats {
    // Fire all-time + this-month for every repo concurrently. Each
    // resolves to `Option<u64>` (None = failed) so a single 404 /
    // rate-limit doesn't poison the whole aggregate.
    let futures = AURA_PUBLIC_REPOS.iter().map(|&repo| async move {
        let all_time = count_commits(client, repo, None, token).await;
        let this_month = count_commits(client, repo, Some(since), token).await;
        (repo, all_time, this_month)
    });

    let results = join_all(futures).await;

    let mut per_repo: BTreeMap<String, RepoCommitCounts> = BTreeMap::new();
    let mut commits_all_time = 0u64;
    let mut commits_this_month = 0u64;
    let mut partial = false;

    for (repo, all_time, this_month) in results {
        if all_time.is_none() || this_month.is_none() {
            partial = true;
        }
        let all_time = all_time.unwrap_or(0);
        let this_month = this_month.unwrap_or(0);
        commits_all_time += all_time;
        commits_this_month += this_month;
        per_repo.insert(
            repo.to_string(),
            RepoCommitCounts {
                this_month,
                all_time,
            },
        );
    }

    LiveCommitStats {
        commits_this_month,
        commits_all_time,
        per_repo,
        fetched_at: Utc::now().to_rfc3339(),
        partial,
    }
}

/// Count commits for one (repo, range) using the `per_page=1` +
/// `Link: rel="last"` trick so each call costs a single request.
/// Returns `None` on any failure (network, non-2xx, malformed body).
async fn count_commits(
    client: &reqwest::Client,
    repo: &str,
    since: Option<&str>,
    token: Option<&str>,
) -> Option<u64> {
    let url = format!("{GITHUB_API_BASE}/repos/{GITHUB_OWNER}/{repo}/commits");
    let mut query: Vec<(&str, &str)> = vec![("per_page", "1")];
    if let Some(s) = since {
        query.push(("since", s));
    }

    let mut request = client
        .get(url)
        .query(&query)
        .timeout(REQUEST_TIMEOUT)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        // GitHub rejects API requests without a User-Agent with a 403,
        // so set one explicitly (browsers send it implicitly).
        .header(reqwest::header::USER_AGENT, "aura-os-server");
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(err) => {
            warn!(repo, error = %err, "commit-stats: upstream request failed");
            return None;
        }
    };

    if !response.status().is_success() {
        warn!(
            repo,
            status = %response.status(),
            "commit-stats: upstream returned non-success"
        );
        return None;
    }

    let link = response
        .headers()
        .get(reqwest::header::LINK)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    if let Some(last_page) = parse_last_page_from_link(link.as_deref()) {
        return Some(last_page);
    }

    // No Link header => fewer than `per_page` commits in this range.
    // Read the body to distinguish 0 from 1.
    match response.json::<serde_json::Value>().await {
        Ok(serde_json::Value::Array(items)) => Some(items.len() as u64),
        Ok(_) => Some(0),
        Err(err) => {
            warn!(repo, error = %err, "commit-stats: malformed upstream body");
            None
        }
    }
}

/// Parse the GitHub `Link` header (RFC 5988) and return the `page=N`
/// value of the `rel="last"` link, or `None` when no such link exists.
fn parse_last_page_from_link(header: Option<&str>) -> Option<u64> {
    let header = header?;
    for segment in header.split(',') {
        let trimmed = segment.trim();
        if !trimmed.contains("rel=\"last\"") {
            continue;
        }
        let start = trimmed.find('<')?;
        let end = trimmed[start + 1..].find('>')? + start + 1;
        let url_str = &trimmed[start + 1..end];
        let Ok(url) = reqwest::Url::parse(url_str) else {
            continue;
        };
        if let Some((_, value)) = url.query_pairs().find(|(key, _)| key == "page") {
            if let Ok(page) = value.parse::<u64>() {
                if page > 0 {
                    return Some(page);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_last_page_from_link_header() {
        let header = concat!(
            "<https://api.github.com/repositories/1/commits?per_page=1&page=2>; rel=\"next\", ",
            "<https://api.github.com/repositories/1/commits?per_page=1&page=237>; rel=\"last\""
        );
        assert_eq!(parse_last_page_from_link(Some(header)), Some(237));
    }

    #[test]
    fn returns_none_without_rel_last() {
        assert_eq!(parse_last_page_from_link(None), None);
        assert_eq!(parse_last_page_from_link(Some("")), None);
        assert_eq!(
            parse_last_page_from_link(Some(
                "<https://api.github.com/x?page=2>; rel=\"next\""
            )),
            None
        );
    }

    #[test]
    fn returns_none_for_malformed_last_url() {
        assert_eq!(
            parse_last_page_from_link(Some("<not a url>; rel=\"last\"")),
            None
        );
    }

    #[test]
    fn normalize_since_passes_through_valid_rfc3339() {
        let value = "2026-05-01T07:00:00.000Z";
        assert_eq!(normalize_since(Some(value)), value);
    }

    #[test]
    fn normalize_since_falls_back_for_garbage() {
        let fallback = normalize_since(Some("not-a-date"));
        // Fallback is the first of the current UTC month at midnight.
        assert!(fallback.contains("-01T00:00:00"));
        let none_fallback = normalize_since(None);
        assert!(none_fallback.contains("-01T00:00:00"));
    }
}
