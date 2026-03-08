/* globals
Hooks,
PIXI,
*/
"use strict";


Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "libGeometry.PIXIPolygonExtensions",

  (context) => {
      const { describe, it, expect, before } = context;

describe("PIXI.Polygon Extensions", () => {
  let square;
  let triangle;

  before(() => {
    // Standard 100x100 square
    square = new PIXI.Polygon([0, 0, 100, 0, 100, 100, 0, 100]);
    // Standard right triangle
    triangle = new PIXI.Polygon([0, 0, 100, 0, 0, 100]);
  });


  // --- Basic Measurements ---
  describe("area and signedArea", () => {
    it("should calculate the correct area for a square", () => {
      expect(square.area).to.equal(10000);
    });

    it("should return a positive area regardless of winding order", () => {
      const counterClockwise = new PIXI.Polygon([0, 0, 0, 100, 100, 100, 100, 0]);
      expect(counterClockwise.area).to.equal(10000);
    });

    it("should respect scalingFactor in signedArea", () => {
      const area = square.signedArea({ scalingFactor: 10 });
      // Scaling coordinates by 10 increases area by 100
      expect(area).to.equal(10000);
    });
  });

  describe("centroid", () => {
    it("should calculate the center of a square correctly", () => {
      const c = square.center;
      expect(c.x).to.equal(50);
      expect(c.y).to.equal(50);
    });

    it("should return undefined for an empty polygon", () => {
      const empty = new PIXI.Polygon([]);
      expect(empty.center).to.be.undefined;
    });
  });

  // --- Spatial Relationships ---
  describe("overlaps()", () => {
    it("should detect overlap with another Polygon", () => {
      const other = new PIXI.Polygon([50, 50, 150, 50, 150, 150, 50, 150]);
      expect(square.overlaps(other)).to.be.true;
    });

    it("should detect overlap with a PIXI.Circle", () => {
      const circle = new PIXI.Circle(100, 100, 20); // Center on corner
      expect(square._overlapsCircle(circle)).to.be.true;
    });

    it("should return false when shapes are distant", () => {
      const farSquare = new PIXI.Polygon([500, 500, 600, 500, 600, 600, 500, 600]);
      expect(square.overlaps(farSquare)).to.be.false;
    });
  });

  describe("envelops()", () => {
    it("should return true if a shape is entirely inside", () => {
      const smallSquare = new PIXI.Polygon([10, 10, 20, 10, 20, 20, 10, 20]);
      expect(square.envelops(smallSquare)).to.be.true;
    });

    it("should return false if a shape is partially outside", () => {
      const pokingOut = new PIXI.Polygon([90, 90, 110, 90, 110, 110, 90, 110]);
      expect(square.envelops(pokingOut)).to.be.false;
    });

    // We'll use a concave "L-shape" or notched square to test line-of-sight properties.
    // Vertices: (0,0), (100,0), (100,100), (50,50), (0,100)
    const poly = new PIXI.Polygon([0, 0, 100, 0, 100, 100, 50, 50, 0, 100]);

    it('should return TRUE for points clearly inside the polygon', () => {
      const pointInside = new PIXI.Point(50, 25);
      expect(poly.envelops(pointInside)).to.be.true;
    });

    it('should return FALSE for points clearly outside the polygon', () => {
      const pointOutside = new PIXI.Point(150, 50);
      expect(poly.envelops(pointOutside)).to.be.false;
    });

    it('should return FALSE for points located on a horizontal edge', () => {
      const pointOnEdge = new PIXI.Point(50, 0); // Top edge
      expect(poly.envelops(pointOnEdge)).to.be.false;
    });

    it('should return FALSE for points located on a vertical edge', () => {
      const pointOnEdge = new PIXI.Point(100, 50); // Right edge
      expect(poly.envelops(pointOnEdge)).to.be.false;
    });

    it('should return FALSE for points located on a diagonal/concave edge', () => {
      const pointOnDiagonal = new PIXI.Point(75, 75); // On the line between (100,100) and (50,50)
      expect(poly.envelops(pointOnDiagonal)).to.be.false;
    });

    it('should return FALSE for points exactly on a vertex (corner)', () => {
      const vertex = new PIXI.Point(50, 50); // The inner concave point
      expect(poly.envelops(vertex)).to.be.false;
    });

    it('should return TRUE for points extremely close to the edge but inside', () => {
      const nearInside = new PIXI.Point(50, 0.00001);
      expect(poly.envelops(nearInside)).to.be.true;
    });

    it('should handle "empty" space in concave notches correctly', () => {
      // Point (50, 75) is inside the bounding box, but outside the notched area
      const inNotch = new PIXI.Point(50, 75);
      expect(poly.envelops(inNotch)).to.be.false;
    });
  });

  // --- Line Intersections ---
  describe("lineSegmentIntersects()", () => {
    it("should detect a line passing through the polygon", () => {
      const a = { x: -10, y: 50 };
      const b = { x: 110, y: 50 };
      expect(square.lineSegmentIntersects(a, b)).to.be.true;
    });

    it("should handle 'inside' option correctly", () => {
      const a = { x: 40, y: 40 };
      const b = { x: 60, y: 60 };
      // Line is entirely inside; should be false by default, true if inside: true
      expect(square.lineSegmentIntersects(a, b)).to.be.false;
      expect(square.lineSegmentIntersects(a, b, { inside: true })).to.be.true;
    });
  });

  // --- Transformations ---
  describe("translate() and scale()", () => {
    it("should shift points correctly during translation", () => {
      const moved = square.translate(10, -10);
      expect(moved.points[0]).to.equal(10);
      expect(moved.points[1]).to.equal(-10);
    });

    it("should resize points correctly during scaling", () => {
      const scaled = square.scale(2, 2);
      // Original 100, 100 becomes 200, 200
      expect(scaled.points[4]).to.equal(200);
      expect(scaled.points[5]).to.equal(200);
    });
  });

  // --- Visibility ---
  describe("viewablePoints()", () => {
    it("should return only external points from a specific origin", () => {
      const origin = { x: -50, y: 50 };
      const viewable = square.viewablePoints(origin);
      // From the left, we should see at least two points (0,0 and 0,100)
      expect(viewable.length).to.be.at.least(2);
    });

    it("should return all points if origin is inside", () => {
      const origin = { x: 50, y: 50 };
      const viewable = square.viewablePoints(origin);
      expect(viewable.length).to.equal(4);
    });
  });

  // --- Cleanup/Utility ---
  describe("clean()", () => {
    it("should remove redundant collinear points", () => {
      // Square with an extra point in the middle of the top edge
      const messySquare = new PIXI.Polygon([0, 0, 50, 0, 100, 0, 100, 100, 0, 100]);
      messySquare.clean();
      // Points array length: (4 vertices * 2) = 8
      expect(messySquare.points.length).to.equal(8);
    });
  });

  describe("PIXI.Polygon.translate Mutation Safety", () => {

    it("should not mutate the source polygon when a different 'out' polygon is provided", () => {
      const source = new PIXI.Polygon([0, 0, 10, 0, 10, 10, 0, 10]);
      const target = new PIXI.Polygon([]);
      const originalPoints = [...source.points]; // Snapshot of original points

      source.translate(50, 50, target);

      // Verify source is unchanged
      expect(source.points).to.deep.equal(originalPoints, "Source points were mutated!");

      // Verify target is moved
      expect(target.points[0]).to.equal(50);
      expect(target.points[1]).to.equal(50);
    });

    it("should mutate the source polygon when 'out' is the same as 'this' (in-place)", () => {
      const source = new PIXI.Polygon([0, 0, 10, 0, 10, 10, 0, 10]);

      source.translate(10, 10, source);

      // Verify source is moved
      expect(source.points[0]).to.equal(10);
      expect(source.points[1]).to.equal(10);
    });

    it("should return a new polygon instance when 'out' is omitted", () => {
      const source = new PIXI.Polygon([0, 0, 10, 0, 10, 10, 0, 10]);
      const originalPoints = [...source.points];

      const result = source.translate(20, 20);

      // Verify source is unchanged
      expect(source.points).to.deep.equal(originalPoints);

      // Verify result is a different object and moved
      expect(result).to.not.equal(source);
      expect(result.points[0]).to.equal(20);
    });

    it("should correctly handle bounds when translating", () => {
      const source = new PIXI.Polygon([0, 0, 10, 0, 10, 10, 0, 10]);
      // Force bounds calculation
      source.getBounds();

      const result = source.translate(100, 100);
      const bounds = result.getBounds();

      expect(bounds.x).to.equal(100);
      expect(bounds.y).to.equal(100);
    });
  });
});
}, { displayName: "PIXI Polygon Extension Tests" });

});
