import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import type { useProjectListActions } from "../../../hooks/use-project-list-actions";
import type { Project } from "../../../shared/types";
import { useNotesStore } from "../../../stores/notes-store";
import { parseNotesExplorerId } from "./notes-explorer-ids";

export interface NotesEntryTarget {
  kind: "note" | "folder";
  projectId: string;
  /** The noteId or folderId of the targeted entry. */
  id: string;
  name: string;
}

export interface NotesCtxMenuState {
  x: number;
  y: number;
  target: NotesEntryTarget;
}

type ProjectActions = ReturnType<typeof useProjectListActions>;

interface Options {
  projectActions: ProjectActions;
  projectMap: Map<string, Project>;
}

export interface NotesContextMenuApi {
  ctxMenu: NotesCtxMenuState | null;
  ctxMenuRef: RefObject<HTMLDivElement | null>;
  handleContextMenu: (e: ReactMouseEvent) => void;
  handleKeyDown: (e: ReactKeyboardEvent) => void;
  handleMenuAction: (actionId: string) => void;
  renameTarget: NotesEntryTarget | null;
  setRenameTarget: (target: NotesEntryTarget | null) => void;
  handleRenameSave: (newName: string) => Promise<void>;
  deleteTarget: NotesEntryTarget | null;
  setDeleteTarget: (target: NotesEntryTarget | null) => void;
  deleteLoading: boolean;
  deleteError: string | null;
  setDeleteError: (error: string | null) => void;
  handleDelete: () => Promise<void>;
}

/**
 * Resolve the display name of a note/folder from the loaded tree. Notes
 * fall back to "Untitled" and folders to "Untitled folder" when the row
 * has no title/name yet.
 */
function resolveEntryName(
  projectId: string,
  kind: "note" | "folder",
  id: string,
): string {
  const tree = useNotesStore.getState().trees[projectId];
  if (!tree) return kind === "folder" ? "Untitled folder" : "Untitled";
  if (kind === "note") {
    const note = tree.notes.find((n) => n.id === id);
    return note?.title?.trim() || "Untitled";
  }
  const folder = tree.folders.find((f) => f.id === id);
  return folder?.name?.trim() || "Untitled folder";
}

export function useNotesContextMenu({
  projectActions,
  projectMap,
}: Options): NotesContextMenuApi {
  const navigate = useNavigate();
  const renameEntry = useNotesStore((s) => s.renameEntry);
  const deleteEntry = useNotesStore((s) => s.deleteEntry);
  const createNote = useNotesStore((s) => s.createNote);
  const createFolder = useNotesStore((s) => s.createFolder);

  const [ctxMenu, setCtxMenu] = useState<NotesCtxMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<NotesEntryTarget | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<NotesEntryTarget | null>(
    null,
  );
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const ctxMenuStateRef = useRef(ctxMenu);
  ctxMenuStateRef.current = ctxMenu;

  useEffect(() => {
    if (!ctxMenu) return;
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(target)) {
        setCtxMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctxMenu]);

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button[id]");
      if (!button) return;
      const parsed = parseNotesExplorerId(button.id);
      if (!parsed) return;

      if (parsed.kind === "project") {
        const project = projectMap.get(parsed.projectId);
        if (!project) return;
        e.preventDefault();
        projectActions.setCtxMenu({
          x: e.clientX,
          y: e.clientY,
          project,
        });
        return;
      }

      e.preventDefault();
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        target: {
          kind: parsed.kind,
          projectId: parsed.projectId,
          id: parsed.id,
          name: resolveEntryName(parsed.projectId, parsed.kind, parsed.id),
        },
      });
    },
    [projectActions, projectMap],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key !== "F2") return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const focused = target.closest("button[id]");
      if (!focused) return;
      const parsed = parseNotesExplorerId(focused.id);
      if (!parsed) return;
      if (parsed.kind === "project") {
        const project = projectMap.get(parsed.projectId);
        if (project) {
          e.preventDefault();
          projectActions.setRenameTarget(project);
        }
        return;
      }
      e.preventDefault();
      setRenameTarget({
        kind: parsed.kind,
        projectId: parsed.projectId,
        id: parsed.id,
        name: resolveEntryName(parsed.projectId, parsed.kind, parsed.id),
      });
    },
    [projectActions, projectMap],
  );

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const menu = ctxMenuStateRef.current;
      if (!menu) return;
      const target = menu.target;
      setCtxMenu(null);

      if (actionId === "rename") {
        setRenameTarget(target);
        return;
      }
      if (actionId === "delete") {
        setDeleteTarget(target);
        setDeleteError(null);
        return;
      }
      if (actionId === "new-note" && target.kind === "folder") {
        void createNote(target.projectId, target.id).then((res) => {
          if (res) {
            navigate(
              `/notes/${target.projectId}/${encodeURIComponent(res.noteId)}`,
            );
          }
        });
        return;
      }
      if (actionId === "new-folder" && target.kind === "folder") {
        const name = window.prompt("New folder name");
        if (!name || !name.trim()) return;
        void createFolder(target.projectId, target.id, name.trim());
      }
    },
    [createFolder, createNote, navigate],
  );

  const handleRenameSave = useCallback(
    async (newName: string) => {
      const target = renameTarget;
      setRenameTarget(null);
      if (!target) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === target.name) return;
      await renameEntry(target.projectId, target.kind, target.id, trimmed);
    },
    [renameEntry, renameTarget],
  );

  const handleDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await deleteEntry(target.projectId, target.kind, target.id);
      // If the active note no longer exists after the delete (e.g. it lived
      // inside a deleted folder), clear the stale selection.
      const { activeProjectId, activeNoteId, trees } = useNotesStore.getState();
      if (activeProjectId === target.projectId && activeNoteId) {
        const tree = trees[target.projectId];
        const stillExists = tree?.notes.some((n) => n.id === activeNoteId);
        if (!stillExists) {
          useNotesStore.getState().selectNote(target.projectId, null);
        }
      }
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete entry",
      );
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteEntry, deleteTarget]);

  return {
    ctxMenu,
    ctxMenuRef,
    handleContextMenu,
    handleKeyDown,
    handleMenuAction,
    renameTarget,
    setRenameTarget,
    handleRenameSave,
    deleteTarget,
    setDeleteTarget,
    deleteLoading,
    deleteError,
    setDeleteError,
    handleDelete,
  };
}
