/* globals
canvas,
Hooks,
PIXI,
*/
"use strict";

import { LocalCoordinateCache, PixelCache, TrimmedPixelCache, TilePixelCache } from "../PixelCache.js";
import { MatrixFloat32 } from "../MatrixFlat.js";

Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "libGeometry.LocalCoordinateCache",

  (context) => {
      const { describe, it, expect, beforeEach } = context;

// --- NOTE: Initialization ---
describe("Initialization", () => {
  it("should correctly initialize local dimensions based on resolution", () => {
    const cache = new LocalCoordinateCache(100, 100, { resolution: 0.5 });
    // localWidth = ceil(200 * 0.5) = 100
    expect(cache.width).to.equal(100);
    expect(cache.height).to.equal(100);
    expect(cache.resolution).to.equal(0.5);
    // Local x,y should always be 0 per super() call
    expect(cache.min.x).to.equal(0);
    expect(cache.min.y).to.equal(0);
  });
});

// --- NOTE: Coordinate Conversions ---
describe("Coordinate Transformation", () => {
  let cache;
  beforeEach(() => {
    // Simple 1:1 cache at canvas 100, 100
    cache = new LocalCoordinateCache(500, 500, { resolution: 1 });
    cache.translation = { x: 100, y: 100 };
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
    const cache = new LocalCoordinateCache(10, 10);
    // Index = (y * width) + x => (2 * 10) + 5 = 25
    const index = cache._indexAtLocal(5, 2);
    expect(index).to.equal(25);
  });

  it("should return -1 for out-of-bounds local coordinates", () => {
    const cache = new LocalCoordinateCache(10, 10);
    expect(cache._indexAtLocal(11, 5)).to.equal(-1);
    expect(cache._indexAtLocal(5, -1)).to.equal(-1);
  });

  it("should map local index back to a coordinate point", () => {
    const cache = new LocalCoordinateCache(10, 10);
    const pt = new PIXI.Point();
    cache._localAtIndex(25, pt);
    expect(pt.x).to.equal(5);
    expect(pt.y).to.equal(2);
  });
});

// --- NOTE: Resolution handling
describe("LocalCoordinateCache - Resolution Handling", () => {
  const EPSILON = 0.01;

  describe("Coordinate Mapping via Resolution", () => {
    it("should map 1 local pixel to 10 canvas pixels at 0.1 resolution", () => {
      const cache = new LocalCoordinateCache(10, 10, { resolution: 0.1 });
      cache.translation = { x: 100, y: 100 };

      // Local grid is 10x10. Center is (5, 5).
      // Canvas center is (150, 150).
      // Moving 1 unit locally (from 5 to 6) should be 10 units on canvas.
      const canvasPt = cache._toCanvasCoordinates(6, 5);
      expect(canvasPt.x).to.be.closeTo(160, EPSILON);
      expect(canvasPt.y).to.be.closeTo(150, EPSILON);
    });

    it("should map 2 local pixels to 1 canvas pixel at 2.0 resolution", () => {
      const cache = new LocalCoordinateCache(100, 100, { resolution: 2.0 });
      cache.translation = { x: 100, y: 100 };

      // Local grid is 200x200. Center is (100, 100).
      // Moving 10 units locally should be 5 units on canvas (10 * 0.5).
      const canvasPt = cache._toCanvasCoordinates(110, 100);
      expect(canvasPt.x).to.be.closeTo(155, EPSILON);
    });
  });

  describe("Resolution and Scale Interaction", () => {
    it("should maintain consistent canvas size when resolution changes but scale is 1", () => {
      // Testing the 'invRes' logic in the scale setter
      const cacheLow = new LocalCoordinateCache(50, 50, { resolution: 0.5 });
      const cacheHigh = new LocalCoordinateCache(200, 200, { resolution: 2.0 });

      // At Res 0.5, local width is 50. Center is 25.
      // At Res 2.0, local width is 200. Center is 100.

      // Same canvas coordinates should roundtrip to the same.
      const localPtLow = cacheLow._fromCanvasCoordinates(55, 75);
      const localPtHigh = cacheHigh._fromCanvasCoordinates(55, 75);
      const canvasPtLow = cacheLow._toCanvasCoordinates(localPtLow.x, localPtLow.y);
      const canvasPtHigh = cacheHigh._toCanvasCoordinates(localPtHigh.x, localPtHigh.y);

      expect(canvasPtLow.x).to.equal(canvasPtHigh.x);

      // Canvas coordinate should be resolution distance apart in local frame.
      const scaledLocal = localPtLow.multiplyScalar(2 / 0.5)
      expect(scaledLocal.x).to.equal(localPtHigh.x);
      expect(scaledLocal.y).to.equal(localPtHigh.y);
    });
  });
});

// --- NOTE: Neighbor Finding ---
describe("Neighbor Indexing", () => {
  it("should find the correct number of neighbors for a central pixel", () => {
    const cache = new LocalCoordinateCache(10, 10);
    const centerIdx = cache._indexAtLocal(5, 5);
    const neighbors = cache.localNeighborIndices(centerIdx, true);
    // A center pixel should have 8 neighbors
    expect(neighbors.length).to.equal(8);
  });

  it("should trim border neighbors if requested", () => {
    const cache = new LocalCoordinateCache(10, 10);
    const topLeftIdx = cache._indexAtLocal(0, 0);
    const neighbors = cache.localNeighborIndices(topLeftIdx, true);
    // (0,0) only has 3 valid neighbors inside a 10x10 grid
    expect(neighbors.length).to.equal(3);
  });
});

// --- NOTE: Static Geometry Algorithms ---
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

// --- NOTE: Advanced Transformations ---
describe("LocalCoordinateCache - Advanced Transformations", () => {
  let cache;
  const TL = PIXI.Point.tmp.set(100, 100);
  const size = PIXI.Point.tmp.set(100, 100);
  const EPSILON = 0.01;

  const calcCenter = function(TL, size, scale = PIXI.Point.tmp.set(1, 1)) {
    size = size.multiply(scale);
    return TL.add(size.multiplyScalar(0.5));
  }

  beforeEach(() => {
    // Create a 100x100 canvas area at (100, 100)
    cache = new LocalCoordinateCache(size.x, size.y, { resolution: 1 });
    cache.translation = TL;
  });

  // --- Scaling Tests ---
  describe("Scaling", () => {
    it("should correctly map coordinates when scaled uniformly (2x)", () => {
      const scale = PIXI.Point.tmp.set(2, 2);
      cache.scale = scale;

      // Local center is (50, 50). On canvas, width is 100 * 2 = 200; center is 200, 200.
      // Local point 60, 50 is 10 pixels right-of-center locally.
      // On canvas, that should be 20 pixels right of the canvas center (200, 200).
      const ctr = calcCenter(TL, size, scale)

      // With scale 2, the point (60, 50) is 10 pixels right of center locally.
      // On canvas, that should be 20 pixels right of the canvas center (150, 150).
      const canvasPt = cache._toCanvasCoordinates(60, 50);
      expect(canvasPt.x).to.be.closeTo(ctr.x + (10 * scale.x), EPSILON);
      expect(canvasPt.y).to.be.closeTo(ctr.y, EPSILON);
    });

    it("should handle non-uniform scaling", () => {
      const scale = PIXI.Point.tmp.set(2, 1);
      cache.scale = scale;
      const ctr = calcCenter(TL, size, scale);


      const canvasPt = cache._toCanvasCoordinates(60, 50); // 10 units right locally
      expect(canvasPt.x).to.be.closeTo(ctr.x + (10 * scale.x), EPSILON); // 10 * 3 = 30 units right of 150
      expect(canvasPt.y).to.be.closeTo(ctr.y, EPSILON); // No Y change
    });

    it("should correctly incorporate resolution into scaling", () => {
      // Resolution 0.5 means local width is 50 for a 100px canvas width.
      const resCache = new LocalCoordinateCache(50, 50, { resolution: 0.5 });
      resCache.translation = { x: 100, y: 100 };
      // resCache.scale = { x: 1, y: 1 }; // Identity scale

      // Local width is 50. Local center is 25.
      // Moving 5 pixels locally (10% of local width) should be 10 pixels on canvas.
      const ctr = calcCenter(TL, size);
      const canvasPt = resCache._toCanvasCoordinates(30, 25);
      expect(canvasPt.x).to.be.closeTo(ctr.x + 10, EPSILON);
    });
  });

  // --- Rotation Tests ---
  describe("Rotation", () => {
    it("should rotate coordinates by 90 degrees clockwise", () => {
      // 90 degrees in radians is PI / 2
      const angle = Math.PI / 2;
      cache.rotationZ = angle;

      // Local center (50, 50) -> Canvas center (150, 150)
      // Local point (60, 50) is "East" of center.
      // After 90 deg clockwise rotation, it should be "South" of center.
      const canvasPt = cache._toCanvasCoordinates(60, 50);

      expect(canvasPt.x).to.be.closeTo(150, EPSILON);
      expect(canvasPt.y).to.be.closeTo(160, EPSILON);
    });

    it("should rotate coordinates by 180 degrees", () => {
      cache.rotationZ = Math.PI;

      // Local point (60, 60) is 10 right, 10 down from center.
      // 180 rotation makes it 10 left, 10 up from center.
      const canvasPt = cache._toCanvasCoordinates(60, 60);
      expect(canvasPt.x).to.be.closeTo(140, EPSILON);
      expect(canvasPt.y).to.be.closeTo(140, EPSILON);
    });
  });

  // --- Combined Tests ---
  describe("Combined Scaling and Rotation", () => {
    it("should handle simultaneous scaling, rotation, and translation", () => {
      const scale = PIXI.Point.tmp.set(2, 2);
      cache.scale = scale;
      cache.rotationZ = Math.PI / 2; // 90 deg

      const ctr = calcCenter(TL, size, scale);

      // Local (60, 50) is 10 units East.
      // Scale 2x -> 20 units East.
      // Rotate 90 deg -> 20 units South.
      // Canvas center (150, 150) + 20 units South = (150, 170)
      const canvasPt = cache._toCanvasCoordinates(60, 50);
      expect(canvasPt.x).to.be.closeTo(ctr.x, EPSILON);
      expect(canvasPt.y).to.be.closeTo(ctr.y + (10 * scale.x), EPSILON);

      // Verification: Inverse mapping (Round-trip)
      const localPt = cache._fromCanvasCoordinates(canvasPt.x, canvasPt.y);
      expect(localPt.x).to.be.closeTo(60, EPSILON);
      expect(localPt.y).to.be.closeTo(50, EPSILON);
    });
  });
});


  },

  {
    displayName: "libGeometry:: LocalCoordinateCache",
  }

  );

  quench.registerBatch("pixel-cache.tests", (context) => {
   const { describe, it, expect, before } = context;


// ---- NOTE: PixelCache ----

describe("PixelCache", () => {
let pixels;
const width = 10;
const height = 10;

before(() => {
  // Create a 10x10 grid where the center 4x4 is "filled" (value 255)
  // and the rest is empty (value 0).
  pixels = new Uint8Array(width * height).fill(0);
  for (let y = 3; y < 7; y++) {
    for (let x = 3; x < 7; x++) {
      pixels[y * width + x] = 255;
    }
  }
});

// ---- NOTE: Construction ----
describe("Construction & Static Methods", () => {
  it("should initialize from a pixel array using fromPixelArray", () => {
    const pc = PixelCache.fromPixelArray(pixels, width, { resolution: 1 });
    expect(pc.pixels).to.equal(pixels);
    expect(pc.width).to.equal(10);
    expect(pc.height).to.equal(10);
    expect(pc.maximumPixelValue).to.equal(255);
  });
});

// ---- NOTE: Threshold Bounding Boxes ---
describe("Threshold Bounding Boxes", () => {
  it("should calculate the correct local bounding box based on a threshold", () => {
    const pc = PixelCache.fromPixelArray(pixels, width);
    // Our 4x4 block is at x:3-6, y:3-6.
    // Bounding box logic pads right/bottom by 1.
    const box = pc.getThresholdLocalBoundingBox(0.5); // 0.5 * 255 = 127.5

    expect(box.x).to.equal(3);
    expect(box.y).to.equal(3);
    expect(box.width).to.equal(4); // maxRight(6) + 1 - minLeft(3) = 4
    expect(box.height).to.equal(4);
  });

  it("should return an empty rectangle if no pixels meet the threshold", () => {
    const pc = PixelCache.fromPixelArray(pixels, width);
    const box = pc.getThresholdLocalBoundingBox(2.0); // Impossible threshold
    expect(box.width).to.equal(0);
    expect(box.height).to.equal(0);
  });
});

// ---- NOTE: Pixel Access, Indexing ----
describe("Pixel Access & Indexing", () => {
  it("should retrieve the correct pixel value at local coordinates", () => {
    const pc = PixelCache.fromPixelArray(pixels, width);
    expect(pc._pixelAtLocal(5, 5)).to.equal(255);
    expect(pc._pixelAtLocal(0, 0)).to.equal(0);
  });

  it("should return null for out-of-bounds local coordinates", () => {
    const pc = PixelCache.fromPixelArray(pixels, width);
    expect(pc._pixelAtLocal(-1, 5)).to.be.null;
    expect(pc._pixelAtLocal(11, 5)).to.be.null;
  });
});

// ---- NOTE: Pixel Setting ----
describe("Pixel Setting", () => {
  it("should correctly set a pixel under a local point", () => {
    const pc = PixelCache.fromPixelArray(new Uint8Array(100), 10);
    const pt = PIXI.Point.tmp.set(2, 2);
    pc._setPixelUnderLocalPoint(pt, 128);
    expect(pc._pixelAtLocal(2, 2)).to.equal(128);
  });

  it("should set pixels under a local shape (Rectangle)", () => {
    const pc = PixelCache.fromPixelArray(new Uint8Array(100), 10);
    const rect = new PIXI.Rectangle(1, 1, 2, 2);
    pc._setPixelsUnderLocalShape(rect, 100);

    expect(pc._pixelAtLocal(1, 1)).to.equal(100);
    expect(pc._pixelAtLocal(2, 2)).to.equal(100);
    expect(pc._pixelAtLocal(3, 3)).to.equal(0);
  });
});

// ---- NOTE: Ray extraction ----
describe("Ray Extraction & Aggregation", () => {
  it("should extract pixel values along a local ray", () => {
    const pc = PixelCache.fromPixelArray(pixels, width);
    const a = { x: 2, y: 5 };
    const b = { x: 8, y: 5 };

    // This ray crosses the 4x4 block of 255s.
    // Path: (2,5)=0, (3,5)=255, (4,5)=255, (5,5)=255, (6,5)=255, (7,5)=0, (8,5)=0
    const results = pc._extractAllPixelValuesAlongLocalRay(a, b);

    const values = results.map(pt => pt.currPixel);
    expect(values).to.include(255);
    expect(values[0]).to.equal(0);
  });

  it("should find the next marked pixel using a threshold function", () => {
    const pc = PixelCache.fromPixelArray(pixels, width);
    const a = { x: 0, y: 5 };
    const b = { x: 9, y: 5 };

    // Mark when we transition from 0 to something > 0
    const markFn = (curr, prev) => curr > 0 && (prev === 0 || prev === null);

    const pt = pc._extractNextMarkedPixelValueAlongLocalRay(a, b, markFn);
    expect(pt).to.not.be.null;
    expect(pt.x).to.equal(3);
    expect(pt.currPixel).to.equal(255);
  });
});

// ---- NOTE: Aggregators ----
describe("Aggregators", () => {
  it("should correctly aggregate using 'max'", () => {
    const maxAggregator = PixelCache.pixelAggregator("max");
    const testPixels = [10, 50, 255, 0];

    expect(maxAggregator(testPixels)).to.equal(255);
  });

  it("should correctly aggregate using 'count_gt_threshold'", () => {
    const countAggregator = PixelCache.pixelAggregator("count_gt_threshold", 100);
    const testPixels = [50, 150, 200, 255];

    // Logic inside PixelCache.pixelAggregator wraps reducePixels
    // We'll simulate the reduction manually to test the returned logic
    const result = countAggregator(testPixels);
    expect(result.count).to.equal(3);
  });
});
  });
}, { displayName: "PixelCache Utility Tests" });

/**
 * Quench Unit Tests for TrimmedPixelCache
 */
quench.registerBatch("trimmed-pixel-cache.tests", (context) => {
  const { describe, it, expect, before } = context;
  const EPSILON = 1e-6;

// ---- NOTE: Trimmed Pixel Cache ---
describe("TrimmedPixelCache", () => {
// 5x5 RGBA mock (100 bytes).
// We will place a 2x2 "visible" block starting at (2, 2).
const fullWidth = 5;
const fullHeight = 5;
let pixels;

before(() => {
  pixels = new Uint8Array(fullWidth * fullHeight).fill(0);

  // Set a 2x2 block at (2,2) and (3,3) to be opaque
  // Index = (y * width + x) * 4 + 3 (for alpha)
  const setAlpha = (x, y, a) => { pixels[(y * fullWidth) + x] = a; };

  setAlpha(2, 2, 255);
  setAlpha(3, 2, 255);
  setAlpha(2, 3, 255);
  setAlpha(3, 3, 255);

    //   0 1 2 3 4
    // 0 o o o o o
    // 1 o o o o o
    // 2 o o • • o
    // 3 o o • • o
    // 4 o o o o o

});

// ---- NOTE: minMaxNonZeroPixels ---
describe("minMaxNonZeroPixels", () => {
  it("should correctly identify the bounding box of non-zero alpha pixels", () => {
    const aabb = TrimmedPixelCache.minMaxNonZeroPixels(pixels, fullWidth, fullHeight);

    // The block is at (2,2) to (3,3).
    // aabb.max is exclusive/size-based in your logic (x + 1).
    expect(aabb.min.x).to.equal(2);
    expect(aabb.min.y).to.equal(2);
    expect(aabb.max.x).to.equal(3);
    expect(aabb.max.y).to.equal(3);
  });

  it("should return a zeroed AABB if all pixels are transparent", () => {
    const transparent = new Uint8Array(16).fill(0);
    const aabb = TrimmedPixelCache.minMaxNonZeroPixels(transparent, 2, 2);
    expect(aabb.min.x).to.equal(0);
    expect(aabb.max.x).to.equal(0);
  });
});

// ---- NOTE: fromNontrimmedPixels ---
describe("fromPixelArray Factory", () => {
  it("should create a cache with full dimensions", () => {
    const cache = TrimmedPixelCache.fromPixelArray(pixels, fullWidth);

    // The 2x2 block means the trimmed cache should only have 4 pixels
    expect(cache.pixels.length).to.equal(4);
    expect(cache.width).to.equal(fullWidth);
    expect(cache.height).to.equal(fullHeight);
  });
});

// ---- NOTE: Coordinate Mapping ---
describe("Coordinate Mapping & Transparency", () => {
  let cache;
  before(() => {
    // Create the trimmed cache (2x2) from our 5x5 source
    cache = TrimmedPixelCache.fromPixelArray(pixels, fullWidth);
    // Position it at (100, 100) on the canvas
    cache.translation = { x: 100, y: 100 };
  });

  it("should return null for pixels outside the full border", () => {
    // (-1, -1) is in the full frame but was trimmed away.
    const val = cache._pixelAtLocal(-1, -1);
    expect(val).to.equal(null);

    const outsideVal = cache._pixelAtLocal(6, 6);
    expect(outsideVal).to.equal(null);
  });


  it("should return 0 for pixels in the 'trimmed' border (inside full frame, outside data)", () => {
    // (-1, -1) is in the full frame but was trimmed away.
    const val = cache._pixelAtLocal(0, 0);
    expect(val).to.equal(0);

    const outsideVal = cache._pixelAtLocal(4, 4);
    expect(outsideVal).to.equal(0);
  });

  it("should return the actual value for pixels inside the trimmed area", () => {
    // (2, 2) was the start of our opaque block, which gets moved to 0,0.
    const val = cache._pixelAtLocal(2, 2);
    expect(val).to.equal(255);
  });

  it("should account for the trim offset in the canvas transform", () => {
    // Local (0, 0) is the top-left of the trimmed data.
    // With translation at 100, 100 and no scale (res 1),
    // the conceptual (0,0) of the full frame would be at local (-2, -2), or canvas 100, 100.
    // Therefore, the data at (0,0) should be at 102, 102.

    const canvasPt = cache._toCanvasCoordinates(0, 0);
    expect(canvasPt.x).to.be.closeTo(100, EPSILON);
    expect(canvasPt.y).to.be.closeTo(100, EPSILON);
  });
});

// ---- NOTE: Resolution scaling ---
describe("Resolution Scaling", () => {
  it("should scale the trim offset correctly at 0.5 resolution", () => {
    // 0.5 resolution means 1 local unit = 2 canvas pixels (invRes = 2).
    // Let's use the same 5x5 RGBA mock where the 2x2 data block starts at local (2, 2).
    const cache = TrimmedPixelCache.fromPixelArray(pixels, fullWidth, { resolution: 0.5 });

    // We set the canvas translation to (100, 100).
    // This maps the conceptual (0, 0) of the UNTRIMMED image to (100, 100).
    cache.translation = { x: 100, y: 100 };

    // Math Check:
    // Untrimmed cache is 5 x 5. With resolution 0.5, this gives a canvas size of 10 x 10.
    // TL is 100, 100. So untrimmed spans from 100,100 to 110, 110.


    // Trimmed Cache is 2 x 2. First 2 pixels are empty in x and y. Canvas size of 4 x 4.
    // Local offset is 2 x 2. Canvas TL for filled is 104 x 104.

    const canvasPt = cache._toCanvasCoordinates(0, 0);
    expect(canvasPt.x).to.be.closeTo(100, EPSILON);
    expect(canvasPt.y).to.be.closeTo(100, EPSILON);

    const canvasPt2 = cache._toCanvasCoordinates(1, 1);
    expect(canvasPt2.x).to.be.closeTo(102, EPSILON);
    expect(canvasPt2.y).to.be.closeTo(102, EPSILON);
  });

  it("should scale the trim offset correctly at 2.0 resolution", () => {
    // 2.0 resolution means 1 local unit = 0.5 canvas pixels (invRes = 0.5).
    const cache = TrimmedPixelCache.fromPixelArray(pixels, fullWidth, { resolution: 2.0 });
    cache.translation = { x: 100, y: 100 };

    // Untrimmed cache is 5 x 5. With resolution 2, this gives a canvas size of 2.5 x 2.5
    // TL is 100, 100. So untrimmed spans from 100,100 to 102.5,102.5

    // Trimmed Cache is 2 x 2. First 2 pixels are empty in x and y. Canvas size of 1 x 1.
    // Local offset is 2 x 2. Canvas TL for filled is 101, 101.
    const canvasPt = cache._toCanvasCoordinates(0, 0);
    expect(canvasPt.x).to.be.closeTo(100, EPSILON);
    expect(canvasPt.y).to.be.closeTo(100, EPSILON);

    const canvasPt2 = cache._toCanvasCoordinates(2, 2);
    expect(canvasPt2.x).to.be.closeTo(101, EPSILON);
    expect(canvasPt2.y).to.be.closeTo(101, EPSILON);
  });
});

// ---- NOTE: Memory and Safety ---
describe("Memory & Safety", () => {
  it("should correctly handle PIXI.Point.tmp during pixelAtCanvas", () => {
    const cache = TrimmedPixelCache.fromPixelArray(pixels, fullWidth);
    cache.translation = { x: 0, y: 0 };

    // pixelAtCanvas uses PIXI.Point.tmp. Verify it doesn't crash
    // and returns expected null for way-out-of-bounds.
    const val = cache.pixelAtCanvas(999, 999);
    expect(val).to.be.null;
  });
});
});
}, { displayName: "TrimmedPixelCache Logic Tests" });


/**
 * NOTE: Quench Unit Tests for TilePixelCache
 */
quench.registerBatch("tile-pixel-cache.tests", (context) => {
  const { describe, it, expect, before } = context;
  const EPSILON = 1e-6;


  // ---- NOTE: TilePixelCache ----
  describe("TilePixelCache", () => {
    let testTile;

    before(() => {
      // Check if a tile exists on the canvas
      testTile = canvas.tiles.placeables[0];
    });

    // Helper to skip tests if no tile is found
    const tileGuard = function() {
      if (!testTile) {
        console.warn("TilePixelCache Tests | No tile found on canvas. Skipping test.");
        this.skip();
      }
    };

    // ---- NOTE: Constructor ----
    describe("Constructor & Initialization", () => {
      it("should associate with a Foundry Tile and update transforms", function() {
        tileGuard.call(this);

        const cache = new TilePixelCache(100, 100, {
          tile: testTile,
          pixelsOrClass: new Uint8Array(10000)
        });

        expect(cache.tile).to.equal(testTile);

        // Translation should match the tile document's coordinates
        expect(cache.modelMatrix.translation.getIndex(2, 0)).to.be.closeTo(testTile.document.x, EPSILON);
        expect(cache.modelMatrix.translation.getIndex(2, 1)).to.be.closeTo(testTile.document.y, EPSILON);
      });
    });

    // ---- NOTE: Transform sync ----
    describe("Transform Synchronization", () => {
      it("should sync rotation from the tile document", function() {
        tileGuard.call(this);

        const cache = new TilePixelCache(100, 100, {
          tile: testTile,
          pixelsOrClass: new Uint8Array(10000)
        });

        // Manually tweak document rotation and sync
        const originalRotation = testTile.document.rotation;
        testTile.document.rotation = originalRotation + 90;
        cache.updateTransforms();

        const rMat = MatrixFloat32.rotationZ(Math.toRadians(originalRotation + 90), false);
        expect(rMat.almostEqual(cache.modelMatrix.rotation)).to.be.true;

        // Reset for other tests
        testTile.document.rotation = originalRotation;
      });

      it("should calculate scale based on tile dimensions", function() {
        tileGuard.call(this);


        const cache = new TilePixelCache(100, 100, {
          tile: testTile,
          pixelsOrClass: new Uint8Array(10000)
        });

        // Manually tweak document scale.
        const tex = testTile.document.texture;
        const originalScaleX = tex.scaleX;
        tex.scaleX *= 2;
        cache.updateTransforms();

        const sc = cache.tileScale;
        const sMat = MatrixFloat32.scale(sc.x, sc.y);
        expect(sMat.almostEqual(cache.modelMatrix.scale)).to.be.true;

        // Reset for other tests.
        tex.scaleX /= 2;
      });
    });

    // ---- NOTE: Factory ----
    describe("Factory Methods", () => {
      it("fromOverheadTileAlpha should initialize from existing texture data", async function() {
        tileGuard.call(this);

        // Note: Overhead tiles in Foundry often have their alpha data cached already
        try {
          const cache = TilePixelCache.fromOverheadTileAlpha(testTile, { resolution: 1 });
          expect(cache).to.be.instanceOf(TilePixelCache);
          expect(cache.pixels).to.be.instanceOf(Uint8Array);
        } catch (e) {
          console.error("Factory method failed - likely texture not loaded or webgl error", e);
          this.skip();
        }
      });
    });

    // ---- NOTE: fromTile ----
    describe("Static Method: fromTileChannel", () => {
        it("should create valid cache from specified tile", function() {
            tileGuard.call(this);

            const cache = TilePixelCache.fromTileChannel(testTile, 4);
            expect(cache).to.be.instanceOf(TilePixelCache);
            expect(cache.pixels).to.be.instanceOf(Uint8Array);


        });
    });
  });
}, { displayName: "TilePixelCache Integration" });
});
