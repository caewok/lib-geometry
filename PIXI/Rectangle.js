/* globals
PIXI,
foundry,
ClipperLib,
CONFIG
*/
"use strict";

// ----------------  ADD METHODS TO THE PIXI.RECTANGLE PROTOTYPE ------------------------
export function registerPIXIRectangleMethods() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Registered ??= {};
  if ( CONFIG.GeometryLib.Registered.PIXIRectangle ) return;
  CONFIG.GeometryLib.Registered.PIXIRectangle = true;

  // ----- Getters/Setters ----- //
  if ( !Object.hasOwn(PIXI.Rectangle.prototype, "area") ) {
    Object.defineProperty(PIXI.Rectangle.prototype, "area", {
      get: area,
      enumerable: false
    });
  }

  // ----- Methods ----- //

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
 * Intersect this PIXI.Rectangle with a PIXI.Polygon.
 * Currently uses the clipper library or the WeilerAtherton, depending on shape
 * @param {PIXI.Polygon} polygon      A PIXI.Polygon
 * @param {object} [options]          Options which configure how the intersection is computed
 * @param {number} [options.clipType]       The clipper clip type
 * @param {number} [options.scalingFactor]  A scaling factor passed to Polygon#toClipperPoints to preserve precision
 * @returns {PIXI.Polygon|null}       The intersected polygon or null if no solution was present
 */
function intersectPolygonPIXIRectangle(polygon, {clipType, scalingFactor}={}) {
  if ( !this.width || !this.height ) return new PIXI.Polygon([]);
  clipType ??= ClipperLib.ClipType.ctIntersection;

  if ( clipType !== ClipperLib.ClipType.ctIntersection
    && clipType !== ClipperLib.ClipType.ctUnion) {
    return polygon.intersectPolygon(this.toPolygon(), {clipType, scalingFactor});
  }

  const union = clipType === ClipperLib.ClipType.ctUnion;
  const wa = WeilerAthertonClipper.fromPolygon(polygon, { union });
  const res = wa.combine(this)[0];
  if ( !res ) return new PIXI.Polygon([]);
  return res instanceof PIXI.Polygon ? res : res.toPolygon();
}


/**
 * Get all intersection points for a segment A|B
 * Intersections are sorted from A to B.
 * @param {Point} a   Endpoint A of the segment
 * @param {Point} b   Endpoint B of the segment
 * @returns {Point[]} Array of intersections or empty.
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
      && lsi(leftEdge.A, leftEdge.B, a, b)) ix = lli(leftEdge.A, leftEdge.B, a, b);
    if ( !ix && (z & CSZ.RIGHT)
      && lsi(rightEdge.A, rightEdge.B, a, b)) ix = lli(rightEdge.A, rightEdge.B, a, b);
    if ( !ix && (z & CSZ.TOP)
      && lsi(topEdge.A, topEdge.B, a, b)) ix = lli(topEdge.A, topEdge.B, a, b);
    if ( !ix && (z & CSZ.BOTTOM)
      && lsi(bottomEdge.A, bottomEdge.B, a, b)) ix = lli(bottomEdge.A, bottomEdge.B, a, b);

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

  poly.close();
  const pts = poly.points;
  const ln = pts.length;
  let a = { x: pts[0], y: pts[1] };
  if ( this.contains(a.x, a.y) ) return true;
  for ( let i = 2; i < ln; i += 2 ) {
    const b = { x: pts[i], y: pts[i+1] };
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
    case zones.TOPLEFT: return [{ x: bbox.left, y: bbox.bottom },  { x: bbox.left, y: bbox.top }, { x: bbox.right, y: bbox.top }];
    case zones.TOPRIGHT: return [{ x: bbox.left, y: bbox.top }, { x: bbox.right, y: bbox.top }, { x: bbox.right, y: bbox.bottom }];
    case zones.BOTTOMLEFT: return [{ x: bbox.right, y: bbox.bottom }, { x: bbox.left, y: bbox.bottom }, { x: bbox.left, y: bbox.top }];
    case zones.BOTTOMRIGHT: return [{ x: bbox.right, y: bbox.top }, { x: bbox.right, y: bbox.bottom }, { x: bbox.left, y: bbox.bottom }];

    case zones.RIGHT: return [{ x: bbox.right, y: bbox.top }, { x: bbox.right, y: bbox.bottom }];
    case zones.LEFT: return [{ x: bbox.left, y: bbox.bottom }, { x: bbox.left, y: bbox.top }];
    case zones.TOP: return [{ x: bbox.left, y: bbox.top }, { x: bbox.right, y: bbox.top }];
    case zones.BOTTOM: return [{ x: bbox.right, y: bbox.bottom }, { x: bbox.left, y: bbox.bottom }];
  }

  return undefined; // Should not happen
}

