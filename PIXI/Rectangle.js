/* globals
PIXI,
foundry,
ClipperLib,
CONFIG
*/
"use strict";

import { WeilerAthertonClipper } from "../WeilerAtherton.js";

// ----------------  ADD METHODS TO THE PIXI.RECTANGLE PROTOTYPE ------------------------
export function registerPIXIRectangleMethods() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Registered ??= {};
  if ( CONFIG.GeometryLib.Registered.PIXIRectangle ) return;
  CONFIG.GeometryLib.Registered.PIXIRectangle = true;

  // ----- Static methods ---- //
  Object.defineProperty(PIXI.Rectangle, "gridRectangles", {
    value: gridRectangles,
    writable: true,
    configurable: true
  });

  // ----- Getters/Setters ----- //
  if ( !Object.hasOwn(PIXI.Rectangle.prototype, "area") ) {
    Object.defineProperty(PIXI.Rectangle.prototype, "area", {
      get: area,
      enumerable: false
    });
  }

  if ( !Object.hasOwn(PIXI.Rectangle.prototype, "center") ) {
    Object.defineProperty(PIXI.Rectangle.prototype, "center", {
      get: center,
      enumerable: false
    });
  }

  // ----- Iterators ----- //

  Object.defineProperty(PIXI.Rectangle.prototype, "iterateEdges", {
    value: iterateEdges,
    writable: true,
    configurable: true
  });

  // ----- Methods ----- //

  Object.defineProperty(PIXI.Rectangle.prototype, "_getEdgeZone", {
    value: _getEdgeZone,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "difference", {
    value: difference,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "intersectPolygon", {
    value: intersectPolygonPIXIRectangle,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "overlaps", {
    value: overlaps,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "pointsBetween", {
    value: pointsBetween,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "segmentIntersections", {
    value: segmentIntersections,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "translate", {
    value: translate,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "viewablePoints", {
    value: viewablePoints,
    writable: true,
    configurable: true
  });

  // ----- Helper methods ----- //

  Object.defineProperty(PIXI.Rectangle.prototype, "_overlapsCircle", {
    value: overlapsCircle,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_overlapsPolygon", {
    value: overlapsPolygon,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "_overlapsRectangle", {
    value: overlapsRectangle,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Rectangle.prototype, "scaledArea", {
    value: scaledArea,
    writable: true,
    configurable: true
  });
}

/**
 * Calculate area of rectangle
 * @returns {number}
 */
function area() {
  return this.width * this.height;
}

/**
 * Calculate center of the rectangle
 * @returns {number}
 */
function center() {
  return { x: this.x + (this.width * 0.5), y: this.y + (this.height * 0.5) };
}

/**
 * Calculate the rectangle Zone for a given point located around, on, or in the rectangle.
 * https://en.wikipedia.org/wiki/Cohen%E2%80%93Sutherland_algorithm
 *
 * This differs from _getZone in how points on the edge are treated: they are not considered inside.
 *
 * @param {Point} p     Point to test for location relative to the rectangle
 * @returns {integer}
 */
function _getEdgeZone(p) {
  const CSZ = PIXI.Rectangle.CS_ZONES;
  let code = CSZ.INSIDE;

  if ( p.x < this.x || p.x.almostEqual(this.x) ) code |= CSZ.LEFT;
  else if ( p.x > this.right || p.x.almostEqual(this.right) ) code |= CSZ.RIGHT;

  if ( p.y < this.y || p.y.almostEqual(this.y) ) code |= CSZ.TOP;
  else if ( p.y > this.bottom || p.y.almostEqual(this.bottom) ) code |= CSZ.BOTTOM;

  return code;
}

/**
 * Intersect this PIXI.Rectangle with a PIXI.Polygon.
 * Currently uses the clipper library or the WeilerAtherton, depending on shape
 * @param {PIXI.Polygon} polygon      A PIXI.Polygon
 * @param {object} [options]          Options which configure how the intersection is computed
 * @param {number} [options.clipType]       The clipper clip type
 * @param {number} [options.scalingFactor]  A scaling factor passed to Polygon#toClipperPoints to preserve precision
 * @returns {PIXI.Polygon|null}       The intersected polygon or null if no solution was present
 */
function intersectPolygonPIXIRectangle(polygon, {clipType, scalingFactor, disableWA = false }={}) {
  if ( !this.width || !this.height ) return new PIXI.Polygon([]);
  clipType ??= ClipperLib.ClipType.ctIntersection;

  // TODO: Fix so WA works when unioning two shapes that share only an edge.
  if ( disableWA || (clipType !== ClipperLib.ClipType.ctIntersection
    && clipType !== ClipperLib.ClipType.ctUnion)) {
    return polygon.intersectPolygon(this.toPolygon(), {clipType, scalingFactor});
  }

  const union = clipType === ClipperLib.ClipType.ctUnion;
  const wa = WeilerAthertonClipper.fromPolygon(polygon, { union });
  const res = wa.combine(this)[0];
  if ( !res ) return new PIXI.Polygon([]);
  return res instanceof PIXI.Polygon ? res : res.toPolygon();
}

/**
 * Iterate over the rectangle's edges in order.
 * (Use close = true to return the last --> first edge.)
 * @param {object} [options]
 * @param {boolean} [close]   If true, return last point --> first point as edge.
 * @returns Return an object { A: {x, y}, B: {x, y}} for each edge
 * Edges link, such that edge0.B === edge.1.A.
 */
function* iterateEdges({close = true} = {}) {
  const A = { x: this.x, y: this.y };
  const B = { x: this.x + this.width, y: this.y };
  const C = { x: this.x + this.width, y: this.y + this.height };
  const D = { x: this.x, y: this.y + this.height };

  yield { A, B };
  yield { A: B, B: C };
  yield { A: C, B: D };
  if ( close ) yield { A: D, B: A };
}

/**
 * Get all the points (corners) for a polygon approximation of a rectangle between two points on the rectangle.
 * Points are clockwise from a to b.
 * @param { Point } a
 * @param { Point } b
 * @return { Point[]}
 */
function pointsBetween(a, b) {
  const CSZ = PIXI.Rectangle.CS_ZONES;

  // Assume the point could be outside the rectangle but not inside (which would be undefined).
  const zoneA = this._getEdgeZone(a);
  if ( !zoneA ) return [];

  const zoneB = this._getEdgeZone(b);
  if ( !zoneB ) return [];

  // If on the same wall, return none if b is counterclockwise to a.
  if ( zoneA === zoneB && foundry.utils.orient2dFast(this.center, a, b) <= 0 ) return [];

  let z = zoneA;
  const pts = [];

  for ( let i = 0; i < 4; i += 1) {
    if ( (z & CSZ.LEFT) ) {
      z !== CSZ.TOPLEFT && pts.push({ x: this.left, y: this.top }); // eslint-disable-line no-unused-expressions
      z = CSZ.TOP;
    } else if ( (z & CSZ.TOP) ) {
      z !== CSZ.TOPRIGHT && pts.push({ x: this.right, y: this.top }); // eslint-disable-line no-unused-expressions
      z = CSZ.RIGHT;
    } else if ( (z & CSZ.RIGHT) ) {
      z !== CSZ.BOTTOMRIGHT && pts.push({ x: this.right, y: this.bottom }); // eslint-disable-line no-unused-expressions
      z = CSZ.BOTTOM;
    } else if ( (z & CSZ.BOTTOM) ) {
      z !== CSZ.BOTTOMLEFT && pts.push({ x: this.left, y: this.bottom }); // eslint-disable-line no-unused-expressions
      z = CSZ.LEFT;
    }

    if ( z & zoneB ) break;

  }

  return pts;
}

/**
 * Get all intersection points for a segment A|B
 * Intersections are sorted from A to B.
 * @param {Point} a   Endpoint A of the segment
 * @param {Point} b   Endpoint B of the segment
 * @returns {Point[]} Array of intersections or empty.
 *   If intersections returned, the t of each intersection is the distance along the a|b segment.
 */
function segmentIntersections(a, b) {
  // Follows structure of lineSegmentIntersects
  const zoneA = this._getZone(a);
  const zoneB = this._getZone(b);

  if ( !(zoneA | zoneB) ) return []; // Bitwise OR is 0: both points inside rectangle.
  if ( zoneA & zoneB ) return []; // Bitwise AND is not 0: both points share outside zone

  // Reguler AND: one point inside, one outside
  // Otherwise, both points outside
  const zones = !(zoneA && zoneB) ? [zoneA || zoneB] : [zoneA, zoneB];

  // If 2 zones, line likely intersects two edges,
  // but some possibility that the line starts at, say, center left
  // and moves to center top which means it may or may not cross the rectangle.
  // Check so we can use lineLineIntersection below
  if ( zones.length === 2 && !this.lineSegmentIntersects(a, b) ) return [];

  const CSZ = PIXI.Rectangle.CS_ZONES;
  const lsi = foundry.utils.lineSegmentIntersects;
  const lli = foundry.utils.lineLineIntersection;
  const { leftEdge, rightEdge, bottomEdge, topEdge } = this;
  const ixs = [];
  for ( const z of zones ) {
    let ix;
    if ( (z & CSZ.LEFT)
      && lsi(leftEdge.A, leftEdge.B, a, b)) ix = lli(a, b, leftEdge.A, leftEdge.B);
    if ( !ix && (z & CSZ.RIGHT)
      && lsi(rightEdge.A, rightEdge.B, a, b)) ix = lli(a, b, rightEdge.A, rightEdge.B);
    if ( !ix && (z & CSZ.TOP)
      && lsi(topEdge.A, topEdge.B, a, b)) ix = lli(a, b, topEdge.A, topEdge.B);
    if ( !ix && (z & CSZ.BOTTOM)
      && lsi(bottomEdge.A, bottomEdge.B, a, b)) ix = lli(a, b, bottomEdge.A, bottomEdge.B);

    // The ix should always be a point by now
    if ( !ix ) console.warn("PIXI.Rectangle.prototype.segmentIntersections returned a null point.");
    ixs.push(ix);
  }

  return ixs;
}

/**
 * Does this rectangle overlap something else?
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon} shape
 * @returns {boolean}
 */
function overlaps(shape) {
  if ( shape instanceof PIXI.Polygon ) { return this._overlapsPolygon(shape); }
  if ( shape instanceof PIXI.Circle ) { return this._overlapsCircle(shape); }
  if ( shape instanceof PIXI.Rectangle ) { return this._overlapsRectangle(shape); }

  if ( shape.toPolygon) return this._overlapsPolygon(shape.toPolygon());

  console.warn("overlaps|shape not recognized.", shape);
  return false;
}

/**
 * Does this rectangle overlap a circle?
 * @param {PIXI.Circle} circle
 * @return {Boolean}
 */
function overlapsCircle(circle) {
  // https://www.geeksforgeeks.org/check-if-any-point-overlaps-the-given-circle-and-rectangle
  // {xn,yn} is the nearest point on the rectangle to the circle center
  const xn = Math.max(this.right, Math.min(circle.x, this.left));
  const yn = Math.max(this.top, Math.min(circle.y, this.bottom));

  // Find the distance between the nearest point and the center of the circle
  const dx = xn - circle.x;
  const dy = yn - circle.y;
  return (Math.pow(dx, 2) + Math.pow(dy, 2)) <= Math.pow(circle.radius, 2);
}

/**
 * Does this rectangle overlap a polygon?
 * @param {PIXI.Polygon} poly
 * @return {Boolean}
 */
function overlapsPolygon(poly) {
  if ( poly.contains(this.left, this.top)
    || poly.contains(this.right, this.top)
    || poly.contains(this.left, this.bottom)
    || poly.contains(this.right, this.bottom)) return true;

  const pts = poly.iteratePoints({ close: true });
  let a = pts.next().value;
  if ( this.contains(a.x, a.y) ) return true;

  for ( const b of pts ) {
    if ( this.lineSegmentIntersects(a, b) || this.contains(b.x, b.y) ) return true;
    a = b;
  }

  return false;
}

/**
 * Does this rectangle overlap another?
 * @param {PIXI.Rectangle} other
 * @return {Boolean}
 */
function overlapsRectangle(other) {
  // https://www.geeksforgeeks.org/find-two-rectangles-overlap
  // One rectangle is completely above the other
  if ( this.top > other.bottom || other.top > this.bottom ) return false;

  // One rectangle is completely to the left of the other
  if ( this.left > other.right || other.left > this.right ) return false;

  return true;
}

/**
 * Move this rectangle by given x,y delta.
 * @param {number} dx
 * @param {number} dy
 * @returns {PIXI.Rectangle} New rectangle.
 */
function translate(dx, dy) {
  return new PIXI.Rectangle(this.x + dx, this.y + dy, this.width, this.height);
}

/**
 * Area that matches clipper measurements, so it can be compared with Clipper Polygon versions.
 * Used to match what Clipper would measure as area, by scaling the points.
 * @param {object} [options]
 * @param {number} [scalingFactor]  Scale like with PIXI.Polygon.prototype.toClipperPoints.
 * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
 */
function scaledArea({scalingFactor = 1} = {}) {
  return this.toPolygon().scaledArea({scalingFactor});
}

/**
 * Returns the viewable of the rectangle that make up the viewable perimeter
 * as seen from an origin.
 * @param {Point} origin                  Location of the viewer, in 2d.
 * @param {object} [options]
 * @param {boolean} [options.outermostOnly]   Return only the outermost two points
 * @returns {Point[]|null}
 */
function viewablePoints(origin, { outermostOnly = true } = {}) {
  const pts = getViewablePoints(this, origin);

  if ( !pts || !outermostOnly ) return pts;

  const ln = pts.length;
  return [pts[0], pts[ln - 1]];
}

/**
 * Helper function to get all the viewable points
 * @param {PIXI.Rectangle} bbox   Bounding box of the shape
 * @param {Point} origin
 * @returns {Point[]|null}
 */
function getViewablePoints(bbox, origin) {
  const zones = PIXI.Rectangle.CS_ZONES;

  switch ( bbox._getZone(origin) ) {
    case zones.INSIDE: return null;
    case zones.TOPLEFT: return [
      { x: bbox.left, y: bbox.bottom },
      { x: bbox.left, y: bbox.top },
      { x: bbox.right, y: bbox.top }
    ];
    case zones.TOPRIGHT: return [
      { x: bbox.left, y: bbox.top },
      { x: bbox.right, y: bbox.top },
      { x: bbox.right, y: bbox.bottom }
    ];
    case zones.BOTTOMLEFT: return [
      { x: bbox.right, y: bbox.bottom },
      { x: bbox.left, y: bbox.bottom },
      { x: bbox.left, y: bbox.top }
    ];
    case zones.BOTTOMRIGHT: return [
      { x: bbox.right, y: bbox.top },
      { x: bbox.right, y: bbox.bottom },
      { x: bbox.left, y: bbox.bottom }
    ];
    case zones.RIGHT: return [{ x: bbox.right, y: bbox.top }, { x: bbox.right, y: bbox.bottom }];
    case zones.LEFT: return [{ x: bbox.left, y: bbox.bottom }, { x: bbox.left, y: bbox.top }];
    case zones.TOP: return [{ x: bbox.left, y: bbox.top }, { x: bbox.right, y: bbox.top }];
    case zones.BOTTOM: return [{ x: bbox.right, y: bbox.bottom }, { x: bbox.left, y: bbox.bottom }];
  }

  return undefined; // Should not happen
}

/**
 * Get the difference between the two rectangles
 * If no overlap, will return null
 * @param {PIXI.Rectangle} other
 * @returns {null| {A: PIXI.Rectangle, B: PIXI.Rectangle}}
 *   A: portion of this rectangle
 *   B: portion of other rectangle
 */
function difference(other, recurse = true) {
  if ( this.right < other.x ) return null; // Left
  if ( this.bottom < other.y ) return null; // Top
  if ( this.x > other.right ) return null; // Right
  if ( this.y > other.bottom ) return null; // Bottom

  // Completely equal
  if ( this.x === other.x
    && this.y === other.y
    && this.width === other.width
    && this.height === other.height ) return null;

  // Options:
  // 1. One rectangle contains only 1 corner of the other.
  // 2. One rectangle contains 2 corners of the other.
  // 3. One rectangle contains 4 corners of the other (encompasses the other).

  const Acontained = this.contains(other.x, other.y);
  const Bcontained = this.contains(other.right, other.y);
  const Ccontained = this.contains(other.right, other.bottom);
  const Dcontained = this.contains(other.x, other.bottom);
  const nContained = Acontained + Bcontained + Ccontained + Dcontained;

  if ( nContained === 0 && recurse ) {
    // Other contains this rectangle
    const out = other.difference(this, false); // Set recurse = false to avoid endless loops if there is an error.
    [out.thisDiff, out.otherDiff] = [out.otherDiff, out.thisDiff];
    return out;
  }

  const g = PIXI.Rectangle.gridRectangles(this, other);
  const out = { thisDiff: [], otherDiff: [], g };
  switch ( nContained ) {
    case 1:
      if ( Acontained ) {
        out.thisDiff = [g.topLeft, g.topMiddle, g.centerLeft];
        out.otherDiff = [g.centerRight, g.bottomRight, g.bottomMiddle];
      } else if ( Bcontained ) {
        out.thisDiff = [g.topMiddle, g.topRight, g.centerRight];
        out.otherDiff = [g.centerLeft, g.bottomMiddle, g.bottomLeft];
      } else if ( Ccontained ) {
        out.thisDiff = [g.centerRight, g.bottomRight, g.bottomMiddle];
        out.otherDiff = [g.topLeft, g.topMiddle, g.centerLeft];
      } else if ( Dcontained ) {
        out.thisDiff = [g.centerLeft, g.bottomMiddle, g.bottomLeft];
        out.otherDiff = [g.topMiddle, g.topRight, g.centerRight];
      }
      break;
    case 2:
      if ( Acontained && Bcontained ) {
        out.thisDiff = [g.topLeft, g.topMiddle, g.topRight, g.centerRight, g.centerLeft];
        out.otherDiff = [g.bottomMiddle];
      } else if ( Bcontained && Ccontained ) {
        out.thisDiff = [g.topMiddle, g.topRight, g.centerRight, g.bottomRight, g.bottomMiddle];
        out.otherDiff = [g.centerLeft];
      } else if ( Ccontained && Dcontained ) {
        out.thisDiff = [g.centerRight, g.bottomRight, g.bottomMiddle, g.bottomLeft, g.centerLeft];
        out.otherDiff = [g.topMiddle];
      } else if ( Dcontained && Acontained ) {
        out.thisDiff = [g.topLeft, g.topMiddle, g.bottomMiddle, g.bottomLeft, g.centerLeft];
        out.otherDiff = [g.centerRight];
      }
      break;
    case 3: break; // Shouldn't happen
    case 4:
      // Same as case 0 but for thisDiff.
      out.thisDiff = [
        g.topLeft, g.topMiddle, g.topRight,
        g.centerLeft, g.centerRight,
        g.bottomLeft, g.bottomMiddle, g.bottomRight
      ];
      break;
  }

  out.thisDiff = out.thisDiff.filter(r => r.width > 0 && r.height > 0);
  out.otherDiff = out.otherDiff.filter(r => r.width > 0 && r.height > 0);
  return out;
}

/**
 * Determine the grid coordinates of all combinations of two rectangles.
 * Order of the two rectangles does not matter.
 * @param {PIXI.Rectangle} rect1    First rectangle
 * @param {PIXI.Rectangle} rect2    Second rectangle
 * @returns {object}  Object with 9 rectangles. Some may have zero width or height.
 */
function gridRectangles(rect1, rect2) {
  // Order the xs and ys
  const xArr = [rect1.x, rect1.right, rect2.x, rect2.right].sort((a, b) => a - b);
  const yArr = [rect1.y, rect1.bottom, rect2.y, rect2.bottom].sort((a, b) => a - b);

  const [x1, x2, x3, x4] = xArr;
  const [y1, y2, y3, y4] = yArr;

  const w1 = x2 - x1;
  const w2 = x3 - x2;
  const w3 = x4 - x3;

  const h1 = y2 - y1;
  const h2 = y3 - y2;
  const h3 = y4 - y3;

  return {
    topLeft: new PIXI.Rectangle(x1, y1, w1, h1),
    topMiddle: new PIXI.Rectangle(x2, y1, w2, h1),
    topRight: new PIXI.Rectangle(x3, y1, w3, h1),

    centerLeft: new PIXI.Rectangle(x1, y2, w1, h2),
    centerMiddle: new PIXI.Rectangle(x2, y2, w2, h2),
    centerRight: new PIXI.Rectangle(x3, y2, w3, h2),

    bottomLeft: new PIXI.Rectangle(x1, y3, w1, h3),
    bottomMiddle: new PIXI.Rectangle(x2, y3, w2, h3),
    bottomRight: new PIXI.Rectangle(x3, y3, w3, h3)
  };
}
