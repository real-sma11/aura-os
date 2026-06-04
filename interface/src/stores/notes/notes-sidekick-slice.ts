import type { StateCreator } from "zustand";
import { clearLastNote, setLastNote } from "../../utils/storage";
import type { NotesStore } from "./notes-store";

export type SidekickTab = "toc" | "info" | "comments";

export interface SidekickSlice {
  activeProjectId: string | null;
  activeNoteId: string | null;
  sidekickTab: SidekickTab;
  selectNote: (projectId: string, noteId: string | null) => void;
  setSidekickTab: (tab: SidekickTab) => void;
}

/**
 * Sidekick slice — owns the active-note pointer (`activeProjectId` /
 * `activeNoteId`) and the sidekick-tab toggle. `selectNote` reaches
 * into the content + comments slices via `get()` to warm their caches
 * so a freshly-clicked note paints immediately.
 */
export const createSidekickSlice: StateCreator<
  NotesStore,
  [],
  [],
  SidekickSlice
> = (set, get) => ({
  activeProjectId: null,
  activeNoteId: null,
  sidekickTab: "toc",

  selectNote: (projectId, noteId) => {
    set({ activeProjectId: projectId, activeNoteId: noteId });
    if (noteId) {
      setLastNote({ projectId, noteId });
      // Fire-and-forget: each action updates its own slice on success and
      // swallows/logs errors. We attach `.catch` so an unhandled rejection
      // can't crash the app.
      get()
        .readNote(projectId, noteId)
        .catch((err) => console.warn("readNote after selectNote failed", err));
      get()
        .loadComments(projectId, noteId)
        .catch((err) =>
          console.warn("loadComments after selectNote failed", err),
        );
    } else {
      clearLastNote();
    }
  },

  setSidekickTab: (sidekickTab) => set({ sidekickTab }),
});
