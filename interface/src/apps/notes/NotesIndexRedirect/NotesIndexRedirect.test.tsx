import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const mockActiveKey = { value: null as { projectId: string; noteId: string } | null };
const mockTrees: Record<
  string,
  {
    loading: boolean;
    folders: Array<{ id: string }>;
    notes: Array<{ id: string; folderId?: string | null; title?: string; sortOrder?: number }>;
  }
> = {};
const mockProjects: Array<{ project_id: string }> = [];
const mockStoredNote = { value: null as { projectId: string; noteId: string } | null };

vi.mock("../../../stores/notes-store", () => ({
  useActiveNoteKey: () => mockActiveKey.value,
  useNotesStore: <T,>(sel: (s: { trees: typeof mockTrees }) => T) => sel({ trees: mockTrees }),
}));
vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: <T,>(sel: (s: { projects: typeof mockProjects }) => T) =>
    sel({ projects: mockProjects }),
}));
vi.mock("../../../utils/storage", () => ({
  getLastNote: () => mockStoredNote.value,
}));

import { NotesIndexRedirect } from "./NotesIndexRedirect";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/notes" element={<><NotesIndexRedirect /><LocationProbe /></>} />
        <Route
          path="/notes/:projectId"
          element={<><NotesIndexRedirect /><LocationProbe /></>}
        />
        <Route
          path="/notes/:projectId/:notePath"
          element={<LocationProbe />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("NotesIndexRedirect", () => {
  beforeEach(() => {
    mockActiveKey.value = null;
    mockStoredNote.value = null;
    mockProjects.length = 0;
    for (const key of Object.keys(mockTrees)) delete mockTrees[key];
  });

  it("navigates to the active note's canonical URL when available", () => {
    mockActiveKey.value = { projectId: "p1", noteId: "note-abc" };

    const { getByTestId } = renderAt("/notes");

    expect(getByTestId("pathname").textContent).toBe("/notes/p1/note-abc");
  });

  it("falls back to the first project note when no active or stored note exists", () => {
    mockProjects.push({ project_id: "p2" });
    mockTrees.p2 = {
      loading: false,
      folders: [],
      notes: [{ id: "todo-1" }],
    };

    const { getByTestId } = renderAt("/notes");

    expect(getByTestId("pathname").textContent).toBe("/notes/p2/todo-1");
  });

  it("stays on /notes when trees are still loading", () => {
    mockProjects.push({ project_id: "p3" });
    mockTrees.p3 = { loading: true, folders: [], notes: [] };
    mockStoredNote.value = { projectId: "p3", noteId: "draft-1" };

    const { getByTestId } = renderAt("/notes");

    expect(getByTestId("pathname").textContent).toBe("/notes");
  });
});
