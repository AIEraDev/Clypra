import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextMenu } from "../ContextMenu";

describe("ContextMenu Positioning and Collision Detection", () => {
  it("flips upward when right-clicked near bottom of viewport (e.g. on a timeline clip)", () => {
    // Mock viewport dimensions: 1920x900
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1920);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);

    // Mock getBoundingClientRect for the menu: 250px wide by 400px high
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 250,
      height: 400,
      top: 0,
      left: 0,
      right: 250,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    try {
      // User clicks at y = 800 (only 100px space below, but 800px space above)
      render(
        <ContextMenu
          items={[{ label: "Cut", onClick: vi.fn() }, { label: "Copy", onClick: vi.fn() }]}
          position={{ x: 500, y: 800 }}
          onClose={vi.fn()}
        />,
      );

      const menu = screen.getByRole("menu");
      expect(menu).toHaveStyle({ visibility: "visible" });
      // Top should be y(800) - height(400) = 400px (flipped upward, sitting directly on top of the clip)
      expect(menu.style.top).toBe("400px");
      expect(menu.style.left).toBe("500px");
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it("flips leftward when right-clicked near right edge of viewport", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1920);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);

    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 250,
      height: 200,
      top: 0,
      left: 0,
      right: 250,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    try {
      // User clicks at x = 1850 (only 70px space to the right)
      render(
        <ContextMenu
          items={[{ label: "Cut", onClick: vi.fn() }]}
          position={{ x: 1850, y: 100 }}
          onClose={vi.fn()}
        />,
      );

      const menu = screen.getByRole("menu");
      // Left should be x(1850) - width(250) = 1600px (flipped leftward)
      expect(menu.style.left).toBe("1600px");
      expect(menu.style.top).toBe("100px");
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it("applies maxHeight and scrolling when viewport height is smaller than menu", () => {
    // Very constrained window height: 300px
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(300);

    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 250,
      height: 500, // Menu wants 500px height
      top: 0,
      left: 0,
      right: 250,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    try {
      render(
        <ContextMenu
          items={[{ label: "Cut", onClick: vi.fn() }]}
          position={{ x: 300, y: 200 }}
          onClose={vi.fn()}
        />,
      );

      const menu = screen.getByRole("menu");
      expect(menu.style.maxHeight).toBeDefined();
      expect(parseInt(menu.style.maxHeight)).toBeLessThanOrEqual(300);
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });
});
