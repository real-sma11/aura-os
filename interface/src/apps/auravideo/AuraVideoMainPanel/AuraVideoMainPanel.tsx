import { useCallback, useMemo, useRef } from "react";
import { Spinner } from "@cypher-asi/zui";
import { Film, FolderOpen } from "lucide-react";
import { useAuraVideoStore } from "../../../stores/auravideo-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { generateVideoStream } from "../../../api/streams";
import { VIDEO_MODELS } from "../../../constants/models";
import { EventType } from "../../../shared/types/aura-events";
import {
  InputBarShell,
  ModelPicker,
  inputBarShellStyles,
  type InputBarShellHandle,
} from "../../../components/InputBarShell";
import styles from "./AuraVideoMainPanel.module.css";

function VideoPreview() {
  const currentVideo = useAuraVideoStore((s) => s.currentVideo);
  const isGenerating = useAuraVideoStore((s) => s.isGenerating);
  const progress = useAuraVideoStore((s) => s.progress);
  const progressMessage = useAuraVideoStore((s) => s.progressMessage);
  const error = useAuraVideoStore((s) => s.error);

  if (error) {
    return (
      <div className={styles.previewArea}>
        <div className={styles.errorBanner}>{error}</div>
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className={styles.previewArea}>
        <div className={styles.generatingWrap}>
          <Spinner size="md" />
          <span className={styles.generatingMessage}>
            {progressMessage || "Starting video generation..."}
          </span>
          {progress > 0 && (
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (currentVideo) {
    return (
      <div className={styles.previewArea}>
        <video
          className={styles.videoPlayer}
          src={currentVideo.videoUrl}
          controls
          autoPlay
          loop
          playsInline
        />
      </div>
    );
  }

  return (
    <div className={styles.previewArea}>
      <div className={styles.emptyState}>
        <Film size={48} strokeWidth={1} />
        <span>Describe a video to generate</span>
      </div>
    </div>
  );
}

export function AuraVideoMainPanel() {
  const prompt = useAuraVideoStore((s) => s.prompt);
  const setPrompt = useAuraVideoStore((s) => s.setPrompt);
  const model = useAuraVideoStore((s) => s.model);
  const setModel = useAuraVideoStore((s) => s.setModel);
  const aspectRatio = useAuraVideoStore((s) => s.aspectRatio);
  const durationSeconds = useAuraVideoStore((s) => s.durationSeconds);
  const setDurationSeconds = useAuraVideoStore((s) => s.setDurationSeconds);
  const resolution = useAuraVideoStore((s) => s.resolution);
  const setResolution = useAuraVideoStore((s) => s.setResolution);
  const generateAudio = useAuraVideoStore((s) => s.generateAudio);
  const isGenerating = useAuraVideoStore((s) => s.isGenerating);
  const selectedProjectId = useAuraVideoStore((s) => s.selectedProjectId);
  const setGenerating = useAuraVideoStore((s) => s.setGenerating);
  const setProgress = useAuraVideoStore((s) => s.setProgress);
  const setError = useAuraVideoStore((s) => s.setError);
  const completeGeneration = useAuraVideoStore((s) => s.completeGeneration);

  const shellRef = useRef<InputBarShellHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const projects = useProjectsListStore((s) => s.projects);
  const projectName = useMemo(
    () => projects.find((p) => p.project_id === selectedProjectId)?.name ?? null,
    [projects, selectedProjectId],
  );

  const handleGenerate = useCallback(() => {
    if (!prompt.trim() || isGenerating) return;

    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    generateVideoStream(
      {
        prompt: prompt.trim(),
        model,
        aspectRatio,
        durationSeconds,
        resolution,
        generateAudio,
        projectId: selectedProjectId ?? undefined,
      },
      {
        onEvent: (event) => {
          if (controller.signal.aborted) return;
          switch (event.type) {
            case EventType.GenerationStart:
              setProgress(0, "Starting video generation...");
              break;
            case EventType.GenerationProgress:
              setProgress(
                event.content.percent ?? 0,
                event.content.message ?? "Generating video...",
              );
              break;
            case EventType.GenerationCompleted: {
              // The harness normalizes all asset URLs to `imageUrl`
              // via `normalize_generation_completed_payload`.
              const videoUrl = event.content.imageUrl ?? "";
              if (videoUrl) {
                completeGeneration({
                  id: `video-${Date.now()}`,
                  prompt: prompt.trim(),
                  videoUrl,
                  model,
                  durationSeconds,
                  resolution,
                  aspectRatio,
                  createdAt: new Date().toISOString(),
                });
              } else {
                setError("Video generated but no URL returned");
              }
              break;
            }
            case EventType.GenerationError:
              setError(event.content.message ?? "Video generation failed");
              break;
          }
        },
        onError: (err) => {
          if (!controller.signal.aborted) {
            setError(String(err));
          }
        },
      },
      controller.signal,
    );
  }, [
    prompt, model, aspectRatio, durationSeconds, resolution, generateAudio,
    selectedProjectId, isGenerating, setGenerating, setProgress, setError,
    completeGeneration,
  ]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setGenerating(false);
  }, [setGenerating]);

  const modelLabel =
    VIDEO_MODELS.find((m) => m.id === model)?.label ?? model;

  // Veo API constraints (verified):
  // - 720p: 4s, 6s, 8s (all models)
  // - 1080p: 8s only (all models)
  // - 4k: 8s only (Standard & Fast only, not Lite)
  const isLite = model.includes("lite");
  const resolutionOptions = isLite
    ? ["720p", "1080p"]
    : ["720p", "1080p", "4k"];
  const durationOptions = resolution === "720p" ? [4, 6, 8] : [8];

  const renderResolutionMenu = useCallback(
    (close: () => void) => (
      <div className={inputBarShellStyles.modelMenu}>
        {resolutionOptions.map((r) => (
          <button
            key={r}
            type="button"
            className={`${inputBarShellStyles.modelMenuItem} ${r === resolution ? inputBarShellStyles.modelMenuItemActive : ""}`}
            onClick={() => {
              setResolution(r);
              if (r !== "720p") setDurationSeconds(8);
              close();
            }}
          >
            {r}
          </button>
        ))}
      </div>
    ),
    [resolution, setResolution, setDurationSeconds, resolutionOptions],
  );

  const renderDurationMenu = useCallback(
    (close: () => void) => (
      <div className={inputBarShellStyles.modelMenu}>
        {durationOptions.map((d) => (
          <button
            key={d}
            type="button"
            className={`${inputBarShellStyles.modelMenuItem} ${d === durationSeconds ? inputBarShellStyles.modelMenuItemActive : ""}`}
            onClick={() => {
              setDurationSeconds(d);
              close();
            }}
          >
            {d}s
          </button>
        ))}
      </div>
    ),
    [durationSeconds, setDurationSeconds, durationOptions],
  );

  const renderModelMenu = useCallback(
    (close: () => void) => (
      <div className={inputBarShellStyles.modelMenu}>
        {VIDEO_MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`${inputBarShellStyles.modelMenuItem} ${m.id === model ? inputBarShellStyles.modelMenuItemActive : ""}`}
            onClick={() => {
              setModel(m.id);
              // Lite doesn't support 4k — fall back to 720p
              if (m.id.includes("lite") && resolution === "4k") {
                setResolution("720p");
              }
              close();
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    ),
    [model, setModel, resolution, setResolution],
  );

  return (
    <div className={styles.container}>
      <VideoPreview />
      <div className={styles.inputArea}>
        <InputBarShell
          ref={shellRef}
          value={prompt}
          onValueChange={setPrompt}
          onSubmit={handleGenerate}
          onStop={handleStop}
          isStreaming={isGenerating}
          disabled={!selectedProjectId}
          isSendEnabled={prompt.trim().length > 0 && !!selectedProjectId}
          placeholder={selectedProjectId ? "Describe a video to generate..." : "Select a project first"}
          infoBarEnd={
            <>
              {projectName && (
                <span className={styles.projectLabel}>
                  <FolderOpen size={10} />
                  {projectName}
                </span>
              )}
              <ModelPicker
                selectedLabel={resolution}
                isInteractive
                renderMenu={renderResolutionMenu}
              />
              <ModelPicker
                selectedLabel={`${durationSeconds}s`}
                isInteractive
                renderMenu={renderDurationMenu}
              />
              <ModelPicker
                selectedLabel={modelLabel}
                isInteractive={VIDEO_MODELS.length > 1}
                renderMenu={renderModelMenu}
              />
            </>
          }
        />
      </div>
    </div>
  );
}
