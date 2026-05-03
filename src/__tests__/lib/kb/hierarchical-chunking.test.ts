import { describe, expect, it } from "vitest";

import { chunk, chunkHierarchical } from "@/lib/kb/chunking";

describe("chunkHierarchical", () => {
  it("returns nothing for empty / whitespace input", () => {
    expect(chunkHierarchical("", 100, 0, 6)).toEqual([]);
    expect(chunkHierarchical("   \n\n  ", 100, 0, 6)).toEqual([]);
  });

  it("tags each chunk with the heading breadcrumb and depth", () => {
    const md = `# Doc Title

Intro paragraph.

## Section A

Body of A.

## Section B

### Subsection B1

Deep content here.`;
    const out = chunkHierarchical(md, 1000, 0, 6);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      text: "Intro paragraph.",
      extras: { headingPath: ["Doc Title"], headingLevel: 1 },
    });
    expect(out[1]).toEqual({
      text: "Body of A.",
      extras: { headingPath: ["Doc Title", "Section A"], headingLevel: 2 },
    });
    expect(out[2]).toEqual({
      text: "Deep content here.",
      extras: { headingPath: ["Doc Title", "Section B", "Subsection B1"], headingLevel: 3 },
    });
  });

  it("treats a documents with no headings as a single section with empty path and level 0", () => {
    const out = chunkHierarchical("Just some prose.\n\nMore prose.", 1000, 0, 6);
    expect(out).toHaveLength(1);
    expect(out[0].extras).toEqual({ headingPath: [], headingLevel: 0 });
    expect(out[0].text).toContain("Just some prose.");
    expect(out[0].text).toContain("More prose.");
  });

  it("pops the heading stack on a same-or-shallower level (no leak across sections)", () => {
    const md = `# A

Body A.

## A.1

Body A.1.

# B

Body B.`;
    const out = chunkHierarchical(md, 1000, 0, 6);
    const paths = out.map((p) => p.extras?.headingPath);
    expect(paths).toEqual([["A"], ["A", "A.1"], ["B"]]);
  });

  it("folds headings deeper than maxHeadingDepth into the parent's body", () => {
    const md = `# Top

Top body.

## Sub

Sub body.

### TooDeep

Deep body.`;
    const out = chunkHierarchical(md, 1000, 0, 2);
    expect(out).toHaveLength(2);
    expect(out[1].extras?.headingPath).toEqual(["Top", "Sub"]);
    expect(out[1].text).toContain("Sub body.");
    expect(out[1].text).toContain("### TooDeep");
    expect(out[1].text).toContain("Deep body.");
  });

  it("respects maxChunkSize as a hard cap (splits oversize bodies)", () => {
    const long = "x".repeat(1500);
    const md = `# Big\n\n${long}`;
    const out = chunkHierarchical(md, 500, 0, 6);
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const piece of out) {
      expect(piece.text.length).toBeLessThanOrEqual(500);
      expect(piece.extras?.headingPath).toEqual(["Big"]);
    }
  });

  it("never merges across heading boundaries even when both sides are under maxChunkSize", () => {
    const md = `# A\n\nshort\n\n# B\n\nshort`;
    const out = chunkHierarchical(md, 1000, 0, 6);
    expect(out).toHaveLength(2);
    expect(out[0].extras?.headingPath).toEqual(["A"]);
    expect(out[1].extras?.headingPath).toEqual(["B"]);
  });

  it("chunk() dispatcher forwards hierarchical to chunkHierarchical", () => {
    const out = chunk("# H\n\nbody", { strategy: "hierarchical", maxChunkSize: 1000 });
    expect(out).toEqual([
      { text: "body", extras: { headingPath: ["H"], headingLevel: 1 } },
    ]);
  });

  it("documents the skipped-level case: headingPath.length < headingLevel when ATX levels are skipped", () => {
    // H1 followed directly by H3 (no H2). Per the documented contract, the
    // path is the logical breadcrumb of in-document headings (length 2),
    // but headingLevel reports the raw ATX depth (3). Consumers must NOT
    // index path by level — this test pins the contract.
    const md = `# Top\n\n### Deep\n\nbody`;
    const out = chunkHierarchical(md, 1000, 0, 6);
    expect(out).toHaveLength(1);
    expect(out[0].extras?.headingPath).toEqual(["Top", "Deep"]);
    expect(out[0].extras?.headingLevel).toBe(3);
  });

  it("forwards minChunkSize through to the section-internal merger without crashing", () => {
    // The greedy mergeUntilSize already keeps small pieces glued when
    // they fit; mergeTinyTrailing only fires in tight edge cases the
    // chunkSentence/chunkParagraph tests cover. Here we just verify
    // hierarchical correctly threads minChunkSize through and does not
    // merge across heading boundaries even when min is large.
    const md = `# A\n\nshort\n\n# B\n\nshort`;
    const out = chunkHierarchical(md, 1000, 500, 6);
    expect(out).toHaveLength(2);
    expect(out[0].extras?.headingPath).toEqual(["A"]);
    expect(out[1].extras?.headingPath).toEqual(["B"]);
  });
});
