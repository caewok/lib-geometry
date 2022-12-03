/* globals
PIXI,
ClipperLib,
foundry
*/
"use strict";



// --------- ADD METHODS TO THE PIXI.POLYGON PROTOTYPE ----- //
let isRegistered = false;
export function registerPIXIPolygonMethods() {
  if ( isRegistered ) return;
  isRegistered = true;

  // ----- Getters/Setters ----- //

  if ( !Object.hasOwn(PIXI.Polygon.prototype, "isClockwise") ) {
    Object.defineProperty(PIXI.Polygon.prototype, "isClockwise", {
      get: isClockwise,
      enumerable: false
    });
  }

  if ( !Object.hasOwn(PIXI.Polygon.prototype, "area") ) {
    Object.defineProperty(PIXI.Polygon.prototype, "area", {
      get: area,
      enumerable: false
    });
  }

  if ( !Object.hasOwn(PIXI.Polygon.prototype, "center") ) {
    Object.defineProperty(PIXI.Polygon.prototype, "center", {
      get: centroid,
      enumerable: false
    });
  }

  // ----- Iterators ----- //

  Object.defineProperty(PIXI.Polygon.prototype, "iterateEdges", {
    value: iterateEdges,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "iteratePoints", {
    value: iteratePoints,
    writable: true,
    configurable: true
  });

  // ----- Methods ----- //

  Object.defineProperty(PIXI.Polygon.prototype, "close", {
    value: function() {
      if ( this.isClosed ) return;
      if ( this.points.length < 2 ) return;
      this.addPoint({x: this.points[0], y: this.points[1]});
    },
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon, "convexhull", {
    value: convexhull,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "linesCross", {
    value: linesCross,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "reverseOrientation", {
    value: reverseOrientation,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "overlaps", {
    value: overlaps,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "pad", {
    value: pad,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "translate", {
    value: translate,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "viewablePoints", {
    value: viewablePoints,
    writable: true,
    configurable: true
  });

  // ----- Helper/Internal Methods ----- //

  Object.defineProperty(PIXI.Polygon.prototype, "_overlapsPolygon", {
    value: overlapsPolygon,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "_overlapsCircle", {
    value: overlapsCircle,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "_overlapsCircle", {
    value: overlapsCircle,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "signedArea", {
    value: signedArea,
    writable: true,
    configurable: true
  });

}

/**
 * Calculate the area of this polygon.
 * Same approach as ClipperLib.Clipper.Area.
 * @returns {number}  Positive rea
 */
function area() {
  return Math.abs(this.signedArea)
}

/**
 * Signed area of polygon
 * Similar approach to ClipperLib.Clipper.Area.
 * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
 */
function signedArea() {
  const pts = [...this.iteratePoints(close: true)]
  const ln = pts.length;
  if ( ln < 3 ) return 0;

  // (first + second) * (first - second)
  // ...
  // (last + first) * (last - first)

  let area = 0;
  for ( let i = 0; i < ln; i += 1 ) {
    const iPt = pts[i];
    const jPt = pts[i + 1];
    area += (iPt.x + jPt.x) * (iPt.y - jPt.y)
  }

  return -area * 0.5;
}

/**
 * Calculate the centroid of the polygon
 * https://en.wikipedia.org/wiki/Centroid#Of_a_polygon
 * @returns {Point}
 */
function centroid() {
  const pts = [...this.iteratePoints({close: true})];
  const ln = pts.length;
  switch ( ln  ) {
    case 0: return undefined;
    case 1: return pts[0]; // should not happen if close is true
    case 2: return pts[0];
    case 3: return PIXI.Point.midPoint(pts[0], pts[1]);
  }

  const outPoint = new PIXI.Point();
  let area = 0;
  for ( let i = 0; i < ln; i += 1 ) {
    const iPt = pts[i];
    const jPt = pts[i + 1];
    const mult = (iPt.x * jPt.y) - (jPt.x * iPt.y);

    outPoint.x += (iPt.x + jPt.x) * mult;
    outPoint.y += (iPt.y + jPt.y) * mult;

    area += (iPt.x + jPt.x) * (iPt.y - jPt.y); // See signedArea function
  }

  area = -area * 0.5;

  const areaMult = 1 / (6 * area);
  outPoint.x *= areaMult;
  outPoint.y *= areaMult;

  return outPoint;
}

/**
 * Convex hull algorithm.
 * Returns a polygon representing the convex hull of the given points.
 * Excludes collinear points.
 * Runs in O(n log n) time
 * @param {PIXI.Point[]} points
 * @returns {PIXI.Polygon}
 */
function convexhull(points) {
  const ln = points.length;
  if ( ln <= 1 ) return points;

  const newPoints = [...points];
  newPoints.sort(convexHullCmpFn);

  // Andrew's monotone chain algorithm.
  const upperHull = [];
  for ( let i = 0; i < ln; i += 1 ) {
    testHullPoint(upperHull, newPoints[i]);
  }
  upperHull.pop();

  const lowerHull = [];
  for ( let i = ln - 1; i >= 0; i -= 1 ) {
    testHullPoint(lowerHull, newPoints[i]);
  }
  lowerHull.pop();

  if ( upperHull.length === 1
    && lowerHull.length === 1
    && upperHull[0].x === lowerHull[0].x
    && upperHull[0].y === lowerHull[0].y ) return new PIXI.Polygon(upperHull);

  return new PIXI.Polygon(upperHull.concat(lowerHull));
}

/**
 * Comparison function used by convex hull function.
 * @param {Point} a
 * @param {Point} b
 * @returns {boolean}
 */
function convexHullCmpFn(a, b) {
  const dx = a.x - b.x;
  return dx ? dx : a.y - b.y;
}

/**
 * Test whether the polygon is oriented clockwise.
 * Cached property.
 * @returns {boolean}
 */
function isClockwise() {
  if ( typeof this._isClockwise === "undefined") {
    this.close();
    const path = this.toClipperPoints();
    this._isClockwise = ClipperLib.Clipper.Orientation(path);
  }
  return this._isClockwise;
}

/**
 * Iterate over the polygon's edges in order.
 * If the polygon is closed, the last two points will be ignored.
 * (Use close = true to return the last --> first edge.)
 * @param {object} [options]
 * @param {boolean} [close]   If true, return last point --> first point as edge.
 * @returns Return an object { A: {x, y}, B: {x, y}} for each edge
 * Edges link, such that edge0.B === edge.1.A.
 */
function* iterateEdges({close = true} = {}) {
  const dropped = this.isClosed ? 2 : 0;
  const ln = this.points.length;
  const iter = ln - dropped;
  if ( ln < 4 ) return;

  const firstA = new PIXI.Point(this.points[0], this.points[1]);
  let A = firstA;
  for (let i = 2; i < ln; i += 2) {
    const B = new PIXI.Point(this.points[i], this.points[i + 1]);
    yield { A, B };
    A = B;
  }

  if ( close ) {
    const B = firstA;
    yield { A, B };
  }
}

/**
 * Iterate over the polygon's {x, y} points in order.
 * If the polygon is closed and close is false,
 * the last two points (which should equal the first two points) will be dropped.
 * Otherwise, all points will be returned regardless of the close value.
 * @returns {x, y} PIXI.Point
 */
function* iteratePoints({close = true} = {}) {
  const dropped = (!this.isClosed || close) ? 0 : 2;
  const ln = this.points.length - dropped;
  for (let i = 0; i < ln; i += 2) {
    yield new PIXI.Point(this.points[i], this.points[i + 1]);
  }
}


/**
 * Test if a line or lines crosses a polygon edge
 * @param {object[]} lines    Array of lines, with A and B PIXI.Points.
 * @returns {boolean}
 */
function linesCross(lines) {
  const fu = foundry.utils;

  for ( const edge of this.iterateEdges() ) {
    for ( const line of lines ) {
      if ( lineSegmentCrosses(edge.A, edge.B, line.A, line.B) ) return true;
    }
  }

  return false;
}

/**
 * Does this polygon overlap something else?
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon|RegularPolygon} other
 * @returns {boolean}
 */
function overlaps(other) {
  if ( other instanceof PIXI.Polygon ) { return this._overlapsPolygon(other); }
  if ( other instanceof PIXI.Circle ) { return this._overlapsCircle(other); }
  if ( other instanceof PIXI.Rectangle ) { return other.overlaps(this); }

  if ( other.toPolygon) return this._overlapsPolygon(other.toPolygon());

  console.warn("overlaps|shape not recognized.", other);
  return false;
}

/**
 * Detect overlaps using brute force
 * TO-DO: Use Separating Axis Theorem to detect collisions, or overlap, between two polygons.
 * See http://programmerart.weebly.com/separating-axis-theorem.html#:~:text=%E2%80%8BThe%20Separating%20Axis%20Theorem,the%20Polyhedra%20are%20not%20colliding.
 * @param {PIXI.Polygon} other
 * @returns {boolean}
 */
function overlapsPolygon(other) {
  const polyBounds = this.getBounds();
  const otherBounds = other.getBounds();

  if ( !polyBounds.overlaps(otherBounds) ) return false;

  this.close();
  other.close();
  const pts1 = this.points;
  const pts2 = other.points;
  const ln1 = pts1.length;
  const ln2 = pts2.length;
  let a = { x: pts1[0], y: pts1[1] };
  if ( other.contains(a.x, a.y) ) return true;

  for ( let i = 2; i < ln1; i += 2 ) {
    const b = { x: pts1[i], y: pts1[i+1] };
    if ( other.contains(b.x, b.y) ) return true;

    let c = { x: pts2[0], y: pts2[1] };
    if ( this.contains(c.x, c.y) ) return true;

    for ( let j = 2; j < ln2; j += 2 ) {
      const d = { x: pts2[j], y: pts2[j+1] };
      if ( foundry.utils.lineSegmentIntersects(a, b, c, d) || this.contains(d.x, d.y) ) return true;
      c = d;
    }

    a = b;
  }
  return false;
}

/**
 * Does this polygon overlap a circle?
 * TO-DO: Use Separating Axis Theorem?
 * @param {PIXI.Circle} circle
 * @returns {boolean}
 */
function overlapsCircle(circle) {
  const polyBounds = this.getBounds();

  if ( !polyBounds.overlaps(circle) ) return false;

  this.close();
  const pts = this.points;
  const ln = pts.length;
  let a = { x: pts[0], y: pts[1] };
  if ( circle.contains(a.x, a.y) ) return true;
  for ( let i = 2; i < ln; i += 2 ) {
    const b = { x: pts[i], y: pts[i+1] };

    // Get point on the line closest to a|b (might be a or b)
    const c = foundry.utils.closestPointToSegment(c, a, b);
    if ( circle.contains(c.x, c.y) ) return true;
  }

  return false;
}

/**
 * Use Clipper to pad (offset) polygon by delta.
 * @param {number} delta           Padding amount
 * @param {object} [options]       Options that affect the padding calculation.
 * @param {number} [miterLimit]    Value of at least 2 used to avoid sharp points.
 * @param {number} [scalingFactor] How to scale the coordinates when translating to/from integers.
 * @returns {PIXI.Polygon}
 */
function pad(delta, { miterLimit = 2, scalingFactor = 1 } = {}) {
  if ( miterLimit < 2) {
    console.warn("miterLimit for PIXI.Polygon.prototype.offset must be ≥ 2.");
    miterLimit = 2;
  }

  const solution = new ClipperLib.Paths();
  const c = new ClipperLib.ClipperOffset(miterLimit);
  c.AddPath(this.toClipperPoints({scalingFactor}), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  c.Execute(solution, delta);
  return PIXI.Polygon.fromClipperPoints(solution.length ? solution[0] : [], {scalingFactor});
}

/**
 * Reverse the order of the polygon points.
 * @returns {PIXI.Polygon}
 */
function reverseOrientation() {
  const reversed_pts = [];
  const pts = this.points;
  const ln = pts.length - 2;
  for (let i = ln; i >= 0; i -= 2) {
    reversed_pts.push(pts[i], pts[i + 1]);
  }
  this.points = reversed_pts;
  if ( typeof this._isClockwise !== "undefined" ) this._isClockwise = !this._isClockwise;
  return this;
}


/**
 * Test the point against existing hull points.
 * @parma {PIXI.Point[]} hull
 * @param {PIXI.Point} point
*/
function testHullPoint(hull, p) {
  while ( hull.length >= 2 ) {
    const q = hull[hull.length - 1];
    const r = hull[hull.length - 2];
    // TO-DO: Isn't this a version of orient2d? Replace?
    if ( (q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x) ) hull.pop();
    else break;
  }
  hull.push(p);
}

/**
 * Translate, shifting this polygon in the x and y direction.
 * @param {Number} dx  Movement in the x direction.
 * @param {Number} dy  Movement in the y direction.
 * @return {PIXI.Polygon} New PIXI.Polygon
 */
function translate(dx, dy) {
  const pts = [];
  const ln = this.points.length;
  for (let i = 0; i < ln; i += 2) {
    pts.push(this.points[i] + dx, this.points[i + 1] + dy);
  }
  const out = new this.constructor(pts);
  out._isClockwise = this._isClockwise;
  if ( this.bounds ) out.bounds = out.getBounds(); // Bounds will have changed due to translate

  return out;
}

/**
 * Returns the points of the polygon that make up the viewable perimeter
 * as seen from an origin.
 * @param {Point} origin                  Location of the viewer, in 2d.
 * @param {object} [options]
 * @param {boolean} [options.returnKeys]      Return index of viewable points instead of points
 * @param {boolean} [options.outermostOnly]   Return only the outermost two points
 * @returns {Point[]|number[]}
 */
function viewablePoints(origin, { returnKeys = false, outermostOnly = false } = {}) {
  // Key point is a line from origin to the point that does not intersect the polygon
  // the outermost key points are the most ccw and cw of the key points.

  // Possible paths:
  // 1. n   n   n   key key key
  // 2. key key key n   n   n
  // 3. key key n   n   key  <-- last key(s) should be shifted to beginning of array
  // 4. n   n   key key key n

  const pts = [...this.iteratePoints({ close: false })];
  const nPts = pts.length;
  const startKeys = [];
  const endKeys = [];

  let foundNonKeyFirst = false;
  let foundNonKeyAfter = false;
  let foundKey = false;
  for ( let i = 0; i < nPts; i += 1 ) {
    let isKey = true;
    const pt = pts[i];

    for ( const edge of this.iterateEdges() ) {
      if ( (edge.A.x === pt.x && edge.A.y === pt.y)
        || (edge.B.x === pt.x && edge.B.y === pt.y) ) continue;

      if ( foundry.utils.lineSegmentIntersects(origin, pt, edge.A, edge.B) ) {
        isKey = false;
        break;
      }
    }

    if ( isKey ) {
      foundKey = true;
      !foundNonKeyAfter && startKeys.push(i); // eslint-disable-line no-unused-expressions
      foundNonKeyAfter && endKeys.push(i); // eslint-disable-line no-unused-expressions
    } else { // !isKey
      foundNonKeyFirst ||= !foundKey;
      foundNonKeyAfter ||= foundKey;
      if ( foundNonKeyFirst && foundKey ) break; // Finished the key sequence
    }
  }

  // Keep the keys CW, same order as pts
  let keys = [...endKeys, ...startKeys];
  if ( outermostOnly ) keys = [keys[0], keys[keys.length - 1]];
  return returnKeys ? keys : elementsByIndex(pts, keys);
}
