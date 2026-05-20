import { useEffect, useState } from "react";
import { api, type DirEntry } from "../../../api/client";

export interface ProjectFile {
  name: string;
  path: string;
  relativePath: string;
}

function relativeTo(path: string, root: string): string {
  const normRoot = root.replace(/[\\/]+$/, "");
  if (path === normRoot) return "";
  if (path.startsWith(normRoot)) {
    return path.slice(normRoot.length).replace(/^[\\/]/, "");
  }
  return path;
}

function flattenEntries(entries: DirEntry[], root: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  const walk = (nodes: DirEntry[]) => {
    for (const n of nodes) {
      if (!n.is_dir) {
        out.push({
          name: n.name,
          path: n.path,
          relativePath: relativeTo(n.path, root),
        });
      }
      if (n.children) walk(n.children);
    }
  };
  walk(entries);
  return out;
}

/**
 * Lightweight one-shot fetch of the project's file tree, flattened to
 * a list of files for @-mention autocomplete in the chat input.
 *
 * Intentionally separate from `useFileExplorerState` (which owns its
 * own polling, expand state, ZUI tree shape, and selection callbacks)
 * — the input bar only needs a flat searchable file list.
 *
 * Refetches on `refreshNonce` so the input bar can pull fresh entries
 * when the user re-opens the mention menu without paying the cost of
 * a 3s polling loop while the menu is closed.
 */
export function useProjectFiles({
  workspacePath,
  remoteAgentId,
  refreshNonce = 0,
}: {
  workspacePath?: string;
  remoteAgentId?: string;
  refreshNonce?: number;
}): ProjectFile[] {
  const [files, setFiles] = useState<ProjectFile[]>([]);

  useEffect(() => {
    if (!workspacePath) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    const fetchPromise = remoteAgentId
      ? api.swarm.listRemoteDirectory(remoteAgentId, workspacePath)
      : api.listDirectory(workspacePath);
    fetchPromise
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.entries) {
          setFiles(flattenEntries(res.entries, workspacePath));
        } else {
          setFiles([]);
        }
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, remoteAgentId, refreshNonce]);

  return files;
}

const MENTION_RESULT_LIMIT = 25;

/**
 * Substring filter ranked so basename-prefix matches beat basename
 * substring matches beat path substring matches. Ties break on
 * shorter relative path (closer-to-root files win).
 */
export function filterProjectFiles(
  files: ProjectFile[],
  query: string,
  limit = MENTION_RESULT_LIMIT,
): ProjectFile[] {
  if (!query) {
    return files
      .slice()
      .sort((a, b) => a.relativePath.length - b.relativePath.length)
      .slice(0, limit);
  }
  const q = query.toLowerCase();
  const matches: { file: ProjectFile; score: number }[] = [];
  for (const f of files) {
    const name = f.name.toLowerCase();
    const rel = f.relativePath.toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 2;
    else if (rel.includes(q)) score = 1;
    if (score >= 0) matches.push({ file: f, score });
  }
  matches.sort(
    (a, b) =>
      b.score - a.score || a.file.relativePath.length - b.file.relativePath.length,
  );
  return matches.slice(0, limit).map((m) => m.file);
}
