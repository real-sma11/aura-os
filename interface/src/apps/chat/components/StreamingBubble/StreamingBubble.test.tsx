import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StreamingBubble } from "./StreamingBubble";

vi.mock("../LLMOutput", () => ({
  LLMStreamOutput: () => <div data-testid="llm-output" />,
}));

vi.mock("../../../../components/MediaGenerationPlaceholder", () => ({
  MediaGenerationPlaceholder: (props: { kind: string; percent?: number | null }) => (
    <div data-testid="media-placeholder" data-kind={props.kind} data-percent={props.percent ?? ""} />
  ),
}));

describe("StreamingBubble", () => {
  it("does not render a media placeholder for a normal text turn", () => {
    render(<StreamingBubble isStreaming text="hello" />);
    expect(screen.queryByTestId("media-placeholder")).not.toBeInTheDocument();
  });

  it("renders an image placeholder while an image generation is in flight", () => {
    render(
      <StreamingBubble
        isStreaming
        text=""
        generationKind="image"
        generationPercent={25}
      />,
    );
    const placeholder = screen.getByTestId("media-placeholder");
    expect(placeholder).toHaveAttribute("data-kind", "image");
    expect(placeholder).toHaveAttribute("data-percent", "25");
  });

  it("renders a video placeholder while a video generation is in flight", () => {
    render(<StreamingBubble isStreaming text="" generationKind="video" />);
    expect(screen.getByTestId("media-placeholder")).toHaveAttribute(
      "data-kind",
      "video",
    );
  });

  it("does not render a placeholder for 3d generation", () => {
    render(<StreamingBubble isStreaming text="" generationKind="3d" />);
    expect(screen.queryByTestId("media-placeholder")).not.toBeInTheDocument();
  });
});
