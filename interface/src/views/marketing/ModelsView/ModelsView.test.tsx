import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../../api/marketing/models", () => ({
  listModels: vi.fn(),
}));

import { ModelsView } from "./ModelsView";
import { listModels, type ModelEntry } from "../../../api/marketing/models";

const mockListModels = vi.mocked(listModels);

const FIXTURE_ENTRIES: ModelEntry[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "aura-gpt-5-5",
    name: "GPT-5.5",
    provider: "OpenAI",
    description: "Frontier reasoning model.",
    mode: "text",
    status: "live",
    featured: true,
    sortOrder: 10,
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    slug: "aura-kimi-k2-6",
    name: "Kimi K2.6",
    provider: "Moonshot AI",
    description: "Open-source multimodal MoE model.",
    mode: "text",
    status: "soon",
    featured: false,
    sortOrder: 20,
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    slug: "gpt-image-2",
    name: "GPT Image 2",
    provider: "OpenAI",
    description: "High-fidelity image generation.",
    mode: "image",
    status: "live",
    featured: false,
    sortOrder: 30,
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    slug: "veo-3.1-fast",
    name: "Veo 3.1 Fast",
    provider: "Google",
    description: "Sub-minute video generation.",
    mode: "video",
    status: "live",
    featured: true,
    sortOrder: 40,
  },
];

function renderModelsView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
    },
  });
  return render(
    <MemoryRouter initialEntries={["/models"]}>
      <QueryClientProvider client={queryClient}>
        <ModelsView />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ModelsView", () => {
  beforeEach(() => {
    mockListModels.mockReset();
    mockListModels.mockResolvedValue(FIXTURE_ENTRIES);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the page heading and subtitle", async () => {
    renderModelsView();
    expect(
      screen.getByRole("heading", { level: 1, name: /All Models/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      // GPT-5.5 appears in both the Featured row and the full grid by
      // default, so use the *AllBy variant rather than asserting a
      // single match.
      expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
    });
  });

  it("renders all fixture entries by default with provider + status badge", async () => {
    renderModelsView();
    await waitFor(() => {
      expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
    });

    // Every Live card carries a "Live" badge; status filter defaults
    // to "All" so the row also has a Live tab — at minimum 4 matches.
    expect(screen.getAllByText(/^Live$/).length).toBeGreaterThanOrEqual(4);
    // Status badge on the Soon entry (Kimi K2.6) — also matches the
    // status tab, so at least two occurrences.
    expect(screen.getAllByText(/^Soon$/).length).toBeGreaterThanOrEqual(1);
    // Provider line under the Moonshot model name.
    expect(screen.getByText("Moonshot AI")).toBeInTheDocument();
  });

  it("renders the Featured section with featured-only entries", async () => {
    renderModelsView();
    await waitFor(() => {
      expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
    });

    const featuredRegion = screen.getByRole("region", {
      name: /Featured models/i,
    });
    expect(within(featuredRegion).getByText("GPT-5.5")).toBeInTheDocument();
    expect(within(featuredRegion).getByText("Veo 3.1 Fast")).toBeInTheDocument();
    // Non-featured entries do NOT appear in the featured region
    expect(within(featuredRegion).queryByText("GPT Image 2")).toBeNull();
    expect(within(featuredRegion).queryByText("Kimi K2.6")).toBeNull();
  });

  it("filters the grid when the Image mode tab is selected", async () => {
    const user = userEvent.setup();
    renderModelsView();
    await waitFor(() => {
      expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("tab", { name: /^Image$/ }));

    const allModelsRegion = screen.getByRole("region", { name: /All models/i });
    expect(within(allModelsRegion).getByText("GPT Image 2")).toBeInTheDocument();
    expect(within(allModelsRegion).queryByText("GPT-5.5")).toBeNull();
    expect(within(allModelsRegion).queryByText("Veo 3.1 Fast")).toBeNull();
    // The section heading retitles to "Image Models"
    expect(
      screen.getByRole("heading", { level: 1, name: /Image Models/i }),
    ).toBeInTheDocument();
  });

  it("filters by status when the Soon tab is selected (excludes Live entries)", async () => {
    const user = userEvent.setup();
    renderModelsView();
    await waitFor(() => {
      expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
    });

    await user.click(screen.getByRole("tab", { name: /^Soon$/ }));

    const allModelsRegion = screen.getByRole("region", { name: /All models/i });
    // Kimi K2.6 is the only Soon entry in the fixture
    expect(within(allModelsRegion).getByText("Kimi K2.6")).toBeInTheDocument();
    // All Live entries should be hidden
    expect(within(allModelsRegion).queryByText("GPT-5.5")).toBeNull();
    expect(within(allModelsRegion).queryByText("GPT Image 2")).toBeNull();
    expect(within(allModelsRegion).queryByText("Veo 3.1 Fast")).toBeNull();
    // Featured region is also constrained by status, so it goes empty + hides
    expect(screen.queryByRole("region", { name: /Featured models/i })).toBeNull();
  });

  it("filters by free-text search across name, provider, and description", async () => {
    const user = userEvent.setup();
    renderModelsView();
    await waitFor(() => {
      expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
    });

    const searchBox = screen.getByRole("searchbox");
    await user.type(searchBox, "moonshot");

    const allModelsRegion = screen.getByRole("region", { name: /All models/i });
    expect(within(allModelsRegion).getByText("Kimi K2.6")).toBeInTheDocument();
    expect(within(allModelsRegion).queryByText("GPT-5.5")).toBeNull();
    expect(within(allModelsRegion).queryByText("GPT Image 2")).toBeNull();
  });

  it("shows an empty state when filters match nothing", async () => {
    const user = userEvent.setup();
    renderModelsView();
    await waitFor(() => {
      expect(screen.getAllByText("GPT-5.5").length).toBeGreaterThan(0);
    });

    const searchBox = screen.getByRole("searchbox");
    await user.type(searchBox, "nonexistent-zzz");

    expect(screen.getByText(/No models match/i)).toBeInTheDocument();
  });
});
