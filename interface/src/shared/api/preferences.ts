import { apiFetch } from "./core";

/**
 * Per-user desktop chrome preferences — logo color + pulse animation
 * settings. Every field is nullable; `null` means "no override, fall
 * back to the theme default."
 *
 * Mirrors `DesktopPrefs` on the server. Round-tripped opaquely by the
 * server, so frontend schema changes don't require Rust edits.
 */
export interface DesktopPrefs {
  logo_color: string | null;
  pulse_enabled: boolean | null;
  pulse_mode: "fade" | "sweep" | null;
  pulse_speed: number | null;
  pulse_from_color: string | null;
  sweep_reversed: boolean | null;
  pulse_pause: number | null;
}

export const preferencesApi = {
  getDesktop: (): Promise<DesktopPrefs> =>
    apiFetch("/api/preferences/desktop"),

  putDesktop: (prefs: DesktopPrefs): Promise<DesktopPrefs> =>
    apiFetch("/api/preferences/desktop", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }),
};
