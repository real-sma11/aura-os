import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, FileText, FolderClosed } from "lucide-react";
import type { ExplorerNode } from "@cypher-asi/zui";
import {
  buildLeftMenuEntries,
  LeftMenuTree,
  useLeftMenuExpandedGroups,
  useLeftMenuProjectReorder,
} from "../../../features/left-menu";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useIsSysAdmin } from "../../../stores/auth-store";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import { ProjectsPlusButton } from "../../../components/ProjectsPlusButton/ProjectsPlusButton";
import { ExplorerContextMenu } from "../../../components/ProjectList/ExplorerContextMenu";
import { ProjectListModals } from "../../../components/ProjectList/ProjectListModals";
import { useProjectListActions } from "../../../hooks/use-project-list-actions";
import leftMenuStyles from "../../../features/left-menu/LeftMenuTree/LeftMenuTree.module.css";
import styles from "./NotesNav.module.css";
import {
  useNotesStore,
  type NotesProjectTree,
} from "../../../stores/notes-store";
import type { Note, NoteFolder } from "../../../shared/api/notes";
import {
  folderIdFor,
  noteIdFor,
  parseNotesExplorerId,
  projectIdFor,
} from "./notes-explorer-ids";
import { NotesEntryContextMenu } from "../NotesEntryContextMenu";
import { NotesEntryModals } from "../NotesEntryModals";
import { useNotesContextMenu } from "./useNotesContextMenu";
import {
  AURA_BLOG_PROJECT_ID,
  buildAuraBlogProject,
  isAuraBlogProject,
} from "../aura-blog";
import { seedAuraBlog } from "../seed-aura-blog/run";

/**
 * Draft/Published pill shown as the note's left-nav suffix inside the
 * aura-blog CMS project. Normal notes get no badge.
 */
function blogStatusSuffix(status: string | null | undefined): ExplorerNode["suffix"] {
  const published = status === "published";
  return (
    <span
      className={`${styles.statusBadge} ${
        published ? styles.statusPublished : styles.statusDraft
      }`}
    >
      {published ? "Published" : "Draft"}
    </span>
  );
}

function hoverPlusSuffix(onClick: () => void, title: string): ExplorerNode["suffix"] {
  return (
    <span className={leftMenuStyles.newChatWrap}>
      <ProjectsPlusButton
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }}
        title={title}
      />
    </span>
  );
}

/** Order folders/notes by `sortOrder` (nulls last-ish as 0) then label. */
function compareByOrderThenLabel(
  aOrder: number | null | undefined,
  aLabel: string,
  bOrder: number | null | undefined,
  bLabel: string,
): number {
  const ao = aOrder ?? 0;
  const bo = bOrder ?? 0;
  if (ao !== bo) return ao - bo;
  return aLabel.localeCompare(bLabel);
}

/**
 * Build the ExplorerNode children for a single folder level. Folders nest
 * via `parentId`; notes are placed under their `folderId` (or the project
 * root when `folderId` is null). `parentId === null` builds the project
 * root level. Live edits surface through `titleOverrides` (keyed by noteId).
 */
function buildFolderChildren(
  projectId: string,
  parentId: string | null,
  folders: NoteFolder[],
  notes: Note[],
  titleOverrides: Record<string, string>,
  onCreateInFolder: (folderId: string) => void,
  isBlogProject: boolean,
): ExplorerNode[] {
  const childFolders = folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .map((folder) => {
      const label = folder.name?.trim() || "Untitled folder";
      return { folder, label };
    })
    .sort((a, b) =>
      compareByOrderThenLabel(
        a.folder.sortOrder,
        a.label,
        b.folder.sortOrder,
        b.label,
      ),
    )
    .map(({ folder, label }) => ({
      id: folderIdFor(projectId, folder.id),
      label,
      icon: <FolderClosed size={14} aria-hidden="true" />,
      metadata: { variant: "default", type: "folder" },
      suffix: hoverPlusSuffix(
        () => onCreateInFolder(folder.id),
        `New note in ${label}`,
      ),
      children: buildFolderChildren(
        projectId,
        folder.id,
        folders,
        notes,
        titleOverrides,
        onCreateInFolder,
        isBlogProject,
      ),
    }));

  const childNotes = notes
    .filter((n) => (n.folderId ?? null) === parentId)
    .map((note) => {
      const override = titleOverrides[note.id];
      const label =
        (override && override.trim()) ||
        (note.title && note.title.trim()) ||
        "Untitled";
      return { note, label };
    })
    .sort((a, b) =>
      compareByOrderThenLabel(
        a.note.sortOrder,
        a.label,
        b.note.sortOrder,
        b.label,
      ),
    )
    .map(({ note, label }) => ({
      id: noteIdFor(projectId, note.id),
      label,
      icon: <FileText size={14} aria-hidden="true" />,
      metadata: { type: "note" },
      ...(isBlogProject ? { suffix: blogStatusSuffix(note.status) } : {}),
    }));

  return [...childFolders, ...childNotes];
}

interface NotesNavProps {
  onCreateNote?: (projectId: string, folderId: string | null) => void;
}

export function NotesNav({ onCreateNote }: NotesNavProps = {}) {
  const navigate = useNavigate();
  const isSysAdmin = useIsSysAdmin();
  const storeProjects = useProjectsListStore((s) => s.projects);
  const loadingProjects = useProjectsListStore((s) => s.loadingProjects);
  const refreshProjects = useProjectsListStore((s) => s.refreshProjects);
  const openNewProjectModal = useProjectsListStore((s) => s.openNewProjectModal);
  const refreshedOnce = useRef(false);

  const trees = useNotesStore((s) => s.trees);
  const loadTree = useNotesStore((s) => s.loadTree);
  const selectNote = useNotesStore((s) => s.selectNote);
  const createNote = useNotesStore((s) => s.createNote);
  const activeNoteId = useNotesStore((s) => s.activeNoteId);
  const activeProjectId = useNotesStore((s) => s.activeProjectId);

  // One-time aura-blog seeding (sys admins only). Runs in the authenticated
  // session, so the logged-in user's JWT is threaded automatically.
  const [seeding, setSeeding] = useState(false);
  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const handleSeedBlog = useCallback(async () => {
    if (seeding) return;
    setSeeding(true);
    setSeedStatus("Seeding weekly blog posts…");
    try {
      const results = await seedAuraBlog();
      const created = results.filter((r) => r.status === "created").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const errored = results.filter((r) => r.status === "error").length;
      await loadTree(AURA_BLOG_PROJECT_ID);
      setSeedStatus(
        `Done: ${created} created, ${skipped} skipped${
          errored ? `, ${errored} failed` : ""
        }.`,
      );
    } catch (err) {
      setSeedStatus(
        `Seeding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSeeding(false);
    }
  }, [seeding, loadTree]);

  // The aura-blog CMS project is virtual: it is prepended to the rendered
  // list for sys admins only (never persisted to the projects store), so
  // non-admins never see it. The backend independently gates writes.
  const projects = useMemo(() => {
    if (!isSysAdmin) return storeProjects;
    if (storeProjects.some((p) => isAuraBlogProject(p.project_id))) {
      return storeProjects;
    }
    const orgId = storeProjects[0]?.org_id ?? "";
    return [buildAuraBlogProject(orgId), ...storeProjects];
  }, [storeProjects, isSysAdmin]);

  const { query: sidebarQuery, setAction } = useSidebarSearch("notes");

  const projectActions = useProjectListActions();
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.project_id, p])),
    [projects],
  );
  const notesMenu = useNotesContextMenu({ projectActions, projectMap });

  useEffect(() => {
    if (!refreshedOnce.current && !loadingProjects && storeProjects.length === 0) {
      refreshedOnce.current = true;
      void refreshProjects();
    }
  }, [storeProjects.length, loadingProjects, refreshProjects]);

  useEffect(() => {
    for (const project of projects) {
      if (!trees[project.project_id]) {
        void loadTree(project.project_id);
      }
    }
  }, [projects, trees, loadTree]);

  const defaultExpandedIds = useMemo(() => {
    return projects.map((project) => projectIdFor(project.project_id));
  }, [projects]);

  const { expandedIds, toggleGroup } = useLeftMenuExpandedGroups(defaultExpandedIds);
  const expandedIdsSet = useMemo(() => new Set(expandedIds), [expandedIds]);

  const handleCreateNote = useCallback(
    (projectId: string, folderId: string | null) => {
      if (onCreateNote) {
        onCreateNote(projectId, folderId);
        return;
      }
      void createNote(projectId, folderId).then((result) => {
        if (result) {
          void import("../../../lib/analytics").then(({ track }) => track("note_created"));
          navigate(`/notes/${projectId}/${encodeURIComponent(result.noteId)}`);
        }
      });
    },
    [createNote, navigate, onCreateNote],
  );

  const data = useMemo<ExplorerNode[]>(() => {
    return projects.map((project) => {
      const projectId = project.project_id;
      const isBlogProject = isAuraBlogProject(projectId);
      const tree: NotesProjectTree | undefined = trees[projectId];
      const children = tree
        ? buildFolderChildren(
            projectId,
            null,
            tree.folders,
            tree.notes,
            tree.titleOverrides,
            (folderId) => handleCreateNote(projectId, folderId),
            isBlogProject,
          )
        : [];
      return {
        id: projectIdFor(projectId),
        label: project.name,
        children,
        suffix: hoverPlusSuffix(
          () => handleCreateNote(projectId, null),
          `New note in ${project.name}`,
        ),
        metadata: {
          variant: "default",
          type: "project",
        },
      };
    });
  }, [projects, trees, handleCreateNote]);

  useEffect(() => {
    setAction(
      "notes",
      <ProjectsPlusButton
        onClick={openNewProjectModal}
        title="New Project"
      />,
    );
    return () => setAction("notes", null);
  }, [openNewProjectModal, setAction]);

  const selectedLeafId = useMemo<string | null>(() => {
    if (!activeProjectId || !activeNoteId) return null;
    return noteIdFor(activeProjectId, activeNoteId);
  }, [activeProjectId, activeNoteId]);

  const entries = useMemo(
    () =>
      buildLeftMenuEntries(data, {
        expandedIds: expandedIdsSet,
        onGroupActivate: (id) => {
          const parsed = parseNotesExplorerId(id);
          if (parsed?.kind === "project" || parsed?.kind === "folder") {
            toggleGroup(id);
          }
        },
        onGroupToggle: (id) => toggleGroup(id),
        groupToggleMode: "secondary",
        onItemSelect: (id) => {
          const parsed = parseNotesExplorerId(id);
          if (parsed?.kind === "note") {
            selectNote(parsed.projectId, parsed.id);
            navigate(
              `/notes/${parsed.projectId}/${encodeURIComponent(parsed.id)}`,
            );
          }
        },
        selectedNodeId: selectedLeafId,
        selectedGroupIds: new Set<string>(),
      }),
    [data, expandedIdsSet, selectedLeafId, toggleGroup, selectNote, navigate],
  );

  const resolveNotesProjectId = useCallback((entryId: string) => {
    const parsed = parseNotesExplorerId(entryId);
    return parsed?.kind === "project" ? parsed.projectId : null;
  }, []);
  const rootReorder = useLeftMenuProjectReorder(entries, {
    searchActive: sidebarQuery.trim().length > 0,
    resolveProjectId: resolveNotesProjectId,
  });

  return (
    <div className={styles.root}>
      {isSysAdmin ? (
        <div className={styles.seedBar}>
          <button
            type="button"
            className={styles.seedButton}
            disabled={seeding}
            onClick={() => void handleSeedBlog()}
            title="Create and publish the weekly release-recap posts in aura-blog"
          >
            {seeding ? "Seeding…" : "Seed weekly blog posts"}
          </button>
          {seedStatus ? (
            <span className={styles.seedStatus}>{seedStatus}</span>
          ) : null}
        </div>
      ) : null}

      {projects.length === 0 && !loadingProjects ? (
        <div className={styles.emptyState}>
          <ChevronRight size={14} aria-hidden="true" />
          Create a project first to start adding notes.
        </div>
      ) : (
        <LeftMenuTree
          ariaLabel="Notes navigation"
          entries={entries}
          onContextMenu={notesMenu.handleContextMenu}
          onKeyDown={notesMenu.handleKeyDown}
          rootReorder={rootReorder}
        />
      )}

      <ExplorerContextMenu actions={projectActions} />
      <ProjectListModals actions={projectActions} />
      <NotesEntryContextMenu actions={notesMenu} />
      <NotesEntryModals actions={notesMenu} />
    </div>
  );
}
