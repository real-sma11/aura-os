import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  useActiveNoteKey,
  useNotesStore,
} from "../../../stores/notes-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { getLastNote } from "../../../utils/storage";
import type { NotesProjectTree } from "../../../stores/notes-store";

/** Sort notes by `sortOrder` then title, returning the first note's id. */
function firstNoteId(tree: NotesProjectTree): string | null {
  if (tree.notes.length === 0) return null;
  const sorted = [...tree.notes].sort((a, b) => {
    const ao = a.sortOrder ?? 0;
    const bo = b.sortOrder ?? 0;
    if (ao !== bo) return ao - bo;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });
  return sorted[0]?.id ?? null;
}

function treeContainsNote(tree: NotesProjectTree, noteId: string): boolean {
  return tree.notes.some((n) => n.id === noteId);
}

/**
 * Route element mounted at `/notes` and `/notes/:projectId`. Picks a
 * sensible note to display and redirects to its canonical URL:
 *   1. The session-active note from the notes store.
 *   2. The last note persisted in localStorage, if it still exists.
 *   3. The first note found in any project's loaded tree.
 */
export function NotesIndexRedirect() {
  const navigate = useNavigate();
  const params = useParams<{ projectId: string }>();
  const activeKey = useActiveNoteKey();
  const trees = useNotesStore((s) => s.trees);
  const projects = useProjectsListStore((s) => s.projects);

  useEffect(() => {
    if (activeKey?.projectId && activeKey.noteId) {
      navigate(
        `/notes/${activeKey.projectId}/${encodeURIComponent(activeKey.noteId)}`,
        { replace: true },
      );
      return;
    }

    const stored = getLastNote();
    if (stored) {
      const tree = trees[stored.projectId];
      if (tree && !tree.loading && treeContainsNote(tree, stored.noteId)) {
        navigate(
          `/notes/${stored.projectId}/${encodeURIComponent(stored.noteId)}`,
          { replace: true },
        );
        return;
      }
      if (tree?.loading) return;
    }

    const orderedProjects = params.projectId
      ? [
          ...projects.filter((p) => p.project_id === params.projectId),
          ...projects.filter((p) => p.project_id !== params.projectId),
        ]
      : projects;

    for (const project of orderedProjects) {
      const tree = trees[project.project_id];
      if (!tree || tree.loading) continue;
      const first = firstNoteId(tree);
      if (first) {
        navigate(
          `/notes/${project.project_id}/${encodeURIComponent(first)}`,
          { replace: true },
        );
        return;
      }
    }
  }, [activeKey, trees, projects, params.projectId, navigate]);

  return null;
}
