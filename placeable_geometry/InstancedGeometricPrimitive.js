/* globals
canvas,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive, GeometricModelMatrix } from "./GeometricPrimitive.js";
import { MatrixFloat32 } from "../Matrix.js";
import { FixedLengthTrackingBuffer } from "../placeable_tracking/TrackingBuffer.js";
import { almostBetween } from "../util.js";
import { Point3d } from "../3d/Point3d.js";
import { getHexagonalShape } from "../placeable_vertices/BasicVertices.js";
import { Polygon3d, Quad3d, Ellipse3d, Triangle3d } from "../3d/Polygon3d.js";
import { Sphere } from "../3d/Sphere.js";
import { HorizontalQuadVertices } from "../placeable_vertices/BasicVertices.js";

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
  _destroy() {
    this.constructor.modelMatrixTracker.deleteFacet(this.id);
    this.modelMatrix = null;
  }

  // ----- NOTE: Model Matrix ----- //

  get modelTrackerIndex() { return this.constructor.modelMatrixTracker.facetIdMap.get(this.id); }

  _initializeModel() {
    this.modelMatrix = new GeometricModelMatrix(this.id, this.constructor.modelMatrixTracker);
  }


  /**
   * Each defined primitive will have its own buffer of matrices.
   * Store the entire model matrix as a single typed array.
   * Each 16-element matrix (per placeable) is accessed using an id.
   * Defaults to identity.
   * @type {FixedLengthTrackingBuffer}
   */
  // Must be defined by the child class so that each class has a separate model buffer.
  // static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  // ----- NOTE: FACES ----- //

  /** @type {Polygon3d} */
  static prototypeFaces = [] // Defined by child class.

  get prototypeFaces() { return this.constructor.prototypeFaces; }
}

/**
 * Single quad.
 * The prototype faces directly up and is centered at the XY origin.
 */
export class QuadPrimitive extends InstancedGeometricPrimitive {

  static modelMatrixTracker = new FixedLengthTrackingBuffer({ facetLengths: 16, numFacets: 0, type: Float32Array });

  /** @type {Polygon3d} */
  static prototypeFaces = [QUADS.up.clone()];

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

  static rayIntersectionForFace(face, rayOrigin, rayDirection, { minT = 0, maxT = 1, direction = this.constructor.CULL_FACES.DOUBLE } = {}) {
    const CF = this.constructor.CULL_FACES
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
}

/**
 * Helper class to deal with vertical walls.
 */
export class VerticalQuadPrimitive extends QuadPrimitive {

  // Does not define the modelMatrixTracker so will share parent's.

  static prototypeFaces = [QUADS.north.clone()];

  setDims({ lengthXY, zHeight } = {}) {
    // For the horizontal quad (before rotation), length is the x-axis, height is z-axis.
    // Set y scale to 1 to avoid collapsing the matrix.
    using dims = Point3d.tmp.set(lengthXY, 1, zHeight);
    this.setScale(dims);
  }
}

/**
 * Quad that includes a texture. (E.g., for tiles)
 * Separate from QuadPrimitive b/c the instance includes UVs.
 */
export class TexturedQuadPrimitive extends QuadPrimitive {

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  static TEXTURED = true;

  textureURL = "";

  static alphaThresholdTracker = new FixedLengthTrackingBuffer({ facetLengths: 1, numFacets: 0, type: Float32Array });

  get alphaThreshold() {
    return this.constructor.alphaThresholdTracker.viewFacetAtIndex(this.modelTrackerIndex)[0];
  }

  set alphaThreshold(value) {
    const arr = this.constructor.alphaThresholdTracker.viewFacetAtIndex(this.modelTrackerIndex);
    arr.set(value);
  }

  /**
   * Update instance vertices.
   * Default approach uses the prototype faces.
   */
  static updateInstanceVertices() {
    // Add vertices from faces.
    const vo = this.instanceVO ;
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

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

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

  // Internal points follow the AABB.
}

/**
 * Simple extruded (along z-axis) hexagon.
 */
export class HexagonCylinderPrimitive extends InstancedGeometricPrimitive {

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

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

  static #prototypeFaces;

  static get prototypeFaces() { return (this.#prototypeFaces = this.createUnitHexagonCylinder()); }

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
}

/**
 * Extruded (along z-axis) cylinder or ellipse
 */
export class CylinderPrimitive extends InstancedGeometricPrimitive {

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

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
}

/**
 * Sphere.
 */
export class SpherePrimitive extends InstancedGeometricPrimitive {

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  static prototypeFaces = [new Sphere({ x: 0, y: 0 }, 0.5)];

  static updateInstanceVertices() {
    const vo = this.instanceVO;
    const pts = this.prototypeFaces[0].pointsLattice(10 / canvas.grid.size);
    const tris = Sphere.triangulateSphereSurface(pts)
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
}

/**
 * Wedge-shape used for ramps with rectangular bases.
 */
export class WedgeRectangularBasePrimitive extends InstancedGeometricPrimitive {

  static modelMatrixTracker = new FixedLengthTrackingBuffer( { facetLengths: 16, numFacets: 0, type: Float32Array });

  static #prototypeFaces;

  static get prototypeFaces() { return (this.#prototypeFaces = this.createUnitWedge()); }

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

  initialize() {
    super.initialize();
    this.modelMatrix = new GeometricModelMatrix(this.id, this.constructor.modelMatrixTracker);
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




