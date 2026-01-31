/* globals
Hooks,
PIXI
*/
"use strict";

import { LocalCoordinateCache } from "../PixelCache.js";

Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "libGeometry.LocalCoordinateCache",

  (context) => {
      const { describe, it, expect, assert, beforeEach } = context;

// --- NOTE: Coordinate Conversions ---
describe("Coordinate Transformation", () => {
  let cache;
  beforeEach(() => {
    // Simple 1:1 cache at canvas 100, 100
    cache = new LocalCoordinateCache(100, 100, 500, 500, { resolution: 1 });
    cache.clearTransforms();
  });

  it("should convert canvas coordinates to local coordinates", () => {
    const canvasPoint = { x: 150, y: 150 };
    const local = cache._fromCanvasCoordinates(canvasPoint.x, canvasPoint.y);

    // If canvas is at 100,100, then canvas 150,150 should be local 50,50
    // (Accounting for the internal translation logic in the class)
    expect(local.x).to.be.closeTo(50, 0.1);
    expect(local.y).to.be.closeTo(50, 0.1);
  });

  it("should round-trip coordinates accurately", () => {
    const canvasX = 250;
    const canvasY = 300;
    const local = cache._fromCanvasCoordinates(canvasX, canvasY);
    const backToCanvas = cache._toCanvasCoordinates(local.x, local.y);

    expect(backToCanvas.x).to.be.closeTo(canvasX, 0.1);
    expect(backToCanvas.y).to.be.closeTo(canvasY, 0.1);
  });
});

// --- NOTE: Indexing ---
describe("Indexing Logic", () => {
  it("should calculate correct index for local coordinates", () => {
    const cache = new LocalCoordinateCache(0, 0, 10, 10);
    // Index = (y * width) + x => (2 * 10) + 5 = 25
    const index = cache._indexAtLocal(5, 2);
    expect(index).to.equal(25);
  });

  it("should return -1 for out-of-bounds local coordinates", () => {
    const cache = new LocalCoordinateCache(0, 0, 10, 10);
    expect(cache._indexAtLocal(11, 5)).to.equal(-1);
    expect(cache._indexAtLocal(5, -1)).to.equal(-1);
  });

  it("should map local index back to a coordinate point", () => {
    const cache = new LocalCoordinateCache(0, 0, 10, 10);
    const pt = new PIXI.Point();
    cache._localAtIndex(25, pt);
    expect(pt.x).to.equal(5);
    expect(pt.y).to.equal(2);
  });
});

// --- NOTE: Neighbor Finding ---
describe("Neighbor Indexing", () => {
  it("should find the correct number of neighbors for a central pixel", () => {
    const cache = new LocalCoordinateCache(0, 0, 10, 10);
    const centerIdx = cache._indexAtLocal(5, 5);
    const neighbors = cache.localNeighborIndices(centerIdx, true);
    // A center pixel should have 8 neighbors
    expect(neighbors.length).to.equal(8);
  });

  it("should trim border neighbors if requested", () => {
    const cache = new LocalCoordinateCache(0, 0, 10, 10);
    const topLeftIdx = cache._indexAtLocal(0, 0);
    const neighbors = cache.localNeighborIndices(topLeftIdx, true);
    // (0,0) only has 3 valid neighbors inside a 10x10 grid
    expect(neighbors.length).to.equal(3);
  });
});

// --- Static Geometry Algorithms ---
describe("Static Geometry (Pixels Under Shape)", () => {
  it("pixelsUnderRectangle should return correct pixel count", () => {
    const rect = new PIXI.Rectangle(0, 0, 2, 2);
    const pixels = LocalCoordinateCache.pixelsUnderRectangle(rect);
    // Expected: (0,0), (1,0), (0,1), (1,1)
    expect(pixels.length).to.equal(4);
  });

  it("pixelsUnderCircle should only include pixels within radius", () => {
    const circle = new PIXI.Circle(1, 1, 1);
    const pixels = LocalCoordinateCache.pixelsUnderCircle(circle);

    // Center is 1,1 radius 1. Should catch the core pixels.
    // Check that a far away point is NOT included
    const hasFarPoint = pixels.some(p => p.x === 5 && p.y === 5);
    expect(hasFarPoint).to.be.false;
    expect(pixels.length).to.be.greaterThan(0);
  });

  it("pixelsUnderSegment should handle horizontal lines", () => {
    const p1 = new PIXI.Point(0.5, 0.5);
    const p2 = new PIXI.Point(2.5, 0.5);
    const pixels = LocalCoordinateCache.pixelsUnderSegment(p1, p2);
    // Should touch pixels (0,0), (1,0), (2,0)
    expect(pixels.length).to.equal(3);
    expect(pixels[0].x).to.equal(0);
    expect(pixels[2].x).to.equal(2);
  });
});

  },

  {
    displayName: "libGeometry:: LocalCoordinateCache",
  }

  );

});
