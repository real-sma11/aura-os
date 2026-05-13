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
  const setAspectRatio = useAuraVideoStore((s) => s.setAspectRatio);
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

  // Provider detection
  const isSeedance = model.startsWith("dreamina-seedance");
  const isSeedanceFast = isSeedance && model.includes("fast");
  const isVeoLite = !isSeedance && model.includes("lite");

  // Resolution options (provider-specific, verified from official docs)
  // Veo: 720p, 1080p, 4k (Lite: 720p, 1080p only)
  // Seedance 2.0: 480p, 720p, 1080p (Fast: 480p, 720p only)
  const resolutionOptions = isSeedance
    ? isSeedanceFast
      ? ["480p", "720p"]
      : ["480p", "720p", "1080p"]
    : isVeoLite
      ? ["720p", "1080p"]
      : ["720p", "1080p", "4k"];

  // Duration options (provider-specific, verified from official docs)
  // Veo: 4/6/8s at 720p, 8s only at 1080p/4k
  // Seedance: 4-15s at all resolutions
  const durationOptions = isSeedance
    ? [4, 5, 6, 8, 10, 12, 15]
    : resolution === "720p"
      ? [4, 6, 8]
      : [8];

  // Aspect ratio options (Seedance only, verified from official docs)
  const ratioOptions = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

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
              // Veo: non-720p resolutions only support 8s
              if (!isSeedance && r !== "720p") setDurationSeconds(8);
              close();
            }}
          >
            {r}
          </button>
        ))}
      </div>
    ),
    [resolution, setResolution, setDurationSeconds, resolutionOptions, isSeedance],
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

  const renderRatioMenu = useCallback(
    (close: () => void) => (
      <div className={inputBarShellStyles.modelMenu}>
        {ratioOptions.map((r) => (
          <button
            key={r}
            type="button"
            className={`${inputBarShellStyles.modelMenuItem} ${r === aspectRatio ? inputBarShellStyles.modelMenuItemActive : ""}`}
            onClick={() => {
              setAspectRatio(r);
              close();
            }}
          >
            {r}
          </button>
        ))}
      </div>
    ),
    [aspectRatio, setAspectRatio, ratioOptions],
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
              const switchingToSeedance = m.id.startsWith("dreamina-seedance");
              const switchingFromSeedance = isSeedance;
              const switchingToSeedanceFast = switchingToSeedance && m.id.includes("fast");
              const switchingToVeoLite = !switchingToSeedance && m.id.includes("lite");

              setModel(m.id);

              // Resolution adjustments on model switch
              if (switchingToSeedance && resolution === "4k") {
                setResolution("720p");
              } else if (switchingToSeedanceFast && resolution === "1080p") {
                setResolution("720p");
              } else if (!switchingToSeedance && switchingFromSeedance && resolution === "480p") {
                setResolution("720p");
              } else if (switchingToVeoLite && resolution === "4k") {
                setResolution("720p");
              }

              // Reset ratio to 16:9 when switching to Veo (Veo hardcodes 16:9)
              if (!switchingToSeedance && switchingFromSeedance && aspectRatio !== "16:9") {
                setAspectRatio("16:9");
              }

              // Clamp duration when switching providers
              if (switchingToSeedance && !switchingFromSeedance && durationSeconds > 15) {
                setDurationSeconds(15);
              } else if (!switchingToSeedance && switchingFromSeedance && durationSeconds > 8) {
                setDurationSeconds(8);
              }

              close();
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    ),
    [model, setModel, resolution, setResolution, aspectRatio, setAspectRatio, durationSeconds, setDurationSeconds, isSeedance],
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
              {isSeedance && (
                <ModelPicker
                  selectedLabel={aspectRatio}
                  isInteractive
                  renderMenu={renderRatioMenu}
                />
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
