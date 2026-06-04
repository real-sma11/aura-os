import { apiFetch } from "./core";

/**
 * A note row as returned by the storage-backed notes API. Mirrors
 * `aura-os-storage`'s `StorageNote` (camelCase). The markdown BODY is
 * NOT inlined — it lives on S3 and is referenced by `bodyUrl` /
 * `bodyS3Key`; fetch the body with a plain `fetch(bodyUrl)`.
 */
export interface Note {
  id: string;
  projectId?: string | null;
  orgId?: string | null;
  folderId?: string | null;
  title?: string | null;
  slug?: string | null;
  sortOrder?: number | null;
  wordCount?: number | null;
  bodyUrl?: string | null;
  bodyS3Key?: string | null;
  status?: string | null;
  blogType?: string | null;
  excerpt?: string | null;
  heroImageUrl?: string | null;
  readTimeMinutes?: number | null;
  publishedAt?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  sections?: unknown;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** A note folder. Folders nest via `parentId` (null = project root). */
export interface NoteFolder {
  id: string;
  projectId?: string | null;
  orgId?: string | null;
  parentId?: string | null;
  name?: string | null;
  sortOrder?: number | null;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** A single comment on a note. */
export interface NoteComment {
  id: string;
  noteId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  body?: string | null;
  createdAt?: string | null;
}

/** `{ folders, notes }` payload returned by the tree endpoint. */
export interface NoteTreeResponse {
  folders: NoteFolder[];
  notes: Note[];
}

/** Partial note patch accepted by `updateNote`. */
export interface UpdateNotePayload {
  title?: string;
  folderId?: string | null;
  slug?: string;
  bodyUrl?: string;
  bodyS3Key?: string;
  wordCount?: number;
  blogType?: string;
  excerpt?: string;
  heroImageUrl?: string;
  readTimeMinutes?: number;
  sortOrder?: number;
  sections?: unknown;
}

/** Partial folder patch accepted by `updateFolder`. */
export interface UpdateFolderPayload {
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
}

export type NoteStatus = "draft" | "published";

function projectPath(projectId: string, suffix: string): string {
  return `/api/notes/projects/${encodeURIComponent(projectId)}${suffix}`;
}

export const notesApi = {
  tree: (projectId: string) =>
    apiFetch<NoteTreeResponse>(projectPath(projectId, "/tree")),

  getNote: (projectId: string, noteId: string) =>
    apiFetch<Note>(
      projectPath(projectId, `/notes/${encodeURIComponent(noteId)}`),
    ),

  createNote: (
    projectId: string,
    body: { title: string; slug?: string; folderId?: string | null },
  ) =>
    apiFetch<Note>(projectPath(projectId, "/notes"), {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateNote: (projectId: string, noteId: string, body: UpdateNotePayload) =>
    apiFetch<Note>(
      projectPath(projectId, `/notes/${encodeURIComponent(noteId)}`),
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  transitionNote: (projectId: string, noteId: string, status: NoteStatus) =>
    apiFetch<Note>(
      projectPath(projectId, `/notes/${encodeURIComponent(noteId)}/transition`),
      {
        method: "POST",
        body: JSON.stringify({ status }),
      },
    ),

  deleteNote: (projectId: string, noteId: string) =>
    apiFetch<void>(
      projectPath(projectId, `/notes/${encodeURIComponent(noteId)}`),
      { method: "DELETE" },
    ),

  createFolder: (
    projectId: string,
    body: { name: string; parentId?: string | null; sortOrder?: number },
  ) =>
    apiFetch<NoteFolder>(projectPath(projectId, "/folders"), {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateFolder: (
    projectId: string,
    folderId: string,
    body: UpdateFolderPayload,
  ) =>
    apiFetch<NoteFolder>(
      projectPath(projectId, `/folders/${encodeURIComponent(folderId)}`),
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  deleteFolder: (projectId: string, folderId: string) =>
    apiFetch<void>(
      projectPath(projectId, `/folders/${encodeURIComponent(folderId)}`),
      { method: "DELETE" },
    ),

  listComments: (projectId: string, noteId: string) =>
    apiFetch<NoteComment[]>(
      projectPath(projectId, `/notes/${encodeURIComponent(noteId)}/comments`),
    ),

  addComment: (
    projectId: string,
    noteId: string,
    body: string,
    authorName?: string,
  ) =>
    apiFetch<NoteComment>(
      projectPath(projectId, `/notes/${encodeURIComponent(noteId)}/comments`),
      {
        method: "POST",
        body: JSON.stringify({ body, authorName }),
      },
    ),

  deleteComment: (projectId: string, noteId: string, commentId: string) =>
    apiFetch<void>(
      projectPath(
        projectId,
        `/notes/${encodeURIComponent(noteId)}/comments/${encodeURIComponent(commentId)}`,
      ),
      { method: "DELETE" },
    ),
};
