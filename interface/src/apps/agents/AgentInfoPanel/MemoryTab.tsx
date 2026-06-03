import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Loader2, FileText, Clock, GitBranch, RefreshCw } from "lucide-react";
import { api, ApiClientError } from "../../../api/client";
import { useIsStreaming } from "../../../hooks/stream/hooks";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import {
  SidekickList,
  type SidekickListSection,
} from "../../../components/SidekickList";
import { EmptyState } from "../../../components/EmptyState";
import type { Agent, MemorySnapshot } from "../../../shared/types";
import panelStyles from "./AgentInfoPanel.module.css";
import styles from "./MemoryTab.module.css";

type MemoryFilter = "all" | "facts" | "events" | "procedures";
type MemoryError = "connection" | "unknown" | null;
type MemoryKind = "fact" | "event" | "procedure";
interface MemoryTarget {
  kind: MemoryKind;
  id: string;
}

function parseRowId(rowId: string): MemoryTarget | null {
  const sep = rowId.indexOf(":");
  if (sep === -1) return null;
  const kind = rowId.slice(0, sep);
  const id = rowId.slice(sep + 1);
  if (kind === "fact" || kind === "event" || kind === "procedure") {
    return { kind, id };
  }
  return null;
}

interface MemoryTabProps {
  agent: Agent;
}

export function MemoryTab({ agent }: MemoryTabProps) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MemoryError>(null);
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const { viewMemoryFact, viewMemoryEvent, viewMemoryProcedure } = useAgentSidekickStore();

  const fetchMemory = useCallback(() => {
    setLoading(true);
    setError(null);
    setSnapshot(null);
    let cancelled = false;
    api.memory.getSnapshot(agent.agent_id)
      .then((data) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 404) {
          setSnapshot(null);
          return;
        }
        if (err instanceof ApiClientError && err.status === 502) {
          setError("connection");
          return;
        }
        setError("unknown");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agent.agent_id]);

  const softRefresh = useCallback(() => {
    let cancelled = false;
    api.memory.getSnapshot(agent.agent_id)
      .then((data) => { if (!cancelled) setSnapshot(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [agent.agent_id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load: the effect kicks off the snapshot fetch (which flips loading/snapshot), and returns its cancellation cleanup
    return fetchMemory();
  }, [fetchMemory]);

  const isStreaming = useIsStreaming(agent.agent_id);
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (wasStreaming && !isStreaming) {
      const timer = setTimeout(() => softRefresh(), 1500);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, softRefresh]);

  const handleDeleteMemory = useCallback(async (target: MemoryTarget) => {
    try {
      switch (target.kind) {
        case "fact":
          await api.memory.deleteFact(agent.agent_id, target.id);
          setSnapshot((prev) => prev ? { ...prev, facts: prev.facts.filter((f) => f.fact_id !== target.id) } : prev);
          break;
        case "event":
          await api.memory.deleteEvent(agent.agent_id, target.id);
          setSnapshot((prev) => prev ? { ...prev, events: prev.events.filter((e) => e.event_id !== target.id) } : prev);
          break;
        case "procedure":
          await api.memory.deleteProcedure(agent.agent_id, target.id);
          setSnapshot((prev) => prev ? { ...prev, procedures: prev.procedures.filter((p) => p.procedure_id !== target.id) } : prev);
          break;
      }
    } catch {
      // silent — row stays if delete fails
    }
  }, [agent.agent_id]);

  const handleMenuAction = useCallback(
    (actionId: string, rowId: string) => {
      if (actionId !== "delete") return;
      const target = parseRowId(rowId);
      if (target) void handleDeleteMemory(target);
    },
    [handleDeleteMemory],
  );

  const counts = useMemo(() => {
    if (!snapshot) return { facts: 0, events: 0, procedures: 0 };
    return {
      facts: snapshot.facts?.length ?? 0,
      events: snapshot.events?.length ?? 0,
      procedures: snapshot.procedures?.length ?? 0,
    };
  }, [snapshot]);

  const sections = useMemo<SidekickListSection[]>(() => {
    if (!snapshot) return [];
    const out: SidekickListSection[] = [];
    if (filter === "all" || filter === "facts") {
      out.push({
        id: "facts",
        label: `Facts (${counts.facts})`,
        emptyLabel: "No facts yet",
        rows: (snapshot.facts ?? []).map((fact) => ({
          id: `fact:${fact.fact_id}`,
          icon: <FileText size={13} />,
          label: fact.key,
          detail: typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value),
          suffix: <span className={styles.badge}>{Math.round(fact.confidence * 100)}%</span>,
          onSelect: () => viewMemoryFact(fact),
        })),
      });
    }
    if (filter === "all" || filter === "events") {
      out.push({
        id: "events",
        label: `Events (${counts.events})`,
        emptyLabel: "No events yet",
        rows: (snapshot.events ?? []).map((event) => ({
          id: `event:${event.event_id}`,
          icon: <Clock size={13} />,
          label: event.event_type,
          detail: event.summary,
          suffix: <span className={styles.badge}>{new Date(event.timestamp).toLocaleDateString()}</span>,
          onSelect: () => viewMemoryEvent(event),
        })),
      });
    }
    if (filter === "all" || filter === "procedures") {
      out.push({
        id: "procedures",
        label: `Procedures (${counts.procedures})`,
        emptyLabel: "No procedures yet",
        rows: (snapshot.procedures ?? []).map((proc) => ({
          id: `procedure:${proc.procedure_id}`,
          icon: <GitBranch size={13} />,
          label: proc.name,
          detail: `${proc.steps.length} steps${proc.skill_name ? ` · ${proc.skill_name}` : ""}`,
          suffix: <span className={styles.badge}>{Math.round(proc.success_rate * 100)}%</span>,
          onSelect: () => viewMemoryProcedure(proc),
        })),
      });
    }
    return out;
  }, [snapshot, filter, counts, viewMemoryFact, viewMemoryEvent, viewMemoryProcedure]);

  if (loading) {
    return (
      <div className={panelStyles.tabEmptyState}>
        <Loader2 size={16} className={panelStyles.spin} /> Loading memory...
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorState}>
        <span>{error === "connection" ? "Could not connect to harness" : "Failed to load memory"}</span>
        <button type="button" className={styles.retryButton} onClick={fetchMemory}>
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  if (!snapshot || (counts.facts === 0 && counts.events === 0 && counts.procedures === 0)) {
    return <EmptyState>No memories yet</EmptyState>;
  }

  const filters: { id: MemoryFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.facts + counts.events + counts.procedures },
    { id: "facts", label: "Facts", count: counts.facts },
    { id: "events", label: "Events", count: counts.events },
    { id: "procedures", label: "Procedures", count: counts.procedures },
  ];

  return (
    <>
      <div className={styles.filterRow}>
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`${styles.filterChip}${filter === f.id ? ` ${styles.filterChipActive}` : ""}`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>
      <SidekickList
        sections={sections}
        menuActions={["delete"]}
        onMenuAction={handleMenuAction}
      />
    </>
  );
}
