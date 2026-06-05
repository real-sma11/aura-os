/**
 * One-time seed content for the aura-blog CMS: a week of release-recap
 * posts authored by n3o. Each post recaps a single recent nightly release
 * day, highlighting 2-5 shipped features (no bug fixes). The markdown body
 * is rendered by {@link renderPostMarkdown}; every feature section embeds a
 * placeholder where the demo video will eventually live.
 *
 * Dates are intentionally NOT baked into the slug (slugs are title-based).
 * Posts are published "today" by the seeding routine; a follow-up feature
 * will let an editor set the real per-day publish date.
 */

/** Shared placeholder asset (see `interface/public/blog-media/`). */
export const VIDEO_PLACEHOLDER_URL = "/blog-media/video-placeholder.svg";

/** The display byline for every seeded post. */
export const SEED_AUTHOR_NAME = "n3o";

export interface SeedFeature {
  /** Feature heading. */
  name: string;
  /** What it does (short description). */
  description: string;
  /** How it works under the hood. */
  howItWorks: string;
  /** Why it is useful to the reader. */
  whyUseful: string;
}

export interface SeedPost {
  /** Interesting, human title. Also the source of the slug. */
  title: string;
  /** URL slug (title-based, never a date). */
  slug: string;
  /** Short summary shown in listings. */
  excerpt: string;
  /** CMS blog type tag. */
  blogType: string;
  /** Estimated read time in minutes. */
  readTimeMinutes: number;
  /**
   * Tree ordering. 0 sorts first (newest release day at the top of the
   * aura-blog tree). Posts are published oldest-first so the public blog's
   * `publishedAt DESC` order also matches today.
   */
  sortOrder: number;
  /** Human-readable release day, e.g. "June 4, 2026". */
  releaseDate: string;
  /** Nightly version string for the release. */
  version: string;
  /** GitHub release URL. */
  releaseUrl: string;
  /** Opening paragraph. */
  intro: string;
  /** 2-5 shipped features (no bug fixes). */
  features: SeedFeature[];
}

/**
 * The seven posts, newest release day first. Content is drawn from the
 * daily changelog (cypher-asi.github.io/aura-os/changelog/nightly). The
 * 2026-05-29 nightly was a no-op and is intentionally skipped.
 */
export const SEED_POSTS: SeedPost[] = [
  {
    title: "Inside the Council: Clearer Multi-Model Chat and a Public Blog",
    slug: "inside-the-council-clearer-multi-model-chat-and-a-public-blog",
    excerpt:
      "The Council picker finally tells you which combine mechanism is running, the agent profile gets a 3D ID card, and Notes move onto storage-backed bodies that power a brand-new public blog.",
    blogType: "release",
    readTimeMinutes: 5,
    sortOrder: 0,
    releaseDate: "June 4, 2026",
    version: "0.1.0-nightly.598.1",
    releaseUrl:
      "https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.598.1",
    intro:
      "A heavy day across the desktop interface. The Council picker and panel learned to clearly show which combine mechanism is in flight, the agent profile got a redesigned 3D nameplate paired with a new spec card, and Notes moved off the filesystem onto storage-backed S3 bodies — unlocking the very blog you are reading right now.",
    features: [
      {
        name: "The Council mechanism is visible end-to-end",
        description:
          "Synthesize, Contrast, and Side-by-side are now an always-visible menu row instead of a finicky hover flyout, and the chosen mechanism is echoed in the panel header so you always know how multiple models are being combined.",
        howItWorks:
          "The hover flyout was replaced with a persistent CouncilMechanismRow component; the selected mechanism is persisted with the conversation and surfaced as a header label that the Council panel reads back on every turn.",
        whyUseful:
          "When several models answer at once, it matters whether you are seeing a synthesized answer or a raw comparison. Making the mechanism explicit removes guesswork and makes Council results reproducible.",
      },
      {
        name: "A redesigned agent ID card",
        description:
          "Each agent profile now opens with a 3D nameplate and a dedicated spec card that summarizes who the agent is at a glance.",
        howItWorks:
          "The profile header renders a layered 3D nameplate, with a ProfileSpecCard beneath it that pulls the agent's key attributes into a single compact, scannable card.",
        whyUseful:
          "Agents start to feel like distinct collaborators rather than interchangeable endpoints, which makes it far easier to pick the right one for a task.",
      },
      {
        name: "Notes move to storage + S3, and the public blog ships",
        description:
          "Note bodies now live on object storage instead of the local filesystem, with metadata in storage — the foundation for a public /blog site.",
        howItWorks:
          "Notes became first-class storage rows; the markdown body is uploaded to S3 and referenced from the row, while the public blog reads the published subset anonymously through a server-side internal token.",
        whyUseful:
          "Your notes are no longer trapped on one machine, and the same content model powers a shareable, public-facing blog with zero extra tooling.",
      },
      {
        name: "An Agents/Projects rocker with a persistent chat lane",
        description:
          "The sidebar gained a hand-tuned rocker switch between Agents and Projects, with a chat surface that stays put behind it.",
        howItWorks:
          "A single rocker control toggles the sidebar's mode while the chat lane is rendered persistently, so switching context no longer tears down and rebuilds your active conversation.",
        whyUseful:
          "You can jump between organizing projects and talking to agents without losing your place in an ongoing chat.",
      },
    ],
  },
  {
    title: "Lights, Camera, Agent: Demo Recording and a Reshaped Desktop",
    slug: "lights-camera-agent-demo-recording-and-a-reshaped-desktop",
    excerpt:
      "The /record_demo pipeline grows into a framed, agent-driven screen recording, the agent profile becomes a real WebGL card you can flip, and the desktop shell gets a rounded, beveled redesign.",
    blogType: "release",
    readTimeMinutes: 5,
    sortOrder: 1,
    releaseDate: "June 3, 2026",
    version: "0.1.0-nightly.591.1",
    releaseUrl:
      "https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.591.1",
    intro:
      "A heavy build day on nightly. The /record_demo pipeline grew from a simple window capture into a framed, agent-driven screen recording with a self-service setup flow; the agent profile became a real WebGL card with a flippable persona screen; and the authed desktop shell was rebuilt around a rounded screen, a beveled taskbar, and a new chat input pill.",
    features: [
      {
        name: "A window-on-background demo recording pipeline",
        description:
          "/record_demo can now produce a polished, framed screen recording driven by computer-use, complete with a guided setup flow.",
        howItWorks:
          "The command composes the captured app window onto a styled background and drives the on-screen actions via the computer-use pipeline, so the recording is both framed and reproducible.",
        whyUseful:
          "Creating a clean product demo no longer means wrangling external screen recorders — you can generate a presentable walkthrough straight from the app.",
      },
      {
        name: "A WebGL agent card you can flip to the persona",
        description:
          "The agent profile is now a real 'AURA card' rendered in WebGL, with a back face that flips to reveal the agent's persona.",
        howItWorks:
          "The card is drawn on a WebGL surface and animates a flip transition between the front identity face and a back persona screen.",
        whyUseful:
          "It turns an agent's identity into something tangible and memorable, reinforcing that each agent is its own character.",
      },
      {
        name: "Telegram channels wired end-to-end",
        description:
          "Telegram arrived as a first-class agent channel, with the agent's smart-wallet wired through the same flow.",
        howItWorks:
          "Agent messaging gained a Telegram channel integration end-to-end, connecting the agent's smart-wallet so conversations and on-chain identity travel together.",
        whyUseful:
          "Agents can now meet people where they already are, extending Aura beyond the desktop into a chat app millions already use.",
      },
      {
        name: "A reshaped authed desktop shell",
        description:
          "The logged-in desktop was rebuilt around a rounded screen, a beveled taskbar, and a new pill-shaped chat input.",
        howItWorks:
          "The shell's frame, taskbar, and input were re-styled into a cohesive rounded-and-beveled language, with the chat input collapsed into a single pill.",
        whyUseful:
          "The workspace feels more like a polished device and less like a web page, which makes long sessions more pleasant.",
      },
    ],
  },
  {
    title: "Polishing the Mobile Experience for the App Store",
    slug: "polishing-the-mobile-experience-for-the-app-store",
    excerpt:
      "In-app account deletion, camera and photo permissions, a public support page, and scrollable mobile settings — the pieces that clear the path to an App Store release.",
    blogType: "release",
    readTimeMinutes: 4,
    sortOrder: 2,
    releaseDate: "June 2, 2026",
    version: "0.1.0-nightly.583.1",
    releaseUrl:
      "https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.583.1",
    intro:
      "Today's work focused on unblocking the iOS App Store submission. We shipped the missing pieces App Review flagged — camera and photo permissions, a public support page, in-app account deletion — alongside mobile polish that makes the app feel complete on a phone.",
    features: [
      {
        name: "In-app account deletion",
        description:
          "You can now delete your account from inside the app, end-to-end, satisfying Apple's account-deletion requirement.",
        howItWorks:
          "A dedicated deletion flow walks you through confirmation and then tears down the account through the backend, so there is no need to email support or visit a website.",
        whyUseful:
          "Full control over your data — including the ability to leave — is table stakes, and now it lives one tap away.",
      },
      {
        name: "Camera and photo library permissions",
        description:
          "The app now requests camera and photo library access so features like Take Photo work on mobile.",
        howItWorks:
          "Proper permission descriptions and prompts were added so the OS can grant access the first time a photo capture or picker is invoked.",
        whyUseful:
          "Capturing or attaching an image just works now, instead of silently failing against a missing permission.",
      },
      {
        name: "A public /support page",
        description:
          "A dedicated support page is now live on the public site, covering App Store Guideline 1.5.",
        howItWorks:
          "A new marketing route renders a self-contained support page that anyone can reach without logging in.",
        whyUseful:
          "Users (and reviewers) always have a clear place to find help, even before they sign up.",
      },
      {
        name: "Scrollable mobile settings with Log Out",
        description:
          "Mobile settings now scroll properly and expose a Log Out button.",
        howItWorks:
          "The settings screen was made fully scrollable on small viewports and a Log Out action was added to the list.",
        whyUseful:
          "Every setting is reachable on a phone, and signing out no longer requires a workaround.",
      },
    ],
  },
  {
    title: "Many Minds, One Answer: AURA Council and Shareable Chats",
    slug: "many-minds-one-answer-aura-council-and-shareable-chats",
    excerpt:
      "AURA Council lands with N-model fan-out and a synthesizer, subagent threads become fully promptable slide-overs, and every assistant message gets Copy, Share, and Reload actions backed by public share links.",
    blogType: "release",
    readTimeMinutes: 5,
    sortOrder: 3,
    releaseDate: "June 1, 2026",
    version: "0.1.0-nightly.578.1",
    releaseUrl:
      "https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.578.1",
    intro:
      "A heavy day centered on multi-agent chat. Live subagent threads grew from a clickable card into a fully promptable, persisted slide-over; AURA Council landed end-to-end with N-model fan-out and a synthesizer; and assistant messages picked up a Copy/Share/Reload action row backed by a new public share link.",
    features: [
      {
        name: "AURA Council: N-model fan-out with a synthesizer",
        description:
          "Ask once and have several models answer in parallel, with a synthesizer that combines them and live columns showing each member's response.",
        howItWorks:
          "A single prompt fans out to N configured models; their streaming responses render side-by-side as member columns while a synthesizer model composes a combined answer.",
        whyUseful:
          "You get the breadth of many models and the convenience of a single answer, without copy-pasting prompts between tools.",
      },
      {
        name: "Promptable, persistent subagent threads",
        description:
          "Subagent threads became fully promptable slide-overs with history that persists and can be shared.",
        howItWorks:
          "What used to be a read-only card is now an interactive slide-over you can keep prompting; the thread's history is persisted and exposed through a shareable link.",
        whyUseful:
          "You can dig into a subagent's work, steer it further, and hand off the whole conversation to someone else.",
      },
      {
        name: "Shareable chats with a Copy/Share/Reload row",
        description:
          "Every assistant message now has a Copy, Share, and Reload action row, with Share producing a public session link.",
        howItWorks:
          "The action row sits under each assistant message; Share mints a public session share link while Reload re-runs the turn and Copy grabs the text.",
        whyUseful:
          "Great answers are easy to reuse, replay, or send to a teammate with a single click.",
      },
      {
        name: "A desktop force-upgrade gate",
        description:
          "Desktop builds that fall three or more releases behind are now gated until they update.",
        howItWorks:
          "The app compares its version against the latest releases and, when it is 3+ behind, presents an upgrade gate instead of continuing on stale code.",
        whyUseful:
          "It keeps everyone on a recent, supported build, avoiding confusing bugs that were already fixed upstream.",
      },
    ],
  },
  {
    title: "Smarter Model Picker, Honest Costs, and Private Bug Reports",
    slug: "smarter-model-picker-honest-costs-and-private-bug-reports",
    excerpt:
      "Per-model reasoning effort with credit multipliers, a Session Cost view that shows real token spend, and an end-to-end private bug-report flow with a consent gate and admin viewer.",
    blogType: "release",
    readTimeMinutes: 5,
    sortOrder: 4,
    releaseDate: "May 30, 2026",
    version: "0.1.0-nightly.577.1",
    releaseUrl:
      "https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.577.1",
    intro:
      "A heavy day across the chat experience and the public-facing surface. The model picker grew per-model reasoning effort, credit multipliers, and provider grouping; a new Session Cost view shows what each conversation actually costs; and an end-to-end private Bug Reports flow shipped with consent gating and an admin viewer.",
    features: [
      {
        name: "Per-model reasoning effort with credit multipliers",
        description:
          "The model picker now lets you choose how hard each model thinks, with the credit multiplier shown right next to the choice.",
        howItWorks:
          "Each model exposes a reasoning-effort control; the picker surfaces the corresponding credit multiplier so the cost of more thinking is visible before you commit.",
        whyUseful:
          "You can dial effort up for hard problems and down for quick ones, and always know what that trade-off costs.",
      },
      {
        name: "A Session Cost view",
        description:
          "A new Session Cost section shows the real token spend for the current conversation.",
        howItWorks:
          "The chat tallies input and output tokens for the session and renders them as a running cost summary.",
        whyUseful:
          "Spend stops being a mystery — you can see exactly what a conversation is costing as it happens.",
      },
      {
        name: "Private bug reports with consent and an admin viewer",
        description:
          "You can file a private bug report behind a consent gate, and admins get a dedicated viewer to triage them.",
        howItWorks:
          "The report flow asks for explicit consent before attaching context, stores the report privately, and exposes it to system admins through an admin-only viewer.",
        whyUseful:
          "Reporting problems is easy and respectful of privacy, and the team can actually act on the reports.",
      },
      {
        name: "A refreshed public marketing nav and /code page",
        description:
          "The marketing site moved to a centered top navigation and gained a new /code page.",
        howItWorks:
          "The public shell's navigation was recentred into a single top bar, and a dedicated /code route was added.",
        whyUseful:
          "The public site is easier to navigate and now has a home for the code-focused story.",
      },
    ],
  },
  {
    title: "One Shell to Rule Them All: AuraShell Unification",
    slug: "one-shell-to-rule-them-all-aurashell-unification",
    excerpt:
      "Simple, Advanced, and Public modes collapse into a single AuraShell, the public landing is rebuilt around persona-themed mock desktops, and chat and task streams survive reloads.",
    blogType: "release",
    readTimeMinutes: 6,
    sortOrder: 5,
    releaseDate: "May 28, 2026",
    version: "0.1.0-nightly.565.1",
    releaseUrl:
      "https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.565.1",
    intro:
      "A very large nightly that consolidates the desktop and logged-out shells into a single AuraShell, rebuilds the public landing around persona-themed mock desktops, and lands a deep simplification of the dev-loop and task-streaming pipeline.",
    features: [
      {
        name: "One unified AuraShell",
        description:
          "Simple, Advanced, and Public modes now run on a single shell instead of three divergent code paths.",
        howItWorks:
          "The previously separate shells were merged into one AuraShell that adapts its surface by mode, so all three share the same layout and behavior.",
        whyUseful:
          "Features and fixes land everywhere at once, and the experience is consistent no matter how you enter the app.",
      },
      {
        name: "A rebuilt public landing with persona theming",
        description:
          "The public landing page was rebuilt around persona theming and a mock Aura desktop.",
        howItWorks:
          "The landing renders a themed, interactive mock of the Aura desktop that shifts with the selected persona, alongside refreshed marketing pages.",
        whyUseful:
          "First-time visitors get an immediate, tangible feel for what Aura is before they ever sign in.",
      },
      {
        name: "Reattachable chat and task streams",
        description:
          "Chat and task streams now survive reloads and dropped connections instead of going dark.",
        howItWorks:
          "Streams were made reattachable, so a reload or an SSE drop reconnects to the in-progress stream rather than losing it.",
        whyUseful:
          "You can refresh, lose Wi-Fi, or come back later and still see your work continue uninterrupted.",
      },
      {
        name: "Task storage moved to IndexedDB",
        description:
          "Task state moved off localStorage and into IndexedDB.",
        howItWorks:
          "The task store now persists to IndexedDB, which has far more headroom than localStorage's tight quota.",
        whyUseful:
          "Long or busy sessions no longer wedge against storage limits, so tasks keep working reliably.",
      },
    ],
  },
  {
    title: "Download Aura Anywhere: A New Install Hub",
    slug: "download-aura-anywhere-a-new-install-hub",
    excerpt:
      "A dedicated /download page with per-platform cards for macOS, Windows, and Linux, plus the navigation to actually find it.",
    blogType: "release",
    readTimeMinutes: 3,
    sortOrder: 6,
    releaseDate: "May 25, 2026",
    version: "0.1.0-nightly.558.1",
    releaseUrl:
      "https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.558.1",
    intro:
      "A focused day for getting Aura onto your machine. The marketing site gained a dedicated download page with per-platform install links, plus the navigation surfaces to find it from anywhere on the public site.",
    features: [
      {
        name: "A dedicated /download page",
        description:
          "There is now a single page that gathers every way to install Aura.",
        howItWorks:
          "A new /download route on the marketing site renders the canonical install hub for the desktop app.",
        whyUseful:
          "Instead of hunting through releases, there is one obvious place to go to get Aura.",
      },
      {
        name: "Per-platform install cards",
        description:
          "The page presents distinct cards for macOS, Windows, and Linux.",
        howItWorks:
          "Each platform gets its own card with the appropriate install link, so the right download is one click away.",
        whyUseful:
          "You see exactly the build for your operating system without guessing which file you need.",
      },
      {
        name: "Discoverable navigation surfaces",
        description:
          "New navigation entries make the download hub easy to reach from across the public site.",
        howItWorks:
          "Links to /download were added to the marketing navigation so the page is reachable from the main surfaces.",
        whyUseful:
          "Visitors can get to the installer from wherever they are, lowering the friction to trying Aura.",
      },
    ],
  },
];

/** Render a {@link SeedPost} into the markdown body stored on S3. */
export function renderPostMarkdown(post: SeedPost): string {
  const lines: string[] = [];
  lines.push(`# ${post.title}`);
  lines.push("");
  lines.push(`_${post.releaseDate} · Nightly ${post.version}_`);
  lines.push("");
  lines.push(post.intro);
  lines.push("");
  lines.push(`[View the release on GitHub](${post.releaseUrl})`);
  lines.push("");

  for (const feature of post.features) {
    lines.push(`## ${feature.name}`);
    lines.push("");
    lines.push(`![Demo video coming soon](${VIDEO_PLACEHOLDER_URL})`);
    lines.push("");
    lines.push(feature.description);
    lines.push("");
    lines.push(`**How it works.** ${feature.howItWorks}`);
    lines.push("");
    lines.push(`**Why it's useful.** ${feature.whyUseful}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`Written by ${SEED_AUTHOR_NAME}.`);
  lines.push("");

  return lines.join("\n");
}
