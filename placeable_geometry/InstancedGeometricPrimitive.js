/* globals
canvas,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { MatrixFloat32 } from "../Matrix.js";
import { isAxisAlignedRectangle } from "../util.js";
import { Point3d } from "../3d/Point3d.js";
import { getHexagonalShape } from "../placeable_vertices/BasicVertices.js";
import { Polygon3d, Quad3d, Ellipse3d, Circle3d } from "../3d/Polygon3d.js";
import { Sphere } from "../3d/Sphere.js";
import { HorizontalQuadVertices } from "../placeable_vertices/BasicVertices.js";
import { CutawayPolygon } from "../CutawayPolygon.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";

/** @type {Matrix<4,4>} */
const IDENTITY_MATRIX = MatrixFloat32.identity(4, 4);
Object.freeze(IDENTITY_MATRIX);

// All CCW because default GPU test is counter-clockwise

const QUADS = {
  up: Quad3d.from4Points(
    Point3d.tmp.set(-0.5, -0.5, 0),
    Point3d.tmp.set(-0.5, 0.5, 0),
    Point3d.tmp.set(0.5, 0.5, 0),
    Point3d.tmp.set(0.5, -0.5, 0),
  ),
  down: Quad3d.from4Points(
    Point3d.tmp.set(0.5, -0.5, 0),
    Point3d.tmp.set(0.5, 0.5, 0),
    Point3d.tmp.set(-0.5, 0.5, 0),
    Point3d.tmp.set(-0.5, -0.5, 0),
  ),
  south: Quad3d.from4Points( // E.g., wall facing south.
    Point3d.tmp.set(-0.5, 0, 0.5),
    Point3d.tmp.set(-0.5, 0, -0.5),
    Point3d.tmp.set(0.5, 0, -0.5),
    Point3d.tmp.set(0.5, 0, 0.5),
  ),
  north: Quad3d.from4Points(
    Point3d.tmp.set(0.5, 0, 0.5),
    Point3d.tmp.set(0.5, 0, -0.5),
    Point3d.tmp.set(-0.5, 0, -0.5),
    Point3d.tmp.set(-0.5, 0, 0.5),
  ),
  west: Quad3d.from4Points( // E.g., wall facing west.
    Point3d.tmp.set(0, -0.5, 0.5),
    Point3d.tmp.set(0, -0.5, -0.5),
    Point3d.tmp.set(0, 0.5, -0.5),
    Point3d.tmp.set(0, 0.5, 0.5),
  ),
  east: Quad3d.from4Points(
    Point3d.tmp.set(0, 0.5, 0.5),
    Point3d.tmp.set(0, 0.5, -0.5),
    Point3d.tmp.set(0, -0.5, -0.5),
    Point3d.tmp.set(0, -0.5, 0.5),
  ),
};

export class InstancedGeometricPrimitive extends GeometricPrimitive {

  // ----- NOTE: FACES ----- //

  /** @type {Polygon3d} */
  static prototypeFaces = [] // Defined by child class.

  get prototypeFaces() { return this.constructor.prototypeFaces; }

  // ----- NOTE: Vertices ----- //

  /**
   * Instanced primitives share a static instanceVO, just like they share static prototype faces.
   * @type {VertexObject}
   */
  static _instanceVO;

  static get instanceVO() { return (this._instanceVO ??= this.generateInstanceVertices()); }

  get instanceVO() { return this.constructor.instanceVO; }

  static generateInstanceVertices() {
    const vo = new VertexObject();
    this.generateVerticesForFaces(this.prototypeFaces, vo);
    return vo;
  }

  /**
   * Shared VO for just the side walls of the prototype. Build lazily, once per concrete class.
   * @type {VertexObject}
   */
  static get wallsVO() {
    if ( !Object.hasOwn(this, "_wallsVO") ) { // Don't let a subclass pick up a parent's VO through static prototype chain.
      this._wallsVO = this.generateVerticesForFaces(this.prototypeFaces.slice(2));
    }
    return this._wallsVO;
  }

  get wallsVO() { return this.constructor.wallsVO; }

}

/**
 * Single quad.
 * The prototype faces directly up and is centered at the XY origin.
 */
export class QuadPrimitive extends InstancedGeometricPrimitive {

  /** @type {Polygon3d} */
  static prototypeFaces = [QUADS.up.clone()];

  static _instanceVO;

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end, { thickness = 1 } = {}) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end) ) return [];

    // If this object is rotated such that the top face is not parallel to XY, cutawayBasicShape will fail.
    const rot = this.modelMatrix.rotation;
    if ( rot.x || rot.y ) return super.verticalSlice(start, end);

    const top = this.faces[0];
    const poly = top.toPolygon2d();
    const topZ = top.points[0].z;
    const bottomZ = topZ - thickness;
    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };
    return poly.cutaway(start, end, opts);
  }

  prototypeFacesOutward() {
    // Should face up before any rotations.
    using ctr = Point3d.tmp.set(0, 0, 1);
    return this.prototypeFaces[0].isFacing(ctr);
  }

  facesOutward() {
    // Should face up before any rotations.
    using ctr = Point3d.tmp.set(0, 0, 1);
    this.modelMatrix.model.multiplyPoint3d(ctr, ctr);
    return this.faces[0].isFacing(ctr);
  }
}

/**
 * Helper class to deal with vertical walls.
 */
export class VerticalQuadPrimitive extends QuadPrimitive {

  // Does not define the modelMatrixTracker so will share parent's.

  static prototypeFaces = [QUADS.north.clone()];

  static _instanceVO;

  setDims({ lengthXY, zHeight } = {}) {
    // For the horizontal quad (before rotation), length is the x-axis, height is z-axis.
    // Set y scale to 1 to avoid collapsing the matrix.
    using dims = Point3d.tmp.set(lengthXY, 1, zHeight);
    this.setScale(dims);
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end) ) return [];

    // If this object is rotated such that the top face is not parallel to XY, cutawayBasicShape will fail.
    const rot = this.modelMatrix.rotation;
    if ( rot.x || rot.y ) return super.verticalSlice(start, end);

    // Draw the 2d top as a thin quad.
    // The 3d quad has 4 edges: 2 vertical and 2 horizontal.
    // Rely on fact that we know the points from QUAD.north.
    const face = this.faces[0];
    const a = face.points[0];
    const b = face.points[3];

    // Add/subtract half a pixel each way.
    using dir = b.subtract(a);
    using normal = PIXI.Point.tmp.set(-dir.y, dir.x);
    normal.normalize(normal).multiplyScalar(0.5, normal);
    using pt0 = a.subtract(normal);
    using pt1 = a.add(normal);
    using pt2 = b.add(normal);
    using pt3 = b.subtract(normal);

    const poly = new PIXI.Polygon(pt0, pt1, pt2, pt3);
    const topZ = face.points[0].z;
    const bottomZ = face.points[1].z;

    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };
    return poly.cutaway(start, end, opts);
  }

  prototypeFacesOutward() {
    // Should face north before any rotations.
    using ctr = Point3d.tmp.set(0, -1, 0);
    return this.prototypeFaces[0].isFacing(ctr);
  }

  facesOutward() {
    // Should face north before any rotations.
    using ctr = Point3d.tmp.set(0, -1, 0);
    this.modelMatrix.model.multiplyPoint3d(ctr, ctr);
    return this.faces[0].isFacing(ctr);
  }
}



/**
 * Quad that includes a texture. (E.g., for tiles)
 * Separate from QuadPrimitive b/c the instance includes UVs.
 */
export class TexturedQuadPrimitive extends QuadPrimitive {

  static TEXTURED = true;

  textureURL = "";

  alphaThreshold = 0.75;

  static _instanceVO;

  /**
   * Update instance vertices.
   * Default approach uses the prototype faces.
   */
  static generateInstanceVertices() {
    // Add vertices from faces.
    const vo = new VertexObject;
    vo.vertices = HorizontalQuadVertices.top;
    vo.hasNormals = true;
    vo.hasUVs = true;
    vo.condense(vo);
    return vo;
  }
}

/**
 * Shape that is equivalent to an extruded polygon, with defined sides, top, bottom.
 * Does not change the definitions upon rotation, but useful for FoundryVTT regions, etc.
 * Top and bottom faces are arrays for consistency with more complex objects, like hills or steps.
 */
class ExtrudedInstancePrimitive extends InstancedGeometricPrimitive {

  /** @type {Polygon3d[]} */
  get bottomFaces() { return this.faces.slice(0,1); }

  /** @type {Polygon3d[]} */
  get topFaces() { return this.faces.slice(1,2); }

  /** @type {Polygon3d[]} */
  get sideFaces() { return this.faces.slice(2);}

  get topZ() { return this.aabb.max.z; }

  get bottomZ() { return this.aabb.min.z; }

  /**
   * Get the 2d polygon canvas representation of this shape, usually based on the bottom shape.
   * Assumes no rotation around the x or y axis.
   * @returns {PIXI.Polygon} Polygon, or possibly other PIXI shape for subclasses.
   */
  toPIXIShape() { return this.bottomFaces[0].toPolygon2d(); }

  /**
   * Does this shape's XY dimensions potentially contain this canvas location?
   * Meant to be a relatively quick test. Should only reject if it is certain not to contain it.
   * @param {PIXI.Point} canvasLoc
   * @returns {boolean}
   */
  containsProjectedXY(canvasLoc) {
    return this.bottomFaces.some(f => f.containsProjectedXY(canvasLoc));
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end) ) return [];

    // If this object is rotated such that the top face is not parallel to XY, cutawayBasicShape will fail.
    const rot = this.modelMatrix.rotation;
    if ( rot.x || rot.y ) return super.verticalSlice(start, end);

    // Because the bottom face is parallel to XY plane, we can just drop the Z axis.
    const { bottomFaces, topZ, bottomZ } = this;
    const poly = bottomFaces[0].toPolygon2d();
    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };
    return poly.cutaway(start, end, opts);
  }

  // ----- NOTE: Drawables ----- //

  /** @type {VertexObject} */

  _sidesVO;

  /**
   * Vertices for the prototype's side walls only.
   * By default, every prototype face after the bottom (0) and top (1) faces.
   * Therefore assumes an extruded shape, which may require subclasses to override.
   * @type {VertexObject}
   */
  get sidesVO() {
    return (this._sidesVO ??= this.constructor.generateVerticesForFaces(this.prototypeFaces.slice(2)));
  }

  /**
   * @typedef {Object} GeometricDrawableData
   *
   * @prop {GeometricPrimitive} primitive
   * @prop {VertexObject} vo
   * @prop {Matrix<4x4>} matrix
   * @prop {number} direction
   * @prop {number} version
   */

  /**
   * Yield what a renderer needs to draw this primitive: prototype VO and the matrix to apply it.
   * Leaves yield themselves; containers yield their descendant's drawables.
   * @param {object} [opts]
   * @param {boolean} [opts.sidesOnly=false]    Only the side walls (used for holed solids).
   * @yields {GeometricDrawableData}
   */
  *drawables({ sidesOnly = false} = {}) {
    if ( !sidesOnly ) return super.drawables();
    for ( const drawable of super.drawables() ) {
      drawable.vo = this.sidesVO;
      yield drawable;
    }
  }

  /**
   * Determine where a ray first hits this object in 3d.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  firstRayIntersection(rayOrigin, rayDirection, { minT = 0, maxT = 1, sidesOnly = false } = {}) {
    const direction = this.constructor.CULL_FACES.BACK;
    let best = null;
    const faces = sidesOnly ? this.sideFaces : this.faces;
    for ( const face of faces ) {
      const t = this.constructor.rayIntersectionForFace(rayOrigin, rayDirection, maxT, minT, direction);
      if ( t !== null && (best === null || t < best) ) best = t;
    }
    return best;
  }

  /**
   * Does this ray hit this object in 3d?
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  rayIntersection(rayOrigin, rayDirection, { minT = 0, maxT = 1, sidesOnly = false } = {}) {
    const direction = this.constructor.CULL_FACES.BACK;
    const faces = sidesOnly ? this.sideFaces : this.faces;
    for ( const face of faces ) {
      const t = this.constructor.rayIntersectionForFace(rayOrigin, rayDirection, maxT, minT, direction);
      if ( t !== null ) return t;
    }
    return null;
  }

  /**
   * Determine all ray hits for this object in 3d.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number[]} The distance along the ray, as a multiple of rayDirection
   */
  allRayIntersections(rayOrigin, rayDirection, { minT = 0, maxT = 1, sidesOnly = false } = {}) {
    const direction = this.constructor.CULL_FACES.BACK;
    const out = [];
    const faces = sidesOnly ? this.sideFaces : this.faces;
    for ( const face of faces ) {
      const t = this.constructor.rayIntersectionForFace(rayOrigin, rayDirection, maxT, minT, direction);
      if ( t !== null ) out.push(t);
    }
    return out;
  }
}

/**
 * Cube, e.g. for a square token.
 */
export class CubePrimitive extends ExtrudedInstancePrimitive {

  /**
   * Create the instance face shapes for a unit cube.
   * 1 x 1 x 1 centered at 0,0,0.
   * @returns {Quad3d[]}
   */
  static createUnitCube() {
    const faces = [
      QUADS.down.clone(),
      QUADS.up.clone(),
      QUADS.north.clone(),
      QUADS.west.clone(),
      QUADS.south.clone(),
      QUADS.east.clone(),
    ];

    faces[1].setZ(0.5);
    faces[0].setZ(-0.5);

    // Adjust the sides so that they are at the region edge.
    for ( let i = 0; i < 4; i += 1 ) {
      faces[2].points[i].y = -0.5; // North.
      faces[3].points[i].x = -0.5; // West.
      faces[4].points[i].y = 0.5; // South.
      faces[5].points[i].x = 0.5; // East.
    }
    return faces;
  }


  /** @type {Faces} */
  static prototypeFaces = this.createUnitCube();

  static _instanceVO;

  // Internal points follow the AABB.

  /**
   * Get the 2d polygon canvas representation of this shape, usually based on the bottom shape.
   * Assumes no rotation around the x or y axis.
   * @returns {PIXI.Polygon|PIXI.Rectangle} Polygon, or possibly other PIXI shape.
   */
  toPIXIShape() {
    // If the points are squared, return a rectangle.
    const bottom = this.bottomFaces[0];
    const points2d = bottom.points.map(pt => pt.to2d());
    let out;
    if ( isAxisAlignedRectangle(...points2d) ) out = this.aabb.toRectangle();
    else out = bottom.toPolygon2d();
    points2d.forEach(pt => pt.release());
    return out;
  }
}

/**
 * Simple extruded (along z-axis) hexagon.
 */
export class HexagonCylinderPrimitive extends ExtrudedInstancePrimitive {

  /**
   * Create the face shapes for a unit hexagon.
   * @returns {Quad3d|Polygon3d[]}
   */
  static createUnitHexagonCylinder() {
    const res = getHexagonalShape(1, 1, CONST.TOKEN_SHAPES.TRAPEZOID_1, false);
    let poly = new PIXI.Polygon(res.points);
    poly = poly.translate(-res.center.x, -res.center.y);
    const bounds = poly.getBounds();
    poly = poly.scale(1/bounds.width, 1/bounds.height);
    if ( poly.isPositive ) poly.reverseOrientation();
    const top = Polygon3d.fromPolygon(poly, { elevationZ: 0.5 });
    const bottom = top.clone();
    top.reverseOrientation();
    top.setZ(0.5);
    bottom.setZ(-0.5);
    return [bottom, top, ...top.buildTopSides(-0.5)];
  }

  static #prototypeFaces; /* eslint-disable-line no-unused-private-class-members */

  static get prototypeFaces() { return (this.#prototypeFaces = this.createUnitHexagonCylinder()); }

  static _instanceVO;

  /**
   * Determine all top, bottom, and mid corners along with midpoints between for the
   * hexagon cylinder.
   * @returns {object}
   */
  getInternalPoints() {
    return this.constructor.calculatePolygonCylinderInternalPoints(this.topFaces[0], this.bottomFaces[0]);
  }
}

/**
 * Extruded (along z-axis) cylinder or ellipse
 */
export class CylinderPrimitive extends ExtrudedInstancePrimitive {

  /**
   * Assumed number of sides for the polygon approximation of the cylinder.
   * Used to construct the sides.
   */
  static DENSITY = PIXI.Circle.approximateVertexDensity(100);

  /**
   * Create the faces for a unit cylinder.
   * @returns {Ellipse3d|Polygon3d[]}
   */
  static createUnitCylinder() {
    const top = Ellipse3d.fromCenterPoint({ x: 0, y: 0, z: 0.5 }, { radiusX: 0.5, radiusY: 0.5 });
    const bottom = Ellipse3d.fromCenterPoint({ x: 0, y: 0, z: -0.5 }, { radiusX: 0.5, radiusY: 0.5 });
    top.reverseOrientation();

    // Build the sides.
    top.density = this.DENSITY;
    bottom.density = this.DENSITY;
    return [bottom, top, ...top.buildTopSides(-0.5)];
  }

  static _prototypeFaces;

  static get prototypeFaces() { return this._prototypeFaces ||= this.createUnitCylinder(canvas.scene.dimensions.maxR / 10); }

  static _instanceVO;

  /**
   * Determine all top, bottom, and mid corners along with midpoints between for the cylinder.
   * Splits the circle into 8 points.
   * @returns {object}
   */
  getInternalPoints() {
    const top = this.topFaces[0].toPolygon3d({ density: 8 })
    const bottom = this.bottomFaces[0].toPolygon3d({ density: 8 })
    return this.constructor.calculatePolygonCylinderInternalPoints(top, bottom);
  }

  /**
   * Get the 2d polygon canvas representation of this shape, usually based on the bottom shape.
   * Assumes no rotation around the x or y axis.
   * @returns {PIXI.Ellipse}
   */
  toPIXIShape() { return this.bottomFaces[0].toEllipse2d(); }
}

/**
 * Extruded (along z-axis) but always a circular top and bottom.
 */
export class CircularCylinderPrimitive extends CylinderPrimitive {

  /**
   * Create the faces for a unit cylinder.
   * @returns {Ellipse3d|Polygon3d[]}
   */
  static createUnitCylinder() {
    const top = Circle3d.fromCenterPoint({ x: 0, y: 0, z: 0.5 }, { radius: 0.5 });
    const bottom = Circle3d.fromCenterPoint({ x: 0, y: 0, z: -0.5 }, { radius: 0.5 });
    top.reverseOrientation();

    // Build the sides.
    top.density = this.DENSITY;
    bottom.density = this.DENSITY;
    return [bottom, top, ...top.buildTopSides(-0.5)];
  }

  /**
   * Get the 2d polygon canvas representation of this shape, usually based on the bottom shape.
   * Assumes no rotation around the x or y axis.
   * @returns {PIXI.Ellipse}
   */
  toPIXIShape() { return this.bottomFaces[0].toCircle2d(); }
}

/**
 * Sphere.
 */
export class SpherePrimitive extends InstancedGeometricPrimitive {

  static prototypeFaces = [new Sphere({ x: 0, y: 0 }, 0.5)];

  static _instanceVO;

  static generateInstanceVertices() {
    const vo = new VertexObject();
    const pts = this.prototypeFaces[0].pointsLattice(10 / canvas.grid.size);
    const tris = Sphere.triangulate(pts)
    vo.vertices = tris.toVertices({ addNormals: true });
    vo.hasNormals = true;
    vo.hasUVs = false;
    vo.condense(vo);
    return vo;
  }

  /**
   * Determine all top, bottom, and mid corners along with midpoints between for the sphere.
   * Uses a icosahedron (12 points) + center.
   * @returns {object}
   */
  getInternalPoints() {
    const center = this.faces[0].center;
    const pts = this.faces[0].pointsLattice({ count: 12 }); // icosahedron

    // A somewhat arbitrary categorization of points.
    return {
      center,
      top: {
        corners: [pts[8], pts[10]],
        mids: [pts[4], pts[6]],
      },
      middle: {
        corners: [pts[0], pts[3]],
        mids: [pts[1], pts[2]],
      },
      bottom: {
        corners: [pts[9], pts[11]],
        mids: [pts[5], pts[7]],
      },
    };
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end) ) return [];

    // If this object is rotated such that the top face is not parallel to XY, cutawayBasicShape will fail.
    const rot = this.modelMatrix.rotation;
    if ( rot.x || rot.y ) return super.verticalSlice(start, end);

    const { center, radius } = this.faces[0];
    using dirXY = PIXI.Point.tmp;
    end.subtract(start, dirXY).normalize(dirXY);

    // Define the normal of the vertical slicing plane.
    const normalXY = PIXI.Point.tmp.set(-dirXY.y, dirXY.x);

    // Calculate the perpendicular distance from the sphere's center to the plane.
    using delta = PIXI.Point.tmp;
    center.to2d(delta).subtract(start, delta);
    const distToPlane = Math.abs(delta.dot(normalXY));

    // Check for intersection
    if ( distToPlane > radius ) return []; // Plane misses sphere entirely.

    // Calculate the radius of the resulting 2d circle.
    // Use Math.max to prevent NaN due to minor floating point inaccuracies if distToPlane === radius.
    const circleRadius = Math.sqrt(Math.max(0, (radius ** 2)- (distToPlane ** 2)));
    if ( circleRadius.almostEqual(0) ) return [];

    // Calculate the center of the 2d circle mapped to the plane's coordinate system.
    const distAlongPlane = delta.dot(dirXY);
    using circleCenter = PIXI.Point.tmp.set(distAlongPlane, center.z);

    // Convert to cutaway.
    // TODO: Add CutawayCircle and CutawayEllipse classes
    const circle = new PIXI.Circle(circleCenter.x, circleCenter.y, circleRadius);
    return [CutawayPolygon.fromCutawayPoints(circle.toPolygon().points, start, end)];
  }

  // ----- NOTE: Debug ----- //

  /**
   * Test whether all faces of this shape face outward as expected.
   * Outward means from an outside viewer, the face is counter-clockwise.
   * @returns {boolean} True if all faces point outward.
   */
  prototypeFacesOutward() {
    using origin = Point3d.tmp.set(0, 0, 0);
    return !this.prototypeFaces[0].isFacing(origin);
  }

  /**
   * Test whether all faces of this shape face outward as expected.
   * Outward means from an outside viewer, the face is counter-clockwise.
   * @returns {boolean} True if all faces point outward.
   */
  facesOutward() {
    return !this.faces[0].isFacing(this.center)
  }
}

