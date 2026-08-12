/* globals
canvas,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { MatrixFloat32 } from "../Matrix.js";
import { almostBetween, cutaway } from "../util.js";
import { Point3d } from "../3d/Point3d.js";
import { getHexagonalShape } from "../placeable_vertices/BasicVertices.js";
import { Polygon3d, Quad3d, Ellipse3d, Triangle3d } from "../3d/Polygon3d.js";
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

  constructor(id) {
    super(id);
  }

  /**
   * Destroy this geometric primitive, releasing associated memory in buffers.
   */
  destroy() {
    this.modelMatrix = null;
    super.destroy();
  }

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
}

/**
 * Single quad.
 * The prototype faces directly up and is centered at the XY origin.
 */
export class QuadPrimitive extends InstancedGeometricPrimitive {

  /** @type {Polygon3d} */
  static prototypeFaces = [QUADS.up.clone()];

  static _instanceVO;

  static CULL_FACES = {
    NONE: 0,
    FRONT: 1, // For the prototype, culls if viewed from above.
    BACK: 2,  // For the prototype, culls if viewed from below.

    // Synonyms
    DOUBLE: 0,
    LEFT: 1,
    RIGHT: 2
  };

  static DIRECTIONAL = true;

  /** @type {enum} */
  direction = 0;

  constructor(id, direction = 0) {
    // TODO: direction could be opts.occlusionFlag if multiple options.
    // In gl.disable(gl.CULL_FACE), corresponds to CULL_NONE = 0, CULL_FRONT = 1, CULL_BACK = 2.
    super(id);
    this.direction = direction;
  }

  // ----- NOTE: Intersection testing ----- //

  /**
   * Determine where a ray hits this object in 3d.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {number} [opts.minT=0]            Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]            Ignore hits later in the segment than this (multiple of rayDirection)
   * @param {CULL_FACES} [opts.direction=CULL_FACES.DOUBLE]
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  rayIntersection(rayOrigin, rayDirection, opts) {
    // Only one face; pass the direction.
    opts.direction ??= this.direction;
    return this.constructor.rayIntersectionForFace(this.faces[0], rayOrigin, rayDirection, opts);
  }

  static rayIntersectionForFace(face, rayOrigin, rayDirection, { minT = 0, maxT = 1, direction = this.CULL_FACES.DOUBLE } = {}) {
    const CF = this.CULL_FACES
    switch ( direction ) {
      case CF.FRONT: if ( face.plane.whichSide(rayOrigin ) > 0 ) return null; break;
      case CF.BACK: if ( face.plane.whichSide(rayOrigin ) < 0 ) return null; break;
      // DOUBLE: facing doesn't matter.
      // Default: treat as DOUBLE.
    }
    const t = face.intersectionT(rayOrigin, rayDirection);
    if ( t !== null && almostBetween(t, minT, maxT) ) return t;
    return null;
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    // If this object is rotated such that the top face is not parallel to XY, cutawayBasicShape will fail.
    const rot = this.modelMatrix.rotation;
    if ( rot.x || rot.y ) return super.verticalSlice(start, end);

    const top = this.faces[0];
    const poly = top.toPlanarPolygon();
    const topZ = top.points[0].z;
    const bottomZ = topZ - 1;

    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };
    return poly.cutaway(start, end, opts);
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
    const topZ = face.points[0].z
    const bottomZ = face.points[1].z;

    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };
    return poly.cutaway(start, end, opts);
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
    const vertices = HorizontalQuadVertices.top;
    vo.hasNormals = true;
    vo.hasUVs = true;
    this.updateVertexObject(vo, vertices);
    return vo;
  }
}

/**
 * Cube, e.g. for a square token.
 */
export class CubePrimitive extends InstancedGeometricPrimitive {

  /**
   * Create the instance face shapes for a unit cube.
   * 1 x 1 x 1 centered at 0,0,0.
   * @returns {Quad3d[]}
   */
  static createUnitCube() {
    const faces = [
      QUADS.up.clone(),
      QUADS.down.clone(),
      QUADS.north.clone(),
      QUADS.west.clone(),
      QUADS.south.clone(),
      QUADS.east.clone(),
    ];

    faces[0].setZ(0.5);
    faces[1].setZ(-0.5);

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
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    // If this object is rotated such that the top face is not parallel to XY, cutawayBasicShape will fail.
    const rot = this.modelMatrix.rotation;
    if ( rot.x || rot.y ) return super.verticalSlice(start, end);
    const top = this.faces[0];
    const bottom = this.faces[1];
    const poly = top.toPlanarPolygon();
    const topZ = top.points[0].z;
    const bottomZ = bottom.points[0].z;

    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };
    return poly.cutaway(poly, start, end, opts);
  }
}

/**
 * Simple extruded (along z-axis) hexagon.
 */
export class HexagonCylinderPrimitive extends InstancedGeometricPrimitive {

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
    const top = Polygon3d.fromPolygon(poly, 0.5);
    const bottom = top.clone();
    bottom.reverseOrientation();
    top.setZ(0.5);
    bottom.setZ(-0.5);
    return [top, bottom, ...top.buildTopSides(-0.5)];
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
    const top = this.faces[0];
    const bottom = this.faces[1];
    return this.constructor.calculatePolygonCylinderInternalPoints(top, bottom);
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    // If this object is rotated such that the top face is not parallel to XY, cutawayBasicShape will fail.
    const rot = this.modelMatrix.rotation;
    if ( rot.x || rot.y ) return super.verticalSlice(start, end);
    const top = this.faces[0];
    const bottom = this.faces[1];
    const poly = top.toPlanarPolygon();
    const topZ = top.points[0].z;
    const bottomZ = bottom.points[0].z;

    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };
    return poly.cutaway(start, end, opts);
  }
}

/**
 * Extruded (along z-axis) cylinder or ellipse
 */
export class CylinderPrimitive extends InstancedGeometricPrimitive {

  /**
   * Create the faces for a unit cylinder.
   * @returns {Ellipse3d|Polygon3d[]}
   */
  static createUnitCylinder(radiusDensity = 100) {
    const top = Ellipse3d.fromCenterPoint({ x: 0, y: 0, z: 0.5 }, { radiusX: 0.5, radiusY: 0.5 });
    const bottom = Ellipse3d.fromCenterPoint({ x: 0, y: 0, z: -0.5 }, { radiusX: 0.5, radiusY: 0.5 });
    bottom.reverseOrientation();
    const density = PIXI.Circle.approximateVertexDensity(radiusDensity);
    return [top, bottom, ...top.buildTopSides(-0.5, { density })];
  }

  static #prototypeFaces;

  static get prototypeFaces() { return this.#prototypeFaces ||= this.createUnitCylinder(canvas.scene.dimensions.maxR / 10); }

  static _instanceVO;

  /**
   * Determine all top, bottom, and mid corners along with midpoints between for the cylinder.
   * Splits the circle into 8 points.
   * @returns {object}
   */
  getInternalPoints() {
    const top = this.faces[0].toPolygon3d({ density: 8 })
    const bottom = this.faces[1].toPolygon3d({ density: 8 })
    return this.constructor.calculatePolygonCylinderInternalPoints(top, bottom);
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    // If this object is rotated such that the top face is not parallel to XY, cutawayBasicShape will fail.
    const rot = this.modelMatrix.rotation;
    if ( rot.x || rot.y ) return super.verticalSlice(start, end);

    const top = this.faces[0];
    const bottom = this.faces[1];
    const ellipse = top.toPlanarEllipse();
    const topZ = top.points[0].z;
    const bottomZ = bottom.points[0].z;

    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };
    return ellipse.cutaway(start, end, opts);
  }
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
    const vertices = tris.toVertices({ addNormals: true });
    vo.hasNormals = true;
    vo.hasUVs = false;
    this.updateVertexObject(vo, vertices);
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
    const circle = new PIXI.Circle(circleCenter.x, circleCenter.y, circleRadius);
    const poly = CutawayPolygon.fromCutawayPoints(circle.toPolygon().points, start, end);

    // Convert to squared distance.
    let i = 0;
    for ( using pt of poly.iteratePoints() ) {
      cutaway.convertFromDistance(pt);
      poly.points[i++] = pt.x;
      poly.points[i++] = pt.y;
    }
    return [poly]; // TODO: Add CutawayCircle class.
  }
}

/**
 * Wedge-shape used for ramps with rectangular bases.
 */
export class WedgeRectangularBasePrimitive extends InstancedGeometricPrimitive {

  static #prototypeFaces; /* eslint-disable-line no-unused-private-class-members */

  static get prototypeFaces() { return (this.#prototypeFaces = this.createUnitWedge()); }

  static _instanceVO;

  static createUnitWedge() {
    // Right-angled isoceles triangle.
    // Centered at 0,0,0 so rotation works.
    // To modify the angle requires translation to/from.
    const faces = [];
    using a = Point3d.tmp;
    using b = Point3d.tmp;
    using c = Point3d.tmp;
    using d = Point3d.tmp;
    const min = -0.5;
    const max = 0.5;

    // Base is a square centered at 0,0, elevation at -0.5.
    const down = QUADS.down.clone();
    down.translate({ z: min });
    faces.push(down);

    // Back is a quad.
    // Back is at x = 0.5
    const back = QUADS.east.clone();
    back.translate({ x: max });
    faces.push(back);

    // Sides are triangles. From base to top of back.
    faces.push(Triangle3d.from3Points(
      a.set(min, max, min),
      b.set(max, max, min),
      c.set(max, max, max),
    ));
    faces.push(Triangle3d.from3Points(
      a.set(max, min, max),
      b.set(max, min, min),
      c.set(min, min, min),
    ));

    // Ramp is a quad. From base to top of back.
    faces.push(Quad3d.from3Points(
      a.set(min, min, min),
      b.set(min, max, min),
      c.set(max, max, max),
      d.set(max, min, max),
    ));

    return faces;
  }

  // Height as a percentage of the base.
  #rampPercentageHeight = 1;

  get rampPercentageHeight() { return this.#rampPercentageHeight; }

  set rampPercentageHeight(value) {
    if ( this.#rampPercentageHeight === value ) return;

    const transformM = this.modelMatrix.transformM;
    using translateM = MatrixFloat32.translation({ x: -0.5, z: 0.5 });
    using scaleM = MatrixFloat32.scale({ z: value });
    using invTranslateM = translateM.invert();
    translateM
      .multiply4x4(scaleM, transformM)
      .multiply4x4(invTranslateM, transformM);
  }
}




