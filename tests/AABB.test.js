/* globals
Hooks,
PIXI
*/
"use strict";

import { AABB2d } from "../AABB.js";
import { AABB3d } from '../AABB.js';
import { Point3d } from "../3d/Point3d.js";
import { Polygon3d, Circle3d } from '../3d/Polygon3d.js';
import { Plane } from '../3d/Plane.js';



/*
Draw = CONFIG.GeometryLib.Draw
AABB2d = CONFIG.GeometryLib.AABB2d
AABB3d = CONFIG.GeometryLib.threeD.AABB3d
Point3d = CONFIG.GeometryLib.threeD.Point3d
Plane = CONFIG.GeometryLib.threeD.Plane
Polygon3d = CONFIG.GeometryLib.threeD.Polygon3d

*/

Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "libGeometry.AABB",

  (context) => {
      const { describe, it, expect } = context;

// ----- NOTE: AABB2d.overlapsAABB -----
describe('AABB2d.overlapsAABB', () => {
  it('should return true when two boxes overlap', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(0, 0);
    box1.max = new PIXI.Point(5, 5);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(3, 3);
    box2.max = new PIXI.Point(8, 8);

    expect(box1.overlapsAABB(box2)).to.be.true;
    expect(box2.overlapsAABB(box1)).to.be.true;
  });

  it('should return false when two boxes do not overlap', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(0, 0);
    box1.max = new PIXI.Point(2, 2);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(3, 3);
    box2.max = new PIXI.Point(5, 5);

    expect(box1.overlapsAABB(box2)).to.be.false;
    expect(box2.overlapsAABB(box1)).to.be.false;
  });

  it('should return true when boxes touch at the edge', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(0, 0);
    box1.max = new PIXI.Point(2, 2);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(2, 2);
    box2.max = new PIXI.Point(4, 4);

    expect(box1.overlapsAABB(box2)).to.be.true;
    expect(box2.overlapsAABB(box1)).to.be.true;
  });

  it('should work for negative coordinates', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(-5, -5);
    box1.max = new PIXI.Point(0, 0);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(-2, -2);
    box2.max = new PIXI.Point(2, 2);

    expect(box1.overlapsAABB(box2)).to.be.true;
    expect(box2.overlapsAABB(box1)).to.be.true;
  });
});

// ----- NOTE: AABB3d.overlapsConvexPolygon3d -----
describe('AABB3d.overlapsConvexPolygon3d', () => {
  // Helper function to create a simple AABB
  function createAABB(minX, minY, minZ, maxX, maxY, maxZ) {
    const aabb = new AABB3d();
    aabb.min = new Point3d(minX, minY, minZ);
    aabb.max = new Point3d(maxX, maxY, maxZ);
    return aabb;
  }

  it('should return true when polygon is completely inside AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(2, 2, 2),
      new Point3d(8, 2, 2),
      new Point3d(8, 8, 2),
      new Point3d(2, 8, 2)
    ];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.true;
  });

  it('should return true when polygon intersects AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(8, 8, 8),
      new Point3d(12, 8, 8),
      new Point3d(12, 12, 8),
      new Point3d(8, 12, 8)
    ];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.true;
  });

  it('should return false when polygon is completely outside AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(15, 15, 15),
      new Point3d(20, 15, 15),
      new Point3d(20, 20, 15),
      new Point3d(15, 20, 15)
    ];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.false;
  });

  it('should handle edge case where polygon is coplanar with AABB face', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(2, 2, 10),  // On the z=10 face
      new Point3d(8, 2, 10),
      new Point3d(8, 8, 10),
      new Point3d(2, 8, 10)
    ];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.true;
  });

  it('should handle polygon that spans through AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(5, 5, -5),  // Below AABB
      new Point3d(5, 5, 15),  // Above AABB
      new Point3d(15, 15, 5)  // Outside AABB but still intersects
    ];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.true;
  });

  it('should handle empty polygon', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const polygon = new Polygon3d();

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.false;
  });

  it('should handle polygon with single point inside AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [new Point3d(5, 5, 5)];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.true;
  });

  it('should handle polygon with single point outside AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [new Point3d(15, 15, 15)];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.false;
  });

  it('should handle polygon that touches AABB at a single point', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(10, 10, 10),  // Corner point
      new Point3d(15, 10, 10),
      new Point3d(15, 15, 10)
    ];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.true;
  });

  it('should handle polygon that is a line segment', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(5, 5, 5),
      new Point3d(15, 15, 15)
    ];
    const polygon = Polygon3d.from3dPoints(points);


    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.true;
  });

  it('should handle polygon with points exactly on AABB faces', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(0, 0, 0),  // Corner point
      new Point3d(10, 0, 0),  // Edge
      new Point3d(10, 10, 0), // Corner point
      new Point3d(0, 10, 0)   // Edge
    ];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).to.be.true;
  });
});

// ----- NOTE: AABB3d.overlapsCircle -----
describe('AABB3d.overlapsCircle3d', () => {
  // Helper function to create a simple AABB
  function createAABB(minX, minY, minZ, maxX, maxY, maxZ) {
    const aabb = new AABB3d();
    aabb.min = new Point3d(minX, minY, minZ);
    aabb.max = new Point3d(maxX, maxY, maxZ);
    return aabb;
  }

  // Helper function to create a circle in 3D space
  function createCircle3d(centerX, centerY, centerZ, radius, normal = new Point3d(0, 0, 1)) {
    const center = new Point3d(centerX, centerY, centerZ);
    const out = Circle3d.fromCenterPoint(center, radius);
    out.plane = new Plane(center, normal);
    return out;
  }

  it('should return true when circle center is inside AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const circle = createCircle3d(5, 5, 5, 2); // Center inside AABB

    expect(aabb.overlapsCircle3d(circle)).to.be.true;
  });

  it('should return true when circle intersects AABB face', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Circle's plane is parallel to XY plane, intersects with top face
    const circle = createCircle3d(5, 5, 12, 3); // Center above top face, radius extends into AABB

    expect(aabb.overlapsCircle3d(circle)).to.be.true;
  });

  it('should return true when circle is coplanar with AABB face and intersects', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Circle's plane is coplanar with top face
    const circle = createCircle3d(5, 5, 10, 2, new Point3d(0, 0, 1));

    expect(aabb.overlapsCircle3d(circle)).to.be.true;
  });

  it('should return false when circle is completely outside AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Circle is far from AABB
    const circle = createCircle3d(15, 15, 15, 1);

    expect(aabb.overlapsCircle3d(circle)).to.be.false;
  });

  it('should handle circle with zero radius', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Zero-radius circle at AABB center
    const insideCircle = createCircle3d(5, 5, 5, 0);
    // Zero-radius circle outside AABB
    const outsideCircle = createCircle3d(15, 15, 15, 0);

    expect(aabb.overlapsCircle3d(insideCircle)).to.be.true;
    expect(aabb.overlapsCircle3d(outsideCircle)).to.be.false;
  });

  it('should handle circle with very large radius', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Circle completely encloses AABB
    const largeCircle = createCircle3d(5, 5, 5, 100);

    expect(aabb.overlapsCircle3d(largeCircle)).to.be.true;
  });

  it('should handle circle with non-axis-aligned plane', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Circle in a diagonal plane
    const diagonalNormal = new Point3d(1, 1, 1).normalize();
    const circle = createCircle3d(5, 5, 5, 10, diagonalNormal);

    expect(aabb.overlapsCircle3d(circle)).to.be.true;
  });

  it('should handle circle that touches AABB at a single point', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Circle touches the corner at (10,10,10)
    const circle = createCircle3d(13, 13, 10, Math.sqrt(18));

    expect(aabb.overlapsCircle3d(circle)).to.be.true;
  });

  it('should handle circle that is tangent to AABB face', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Circle is tangent to the right face (x=10)
    const circle = createCircle3d(13, 5, 5, 3);

    expect(aabb.overlapsCircle3d(circle)).to.be.true;
  });

  it('should handle circle that is coplanar with AABB face but outside', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Circle is coplanar with top face but outside AABB
    const circle = createCircle3d(15, 5, 10, 2);

    expect(aabb.overlapsCircle3d(circle)).to.be.false;
  });

  it('should handle circle that intersects AABB edge', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    // Circle intersects the edge between top and right faces
    const circle = createCircle3d(12, 12, 10, 3);

    expect(aabb.overlapsCircle3d(circle)).to.be.true;
  });
});


},
{ displayName: "libGeometry: Axis-aligned Bounding Box (AABB)" },
);

});