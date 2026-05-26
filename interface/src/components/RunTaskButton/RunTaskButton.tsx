import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@cypher-asi/zui";
import { Loader2, Play } from "lucide-react";
import { api, isInsufficientCreditsError, dispatchInsufficientCredits } from "../../api/client";
import { useProjectActions } from "../../stores/project-action-store";
import { useChatUI } from "../../stores/chat-ui-store";
import { projectChatHistoryKey } from "../../stores/chat-history-store";
import { useLoopActive } from "../../hooks/use-loop-active";
import { useTaskStatus } from "../../hooks/use-task-status";
import { loadPersistedModel } from "../../constants/models";
import styles from "../Preview/Preview.module.css";

export function RunTaskButton({ task }: { task: import("../../shared/types").Task }) {
  const ctx = useProjectActions();
  const { agentInstanceId } = useParams<{ agentInstanceId: string }>();
  const projectId = ctx?.project.project_id;
  const streamKey =
    projectId && agentInstanceId ? projectChatHistoryKey(projectId, agentInstanceId) : null;
  const { selectedModel } = useChatUI(streamKey ?? "__task-run-task-button__");
  const loopActive = useLoopActive(projectId);
  const { liveStatus } = useTaskStatus(task.task_id, task.status);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (liveStatus) setRunning(false);
  }, [liveStatus]);

  const handleRun = useCallback(async () => {
    if (!projectId || running) return;
    setRunning(true);
    // Fall back to the per-agent persisted model (or the user's last
    // global pick / adapter default) when the chat-UI store hasn't
    // hydrated `selectedModel` yet — that store is only populated
    // once the ChatPanel for this agent has mounted, so pressing
    // Play on a task without ever opening the chat would otherwise
    // send no `model` query param. The server's `pick_model` then
    // falls through to `agent_instance.default_model`/`model` (often
    // unset) and the harness rejects with HTTP 400 "missing model",
    // which the server surfaces as a misleading 502 to the user.
    const modelForRun =
      selectedModel ?? loadPersistedModel("default", undefined, agentInstanceId);
    try {
      const { track } = await import("../../lib/analytics");
      track("task_run_started", { model: modelForRun });
      await api.runTask(projectId, task.task_id, agentInstanceId, modelForRun);
    } catch (err) {
      if (isInsufficientCreditsError(err)) dispatchInsufficientCredits();
      console.error("Run task failed:", err);
      setRunning(false);
    }
  }, [running, agentInstanceId, projectId, selectedModel, task.task_id]);

  const effectiveStatus =
    (liveStatus ?? task.status) === "in_progress" && !loopActive && liveStatus === null
      ? "ready"
      : liveStatus ?? task.status;
  const visible = effectiveStatus === "ready";

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon={running ? <Loader2 size={14} className={styles.spinner} /> : <Play size={14} />}
      onClick={visible ? handleRun : undefined}
      disabled={!visible || running}
      title={running ? "Running..." : "Run task"}
      style={visible ? undefined : { visibility: "hidden" }}
    />
  );
}
