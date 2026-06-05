import type { ReactNode } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  Loader2,
  Search,
  Terminal,
} from "lucide-react";
import styles from "./MockProjectsWorkspace.module.css";

/*
 * Static, non-interactive mock of the app's Projects workspace,
 * rendered as the center content of the `MockAuraApp` chrome on the
 * `/code` marketing page (in place of the landing's scripted DM
 * windows). It reproduces the *shape* of the real Projects app — a
 * left project/file explorer, a main work surface with an agent
 * status bar + task feed, a terminal/log strip, and a right sidekick
 * rail — using placeholder copy. Content fidelity is intentionally
 * deferred; this pass only locks the layout.
 *
 * The whole subtree is `aria-hidden`: like the rest of the mock
 * desktop chrome it's decorative atmosphere, not interactive content,
 * and the page's accessible name is carried by the `PageHero` above
 * it.
 */

interface TreeRow {
  readonly label: string;
  readonly depth: number;
  readonly kind: "folder-open" | "folder" | "file";
  readonly active?: boolean;
}

const EXPLORER_ROWS: readonly TreeRow[] = [
  { label: "aura-os", depth: 0, kind: "folder-open" },
  { label: "src", depth: 1, kind: "folder-open" },
  { label: "components", depth: 2, kind: "folder" },
  { label: "App.tsx", depth: 2, kind: "file", active: true },
  { label: "main.tsx", depth: 2, kind: "file" },
  { label: "public", depth: 1, kind: "folder" },
  { label: "package.json", depth: 1, kind: "file" },
  { label: "README.md", depth: 1, kind: "file" },
];

type TaskStatus = "done" | "active" | "queued";

interface TaskRow {
  readonly title: string;
  readonly status: TaskStatus;
}

const TASK_ROWS: readonly TaskRow[] = [
  { title: "Scaffold project structure", status: "done" },
  { title: "Wire up authentication flow", status: "done" },
  { title: "Build the dashboard layout", status: "active" },
  { title: "Add billing integration", status: "queued" },
  { title: "Write end-to-end tests", status: "queued" },
];

const TERMINAL_LINES: readonly string[] = [
  "$ aura run --loop",
  "› planning next task…",
  "› editing src/App.tsx",
  "› tests passing (42/42)",
];

function TaskStatusGlyph({ status }: { status: TaskStatus }): ReactNode {
  if (status === "done") {
    return <CheckCircle2 size={14} className={styles.statusDone} />;
  }
  if (status === "active") {
    return <Loader2 size={14} className={styles.statusActive} />;
  }
  return <Circle size={14} className={styles.statusQueued} />;
}

export function MockProjectsWorkspace(): ReactNode {
  return (
    <div
      className={styles.workspace}
      data-testid="mock-projects-workspace"
      aria-hidden="true"
    >
      <aside className={styles.explorer}>
        <div className={styles.explorerHeader}>
          <span className={styles.explorerTitle}>Projects</span>
          <Search size={13} className={styles.explorerSearch} />
        </div>
        <div className={styles.tree}>
          {EXPLORER_ROWS.map((row, index) => (
            <div
              key={`${row.label}-${index}`}
              className={`${styles.treeRow} ${row.active ? styles.treeRowActive : ""}`}
              style={{ paddingLeft: `${8 + row.depth * 14}px` }}
            >
              {row.kind === "folder-open" ? (
                <FolderOpen size={13} className={styles.treeIcon} />
              ) : row.kind === "folder" ? (
                <Folder size={13} className={styles.treeIcon} />
              ) : (
                <FileCode2 size={13} className={styles.treeIcon} />
              )}
              <span className={styles.treeLabel}>{row.label}</span>
            </div>
          ))}
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.statusBar}>
          <span className={styles.statusBadge}>
            <span className={styles.statusDot} />
            Connected
          </span>
          <span className={styles.statusMeta}>
            Agent:&nbsp;<strong>Builder</strong>
          </span>
          <span className={styles.statusBranch}>
            <GitBranch size={12} />
            main
          </span>
          <span className={styles.statusSpacer} />
          <span className={styles.statusMeta}>Working on: dashboard layout</span>
        </div>

        <div className={styles.feed}>
          <div className={styles.feedHeader}>
            <span>Task Feed</span>
            <ChevronDown size={13} className={styles.feedChevron} />
          </div>
          <div className={styles.feedList}>
            {TASK_ROWS.map((task) => (
              <div
                key={task.title}
                className={`${styles.taskRow} ${task.status === "active" ? styles.taskRowActive : ""}`}
              >
                <TaskStatusGlyph status={task.status} />
                <span className={styles.taskTitle}>{task.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.terminal}>
          <div className={styles.terminalHeader}>
            <Terminal size={12} />
            <span>Terminal</span>
          </div>
          <div className={styles.terminalBody}>
            {TERMINAL_LINES.map((line, index) => (
              <span key={index} className={styles.terminalLine}>
                {line}
              </span>
            ))}
          </div>
        </div>
      </main>

      <aside className={styles.sidekick}>
        <div className={styles.sidekickTabs}>
          <span className={styles.sidekickTabActive}>Plan</span>
          <span className={styles.sidekickTab}>Files</span>
          <span className={styles.sidekickTab}>Preview</span>
        </div>
        <div className={styles.sidekickBody}>
          <div className={styles.sidekickCard} />
          <div className={styles.sidekickCardShort} />
          <div className={styles.sidekickCard} />
          <div className={styles.sidekickCardShort} />
        </div>
      </aside>
    </div>
  );
}
