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
import { useAuthStore } from "../../../stores/auth-store";
import type { Note } from "../../../shared/api/notes";
import { AURA_BLOG_PROJECT_ID } from "../aura-blog";
import {
  renderPostMarkdown,
  SEED_AUTHOR_NAME,
  SEED_POSTS,
  VIDEO_PLACEHOLDER_URL,
} from "./posts";

export type SeedStatus = "created" | "updated" | "skipped" | "error";

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

  // The seeding runs in the authenticated session, so the current user is
  // the post author (n3o). Use their real profile picture + id for the
  // byline so the blog shows the actual avatar rather than a placeholder.
  const user = useAuthStore.getState().user;
  const authorAvatarUrl = user?.profile_image?.trim() || undefined;
  const authorId = user?.user_id?.trim() || undefined;
  const byline = {
    authorName: SEED_AUTHOR_NAME,
    ...(authorAvatarUrl ? { authorAvatarUrl } : {}),
    ...(authorId ? { authorId } : {}),
  };

  let existingBySlug = new Map<string, Note>();
  try {
    const tree = await api.notes.tree(projectId);
    existingBySlug = new Map(
      tree.notes
        .filter((n): n is Note & { slug: string } => Boolean(n.slug))
        .map((n) => [n.slug, n]),
    );
  } catch {
    // If the tree can't be read, fall through: per-post creates will
    // surface their own errors.
  }

  // Publish oldest release day first (highest sortOrder), so the newest
  // day ends up with the latest publishedAt on the public blog.
  const ordered = [...SEED_POSTS].sort((a, b) => b.sortOrder - a.sortOrder);

  for (const post of ordered) {
    try {
      const existing = existingBySlug.get(post.slug);
      if (existing) {
        // Backfill the byline (incl. avatar) on an already-published post
        // so re-running the action heals posts created before the author
        // picture was set.
        await api.notes.updateNote(projectId, existing.id, byline);
        results.push({
          slug: post.slug,
          title: post.title,
          status: "updated",
          message: "byline refreshed",
        });
        continue;
      }

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
        ...byline,
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
