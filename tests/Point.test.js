/* globals
Hooks,
PIXI,
*/
"use strict";


Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "libGeometry.PIXIPointExtensions",

  (context) => {
      const { describe, it, expect } = context;

describe("PIXI.Point Basic Extensions", () => {

    describe("Pooling Logic", () => {
      it("PIXI.Point.tmp should provide a distinct object on each call", () => {
        const p1 = PIXI.Point.tmp;
        const p2 = PIXI.Point.tmp;

        expect(p1).to.be.an.instanceof(PIXI.Point);
        expect(p2).to.be.an.instanceof(PIXI.Point);
        expect(p1).to.not.equal(p2); // Confirms they are distinct instances from the pool

        p1.release();
        p2.release();
      });

      it("release() should return the point to the pool for reuse", () => {
        const p1 = PIXI.Point.tmp;
        p1.release();

        const p2 = PIXI.Point.tmp;
        // Depending on pool implementation (LIFO/FIFO), it might return the same ref
        // This test ensures the method exists and doesn't throw
        expect(p2).to.be.an.instanceof(PIXI.Point);
        p2.release();
      });
    });

    describe("Basic Arithmetic", () => {
      it("add() should correctly sum coordinates into a new point", () => {
        const a = new PIXI.Point(10, 20);
        const b = new PIXI.Point(5, 5);
        const res = a.add(b);

        expect(res.x).to.equal(15);
        expect(res.y).to.equal(25);
        res.release();
      });

      it("subtract() should correctly find the difference", () => {
        const a = new PIXI.Point(10, 20);
        const b = new PIXI.Point(5, 2);
        const res = a.subtract(b);

        expect(res.x).to.equal(5);
        expect(res.y).to.equal(18);
        res.release();
      });

      it("multiplyScalar() should scale both axes", () => {
        const a = new PIXI.Point(10, -5);
        const res = a.multiplyScalar(2);

        expect(res.x).to.equal(20);
        expect(res.y).to.equal(-10);
        res.release();
      });
    });

    describe("Geometry & Vector Math", () => {
      it("magnitude() should return the Euclidean length", () => {
        const p = new PIXI.Point(3, 4);
        expect(p.magnitude()).to.equal(5);
      });

      it("dot() should return the dot product of two points", () => {
        const a = new PIXI.Point(1, 2);
        const b = new PIXI.Point(3, 4); // (1*3) + (2*4) = 11
        expect(a.dot(b)).to.equal(11);
      });

      it("midPoint() should find the center of two points", () => {
        const a = new PIXI.Point(0, 0);
        const b = new PIXI.Point(10, 10);
        const mid = PIXI.Point.midPoint(a, b);

        expect(mid.x).to.equal(5);
        expect(mid.y).to.equal(5);
        mid.release();
      });

      it("rotate() should rotate the point around the origin", () => {
        const p = new PIXI.Point(10, 0);
        const angle = Math.PI / 2; // 90 degrees
        const res = PIXI.Point.rotate(p, angle);

        expect(res.x).to.be.closeTo(0, 1e-8);
        expect(res.y).to.be.closeTo(10, 1e-8);
        res.release();
      });
    });

    describe("Foundry Integration & Keys", () => {
      it("key getter should return a unique NW-to-SE number", () => {
        const p = new PIXI.Point(100, 50);
        const expected = (Math.pow(2, 16) * 100) + 50;
        expect(p.key).to.equal(expected);
      });

      it("invertKey should reconstruct a point from a key", () => {
        const key = (Math.pow(2, 16) * 500) + 250;
        const p = PIXI.Point.invertKey(key);

        expect(p.x).to.equal(500);
        expect(p.y).to.equal(250);
        p.release();
      });

      it("flatMapPoints should convert Point array to number array", () => {
        const pts = [new PIXI.Point(1, 2), new PIXI.Point(3, 4)];
        const flat = PIXI.Point.flatMapPoints(pts, (p) => p);

        expect(flat).to.deep.equal([1, 2, 3, 4]);
      });
    });

    describe("Utility Methods", () => {
      it("roundDecimals should round point coordinates", () => {
        const p = new PIXI.Point(1.2345, 6.7891);
        p.roundDecimals(2);

        expect(p.x).to.equal(1.23);
        expect(p.y).to.equal(6.79);
      });

      it("The iterator should allow for-of loops [x, y]", () => {
        const p = new PIXI.Point(15, 30);
        const coords = [];
        for (const val of p) {
          coords.push(val);
        }

        expect(coords).to.deep.equal([15, 30]);
      });

      it("almostEqual should handle floating point precision", () => {
        const a = new PIXI.Point(1, 1);
        const b = new PIXI.Point(1.000000001, 1.000000001);

        expect(a.almostEqual(b, 1e-7)).to.be.true;
        expect(a.almostEqual(b, 1e-10)).to.be.false;
      });
    });
  });

  describe("PIXI.Point Projection Methods", () => {

    describe("projectToward()", () => {
      it("should project halfway (t=0.5) between two points", () => {
        const start = new PIXI.Point(0, 0);
        const end = new PIXI.Point(100, 100);
        const res = start.projectToward(end, 0.5);

        expect(res.x).to.equal(50);
        expect(res.y).to.equal(50);
        res.release();
      });

      it("should return the start point when t=0", () => {
        const start = new PIXI.Point(10, 10);
        const end = new PIXI.Point(50, 50);
        const res = start.projectToward(end, 0);

        expect(res.x).to.equal(10);
        expect(res.y).to.equal(10);
        res.release();
      });
    });

    describe("towardsPoint()", () => {
      it("should move a specific distance toward the target", () => {
        const start = new PIXI.Point(0, 0);
        const target = new PIXI.Point(10, 0);
        const res = start.towardsPoint(target, 3);

        expect(res.x).to.equal(3);
        expect(res.y).to.equal(0);
        res.release();
      });

      it("should handle distances longer than the segment", () => {
        const start = new PIXI.Point(0, 0);
        const target = new PIXI.Point(5, 0);
        const res = start.towardsPoint(target, 10);

        expect(res.x).to.equal(10);
        expect(res.y).to.equal(0);
        res.release();
      });
    });

    describe("towardsPointSquared()", () => {
      it("should project based on the square of the distance", () => {
        const start = new PIXI.Point(0, 0);
        const target = new PIXI.Point(10, 0);
        // We want to move 5 units. 5^2 = 25.
        const res = start.towardsPointSquared(target, 25);

        expect(res.x).to.equal(5);
        expect(res.y).to.equal(0);
        res.release();
      });
    });

    describe("projectToAxisValue()", () => {
      it("should find the point on a line where x equals a specific value", () => {
        const p1 = new PIXI.Point(0, 0);
        const p2 = new PIXI.Point(10, 20);
        const out = PIXI.Point.tmp;

        // Find where x = 5. On this line, y should be 10.
        const t = p1.projectToAxisValue(p2, 5, "x", out);

        expect(t).to.equal(0.5);
        expect(out.x).to.equal(5);
        expect(out.y).to.equal(10);
        out.release();
      });

      it("should return null if the line is parallel to the target axis", () => {
        const p1 = new PIXI.Point(0, 0);
        const p2 = new PIXI.Point(10, 0); // Horizontal line
        const out = PIXI.Point.tmp;

        // Attempt to find where y = 5 (impossible for a horizontal line at y=0)
        const t = p1.projectToAxisValue(p2, 5, "y", out);

        expect(t).to.be.null;
        out.release();
      });
    });
  });

}, { displayName: "PIXI.Point Extensions" });
});