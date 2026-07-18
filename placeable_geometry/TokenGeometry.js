/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Mixing
import { mix } from "../mixwith.js";

// Geometry
import { PlaceableGeometry } from "./PlaceableGeometry.js";
import {
  SpherePrimitive,
  CubePrimitive,
  CylinderPrimitive,
  HexagonCylinderPrimitive
  } from "./InstancedGeometricPrimitive.js";
import { ExtrudedPolygonPrimitive } from "./ModelGeometricPrimitive.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { NULL_SET } from "../util.js";
import { Point3d } from "../3d/Point3d.js";
import { getHexagonalShape } from "../placeable_vertices/BasicVertices.js";

const TRACKER_TYPES = {
  shape: [
    "shape",
  ],
  level: ["level"],
  positionXY: [
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

  // #wallsID = -1;

  get isConstrained() { return this.token.isConstrainedTokenBorder; }

  #constrainedShapes = [];

  get constrainedShapes() {
    // TODO: Cache updating.
    this.updateConstrainedShapes();
    return this.#constrainedShapes;
  }


  /**
   * Iterate over the shapes.
   * @param {object} [opts]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
   * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
   * @yields {GeometricPrimitive}
   */
  *iterateConstrainedShapes({ senseType, levelId } = {}) {
    if ( !this.isConstrained ) return yield* this.iterateShapes();
    if ( senseType && !this.blocksSense(senseType) ) return;
    if ( levelId && !this.blocksFromLevel(levelId) ) return;
    yield* this.constrainedShapes;
  }

  /**
   * Iterate over the shapes' faces.
   * @yields {Polygon3d}
   */
  *iterateConstrainedFaces(opts = {}) {
    for ( const shape of this.iterateConstrainedShapes(opts) ) yield* shape.faces;
  }

  updateConstrainedShapes() {
    if ( !this.isConstrained || !this.token ) return;

    this.#constrainedShapes.forEach(shape => shape.destroy());
    this.#constrainedShapes.length = 0;

    const poly = this.token.constrainedTokenBorder.toPolygon();
    this.#constrainedShapes.push(new ExtrudedPolygonPrimitive.fromPolygon(
      `${this.placeableId}_constrained`,
      poly,
      this.constructor.placeableElevationZ(this.placeableObject))
    );
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

  /*
  #wallsID = -1;

  #lightsID = -1;
  */

  #constrainedLitShapes = [];

  get constrainedLitShapes() {
    // TODO: Cache updating.
    this.updateConstrainedLitShapes();
    return this.#constrainedLitShapes;
  }


  /**
   * Iterate over the shapes.
   * @param {object} [opts]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
   * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
   * @yields {GeometricPrimitive}
   */
  *iterateConstrainedLitShapes({ senseType, levelId } = {}) {
    if ( !this.isConstrainedLit ) return yield* this.iterateShapes();
    if ( senseType && !this.blocksSense(senseType) ) return;
    if ( levelId && !this.blocksFromLevel(levelId) ) return;
    yield* this.constrainedLitShapes;
  }

  /**
   * Iterate over the shapes' faces.
   * @yields {Polygon3d}
   */
  *iterateConstrainedLitFaces(opts = {}) {
    for ( const shape of this.iterateConstrainedLitShapes(opts) ) yield* shape.faces;
  }

  updateConstrainedLitShapes() {
    if ( !this.isLit || !this.token ) return;

    this.#constrainedLitShapes.forEach(shape => shape.destroy());
    this.#constrainedLitShapes.length = 0;

    const poly = this.token.litTokenBorder.toPolygon();
    this.#constrainedLitShapes.push(new ExtrudedPolygonPrimitive.fromPolygon(
      `${this.placeableId}_lit`,
      poly,
      this.constructor.placeableElevationZ(this.placeableObject))
    );

    /*
    const SPACER = this.constructor.SPACER;
    const token = this.token;
    const poly = token.litTokenBorder.toPolygon();
    buildPolygonCube(poly, token.topZ - SPACER, token.bottomZ + SPACER, this._constrainedLitFaces);
    this.#wallsID = ConstrainedTokenBorder._wallsID;
    this.#lightsID = ConstrainedTokenBorder._lightsID;
    */
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

  /*
  #wallsID = -1;

  #lightsID = -1;
  */

  #constrainedBrightLitShapes = [];

  get constrainedBrightLitShapes() {
    // TODO: Cache updating.
    this.updateConstrainedBrightLitShapes();
    return this.#constrainedBrightLitShapes;
  }

  /**
   * Iterate over the shapes.
   * @param {object} [opts]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType]   If provided, will return early if geometry does not block this sense type.
   * @param {string} [opts.levelId]                           If provided, will return early if geometry does not affect this level.
   * @yields {GeometricPrimitive}
   */
  *iterateConstrainedBrightLitShapes({ senseType, levelId } = {}) {
    if ( !this.isConstrainedBrightLit ) return yield* this.iterateShapes();
    if ( senseType && !this.blocksSense(senseType) ) return;
    if ( levelId && !this.blocksFromLevel(levelId) ) return;
    yield* this.constrainedBrightLitShapes;
  }

  /**
   * Iterate over the shapes' faces.
   * @yields {Polygon3d}
   */
  *iterateConstrainedBrightLitFaces(opts = {}) {
    for ( const shape of this.iterateConstrainedBrightLitShapes(opts) ) yield* shape.faces;
  }

  updateConstrainedBrightLitShapes() {
    if ( !this.isBrightLit || !this.token ) return;

    this.#constrainedBrightLitShapes.forEach(shape => shape.destroy());
    this.#constrainedBrightLitShapes.length = 0;

    const poly = this.token.brightLitTokenBorder.toPolygon();
    this.#constrainedBrightLitShapes.push(new ExtrudedPolygonPrimitive.fromPolygon(
      `${this.placeableId}_brightLit`,
      poly,
      this.constructor.placeableElevationZ(this.placeableObject))
    );

    /*
    const SPACER = this.constructor.SPACER;
    const token = this.token;
    const poly = token.litTokenBorder.toPolygon();
    buildPolygonCube(poly, token.topZ - SPACER, token.bottomZ + SPACER, this._constrainedLitFaces);
    this.#wallsID = ConstrainedTokenBorder._wallsID;
    this.#lightsID = ConstrainedTokenBorder._lightsID;
    */
  }
}

/**
 * Prototype order:
 * WallGeometryTracker -> PlaceableFacesMixin -> PlaceableMatricesMixin -> PlaceableAABBMixin -> PlaceableGeometry
 */
export class TokenGeometry extends mix(PlaceableGeometry).with(
  TokenConstrainedBrightLitFacesMixin, TokenConstrainedLitFacesMixin, TokenConstrainedFacesMixin) {

  /** @type {string} */
  static PLACEABLE_NAME = "Token";

  /** @type {string} */
  static LAYER = "tokens";

  static TRACKER_TYPES = TRACKER_TYPES;

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    properties: new Set([...TRACKER_TYPES.shape, ...TRACKER_TYPES.disposition]),
    level: new Set(TRACKER_TYPES.level),
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

  static primitiveClassForToken(tokenD) {
    const TYPES = this.SHAPE_TYPES;
    const type = this.shapeTypeForToken(tokenD);
    switch ( type ) {
      case TYPES.ELLIPSOID:
      case TYPES.SPHERICAL: return SpherePrimitive;
      case TYPES.CUBE: return CubePrimitive;
      case TYPES.ELLIPSE: return CylinderPrimitive;
      case TYPES.HEXAGONAL: return this.useSimpleHexagon ? HexagonCylinderPrimitive : ExtrudedPolygonPrimitive;
    }
  }

  get useSimpleHexagon() { return this.placeableDocument.w <= 1 && this.placeableDocument.w === this.placeableDocument.h; }

  get shape() { return this.shapes[0]; } // Tokens currently always only using a single shape.

  initialize() {
    this.createShapes();
    super.initialize();
  }

  createShapes() {
    // TODO: Don't destroy unless the shape type has changed. Must account for changes in hex shapes.
    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;

    // Larger hexagons are not well-defined.
    // TODO: Determine the variations on the larger shapes and switch to instanced geometry.
    const TYPES = this.constructor.SHAPE_TYPES;
    const tokenD = this.placeableDocument;
    const type = this.constructor.shapeTypeForToken(tokenD);
    const primitiveCl = this.constructor.primitiveClassForToken(tokenD)
    if ( type === TYPES.HEXAGONAL && !this.useSimpleHexagon ) {
      const res = getHexagonalShape(tokenD.w, tokenD.h, tokenD.shape, canvas.scene.grid.columns ?? false);
      const poly2d = new PIXI.Polygon(res.points);
      const elevZ = this.constructor.placeableElevationZ(this.placeableDocument);
      this.shapes.push(ExtrudedPolygonPrimitive.fromPolygon(poly2d), elevZ);

    } else this.shapes.push(new primitiveCl(this.placeableId));
  }

  // ----- NOTE: Update ----- //

  _update() {
    if ( this._updateFlags.properties ) this.propertiesUpdated();

    // No changes required if level is updated.

    if ( this._updateFlags.positionXY || this._updateFlags.elevation ) {
      const ctr = this.constructor.tokenCenter(this.placeableDocument);
      this.shape.setPosition(ctr);
    }

    if ( this._updateFlags.scale ) {
      const dims = this.constructor.tokenDimensions(this.placeableDocument);
      this.shape.setScale(dims);
    }

    // No changes required if token rotates.
    super._update();
  }

  propertiesUpdated() {
    const primitiveCl = this.constructor.primitiveClassForToken(this.placeableDocument);
    if ( this.shape instanceof primitiveCl ) return;
    this.createShapes();
  }

  // ----- NOTE: Levels ----- //

  /**
   * Does this geometry currently block a given sense type?
   * @param {CONST.WALL_RESTRICTION_TYPES} [senseType="sight"]
   * @returns {boolean}
   */
  blocksSense(_senseType) {
    // Tokens block all sense types equally.
    return this.constructor.tokenBlocks(this.placeableDocument);
  }

  /**
   * Does this geometry currently block, from the view of a given level?
   * Must all check if it blocks the given sense type.
   * @param {string} levelId
   * @returns {boolean}
   */
  blocksFromLevel(levelId) {
    if ( !this.constructor.tokenBlocks(this.placeableDocument) ) return false;

    // If the level can see the token level, than token could block.
    const lvl = canvas.scene.levels.get(levelId);
    if ( !lvl ) return false;
    return lvl.visibility.has(this.placeableDocument.level);
  }


  // ----- NOTE: Faces ----- //

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
   * Determine the token top and bottom elevations, accounting for spacer.
   * @param {TokenDocument} tokenD
   * @returns {object}
   * - @param {number} topZ
   * - @param {number} bottomZ
   */
  static placeableElevationZ(tokenD) {
    const elevZ = super.placeableElevationZ(tokenD);
    elevZ.topZ -= this.SPACER;
    elevZ.bottomZ -= this.SPACER;
    return elevZ;
  }

  /**
   * Determine the token 3d dimensions, in pixel units.
   * @param {TokenDocument} tokenD
   * @returns {Point3d} x: width, y: height, z: zHeight
   */
  static tokenDimensions(tokenD) {
    const { width, height } = tokenD; // Multiplier, e.g. 1, 2, or 3.
    const zHeight = tokenD.verticalHeightZ;
    return Point3d.tmp.set(
      (width * canvas.dimensions.size) - this.SPACER,
      (height * canvas.dimensions.size) - this.SPACER,
      zHeight - this.SPACER,
    );
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

  /**
   * Does the token block with respect to a movement token?
   * @param {TokenDocument} tokenD           Token to test for whether it could block
   * @param {TokenDocument} [subjectTokenD]       Token doing the movement or viewing
   * @param {TokenBlockingConfig} blockingCfg
   * @returns {boolean}
   */
  static tokenBlocks(tokenD, subjectTokenD, blockingCfg = {}) {
    if ( tokenD.document ) tokenD = tokenD.document;
    if ( subjectTokenD?.document ) subjectTokenD = subjectTokenD.document;

    // Hidden tokens don't block.
    if ( tokenD.hidden ) return false;

    // Don't block self. Note this is ignored if no subject token.
    if ( subjectTokenD === tokenD ) return false;

    // Exclude certain token statuses.
    blockingCfg.excludedStatuses ??= NULL_SET;
    if ( tokenD.actor
      && tokenD.actor.statuses.intersects(blockingCfg.excludedStatuses) ) return false;

    // Tests for dead tokens.
    if ( !blockingCfg.dead && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsDead(tokenD) ) return false;

    // Tests for live tokens.
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlive(tokenD) ) {
      if ( !blockingCfg.live ) return false;
      if ( !blockingCfg.prone && tokenD.isProne ) return false;

      // Compare disposition to subject token.
      if ( subjectTokenD ) {
        if ( !blockingCfg.enemies && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsEnemy(subjectTokenD, tokenD) ) return false;
        if ( !blockingCfg.allies && CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlly(subjectTokenD, tokenD) ) return false;
      }
    }
    return true;
  }

  static includeToken(tokenD, { blockingCfg = {}, subjectToken, tokensToExclude = NULL_SET }) {
    if ( subjectToken && subjectToken.document ) subjectToken = subjectToken.document;
    if ( tokenD === subjectToken || tokensToExclude.has(tokenD) ) return false;
    return this.tokenBlocks(tokenD, subjectToken, blockingCfg);
  }
}


