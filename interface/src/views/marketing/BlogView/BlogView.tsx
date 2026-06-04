import { isValidElement, type ReactNode, useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import {
  type BlogPost,
  BlogPostNotFoundError,
  fetchBlogBody,
  fetchBlogPost,
  fetchBlogPosts,
} from "../../../api/marketing/blog";
import { Avatar } from "../../../components/Avatar/Avatar";
import styles from "./BlogView.module.css";

const MD_REMARK = [remarkGfm];
const MD_REHYPE = [rehypeHighlight];

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

function formatDate(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return DATE_FORMATTER.format(parsed);
}

/**
 * Stable, deterministic heading slug. Used both to build the table of
 * contents from the raw markdown and to assign matching `id`s to the
 * rendered headings, so anchor clicks resolve. Intentionally has no
 * de-duplication so the two call sites always agree on the same id for a
 * given heading text.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Recursively flattens rendered markdown children into plain text. */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

interface TocItem {
  readonly depth: number;
  readonly text: string;
  readonly id: string;
}

/**
 * Parse top-level (`#`) and second-level (`##`) markdown headings into a
 * flat table of contents, skipping fenced code blocks so `# comment`
 * lines inside ``` blocks aren't mistaken for headings.
 */
function buildToc(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let inFence = false;
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,2})\s+(.+?)\s*#*$/.exec(line);
    if (!match) continue;
    const text = match[2].trim();
    items.push({ depth: match[1].length, text, id: slugify(text) });
  }
  return items;
}

function ExternalLink(
  props: React.AnchorHTMLAttributes<HTMLAnchorElement>,
): React.ReactElement {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function HeadingWithId(
  Tag: "h1" | "h2" | "h3",
): (props: { children?: ReactNode }) => React.ReactElement {
  return function Heading({ children }): React.ReactElement {
    return <Tag id={slugify(extractText(children))}>{children}</Tag>;
  };
}

const MD_COMPONENTS: Components = {
  a: ExternalLink,
  h1: HeadingWithId("h1"),
  h2: HeadingWithId("h2"),
  h3: HeadingWithId("h3"),
};

function PostByline({ post }: { post: BlogPost }): React.ReactElement {
  return (
    <div className={styles.byline}>
      <Avatar
        type="user"
        size={40}
        avatarUrl={post.authorAvatarUrl ?? undefined}
        name={post.authorName ?? undefined}
      />
      <div className={styles.bylineMeta}>
        {post.authorName ? (
          <span className={styles.bylineName}>{post.authorName}</span>
        ) : null}
        <span className={styles.bylineReadTime}>
          {post.readTimeMinutes} min read
        </span>
      </div>
    </div>
  );
}

function BlogPostCard({ post }: { post: BlogPost }): React.ReactElement {
  return (
    <Link to={`/blog/${post.slug}`} className={styles.card}>
      {post.heroImageUrl ? (
        <div className={styles.cardHeroWrap}>
          <img
            src={post.heroImageUrl}
            alt=""
            className={styles.cardHero}
            loading="lazy"
            decoding="async"
          />
        </div>
      ) : null}
      <div className={styles.cardBody}>
        <div className={styles.cardMeta}>
          <span className={styles.cardType}>{post.blogType}</span>
          {post.publishedAt ? (
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          ) : null}
        </div>
        <h2 className={styles.cardTitle}>{post.title}</h2>
        {post.excerpt ? <p className={styles.cardExcerpt}>{post.excerpt}</p> : null}
        <div className={styles.cardBylineRow}>
          <Avatar
            type="user"
            size={24}
            avatarUrl={post.authorAvatarUrl ?? undefined}
            name={post.authorName ?? undefined}
          />
          {post.authorName ? (
            <span className={styles.cardAuthor}>{post.authorName}</span>
          ) : null}
          <span className={styles.cardReadTime}>{post.readTimeMinutes} min read</span>
        </div>
      </div>
    </Link>
  );
}

function BlogIndex({
  posts,
  isLoading,
}: {
  posts: readonly BlogPost[];
  isLoading: boolean;
}): React.ReactElement {
  return (
    <div className={styles.indexShell}>
      <header className={styles.indexHeader}>
        <h1 className={styles.indexTitle}>Blog</h1>
        <p className={styles.indexSubtitle}>
          Product updates, engineering deep-dives, and stories from the team
          building AURA.
        </p>
      </header>
      {isLoading ? (
        <p className={styles.stateMessage} aria-busy="true">
          Loading posts…
        </p>
      ) : posts.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>No posts yet.</h2>
          <p>The blog is connected, but no posts have been published yet.</p>
        </div>
      ) : (
        <div className={styles.cardGrid} aria-label="Blog posts">
          {posts.map((post) => (
            <BlogPostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}

function TableOfContents({
  items,
}: {
  items: readonly TocItem[];
}): React.ReactElement | null {
  if (items.length === 0) return null;

  const handleClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    id: string,
  ): void => {
    const target = document.getElementById(id);
    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <nav className={styles.toc} aria-label="Table of contents">
      <span className={styles.tocLabel}>On this page</span>
      <ul className={styles.tocList}>
        {items.map((item, index) => (
          <li
            key={`${item.id}-${index}`}
            className={styles.tocItem}
            data-depth={item.depth}
          >
            <a href={`#${item.id}`} onClick={(event) => handleClick(event, item.id)}>
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BlogSinglePost({
  post,
  body,
  bodyLoading,
  otherPosts,
}: {
  post: BlogPost;
  body: string;
  bodyLoading: boolean;
  otherPosts: readonly BlogPost[];
}): React.ReactElement {
  const toc = useMemo(() => buildToc(body), [body]);

  const groupedByType = useMemo(() => {
    const map = new Map<string, BlogPost[]>();
    for (const other of otherPosts) {
      const list = map.get(other.blogType) ?? [];
      list.push(other);
      map.set(other.blogType, list);
    }
    return [...map.entries()];
  }, [otherPosts]);

  return (
    <div className={styles.postShell}>
      <div className={styles.postLayout}>
        <aside className={styles.prevList} aria-label="More posts">
          <span className={styles.prevListLabel}>More posts</span>
          {otherPosts.length === 0 ? (
            <p className={styles.prevListEmpty}>No other posts yet.</p>
          ) : (
            <ul>
              {otherPosts.map((other) => (
                <li key={other.id}>
                  <Link to={`/blog/${other.slug}`} className={styles.prevListLink}>
                    <span className={styles.prevListTitle}>{other.title}</span>
                    {other.publishedAt ? (
                      <time
                        dateTime={other.publishedAt}
                        className={styles.prevListDate}
                      >
                        {formatDate(other.publishedAt)}
                      </time>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <article className={styles.postColumn}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <Link to="/blog">Blog</Link>
            <span aria-hidden="true" className={styles.breadcrumbSep}>
              /
            </span>
            <span className={styles.breadcrumbCurrent}>{post.blogType}</span>
          </nav>

          {post.publishedAt ? (
            <time className={styles.postDate} dateTime={post.publishedAt}>
              {formatDate(post.publishedAt)}
            </time>
          ) : null}

          <h1 className={styles.postTitle}>{post.title}</h1>

          <PostByline post={post} />

          {post.heroImageUrl ? (
            <div className={styles.postHeroWrap}>
              <img
                src={post.heroImageUrl}
                alt=""
                className={styles.postHero}
                decoding="async"
              />
            </div>
          ) : null}

          <TableOfContents items={toc} />

          <div className={styles.markdownBody}>
            {bodyLoading ? (
              <p className={styles.stateMessage} aria-busy="true">
                Loading…
              </p>
            ) : body ? (
              <ReactMarkdown
                remarkPlugins={MD_REMARK}
                rehypePlugins={MD_REHYPE}
                components={MD_COMPONENTS}
              >
                {body}
              </ReactMarkdown>
            ) : (
              <p className={styles.stateMessage}>
                This post has no content yet.
              </p>
            )}
          </div>
        </article>
      </div>

      {groupedByType.length > 0 ? (
        <section className={styles.moreSection} aria-label="More from the blog">
          <h2 className={styles.moreSectionTitle}>More from the blog</h2>
          {groupedByType.map(([type, group]) => (
            <div key={type} className={styles.moreGroup}>
              <h3 className={styles.moreGroupTitle}>{type}</h3>
              <div className={styles.cardGrid}>
                {group.map((other) => (
                  <BlogPostCard key={other.id} post={other} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Public `/blog` site. Renders the index list at `/blog` and a single
 * post at `/blog/:slug` (read via `useParams`). The markdown body is not
 * part of the post JSON, so it's fetched separately from the post's
 * public S3 `bodyUrl` and rendered with the same `react-markdown` stack
 * the app uses for read-only content. Page chrome (titlebar / sidebar /
 * scroll column) is owned by the public-mode `AuraShell` +
 * `PublicMarketingPanel`; `usePublicPageViewed` is fired there.
 */
export function BlogView(): React.ReactElement {
  const { slug } = useParams<{ slug?: string }>();

  const { data: posts, isLoading: postsLoading } = useQuery({
    queryKey: ["marketing-blog"],
    queryFn: fetchBlogPosts,
  });

  const {
    data: post,
    isLoading: postLoading,
    error: postError,
  } = useQuery({
    queryKey: ["marketing-blog-post", slug],
    queryFn: () => fetchBlogPost(slug as string),
    enabled: Boolean(slug),
    retry: false,
  });

  const bodyUrl = post?.bodyUrl;
  const { data: body, isLoading: bodyLoading } = useQuery({
    queryKey: ["marketing-blog-body", bodyUrl],
    queryFn: () => fetchBlogBody(bodyUrl as string),
    enabled: Boolean(bodyUrl),
  });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = post ? `AURA - ${post.title}` : "AURA - Blog";
    return () => {
      document.title = previousTitle;
    };
  }, [post]);

  const allPosts = useMemo<readonly BlogPost[]>(() => posts ?? [], [posts]);

  if (!slug) {
    return (
      <section className={styles.page}>
        <BlogIndex posts={allPosts} isLoading={postsLoading} />
      </section>
    );
  }

  if (postError instanceof BlogPostNotFoundError) {
    return (
      <section className={styles.page}>
        <div className={styles.notFound}>
          <h1>Post not found</h1>
          <p>The post you're looking for doesn't exist or isn't published.</p>
          <Link to="/blog" className={styles.notFoundLink}>
            ← Back to the blog
          </Link>
        </div>
      </section>
    );
  }

  if (postLoading || !post) {
    return (
      <section className={styles.page}>
        <p className={styles.stateMessage} aria-busy="true">
          Loading post…
        </p>
      </section>
    );
  }

  const otherPosts = allPosts.filter((candidate) => candidate.id !== post.id);

  return (
    <section className={styles.page}>
      <BlogSinglePost
        post={post}
        body={body ?? ""}
        bodyLoading={bodyLoading}
        otherPosts={otherPosts}
      />
    </section>
  );
}
