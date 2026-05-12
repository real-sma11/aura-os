import { create } from "zustand";
import { artifactsApi, type ProjectArtifact } from "../shared/api/artifacts";
import { setLastProject } from "../utils/storage";

export interface GeneratedVideo {
  id: string;
  artifactId?: string;
  prompt: string;
  videoUrl: string;
  model: string;
  durationSeconds: number;
  resolution: string;
  aspectRatio: string;
  createdAt: string;
}

interface AuraVideoState {
  // Project
  selectedProjectId: string | null;

  // Generation
  prompt: string;
  model: string;
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
  generateAudio: boolean;
  isGenerating: boolean;
  progress: number;
  progressMessage: string;
  error: string | null;

  // Results
  currentVideo: GeneratedVideo | null;
  videos: GeneratedVideo[];

  // Actions
  setSelectedProjectId: (id: string | null) => void;
  setPrompt: (prompt: string) => void;
  setModel: (model: string) => void;
  setAspectRatio: (ratio: string) => void;
  setDurationSeconds: (duration: number) => void;
  setResolution: (resolution: string) => void;
  setGenerateAudio: (audio: boolean) => void;
  setGenerating: (generating: boolean) => void;
  setProgress: (percent: number, message: string) => void;
  setError: (error: string | null) => void;
  completeGeneration: (video: GeneratedVideo) => void;
  selectVideo: (id: string) => void;
  deleteVideo: (id: string) => void;
  loadProjectArtifacts: (projectId: string) => Promise<void>;
  saveVideoArtifact: (videoId: string) => Promise<void>;
  reset: () => void;
}

function artifactToVideo(a: ProjectArtifact): GeneratedVideo {
  return {
    id: a.id,
    artifactId: a.id,
    prompt: a.prompt ?? "",
    videoUrl: a.assetUrl ?? "",
    model: a.model ?? "",
    durationSeconds: 8,
    resolution: "720p",
    aspectRatio: "16:9",
    createdAt: a.createdAt ?? new Date().toISOString(),
  };
}

const DEFAULT_MODEL = "veo-3.1-fast-generate-preview";

export const useAuraVideoStore = create<AuraVideoState>()((set, get) => ({
  selectedProjectId: null,
  prompt: "",
  model: DEFAULT_MODEL,
  aspectRatio: "16:9",
  durationSeconds: 8,
  resolution: "720p",
  generateAudio: true,
  isGenerating: false,
  progress: 0,
  progressMessage: "",
  error: null,
  currentVideo: null,
  videos: [],

  setSelectedProjectId: (id) => {
    set({ selectedProjectId: id, currentVideo: null, videos: [], error: null });
    if (id) {
      setLastProject(id);
      void get().loadProjectArtifacts(id);
    }
  },

  setPrompt: (prompt) => set({ prompt }),
  setModel: (model) => set({ model }),
  setAspectRatio: (ratio) => set({ aspectRatio: ratio }),
  setDurationSeconds: (duration) => set({ durationSeconds: duration }),
  setResolution: (resolution) => set({ resolution }),
  setGenerateAudio: (audio) => set({ generateAudio: audio }),

  setGenerating: (generating) =>
    set({ isGenerating: generating, error: null, progress: 0, progressMessage: "" }),

  setProgress: (percent, message) =>
    set({ progress: percent, progressMessage: message }),

  setError: (error) => set({ error, isGenerating: false }),

  completeGeneration: (video) =>
    set((s) => ({
      isGenerating: false,
      progress: 100,
      progressMessage: "",
      currentVideo: video,
      videos: [video, ...s.videos],
      prompt: "",
    })),

  selectVideo: (id) => {
    const video = get().videos.find((v) => v.id === id);
    if (video) set({ currentVideo: video });
  },

  deleteVideo: (id) => {
    const { videos, currentVideo } = get();
    const video = videos.find((v) => v.id === id);
    if (video?.artifactId) {
      void artifactsApi.deleteArtifact(video.artifactId).catch(() => {});
    }
    set({
      videos: videos.filter((v) => v.id !== id),
      currentVideo: currentVideo?.id === id ? null : currentVideo,
    });
  },

  loadProjectArtifacts: async (projectId) => {
    try {
      const artifacts = await artifactsApi.listArtifacts(projectId);
      const videoArtifacts = artifacts
        .filter((a) => a.type === "video")
        .map(artifactToVideo);
      set({ videos: videoArtifacts });
    } catch {
      // silent — empty list is fine
    }
  },

  saveVideoArtifact: async (videoId) => {
    const { videos, selectedProjectId } = get();
    const video = videos.find((v) => v.id === videoId);
    if (!video || video.artifactId || !selectedProjectId) return;
    try {
      const artifact = await artifactsApi.createArtifact(selectedProjectId, {
        type: "video",
        name: video.prompt.slice(0, 80) || "Video",
        assetUrl: video.videoUrl,
        prompt: video.prompt,
        model: video.model,
      });
      set({
        videos: videos.map((v) =>
          v.id === videoId ? { ...v, artifactId: artifact.id } : v,
        ),
        currentVideo:
          get().currentVideo?.id === videoId
            ? { ...get().currentVideo!, artifactId: artifact.id }
            : get().currentVideo,
      });
    } catch {
      // silent — video still usable without artifact
    }
  },

  reset: () =>
    set({
      prompt: "",
      isGenerating: false,
      progress: 0,
      progressMessage: "",
      error: null,
      currentVideo: null,
    }),
}));
