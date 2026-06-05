/**
 * One-time seeding routine for the aura-blog CMS. Runs entirely in the
 * authenticated browser session (the logged-in sys admin's JWT is threaded
 * automatically by `apiFetch`), so it needs no tokens or DB access.
 *
 * For each post that does not already exist (matched by slug) it:
 *   1. creates the note row under the aura-blog project,
 *   2. uploads the rendered markdown body to S3 via the presign flow,
 *   3. updates the row with blog metadata + the "n3o" byline + sortOrder,
 *   4. transitions it to `published` (stamping publishedAt = now).
 *
 * Posts are published oldest-first so the public blog's `publishedAt DESC`
 * order matches the `sortOrder` used by the in-app Notes tree.
 */

import { api } from "../../../api/client";
import { uploadMarkdown } from "../../../api/upload";
import { AURA_BLOG_PROJECT_ID } from "../aura-blog";
import {
  renderPostMarkdown,
  SEED_AUTHOR_NAME,
  SEED_POSTS,
  VIDEO_PLACEHOLDER_URL,
} from "./posts";

export type SeedStatus = "created" | "skipped" | "error";

export interface SeedResult {
  slug: string;
  title: string;
  status: SeedStatus;
  message?: string;
}

/** Count whitespace-separated words for the note's `wordCount` field. */
function wordCount(markdown: string): number {
  return markdown.split(/\s+/).filter(Boolean).length;
}

/**
 * Create and publish the weekly aura-blog posts. Idempotent: posts whose
 * slug already exists in the project are skipped, so re-running only fills
 * in what is missing. Per-post failures are captured in the result list
 * instead of aborting the whole run.
 */
export async function seedAuraBlog(): Promise<SeedResult[]> {
  const projectId = AURA_BLOG_PROJECT_ID;
  const results: SeedResult[] = [];

  let existingSlugs = new Set<string>();
  try {
    const tree = await api.notes.tree(projectId);
    existingSlugs = new Set(
      tree.notes
        .map((n) => n.slug)
        .filter((s): s is string => typeof s === "string" && s.length > 0),
    );
  } catch {
    // If the tree can't be read, fall through: per-post creates will
    // surface their own errors.
  }

  // Publish oldest release day first (highest sortOrder), so the newest
  // day ends up with the latest publishedAt on the public blog.
  const ordered = [...SEED_POSTS].sort((a, b) => b.sortOrder - a.sortOrder);

  for (const post of ordered) {
    if (existingSlugs.has(post.slug)) {
      results.push({
        slug: post.slug,
        title: post.title,
        status: "skipped",
        message: "already exists",
      });
      continue;
    }

    try {
      const note = await api.notes.createNote(projectId, {
        title: post.title,
        slug: post.slug,
      });

      const markdown = renderPostMarkdown(post);
      const { url, key } = await uploadMarkdown(markdown, `${post.slug}.md`);

      await api.notes.updateNote(projectId, note.id, {
        title: post.title,
        slug: post.slug,
        bodyUrl: url,
        bodyS3Key: key,
        wordCount: wordCount(markdown),
        excerpt: post.excerpt,
        heroImageUrl: VIDEO_PLACEHOLDER_URL,
        readTimeMinutes: post.readTimeMinutes,
        blogType: post.blogType,
        sortOrder: post.sortOrder,
        authorName: SEED_AUTHOR_NAME,
      });

      await api.notes.transitionNote(projectId, note.id, "published");

      results.push({ slug: post.slug, title: post.title, status: "created" });
    } catch (err) {
      results.push({
        slug: post.slug,
        title: post.title,
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
