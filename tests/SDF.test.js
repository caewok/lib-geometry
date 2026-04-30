/* globals 
PIXI,
*/

import { SDF } from "../sdf/SDF.js";
import { MODULE_ID } from "../../const.js";
import { Point3d } from "../3d/Point3d.js";
import { Polygon3d, Triangle3d } from "../3d/Polygon3d.js";

/**
 * Unit tests for the SDF (Signed Distance Function) class.
 * Run these using the Quench module in FoundryVTT.
 */
export function registerTests(quench) {

  quench.registerBatch(
    `${MODULE_ID}.libGeometry.SDF`,

  (context) => {
      const { describe, it, expect } = context;


  describe("GeometryLib | SDF Primitives", function() {
    const EPSILON = 1e-6;

    // Helper to check distance with a small epsilon for floating point errors
    const expectClose = (val, target) => expect(val).to.be.closeTo(target, EPSILON);

    describe("sdPIXIPolygon", function() {
      // Define a 100x100 square centered at the origin
      const square = new PIXI.Polygon(
        -50, -50,
        50, -50,
        50, 50,
        -50, 50,
      );

      it("should return a negative distance for points inside the polygon", function() {
        const p = new PIXI.Point(0, 0);
        const d = SDF.sdPIXIPolygon(p, square);
        expect(d).to.be.below(0);
        expectClose(d, -50);
        
        const dPoints = SDF.sdPolygon(p, [...square.iteratePoints()]);
        expectClose(d, dPoints);
      });

      it("should return a positive distance for points outside the polygon", function() {
        const p = new PIXI.Point(100, 0);
        const d = SDF.sdPIXIPolygon(p, square);
        expect(d).to.be.above(0);
        expectClose(d, 50);
        
        const dPoints = SDF.sdPolygon(p, [...square.iteratePoints()]);
        expectClose(d, dPoints);
      });

      it("should correctly calculate distance to the nearest edge (not just vertex)", function() {
        // Point is closer to the edge (50, 25) than any vertex
        const p = new PIXI.Point(60, 25);
        const d = SDF.sdPIXIPolygon(p, square);
        expectClose(d, 10);
        
        const dPoints = SDF.sdPolygon(p, [...square.iteratePoints()]);
        expectClose(d, dPoints);
      });
    });

    describe("sdPolygon3d", function() {
      const square3d = Polygon3d.from3dPoints([
        new Point3d(-50, -50, 0),
        new Point3d(50, -50, 0),
        new Point3d(50, 50, 0),
        new Point3d(-50, 50, 0),
      ]);

      it("should return 0 for point on the polygon", function() {
        const p = new Point3d(0, 0, 0);
        const d = SDF.sdPolygon3d(p, square3d);
        expectClose(d, 0);
      });

      it("should handle points offset in the Z-axis", function() {
        let p = new Point3d(60, 0, 10); // 10 units away from edge on X, 10 units up on Z
        let d = SDF.sdPolygon3d(p, square3d);
        // Distance should be hypotenuse of 10 and 10
        expectClose(d, Math.sqrt(100 + 100));
        
        p = new Point3d(60, 0, -10);
        d = SDF.sdPolygon3d(p, square3d);
        expectClose(d, Math.sqrt(100 + 100));
        
      });
    });

    describe("sdHexagon", function() {
      it("should return 0 for a point on the edge", function() {
        const r = 10;
        // Top edge of a flat-topped hexagon is at r * sin(60)
        const d = SDF.sdHexagon(new PIXI.Point(0, r), r);
        expectClose(d, 0);
      });

      it("should return negative for the origin", function() {
        const d = SDF.sdHexagon(new PIXI.Point(0, 0), 10);
        expect(d).to.be.below(0);
      });
    });

    describe("sdBox", function() {
      it("should correctly calculate distance for a 2D box", function() {
        const b = new PIXI.Point(20, 10); // Half-extents
        const p = new PIXI.Point(25, 0);  // 5 units outside on X
        expectClose(SDF.sdBox(p, b), 5);
      });
    });

    describe("sdTriangle3d", function() {
      const a = new Point3d(0, 0, 0);
      const b = new Point3d(10, 0, 0);
      const c = new Point3d(0, 10, 0);
      const tri = Triangle3d.from3Points(a, b, c);

      it("should return correct distance for point directly above the triangle", function() {
        const p = new Point3d(2, 2, 5);
        const d = SDF.sdTriangle3d(p, tri);
        expectClose(d, 5);
      });

      it("should not mutate the input vertex points during calculation", function() {
        const p = new Point3d(5, 5, 5);
        const aCopy = { x: a.x, y: a.y, z: a.z };
        SDF.sdTriangle3d(p, tri);
        expect(a.x).to.equal(aCopy.x);
        expect(a.y).to.equal(aCopy.y);
      });
    });

    describe("Boolean Operators", function() {
      it("opUnion should return the minimum distance", function() {
        const d1 = 10;
        const d2 = 5;
        expect(SDF.union(d1, d2)).to.equal(5);
      });

      it("opSubtraction should return the maximum of d1 and -d2", function() {
        const d1 = 10; // Object 1
        const d2 = -5; // Object 2 (point is inside)
        // Subtracting d2 from d1 means the point is "inside" the hole
        expect(SDF.subtraction(d1, d2)).to.equal(10);
      });
    });

    describe("sdPIXIPolygonsWithHoles", function() {
      it("should handle polygon object with hole", function() {
        const main = new PIXI.Polygon(
          0, 0,
          100, 0,
          0, 100,
        );
        const hole = new PIXI.Polygon(
          10, 20, // Reversed orientation.
          20, 10,
          10, 10,
        );
        
        const polys = [main, hole];    
        const pInsideHole = new PIXI.Point(12.5, 12.5);
        let d = SDF.sdPIXIPolygonsWithHoles(pInsideHole, polys);
        expect(d).to.be.greaterThan(0);
        
        const pInside = new PIXI.Point(20, 20);
        d = SDF.sdPIXIPolygonsWithHoles(pInside, polys);
        expect(d).to.be.lessThan(0);
        
        const pOutside = new PIXI.Point(-100, -100);
        d = SDF.sdPIXIPolygonsWithHoles(pOutside, polys);
        expect(d).to.be.greaterThan(0);
      });
    });
  });
},
{ displayName: "libGeometry: Signed Distance Functions (SDF)" },
);

}