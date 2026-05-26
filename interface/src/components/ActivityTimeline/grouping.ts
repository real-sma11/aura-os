/*
 * Phase 5 helpers powering two small UX clarifications in the
 * `ActivityTimeline` feed:
 *
 *  1. `computeUniquePathTails` — given the list of file paths currently
 *     visible in the feed, return the shortest right-hand path tail that
 *     disambiguates each one. A lone `Cargo.toml` stays a bare
 *     `Cargo.toml`; two reads of `crates/A/Cargo.toml` and
 *     `crates/B/Cargo.toml` in the same feed render as their full
 *     `crates/<crate>/Cargo.toml` tails instead of two identical rows.
 *
 *  2. `canonicalInputKey` — a stable string fingerprint of
 *     `(tool_name, input)` used to detect runs of adjacent identical
 *     tool calls so the feed can collapse them behind a `×N` badge
 *     instead of stacking five identical reads as five rows.
 *
 * Both helpers are dependency-free (no hashing lib, no lodash) so they
 * can be exercised by the vitest suite without any extra setup.
 */

/**
 * Split a path on either `/` or `\\` so the algorithm works for paths
 * that arrived from the harness (POSIX style) and paths captured on a
 * Windows tool host (backslashes). Empty segments — which appear when a
 * path starts with `/` or contains a `//` run — are dropped so the
 * computed tail never carries a leading slash.
 */
function splitPath(p: string): string[] {
  return p.split(/[/\\]+/).filter((seg) => seg.length > 0);
}

/**
 * For each input path return the shortest right-anchored tail that
 * disambiguates it within the visible feed. The walk always uses `/`
 * as the joiner regardless of source-path style so the rendered string
 * is stable in snapshots and cross-platform tests.
 *
 * Algorithm: bucket paths by basename. A lone basename (no sibling in
 * the feed shares it) renders as the bare basename. When two or more
 * paths collide on basename, every member of that bucket renders as
 * its full normalized path — that always disambiguates and gives the
 * operator the full context for where the file lives, which is the
 * point of the change. Duplicate paths in the input collapse to a
 * single entry in the returned map.
 */
export function computeUniquePathTails(paths: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter((p) => p && p.length > 0)));
  if (unique.length === 0) return result;

  const basenameBuckets = new Map<string, string[]>();
  for (const p of unique) {
    const segs = splitPath(p);
    const base = segs[segs.length - 1] ?? p;
    const bucket = basenameBuckets.get(base);
    if (bucket) bucket.push(p);
    else basenameBuckets.set(base, [p]);
  }

  for (const p of unique) {
    const segs = splitPath(p);
    if (segs.length === 0) {
      result.set(p, p);
      continue;
    }
    const base = segs[segs.length - 1];
    const siblings = basenameBuckets.get(base) ?? [];
    if (siblings.length <= 1) {
      result.set(p, base);
      continue;
    }
    // Collision: render the full normalized path so colliding rows in
    // the feed (e.g. two `Cargo.toml` reads from different crates) are
    // visually distinct.
    result.set(p, segs.join("/"));
  }
  return result;
}

/**
 * Stable JSON-like serialization that sorts object keys, so two semantically
 * equal inputs produce the same string regardless of key order on the wire.
 * `undefined` becomes `null` (matches `JSON.stringify` for object values that
 * silently drop the key — we keep it explicit here to avoid two technically
 * identical payloads disagreeing on omitted vs. present `undefined`).
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(String(value));
}

/**
 * Fingerprint a tool invocation by `(tool_name, canonical_input_json)`.
 * Two calls with the same tool name and the same input — modulo key
 * ordering — produce the same string, which is what the adjacent-grouping
 * walk in `ActivityTimeline` keys on.
 */
export function canonicalInputKey(name: string, input: Record<string, unknown>): string {
  return name + "\u0000" + stableStringify(input ?? {});
}
