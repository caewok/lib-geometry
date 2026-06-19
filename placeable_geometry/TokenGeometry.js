/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

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
  createUnitCube,
  createUnitEllipseCylinder,
  createUnitHexagonalCylinder,
} from "./PlaceableGeometry.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Polygon3d } from "../3d/Polygon3d.js";
import { Point3d } from "../3d/Point3d.js";
import { Sphere } from "../3d/Sphere.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";
import { getHexagonalShape } from "../placeable_vertices/BasicVertices.js";

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
  position2d: [
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

  /**
   * Vertices with normals and indices.
   * @type {object<VertexObject>}
   */
  constrainedVO = new VertexObject();

  _updateModelVertices() {
    // Update using faces.
    const vertices = this.constructor.verticesFromFaces(this._constrainedFaces, true);
    this.constructor.updateVertexObject(this.constrainedVO, vertices);
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

  /**
   * Vertices with normals and indices.
   * @type {object<VertexObject>}
   */
  constrainedLitVO = new VertexObject();

  _updateModelVertices() {
    // Update using faces.
    const vertices = this.constructor.verticesFromFaces(this._constrainedLitFaces, true);
    this.constructor.updateVertexObject(this.constrainedLitVO, vertices);
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

  /**
   * Vertices with normals and indices.
   * @type {object<VertexObject>}
   */
  constrainedBrightLitVO = new VertexObject();

  _updateModelVertices() {
    // Update using faces.
    const vertices = this.constructor.verticesFromFaces(this._constrainedLitFaces, true);
    this.constructor.updateVertexObject(this.constrainedBrightLitVO, vertices);
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
    position2d: new Set(TRACKER_TYPES.position2d),
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

  /**
   * Determine the shape type for a given token
   * @param {TokenDocument} [tokenD]      Optional token document; used for gridless to choose ellipse or cube.
   * @returns {SHAPE_TYPES}
   */
  static shapeTypeForToken(tokenD) {
    const TYPES = this.SHAPE_TYPES;
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenEllipsoid ) return TYPES.ELLIPSOID;
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) return TYPES.SPHERICAL;

    const GRID = CONST.GRID_TYPES;
    switch ( canvas.grid.type ) {
      case GRID.SQUARE: return TYPES.CUBE;
      case GRID.GRIDLESS: {
        const shape = tokenD?.shape;
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

  /**
   * Return a geometry class based on the token shape.
   * @param {TokenDocument} tokenD
   * @returns {AbstractTokenGeometry}
   */
  static geometryClassForToken(tokenD) {
    const TYPES = this.SHAPE_TYPES;
    switch ( this.shapeTypeForToken(tokenD) ) {
      case TYPES.ELLIPSOID: console.warn("Ellipsoid not yet implemented."); // TODO: Implement.
      case TYPES.SPHERICAL:  /* eslint-disable-line no-fallthrough */
        return TokenSphereGeometry;

      case TYPES.CUBE: return TokenSquareGeometry;
      case TYPES.ELLIPSE: return TokenEllipseGeometry;
      case TYPES.HEXAGONAL: {
        if ( tokenD.w > 1 || tokenD.h > 1 || tokenD.w !== tokenD.h ) return TokenPolygonGeometry;
        return TokenHexagonGeometry;
      }
      default: return TokenSquareGeometry;
    }
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


export class TokenSquareGeometry extends TokenGeometry {

  static #prototypeFaces;

  static get prototypeFaces() { return this.#prototypeFaces ||= createUnitCube(); }

}

export class TokenEllipseGeometry extends TokenGeometry {

  static #prototypeFaces;

  static get prototypeFaces() { return this.#prototypeFaces ||= createUnitEllipseCylinder(canvas.scene.dimensions.maxR / 10) };

}


export class TokenHexagonGeometry extends TokenGeometry {

  static #prototypeFaces;

  static get prototypeFaces() { return this.#prototypeFaces ||= createUnitHexagonalCylinder(); }

}

export class TokenSphereGeometry extends TokenGeometry {

  static prototypeFaces = new Sphere(undefined, 0.5);
}

export class TokenPolygonGeometry extends TokenGeometry {
  // No prototype faces.

  faces = [
    new Polygon3d(),
    new Polygon3d(),
    // Others vary based on polygon shape.
  ]


  _updateFaces() {
    const tokenD = this.placeableDocument
    const shapeType = this.shapeTypeForToken(tokenD);
    let poly2d;
    const ST = this.SHAPE_TYPES;
    const size = canvas.grid.size;
    switch ( shapeType ) {
      case ST.CUBE:
        poly2d = new PIXI.Rectangle(tokenD.x, tokenD.y, tokenD.w * size, tokenD.h * size);
        break;
      case ST.HEXAGONAl: {
        const res = getHexagonalShape(tokenD.w, tokenD.h, tokenD.shape, canvas.scene.grid.columns ?? false);
        poly2d = new PIXI.Polygon(res.points);
        break;
      }
      case ST.ELLIPSE:
      case ST.ELLIPSOID: console.warn("Ellipsoid not yet implemented.");
      case ST.SPHERICAL: { /* eslint-disable-line no-fallthrough */
        const radius = Math.max(tokenD.h * size, tokenD.w * size);
        const density = PIXI.Circle.approximateVertexDensity(radius);
        poly2d = new PIXI.Circle(tokenD.x, tokenD.y, radius).toPolygon({ density });
        break;
      }
    }

    this.faces.length = 2;
    Polygon3d.fromPolygon(poly2d, tokenD.topZ, this.faces[0]);
    Polygon3d.fromPolygon(poly2d, tokenD.bottomZ, this.faces[1]);
    this.faces.push(...this.faces[0].buildTopSides(tokenD.bottomZ));
  }

}
