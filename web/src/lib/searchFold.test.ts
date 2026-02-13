import { describe, it, expect } from "vitest";
import { foldForSearch } from "./searchFold";

describe("foldForSearch", () => {
  it("lowercases text", () => {
    expect(foldForSearch("HELLO World")).toBe("hello world");
  });

  it("removes diacritics (NFD decomposition)", () => {
    expect(foldForSearch("café")).toBe("cafe");
    expect(foldForSearch("naïve")).toBe("naive");
    expect(foldForSearch("résumé")).toBe("resume");
    expect(foldForSearch("über")).toBe("uber");
  });

  it("folds special letters that don't decompose via NFD", () => {
    expect(foldForSearch("ø")).toBe("o");
    expect(foldForSearch("ß")).toBe("ss");
    expect(foldForSearch("æ")).toBe("ae");
    expect(foldForSearch("œ")).toBe("oe");
    expect(foldForSearch("đ")).toBe("d");
    expect(foldForSearch("ð")).toBe("d");
    expect(foldForSearch("þ")).toBe("th");
    expect(foldForSearch("ł")).toBe("l");
  });

  it("removes straight quotes and right single quotes", () => {
    expect(foldForSearch("don't")).toBe("dont");
    expect(foldForSearch("it\u2019s")).toBe("its"); // right single quote
    expect(foldForSearch(`"hello"`)).toBe("hello");
  });

  it("preserves left single quotation mark (not in strip list)", () => {
    // U+2018 (left single quote) is not in the quote regex
    expect(foldForSearch("\u2018smart\u2019")).toBe("\u2018smart");
  });

  it("preserves most punctuation (regex is conservative)", () => {
    // The current regex does not strip hyphens, parens, dots, etc.
    expect(foldForSearch("hello-world")).toBe("hello-world");
    expect(foldForSearch("hello_world")).toBe("hello_world");
    expect(foldForSearch("hello.world")).toBe("hello.world");
    expect(foldForSearch("(hello)")).toBe("(hello)");
  });

  it("collapses multiple spaces", () => {
    expect(foldForSearch("hello   world")).toBe("hello world");
  });

  it("trims leading/trailing whitespace", () => {
    expect(foldForSearch("  hello  ")).toBe("hello");
  });

  it("handles empty/null-ish input", () => {
    expect(foldForSearch("")).toBe("");
    expect(foldForSearch(null as any)).toBe("");
    expect(foldForSearch(undefined as any)).toBe("");
  });

  it("handles a realistic track name with diacritics", () => {
    expect(foldForSearch("Foiníx (Live)")).toBe("foinix (live)");
  });

  it("handles Norwegian artist name", () => {
    expect(foldForSearch("Bjørk")).toBe("bjork");
  });
});
