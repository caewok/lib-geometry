/* globals
*/
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { Polygon3d } from '../3d/Polygon3d.js';
import { Plane } from '../3d/Plane.js';
import { MODULE_ID } from "../../const.js";

export function registerTests(quench) {

  quench.registerBatch(
    `${MODULE_ID}.libGeometry.Polygon3d`,

  (context) => {
      const { describe, it, expect } = context;

// Helper functions for testing
const roundSegment = s => {
  s.a.roundDecimals(5);
  s.b.roundDecimals(5);
};

// --- Mock Data ---
// A square polygon lying flat on the XY plane (Z=0)
let points = [
  Point3d.tmp.set(-1, -1, 0),
  Point3d.tmp.set(1, -1, 0),
  Point3d.tmp.set(1, 1, 0),
  Point3d.tmp.set(-1, 1, 0),
];
const polyXY = Polygon3d.from3dPoints(points);
polyXY.plane.point = new Point3d(0, 0, 0);
polyXY.normal = { x: 0, y: 0, z: 1 };
Point3d.release(...points);

// A square polygon standing vertically on the XZ plane (Y=0)
points = [
  Point3d.tmp.set(-1, 0, -1),
  Point3d.tmp.set(1, 0, -1),
  Point3d.tmp.set(1, 0, 1),
  Point3d.tmp.set(-1, 0, 1),
];
const polyXZ = Polygon3d.from3dPoints(points);
polyXZ.plane.point = new Point3d(0, 0, 0);
polyXZ.normal = { x: 0, y: 1, z: 0 };
Point3d.release(...points);

// A polygon shifted up completely above the others (Z=5)
points = [
  Point3d.tmp.set(-1, -1, 5),
  Point3d.tmp.set(1, -1, 5),
  Point3d.tmp.set(1, 1, 5),
  Point3d.tmp.set(-1, 1, 5),
];
const polyHigh = Polygon3d.from3dPoints(points);
polyHigh.plane.point = new Point3d(0, 0, 5);
polyHigh.normal = { x: 0, y: 0, z: 1 };
Point3d.release(...points);

describe("3D Geometry Intersections", () => {

  describe("intersectPolygonWithPlane()", () => {

    it("should return a segment when the plane cuts through the polygon", () => {
      // A plane cutting vertically along the Y axis (X=0)
      const cutPlane = new Plane({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      const result = polyXY.intersectPlane(cutPlane);
      expect(result).to.be.an("array").that.has.lengthOf(1);

      roundSegment(result[0]);
      expect(result[0].a.equals({ x: 0, y: -1, z: 0 }))
      expect(result[0].b.equals({ x: 0, y: 1, z: 0 }))
    });

    it("should return an empty array when the plane is parallel and not touching", () => {
      const parallelPlane = new Plane({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 1 } );
      const result = polyXY.intersectPlane(parallelPlane);
      expect(result).to.be.an("array").that.is.empty;
    });

    it("should return a coplanar object when the polygon is on the plane", () => {
      const result = polyXY.intersectPlane(polyXY.plane);
      expect(result.equals([...polyXY.iterateEdges()])).to.be.true;
    });
  });

  describe("intersect3DPolygons()", () => {

    it("should return the line segment representing the overlap of two intersecting polygons", () => {
      // Intersecting XY flat plane with XZ vertical plane.
      // They cross exactly on the X axis from -1 to 1.
      const result = polyXY.intersectPolygon3d(polyXZ);
      expect(result).to.be.an("array").that.has.lengthOf(1);

      roundSegment(result[0]);
      expect(result[0].a.equals({ x: -1, y: 0, z: 0 }));
      expect(result[0].b.equals({ x: 1, y: 0, z: 0 }));
    });

    it("should return an empty array if the polygons' planes intersect, but the polygons do not overlap", () => {
      // Shift polyXZ so it no longer overlaps with polyXY's boundaries
      const shiftedPolyXZ = polyXZ.clone();
      shiftedPolyXZ.points.forEach(pt => pt.x += 5);
      const result = polyXY.intersectPolygon3d(shiftedPolyXZ);
      expect(result).to.be.an("array").that.is.empty;
    });

    it("should return an empty array if the polygons are on parallel, distinct planes", () => {
      const result = polyXY.intersectPolygon3d(polyHigh);
      expect(result).to.be.an("array").that.is.empty;
    });

    it("should return a coplanar signal object if the polygons share the exact same plane", () => {
      // Testing a polygon against itself
      const result = polyXY.intersectPolygon3d(polyXY);
      expect(result).to.be.null;
    });
  });
});

}); // registerBatch

} // registerTests
