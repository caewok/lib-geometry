/* globals
canvas,
CONFIG,
CONST,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

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
import { AABB3d } from "../3d/AABB3d.js";

const TRACKER_TYPES = {
  shape: [
    "shape",
    "refreshShape",
  ],
  level: ["level"],
  positionXY: [
    "x",
    "y",
    "refreshPosition",
  ],
  elevation: ["elevation", "refreshElevation"],
  scale: [
    "width",
    "height",
    "refreshSize",
  ],

  disposition: [
    "disposition",
  ],
};

/**
 * Handler to hold different versions of token geometry for a given token.
 * - full
 * - constrained
 * - lit
 * - bright
 */
export class TokenGeometry {
  /** @type {string} */
  static PLACEABLE_NAME = "Token";

  /** @type {string} */
  static LAYER = "tokens";


  /** @type {FullTokenGeometry} */
  #full

  get full() {
    if ( !this.#full ) {
      this.#full = new TokenFullGeometry(this.placeableDocument);
      this.#full.initialize();
      this.#full.forceUpdate();
    }
    return this.#full;
  };

  /** @type {ConstrainedTokenGeometry} */
  #constrained;

  get constrained() {
    if ( !this.#constrained ) {
      this.#constrained = new TokenConstrainedGeometry(this.placeableDocument);
      this.#constrained.initialize();
      this.#constrained.forceUpdate();
    }
    return this.#constrained;
  };

  /** @type {LitTokenGeometry} */
  #lit;

  get lit() {
    if ( !this.#lit ) {
      this.#lit = new TokenLitGeometry(this.placeableDocument);
      this.#lit.initialize();
      this.#lit.forceUpdate();
    }
    return this.#lit;
  };

  /** @type {BrightTokenGeometry} */
  #bright;

  get bright() {
    if ( !this.#bright ) {
      this.#bright = new TokenBrightGeometry(this.placeableDocument);
      this.#bright.initialize();
      this.#bright.forceUpdate();
    }
    return this.#bright;
  };

  /** @type {CanvasDocument} */
  placeableDocument;

  /**
   * @param {CanvasDocument} placeable
   */
  constructor(placeableDocument) {
    this.placeableDocument = placeableDocument;
  }

  #iterateGeometries(methodName, ...args) {
    if ( this.#full ) this.#full[methodName](...args);
    if ( this.#constrained ) this.#constrained[methodName](...args);
    if ( this.#lit ) this.#lit[methodName](...args);
    if ( this.#bright ) this.#bright[methodName](...args);
  }

  initialize() { this.#iterateGeometries("initialize"); }

  destroy() {
    this.#iterateGeometries("destroy");
    this.#full = null;
    this.#constrained = null;
    this.#lit = null;
    this.#bright = null;
  }

  update(updateKeys, opts) {  this.#iterateGeometries("update", updateKeys, opts); }

  forceUpdate() {  this.#iterateGeometries("forceUpdate"); }

  // ----- NOTE: AABB ----- //

  // AABB required for Quadtree.
  aabb = new AABB3d();

  calculateAABB() {
    this.#iterateGeometries("calculateAABB");
    if ( !this.#full ) AABB3d.fromTokenDocument(this.placeableDocument, this.aabb);
    else AABB3d.copyFrom(this.#full.aabb);
  }

  /*
  Other calculations are handled only by the sub-geometries, including:
  - aabb
  - shape iteration
  - face iteration
  - intersection
  - drawing
  - face points
  - internal points
  */

  // ----- NOTE: Static methods -----

  static SPACER = 2; // Shrink tokens slightly to avoid z-fighting with walls and tiles.

  /**
   * Determine the token 3d dimensions, in pixel units.
   * @param {TokenDocument} tokenD
   * @returns {Point3d} x: width, y: height, z: zHeight
   */
  static tokenDimensions(tokenD, out) {
    out ??= Point3d.tmp;
    const { width, height } = tokenD.getSize(); // Multiplier, e.g. 1, 2, or 3.
    const zHeight = tokenD.verticalHeightZ;
    return out.set(
      width - this.SPACER,
      height - this.SPACER,
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
  static tokenCenter(tokenD, out) {
    out ??= Point3d.tmp;
    const { x, y, topZ, bottomZ } = tokenD;
    const { width, height } = tokenD.getSize();
    const z = bottomZ + ((topZ - bottomZ) * 0.5);
    return out.set(x + (width * 0.5), y + (height * 0.5), z);
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

/**
 * Geometry that is specific to all tokens.
 */
export class TokenFullGeometry extends PlaceableGeometry {
  /** @type {string} */
  static PLACEABLE_NAME = "Token";

  /** @type {string} */
  static LAYER = "tokens";

  static UPDATE_KEYS = {
    ...super.UPDATE_KEYS,
    positionXY: new Set(TRACKER_TYPES.positionXY),
    shape: new Set(TRACKER_TYPES.shpae),
    elevation: new Set(TRACKER_TYPES.elevation),
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

  // Creates the full shape, unconstrained.
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
      const elevs = this.elevationZ;
      this.shapes.push(ExtrudedPolygonPrimitive.fromPolygon(this.placeableId, poly2d, {
        ...elevs,
        dims: TokenGeometry.tokenDimensions(this.placeableDocument),
        center: TokenGeometry.tokenCenter(this.placeableDocument),
      }));
    } else this.shapes.push(new primitiveCl(this.placeableId));
  }

  // ----- NOTE: Update ----- //



  _update() {
    if ( this._updateFlags.properties ) this.propertiesUpdated();

    // No changes required if level is updated.

    if ( this._updateFlags.positionXY || this._updateFlags.elevation ) {
      const ctr = TokenGeometry.tokenCenter(this.placeableDocument);
      console.debug(`${this.constructor.name}|Updating position for ${this.placeableDocument.name} to ${ctr}`);
      this.shape.setPosition(ctr);
    }

    if ( this._updateFlags.scale ) {
      const dims = TokenGeometry.tokenDimensions(this.placeableDocument);
      this.shape.setScale(dims);
    }

    // No changes required if token rotates.
    super._update();
  }

  propertiesUpdated() {
    const primitiveCl = this.constructor.primitiveClassForToken(this.placeableDocument);
    if ( this.shape instanceof primitiveCl ) return;
    this.initialize();
  }

  // ----- NOTE: Levels ----- //

  /**
   * Does this geometry currently block a given sense type?
   * @param {CONST.WALL_RESTRICTION_TYPES} [senseType="sight"]
   * @returns {boolean}
   */
  blocksSense(_senseType) {
    // Tokens block all sense types equally.
    return TokenGeometry.tokenBlocks(this.placeableDocument);
  }

  /**
   * Does this geometry currently block, from the view of a given level?
   * Must all check if it blocks the given sense type.
   * @param {string} levelId
   * @returns {boolean}
   */
  blocksFromLevel(levelId) {
    if ( !TokenGeometry.tokenBlocks(this.placeableDocument) ) return false;

    // If the level can see the token level, than token could block.
    const lvl = canvas.scene.levels.get(levelId);
    if ( !lvl ) return false;
    return lvl.visibility.has(this.placeableDocument.level);
  }

  // ----- NOTE: Token properties ----- //


  /**
   * Determine the token top and bottom elevations, accounting for spacer.
   * @param {TokenDocument} tokenD
   * @returns {object}
   * - @param {number} topZ
   * - @param {number} bottomZ
   */
  get elevationZ() {
    const elevs = super.elevationZ;
    elevs.topZ -= TokenGeometry.SPACER;
    elevs.bottomZ -= TokenGeometry.SPACER;
    return elevs;
  }

}

/**
 * Helper function to create shapes. Must be called using .call.
 * @param {string} [shapeFn="tokenBorder"]
 */
function createShape(shapeFn = "tokenBorder") {
  this.shapes.forEach(shape => shape.destroy());
  this.shapes.length = 0;
  const poly = this.token[shapeFn].toPolygon();
  const shape = ExtrudedPolygonPrimitive.fromPolygon(
    `${this.placeableId}`,
    poly,
    { ...this.elevationZ,
      dims: TokenGeometry.tokenDimensions(this.placeableDocument),
      center: TokenGeometry.tokenCenter(this.placeableDocument),
    }
  );
  this.shapes.push(shape);
}

/**
 * Geometry for the constrained token shape, considering walls.
 * Does not currently consider bottom/top elevation obstacles as constraining.
 */
export class TokenConstrainedGeometry extends TokenFullGeometry {

  get isConstrained() { return this.token.isConstrainedTokenBorder; }

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_constrained`; }

  createShapes() {
    if ( !this.isConstrained ) return super.createShapes();
    createShape.call(this, "constrainedTokenBorder");
  }
}

export class TokenLitGeometry extends TokenFullGeometry {

  get isLit() { return Boolean(this.token.litTokenBorder); }

  get isConstrainedLit() { return !this.token.constrainedTokenBorder.equals(this.token.litTokenBorder); }

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_lit`; }

  createShapes() {
    if ( !this.isConstrainedLit ) return super.createShapes();
    createShape.call(this, "litTokenBorder");
  }
}

export class TokenBrightGeometry extends TokenFullGeometry {

  get isBrightLit() { return Boolean(this.token.brightLitTokenBorder); }

  get isConstrainedBrightLit() { return !this.token.constrainedTokenBorder.equals(this.token.brightLitTokenBorder); }

  /**
   * Create an id used for the model matrix tracking.
   * @type {string}
   */
  get placeableId() { return `${super.placeableId}_bright`; }

  createShapes() {
    if ( !this.isConstrainedLit ) return super.createShapes();
    createShape.call(this, "brightLitTokenBorder");
  }
}
