import { useCallback, useRef, useState } from "react";
import { Spinner } from "@cypher-asi/zui";
import { Film } from "lucide-react";
import { useAuraVideoStore } from "../../../stores/auravideo-store";
import { generateVideoStream } from "../../../api/streams";
import { VIDEO_MODELS } from "../../../constants/models";
import {
  InputBarShell,
  ModelPicker,
  inputBarShellStyles,
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
  const resolution = useAuraVideoStore((s) => s.resolution);
  const generateAudio = useAuraVideoStore((s) => s.generateAudio);
  const isGenerating = useAuraVideoStore((s) => s.isGenerating);
  const selectedProjectId = useAuraVideoStore((s) => s.selectedProjectId);
  const setGenerating = useAuraVideoStore((s) => s.setGenerating);
  const setProgress = useAuraVideoStore((s) => s.setProgress);
  const setError = useAuraVideoStore((s) => s.setError);
  const completeGeneration = useAuraVideoStore((s) => s.completeGeneration);

  const shellRef = useRef<{ focus: () => void; getTextarea: () => HTMLTextAreaElement | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showAllModels, setShowAllModels] = useState(false);

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
        onEvent: (_type, data) => {
          const event = data as Record<string, unknown>;
          const eventType =
            (event.type as string) ??
            (event.mode as string) ??
            _type;

          if (eventType === "generation_progress" || eventType === "progress") {
            const percent = (event.percent as number) ?? 0;
            const message = (event.message as string) ?? "";
            setProgress(percent, message);
          }

          if (eventType === "generation_completed" || eventType === "completed") {
            const videoUrl = (event.videoUrl as string) ?? (event.video_url as string) ?? "";
            if (videoUrl) {
              completeGeneration({
                id: crypto.randomUUID(),
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
          }

          if (eventType === "generation_error" || eventType === "error") {
            const message = (event.message as string) ?? "Video generation failed";
            setError(message);
          }
        },
        onError: (err) => {
          if (controller.signal.aborted) return;
          setError(err.message || "Video generation failed");
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
              close();
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    ),
    [model, setModel],
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
          isSendEnabled={prompt.trim().length > 0}
          placeholder="Describe a video to generate..."
          infoBarEnd={
            <ModelPicker
              selectedLabel={modelLabel}
              isInteractive={VIDEO_MODELS.length > 1}
              renderMenu={renderModelMenu}
              onOpen={() => setShowAllModels(false)}
            />
          }
        />
      </div>
    </div>
  );
}
