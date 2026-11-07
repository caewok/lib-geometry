/* globals
*/
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { Polygon3d, Polygons3d, Triangle3d } from '../3d/Polygon3d.js';
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

  describe("intersectsPolygon3d()", () => {

    it("should return true when polygons intersect", () => {
      expect(polyXY.intersectsPolygon3d(polyXZ)).to.be.true;
    });

    it("should return false when planes intersect but polygon boundaries do not overlap", () => {
      const shiftedPolyXZ = polyXZ.clone();
      shiftedPolyXZ.points.forEach(pt => pt.x += 5);
      expect(polyXY.intersectsPolygon3d(shiftedPolyXZ)).to.be.false;
    });

    it("should return false when polygons are on parallel, distinct planes", () => {
      expect(polyXY.intersectsPolygon3d(polyHigh)).to.be.false;
    });

    it("should return true when polygons share the exact same plane", () => {
      expect(polyXY.intersectsPolygon3d(polyXY)).to.be.true;
    });
  });

  describe("Polygons3d#pointsLattice", () => {

    it("should return an empty array when Polygons3d has no constituent polygons", () => {
      const emptyPoly = new Polygons3d(0);
      expect(emptyPoly.pointsLattice()).to.be.an("array").that.is.empty;
    });

    it("should generate lattice points and filter out points inside holes", () => {
      // Outer square from -10 to 10 on Z=0 plane
      const outerPts = [
        Point3d.tmp.set(-10, -10, 0),
        Point3d.tmp.set(10, -10, 0),
        Point3d.tmp.set(10, 10, 0),
        Point3d.tmp.set(-10, 10, 0)
      ];
      const outerPoly = Polygon3d.from3dPoints(outerPts);
      outerPoly.plane.point = new Point3d(0, 0, 0);
      outerPoly.normal = { x: 0, y: 0, z: 1 };
      Point3d.release(...outerPts);

      // Hole square from -4 to 4 on Z=0 plane (isHole = true)
      const holePts = [
        Point3d.tmp.set(-4, -4, 0),
        Point3d.tmp.set(4, -4, 0),
        Point3d.tmp.set(4, 4, 0),
        Point3d.tmp.set(-4, 4, 0)
      ];
      const holePoly = Polygon3d.from3dPoints(holePts, { isHole: true });
      holePoly.plane.point = new Point3d(0, 0, 0);
      holePoly.normal = { x: 0, y: 0, z: 1 };
      Point3d.release(...holePts);

      const shapeWithHole = new Polygons3d();
      shapeWithHole.polygons = [outerPoly, holePoly];

      const latticePoints = shapeWithHole.pointsLattice({ spacing: 2, startAtEdge: true });
      expect(latticePoints).to.be.an("array").that.is.not.empty;

      // Verify that no returned point falls strictly inside the hole bounds (-4 to 4)
      for ( const pt of latticePoints ) {
        const insideHole = pt.x > -4 && pt.x < 4 && pt.y > -4 && pt.y < 4;
        expect(insideHole).to.be.false;
      }

      // Also verify that points outside the hole were generated
      const hasPointsOutsideHole = latticePoints.some(pt => Math.abs(pt.x) >= 4 || Math.abs(pt.y) >= 4);
      expect(hasPointsOutsideHole).to.be.true;
    });
  });

  describe("Triangle3d#toVertices", () => {

    it("should write triangle position coordinates directly to Float32Array (without normals)", () => {
      const a = new Point3d(0, 0, 0);
      const b = new Point3d(1, 0, 0);
      const c = new Point3d(0, 1, 0);
      const tri = Triangle3d.from3Points(a, b, c);

      const vertices = tri.toVertices({ addNormals: false });
      expect(vertices).to.be.an.instanceOf(Float32Array);
      expect(vertices.length).to.equal(9);
      expect(Array.from(vertices)).to.deep.equal([
        0, 0, 0,
        1, 0, 0,
        0, 1, 0
      ]);
    });

    it("should write triangle positions and normals directly to Float32Array (with normals)", () => {
      const a = new Point3d(0, 0, 0);
      const b = new Point3d(1, 0, 0);
      const c = new Point3d(0, 1, 0);
      const tri = Triangle3d.from3Points(a, b, c);
      tri.normal = { x: 0, y: 0, z: 1 };

      const vertices = tri.toVertices({ addNormals: true });
      expect(vertices).to.be.an.instanceOf(Float32Array);
      expect(vertices.length).to.equal(18);
      expect(Array.from(vertices)).to.deep.equal([
        0, 0, 0, 0, 0, 1,
        1, 0, 0, 0, 0, 1,
        0, 1, 0, 0, 0, 1
      ]);
    });

    it("should write at specified outIdx into existing outArr", () => {
      const a = new Point3d(2, 3, 4);
      const b = new Point3d(5, 6, 7);
      const c = new Point3d(8, 9, 10);
      const tri = Triangle3d.from3Points(a, b, c);

      const target = new Float32Array(12);
      tri.toVertices({ outArr: target, outIdx: 3 });

      expect(Array.from(target)).to.deep.equal([
        0, 0, 0,
        2, 3, 4,
        5, 6, 7,
        8, 9, 10
      ]);
    });

    it("should support bulk conversion via Triangle3d.trianglesToVertices", () => {
      const tri1 = Triangle3d.from3Points(new Point3d(0, 0, 0), new Point3d(1, 0, 0), new Point3d(0, 1, 0));
      const tri2 = Triangle3d.from3Points(new Point3d(1, 0, 0), new Point3d(1, 1, 0), new Point3d(0, 1, 0));

      const vertices = Triangle3d.trianglesToVertices([tri1, tri2], { addNormals: false });
      expect(vertices.length).to.equal(18);
      expect(Array.from(vertices)).to.deep.equal([
        0, 0, 0, 1, 0, 0, 0, 1, 0,
        1, 0, 0, 1, 1, 0, 0, 1, 0
      ]);
    });
  });
});

}); // registerBatch

} // registerTests
