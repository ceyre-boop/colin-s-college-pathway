import { test, expect, describe } from "bun:test";
import {
  stripFencedCode,
  stripIndentedBlocks,
  stripPastedOutput,
  stripUrlsAndPaths,
  stripFileRefs,
  collapseWhitespace,
  clean,
  dedupeNear,
  jaccard,
} from "./clean.ts";

const FENCE = "```";

describe("stripFencedCode", () => {
  test("removes a closed fence and keeps the prose around it", () => {
    const s = `here is the idea\n${FENCE}ts\nconst x = 1;\n${FENCE}\nand that is why`;
    const out = stripFencedCode(s);
    expect(out).not.toContain("const x");
    expect(out).toContain("here is the idea");
    expect(out).toContain("and that is why");
  });

  test("removes an unterminated fence running to end of message", () => {
    const s = `look at this\n${FENCE}\nsome code\nmore code`;
    expect(stripFencedCode(s)).not.toContain("some code");
  });
});

describe("stripIndentedBlocks", () => {
  test("drops runs of 3+ indented lines", () => {
    const s = "prose line\n    a\n    b\n    c\nmore prose";
    const out = stripIndentedBlocks(s);
    expect(out).toContain("prose line");
    expect(out).toContain("more prose");
    expect(out).not.toContain("    a");
  });

  test("keeps a short indented run — that is prose formatting, not a block", () => {
    const s = "prose\n    just one indented line\nmore";
    expect(stripIndentedBlocks(s)).toContain("just one indented line");
  });
});

describe("stripPastedOutput", () => {
  test("drops stack-trace and error prefixes", () => {
    const s = "it broke\nError: boom\n    at foo (bar)\nany ideas?";
    const out = stripPastedOutput(s);
    expect(out).toContain("it broke");
    expect(out).toContain("any ideas?");
    expect(out).not.toContain("Error: boom");
  });

  test("drops long runs of unpunctuated lines (a table or listing)", () => {
    const s = "here is the output\nfoo 1\nbar 2\nbaz 3\nqux 4\nwhat do you think?";
    const out = stripPastedOutput(s);
    expect(out).not.toContain("qux 4");
    expect(out).toContain("what do you think?");
  });

  test("keeps ordinary multi-line prose", () => {
    const s = "This is a sentence. And another one.\nA third here. Then a fourth.";
    const out = stripPastedOutput(s);
    expect(out).toContain("A third here.");
  });
});

describe("stripUrlsAndPaths", () => {
  test("substitutes rather than deletes, preserving the slot", () => {
    expect(stripUrlsAndPaths("go read https://example.com/x now")).toBe("go read [url] now");
    expect(stripUrlsAndPaths("check ~/quant/NEXT.md ok")).toBe("check [path] ok");
  });
});

describe("stripFileRefs", () => {
  test("removes @mentions and line-numbered refs", () => {
    expect(stripFileRefs("look at @src/App.jsx please")).toBe("look at please");
    expect(stripFileRefs("bug in server.ts:44 there")).toBe("bug in [ref] there");
  });
});

describe("collapseWhitespace", () => {
  test("collapses runs but preserves paragraph breaks", () => {
    expect(collapseWhitespace("a   b\n\n\n\nc")).toBe("a b\n\nc");
  });
});

describe("clean", () => {
  test("accepts real prose", () => {
    const r = clean("I think the distinction is more technical than moral, and that matters here.");
    expect(r.rejected).toBeNull();
    expect(r.wordCount).toBeGreaterThan(8);
  });

  test("rejects a short directive", () => {
    expect(clean("run the tests").rejected).toBe("too-short");
  });

  test("rejects a message that was almost entirely a code paste", () => {
    const s = `fix this\n${FENCE}\n${"const x = 1;\n".repeat(80)}${FENCE}`;
    expect(clean(s).rejected).toBe("mostly-stripped");
  });

  test("rejects symbol soup", () => {
    expect(clean("{}[]()<>{}[]()<>{}[]()<>{}[]()<> ;;; ||| &&& %%% $$$ ###").rejected).not.toBeNull();
  });
});

describe("dedupeNear", () => {
  test("collapses near-identical repeated directives, keeping the first", () => {
    const rows = [
      { text: "please run the full test suite and then commit the result to main" },
      { text: "please run the full test suite and then commit the result to main now" },
      { text: "the refrigerator argument is the one that actually carries the paragraph" },
    ];
    const out = dedupeNear(rows, 0.7);
    expect(out).toHaveLength(2);
    expect(out[0].text).toContain("please run the full");
  });

  test("keeps genuinely different prose", () => {
    const rows = [{ text: "one two three four five six seven" }, { text: "alpha beta gamma delta epsilon zeta eta" }];
    expect(dedupeNear(rows)).toHaveLength(2);
  });

  test("jaccard is 1 for identical sets and 0 for disjoint", () => {
    expect(jaccard(new Set(["a"]), new Set(["a"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
});
