import { useEffect, useState } from "react";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
  style: "long",
});

/**
 * Format an absolute timestamp as a "human" relative-time string
 * anchored at `now`. Picks the largest unit whose magnitude is at least
 * 1 (seconds for <60s, minutes for <60m, hours for <24h, days, weeks,
 * months, years). Future timestamps render with the "in N" prefix that
 * `Intl.RelativeTimeFormat` produces.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const deltaMs = parsed.getTime() - now.getTime();
  const absMs = Math.abs(deltaMs);

  if (absMs < 5 * SECOND_MS) {
    return "just now";
  }
  if (absMs < MINUTE_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / SECOND_MS), "second");
  }
  if (absMs < HOUR_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / MINUTE_MS), "minute");
  }
  if (absMs < DAY_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / HOUR_MS), "hour");
  }
  if (absMs < WEEK_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / DAY_MS), "day");
  }
  if (absMs < MONTH_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / WEEK_MS), "week");
  }
  if (absMs < YEAR_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / MONTH_MS), "month");
  }
  return RELATIVE_TIME_FORMATTER.format(Math.round(deltaMs / YEAR_MS), "year");
}

/**
 * Pick a refresh cadence that matches the granularity of the formatted
 * string: ~1s while the delta is sub-minute, ~30s while sub-hour, ~5m
 * while sub-day, then hourly. Keeps the "ago" string visibly alive for
 * recent releases without thrashing renders for week-old timestamps.
 */
function pickRefreshInterval(deltaAbsMs: number): number {
  if (deltaAbsMs < MINUTE_MS) return SECOND_MS;
  if (deltaAbsMs < HOUR_MS) return 30 * SECOND_MS;
  if (deltaAbsMs < DAY_MS) return 5 * MINUTE_MS;
  return HOUR_MS;
}

/**
 * React hook wrapping `formatRelativeTime` that re-renders the string
 * periodically so it stays current. The refresh cadence auto-adapts to
 * the magnitude of the delta. Returns the empty string when `iso` is
 * `undefined` or unparseable so callers can guard rendering with a
 * truthy check.
 */
export function useRelativeTime(iso: string | undefined): string {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (!iso) {
      return;
    }
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      return;
    }

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      const current = new Date();
      const delta = Math.abs(parsed.getTime() - current.getTime());
      const interval = pickRefreshInterval(delta);
      timerId = setTimeout(() => {
        if (cancelled) return;
        setNow(new Date());
        schedule();
      }, interval);
    };

    schedule();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [iso]);

  if (!iso) {
    return "";
  }
  return formatRelativeTime(iso, now);
}
