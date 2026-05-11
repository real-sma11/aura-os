import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Input, Spinner, Text } from "@cypher-asi/zui";
import { Search, Sparkles } from "lucide-react";
import { Avatar } from "../../../../components/Avatar";
import { useAvatarState } from "../../../../hooks/use-avatar-state";
import type { Agent } from "../../../../shared/types";
import { STANDARD_AGENT_CREATING_KEY } from "./useAgentSelectorData";
import styles from "./AgentSelectorModal.module.css";

const STANDARD_AGENT_LABEL = "Standard Agent";
const STANDARD_AGENT_HAYSTACK = `${STANDARD_AGENT_LABEL.toLowerCase()} default new agent`;

interface AgentSelectorListProps {
  agents: Agent[];
  query: string;
  onQueryChange: (next: string) => void;
  onSelectStandard: () => void;
  onSelectAgent: (agent: Agent) => void;
  creating: string | null;
  loading: boolean;
  error: string;
  /**
   * Called when the user presses Escape on the search input or the
   * list. The Modal's own backdrop / X button still handles close as
   * usual; this is just so keyboard users can dismiss without leaving
   * the focused input.
   */
  onCancel: () => void;
}

type ItemRow =
  | { kind: "standard"; key: string }
  | { kind: "agent"; key: string; agent: Agent };

function filterRows(agents: Agent[], rawQuery: string): ItemRow[] {
  const query = rawQuery.trim().toLowerCase();
  const matchesStandard =
    query.length === 0 || STANDARD_AGENT_HAYSTACK.includes(query);
  const matchedAgents = agents.filter((agent) => {
    if (query.length === 0) return true;
    const haystack = `${agent.name ?? ""} ${agent.role ?? ""}`.toLowerCase();
    return haystack.includes(query);
  });
  const rows: ItemRow[] = [];
  if (matchesStandard) {
    rows.push({ kind: "standard", key: "__standard__" });
  }
  for (const agent of matchedAgents) {
    rows.push({ kind: "agent", key: agent.agent_id, agent });
  }
  return rows;
}

export const AgentSelectorList = forwardRef<HTMLInputElement, AgentSelectorListProps>(
  function AgentSelectorList(
    {
      agents,
      query,
      onQueryChange,
      onSelectStandard,
      onSelectAgent,
      creating,
      loading,
      error,
      onCancel,
    },
    inputRef,
  ) {
    const rows = useMemo(() => filterRows(agents, query), [agents, query]);
    const [activeIndex, setActiveIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const isCreating = creating !== null;

    // Reset the highlight to the top whenever the visible set of rows
    // changes shape; without this an unrelated keystroke like
    // backspacing the query could leave `activeIndex` pointing past the
    // end of the new list.
    useEffect(() => {
      setActiveIndex(0);
    }, [query, agents.length]);

    // Keep the active row scrolled into view. Mirrors the behavior in
    // `SlashCommandMenu` so long fleets behave the same as the slash
    // command palette already in this codebase. Guarded against
    // environments without `scrollIntoView` (jsdom / older webviews).
    useEffect(() => {
      const active = listRef.current?.querySelector<HTMLElement>(
        `.${styles.rowActive}`,
      );
      if (active && typeof active.scrollIntoView === "function") {
        active.scrollIntoView({ block: "nearest" });
      }
    }, [activeIndex]);

    const activate = useCallback(
      (row: ItemRow | undefined) => {
        if (!row || isCreating) return;
        if (row.kind === "standard") {
          onSelectStandard();
          return;
        }
        onSelectAgent(row.agent);
      },
      [isCreating, onSelectAgent, onSelectStandard],
    );

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (rows.length === 0) {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
          return;
        }
        switch (event.key) {
          case "ArrowDown":
            event.preventDefault();
            setActiveIndex((i) => (i + 1) % rows.length);
            break;
          case "ArrowUp":
            event.preventDefault();
            setActiveIndex((i) => (i - 1 + rows.length) % rows.length);
            break;
          case "Enter":
            event.preventDefault();
            activate(rows[activeIndex]);
            break;
          case "Escape":
            event.preventDefault();
            onCancel();
            break;
        }
      },
      [activate, activeIndex, onCancel, rows],
    );

    return (
      <div className={styles.pickerRoot} onKeyDown={handleKeyDown}>
        <div className={styles.searchRow}>
          <Search size={14} className={styles.searchIcon} />
          <Input
            ref={inputRef}
            size="sm"
            placeholder="Search agents"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className={styles.searchInput}
            disabled={isCreating}
            aria-label="Search agents"
          />
        </div>

        <div className={styles.pickerBody}>
          {loading ? (
            <div className={styles.loadingWrap}>
              <Spinner size="sm" />
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.emptyHint}>
              <Text size="sm" variant="muted">No agents match your search.</Text>
            </div>
          ) : (
            <div className={styles.list} ref={listRef} role="listbox">
              {rows.map((row, index) => {
                const active = index === activeIndex;
                if (row.kind === "standard") {
                  return (
                    <StandardAgentRow
                      key={row.key}
                      active={active}
                      busy={creating === STANDARD_AGENT_CREATING_KEY}
                      disabled={isCreating}
                      onMouseEnter={() => setActiveIndex(index)}
                      onSelect={() => activate(row)}
                    />
                  );
                }
                return (
                  <AgentRow
                    key={row.key}
                    agent={row.agent}
                    active={active}
                    busy={creating === row.agent.agent_id}
                    disabled={isCreating}
                    onMouseEnter={() => setActiveIndex(index)}
                    onSelect={() => activate(row)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <Text size="sm" variant="muted" className={styles.error}>
            {error}
          </Text>
        )}
      </div>
    );
  },
);

interface RowProps {
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}

function StandardAgentRow({ active, busy, disabled, onMouseEnter, onSelect }: RowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`${styles.row} ${active ? styles.rowActive : ""}`}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => {
        // `onMouseDown` mirrors `SlashCommandMenu` — fires before the
        // search input loses focus, so the picker stays keyboard-driven
        // even when the user clicks a row with the mouse.
        e.preventDefault();
        onSelect();
      }}
      disabled={disabled}
    >
      <span className={styles.rowAvatar} aria-hidden="true">
        <Sparkles size={20} />
      </span>
      <span className={styles.rowCopy}>
        <span className={styles.rowName}>{STANDARD_AGENT_LABEL}</span>
        <span className={styles.rowMeta}>New agent with default settings</span>
      </span>
      {busy && <Spinner size="sm" />}
    </button>
  );
}

function AgentRow({
  agent,
  active,
  busy,
  disabled,
  onMouseEnter,
  onSelect,
}: RowProps & { agent: Agent }) {
  const { status, isLocal } = useAvatarState(agent.agent_id);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`${styles.row} ${active ? styles.rowActive : ""}`}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      disabled={disabled}
    >
      <Avatar
        avatarUrl={agent.icon ?? undefined}
        name={agent.name}
        type="agent"
        size={36}
        status={status}
        isLocal={isLocal}
      />
      <span className={styles.rowCopy}>
        <span className={styles.rowName}>{agent.name}</span>
        {agent.role ? (
          <span className={styles.rowMeta}>{agent.role}</span>
        ) : null}
      </span>
      {busy && <Spinner size="sm" />}
    </button>
  );
}
