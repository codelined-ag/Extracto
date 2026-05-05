import { describe, expect, it } from "vitest";

import { extractEquations } from "@/lib/equations/extract";

describe("extractEquations", () => {
  it("returns empty result for plain prose", () => {
    const r = extractEquations("This is just prose, no math here.");
    expect(r.count).toBe(0);
    expect(r.display).toEqual([]);
    expect(r.inline).toEqual([]);
  });

  it("captures a display equation", () => {
    const r = extractEquations("Theorem: $$E = mc^2$$ explains energy.");
    expect(r.display).toHaveLength(1);
    expect(r.display[0].latex).toBe("E = mc^2");
  });

  it("captures an inline equation with the dollar-sign convention", () => {
    const r = extractEquations("We can write $a^2 + b^2 = c^2$ as Pythagoras.");
    expect(r.inline).toHaveLength(1);
    expect(r.inline[0].latex).toBe("a^2 + b^2 = c^2");
  });

  it("captures multi-line display equations", () => {
    const r = extractEquations("Solution:\n$$\\int_0^\\infty e^{-x} dx = 1$$\nDone.");
    expect(r.display).toHaveLength(1);
    expect(r.display[0].latex).toContain("\\int");
  });

  it("does not double-count inline math inside display blocks", () => {
    const r = extractEquations("$$a + b$$ and $c + d$");
    expect(r.display).toHaveLength(1);
    expect(r.inline).toHaveLength(1);
    expect(r.inline[0].latex).toBe("c + d");
  });

  it("ignores math inside inline code spans", () => {
    const r = extractEquations("Use `$x = 1$` in your code, not in math.");
    expect(r.inline).toHaveLength(0);
  });

  it("ignores math inside fenced code blocks", () => {
    const text = "```\nlet x = $5;\nlet y = $10;\n```\nThe formula $a + b$ is real.";
    const r = extractEquations(text);
    expect(r.inline).toHaveLength(1);
    expect(r.inline[0].latex).toBe("a + b");
  });

  it("does not match plain currency expressions", () => {
    const r = extractEquations("It costs $5 and another $10 today.");
    expect(r.inline).toHaveLength(0);
  });

  it("counts both display and inline entries in the total", () => {
    const r = extractEquations("$$F = ma$$ where $m$ is mass and $a$ is acceleration.");
    expect(r.display).toHaveLength(1);
    expect(r.inline).toHaveLength(2);
    expect(r.count).toBe(3);
  });

  it("preserves char offsets that bound the original span", () => {
    const text = "Equation: $$\\sum n$$";
    const r = extractEquations(text);
    expect(r.display).toHaveLength(1);
    const eq = r.display[0];
    expect(text.slice(eq.startOffset, eq.endOffset)).toBe("$$\\sum n$$");
  });
});
