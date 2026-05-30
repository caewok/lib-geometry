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
} from "./PlaceableGeometry.js";

// LibGeometry
import { NULL_SET } from "../util.js";
import { GEOMETRY_LIB_ID } from "../const.js";
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Quad3d, Polygon3d, Ellipse3d } from "../3d/Polygon3d.js";
import { Point3d } from "../3d/Point3d.js";
import { Sphere } from "../3d/Sphere.js";

/**
 * Build a polygon cube for a token.
 */
function buildPolygonCube(poly2d, topZ, bottomZ, faces) {
  Polygon3d.fromPolygon(poly2d, topZ, faces.top);
  Polygon3d.fromPolygon(poly2d, bottomZ, faces.bottom).reverseOrientation();
  faces.sides = faces.top.buildTopSides(bottomZ);
  return faces;
}

const TRACKER_TYPES = {
  position: [
    "x",
    "y",
    "elevation",
  ],
  scale: [
    "width",
    "height"
  ],
  shape: [
    "shape",
  ],
  disposition: [
    "disposition",
  ],
  refresh: [
    "refreshPosition",
    "refreshElevation",
  ]
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

  _constrainedFaces = {
    top: new Polygon3d(),
    bottom: new Polygon3d(),
    sides: [],
  };

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
  *iterateConstrainedFaces() {
    const faces = this.constrainedFaces;
    yield faces.top;
    yield faces.bottom;
    for ( const side of faces.sides ) yield side;
  }

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

  _constrainedLitFaces = {
    top: new Polygon3d(),
    bottom: new Polygon3d(),
    sides: [],
  };

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
    const faces = this.constrainedLitFaces;
    yield faces.top;
    yield faces.bottom;
    for ( const side of faces.sides ) yield side;
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

  _constrainedBrightLitFaces = {
    top: new Polygon3d(),
    bottom: new Polygon3d(),
    sides: [],
  };

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
  *iterateConstrainedBrightLitFaces() {
    const faces = this.constrainedBrightLitFaces;
    yield faces.top;
    yield faces.bottom;
    for ( const side of faces.sides ) yield side;
  }

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
}

/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class TokenGeometry extends mix(PlaceableGeometry).with(
  TokenConstrainedBrightLitFacesMixin, TokenConstrainedLitFacesMixin, TokenConstrainedFacesMixin,
  PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin, PlaceableFacePointsMixin) {
  /** @type {string} */
  static PLACEABLE_NAME = "Token";

  /** @type {string} */
  static layer = "tokens";

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    position: new Set([...TRACKER_TYPES.position, ...TRACKER_TYPES.refresh]),
    scale: new Set(TRACKER_TYPES.scale),
    rotation: NULL_SET,
    shape: new Set(TRACKER_TYPES.shape),
    properties: NULL_SET,
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
  get token() { return this.placeable; }

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

  calculateAABB() { return AABB3d.fromToken(this.token, this.aabb); }

  // ----- NOTE: Matrices ---- //

  calculateTranslationMatrix() {
    const mat = super.calculateTranslationMatrix();
    const ctr = this.constructor.tokenCenter(this.token); // Translate from 3d center of token.
    return MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, mat);
  }

  // Not tracking rotation b/c the token shape is fixed for purposes of LOS and collision testing.

  calculateScaleMatrix() {
    const mat = super.calculateScaleMatrix();
    const { width, height, zHeight } = this.constructor.tokenDimensions(this.token);
    return MatrixFloat32.scale(width, height, zHeight, mat);
  }

  // ----- NOTE: Faces ----- //

  #initializeSphericalTopFace() {
    if ( !(this._prototypeFaces.top instanceof Sphere) )  this._prototypeFaces.top = new Sphere();
    this._prototypeFaces.top.radius = 0.5;
    this._prototypeFaces.bottom = null;
    this._prototypeFaces.sides.length = 0;
  }

  #initializeEllipseFaces() {
    if ( !(this._prototypeFaces.top instanceof Ellipse3d) ) {
      this._prototypeFaces.top = new Ellipse3d();
      this._prototypeFaces.bottom = new Ellipse3d();
    }
    this._prototypeFaces.top.radiusX = 0.5;
    this._prototypeFaces.top.radiusY = 0.5;

    // Default ellipse points up; set up the rest.
    const density = PIXI.Circle.approximateVertexDensity(100);
    this.#initializePolyFaces(density);
  }
  
  get hexagonalUnitShape() { return Hex3dVertices.hexagonalUnitShapeForToken(this.token); }

  #initializeHexagonalFaces() {
    if ( !(this._prototypeFaces.top instanceof Polygon3d) ) {
      this._prototypeFaces.top = new Polygon3d();
      this._prototypeFaces.bottom = new Polygon3d();
    }
    const poly = this.hexagonalUnitShape;

    // Ensure the top is pointing up by passing a counter-clockwise polygon.
    if ( poly.isPositive ) poly.reverseOrientation();
    Polygon3d.fromPolygon(poly, 0.5, this._prototypeFaces.top);
    this.#initializePolyFaces();
  }

  #initializePolyFaces(density) {
    // Assumed here that the top face is pointing up and is correctly set.
    this._prototypeFaces.top.clone(this._prototypeFaces.bottom);
    this._prototypeFaces.bottom.reverseOrientation();
    this._prototypeFaces.top.setZ(0.5);
    this._prototypeFaces.bottom.setZ(-0.5);
    this._prototypeFaces.sides = this._prototypeFaces.top.buildTopSides(-0.5, { density });
  }

  #initializeCubeFaces() {
    if ( !(this._prototypeFaces.top instanceof Quad3d) ) {
      this._prototypeFaces.top = new Quad3d();
      this._prototypeFaces.bottom = new Quad3d();
    }

    // Build top/bottom.
    this.constructor.QUADS.up.clone(this._prototypeFaces.top);
    this.constructor.QUADS.down.clone(this._prototypeFaces.bottom);
    this._prototypeFaces.top.setZ(0.5);
    this._prototypeFaces.bottom.setZ(-0.5);

    // Build sides.
    this._prototypeFaces.sides.length = 0;
    this._prototypeFaces.sides.push(
      this.constructor.QUADS.north.clone(),
      this.constructor.QUADS.west.clone(),
      this.constructor.QUADS.south.clone(),
      this.constructor.QUADS.east.clone(),
    );

    // Adjust the sides so that they are at the token edge.
    for ( let i = 0; i < 4; i += 1 ) {
      this._prototypeFaces.sides[0].points[i].y = -0.5; // North.
      this._prototypeFaces.sides[1].points[i].x = -0.5; // West.
      this._prototypeFaces.sides[2].points[i].y = 0.5; // South.
      this._prototypeFaces.sides[3].points[i].x = 0.5; // East.
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
    if ( this._prototypeFaces.top.isFacing(ctr) ) console.error(`${this.constructor.name}|Prototype face for ${this.placeable.id} has wrong top orientation.`);
    if ( this._prototypeFaces.bottom && this._prototypeFaces.bottom.isFacing(ctr) ) console.error(`${this.constructor.name}|Prototype face for ${this.placeable.id} has wrong bottom orientation.`);
    for ( const side of this._prototypeFaces.sides ) {
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
   * @param {Token} token
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} zHeight     In z direction
   */
  static tokenDimensions(token) {
    const { width, height } = token.document; // Multiplier, e.g. 1, 2, or 3.
    const zHeight = token.topZ - token.bottomZ;
    return {
      width: (width * canvas.dimensions.size) - this.SPACER,
      height: (height * canvas.dimensions.size) - this.SPACER,
      zHeight: zHeight - this.SPACER,
    };
  }

  /**
   * Determine the token center, in pixel units.
   * @param {Token} token
   * @returns {Point3d}
   * @prop {number} x       In x direction
   * @prop {number} y      In y direction
   * @prop {number} z     In z direction
   */
  static tokenCenter(token) {
    return Point3d.fromTokenCenter(token);
  }
}

/**
 * Track faces for a token constrained border.
 * Not worth tracking AABB, and the model matrix remains the same.
 */

