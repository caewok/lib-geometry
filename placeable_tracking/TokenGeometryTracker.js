/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Trackers
import { TokenPositionTracker, TokenScaleTracker, TokenShapeTracker } from "./TokenTracker.js";

// Mixing
import { mix } from "../mixwith.js";
import {
  PlaceableGeometryTracker,
  PlaceableAABBMixin,
  PlaceableModelMatrixMixin,
  PlaceableFacesMixin
} from "./AbstractPlaceableGeometryTracker.js";

// LibGeometry
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

/**
 * @typedef {function} TokenConstrainedFacesMixin
 *
 * Add faces for the constrained token shape.
 * Also adds rayIntersection testing method.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
const TokenConstrainedFacesMixin = superclass => class extends superclass {

  get isConstrained() { return this.token.isConstrainedTokenBorder; }

  _constrainedFaces = {
    top: new Polygon3d(),
    bottom: new Polygon3d(),
    sides: [],
  };

  get constrainedFaces() {
    return this.isConstrained ? this._constrainedFaces : this.faces;
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

  _placeableUpdated() {
    super._placeableUpdated();
    this.updateConstrainedFaces();
  }

  updateConstrainedFaces() {
    if ( !this.isConstrained ) return;
    const SPACER = this.constructor.SPACER;
    const token = this.token;
    const poly = token.constrainedTokenBorder.toPolygon();
    buildPolygonCube(poly, token.topZ * SPACER, token.bottomZ * SPACER, this._constrainedFaces);
  }

  rayIntersectionConstrained(rayOrigin, rayDirection, opts) {
    return this.constructor.rayIntersectionForFaces(this.iterateConstrainedFaces(), rayOrigin, rayDirection, opts);
  }
}

/**
 * @typedef {function} TokenConstrainedLitFacesMixin
 *
 * Add faces for a constrained token shape.
 * Ignored otherwise.
 * Also adds rayIntersection testing method.
 * Requires matrices.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
const TokenConstrainedLitFacesMixin = superclass => class extends superclass {

  get isLit() { return Boolean(this.token.litTokenBorder); }

  get isConstrainedLit() { return !this.token.constrainedTokenBorder.equals(this.token.litTokenBorder); }

  _constrainedLitFaces = {
    top: new Polygon3d(),
    bottom: new Polygon3d(),
    sides: [],
  };

  get constrainedLitFaces() {
    return this.isConstrainedLit ? this._constrainedLitFaces : this.faces;
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

  _placeableUpdated() {
    super._placeableUpdated();
    this.updateConstrainedLitFaces();
  }

  updateConstrainedLitFaces() {
    if ( !this.isLit ) return;
    const SPACER = this.constructor.SPACER;
    const token = this.token;
    const poly = token.litTokenBorder.toPolygon();
    buildPolygonCube(poly, token.topZ * SPACER, token.bottomZ * SPACER, this._constrainedLitFaces);
  }

  rayIntersectionLit(rayOrigin, rayDirection, opts) {
    return this.constructor.rayIntersectionForFaces(this.iterateConstrainedLitFaces(), rayOrigin, rayDirection, opts);
  }
}

/**
 * @typedef {function} PlaceableFacesMixin
 *
 * Add faces for this placeable class.
 * Also adds rayIntersection testing method.
 * Requires matrices.
 * @param {function} superclass
 * @returns {function} A subclass of `superclass.`
 */
const TokenConstrainedBrightLitFacesMixin = superclass => class extends superclass {

  get isBrightLit() { return Boolean(this.token.brightLitTokenBorder); }

  get isConstrainedBrightLit() { return !this.token.constrainedTokenBorder.equals(this.token.brightLitTokenBorder); }

  _constrainedBrightLitFaces = {
    top: new Polygon3d(),
    bottom: new Polygon3d(),
    sides: [],
  };

  get constrainedBrightLitFaces() {
    return this.isConstrainedBrightLit ? this._constrainedBrightLitFaces : this.faces;
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

  _placeableUpdated() {
    super._placeableUpdated();
    this.updateConstrainedBrightLitFaces();
  }

  updateConstrainedBrightLitFaces() {
    if ( !this.isBrightLit ) return;
    const SPACER = this.constructor.SPACER;
    const token = this.token;
    const poly = token.brightLitTokenBorder.toPolygon();
    buildPolygonCube(poly, token.topZ * SPACER, token.bottomZ * SPACER, this._constrainedBrightLitFaces);
  }

  rayIntersectionBrightLit(rayOrigin, rayDirection, opts) {
    return this.constructor.rayIntersectionForFaces(this.iterateConstrainedBrightLitFaces(), rayOrigin, rayDirection, opts);
  }
}

/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> AbstractPlaceableGeometryTracker
 */
export class TokenGeometryTracker extends mix(PlaceableGeometryTracker).with(
  TokenConstrainedBrightLitFacesMixin, TokenConstrainedLitFacesMixin, TokenConstrainedFacesMixin,
  PlaceableAABBMixin, PlaceableModelMatrixMixin, PlaceableFacesMixin) {
  /** @type {string} */
  static PLACEABLE_NAME = "Token";

  /** @type {string} */
  static layer = "tokens";

  /** @type {TrackerKeys} */
  static TRACKERS = {
    shape: TokenShapeTracker,
    position: TokenPositionTracker,
    scale: TokenScaleTracker,
  };

  get token() { return this.placeable; }

  // ----- NOTE: AABB ----- //

  calculateAABB() { return AABB3d.fromToken(this.token, this.aabb); }

  // ----- NOTE: Matrices ---- //

  calculateTranslationMatrix() {
    const mat = super.calculateTranslationMatrix();
    const ctr = Point3d.fromTokenCenter(this.token); // Translate from 3d center of token.
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
    if ( !(this._prototypeFaces.top instanceof Sphere) )  this._prototypeFaces.top = new Sphere;
    this._prototypeFaces.top.radius = 0.5;
    this._prototypeFaces.bottom = null;
    this._prototypeFaces.sides.length = 0;
  }

  #initializeEllipseTopFace() {
    if ( !(this._prototypeFaces.top instanceof Ellipse3d) ) {
      this._prototypeFaces.top = new Ellipse3d();
      this._prototypeFaces.bottom = new Ellipse3d();
    }
    this._prototypeFaces.top.radiusX = 0.5;
    this._prototypeFaces.top.radiusY = 0.5;
  }

  #initializeHexagonalTopFace() {
    if ( !(this._prototypeFaces.top instanceof Polygon3d) ) {
      this._prototypeFaces.top = new Polygon3d();
      this._prototypeFaces.bottom = new Polygon3d();
    }
    const poly = Hex3dVertices.polygonTopFaceForToken(token);
    Polygon3d.fromPolygon(poly, 0.5, this._prototypeFaces.top);
  }

  #initializeCubeTopFace() {
    if ( !(this._prototypeFaces.top instanceof Quad3d) ) {
      this._prototypeFaces.top = new Quad3d();
      this._prototypeFaces.bottom = new Quad3d();
    }
    this.constructor.QUADS.up.clone(this._prototypeFaces.top);
  }

  /**
   * Create the initial face shapes for this token, using a 0.5 x 0.5 x 0.5 unit cube.
   */
  _initializePrototypeFaces() {
    // Sphere treated as a single face.
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) {
      this.#initializeSphericalTopFace();
      return super._initializePrototypeFaces();
    }

    // For top and bottom, use the token shape.
    const SHAPES = CONST.TOKEN_SHAPES;
    switch ( this.token.document.shape ) {
      case SHAPES.ELLIPSE_1:
      case SHAPES.ELLIPSE_2:
        this.#initializeEllipseTopFace();
        break;

      case SHAPES.TRAPEZOID_1:
      case SHAPES.TRAPEZOID_2:
        this.#initializeHexagonalTopFace();
        break;

      case RECTANGLE_1:
      case RECTANGLE_2:
        this.#initializeCubeTopFace();
        break;
    }
    this._prototypeFaces.top.clone(this._prototypeFaces.bottom);
    this._prototypeFaces.bottom.reverseOrientation(); // Face down.
    this._prototypeFaces.top.setZ(0.5);
    this._prototypeFaces.bottom.setZ(-0.5);

    // Build sides from the top shape to the bottom elevation.
    this._prototypeFaces.sides = this._prototypeFaces.top.buildTopSides(-0.5);
    super._initializePrototypeFaces()
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
}

/**
 * Track faces for a token constrained border.
 * Not worth tracking AABB, and the model matrix remains the same.
 */

