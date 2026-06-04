import type { Project } from "../../shared/types";

/**
 * The reserved "aura-blog" CMS project. Backend gates all writes to this
 * project to system administrators and treats its notes as blog posts
 * (draft/published lifecycle, blog metadata). The id is a fixed reserved
 * UUID so both the API and the client can refer to the same project
 * without a lookup.
 */
export const AURA_BLOG_PROJECT_ID = "00000000-0000-0000-0000-00000000b106";
export const AURA_BLOG_PROJECT_NAME = "aura-blog";

/** True when `projectId` is the reserved aura-blog CMS project. */
export function isAuraBlogProject(
  projectId: string | null | undefined,
): boolean {
  return projectId === AURA_BLOG_PROJECT_ID;
}

/**
 * Build a synthetic `Project` row for the virtual aura-blog CMS project.
 * This is never persisted to the projects store — it only exists so the
 * Notes left-nav (which maps over `Project` objects) can render the
 * aura-blog tree for sys admins. Only `project_id` / `name` are read by
 * the nav + tree code; the remaining required fields get sensible
 * defaults so the object satisfies the `Project` shape.
 */
export function buildAuraBlogProject(orgId: string): Project {
  const now = new Date().toISOString();
  return {
    project_id: AURA_BLOG_PROJECT_ID,
    org_id: orgId,
    name: AURA_BLOG_PROJECT_NAME,
    description: "Aura blog CMS",
    current_status: "active",
    created_at: now,
    updated_at: now,
  };
}
