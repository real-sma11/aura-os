# Project Appearance — Cross-App Sidebar Consistency

Use this skill when adding a new project-level visual property (color, icon, label style, row decoration) that must appear consistently across every app that renders a project row in the left sidebar: Projects, Tasks, Processes, Notes, and Aura 3D.

## The Pattern

All five apps build their own `ExplorerNode` trees independently. Without a shared module each app would duplicate the mapping from `ProjectAppearance` → node fields, and any new appearance property would require updating five files. Instead, a single shared feature module owns the entire translation.

### Shared feature module: `interface/src/features/project-row-appearance/`

Four files, one responsibility each:

**`build-project-row-appearance.tsx`** — Pure function that converts a `ProjectAppearance` object into the node fields every app needs:

```ts
export function buildProjectRowAppearance(
  projectId: string,
  appearance: ProjectAppearance | undefined,
): ProjectRowAppearanceFields  // { icon, labelStyle?, headerStyle? }
```

All visual priority rules live here and nowhere else:
- `headerOutline` or `headerBackground` set → accent stripe suppressed (filled/outlined chip is the dominant signal)
- Neither set but `accent` present → accent left-edge stripe via `--accent-stripe-color` CSS custom property
- No chip styling at all → `headerStyle` is `undefined` so React's diff sees no change

**`ProjectRowIcon.tsx`** — Self-subscribing icon component used as the `icon` field. Reads its own appearance slice directly from the store, so the icon recolors immediately when the user changes the accent without the parent builder re-running.

Three render modes:
- Icon slug + accent → Lucide glyph tinted in the accent color
- Icon slug only → plain Lucide glyph
- Accent only → small filled accent-colored dot (row pip)
- Neither → `null` (no leading glyph, matching pre-feature default)

**`use-project-appearances-by-project.ts`** — Hook returning `Map<projectId, ProjectAppearance>`. Uses `useShallow` on the Zustand store's entries Map, then collapses entries to their `.appearance` field via `useMemo` so builder code never receives loading flags or version counters.

**`index.ts`** — Barrel export: `buildProjectRowAppearance`, `ProjectRowAppearanceFields`, `ProjectRowIcon`, `useProjectAppearancesByProject`.

### How each app consumes it

Every nav component imports from the single barrel path and calls the builder inside its existing `useMemo`:

```tsx
import {
  buildProjectRowAppearance,
  useProjectAppearancesByProject,
} from "../../features/project-row-appearance";

// inside the component:
const appearanceByProject = useProjectAppearancesByProject();

// inside useMemo that builds nodes:
const appearanceFields = buildProjectRowAppearance(
  project.id,
  appearanceByProject.get(project.id),
);
// spread onto the node alongside app-specific fields (suffix, children…)
const node: ExplorerNodeWithSuffix = {
  ...appearanceFields,
  id: project.id,
  label: project.name,
  // app-specific fields here
};
```

The `LeftMenuTree` component was extended to accept the new fields (`icon`, `labelStyle`, `headerStyle` / `rowStyle`) so each app doesn't need to know how the CSS is actually applied.

### Extending the pattern

When adding a new appearance field:

1. Add the field to `ProjectAppearance` in `interface/src/shared/api/appearance.ts`.
2. Add the corresponding server field to `aura-os-server/src/handlers/appearance/metadata.rs` (or leave the server opaque — it writes JSON verbatim so frontend-only fields round-trip automatically).
3. Update `buildProjectRowAppearance` with the new priority/rendering rule.
4. Done. All five apps inherit the change automatically.

### CSS wiring

The accent stripe is painted by the `::before` pseudo-element on `.projectHeader` in `LeftMenuTree.module.css`. The builder exposes the color via `--accent-stripe-color` as a CSS custom property on the row container's inline style. Pseudo-element painting bypasses the row's border-radius clip so the stripe runs straight top-to-bottom.

### WebView2 theme fix

Native `<select>` elements inside WebView2 ignore the `color-scheme` declaration on `:root` — the OS-native popup always renders in light mode regardless of the app theme. The fix in `index.css` sets `color-scheme` both on `:root[data-theme='...']` (for scrollbars/inputs) **and** directly on `select`, `input`, `textarea` elements (the belt-and-suspenders path that WebView2 actually follows for native popups). A custom `ThemedSelect.tsx` replaces the native `<select>` for the Background Style dropdown, which must render in the app's design tokens rather than the OS widget.
