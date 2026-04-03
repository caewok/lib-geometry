/* globals
PIXI,
ClipperLib,
foundry,
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

export const PATCHES = {};
PATCHES.PIXI = {};

import { AABB2d } from "../AABB.js";
import { lineSegmentCrosses } from "../util.js";
import { CutawayPolygon } from "../CutawayPolygon.js";

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
  switch ( this.points.length ) {
    case 0: return undefined;
    case 1: return PIXI.Point.tmp.set(this.points[0], this.points[1]); // Should not happen if close is true
    case 2: {
      const [a, b] = [...this.iteratePoints()];
      return PIXI.Point.midPoint(a, b);
    }
  }
  const outPoint = PIXI.Point.tmp;
  let area = 0;
  for ( const edge of this.iterateEdges() ) {
    const sumX = edge.a.x + edge.b.x;
    area += sumX * (edge.a.y - edge.b.y); // See signedArea function.
    const mult = (edge.a.x * edge.b.y) - (edge.b.x * edge.a.y);
    outPoint.x += sumX * mult;
    outPoint.y += (edge.a.y + edge.b.y) * mult;
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
function convexHull(points) {
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
 * Test whether the polygon is oriented clockwise.
 * Cached property.
 * In v11, this was renamed to isPositive; this provides backward-compatibility.
 * @returns {boolean}
 */
function isClockwise() { return this.isPositive; }

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
 * @param {object} [options]
 * @param {boolean} [close]   If true, return last point --> first point as edge
 * @returns { a: PIXI.Point, b: PIXI.Point }  Return an object for each edge.
 * Edges link, such that edge0.a === edge.1.b. If close === true, the first point will be reused.
 */
function* iterateEdges({ close = true } = {}) {
  const ln = this.points.length;
  if ( ln < 4 ) return;


  const firstA = PIXI.Point.tmp.set(this.points[0], this.points[1]);
  let a = firstA;
  for (let i = 2; i < ln; i += 2) {
    const b = PIXI.Point.tmp.set(this.points[i], this.points[i + 1]);
    yield { a, b };
    a = b;
  }

  if ( close ) {
    const b = firstA;
    yield { a, b };
  }
}

/**
 * Iterate over the polygon's edges in order.
 * @param {object} [options]
 * @param {boolean} [close]   If true, return last point --> first point as edge
 * @returns { a: PIXI.Point, b: PIXI.Point }  Return an object for each edge.
 * Edges link, such that edge0.a === edge.1.b. If close === true, the first point will be reused.
 */
function* reverseIterateEdges({ close = true } = {}) {
  const ln = this.points.length;
  if ( ln < 4 ) return;

  const firstA = PIXI.Point.tmp.set(this.points.at(-2), this.points.at(-1));;
  let a = firstA;
  for (let i = ln - 4; i > -1; i -= 2) {
    const b = PIXI.Point.tmp.set(this.points[i], this.points[i + 1]);
    yield { a, b };
    a = b;
  }

  if ( close ) {
    const b = firstA;
    yield { a, b };
  }
}

/**
 * Iterate over the polygon's {x, y} points in order.
 * @returns {PIXI.Point} Each point returned is distinct.
 */
function* iteratePoints() {
  const ln = this.points.length;
  if ( ln < 2 ) return;
  for (let i = 0; i < ln; i += 2) yield PIXI.Point.tmp.set(this.points[i], this.points[i + 1]);
}

/**
 * Iterate over the polygon's {x, y} points in order.
 * @param {object} [options]
 * @param {boolean} [options.close]   If close, include the first point again.
 * @returns {PIXI.Point} Each point returned is distinct; if close === true, a new PIXI.Point is created.
 */
function* reverseIteratePoints() {
  const ln = this.points.length;
  if ( ln < 2 ) return;
  for (let i = ln - 2; i > -1; i -= 2) yield PIXI.Point.tmp.set(this.points[i], this.points[i + 1]);
}

/**
 * Test if a line or lines crosses a polygon edge
 * @param {object[]} lines    Array of lines, with A and B PIXI.Points.
 * @returns {boolean}
 */
function linesCross(lines) {
  for ( const edge of this.iterateEdges() ) {
    for ( const line of lines ) {
      if ( lineSegmentCrosses(edge.a, edge.b, line.a, line.b) ) return true;
      edge.a.release(); // B will later be set to A, so don't release it.
    }
  }
  return false;
}

/**
 * Test whether line segment AB crosses a polygon edge.
 * @param {Point} a                       The first endpoint of segment AB
 * @param {Point} b                       The second endpoint of segment AB
 * @param {object} [options]              Options affecting the intersect test.
 * @param {boolean} [options.inside]      If true, a line contained within the rectangle will
 *                                        return true.
 * @returns {boolean} True if intersects.
 */
function lineSegmentCrossesPolygon(a, b, { inside = false } = {}) {
  if ( this.contains(a.x, a.y) && this.contains(b.x, b.y) ) return inside;
  for ( const edge of this.iterateEdges() ) {
    if ( lineSegmentCrosses(a, b, edge.a, edge.b) ) return true;
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
  if ( this.contains(a.x, a.y) && this.contains(b.x, b.y) ) return inside;
  for ( const edge of this.iterateEdges() ) {
    if ( foundry.utils.lineSegmentIntersects(a, b, edge.a, edge.b) ) return true;
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
 * @returns {PIXI.Point[]} Array of intersections or empty.
 *   If intersections returned, the t of each intersection is the distance along the a|b segment.
 */
function segmentIntersections(a, b, { indices = false, tangents = true } = {}) {
  const edges = this.iterateEdges();
  const ixIndices = [];
  const ixs = [];
  edges.forEach((edge, i) => {
     if ( !foundry.utils.lineSegmentIntersects(a, b, edge.a, edge.b) ) return;
     if ( indices && tangents ) {
       ixIndices.push(i);
       return;
     }
     const ix = foundry.utils.lineLineIntersection(a, b, edge.a, edge.b);
     if ( !ix ) return; // Shouldn't happen, but...
     if ( edge.b.almostEqual(ix) ) return; // Get on the next iteration so endpoint intersections are not repeated.
     if ( !tangents && _isTangentIntersection(a, b, edges, ix, i) ) return;
     ixIndices.push(i);
     ixs.push(_ixToPoint(ix));
  });
 return indices ? ixIndices : ixs;
}

function _ixToPoint(ix) {
  const pt = PIXI.Point.tmp.set(ix.x, ix.y);
  pt.t0 = ix.t0;
  return pt;
}

/**
 * Get all intersection points for a line that goes through A|B
 * Ignores singleton tangents: intersects of vertex without penetrating the polygon.
 * @param {Point} a   Endpoint A of the segment
 * @param {Point} b   Endpoint B of the segment
 * @param {object} [options]    Optional parameters
 * @param {object[]} [options.edges]  Array of edges for this polygon, from this.iterateEdges.
 * @param {boolean} [options.indices] If true, return the indices for the edges instead of intersections
 * @returns {Point[]} Array of intersections or empty.
 *   If intersections returned, the t of each intersection is the distance along the a|b segment.
 */
function lineIntersections(a, b, { indices = false, tangents = true } = {}) {
  const edges = [...this.iterateEdges()];
  const ixIndices = [];
  const ixs = [];
  edges.forEach((edge, i) => {
    const ix = foundry.utils.lineLineIntersection(a, b, edge.a, edge.b);
    if ( !ix ) return;
    if ( !tangents && _isTangentIntersection(a, b, edges, ix, i) ) return;
    ixs.push(_ixToPoint(ix));
    ixIndices.push(i);
  });
  return indices ? ixIndices : ixs;
}

/**
 * Is this intersection of the polygon vertex tangent, such that the line does not go inside the
 * V formed by the polygon edges?
 * @param {Edges} edges
 * @param {object} ix
 * @param {number} i
 */
function _isTangentIntersection(a, b, edges, ix, i) {
  // Could be a singleton; tangent to vertex but never moving into the edge.
  // Happens if for edges A --> B --> C, orient(a, b, A) is same side as orient(a, b, C) for B edge
  const edge = edges[i];
  if ( edge.a.almostEqual(ix) ) {
    const idx = (edges.length + i - 1) % edges.length;
    const priorEdge = edges[idx];
    if ( foundry.utils.orient2dFast(a, b, priorEdge.a) * foundry.utils.orient2dFast(a, b, edge.b) > 0 ) return true; // Same side

  } else if ( edge.b.almostEqual(ix) ) {
    const idx = (edges.length + i + 1) % edges.length;
    const nextEdge = edges[idx];
    if ( foundry.utils.orient2dFast(a, b, nextEdge.b) * foundry.utils.orient2dFast(a, b, edge.a) > 0 ) return true; // Same side
  }
  return false;
}


/**
 * Get all the points for this polygon between two points on the polygon
 * Points are clockwise from a to b.
 * @param { Point } a
 * @param { Point } b
 * @param {object} [options]    Optional parameters
 * @param {object[]} [options.edges]  Array of edges for this polygon, from this.iterateEdges.
 * @return { PIXI.Point[]}
 */
function pointsBetween(a, b) {
  const edges = [...this.iterateEdges()];
  const ixIndices = this.segmentIntersections(a, b, { indices: true });

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
  const startIx = foundry.utils.lineLineIntersection(startEdge.a, startEdge.b, a, b);
  out.push(_ixToPoint(startIx));
  if ( !startEdge.b.almostEqual(startIx) ) out.push(startEdge.b);

  const ln = edges.length;
  for ( let i = startIx + 1; i < ln; i += 1 ) out.push(edges[i].b);

  if ( ixB < ixA ) {
    // Must circle around to the starting edge
    for ( let i = 0; i < ixB; i += 1 ) out.push(edges[i].b);
  }

  const endEdge = edges[ixB];
  const endIx = foundry.utils.lineLineIntersection(endEdge.a, endEdge.b, a, b);
  if ( !endEdge.a.almostEqual(endIx) ) out.push(_ixToPoint(endIx));

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
  if ( other instanceof PIXI.Rectangle ) { return other._overlapsPolygon(this); }
  if ( other instanceof PIXI.Ellipse ) return other._overlapsPolygon(this);
  if ( other.toPolygon) return this._overlapsPolygon(other.toPolygon());
  console.warn("overlaps|shape not recognized.", other);
  return false;
}

/**
 * Does this polygon envelop something else?
 * This is a one-way test; call other.envelops(this) to test the other direction.
 * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Polygon} shape
 * @returns {boolean}
 */
function envelops(shape) {
  if ( shape instanceof PIXI.Polygon ) { return this._envelopsPolygon(shape); }
  if ( shape instanceof PIXI.Circle ) { return this._envelopsCircle(shape); }
  if ( shape instanceof PIXI.Rectangle ) { return this._envelopsRectangle(shape); }
  if ( shape instanceof PIXI.Point ) { return this._envelopsPoint(shape); }
  if ( shape.toPolygon) return this._envelopsPolygon(shape.toPolygon());
  console.warn("overlaps|shape not recognized.", shape);
  return false;
}

/**
 * Determine if a point is strictly inside a PIXI.Polygon.
 * Returns false if the point is outside OR on the boundary.
 * @param {PIXI.Point} pt     Point to test
 * @returns {boolean}
 */
function _envelopsPoint(pt) {
  const { lineSegmentIntersects, orient2dFast } = foundry.utils;
  using aabb = new AABB2d();
  using rightPt = PIXI.Point.tmp.set(Number.MAX_SAFE_INTEGER, pt.y);
  let inside = false;

  // Iterate through each edge.
  for ( const edge of this.iterateEdges() ) {
    if ( orient2dFast(edge.a, edge.b, pt).almostEqual(0) ) {
      // Collinear. Determine if within bounds.
      AABB2d.fromEdge(edge, aabb);
      if ( aabb.containsPoint(pt) ) return false; // On the border.

      // If horizontal and to the right of the point, skip.
      // As if we count each endpoint, which would be inside = !!inside.
      // (Line segment intersection will treat as no intersection.)
      // The edge before will intersect as will the edge after.
      // Per below ray casting, we will skip the edge before.
      // Note, we already know the edge is collinear with the point.
      if ( edge.a.y.almostEqual(edge.b.y) && edge.a.x > pt.x ) continue;
    }

    // Ray casting (Jordan Curve Theorem).
    // Shoot imaginary point from the point to the right.
    // Toggle inside every time the ray crosses the edge.
    // Don't double count the same endpoint when switching from one edge to another
    if ( lineSegmentIntersects(edge.a, edge.b, pt, rightPt) &&
         !(edge.b.y.almostEqual(pt.y) && edge.b.x > pt.x) ) inside = !inside;
  }
  return inside;
}

/**
 * Detect overlaps using brute force
 * @param {PIXI.Polygon} other
 * @returns {boolean}
 */
function _overlapsPolygon(other) {
  const polyBounds = this.getBounds();
  const otherBounds = other.getBounds();

  if ( !polyBounds.overlaps(otherBounds) ) return false;

  for ( const edge of this.iterateEdges() ) {
    const { a, b } = edge;
    if ( other.contains(a.x, a.y)
      || other.contains(b.x, b.y) ) return true;

    for ( const otherEdge of other.iterateEdges() ) {
      const { a:c, b:d } = otherEdge;
      if ( this.contains(c.x, c.y)
        || this.contains(d.x, d.y) ) return true;
      if ( foundry.utils.lineSegmentIntersects(a, b, c, d) ) return true;
    }
  }
  return false;
}


/**
 * Does this polygon overlap a circle?
 * @param {PIXI.Circle} circle
 * @returns {boolean}
 */
function _overlapsCircle(circle) {
  // If the circle center is contained, we are done.
  if ( this.contains(circle) ) return true;

  // If the bounding boxes of the circle and this polygon do not overlap, we are done.
  const polyBounds = this.getBounds();
  if ( !polyBounds.overlaps(circle.getBounds()) ) return false;

  // If the center of the circle is not contained, then the polygon cannot envelope the circle.
  // Therefore, some part of a polygon edge must be within the circle.
  const segments = this.iterateEdges();
  for ( const s of segments ) {
    // Get point on the line closest to segment from circle center
    const c = foundry.utils.closestPointToSegment(circle, s.a, s.b);
    if ( circle.contains(c.x, c.y) ) return true;
  }

  return false;
}

/**
 * Does this polygon envelop another?
 * @param {PIXI.Polygon} poly
 * @returns {boolean}
 */
function _envelopsPolygon(poly) {
  // Not terribly efficient (sweepline would be better) but simple in concept.
  // Step 1: Check the bounding box.
  // (Could test both bounds, but it would iterate over the second polygon to create bounds.)
  if ( !this.getBounds().envelops(poly) ) return false;

  // Step 2: All polygon points must be contained.
  const iter = poly.iteratePoints();
  for ( using pt of iter ) {
    if ( !this.contains(pt.x, pt.y) ) return false;
  }

  // Step 3: Cannot have intersecting lines.
  const edges = poly.iterateEdges();
  for ( const edge of edges ) {
    if ( this.lineSegmentIntersects(edge.a, edge.b) ) return false;
  }
  return true;
}

/**
 * Does this polygon envelop a rectangle?
 * @param {PIXI.Rectangle} rect
 * @returns {boolean}
 */
function _envelopsRectangle(rect) {
  // Step 1: All 4 points must be contained within.
  const { top, left, right, bottom } = rect;
  if ( !(this.contains(left, top)
       && this.contains(right, top)
       && this.contains(right, bottom)
       && this.contains(left, bottom)) ) return false;

  // Step 2: No intersecting edges.
  const edges = rect.iterateEdges();
  for ( const edge of edges ) {
    if ( this.lineSegmentIntersects(edge.a, edge.b) ) return false;
    edge.a.release(); // B will become A so don't release.
  }
  return true;
}

/**
 * Does this polygon envelop a circle?
 * @param {PIXI.Rectangle} rect
 * @returns {boolean}
 */
function _envelopsCircle(circle) {
  // Step 1: Center point must be contained.
  if ( !this.contains(circle.x, circle.y) ) return false;

  // Step 2: Circle cannot envelop this polygon.
  if ( circle._envelopsPolygon(this) ) return false;

  // Step 3: No intersecting edges.
  const edges = this.iterateEdges();
  for ( const edge of edges ) {
    const ixs = circle.segmentIntersections(edge.a, edge.b);
    if ( ixs.length ) return false;
    edge.a.release(); // B will become A so don't release.
  }
  return true;
}

/**
 * Use Clipper to pad (offset) polygon by delta. Pads in place for consistency with PIXI.Rectangle#pad.
 * @param {number} padding         Padding amount
 * @param {object} [options]       Options that affect the padding calculation.
 * @param {number} [miterLimit]    Value of at least 2 used to avoid sharp points.
 * @param {number} [scalingFactor] How to scale the coordinates when translating to/from integers.
 * @param {number} [miterType]     Type of joint to use: jtRound, jtSquare, or jtMiter
 * @returns {PIXI.Polygon} This polygon, for convenience.
 */
function pad(padding, { miterLimit = 2, scalingFactor = 100, miterType = "jtMiter" } = {}) {
  if ( miterLimit < 2) {
    console.warn("miterLimit for PIXI.Polygon.prototype.offset must be ≥ 2.");
    miterLimit = 2;
  }

  const solution = new ClipperLib.Paths();
  const c = new ClipperLib.ClipperOffset(miterLimit);
  c.AddPath(this.toClipperPoints({ scalingFactor }), ClipperLib.JoinType[miterType], ClipperLib.EndType.etClosedPolygon);
  c.Execute(solution, padding * scalingFactor);
  const poly = PIXI.Polygon.fromClipperPoints(solution.length ? solution[0] : [], { scalingFactor });
  this.points = poly.points;
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
  const edges = [...this.iterateEdges()];

  if ( scalingFactor ) edges.forEach(edge => {
    const { a, b } = edge;
    a.x = Math.round(a.x * scalingFactor);
    a.y = Math.round(a.y * scalingFactor);
    b.x = Math.round(b.x * scalingFactor);
    b.y = Math.round(b.y * scalingFactor);
  });

  const ln = edges.length;
  if ( ln < 3 ) return 0;

  // (first + second) * (first - second)
  // ...
  // (last + first) * (last - first)

  let area = 0;
  for ( const edge of edges ) {
    const { a, b } = edge;
    area += (a.x + b.x) * (a.y - b.y);
  }
  if ( scalingFactor ) area /= Math.pow(scalingFactor, 2);
  return -area * 0.5;
}

/**
 * Translate, shifting this polygon in the x and y direction.
 * @param {Number} dx  Movement in the x direction.
 * @param {Number} dy  Movement in the y direction.
 * @return {PIXI.Polygon} New PIXI.Polygon
 */
function translate(dx, dy, out) {
  // Keep out points in case out === this.
  if ( !out ) out = this.clone();
  else if ( out !== this ) out.points.length = this.points.length;

  const pts = this.points;
  const outPts = out.points;
  for (let i = 0, ln = pts.length; i < ln; i += 2) {
    outPts[i] = pts[i] + dx;
    outPts[i+1] = pts[i + 1] + dy;
  }
  out._isPositive = this._isPositive;
  if ( this.bounds ) out.bounds = out.getBounds(); // Bounds will have changed due to translate
  return out;
}

/**
 * Scale, resizing this polygon in the x and y axis.
 * In most cases, you want to center the polygon at 0,0 first.
 * @param {Number} dx  Change along the x axis
 * @param {Number} dy  Change along the x axis
 * @return {PIXI.Polygon} New PIXI.Polygon
 */
function scale(scaleX, scaleY, out) {
  // Keep out points in case out === this.
  if ( !out ) out = this.clone();
  else if ( out !== this ) out.points.length = this.points.length;

  const pts = this.points;
  const outPts = out.points;
  for (let i = 0, ln = pts.length; i < ln; i += 2) {
    outPts[i] = pts[i] * scaleX;
    outPts[i+1] = pts[i + 1] * scaleY;
  }
  out._isPositive = this._isPositive;
  if ( this.bounds ) out.bounds = out.getBounds(); // Bounds will have changed due to translate
  return out;
}

/**
 * Center this polygon at 0,0, apply a scale, and then translate back.
 * @param {Number} dx  Change along the x axis
 * @param {Number} dy  Change along the x axis
 * @return {PIXI.Polygon} New PIXI.Polygon
 */
function centerScale(scaleX = 1, scaleY = 1, out) {
  // Keep out points in case out === this.
  if ( !out ) out = this.clone();
  else if ( out !== this ) out.points.length = this.points.length;

  const center = this.center;
  const pts = this.points;
  const outPts = out.points;
  for (let i = 0, ln = pts.length; i < ln; i += 2) {
    outPts[i] = ((pts[i] - center.x) * scaleX) + center.x;
    outPts[i+1] = ((pts[i + 1] - center.y) * scaleY) + center.y;
  }
  out._isPositive = this._isPositive;
  if ( this.bounds ) out.bounds = out.getBounds(); // Bounds will have changed due to translate
  return out;
}


/**
 * Helper for viewablePoints to slice an array in a circle if the end is before the start.
 * https://stackoverflow.com/questions/57138153/slice-from-beginning-if-array-ended-javascript
 * @param {Array} arr       Array to slice
 * @param {number} start    Starting index
 * @param {number} end      Ending index. Can be less than start.
 * @returns {Array}
 */
function wrapslice(arr, start, end) {
  return end < start
    ? arr.slice(start).concat(arr.slice(0, end))
    : arr.slice(start, end);
}

/**
 * Helper function for viewablePoints.
 * Test if an angle is maximum compared to some other angle
 * @param {PIXI.Point} pt
 * @param {PIXI.Point} origin
 * @param {PIXI.Point} center
 * @param {number} angle
 * @param {number} maxAngle
 * @returns {boolean}
 */
function testMaxCWAngle(pt, origin, center, angle, maxAngle) {
  if ( angle < maxAngle ) return false;
  if ( foundry.utils.orient2dFast(origin, center, pt) > 0 ) return false; // CCW

  // If the angles are equal, pick the closest point.
  const dist2Between = PIXI.Point.distanceSquaredBetween;
  if ( angle === maxAngle ) return dist2Between(origin, pt) < dist2Between(origin, pt);
  return true;
}

function testMaxCCWAngle(pt, origin, center, angle, maxAngle) {
  if ( angle < maxAngle ) return false;
  if ( foundry.utils.orient2dFast(origin, center, pt) < 0 ) return false; // CW

  // If the angles are equal, pick the closest point.
  const dist2Between = PIXI.Point.distanceSquaredBetween;
  if ( angle === maxAngle ) return dist2Between(origin, pt) < dist2Between(origin, pt);
  return true;
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

  // Viewable point is a line from origin to the point that does not intersect the polygon
  // the outermost key points are the most ccw and cw of the key points.
  // Get the most clockwise and counterclockwise from the origin point that do not intersect.
  // Store point keys in a set; for each edge, remove if origin --> point intersects the edge.
  // Remainder in set are viewable points.
  // It is possible that if the polygon is not simple, one or more points that are on the
  // viewable side

  const pts = [...this.iteratePoints()];

  // Handle degenerate polygons.
  // Also, if the polygon contains this origin, use all points of the polygon.
  // Technically possible for the polygon to be complex and have some points blocked but not relevant
  // for Foundry use cases.
  const nPoints = pts.length;
  if ( nPoints < 3 || this.contains(origin.x, origin.y) ) {
    // Test if we have a single line segment collinear to the origin; keep the closest point.
    if ( nPoints === 2 && !foundry.utils.orient2dFast(origin, pts[0], pts[1]) ) {
      if ( PIXI.Point.distanceSquaredBetween(origin, pts[0]) < PIXI.Point.distanceSquaredBetween(origin, pts[1]) ) pts.pop();
      else pts.shift();
    }

    if ( returnKeys ) return Array.fromRange(pts.length);
    return pts;
  }
  // Find the points with the largest angle from center --> origin --> pt.
  // These form the viewing triangle between origin and polygon.
  // Widest points on either side of the polygon must be viewable.
  // A point not viewable on one side of polygon center would be blocked by a point with a
  // larger angle. Thus the point with the largest angle must be viewable.
  // If two points have the same angle, pick the closer. (Edge is collinear with origin.)
  // Only pick points after segregating into cw/ccw.

  const center = this.center;
  let cwPt;
  let ccwPt;
  let cwIdx = -1;
  let ccwIdx = -1;
  let maxCWAngle = Number.NEGATIVE_INFINITY;
  let maxCCWAngle = Number.NEGATIVE_INFINITY;

  for ( let i = 0; i < nPoints; i += 1 ) {
    const pt = pts[i];
    const angle = PIXI.Point.angleBetween(center, origin, pt);
    if ( testMaxCWAngle(pt, origin, center, angle, maxCWAngle) ) {
      cwPt = pt;
      maxCWAngle = angle;
      cwIdx = i;
    }
    if ( testMaxCCWAngle(pt, origin, center, angle, maxCCWAngle) ) {
      ccwPt = pt;
      maxCCWAngle = angle;
      ccwIdx = i;
    }
  }

  // Given the starting max angles, should not happen.
  if ( !cwPt ) cwPt = ccwPt;
  if ( !ccwPt ) ccwPt = cwPt;

  // Should have defined both by now.
  if ( !cwPt ) {
    console.warn("viewablePoints|Points not found", this);
    return [];
  }

  if ( cwPt.equals(ccwPt) ) return returnKeys ? [cwIdx] : [cwPt];

  if ( outermostOnly ) {
    if ( returnKeys ) return [cwIdx, ccwIdx];
    return [cwPt, ccwPt];
  }

  if ( returnKeys ) {
    // Sequentially number the indices, from cwIdx to ccwIdx. Make sure to wrap counting if needed.
    const ln = pts.length;
    const indices = [];
    for ( let i = 0; i < ln; i += 1 ) {
      const j = (cwIdx + i) % ln;
      indices.push(j);
      if ( j === ccwIdx ) break;
    }
    return indices;
  }

  // Viewable will always be from cwIdx to ccwIdx, not inclusive, b/c that is forward half for origin --> center.
  return wrapslice(pts, cwIdx, ccwIdx + 1);
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

/**
 * "Clean" this polygon and return a new one:
 * 1. No repeated points, including nearly equal points.
 * 2. No collinear points
 * 3. No closed point
 * @returns {PIXI.Polygon}    This polygon
 */
function clean({epsilon = 1e-8, epsilonCollinear = 1e-12} = {}) {
  if ( this.points.length < 4 ) return this; // Less than two points.

  const orient2d = foundry.utils.orient2dFast;
  const points = this.iteratePoints();
  const result = [points.next().value];
  for ( const curr of points ) {
    if ( result.at(-1).almostEqual(curr, epsilon) ) continue;
    while ( result.length >= 2
      && orient2d(result.at(-2), result.at(-1), curr).almostEqual(0, epsilonCollinear) ) result.pop().release();
    result.push(curr);
  }

  // Clean up where end meets beginning.
  // Loop b/c removing a point at a seam may expose a new collinearity.
  let seamClean = false;
  while ( !seamClean && result.length > 2 ) { // Length at least 3.
    seamClean = true;

    // Is the last point a duplicate of the first?
    if ( result[0].almostEqual(result.at(-1)) ) {
      result.pop().release();
      seamClean = false;
      continue;
    }

    // Is the last point redundant? (2nd-to-last -> last -> first)
    if ( orient2d(result.at(-2), result.at(-1), result[0]).almostEqual(0, epsilonCollinear) ) {
      result.pop().release();
      seamClean = false;
      continue;
    }

    // Is the first point redundant? (Last -> first -> second)
    if ( orient2d(result.at(-1), result.at(0), result[1]).almostEqual(0, epsilonCollinear) ) {
      result.shift().release(); // Remove the first point.
      seamClean = false;
      continue;
    }
  }

  // Set the points.
  const n = result.length;
  this.points.length = n * 2;
  for (let i = 0, j = 0; i < n; i += 1 ) {
    const curr = result[i];
    this.points[j++] = curr.x;
    this.points[j++] = curr.y;
  }
  this._isPositive = undefined;
  return this;
}

/**
 * Key the polygon by using JSON.stringify on the points.
 * To ensure polygons are the same even if the starting vertex is rotated,
 * find the minimum point as the start.
 */
function key() {
  const points = [...this.points];
  const ln = this.isClosed ? points.length - 2 : points.length;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minIndex = -1;
  for ( let i = 0; i < ln; i += 2 ) {
    const x = points[i];
    const y = points[i + 1];
    if ( (x < minX || x === minX) && y < minY ) {
      minIndex = i;
      minX = x;
      minY = y;
    }
  }
  const startPoints = points.splice(minIndex);
  startPoints.push(...points);
  return JSON.stringify(startPoints);
}

/**
 * Test for equality between two polygons.
 * 1. Same points
 * 2. In any order, but orientation counts.
 * @param {PIXI.Polygon} other
 * @returns {boolean}
 */
function equals(other) {
  if ( !(other instanceof PIXI.Polygon) ) return false;
  if ( this.points.length !== other.points.length ) return false;
  if ( this.isClockwise ^ other.isClockwise ) return false;

  const thisPoints = this.iteratePoints();
  const otherPoints = [...other.iteratePoints()];

  // Find the matching point
  const startPoint = thisPoints.next().value;
  const startIdx = otherPoints.findIndex(pt => pt.equals(startPoint));
  startPoint.release();
  if ( !~startIdx ) return false;

  // Test each point sequentially from each array
  let k = startIdx + 1; // +1 b/c already tested startPoint.
  const nPoints = otherPoints.length;
  for ( using thisPoint of thisPoints ) {
    k = k % nPoints;
    if ( !thisPoint.equals(otherPoints[k]) ) {
      PIXI.Point.release(...otherPoints);
      return false;
    }
    k += 1;
  }
  PIXI.Point.release(...otherPoints);
  return true;
}


/**
 * Does this polygon almost equal another in position and size?
 * 1. Same points
 * 2. In any order; orientation does not count.
 * @param {PIXI.Polygon} other
 * @param {number} [epsilon=1e-08]    Count as equal if at least this close
 * @returns {boolean}
 */
function almostEqual(other, epsilon = 1e-08) {
  if ( !(other instanceof PIXI.Polygon) ) return false;
  if ( this.points.length !== other.points.length ) return false;

  const thisPoints = this.iteratePoints();
  const otherPoints = [...other.iteratePoints()];
  if ( this.isClockwise ^ other.isClockwise ) otherPoints.reverse();

  // Find the matching point
  const startPoint = thisPoints.next().value;
  const startIdx = otherPoints.findIndex(pt => pt.equals(startPoint));
  startPoint.release();
  if ( !~startIdx ) return false;

  // Test each point sequentially from each array
  let k = startIdx + 1; // +1 b/c already tested startPoint.
  const nPoints = otherPoints.length;
  for ( using thisPoint of thisPoints ) {
    k = k % nPoints;
    if ( !thisPoint.almostEqual(otherPoints[k], epsilon) ) {
      PIXI.Point.release(...otherPoints);
      return false;
    }
    k += 1;
  }
  PIXI.Point.release(...otherPoints);
  return true;
}


/**
 * Cutaway a line segment start|end that moves through this polygon.
 * Depending on the line and the polygon, could have multiple quads.
 * @param {Point3d} a     Starting endpoint for the segment
 * @param {Point3d} b       Ending endpoint for the segment
 * @param {object} [opts]
 * @param {Point3d} [opts.start]              Starting endpoint for the segment
 * @param {Point3d} [opts.end]                Ending endpoint for the segment
 * @param {number} [opts.top=1e06]        Top (elevation in pixel units) of the polygon
 * @param {number} [opts.bottom=-1e06]    Bottom (elevation in pixel units) of the polygon
 * @returns {CutawayPolygon[]}
 */
function cutaway(a, b, opts = {}) {
  return CutawayPolygon.cutawayBasicShape(this, a, b, { isHole: !this.isPositive, ...opts }); // Avoid setting the isHole parameter in opts; will get overriden if set in opts.
}

/**
 * Can this polygon be triangulated using a fan?
 * @param {PIXI.Point} centroid       Assumed center point
 * @returns {boolean}
 */
function canUseFanTriangulation(centroid) {
  centroid ??= this.center;
  if ( !this.contains(centroid.x, centroid.y) ) return false;
  const lines = [...this.iteratePoints()].map(b => {
    return { a: centroid, b };
  });
  const out = !this.linesCross(lines); // Lines cross ignores lines that only share endpoints.
  lines.forEach(l => l.b.release());
  return out;
}

/**
 * Triangulate the polygon.
 * @param {useFan} [useFan]    Use fan algorithm to triangulate if possible. Only works if the lines don't cross.
 *   True forces the fan and does not check
 * @returns {PIXI.Polygon[]} Array of triangle polygons
 */
function triangulate({ useFan, centroid } = {}) {
  const pts = this.points;
  centroid ??= this.center;
  if ( typeof useFan === "undefined" ) useFan = this.canUseFanTriangulation(centroid);
  if ( useFan ) {
    const center = [centroid.x, centroid.y];
    const ln = pts.length;
    const polys = new Array(ln / 2);
    let a = pts.slice(ln - 2, ln); // i, i + 2 for the very last point; cycle through to beginning.
    for ( let i = 0, j = 0; i < ln; i += 2) {
      const b = pts.slice(i, i + 2);
      polys[j++] = new PIXI.Polygon(...center, ...a, ...b);
      a = b;
    }
    return polys;
  }

  // Use earcut.
  const indices = PIXI.utils.earcut(pts);
  const ln = indices.length;
  const polys = new Array(ln / 3);
  for ( let i = 0, j = 0; i < ln; ) {
    const idx0 = indices[i++];
    const idx1 = indices[i++];
    const idx2 = indices[i++];
    polys[j++] = new PIXI.Polygon(
      pts[idx0], pts[idx0 + 1], // x, y
      pts[idx1], pts[idx1 + 1],
      pts[idx2], pts[idx2 + 1],
    );
  }
  return polys;
}

/**
 * Create a grid of points within this polygon.
 * @param {object} [opts]
 * @param {number} [opts.spacing = 1]              How many pixels between each point?
 * @param {boolean} [opts.startAtEdge = false]     Are points allowed within spacing of the edges? Otherwise will be at least spacing away.
 * @returns {PIXI.Point[]} Points in order from left to right, top to bottom.
 */
function pointsLattice({ spacing = 1, startAtEdge = false } = {}) {
  const poly = startAtEdge ? this : this.clone().pad(-spacing);
  const bounds = poly.getBounds();
  const pts = bounds.pointsLattice({ spacing, startAtEdge: true }); // Start at edge b/c already padded the polygon.

  // For arbitrary polygon, unfortunately have to test the bounds for each.
  return pts.filter(pt => this.contains(pt.x, pt.y));
}


PATCHES.PIXI.GETTERS = {
  area,
  center: centroid,
  isClockwise,
  key
};

PATCHES.PIXI.METHODS = {
  // Iterators
  iterateEdges,
  iteratePoints,
  reverseIteratePoints,
  reverseIterateEdges,

  // Equality
  equals,
  almostEqual,

  // Triangulation
  triangulate,
  canUseFanTriangulation,

  // Transform
  translate,
  scale,
  centerScale,

  // Other methods
  toPolygon: function() { return this; },
  clean,
  clipperClip,
  isSegmentEnclosed,
  linesCross,
  lineSegmentIntersects,
  lineSegmentCrosses: lineSegmentCrossesPolygon,
  pad,
  lineIntersections,
  segmentIntersections,
  pointsBetween,
  viewablePoints,
  pointsLattice,

  // Overlap methods
  overlaps,
  _overlapsPolygon,
  _overlapsCircle,

  // Envelop methods
  envelops,
  _envelopsCircle,
  _envelopsRectangle,
  _envelopsPolygon,
  _envelopsPoint,

  // 2d cutaway
  cutaway,

  // Helper/internal methods
  scaledArea
};

PATCHES.PIXI.STATIC_METHODS = {
  convexHull
};





