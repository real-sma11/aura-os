type NotesExplorerKind = "project" | "folder" | "note";

interface ParsedNotesExplorerId {
  kind: NotesExplorerKind;
  projectId: string;
  /** The folderId or noteId; empty string for a project node. */
  id: string;
}

export function noteIdFor(projectId: string, noteId: string): string {
  return `note::${projectId}::${noteId}`;
}

export function folderIdFor(projectId: string, folderId: string): string {
  return `folder::${projectId}::${folderId}`;
}

export function projectIdFor(projectId: string): string {
  return `project::${projectId}`;
}

export function parseNotesExplorerId(id: string): ParsedNotesExplorerId | null {
  if (id.startsWith("note::")) {
    const body = id.slice("note::".length);
    const sep = body.indexOf("::");
    if (sep === -1) return null;
    return {
      kind: "note",
      projectId: body.slice(0, sep),
      id: body.slice(sep + 2),
    };
  }
  if (id.startsWith("folder::")) {
    const body = id.slice("folder::".length);
    const sep = body.indexOf("::");
    if (sep === -1) return null;
    return {
      kind: "folder",
      projectId: body.slice(0, sep),
      id: body.slice(sep + 2),
    };
  }
  if (id.startsWith("project::")) {
    return {
      kind: "project",
      projectId: id.slice("project::".length),
      id: "",
    };
  }
  return null;
}
