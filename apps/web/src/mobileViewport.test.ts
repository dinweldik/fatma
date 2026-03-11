import { describe, expect, it } from "vitest";

import { resolveMobileViewportMetrics } from "./mobileViewport";

describe("resolveMobileViewportMetrics", () => {
  it("falls back to the layout viewport height when visualViewport is unavailable", () => {
    expect(
      resolveMobileViewportMetrics({
        innerHeight: 844,
        layoutViewportHeight: 844,
      }),
    ).toEqual({
      isKeyboardOpen: false,
      keyboardInset: 0,
      viewportHeight: 844,
    });
  });

  it("treats the reduced visual viewport height as a keyboard inset", () => {
    expect(
      resolveMobileViewportMetrics({
        innerHeight: 544,
        layoutViewportHeight: 844,
        visualViewportHeight: 544,
        visualViewportOffsetTop: 0,
      }),
    ).toEqual({
      isKeyboardOpen: true,
      keyboardInset: 300,
      viewportHeight: 544,
    });
  });

  it("subtracts visual viewport offset from the keyboard inset calculation", () => {
    expect(
      resolveMobileViewportMetrics({
        innerHeight: 600,
        layoutViewportHeight: 844,
        visualViewportHeight: 600,
        visualViewportOffsetTop: 44,
      }),
    ).toEqual({
      isKeyboardOpen: true,
      keyboardInset: 200,
      viewportHeight: 600,
    });
  });

  it("falls back to innerHeight when a stable layout viewport height is unavailable", () => {
    expect(
      resolveMobileViewportMetrics({
        innerHeight: 844,
        layoutViewportHeight: null,
        visualViewportHeight: 544,
        visualViewportOffsetTop: 0,
      }),
    ).toEqual({
      isKeyboardOpen: true,
      keyboardInset: 300,
      viewportHeight: 544,
    });
  });
});
