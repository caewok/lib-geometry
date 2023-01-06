/* globals
PIXI,
ClipperLib,
foundry,
CONFIG
*/
"use strict";

// --------- ADD METHODS TO THE PIXI.POLYGON PROTOTYPE ----- //
export function registerPIXIPolygonMethods() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.Registered ??= {};
  if ( CONFIG.GeometryLib.Registered.PIXIPolygon ) return;
  CONFIG.GeometryLib.Registered.PIXIPolygon = true;

  // ----- Getters/Setters ----- //

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

  if ( !Object.hasOwn(PIXI.Polygon.prototype, "isClockwise") ) {
    Object.defineProperty(PIXI.Polygon.prototype, "isClockwise", {
      get: isClockwise,
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

  // For compatibility with other shapes
  Object.defineProperty(PIXI.Polygon.prototype, "toPolygon", {
    value: function() { return this; },
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "clipperClip", {
    value: clipperClip,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon, "convexhull", {
    value: convexhull,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "isSegmentEnclosed", {
    value: isSegmentEnclosed,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "linesCross", {
    value: linesCross,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "lineSegmentIntersects", {
    value: lineSegmentIntersects,
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

  Object.defineProperty(PIXI.Polygon.prototype, "pointsBetween", {
    value: pointsBetween,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Polygon.prototype, "segmentIntersections", {
    value: segmentIntersections,
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

  Object.defineProperty(PIXI.Polygon.prototype, "scaledArea", {
    value: scaledArea,
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
 * @param {object} options
 * @param {number|undefined} [scalingFactor]  If defined, will scale like with PIXI.Polygon.prototype.toClipperPoints.
 * @returns {number}  Positive rea
 */
function area() {
  return Math.abs(this.signedArea());
}

/**
 * Calculate the centroid of the polygon
 * https://en.wikipedia.org/wiki/Centroid#Of_a_polygon
 * @returns {Point}
 */
function centroid() {
  const pts = [...this.iteratePoints({close: true})];
  const ln = pts.length;
  switch ( ln ) {
    case 0: return undefined;
    case 1: return pts[0]; // Should not happen if close is true
    case 2: return pts[0];
    case 3: return PIXI.Point.midPoint(pts[0], pts[1]);
  }

  const outPoint = new PIXI.Point();
  let area = 0;
  const iter = ln - 2;
  for ( let i = 0; i < iter; i += 1 ) {
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
 * Clip a polygon with another.
 * Union, Intersect, diff, x-or
 * @param {PIXI.Polygon} poly   Polygon to clip against this one.
 * @param {object} [options]
 * @param {ClipperLib.ClipType} [options.cliptype]  Type of clipping
 * @return [ClipperLib.Paths[]] Array of Clipper paths
 */
function clipperClip(poly, { cliptype = ClipperLib.ClipType.ctUnion } = {}) {
  const subj = this.toClipperPoints();
  const clip = poly.toClipperPoints();

  const solution = new ClipperLib.Paths();
  const c = new ClipperLib.Clipper();
  c.AddPath(subj, ClipperLib.PolyType.ptSubject, true); // True to be considered closed
  c.AddPath(clip, ClipperLib.PolyType.ptClip, true);
  c.Execute(cliptype, solution);

  return solution;
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
  if ( this.points.length < 6 ) return (this._isClockwise = undefined);

  if ( typeof this._isClockwise === "undefined") this._isClockwise = this.signedArea() > 0;
  return this._isClockwise;
}


/**
 * Test if a segment is enclosed by the polygon.
 * @param {Segment} segment      Segment denoted by A and B points.
 * @param {object} [options]  Options that affect the test
 * @param {number} [options.epsilon]      Tolerance when testing for equality
 * @returns {boolean} True is segment is enclosed by the polygon
 */
function isSegmentEnclosed(segment, { epsilon = 1e-08 } = {}) {
  const { A, B } = segment;
  const aInside = this.contains(A.x, A.y);
  const bInside = this.contains(B.x, B.y);

  // If either point outside, then not enclosed
  if ( !aInside || !bInside ) return false;

  // Could still (a) have an endpoint on an edge or (b) be an edge or (c) cross the polygon edge 2+ times.
  const points = this.points;
  const ln = points.length - 2;
  for ( let i = 0; i < ln; i += 2 ) {
    const edgeA = { x: points[i], y: points[i+1] };
    if ( edgeA.x.almostEqual(A.x, epsilon) && edgeA.y.almostEqual(A.y, epsilon) ) return false;
    if ( edgeA.x.almostEqual(B.x, epsilon) && edgeA.y.almostEqual(B.y, epsilon) ) return false;

    const edgeB = { x: points[i+2], y: points[i+3] };
    if ( edgeB.x.almostEqual(A.x, epsilon) && edgeB.y.almostEqual(A.y, epsilon) ) return false;
    if ( edgeB.x.almostEqual(B.x, epsilon) && edgeB.y.almostEqual(B.y, epsilon) ) return false;

    if ( foundry.utils.lineSegmentIntersects(edgeA, edgeB, A, B) ) return false;
  }

  return true;
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
  const ln = this.points.length;
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
 * @param {object} [options]
 * @param {boolean} [options.close]   If close, include the first point again.
 * @returns {x, y} PIXI.Point
 */
function* iteratePoints({close = true} = {}) {
  const ln = this.points.length;
  if ( ln < 2 ) return;

  const num = ln - (this.isClosed ? 2 : 0);
  for (let i = 0; i < num; i += 2) {
    yield new PIXI.Point(this.points[i], this.points[i + 1]);
  }

  if ( close ) yield new PIXI.Point(this.points[0], this.points[1]);
}


/**
 * Test if a line or lines crosses a polygon edge
 * @param {object[]} lines    Array of lines, with A and B PIXI.Points.
 * @returns {boolean}
 */
function linesCross(lines) {
  for ( const edge of this.iterateEdges() ) {
    for ( const line of lines ) {
      if ( CONFIG.GeometryLib.utils.lineSegmentCrosses(edge.A, edge.B, line.A, line.B) ) return true;
    }
  }

  return false;
}

/**
 * Test whether line segment AB intersects this polygon.
 * Equivalent to PIXI.Rectangle.prototype.lineSegmentIntersects.
 * @param {Point} a                       The first endpoint of segment AB
 * @param {Point} b                       The second endpoint of segment AB
 * @param {object} [options]              Options affecting the intersect test.
 * @param {boolean} [options.inside]      If true, a line contained within the rectangle will
 *                                        return true.
 * @returns {boolean} True if intersects.
 */
function lineSegmentIntersects(a, b, { inside = false } = {}) {
  if (this.contains(a.x, a.y) && this.contains(b.x, b.y) ) return inside;

  const edges = this.iterateEdges({ close: true });
  for ( const edge of edges ) {
    if ( foundry.utils.lineSegmentIntersects(a, b, edge.A, edge.B) ) return true;
  }

  return false;
}

/**
 * Get all intersection points for a segment A|B
 * Intersections are sorted from A to B.
 * @param {Point} a   Endpoint A of the segment
 * @param {Point} b   Endpoint B of the segment
 * @param {object} [options]    Optional parameters
 * @param {object[]} [options.edges]  Array of edges for this polygon, from this.iterateEdges.
 * @param {boolean} [options.indices] If true, return the indices for the edges instead of intersections
 * @returns {Point[]} Array of intersections or empty.
 *   If intersections returned, the t of each intersection is the distance along the a|b segment.
 */
function segmentIntersections(a, b, { edges, indices = false } = {}) {
  edges ??= [...this.iterateEdges({ close: true })];
  const ixIndices = [];
  edges.forEach((e, i) => {
    if ( foundry.utils.lineSegmentIntersects(a, b, e.A, e.B) ) ixIndices.push(i);
  });
  if ( indices ) return ixIndices;

  return ixIndices.map(i => {
    const edge = edges[i];
    return foundry.utils.lineLineIntersection(a, b, edge.A, edge.B);
  });
}

/**
 * Get all the points for this polygon between two points on the polygon
 * Points are clockwise from a to b.
 * @param { Point } a
 * @param { Point } b
 * @param {object} [options]    Optional parameters
 * @param {object[]} [options.edges]  Array of edges for this polygon, from this.iterateEdges.
 * @return { Point[]}
 */
function pointsBetween(a, b, { edges } = {}) {
  edges ??= [...this.iterateEdges({ close: true })];
  const ixIndices = this.segmentIntersections(a, b, { edges, indices: true });

  // A is the closest ix
  // B is the further ix
  // Anything else can be ignored
  let ixA = { t: Number.POSITIVE_INFINITY };
  let ixB = { t: Number.NEGATIVE_INFINITY };
  ixIndices.forEach(ix => {
    if ( ix.t < ixA.t ) ixA = ix;
    if ( ix.t > ixB.t ) ixB = ix;
  });

  // Start at ixA, and get intersection point at start and end
  const out = [];
  const startEdge = edges[ixA];
  const startIx = foundry.utils.lineLineIntersection(startEdge.A, startEdge.B, a, b);
  out.push(startIx);
  if ( !startEdge.B.almostEqual(startIx) ) out.push(startEdge.B);

  const ln = edges.length;
  for ( let i = startIx + 1; i < ln; i += 1 ) out.push(edges[i].B);

  if ( ixB < ixA ) {
    // Must circle around to the starting edge
    for ( let i = 0; i < ixB; i += 1 ) out.push(edges[i].B);
  }

  const endEdge = edges[ixB];
  const endIx = foundry.utils.lineLineIntersection(endEdge.A, endEdge.B, a, b);
  if ( !endEdge.A.almostEqual(endIx) ) out.push(endIx);

  return out;
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

  const pts1 = this.iteratePoints({ close: true });
  let a = pts1.next().value;
  if ( other.contains(a.x, a.y) ) return true;

  for ( const b of pts1 ) {
    if ( other.contains(b.x, b.y) ) return true;

    const pts2 = this.iteratePoints({ close: true });
    let c = pts2.next().value;
    for ( const d of pts2 ) {
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

  const pts = this.iteratePoints({ close: true });
  let a = pts.next().value;
  if ( circle.contains(a.x, a.y) ) return true;

  for ( const b of pts ) {
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
 * Scaled area of a polygon.
 * Used to match what Clipper would measure as area, by scaling the points.
 * @param {object} [options]
 * @param {number} [scalingFactor]  Scale like with PIXI.Polygon.prototype.toClipperPoints.
 * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
 */
function scaledArea({ scalingFactor = 1 } = {}) {
  return signedArea.call(this, { scalingFactor });
}

/**
 * Signed area of polygon
 * Similar approach to ClipperLib.Clipper.Area.
 * @param {object} [options]
 * @param {number|undefined} [scalingFactor]  If defined, will scale like with PIXI.Polygon.prototype.toClipperPoints.
 * @returns {number}  Positive if clockwise. (b/c y-axis is reversed in Foundry)
 */
function signedArea({ scalingFactor } = {}) {
  const pts = [...this.iteratePoints({close: true})];

  if ( scalingFactor ) pts.forEach(pt => {
    pt.x = Math.roundFast(pt.x * scalingFactor);
    pt.y = Math.roundFast(pt.y * scalingFactor);
  });

  const ln = pts.length;
  if ( ln < 4 ) return 0; // Incl. closing point, should have 4

  // (first + second) * (first - second)
  // ...
  // (last + first) * (last - first)

  let area = 0;
  const iter = ln - 1;
  for ( let i = 0; i < iter; i += 1 ) {
    const iPt = pts[i];
    const jPt = pts[i + 1];
    area += (iPt.x + jPt.x) * (iPt.y - jPt.y);
  }

  if ( scalingFactor ) area /= Math.pow(scalingFactor, 2);

  return -area * 0.5;
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

/**
 * Get elements of an array by a list of indices
 * https://stackoverflow.com/questions/43708721/how-to-select-elements-from-an-array-based-on-the-indices-of-another-array-in-ja
 * @param {Array} arr       Array with elements to select
 * @param {number[]} indices   Indices to choose from arr. Indices not in arr will be undefined.
 * @returns {Array}
 */
export function elementsByIndex(arr, indices) {
  return indices.map(aIndex => arr[aIndex]);
}
