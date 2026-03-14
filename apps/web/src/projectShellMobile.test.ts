import { describe, expect, it } from "vitest";

import {
  readWrappedTerminalBlockText,
  resolveTouchedBufferLine,
  resolveWrappedTerminalBlockRange,
  type TerminalBufferLike,
} from "./projectShellMobile";

function createBuffer(lines: Array<{ text: string; isWrapped?: boolean }>): TerminalBufferLike {
  return {
    baseY: Math.max(0, lines.length - 1),
    length: lines.length,
    viewportY: 3,
    getLine(y) {
      const line = lines[y];
      if (!line) {
        return undefined;
      }

      return {
        isWrapped: line.isWrapped ?? false,
        translateToString() {
          return line.text;
        },
      };
    },
  };
}

describe("resolveTouchedBufferLine", () => {
  it("maps touch position to the visible buffer row", () => {
    expect(
      resolveTouchedBufferLine({
        bufferLength: 80,
        clientY: 180,
        containerHeight: 240,
        containerTop: 60,
        viewportRows: 6,
        viewportY: 10,
      }),
    ).toBe(13);
  });

  it("clamps touches above and below the viewport", () => {
    expect(
      resolveTouchedBufferLine({
        bufferLength: 40,
        clientY: 10,
        containerHeight: 240,
        containerTop: 60,
        viewportRows: 6,
        viewportY: 8,
      }),
    ).toBe(8);

    expect(
      resolveTouchedBufferLine({
        bufferLength: 40,
        clientY: 500,
        containerHeight: 240,
        containerTop: 60,
        viewportRows: 6,
        viewportY: 8,
      }),
    ).toBe(13);
  });
});

describe("resolveWrappedTerminalBlockRange", () => {
  it("expands to include adjacent wrapped rows", () => {
    const buffer = createBuffer([
      { text: "$ bun run dev" },
      { text: "long output part 1" },
      { text: "part 2", isWrapped: true },
      { text: "part 3", isWrapped: true },
      { text: "$ echo done" },
    ]);

    expect(resolveWrappedTerminalBlockRange(buffer, 2)).toEqual({
      startLine: 1,
      endLine: 3,
    });
  });
});

describe("readWrappedTerminalBlockText", () => {
  it("joins wrapped rows into one logical line", () => {
    const buffer = createBuffer([
      { text: "$ bun run dev" },
      { text: "long output part 1" },
      { text: "part 2", isWrapped: true },
      { text: "part 3", isWrapped: true },
      { text: "$ echo done" },
    ]);

    expect(readWrappedTerminalBlockText(buffer, 2)).toBe("long output part 1part 2part 3");
  });

  it("returns an empty string for invalid rows", () => {
    const buffer = createBuffer([{ text: "hello" }]);
    expect(readWrappedTerminalBlockText(buffer, 5)).toBe("");
  });
});
