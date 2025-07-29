/* globals
Hooks,
PIXI
*/
"use strict";

import { AABB2d } from "./AABB.js";
import { Point3d } from "./3d/Point3d.js";

import { AABB3d } from '../AABB.js';
import { Polygon3d } from '../3d/Polygon3d.js';
// import { Plane } from '../3d/Plane.js';

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

describe('AABB2d.overlapsAABB', () => {
  it('should return true when two boxes overlap', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(0, 0);
    box1.max = new PIXI.Point(5, 5);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(3, 3);
    box2.max = new PIXI.Point(8, 8);

    expect(box1.overlapsAABB(box2)).toBe(true);
    expect(box2.overlapsAABB(box1)).toBe(true);
  });

  it('should return false when two boxes do not overlap', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(0, 0);
    box1.max = new PIXI.Point(2, 2);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(3, 3);
    box2.max = new PIXI.Point(5, 5);

    expect(box1.overlapsAABB(box2)).toBe(false);
    expect(box2.overlapsAABB(box1)).toBe(false);
  });

  it('should return true when boxes touch at the edge', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(0, 0);
    box1.max = new PIXI.Point(2, 2);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(2, 2);
    box2.max = new PIXI.Point(4, 4);

    expect(box1.overlapsAABB(box2)).toBe(true);
    expect(box2.overlapsAABB(box1)).toBe(true);
  });

  it('should work for negative coordinates', () => {
    const box1 = new AABB2d();
    box1.min = new PIXI.Point(-5, -5);
    box1.max = new PIXI.Point(0, 0);

    const box2 = new AABB2d();
    box2.min = new PIXI.Point(-2, -2);
    box2.max = new PIXI.Point(2, 2);

    expect(box1.overlapsAABB(box2)).toBe(true);
    expect(box2.overlapsAABB(box1)).toBe(true);
  });
});


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

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(true);
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

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(true);
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

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(false);
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

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(true);
  });

  it('should handle polygon that spans through AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(5, 5, -5),  // Below AABB
      new Point3d(5, 5, 15),  // Above AABB
      new Point3d(15, 15, 5)  // Outside AABB but still intersects
    ];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(true);
  });

  it('should handle empty polygon', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const polygon = new Polygon3d();

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(false);
  });

  it('should handle polygon with single point inside AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [new Point3d(5, 5, 5)];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(true);
  });

  it('should handle polygon with single point outside AABB', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [new Point3d(15, 15, 15)];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(false);
  });

  it('should handle polygon that touches AABB at a single point', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(10, 10, 10),  // Corner point
      new Point3d(15, 10, 10),
      new Point3d(15, 15, 10)
    ];
    const polygon = Polygon3d.from3dPoints(points);

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(true);
  });

  it('should handle polygon that is a line segment', () => {
    const aabb = createAABB(0, 0, 0, 10, 10, 10);
    const points = [
      new Point3d(5, 5, 5),
      new Point3d(15, 15, 15)
    ];
    const polygon = Polygon3d.from3dPoints(points);


    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(true);
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

    expect(aabb.overlapsConvexPolygon3d(polygon)).toBe(true);
  });
});

},
{ displayName: "libGeometry: AABB Testing" },
);

});