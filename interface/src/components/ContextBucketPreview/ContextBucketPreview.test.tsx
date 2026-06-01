import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("./ContextBucketPreview.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// Stub the ZUI primitives so the test asserts on the component's own
// rendering rather than the vendored library internals. `GroupCollapsible`
// always renders its children so seeded segments are queryable without
// driving the collapse animation.
vi.mock("@cypher-asi/zui", () => {
  const Item = Object.assign(
    ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
      <div role="button" onClick={onClick}>
        {children}
      </div>
    ),
    {
      Icon: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
      Label: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
      Chevron: () => <span aria-hidden="true" />,
      Action: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
      Spacer: () => <span />,
    },
  );
  return {
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    GroupCollapsible: ({
      children,
      label,
      count,
    }: {
      children?: ReactNode;
      label?: string;
      count?: number;
    }) => (
      <div data-testid={`group-${label}`}>
        {label}
        {count}
        {children}
      </div>
    ),
    Item,
  };
});

import { ContextBucketPreview } from "./ContextBucketPreview";
import {
  useContextContentsStore,
  type ContextContents,
} from "../../stores/context-contents-store";

const STREAM_KEY = "stream-1";

function emptyContents(): ContextContents {
  return { systemPrompt: undefined, tools: [], skills: [], subagents: [], mcp: [] };
}

beforeEach(() => {
  useContextContentsStore.getState().clearContextContents(STREAM_KEY);
});

describe("ContextBucketPreview", () => {
  it("shows the friendly empty state when no contents are cached", () => {
    render(<ContextBucketPreview bucketId="tools" streamKey={STREAM_KEY} />);
    expect(
      screen.getByText(/aren't available from this harness build yet/i),
    ).toBeInTheDocument();
  });

  it("renders the system prompt text when contents are seeded", () => {
    useContextContentsStore.getState().setContextContents(STREAM_KEY, {
      ...emptyContents(),
      systemPrompt: "You are a helpful assistant.",
    });

    render(
      <ContextBucketPreview bucketId="system_prompt" streamKey={STREAM_KEY} />,
    );

    expect(
      screen.getByText(/You are a helpful assistant\./),
    ).toBeInTheDocument();
  });

  it("lists tool segments with their token counts when seeded", () => {
    useContextContentsStore.getState().setContextContents(STREAM_KEY, {
      ...emptyContents(),
      tools: [
        { label: "read_file", text: "reads a file", tokens: 1234 },
        { label: "write_file", text: "writes a file", tokens: 56 },
      ],
    });

    render(<ContextBucketPreview bucketId="tools" streamKey={STREAM_KEY} />);

    expect(screen.getByTestId("group-Tools")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("write_file")).toBeInTheDocument();
    expect(screen.getByText("1,234 tokens")).toBeInTheDocument();
    expect(screen.getByText("56 tokens")).toBeInTheDocument();
  });

  it("lists skill segments when seeded", () => {
    useContextContentsStore.getState().setContextContents(STREAM_KEY, {
      ...emptyContents(),
      skills: [{ label: "canvas", text: "draws a canvas", tokens: 42 }],
    });

    render(<ContextBucketPreview bucketId="skills" streamKey={STREAM_KEY} />);

    expect(screen.getByTestId("group-Skills")).toBeInTheDocument();
    expect(screen.getByText("canvas")).toBeInTheDocument();
    expect(screen.getByText("42 tokens")).toBeInTheDocument();
  });

  it("renders the conversation note even without cached contents", () => {
    render(
      <ContextBucketPreview bucketId="conversation" streamKey={STREAM_KEY} />,
    );

    expect(
      screen.getByText(/live chat transcript/i),
    ).toBeInTheDocument();
  });
});
