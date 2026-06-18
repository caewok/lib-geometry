/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Hex3dVertices } from "../placeable_vertices/BasicVertices.js";
import { ConstrainedTokenBorder } from "../ConstrainedTokenBorder.js";

// Mixing
import { mix } from "../mixwith.js";
import {
  PlaceableGeometry,
  PlaceableAABBMixin,
  PlaceableModelMatrixMixin,
  PlaceableFacesMixin,
  PlaceableFacePointsMixin,
  PlaceableVerticesMixin,
} from "./PlaceableGeometry.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Quad3d, Polygon3d, Ellipse3d } from "../3d/Polygon3d.js";
import { Point3d } from "../3d/Point3d.js";
import { Sphere } from "../3d/Sphere.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";

/**
 * Build a polygon cube for a token.
 */
function buildPolygonCube(poly2d, topZ, bottomZ, faces) {
  faces.length = 2;
  const [top, bottom] = faces;
  Polygon3d.fromPolygon(poly2d, topZ, top);
  Polygon3d.fromPolygon(poly2d, bottomZ, bottom).reverseOrientation();
  faces.push(...top.buildTopSides(bottomZ));
  return faces;
}

const TRACKER_TYPES = {
  shape: [
    "shape",
  ],
  level: ["level"],
  position: [
    "x",
    "y",
  ],
  elevation: ["elevation"],
  scale: [
    "width",
    "height"
  ],

  disposition: [
    "disposition",
  ],
};

/**
 * @typedef {function} TokenConstrainedFacesMixin
 *
 * Add faces for the constrained token shape.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
const TokenConstrainedFacesMixin = superclass => class extends superclass {

  #wallsID = -1;

  get isConstrained() { return this.token.isConstrainedTokenBorder; }

  _constrainedFaces = [
    new Polygon3d(),
    new Polygon3d(),
    // Sides to be added later.
  ];

  get constrainedFaces() {
    if ( this.isConstrained ) {
      if ( this.#wallsID < ConstrainedTokenBorder._wallsID ) this.updateConstrainedFaces();
      return this._constrainedFaces;
    }
    return this.faces;
  }

  /**
   * Iterate over the faces.
   */
  *iterateConstrainedFaces() { yield* this.constrainedFaces.values(); }

  _updateFaces() {
    this.updateConstrainedFaces();
    super._updateFaces();
  }

  updateConstrainedFaces() {
    if ( !this.isConstrained ) return;
    const SPACER = this.constructor.SPACER;
    const token = this.token;
    const poly = token.constrainedTokenBorder.toPolygon();
    buildPolygonCube(poly, token.topZ - SPACER, token.bottomZ + SPACER, this._constrainedFaces);
    this.#wallsID = ConstrainedTokenBorder._wallsID;
  }

  // ----- NOTE: Vertices -----

  constrainedVertexObject = {
    // No instance vertices.
    model: {
      withNormals: new VertexObject(),
      withoutNormals: new VertexObject(),
    },
  };

  _updateModelVertices() {
    super._updateModelVertices();

    // Update using faces.
    const { withNormals, withoutNormals } = this.constrainedVertexObject.model;
    const vertices = this.constructor.verticesFromFaces(this._constrainedFaces, false);
    this.constructor.updateVertexObject(withoutNormals, vertices);

    const verticesN = this.constructor.verticesFromFaces(this._constrainedFaces, true);
    this.constructor.updateVertexObject(withNormals, verticesN);
  }
}

/**
 * @typedef {function} TokenConstrainedLitFacesMixin
 *
 * Add faces for a constrained token shape.
 * Ignored otherwise.
 * Requires matrices.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
const TokenConstrainedLitFacesMixin = superclass => class extends superclass {

  get isLit() { return Boolean(this.token.litTokenBorder); }

  get isConstrainedLit() { return !this.token.constrainedTokenBorder.equals(this.token.litTokenBorder); }

  #wallsID = -1;

  #lightsID = -1;

  _constrainedLitFaces = [
    new Polygon3d(),
    new Polygon3d(),
    // Sides to be added later.
  ];

  get constrainedLitFaces() {
    if ( this.isConstrainedLit ) {
      if ( this.#wallsID < ConstrainedTokenBorder._wallsID
        || this.#lightsID < ConstrainedTokenBorder._lightsID  ) this.updateConstrainedLitFaces();
      return this._constrainedLitFaces;
    }
    return this.faces;
  }

  /**
   * Iterate over the faces.
   */
  *iterateConstrainedLitFaces() {
    yield* this.constrainedLitFaces.values();
  }

  _updateFaces() {
    super._updateFaces();
    this.updateConstrainedLitFaces();
  }

  updateConstrainedLitFaces() {
    if ( !this.isLit ) return;
    const SPACER = this.constructor.SPACER;
    const token = this.token;
    const poly = token.litTokenBorder.toPolygon();
    buildPolygonCube(poly, token.topZ - SPACER, token.bottomZ + SPACER, this._constrainedLitFaces);
    this.#wallsID = ConstrainedTokenBorder._wallsID;
    this.#lightsID = ConstrainedTokenBorder._lightsID;
  }

  // ----- NOTE: Vertices -----

  constrainedLitVertexObject = {
    // No instance vertices.
    model: {
      withNormals: new VertexObject(),
      withoutNormals: new VertexObject(),
    },
  };

  _updateModelVertices() {
    super._updateModelVertices();

    // Update using faces.
    const { withNormals, withoutNormals } = this.constrainedLitVertexObject.model;
    const vertices = this.constructor.verticesFromFaces(this._constrainedLitFaces, false);
    this.constructor.updateVertexObject(withoutNormals, vertices);

    const verticesN = this.constructor.verticesFromFaces(this._constrainedLitFaces, true);
    this.constructor.updateVertexObject(withNormals, verticesN);
  }
}

/**
 * @typedef {function} TokenConstrainedBrightLitFacesMixin
 *
 * Add faces for this placeable class.
 * Requires matrices.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
const TokenConstrainedBrightLitFacesMixin = superclass => class extends superclass {

  get isBrightLit() { return Boolean(this.token.brightLitTokenBorder); }

  get isConstrainedBrightLit() { return !this.token.constrainedTokenBorder.equals(this.token.brightLitTokenBorder); }

  #wallsID = -1;

  #lightsID = -1;

  _constrainedBrightLitFaces = [
    new Polygon3d(),
    new Polygon3d(),
    // Sides to be added later.
  ];

  get constrainedBrightLitFaces() {
    if ( this.isConstrainedBrightLit ) {
      if ( this.#wallsID < ConstrainedTokenBorder._wallsID
        || this.#lightsID < ConstrainedTokenBorder._lightsID  ) this.updateConstrainedBrightLitFaces();
      return this._constrainedBrightLitFaces;
    }
    return this.faces;
  }

  /**
   * Iterate over the faces.
   */
  *iterateConstrainedBrightLitFaces() { yield* this.constrainedBrightLitFaces.values(); }

  _updateFaces() {
    super._updateFaces();
    this.updateConstrainedBrightLitFaces();
  }

  updateConstrainedBrightLitFaces() {
    if ( !this.isBrightLit ) return;
    const SPACER = this.constructor.SPACER;
    const token = this.token;
    const poly = token.brightLitTokenBorder.toPolygon();
    buildPolygonCube(poly, token.topZ - SPACER, token.bottomZ + SPACER, this._constrainedBrightLitFaces);
    this.#wallsID = ConstrainedTokenBorder._wallsID;
    this.#lightsID = ConstrainedTokenBorder._lightsID;
  }

  // ----- NOTE: Vertices -----

  constrainedBrightVertexObject = {
    // No instance vertices.
    model: {
      withNormals: new VertexObject(),
      withoutNormals: new VertexObject(),
    },
  };

  _updateModelVertices() {
    super._updateModelVertices();

    // Update using faces.
    const { withNormals, withoutNormals } = this.constrainedBrightVertexObject.model;
    const vertices = this.constructor.verticesFromFaces(this._constrainedBrightLitFaces, false);
    this.constructor.updateVertexObject(withoutNormals, vertices);

    const verticesN = this.constructor.verticesFromFaces(this._constrainedBrightLitFaces, true);
    this.constructor.updateVertexObject(withNormals, verticesN);
  }
}

/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class TokenGeometry extends mix(PlaceableGeometry).with(
  TokenConstrainedBrightLitFacesMixin, TokenConstrainedLitFacesMixin, TokenConstrainedFacesMixin,
  PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin, PlaceableFacePointsMixin, PlaceableVerticesMixin) {

  /** @type {string} */
  static PLACEABLE_NAME = "Token";

  /** @type {string} */
  static layer = "tokens";

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set([...TRACKER_TYPES.shape, ...TRACKER_TYPES.disposition]),
    level: new Set(TRACKER_TYPES.level),
    position: new Set(TRACKER_TYPES.position),
    elevation: new Set(TRACKER_TYPES.elevation),
    scale: new Set(TRACKER_TYPES.scale),
  };

  /** @type {enum<string:number>} */
  static SHAPE_TYPES = {
    CUBE: 0, 					// Square grid
    HEXAGONAL: 1, 		// Hex grid; extruded hex in 3d; varies by token size
    ELLIPSE: 2,				// Extruded ellipse
    SPHERICAL: 3,
    ELLIPSOID: 4,
  };

  /** @type {Token} */
  get token() { return this.placeableDocument.object; }

  /** @type {SHAPE_TYPES} */
  get shapeType() {
    const TYPES = this.constructor.SHAPE_TYPES;
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenEllipsoid ) return TYPES.ELLIPSOID;
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) return TYPES.SPHERICAL;

    const GRID = CONST.GRID_TYPES;
    switch ( canvas.grid.type ) {
      case GRID.SQUARE: return TYPES.CUBE;
      case GRID.GRIDLESS: {
        const shape = this.token.document.shape;
        if ( shape === CONST.TOKEN_SHAPES.ELLIPSE_1
          || shape === CONST.TOKEN_SHAPES.ELLIPSE_2 ) return TYPES.ELLIPSE;
        else return TYPES.CUBE;
      }
      default: return TYPES.HEXAGONAL;
    }
  }

  // ----- NOTE: AABB ----- //

  calculateAABB() { return AABB3d.fromTokenDocument(this.placeableDocument, this.aabb); }

  // ----- NOTE: Matrices ---- //

  calculateTranslationMatrix() {
    const mat = super.calculateTranslationMatrix();
    const ctr = this.constructor.tokenCenter(this.placeableDocument); // Translate from 3d center of token.
    return MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, mat);
  }

  // Not tracking rotation b/c the token shape is fixed for purposes of LOS and collision testing.

  calculateScaleMatrix() {
    const mat = super.calculateScaleMatrix();
    const { width, height, zHeight } = this.constructor.tokenDimensions(this.placeableDocument);
    return MatrixFloat32.scale(width, height, zHeight, mat);
  }

  // ----- NOTE: Faces ----- //

  #initializeSphericalTopFace() {
    this._prototypeFaces.length = 1;
    if ( !(this._prototypeFaces[0] instanceof Sphere) )  this._prototypeFaces[0] = new Sphere();
    this._prototypeFaces[0].radius = 0.5;
  }

  #initializeEllipseFaces() {
    this._prototypeFaces.length = 2;
    if ( !(this._prototypeFaces[0] instanceof Ellipse3d) ) {
      this._prototypeFaces[0] = new Ellipse3d();
      this._prototypeFaces[1] = new Ellipse3d();
    }
    const [top, bottom] = this._prototypeFaces;
    top.radiusX = 0.5;
    bottom.radiusY = 0.5;

    top.radiusX = 0.5;
    bottom.radiusY = 0.5;

    // Default ellipse points up; set up the rest.
    const density = PIXI.Circle.approximateVertexDensity(100);
    this.#initializePolyFaces(density);
  }

  get hexagonalUnitShape() { return Hex3dVertices.hexagonalUnitShapeForToken(this.token); }

  #initializeHexagonalFaces() {


    if ( !(this._prototypeFaces[0] instanceof Polygon3d) ) {
      this._prototypeFaces[0] = new Polygon3d();
      this._prototypeFaces[1] = new Polygon3d();
    }
    const poly = this.hexagonalUnitShape;

    // Ensure the top is pointing up by passing a counter-clockwise polygon.
    if ( poly.isPositive ) poly.reverseOrientation();
    Polygon3d.fromPolygon(poly, 0.5, this._prototypeFaces[0]);
    this.#initializePolyFaces();
  }

  #initializePolyFaces(density) {
    // Assumed here that the top face is pointing up and is correctly set.
    this._prototypeFaces.length = 2;
    const top = this._prototypeFaces[0];
    const bottom = this._prototypeFaces[1];

    top.clone(bottom);
    bottom.reverseOrientation();
    top.setZ(0.5);
    bottom.setZ(-0.5);
    this._prototypeFaces.push(...top.buildTopSides(-0.5, { density }));
  }

  #initializeCubeFaces() {
    this._prototypeFaces.length = 2;

    if ( !(this._prototypeFaces[0] instanceof Quad3d) ) {
      this._prototypeFaces[0] = new Quad3d();
      this._prototypeFaces[1] = new Quad3d();
    }

    // Build top/bottom.
    const [top, bottom] = this._prototypeFaces;
    this.constructor.QUADS.up.clone(top);
    this.constructor.QUADS.down.clone(bottom);
    top.setZ(0.5);
    bottom.setZ(-0.5);

    // Build sides.
    const north = this.constructor.QUADS.north.clone();
    const west = this.constructor.QUADS.west.clone();
    const south = this.constructor.QUADS.south.clone();
    const east = this.constructor.QUADS.east.clone();
    this._prototypeFaces.push(north, west, south, east);

    // Adjust the sides so that they are at the token edge.
    for ( let i = 0; i < 4; i += 1 ) {
      north.points[i].y = -0.5; // North.
      west.points[i].x = -0.5; // West.
      south.points[i].y = 0.5; // South.
      east.points[i].x = 0.5; // East.
    }
  }

  /**
   * Create the initial face shapes for this token, using a 0.5 x 0.5 x 0.5 unit cube.
   */
  _initializePrototypeFaces() {
    const TYPES = this.constructor.SHAPE_TYPES;
    switch ( this.shapeType ) {
      case TYPES.SPHERICAL:
      case TYPES.ELLIPSOID: // TODO: Implement.
        this.#initializeSphericalTopFace();
        return super._initializePrototypeFaces();

      case TYPES.CUBE: this.#initializeCubeFaces(); break;
      case TYPES.ELLIPSE: this.#initializeEllipseFaces(); break;
      case TYPES.HEXAGONAL: this.#initializeHexagonalFaces(); break;
      default: this.#initializeCubeFaces();
    }

    // Confirm orientation against the origin.
    const ctr = new Point3d();
    const top = this._prototypeFaces[0];
    const bottom = this._prototypeFaces[1];
    if ( top.isFacing(ctr) ) console.error(`${this.constructor.name}|Prototype face for ${this.placeable.id} has wrong top orientation.`);
    if ( bottom.isFacing(ctr) ) console.error(`${this.constructor.name}|Prototype face for ${this.placeable.id} has wrong bottom orientation.`);
    for ( let i = 2, iMax = this._prototypeFaces.length; i < iMax; i += 1 ) {
      const side = this._prototypeFaces[i];
      if ( side.isFacing(ctr) ) console.error(`${this.constructor.name}|Prototype face for ${this.placeable.id} has wrong side orientation.`);
    }

    super._initializePrototypeFaces()
  }

  /**
   * Determine where a ray hits this object in 3d.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {"constrained"|"lit"|"bright"|"normal"} [type="constrained"]      What group of faces to use?
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  rayIntersection(rayOrigin, rayDirection, { type = "constrained", ...opts } = {}) {
    let faces;
    switch ( type ) {
      case "constrained": faces = this.iterateConstrainedFaces(); break;
      case "lit": faces = this.iterateConstrainedLitFaces(); break;
      case "bright": faces = this.iterateConstrainedBrightLitFaces(); break;
      default: faces = this.iterateFaces();
    }
    for ( const face of faces ) {
      const t = this.constructor.rayIntersectionForFace(face, rayOrigin, rayDirection, opts);
      if ( t !== null ) return t;
    }
    return null;
  }

  // ----- NOTE: Token properties ----- //

  static SPACER = 2; // Shrink tokens slightly to avoid z-fighting with walls and tiles.

  /**
   * Determine the token 3d dimensions, in pixel units.
   * @param {TokenDocument} tokenD
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} zHeight     In z direction
   */
  static tokenDimensions(tokenD) {
    const { width, height } = tokenD; // Multiplier, e.g. 1, 2, or 3.
    const zHeight = tokenD.verticalHeightZ;
    return {
      width: (width * canvas.dimensions.size) - this.SPACER,
      height: (height * canvas.dimensions.size) - this.SPACER,
      zHeight: zHeight - this.SPACER,
    };
  }

  /**
   * Determine the token center, in pixel units.
   * @param {TokenDocument} tokenD
   * @returns {Point3d}
   * @prop {number} x       In x direction
   * @prop {number} y      In y direction
   * @prop {number} z     In z direction
   */
  static tokenCenter(tokenD) {
    const { x, y, topZ, bottomZ } = tokenD;
    const { width, height } = tokenD.getSize();
    const z = bottomZ + ((topZ - bottomZ) * 0.5);
    return Point3d.tmp.set(x + (width * 0.5), y + (height * 0.5), z);
  }
}
