import { describe, expect, it } from "vitest";
import { canonicalInputKey, computeUniquePathTails } from "./grouping";

describe("computeUniquePathTails", () => {
  it("returns the bare basename for paths with no sibling collision", () => {
    const tails = computeUniquePathTails(["src/main.rs", "lib/util.ts"]);
    expect(tails.get("src/main.rs")).toBe("main.rs");
    expect(tails.get("lib/util.ts")).toBe("util.ts");
  });

  it("promotes colliding basenames to their full normalized path", () => {
    const tails = computeUniquePathTails([
      "crates/aura-os-core/Cargo.toml",
      "crates/aura-os-cli/Cargo.toml",
    ]);
    expect(tails.get("crates/aura-os-core/Cargo.toml")).toBe(
      "crates/aura-os-core/Cargo.toml",
    );
    expect(tails.get("crates/aura-os-cli/Cargo.toml")).toBe(
      "crates/aura-os-cli/Cargo.toml",
    );
  });

  it("uses the full path when two single-directory siblings collide", () => {
    const tails = computeUniquePathTails(["a/Cargo.toml", "b/Cargo.toml"]);
    expect(tails.get("a/Cargo.toml")).toBe("a/Cargo.toml");
    expect(tails.get("b/Cargo.toml")).toBe("b/Cargo.toml");
  });

  it("treats Windows backslashes the same as forward slashes", () => {
    const tails = computeUniquePathTails([
      "crates\\a\\Cargo.toml",
      "crates\\b\\Cargo.toml",
    ]);
    expect(tails.get("crates\\a\\Cargo.toml")).toBe("crates/a/Cargo.toml");
    expect(tails.get("crates\\b\\Cargo.toml")).toBe("crates/b/Cargo.toml");
  });

  it("collapses duplicate paths into a single map entry", () => {
    const tails = computeUniquePathTails(["foo.rs", "foo.rs", "foo.rs"]);
    expect(tails.size).toBe(1);
    expect(tails.get("foo.rs")).toBe("foo.rs");
  });
});

describe("canonicalInputKey", () => {
  it("returns the same key for inputs that differ only by JS object key order", () => {
    const a = canonicalInputKey("read_file", { path: "a.rs", offset: 0 });
    const b = canonicalInputKey("read_file", { offset: 0, path: "a.rs" });
    expect(a).toBe(b);
  });

  it("returns different keys when the tool name differs", () => {
    const a = canonicalInputKey("read_file", { path: "a.rs" });
    const b = canonicalInputKey("write_file", { path: "a.rs" });
    expect(a).not.toBe(b);
  });

  it("returns different keys when any input value differs", () => {
    const a = canonicalInputKey("read_file", { path: "a.rs" });
    const b = canonicalInputKey("read_file", { path: "b.rs" });
    expect(a).not.toBe(b);
  });
});
