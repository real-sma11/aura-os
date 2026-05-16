import { Button, Text, type ResolvedTheme } from "@cypher-asi/zui";
import { useThemeOverrides } from "../../../../hooks/use-theme-overrides";
import {
  EDITABLE_TOKENS,
  type EditableToken,
} from "../../../../lib/theme-overrides";
import { TokenRow } from "./TokenRow";
import styles from "./CustomTokensPanel.module.css";

const TOKEN_LABELS: Record<EditableToken, string> = {
  "--color-border": "Border",
  "--color-border-main-panel": "Main panel border",
  "--color-border-chrome": "Topbar / taskbar border",
  "--color-surface-tint": "Surface tint",
  "--color-elevated-tint": "Elevated tint",
  "--color-sidebar-bg": "Sidebar background",
  "--color-sidekick-bg": "Sidekick background",
  "--color-titlebar-bg": "Titlebar background",
  "--color-accent": "Accent",
  "--color-modal-bg": "Modal background",
  "--color-icon-selected": "Icon select accent",
};

/**
 * Tokens that render as a paired (dark, light) editor instead of a single
 * row scoped to the active theme. Modal background is per-mode by request:
 * users wanted to dial in jet-black for dark while keeping a light value
 * visible without flipping themes.
 */
const PAIRED_TOKENS: ReadonlySet<EditableToken> = new Set<EditableToken>([
  "--color-modal-bg",
]);

/**
 * Tokens intentionally hidden from the generic chrome-token list because
 * they have a dedicated control elsewhere in the Appearance section. The
 * token is still a first-class {@link EDITABLE_TOKENS} entry so its
 * value persists and applies to `documentElement.style` the same way.
 */
const HIDDEN_TOKENS: ReadonlySet<EditableToken> = new Set<EditableToken>([
  "--color-icon-selected",
]);

type PairedTokenRowProps = {
  token: EditableToken;
  label: string;
  darkValue: string | undefined;
  lightValue: string | undefined;
  onChange: (value: string | null, mode: ResolvedTheme) => void;
  disabled?: boolean;
};

/**
 * Two-row editor (dark + light) for tokens whose value is meaningfully
 * different per resolved theme and that the user wants to dial in without
 * having to flip themes. Each row writes through {@link onChange} with an
 * explicit `mode` so the hook can route to the correct working-set entry.
 */
function PairedTokenRow({
  token,
  label,
  darkValue,
  lightValue,
  onChange,
  disabled = false,
}: PairedTokenRowProps) {
  return (
    <div className={styles.pairedGroup} data-testid={`token-pair-${token}`}>
      <Text variant="muted" size="xs" className={styles.pairedHeading}>
        {label}
      </Text>
      <TokenRow
        token={token}
        label="Dark"
        controlLabel={`${label} (Dark)`}
        rowKey="dark"
        currentValue={darkValue}
        onChange={(value) => onChange(value, "dark")}
        disabled={disabled}
      />
      <TokenRow
        token={token}
        label="Light"
        controlLabel={`${label} (Light)`}
        rowKey="light"
        currentValue={lightValue}
        onChange={(value) => onChange(value, "light")}
        disabled={disabled}
      />
    </div>
  );
}

export function CustomTokensPanel() {
  const {
    overrides,
    darkOverrides,
    lightOverrides,
    setToken,
    resetAll,
    presets,
    activePresetId,
  } = useThemeOverrides();
  const activePreset = activePresetId
    ? (presets.find((p) => p.id === activePresetId) ?? null)
    : null;
  const readOnly = activePreset?.readOnly === true;
  const editingPreset = activePreset !== null && !readOnly;

  const rootClass = readOnly
    ? `${styles.root} ${styles.rootDisabled}`
    : styles.root;

  return (
    <div className={rootClass} data-testid="custom-tokens-panel">
      <Text weight="semibold" size="sm">
        Custom colors
      </Text>
      <Text variant="muted" size="xs">
        Customize chrome colors for the current theme. Changes are local to your
        browser.
      </Text>

      {editingPreset && activePreset && (
        <Text size="xs" data-testid="custom-tokens-preset-note">
          Editing preset: {activePreset.name}
        </Text>
      )}
      {readOnly && activePreset && (
        <Text
          size="xs"
          variant="muted"
          data-testid="custom-tokens-readonly-note"
        >
          {activePreset.name} is read-only. Click &ldquo;Save as preset&rdquo;
          above to start customizing.
        </Text>
      )}

      <div className={styles.rows}>
        {EDITABLE_TOKENS.filter(
          (token) => !PAIRED_TOKENS.has(token) && !HIDDEN_TOKENS.has(token),
        ).map((token) => (
          <TokenRow
            key={token}
            token={token}
            label={TOKEN_LABELS[token]}
            currentValue={overrides[token]}
            onChange={(value) => setToken(token, value)}
            disabled={readOnly}
          />
        ))}
        {EDITABLE_TOKENS.filter(
          (token) => PAIRED_TOKENS.has(token) && !HIDDEN_TOKENS.has(token),
        ).map((token) => (
          <PairedTokenRow
            key={token}
            token={token}
            label={TOKEN_LABELS[token]}
            darkValue={darkOverrides[token]}
            lightValue={lightOverrides[token]}
            onChange={(value, mode) => setToken(token, value, mode)}
            disabled={readOnly}
          />
        ))}
      </div>

      <div className={styles.footer}>
        <Button
          size="sm"
          variant="ghost"
          onClick={resetAll}
          disabled={readOnly}
        >
          Reset all
        </Button>
      </div>
    </div>
  );
}
