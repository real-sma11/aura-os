import { useMemo } from "react";
import { Button } from "@cypher-asi/zui";
import { FileText } from "lucide-react";
import type { ArtifactRef } from "../../shared/types/stream";
import type { Spec } from "../../shared/types";
import { useProjectActions } from "../../stores/project-action-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useChatUIStore } from "../../stores/chat-ui-store";
import { useChatPanelStreamKey } from "../../features/chat-ui/ChatPanel/chat-panel-context";
import styles from "./ReviewPlanCard.module.css";

interface ReviewPlanCardProps {
  /** Spec artifact refs produced by the completed plan run. */
  specRefs: ArtifactRef[];
  /** While the turn is still streaming we suppress the action buttons. */
  isStreaming?: boolean;
}

/**
 * In-chat summary shown when a plan-generation run finishes: the plan title,
 * its summary, the specs it produced, and a stage-dependent primary action
 * ("Create Tasks" before any tasks exist, "Automate Build" once they do).
 */
export function ReviewPlanCard({ specRefs, isStreaming }: ReviewPlanCardProps) {
  const ctx = useProjectActions();
  const streamKey = useChatPanelStreamKey();
  const setActiveTab = useSidekickStore((s) => s.setActiveTab);
  const pushPreview = useSidekickStore((s) => s.pushPreview);
  const sidekickSpecs = useSidekickStore((s) => s.specs);
  const sidekickTasks = useSidekickStore((s) => s.tasks);

  const title = ctx?.project?.specs_title || "Plan";
  const summary = ctx?.project?.specs_summary;
  const specCount = specRefs.length;

  const specIdSet = useMemo(
    () => new Set(specRefs.map((r) => r.id)),
    [specRefs],
  );

  const specsById = useMemo(() => {
    const map = new Map<string, Spec>();
    for (const spec of ctx?.initialSpecs ?? []) map.set(spec.spec_id, spec);
    for (const spec of sidekickSpecs) map.set(spec.spec_id, spec);
    return map;
  }, [ctx?.initialSpecs, sidekickSpecs]);

  const planSpecs = useMemo(
    () =>
      specRefs
        .map((r) => specsById.get(r.id))
        .filter((s): s is Spec => Boolean(s)),
    [specRefs, specsById],
  );

  const allTasks = useMemo(
    () => [...(ctx?.initialTasks ?? []), ...sidekickTasks],
    [ctx?.initialTasks, sidekickTasks],
  );
  const hasTasks = allTasks.some((t) => specIdSet.has(t.spec_id));

  const primaryLabel = hasTasks ? "Automate Build" : "Create Tasks";
  const primaryPrompt = hasTasks
    ? "Automate the build for this plan: run the tasks and drive them to completion."
    : "Create tasks for this plan from the generated specs.";

  const openPlan = () => {
    setActiveTab("specs");
    if (planSpecs.length > 0) {
      pushPreview({ kind: "specs_overview", specs: planSpecs, title });
    }
  };

  const runPrimary = () => {
    if (streamKey) {
      // Stage the next instruction in the composer so the user can review
      // and send it. Non-invasive: works from any chat surface without
      // threading the send callback through the message list.
      useChatUIStore.getState().setDraft(streamKey, primaryPrompt);
    }
    openPlan();
  };

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.eyebrow}>Review Plan</span>
        <span className={styles.count}>
          {specCount} spec{specCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className={styles.title}>{title}</div>
      {summary && <p className={styles.description}>{summary}</p>}
      {specRefs.length > 0 && (
        <ul className={styles.specList}>
          {specRefs.map((ref) => (
            <li key={ref.id} className={styles.specItem}>
              <FileText size={13} className={styles.specIcon} />
              <span className={styles.specTitle}>{ref.title}</span>
            </li>
          ))}
        </ul>
      )}
      {!isStreaming && (
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={openPlan}>
            Open plan
          </Button>
          <Button variant="primary" size="sm" onClick={runPrimary}>
            {primaryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
