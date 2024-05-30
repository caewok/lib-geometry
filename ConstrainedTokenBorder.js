/* globals
ClockwiseSweepPolygon,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

export const PATCHES = {};
PATCHES.CONSTRAINED_TOKEN_BORDER = {};

// ----- NOTE: Hooks to mark edge changes ----- //

function canvasInit() { ConstrainedTokenBorder._wallsID++; }

PATCHES.CONSTRAINED_TOKEN_BORDER.HOOKS = { canvasInit };

// ----- NOTE: Wraps to mark edge changes ----- //

function refreshCanvasEdge(wrapped) {
  ConstrainedTokenBorder._wallsID++;
  wrapped();
}

PATCHES.CONSTRAINED_TOKEN_BORDER.WRAPS = { refresh: refreshCanvasEdge };

/**
 * Generate a polygon of the token bounds with portions intersected by walls stripped out.
 * Use line-of-sight from the center point to determine the resulting token shape.
 * This border represents the physical bounds of the token, so the move restriction is
 * used for walls (which thus don't have limited restriction walls).
 */
export class ConstrainedTokenBorder extends ClockwiseSweepPolygon {
  /**
   * Cache shape by token.
   */
  static _cache = new WeakMap();

  /**
   * Retrieve the constrained token shape for the given wall restriction type.
   * @param {Token} token
   * @param {string} type   Corresponds to wall restriction: sight, sound, light, move
   */
  static get(token) {
    let polygon = this._cache.get(token);
    if ( !polygon ) this._cache.set(token, polygon = new this(token));
    polygon.initialize();
    polygon.compute();
    return polygon;
  }

  /** Indicator of wall/edge changes
   * @type {number}
   */
  static _wallsID = 0;

  /**
   * Properties to test if relevant token characterics have changed.
   * @type {object}
   */
  _tokenProperties = {
    visionHeight: null
  };

  /**
   * More properties to test if relevant token characterics have changed, specific to the document.
   * @type {object}
   */
  _tokenDocumentProperties = {
    x: null,
    y: null,
    elevation: null,
    width: null,
    height: null
  }

  /** @type {Token} */
  _token;

  /** @type {number} */
  #wallsID = -1;

  /**
   * If true, no walls constrain token.
   * @type {boolean}
   */
  _unrestricted;

  /** @type {boolean} */
  #dirty = true;

  constructor(token) {
    super();
    this._token = token;
  }

  /** @override */
  initialize() {
    const { _token, _tokenProperties, _tokenDocumentProperties } = this;

    // Determine if the token has changed.
    // Could use getProperty/setProperty, but may be a bit slow and unnecessary, given
    // that all properties are either on the token or the document.
    let tokenMoved = false;
    for ( const key of Object.keys(_tokenProperties) ) {
      const value = _token[key];
      tokenMoved ||= _tokenProperties[key] !== value;
      _tokenProperties[key] = value;
    }
    const doc = _token.document;
    for ( const key of Object.keys(_tokenDocumentProperties) ) {
      const value = doc[key];
      tokenMoved ||= _tokenDocumentProperties[key] !== value;
      _tokenDocumentProperties[key] = value;
    }

    if ( tokenMoved ||  this.#wallsID !== ConstrainedTokenBorder._wallsID ) {
      this.#wallsID = ConstrainedTokenBorder._wallsID;
      this.#dirty = true;
      const config = {
        source: _token.vision,
        type: "move",
        boundaryShapes: [_token.tokenBorder] // [_token.tokenBorder.toPolygon()] }; // Avoid WeilerAtherton.
      };
      super.initialize(_token.center, config);
    }
  }

  /** @override */
  getBounds() {
    return this._token.bounds;
  }

  /** @override */
  compute() {
    if ( this.#dirty ) {
      this.#dirty = false;
      super.compute();
    }
  }

  /** @override */
  _compute() {
    this.points.length = 0;

    if ( this._identifyEdges() ) {
      this._identifyVertices();
      this._executeSweep();
      this._constrainBoundaryShapes();
      this._unrestricted = false;
    } else {
      this._unrestricted = true;
    }

    this.vertices.clear();
    this.edges.clear();
    this.rays.length = 0;

    // If we screwed up, fall back on unrestricted.
    if ( this.points.length < 6 ) this._unrestricted = true;
  }

  /**
   * Reject walls collinear to the bounding shape.
   * Test whether a wall should be included in the computed polygon for a given origin and type
   * @param {Edge} edge                     The Edge being considered
   * @param {Record<EdgeTypes, 0|1|2>} edgeTypes Which types of edges are being used? 0=no, 1=maybe, 2=always
   * @param {PIXI.Rectangle} bounds         The overall bounding box
   * @returns {boolean}                     Should the edge be included?
   * @protected
   */
  _testEdgeInclusion(edge, edgeTypes, bounds) {
     // Only include edges of the appropriate type
    const m = edgeTypes[edge.type];
    if ( !m ) return false;
    if ( m === 2 ) return true;

    // Drop edges collinear to the border.
    if ( this.#edgeIsCollinearToBounds(edge, bounds) ) return false;

    return super._testEdgeInclusion(edge, edgeTypes, bounds);
  }

  /**
   * Test whether a given edge lies precisely on a boundary edge.
   * @param {Edge} edge               The Edge being considered
   * @param {PIXI.Rectangle} bounds   Overall bounding box
   * @returns {boolean}
   */
  #edgeIsCollinearToBounds(edge, bounds) {
    const delta = edge.b.subtract(edge.a, PIXI.Point._tmp);
    if ( !delta.x && (edge.a.x.almostEqual(bounds.left) || edge.a.x.almostEqual(bounds.right)) ) return true;
    if ( !delta.y && (edge.a.y.almostEqual(bounds.top) || edge.a.y.almostEqual(bounds.bottom)) ) return true;
    return false;
  }

  /**
   * If all edges are collinear to the token border, then we can just use the token border.
   * @returns {boolean} True if all edges are outside the token border or collinear to the border.
   @override */
  _identifyEdges() {
    super._identifyEdges();

    // If only border edges left, confirm those edges don't intersect the boundary.
    let bounds = this.config.boundingBox
    for ( const edge of this.edges ) {
      if ( !(edge.type === "innerBounds" || edge.type === "outerBounds") ) return false;
      if ( bounds.lineSegmentIntersects(edge.a, edge.b, { inside: true }) &&
          !this.#edgeIsCollinearToBounds(edge, bounds) ) return false;
    }
    return true; // Can skip the sweep.
  }

  /** @override */
  contains(x, y) {
    const inBounds = this._token.bounds.contains(x, y);
    if ( this._unrestricted || !inBounds ) return inBounds;

    return PIXI.Polygon.prototype.contains.call(this, x, y);
  }

  /**
   * Return either this polygon or the underlying token border if possible.
   * @returns {ConstrainedTokenShape|PIXI.Rectangle}
   */
  constrainedBorder() {
    return this._unrestricted ? this._token.tokenBorder : this;
  }
}

