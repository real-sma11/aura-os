import { useState, useEffect, useCallback } from "react";
import type { ProjectId } from "../shared/types";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store/index";
import { useAutomationLoopStore } from "../stores/automation-loop-store";
import { EventType } from "../shared/types/aura-events";

export function useLoopActive(projectId: ProjectId | undefined): boolean {
  const subscribe = useEventStore((s) => s.subscribe);
  const boundLoopId = useAutomationLoopStore((s) =>
    projectId ? s.loopByProject[projectId] ?? null : null,
  );
  const [loopActive, setLoopActive] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!projectId) {
      return false;
    }

    try {
      const res = await api.getLoopStatus(projectId);
      return !!(res.active_agent_instances && res.active_agent_instances.length > 0);
    } catch {
      return false;
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;

    void fetchStatus().then((nextLoopActive) => {
      if (!cancelled) {
        setLoopActive(nextLoopActive);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  useEffect(() => {
    if (!projectId) return;
    // Terminal `loop_stopped` / `loop_finished` events are emitted by
    // EVERY forwarder teardown — including the ephemeral task-runner
    // automatons that `run_single_task` mints per task. Scoping the
    // flip-to-false on (project + bound Loop's agent_id when known)
    // stops an ephemeral runner's natural end from masking a still-
    // active dev loop as idle. Until the bound Loop id is known
    // (first Start of a fresh project), fall back to project-only so
    // we don't deadlock the first transition.
    const matchesBoundLoop = (e: { project_id?: string; agent_id?: string }): boolean => {
      if (e.project_id !== projectId) return false;
      if (boundLoopId == null) return true;
      return e.agent_id === boundLoopId;
    };
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (e.project_id === projectId) setLoopActive(true);
      }),
      subscribe(EventType.LoopStopped, (e) => {
        if (matchesBoundLoop(e)) setLoopActive(false);
      }),
      subscribe(EventType.LoopPaused, (e) => {
        if (e.project_id === projectId) setLoopActive(true);
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (matchesBoundLoop(e)) setLoopActive(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [projectId, subscribe, boundLoopId]);

  return loopActive;
}
