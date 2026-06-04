import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { type Editor, EditorContent, Extension, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import {
  useActiveNote,
  useActiveNoteKey,
  useNotesStore,
} from "../../../stores/notes-store";
import { BubbleToolbar } from "./BubbleToolbar";
import styles from "./NotesMainPanel.module.css";

/** Narrow a TipTap editor's `storage` field to the slice the markdown
 *  extension adds. `tiptap-markdown` augments it at runtime without
 *  extending the `Editor` type, so this keeps the cast in one place. */
function getMarkdownStorage(editor: Editor): { getMarkdown: () => string } {
  const storage = editor.storage as { markdown?: { getMarkdown: () => string } };
  if (!storage.markdown) {
    throw new Error(
      "tiptap-markdown storage missing — Markdown extension must be registered on the editor.",
    );
  }
  return storage.markdown;
}

type EditMode = "wysiwyg" | "markdown";

/**
 * Supplemental keymap for the note editor.
 *
 * - `Tab` / `Shift-Tab`: sink/lift the current list item regardless of where
 *   the caret sits inside the item (StarterKit only sinks at the very start
 *   of the item, which trips up users who indent mid-word).
 * - `Enter` inside a code block drops out of the block cleanly so the next
 *   line isn't still styled as code. For inline marks like `code` and
 *   `highlight`, we clear them on newline so formatting doesn't bleed across
 *   paragraphs.
 */
const NotesKeymap = Extension.create({
  name: "notesKeymap",
  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.can().sinkListItem("listItem")) {
          return this.editor.chain().focus().sinkListItem("listItem").run();
        }
        return false;
      },
      "Shift-Tab": () => {
        if (this.editor.can().liftListItem("listItem")) {
          return this.editor.chain().focus().liftListItem("listItem").run();
        }
        return false;
      },
      Enter: () => {
        const { editor } = this;
        // Exit fenced code blocks on Enter-on-empty-last-line — TipTap ships
        // `exitCode`, which no-ops when not applicable, so we can try it
        // first and fall through on failure.
        if (editor.isActive("codeBlock") && editor.commands.exitCode()) {
          return true;
        }
        // Shed inline code/highlight marks on newline so the next paragraph
        // starts clean.
        const carryMarks = ["code", "highlight"];
        const activeCarryMarks = carryMarks.filter((m) => editor.isActive(m));
        if (activeCarryMarks.length === 0) return false;
        const chain = editor.chain().focus();
        for (const mark of activeCarryMarks) {
          chain.unsetMark(mark);
        }
        chain.splitBlock();
        for (const mark of activeCarryMarks) {
          chain.unsetMark(mark);
        }
        return chain.run();
      },
    };
  },
});

export function NotesMainPanel({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const params = useParams<{ projectId: string; noteId: string }>();
  const note = useActiveNote();
  const activeKey = useActiveNoteKey();
  const selectNote = useNotesStore((s) => s.selectNote);
  const updateContent = useNotesStore((s) => s.updateContent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const markdownRef = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<EditMode>("wysiwyg");
  const lastSyncedKey = useRef<string | null>(null);

  // Gate the note body on a post-commit layout pass. When mounting after an
  // app switch (e.g. desktop mode → Notes), the sidebar expands in the same
  // commit that mounts us; the `--left-panel-width` CSS variable that
  // `centerColumn` depends on for horizontal positioning is updated in a
  // parent layout effect. React runs child layout effects before parent
  // layout effects, so on the first render our content could paint against
  // a stale variable and flicker in the center before snapping to its final
  // column. We start the column hidden and reveal it via direct DOM mutation
  // in a layout effect, which runs after both our own and the parent's
  // effects have reconciled layout. We mutate the DOM (rather than drive
  // visibility through React state) so we don't trigger a cascading re-render
  // on every mount.
  const centerColumnRef = useRef<HTMLDivElement | null>(null);
  const firstLayoutDoneRef = useRef(false);
  const setCenterColumnRef = useCallback((el: HTMLDivElement | null) => {
    centerColumnRef.current = el;
    if (el && !firstLayoutDoneRef.current) {
      el.style.visibility = "hidden";
    }
  }, []);
  useLayoutEffect(() => {
    if (firstLayoutDoneRef.current) return;
    const el = centerColumnRef.current;
    if (!el) return;
    // Force a style/layout flush so the reveal happens against the final
    // positioning (parent effects have run by now, updating CSS vars).
    el.getBoundingClientRect();
    el.style.visibility = "";
    firstLayoutDoneRef.current = true;
  });

  // Single source of truth for URL <-> store reconciliation. The URL is the
  // authority for "which note is shown": when it changes we pull the store
  // onto it. The store only drives the URL when the URL is stable and
  // activeKey has drifted (a defensive guard kept from the filesystem era).
  const lastUrlSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!params.projectId || !params.noteId) return;
    const decoded = decodeURIComponent(params.noteId);
    const urlKey = `${params.projectId}::${decoded}`;

    if (lastUrlSelectedRef.current !== urlKey) {
      lastUrlSelectedRef.current = urlKey;
      if (
        activeKey?.projectId !== params.projectId ||
        activeKey?.noteId !== decoded
      ) {
        selectNote(params.projectId, decoded);
      }
      return;
    }

    if (
      activeKey &&
      activeKey.projectId === params.projectId &&
      activeKey.noteId !== decoded
    ) {
      navigate(
        `/notes/${activeKey.projectId}/${encodeURIComponent(activeKey.noteId)}`,
        { replace: true },
      );
    }
  }, [params.projectId, params.noteId, activeKey, selectNote, navigate]);

  // When the URL lacks `:noteId`, auto-selection is handled by
  // `NotesIndexRedirect` — which only mounts on `/notes` and
  // `/notes/:projectId` routes. Keeping that logic out of the editor panel
  // prevents it from firing during an outgoing app switch (e.g. Notes →
  // Feedback) and hijacking the new route.

  const body = useMemo(() => note?.content ?? "", [note]);

  // Ref-latched snapshot so the (stable) editor's onUpdate closure always
  // dispatches against the current active note.
  const activeKeyRef = useRef(activeKey);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          codeBlock: { HTMLAttributes: { class: "code-block" } },
          link: { openOnClick: false, autolink: true },
        }),
        Placeholder.configure({
          placeholder: "Start typing your note...",
        }),
        Markdown.configure({
          html: false,
          tightLists: true,
          linkify: true,
          breaks: false,
          transformPastedText: true,
        }),
        // Keep NotesKeymap after StarterKit so Tab/Shift-Tab/Enter on lists
        // and code blocks take precedence over the default behavior.
        NotesKeymap,
      ],
      content: body,
      onUpdate: ({ editor: ed }) => {
        const current = activeKeyRef.current;
        if (!current) return;
        const md = getMarkdownStorage(ed).getMarkdown();
        updateContent(current.projectId, current.noteId, md);
      },
      editorProps: {
        attributes: {
          class: styles.editor,
          spellcheck: "false",
        },
      },
    },
    // Re-init on project change only; switching notes within a project just
    // swaps content via the sync effect below so we keep the same editor
    // instance and preserve caret/selection behaviour.
    [activeKey?.projectId],
  );

  useEffect(() => {
    if (!editor || !note || !activeKey) return;
    const key = `${activeKey.projectId}::${activeKey.noteId}`;
    if (lastSyncedKey.current === key) return;
    lastSyncedKey.current = key;
    const currentMd = getMarkdownStorage(editor).getMarkdown();
    // Skip setContent when the body is already in sync (avoids clearing the
    // selection mid-typing).
    if (currentMd.trim() === body.trim()) return;
    editor.commands.setContent(body, { emitUpdate: false });
  }, [editor, note, activeKey, body]);

  // Auto-grow the raw-markdown textarea so the shared outer scroll container
  // (.scrollArea + OverlayScrollbar) handles scrolling for both Rich and
  // Markdown modes, rather than the textarea's native scrollbar.
  useLayoutEffect(() => {
    const el = markdownRef.current;
    if (!el || mode !== "markdown") return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body, mode]);

  const handleMarkdownEdit = useCallback(
    (text: string) => {
      if (!activeKey) return;
      updateContent(activeKey.projectId, activeKey.noteId, text);
      if (editor && mode === "markdown") {
        lastSyncedKey.current = null;
      }
    },
    [activeKey, updateContent, editor, mode],
  );

  const handleModeChange = useCallback(
    (next: EditMode) => {
      setMode(next);
      if (next === "wysiwyg" && editor) {
        editor.commands.setContent(body, { emitUpdate: false });
        lastSyncedKey.current = activeKey
          ? `${activeKey.projectId}::${activeKey.noteId}`
          : null;
      }
    },
    [editor, body, activeKey],
  );

  const saveState = useMemo(() => {
    if (!note) return "";
    if (note.error) return `Save failed: ${note.error}`;
    if (note.dirty) return "Saving…";
    if (note.updatedAt) {
      try {
        const d = new Date(note.updatedAt);
        return `Saved ${d.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      } catch {
        return "Saved";
      }
    }
    return "";
  }, [note]);

  if (!params.projectId || !params.noteId) {
    // `NotesIndexRedirect` is the route element for `/notes` and
    // `/notes/:projectId`; it mounts inside this lane (via `children`) and
    // issues a `Navigate` to a concrete note path.
    return <div className={styles.container}>{children}</div>;
  }

  return (
    <div
      className={styles.container}
      data-agent-surface="notes-editor"
      data-agent-note-title={note?.title || ""}
      data-agent-note-id={activeKey?.noteId || ""}
      data-agent-note-mode={mode}
    >
      <div className={styles.toolbar}>
        <div className={styles.modeToggle} role="tablist" aria-label="Editor mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "wysiwyg"}
            data-active={mode === "wysiwyg"}
            className={styles.modeButton}
            onClick={() => handleModeChange("wysiwyg")}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") handleModeChange("markdown");
            }}
          >
            Rich
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "markdown"}
            data-active={mode === "markdown"}
            className={styles.modeButton}
            onClick={() => handleModeChange("markdown")}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") handleModeChange("wysiwyg");
            }}
          >
            Markdown
          </button>
        </div>
      </div>
      <div ref={scrollRef} className={styles.scrollArea}>
        <div ref={setCenterColumnRef} className={styles.centerColumn}>
          {!note ? null : mode === "wysiwyg" && editor ? (
            <div data-notes-editor-root>
              <BubbleMenu
                editor={editor}
                options={{ placement: "top" }}
                className={styles.bubbleMenu}
              >
                <BubbleToolbar editor={editor} />
              </BubbleMenu>
              <EditorContent editor={editor} />
            </div>
          ) : (
            <textarea
              ref={markdownRef}
              className={styles.markdownArea}
              value={body}
              onChange={(e) => handleMarkdownEdit(e.target.value)}
              spellCheck={false}
              aria-label="Note body (markdown)"
            />
          )}
        </div>
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
      {saveState ? (
        <span
          className={`${styles.saveState} ${note?.error ? styles.saveStateError : ""}`}
          aria-live="polite"
        >
          {saveState}
        </span>
      ) : null}
    </div>
  );
}
