# Icon System

This is the source-of-truth reference for icons in `interface/`. Read it before
adding a new icon, a new icon button, or a new icon-related CSS class.

## 1. Library

We use **`lucide-react`** and only `lucide-react` for vector icons. ~165+ files
already import from it; `AuraApp.icon` is typed as `LucideIcon`.

Do not introduce additional icon packages (`react-icons`, `@heroicons/react`,
`@radix-ui/react-icons`, MUI icons, Phosphor, Tabler, MDI, etc.). If a glyph is
genuinely missing, prefer composing from existing Lucide icons or hand-rolling a
small inline SVG component (see exceptions below).

## 2. Sizing conventions

Sizes currently in use (passed via the Lucide `size` prop):

| Surface                                 | `size` |
| --------------------------------------- | -----: |
| Dense inline chips, status dots         |  12–14 |
| Taskbar icon buttons (`TaskbarIconButton`) | **19** (`TASKBAR_ICON_SIZE` constant, in a 30x30 hit target) |
| In-row action buttons, list rows        |     16 |
| Bar layout nav (`AppNavRail` `bar`)     |     17 |
| Rail layout nav (`AppNavRail` `rail`)   |     18 |
| Empty state hero glyphs                 |  20–24 |

Prefer the table values over freehand sizes. For new chrome icons, default to
**16**. Always pass `size` (not width/height in CSS) so Lucide keeps stroke
proportional.

## 3. Shared wrappers — what to use when

Always reach for an existing wrapper before writing a new `<button>`:

| Wrapper | Where | Use it for |
| --- | --- | --- |
| [`TaskbarIconButton`](../src/components/AppNavRail/AppNavRail.tsx) | `interface/src/components/AppNavRail/AppNavRail.tsx` | Square 28×28 chrome icon button with the standard inner-plate hover. Default choice for app chrome (taskbar, titlebar accessories, theme toggles, help, favorites strip). |
| [`NavRailButton`](../src/components/AppNavRail/AppNavRail.tsx) | same file | Vertical rail / bar app launchers. Hover is color/opacity only (no plate) inside the rail layout. |
| ZUI [`Button`](../../vendor/zui/src/components/Button/Button/Button.tsx) with `iconOnly` + `variant="ghost"` | `@cypher-asi/zui` | Multi-state toggles, window controls, anywhere a labelled `Button` is mixed in. |
| [`CopyButton`](../src/components/CopyButton/CopyButton.tsx) | components | Copy-to-clipboard control with the Copy↔Check transition. Don't roll your own. |
| [`ProjectsPlusButton`](../src/components/ProjectsPlusButton/ProjectsPlusButton.tsx) | components | The dedicated "+" affordance in the projects rail. |
| [`RunTaskButton`](../src/components/RunTaskButton/RunTaskButton.tsx) | components | Play/Loader2 task-run trigger. |
| [`ThemeToggleButton`](../src/components/BottomTaskbar/ThemeToggleButton.tsx) / [`HelpButton`](../src/features/onboarding/HelpButton/HelpButton.tsx) | components | Pre-bound Sun/Moon and Help icons that already wrap `TaskbarIconButton`. |

If you need a brand-new variant (e.g. a different size or a non-chrome surface),
add it to one of the wrappers above as a prop instead of forking a new
`<button>` + CSS module.

## 4. Inline-SVG exceptions

Two components legitimately ship hand-rolled SVG (do not Lucide-ify these):

- [`TaskStatusIcon`](../src/components/TaskStatusIcon/TaskStatusIcon.tsx) — task
  state glyphs (empty / spinning / error / filled).
- [`LoopProgress`](../src/components/LoopProgress/LoopProgress.tsx) —
  determinate / indeterminate progress ring.

[`SkillIcon`](../src/components/SkillShopModal/SkillIcon.tsx) is **not** an
inline-SVG exception; it's a `string id → LucideIcon` lookup table.

## 5. Brand raster assets

Two PNG assets act as logos and are intentionally raster (not icons):

- `/aura-icon.png` — used in `LoginView`, `IdeView`, `WelcomeModal`.
- `/AURA_logo_text_mark.png` — used in `DesktopTitlebar`, `MobileTopbar`.

Don't introduce additional raster icons; everything else should be `lucide-react`.

## 6. Hover convention — inner rounded plate

Icon buttons keep their full hit target for accessibility (28×28 / 24×24 /
22×22), but the visible hover background is a tighter rounded plate centered
behind the glyph. This avoids the heavy "fill the whole button" slab and reads
as a halo around the icon.

Tokens (defined in [`interface/src/styles/tokens.css`](../src/styles/tokens.css)):

```css
--icon-hover-inset: 2px;   /* visible inset from the hit target */
--icon-hover-radius: 8px;  /* soft square; override to 999px for circular pills.
                              Hardcoded (not --radius-md) because the design
                              system keeps --radius-md at 0 globally; the icon
                              hover halo is the one place that should always
                              feel softly rounded. */
--icon-hover-bg: var(--color-overlay-light);
```

Recipe (apply per CSS module — we do not ship a global class because vendored
ZUI controls its own ghost styling):

```css
.myIconBtn {
  position: relative;
  /* width/height/padding/etc. unchanged */
  background: transparent;
}

.myIconBtn::before {
  content: "";
  position: absolute;
  inset: var(--icon-hover-inset);
  border-radius: var(--icon-hover-radius);
  background: transparent;
  transition: background var(--transition-fast);
  pointer-events: none;
  z-index: 0;
}

.myIconBtn > * {
  position: relative;
  z-index: 1;
}

.myIconBtn:not(:disabled):hover::before {
  background: var(--icon-hover-bg);
}
```

Where the button is a small circular pill (e.g. `BrowserAddressBar.actionButton`),
override locally:

```css
.actionButton { --icon-hover-radius: 999px; }
```

Already converted: `TaskbarIconButton` (`.taskbarBtn`), `BrowserAddressBar`
(`.navButton`, `.actionButton`), `FolderPickerField` (`.iconButton`),
`OnboardingChecklist` (`.iconButton`).

## 7. Consolidation candidates (long tail)

These bespoke `.iconButton` / `.actionButton` / `.controlBtn` CSS classes still
duplicate the icon-button pattern locally. They're flagged for a future PR and
should adopt the hover recipe above when touched:

- [`MessageQueue.module.css`](../src/apps/chat/components/MessageQueue/MessageQueue.module.css) `.queueActionBtn`
- [`ChatInputBar.module.css`](../src/apps/chat/components/ChatInputBar/ChatInputBar.module.css) (`.newSessionButton`, `.modeNewChatButton`, etc.)
- [`Preview.module.css`](../src/components/Preview/Preview.module.css) `.copyOutputButton`
- [`OrgSelector.module.css`](../src/components/OrgSelector/OrgSelector.module.css) `.iconTrigger`
- [`MobileThemeToggleButton.module.css`](../src/components/MobileThemeToggleButton/MobileThemeToggleButton.module.css) (could be a size variant on `TaskbarIconButton` instead)
- `AgentWindow` `.controlBtn` window chrome (Minus / Square / X)
- [`ProjectList.module.css`](../src/components/ProjectList/ProjectList.module.css) `.agentActionButton`
- [`LeftMenuTree.module.css`](../src/features/left-menu/LeftMenuTree/LeftMenuTree.module.css) `.agentActionButton`
- [`Gallery.module.css`](../src/components/Gallery/Gallery.module.css) `.toolbarButton`, `.navButton`
- [`IdeView.module.css`](../src/views/IdeView/IdeView.module.css) `.tabClose`
- [`MobileShell.module.css`](../src/mobile/shell/MobileShell.module.css) `.mobileDrawerIconButton`

Longer-term: introduce a single `IconButton` primitive that supersedes both
`TaskbarIconButton` and the bespoke classes above, and migrate ZUI
`Button iconOnly` consumers that don't need labelled-mode features.
