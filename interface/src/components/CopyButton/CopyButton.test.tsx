import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

describe("CopyButton", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const write = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    write.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, write },
      writable: true,
      configurable: true,
    });
    // jsdom doesn't ship ClipboardItem; stub it so the dual-MIME
    // path in `copyToClipboard` can run.
    class FakeClipboardItem {
      types: string[];
      private _data: Record<string, Blob>;
      constructor(data: Record<string, Blob>) {
        this._data = data;
        this.types = Object.keys(data);
      }
      getType(type: string): Promise<Blob> {
        return Promise.resolve(this._data[type]);
      }
    }
    (globalThis as unknown as { ClipboardItem: typeof FakeClipboardItem })
      .ClipboardItem = FakeClipboardItem;
  });

  it("writes to the clipboard and flips label to Copied", async () => {
    render(<CopyButton getText={() => "hello world"} />);

    expect(screen.getByText("Copy")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("copy-button"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("hello world");
    });
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });

    await waitFor(
      () => {
        expect(screen.getByText("Copy")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("stops click propagation to parent handlers", async () => {
    const parentClick = vi.fn();

    render(
      <div onClick={parentClick}>
        <CopyButton getText={() => "value"} />
      </div>,
    );

    fireEvent.click(screen.getByTestId("copy-button"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("value");
    });
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("is a no-op when getText returns empty", async () => {
    render(<CopyButton getText={() => ""} />);

    fireEvent.click(screen.getByTestId("copy-button"));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("writes both text/plain (markdown) and text/html when getMarkdown is provided", async () => {
    render(<CopyButton getMarkdown={() => "# Title\n\n**bold**"} />);

    fireEvent.click(screen.getByTestId("copy-button"));

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    // Plain text path should NOT be used when the dual-MIME path
    // succeeds -- otherwise we'd clobber the rich payload.
    expect(writeText).not.toHaveBeenCalled();

    const item = write.mock.calls[0][0][0] as {
      types: string[];
      getType: (t: string) => Promise<Blob>;
    };
    expect(item.types).toEqual(
      expect.arrayContaining(["text/plain", "text/html"]),
    );
    const plain = await (await item.getType("text/plain")).text();
    const html = await (await item.getType("text/html")).text();
    expect(plain).toBe("# Title\n\n**bold**");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("getMarkdown takes precedence over getText", async () => {
    render(
      <CopyButton
        getText={() => "fallback"}
        getMarkdown={() => "# preferred"}
      />,
    );

    fireEvent.click(screen.getByTestId("copy-button"));

    await waitFor(() => {
      expect(write).toHaveBeenCalledTimes(1);
    });
    const item = write.mock.calls[0][0][0] as {
      getType: (t: string) => Promise<Blob>;
    };
    const plain = await (await item.getType("text/plain")).text();
    expect(plain).toBe("# preferred");
  });
});
