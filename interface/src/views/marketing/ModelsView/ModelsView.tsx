import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Image as ImageIcon, Search, Sparkles, Video } from "lucide-react";

import {
  listModels,
  type ModelEntry,
  type ModelMode,
  type ModelStatus,
} from "../../../api/marketing/models";

import "./ModelsView.css";

type ModeFilter = "all" | ModelMode;
type StatusFilter = "all" | ModelStatus;

interface ModeOption {
  readonly id: ModeFilter;
  readonly label: string;
  readonly icon: ReactNode | null;
}

const MODE_OPTIONS: readonly ModeOption[] = [
  { id: "all", label: "All", icon: null },
  { id: "text", label: "Text", icon: <Sparkles size={14} strokeWidth={1.75} /> },
  { id: "image", label: "Image", icon: <ImageIcon size={14} strokeWidth={1.75} /> },
  { id: "video", label: "Video", icon: <Video size={14} strokeWidth={1.75} /> },
  { id: "3d", label: "3D", icon: <Box size={14} strokeWidth={1.75} /> },
];

const STATUS_OPTIONS: readonly { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "soon", label: "Soon" },
];

const MODE_TITLE: Record<ModeFilter, string> = {
  all: "All Models",
  text: "Text Models",
  image: "Image Models",
  video: "Video Models",
  "3d": "3D Models",
};

function modeIcon(mode: ModelMode): ReactNode {
  switch (mode) {
    case "image":
      return <ImageIcon size={16} strokeWidth={1.75} />;
    case "video":
      return <Video size={16} strokeWidth={1.75} />;
    case "3d":
      return <Box size={16} strokeWidth={1.75} />;
    case "text":
    default:
      return <Sparkles size={16} strokeWidth={1.75} />;
  }
}

interface ModelCardProps {
  readonly entry: ModelEntry;
  readonly featured?: boolean;
}

function ModelCard({ entry, featured = false }: ModelCardProps): ReactNode {
  return (
    <article
      className={`modelsCard${featured ? " modelsCardFeatured" : ""}`}
      aria-label={`${entry.name} by ${entry.provider}`}
    >
      <div className="modelsCardHeader">
        <span
          className={`modelsCardIcon modelsCardIconMode-${entry.mode}`}
          aria-hidden
        >
          {modeIcon(entry.mode)}
        </span>
        <div className="modelsCardHeading">
          <h3 className="modelsCardName">{entry.name}</h3>
          <p className="modelsCardProvider">{entry.provider}</p>
        </div>
        <span
          className={`modelsStatusBadge modelsStatusBadge-${entry.status}`}
          aria-label={`Status: ${entry.status === "live" ? "Live" : "Coming soon"}`}
        >
          {entry.status === "live" ? "Live" : "Soon"}
        </span>
      </div>
      <p className="modelsCardDescription">{entry.description}</p>
    </article>
  );
}

/**
 * Marketing `/models` page. Mounts inside `PublicMarketingPanel`
 * alongside the other public marketing routes (`/product`, `/pricing`,
 * `/changelog`, `/feedback`); page chrome (titlebar + sidebar +
 * `PublicSidebarFooter`) is owned by the parent.
 *
 * Pulls the catalog from the same-origin pass-through at
 * `/api/public/models` (see `interface/src/api/marketing/models.ts`),
 * which proxies to aura-network. Filtering and search are entirely
 * client-side after the initial load so swapping tabs is instant
 * and the upstream catalog only fetches once per session.
 */
export function ModelsView(): ReactNode {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Models";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const [mode, setMode] = useState<ModeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["marketing-models"],
    queryFn: () => listModels(),
  });

  const entries = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (mode !== "all" && entry.mode !== mode) return false;
      if (status !== "all" && entry.status !== status) return false;
      if (needle.length === 0) return true;
      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.provider.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle)
      );
    });
  }, [entries, mode, status, search]);

  const featured = useMemo(
    () => filtered.filter((entry) => entry.featured).slice(0, 4),
    [filtered],
  );

  const showLoading = isLoading && entries.length === 0;
  const showEmpty = !isLoading && filtered.length === 0;

  return (
    <section className="modelsPage">
      <div className="modelsPageContent">
        <header className="modelsPageHeader">
          <h1 className="modelsPageTitle">{MODE_TITLE[mode]}</h1>
          <p className="modelsPageSubtitle">
            The frontier models powering AURA, across text, image, video, and 3D.
          </p>
        </header>

        <div
          className="modelsModeRow"
          role="tablist"
          aria-label="Filter by modality"
        >
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={opt.id === mode}
              className={`modelsModeButton${opt.id === mode ? " modelsModeButtonActive" : ""}`}
              onClick={() => setMode(opt.id)}
            >
              {opt.icon != null && (
                <span className="modelsModeButtonIcon" aria-hidden>
                  {opt.icon}
                </span>
              )}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>

        <div className="modelsControlsRow">
          <div
            className="modelsStatusRow"
            role="tablist"
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={opt.id === status}
                className={`modelsStatusButton${opt.id === status ? " modelsStatusButtonActive" : ""}`}
                onClick={() => setStatus(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="modelsSearch" aria-label="Search models">
            <Search size={14} strokeWidth={1.75} aria-hidden />
            <input
              type="search"
              className="modelsSearchInput"
              placeholder="Search models..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        {featured.length > 0 && (
          <div
            className="modelsSection"
            role="region"
            aria-label="Featured models"
          >
            <p className="modelsSectionLabel">Featured</p>
            <div className="modelsFeaturedGrid">
              {featured.map((entry) => (
                <ModelCard key={entry.id} entry={entry} featured />
              ))}
            </div>
          </div>
        )}

        <div
          className="modelsSection"
          role="region"
          aria-label="All models"
        >
          <p className="modelsSectionLabel">{MODE_TITLE[mode]}</p>
          {showLoading ? (
            <p className="modelsEmptyState">Loading catalog…</p>
          ) : showEmpty ? (
            <p className="modelsEmptyState">
              No models match the current filters. Try clearing search or
              switching tabs.
            </p>
          ) : (
            <div className="modelsGrid">
              {filtered.map((entry) => (
                <ModelCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
