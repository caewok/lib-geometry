/* globals
CONFIG,
canvas,
foundry,
Drawing,
PIXI
*/
"use strict";

import "./CenteredPolygon/CenteredRectangle.js";
import "./CenteredPolygon/CenteredPolygon.js";
import "./Ellipse.js";
import "./3d/Point3d.js";
import { GEOMETRY_CONFIG } from "./const.js";

// Functions that would go in foundry.utils if that object were extensible
export function registerFoundryUtilsMethods() {
  GEOMETRY_CONFIG.registered ??= new Set();
  if ( GEOMETRY_CONFIG.registered.has("utils") ) return;

  GEOMETRY_CONFIG.utils = {
    orient3dFast,
    quadraticIntersection,
    lineCircleIntersection,
    lineSegment3dPlaneIntersects,
    lineSegmentCrosses,
    gridUnitsToPixels,
    pixelsToGridUnits,
    perpendicularPoint,
    centeredPolygonFromDrawing,
    shortestRouteBetween3dLines,
    isOnSegment,
    categorizePointsInOutConvexPolygon,
    lineLineIntersection,
    bresenhamLine,
    bresenhamLineIterator,
    bresenhamLine3d,
    bresenhamLine3dIterator,
    bresenhamLine4d,
    trimLineSegmentToPixelRectangle,
    doSegmentsOverlap,
    findOverlappingPoints,
    IX_TYPES,
    segmentCollision,
    endpointIntersection,
    segmentIntersection,
    segmentOverlap,
    roundDecimals,
    cutaway: {
      to2d: to2dCutaway,
      from2d: from2dCutaway,
      convertToDistance: convertToDistanceCutaway,
      convertToElevation: convertToElevationCutaway,
      convertFromDistance: convertFromDistanceCutaway,
      convertFromElevation: convertFromElevationCutaway
    }
  };


  // Simple extensions
  Math.minMax = function(...args) {
    return args.reduce((acc, curr) => {
      acc.min = Math.min(acc.min, curr);
      acc.max = Math.max(acc.max, curr);
      return acc;
    }, { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY});
  };
  CONFIG.GeometryLib.registered.add("utils");
}

/**
 * Round numbers that are close to 0 or 1.
 * @param {number} n            Number to round
 * @param {number} [epsilon]    Passed to almostEqual
 */
export function roundNearWhole(n, epsilon) {
  const roundedN = Math.round(n);
  if ( n.almostEqual(roundedN, epsilon) ) return roundedN;
  return n;
}

/**
 * Is this number even?
 * @param {number} n
 * @returns {boolean}
 */
export function isEven(n) { return  ~n & 1; }

/**
 * Is this number odd?
 * @param {number} n
 * @returns {boolean}
 */
export function isOdd(n) { return n & 1; }

/**
 * Calculate the unit elevation for a given set of coordinates.
 * @param {number} elevation    Elevation in grid units
 * @returns {number} Elevation in number of grid steps.
 */
export function unitElevation(elevation) { return Math.round(elevation / canvas.scene.dimensions.distance); }

/**
 * Calculate the grid unit elevation from unit elevation.
 * Inverse of `unitElevation`.
 * @param {number} k            Unit elevation
 * @returns {number} Elevation in grid units
 */
export function elevationForUnit(k) { return roundNearWhole(k * canvas.scene.dimensions.distance); }

/**
 * @typedef {PIXI.Point} CutawayPoint
 * A point in cutaway space.
 * @param {number} x      Distance-squared from start point
 * @param {number} y      Elevation in pixel units
 */

/**
 * Convert a point on a line to a coordinate representing the line direction in the x direction
 * and the elevation in the y direction.
 *
 * @param {RegionMovementWaypoint3d} currPt      A point on the line start|end
 * @param {RegionMovementWaypoint3d} start       Beginning endpoint of the line segment
 * @param {RegionMovementWaypoint3d} [end]       End of the line segment; required only if the current point is before start
 * @param {PIXI.Point} [outPoint]
 * @returns {CutawayPoint} X value is 0 at start, negative if further from end than start.
 *  - x: Distance-squared from start, in direction of end.
 *  - y: Elevation in pixel units
 */
function to2dCutaway(currPt, start, end, outPoint) {
  outPoint ??= new PIXI.Point();
  const distCS = PIXI.Point.distanceSquaredBetween(currPt, start);

  const pt = outPoint.set(distCS, currPt.z);
  if ( end ) {
    const distCE = PIXI.Point.distanceSquaredBetween(currPt, end);
    const distSE = PIXI.Point.distanceSquaredBetween(start, end);
    if ( distCS < distCE && distCE > distSE ) pt.x *= -1;
  }
  return pt;
}

/* Identifying locations on the 1d line.
currPt ---> start ---> end
dist(currPt, start) < dist(currPt, end) && dist(currPt, end) > dist(start, end)

start ---> currPt ---> end
dist(start, end) > dist(start, currPt) && dist(start, end) > dist(end, currPt)

start ---> end ---> currPt
dist(end, currPt) < dist(start, currPt) && dist(currPt, start) > dist(start, end)
*/

/**
 * Convert a cutaway point to its respective position on the line start|end.
 * @param {CutawayPoint} cutawayPt      2d cutaway point created from _to2dCutaway
 * @param {RegionMovementWaypoint3d} start             Beginning endpoint of the line segment
 * @param {RegionMovementWaypoint3d} end               End of the line segment
 * @param {RegionMovementWaypoint3d} [outPoint]
 * @returns {RegionMovementWaypoint3d}
 */
function from2dCutaway(cutawayPt, start, end, outPoint) {
  outPoint ??= new CONFIG.GeometryLib.threeD.RegionMovementWaypoint3d();
  // b/c outPoint is 3d, makes sure to get the 2d values.
  const xy = start.to2d().towardsPointSquared(end, cutawayPt.x, PIXI.Point._tmp);
  outPoint.x = xy.x;
  outPoint.y = xy.y;
  outPoint.z = cutawayPt.y;
  return outPoint;
}

/**
 * Convert a cutaway point to use distance instead of distance squared.
 * @param {CutawayPoint} cutawayPt
 * @returns {PIXI.Point} The same point, modified in place.
 */
function convertToDistanceCutaway(cutawayPt) {
  const sign = Math.sign(cutawayPt.x);
  cutawayPt.x =  sign * Math.sqrt(Math.abs(cutawayPt.x));
  return cutawayPt;
}

/**
 * Convert a cutaway point to use grid elevation instead of pixel units for y.
 * @param {CutawayPoint} cutawayPt
 * @returns {PIXI.Point} The same point, modified in place.
 */
function convertToElevationCutaway(cutawayPt) {
  cutawayPt.y = pixelsToGridUnits(cutawayPt.y);
  return cutawayPt;
}

/**
 * Convert a cutaway point to use distance-squared instead of distance.
 * @param {CutawayPoint} cutawayPt
 * @returns {PIXI.Point} The same point, modified in place.
 */
function convertFromDistanceCutaway(cutawayPt) {
  const sign = Math.sign(cutawayPt.x);
  cutawayPt.x = sign * Math.pow(cutawayPt.x, 2);
  return cutawayPt;
}

/**
 * Convert a cutaway point to use pixel units instead of grid units for y.
 * @param {CutawayPoint} cutawayPt
 * @returns {PIXI.Point} The same point, modified in place.
 */
function convertFromElevationCutaway(cutawayPt) {
  cutawayPt.y = gridUnitsToPixels(cutawayPt.y);
  return cutawayPt;
}

/**
 * Formerly Math.roundDecimals before Foundry v12.
 * @param {number} number     The number to round
 * @param {number} places     Number of places past the decimal point to round
 * @returns {number}
 */
function roundDecimals(number, places) { return Number(number.toFixed(places)); }

// Just like foundry.utils.lineLineIntersection but with the typo in t1 calculation fixed.
function lineLineIntersection(a, b, c, d, {t1=false}={}) {

  // If either line is length 0, they cannot intersect
  if (((a.x === b.x) && (a.y === b.y)) || ((c.x === d.x) && (c.y === d.y))) return null;

  // Check denominator - avoid parallel lines where d = 0
  const dnm = ((d.y - c.y) * (b.x - a.x) - (d.x - c.x) * (b.y - a.y));
  if (dnm === 0) return null;

  // Vector distances
  const t0 = ((d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)) / dnm;
  t1 = t1 ? ((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / dnm : undefined;

  // Return the point of intersection
  return {
    x: a.x + t0 * (b.x - a.x),
    y: a.y + t0 * (b.y - a.y),
    t0: t0,
    t1: t1
  };
}


/**
 * This method is only guaranteed to work for convex polygons
 * Determine if one or more points are within the polygon.
 * On the edge does not count.
 * Note: will force the polygon to clockwise orientation.
 * @param {PIXI.Polygon} poly   Convex polygon to test.
 * @param {Point[]} points
 * @param {epsilon}   Tolerance for near zero.
 * @returns {object} Object containing the points, with arrays of inside, on edge, outside points.
 */
function categorizePointsInOutConvexPolygon(poly, points, epsilon = 1e-08) {
   const isOnSegment = CONFIG.GeometryLib.utils.isOnSegment;

  // Need to walk around the edges in clockwise order.
  if ( !poly.isClockwise ) poly.reverseOrientation();
  const edges = poly.iterateEdges({ close: true });
  const out = {
    inside: [],
    on: [],
    outside: []
  };

  // For each point, test if the point is on the edge ("on").
  // If not on edge, test if clockwise. If not CW, then it is outside.
  const nPts = points.length;
  const isCW = new Array(nPts).fill(true);
  let found = 0;
  for ( const edge of edges ) {
    for ( let i = 0; i < nPts; i += 1 ) {
      let ptIsCW = isCW[i];
      if ( !ptIsCW ) continue;

      const pt = points[i];
      if ( isOnSegment(edge.A, edge.B, pt, epsilon) ) {
        ptIsCW = false;
        out.on.push(pt);
        found += 1;
      } else {
        let oPt = foundry.utils.orient2dFast(edge.A, edge.B, pt);
        if  ( oPt.almostEqual(0, epsilon) ) oPt = 0;
        ptIsCW &&= oPt < 0;
        if ( !ptIsCW ) {
          out.outside.push(pt);
          found += 1;
        }
      }
    }
    if ( found === nPts ) return out;
  }

  // The remaining CW points are all inside.
  for ( let i = 0; i < nPts; i += 1 ) {
    if ( isCW[i] ) out.inside.push(points[i]);
  }

  return out;
}

/**
 * Determine if a point is on a segment, with a tolerance for nearly on the segment.
 * @param {Point} a   Endpoint A of the segment A|B
 * @param {Point} b   Endpoint B of the segment A|B
 * @param {Point} c   Point to test
 * @param {epsilon}   Tolerance for near zero.
 * @returns {boolean}
 */
function isOnSegment(a, b, c, epsilon = 1e-08) {
  // Confirm point is with bounding box formed by A|B
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x);
  const maxY = Math.max(a.y, b.y);

  if ( (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY)
    && !(c.x.almostEqual(minX) && c.x.almostEqual(maxX) && c.y.almostEqual(minY) && c.y.almostEqual(maxY)) ) {
    return false;
  }

  // If not collinear, then not on segment.
  const orient = foundry.utils.orient2dFast(a, b, c);
  if ( !orient.almostEqual(0, epsilon) ) return false;

  // We already know we are within the bounding box, so if collinear, must be on the segment.
  return true;
}

/**
 * Shortest line segment between two 3d lines
 * http://paulbourke.net/geometry/pointlineplane/
 * http://paulbourke.net/geometry/pointlineplane/lineline.c
 * @param {Point3d} a   Endpoint of line AB
 * @param {Point3d} b   Endpoint of line AB
 * @param {Point3d} c   Endpoint of line CD
 * @param {Point3d} d   Endpoint of line CD
 * @param {number} epsilon  Consider this value or less to be zero
 * @returns {object|null} {A: Point3d, B: Point3d}
 */
function shortestRouteBetween3dLines(a, b, c, d, epsilon = 1e-08) {
  const deltaDC = d.subtract(c);
  if ( Math.abs(deltaDC.x) < epsilon
    && Math.abs(deltaDC.y) < epsilon
    && Math.abs(deltaDC.z) < epsilon ) return null;


  const deltaBA = b.subtract(a);
  if ( Math.abs(deltaBA.x) < epsilon
    && Math.abs(deltaBA.y) < epsilon
    && Math.abs(deltaBA.z) < epsilon ) return null;

  const deltaAC = a.subtract(c);

  const dotACDC = deltaAC.dot(deltaDC);
  const dotDCBA = deltaDC.dot(deltaBA);
  const dotACBA = deltaAC.dot(deltaBA);
  const dotDCDC = deltaDC.dot(deltaDC);
  const dotBABA = deltaBA.dot(deltaBA);

  const denom = (dotBABA * dotDCDC) - (dotDCBA * dotDCBA);
  if ( Math.abs(denom) < epsilon ) return null;

  const numer = (dotACDC * dotDCBA) - (dotACBA * dotDCDC);
  const mua = numer / denom;
  const mub = (dotACDC + (dotDCBA * mua)) / dotDCDC;

  return {
    A: deltaBA.multiplyScalar(mua).add(a),
    B: deltaDC.multiplyScalar(mub).add(c),
    mua,
    mub
  };
}

// Simple extensions
Math.minMax = function(...args) {
  return args.reduce((acc, curr) => {
    acc.min = Math.min(acc.min, curr);
    acc.max = Math.max(acc.max, curr);
    return acc;
  }, { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY});
};

Math.PI_1_2 = Math.PI * 0.5;

/**
 * Construct a centered polygon using the values in drawing shape.
 * @param {Drawing} drawing
 * @returns {CenteredPolygonBase}
 */
function centeredPolygonFromDrawing(drawing) {
  switch ( drawing.document.shape.type ) {
    case Drawing.SHAPE_TYPES.RECTANGLE:
      return CONFIG.GeometryLib.CenteredPolygons.CenteredRectangle.fromDrawing(drawing);
    case Drawing.SHAPE_TYPES.ELLIPSE:
      return CONFIG.GeometryLib.Ellipse.fromDrawing(drawing);
    case Drawing.SHAPE_TYPES.POLYGON:
      return CONFIG.GeometryLib.CenteredPolygons.CenteredPolygon.fromDrawing(drawing);
    case Drawing.SHAPE_TYPES.CIRCLE: {
      const width = drawing.document.shape.width;
      return PIXI.Circle(drawing.document.x + width * 0.5, drawing.document.y + width * 0.5, width);
    }
    default:
      console.error("fromDrawing shape type not supported");
  }
}

/**
 * Get the point on a line AB that forms a perpendicular line to a point C.
 * From https://stackoverflow.com/questions/10301001/perpendicular-on-a-line-segment-from-a-given-point
 * This is basically simplified vector projection: https://en.wikipedia.org/wiki/Vector_projection
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @return {Point} The point on line AB or null if a,b,c are collinear. Not
 *                 guaranteed to be within the line segment a|b.
 */
function perpendicularPoint(a, b, c) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dab = Math.pow(dx, 2) + Math.pow(dy, 2);
  if ( !dab ) return null;

  const u = (((c.x - a.x) * dx) + ((c.y - a.y) * dy)) / dab;
  return {
    x: a.x + (u * dx),
    y: a.y + (u * dy)
  };
}

/**
 * Convert a grid units value to pixel units, for equivalency with x,y values.
 * @param {number} value
 * @returns {number}
 */
export function gridUnitsToPixels(value) { return value * canvas.dimensions.distancePixels; }

/**
 * Convert pixel units (x,y,z) to grid units
 * @param {number} pixels
 * @returns {number}
 */
export function pixelsToGridUnits(pixels) { return pixels / canvas.dimensions.distancePixels; }

/**
 * Like foundry.utils.lineSegmentIntersects but requires the two segments cross.
 * In other words, sharing endpoints or an endpoint on the other segment does not count.
 * @param {Point} a                   The first endpoint of segment AB
 * @param {Point} b                   The second endpoint of segment AB
 * @param {Point} c                   The first endpoint of segment CD
 * @param {Point} d                   The second endpoint of segment CD
 * @param {epsilon}   Tolerance for near zero.
 * @returns {boolean}                 Do the line segments cross?
 */
function lineSegmentCrosses(a, b, c, d, epsilon = 1e-08) {
  let xa = foundry.utils.orient2dFast(a, b, c);
  if ( xa.almostEqual(0, epsilon) ) return false;

  let xb = foundry.utils.orient2dFast(a, b, d);
  if ( xb.almostEqual(0, epsilon) ) return false;

  let xc = foundry.utils.orient2dFast(c, d, a);
  if ( xc.almostEqual(0, epsilon) ) return false;

  let xd = foundry.utils.orient2dFast(c, d, b);
  if ( xd.almostEqual(0, epsilon) ) return false;

  const xab = (xa * xb) < 0; // Cannot be equal to 0.
  const xcd = (xc * xd) < 0; // Cannot be equal to 0.

  return xab && xcd;
}

/**
 * Quickly test whether the line segment AB intersects with a plane.
 * This method does not determine the point of intersection, for that use lineLineIntersection.
 * Each Point3d should have {x, y, z} coordinates.
 *
 * @param {Point3d} a   The first endpoint of segment AB
 * @param {Point3d} b   The second endpoint of segment AB
 * @param {Point3d} c   The first point defining the plane
 * @param {Point3d} d   The second point defining the plane
 * @param {Point3d} e   The third point defining the plane.
 *                      Optional. Default is for the plane to go up in the z direction.
 *
 * @returns {boolean} Does the line segment intersect the plane?
 * Note that if the segment is part of the plane, this returns false.
 */
function lineSegment3dPlaneIntersects(a, b, c, d, e = { x: c.x, y: c.y, z: c.z + 1 }) {
  // A and b must be on opposite sides.
  // Parallels the 2d case.
  const xa = CONFIG.GeometryLib.utils.orient3dFast(a, c, d, e);
  const xb = CONFIG.GeometryLib.utils.orient3dFast(b, c, d, e);
  return xa * xb <= 0;
}

/**
 * Adapted from https://github.com/mourner/robust-predicates/blob/main/src/orient3d.js
 * @param {Point3d} a   Point in the plane
 * @param {Point3d} b   Point in the plane
 * @param {Point3d} c   Point in the plane
 * @param {Point3d} d   Point to test
 * @returns {boolean}
 *   - Returns a positive value if the point d lies above the plane passing through a, b, and c,
 *     meaning that a, b, and c appear in counterclockwise order when viewed from d.
 *   - Returns a negative value if d lies below the plane.
 *   - Returns zero if the points are coplanar.
 */
function orient3dFast(a, b, c, d) {
  const adx = a.x - d.x;
  const bdx = b.x - d.x;
  const cdx = c.x - d.x;
  const ady = a.y - d.y;
  const bdy = b.y - d.y;
  const cdy = c.y - d.y;
  const adz = a.z - d.z;
  const bdz = b.z - d.z;
  const cdz = c.z - d.z;

  return (adx * ((bdy * cdz) - (bdz * cdy)))
    + (bdx * ((cdy * adz) - (cdz * ady)))
    + (cdx * ((ady * bdz) - (adz * bdy)));
}

/**
 * Determine the points of intersection between a line segment (p0,p1) and a circle.
 * There will be zero, one, or two intersections
 * See https://math.stackexchange.com/a/311956
 * @memberof helpers
 *
 * @param {Point} p0            The initial point of the line segment
 * @param {Point} p1            The terminal point of the line segment
 * @param {Point} center        The center of the circle
 * @param {number} radius       The radius of the circle
 * @param {number} [epsilon=0]  A small tolerance for floating point precision
 */
function quadraticIntersection(p0, p1, center, radius, epsilon=0) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;

  // Quadratic terms where at^2 + bt + c = 0
  const a = Math.pow(dx, 2) + Math.pow(dy, 2);
  const b = (2 * dx * (p0.x - center.x)) + (2 * dy * (p0.y - center.y));
  const c = Math.pow(p0.x - center.x, 2) + Math.pow(p0.y - center.y, 2) - Math.pow(radius, 2);

  // Discriminant
  const disc2 = Math.pow(b, 2) - (4 * a * c);
  if ( disc2 < 0 ) return []; // No intersections

  // Roots
  const disc = Math.sqrt(disc2);
  const t1 = (-b - disc) / (2 * a);
  const t2 = (-b + disc) / (2 * a);
  // If t1 hits (between 0 and 1) it indicates an "entry"
  const intersections = [];
  if ( t1.between(0-epsilon, 1+epsilon) ) {
    intersections.push({
      x: p0.x + (dx * t1),
      y: p0.y + (dy * t1)
    });
  }

  // If the discriminant is exactly 0, a segment endpoint touches the circle
  // (and only one intersection point)
  if ( disc2.almostEqual(0) ) return intersections; // <-- Only change from Foundry

  // If t2 hits (between 0 and 1) it indicates an "exit"
  if ( t2.between(0-epsilon, 1+epsilon) ) {
    intersections.push({
      x: p0.x + (dx * t2),
      y: p0.y + (dy * t2)
    });
  }
  return intersections;
}

/**
 * Determine the intersection between a candidate wall and the circular radius of the polygon.
 * Overriden here to use the amended quadraticIntersection function
 * @memberof helpers
 *
 * @param {Point} a                   The initial vertex of the candidate edge
 * @param {Point} b                   The second vertex of the candidate edge
 * @param {Point} center              The center of the bounding circle
 * @param {number} radius             The radius of the bounding circle
 * @param {number} epsilon            A small tolerance for floating point precision
 *
 * @returns {LineCircleIntersection}  The intersection of the segment AB with the circle
 */
function lineCircleIntersection(a, b, center, radius, epsilon=1e-8) {
  const r2 = Math.pow(radius, 2);
  let intersections = [];

  // Test whether endpoint A is contained
  const ar2 = Math.pow(a.x - center.x, 2) + Math.pow(a.y - center.y, 2);
  const aInside = ar2 <= r2 - epsilon;

  // Test whether endpoint B is contained
  const br2 = Math.pow(b.x - center.x, 2) + Math.pow(b.y - center.y, 2);
  const bInside = br2 <= r2 - epsilon;

  // Find quadratic intersection points
  const contained = aInside && bInside;
  if ( !contained ) {
    intersections = CONFIG.GeometryLib.utils.quadraticIntersection(a, b, center, radius, epsilon);
  }

  // Return the intersection data
  return {
    aInside,
    bInside,
    contained,
    outside: !contained && !intersections.length,
    tangent: !aInside && !bInside && intersections.length === 1,
    intersections
  };
}

/**
 * Helper to add a method to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 */
export function addClassMethod(cl, name, fn) {
  Object.defineProperty(cl, name, {
    value: fn,
    writable: true,
    configurable: true
  });
}

/**
 * Helper to add a getter to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 */
export function addClassGetter(cl, name, getter, setter) {
  if ( Object.hasOwn(cl, name) ) return;
  Object.defineProperty(cl, name, {
    get: getter,
    configurable: true
  });

  if ( setter ) {
    Object.defineProperty(cl, name, {
      set: setter,
      configurable: true
    });
  }
}

/**
 * Fast rounding for positive numbers
 * @param {number} n
 * @returns {number}
 */
export function roundFastPositive(n) { return (n + 0.5) << 0; }

/**
 * Bresenham line algorithm to generate pixel coordinates for a line between two points.
 * All coordinates must be positive or zero.
 * @param {number} x0   First coordinate x value
 * @param {number} y0   First coordinate y value
 * @param {number} x1   Second coordinate x value
 * @param {number} y1   Second coordinate y value
 * @testing
Draw = CONFIG.GeometryLib.Draw
let [t0, t1] = canvas.tokens.controlled
pixels = bresenhamLine(t0.center.x, t0.center.y, t1.center.x, t1.center.y)
for ( let i = 0; i < pixels.length; i += 2 ) {
  Draw.point({ x: pixels[i], y: pixels[i + 1]}, { radius: 1 });
}
 */
export function bresenhamLine(x0, y0, x1, y1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;
  let err = dx - dy;

  const pixels = [x0, y0];
  while ( x0 !== x1 || y0 !== y1 ) {
    const e2 = err * 2;
    if ( e2 > -dy ) {
      err -= dy;
      x0 += sx;
    }
    if ( e2 < dx ) {
      err += dx;
      y0 += sy;
    }

    pixels.push(x0, y0);
  }
  return pixels;
}

/**
 * Bresenham line algorithm to generate pixel coordinates for a line between two points.
 * All coordinates must be positive or zero.
 * @param {Point} a   Start position of the segment
 * @param {Point} b   End position of the segment
 * @returns {Iterator<PIXI.Point>}
 */
export function* bresenhamLineIterator(a, b) {
  a = PIXI.Point._tmp.set(Math.floor(a.x), Math.floor(a.y));
  b = PIXI.Point._tmp2.set(Math.floor(b.x), Math.floor(b.y));

  const delta = b.subtract(a, PIXI.Point._tmp3);
  delta.x = Math.abs(delta.x);
  delta.y = Math.abs(delta.y);

  const sx = (a.x < b.x) ? 1 : -1;
  const sy = (a.y < b.y) ? 1 : -1;
  let err = delta.x - delta.y;
  yield a.clone();
  while ( a.x !== b.x || a.y !== b.y ) {
    const e2 = err * 2;
    if ( e2 > -delta.y ) {
      err -= delta.y;
      a.x += sx;
    }
    if ( e2 < delta.x ) {
      err += delta.x;
      a.y += sy;
    }
    yield a.clone();
  }
}

/**
 * Bresenham line algorithm to generate pixel coordinates for a line between two 3d points.
 * https://www.geeksforgeeks.org/bresenhams-algorithm-for-3-d-line-drawing/
 * All coordinates must be positive or zero.
 * @param {number} x0   First coordinate x value
 * @param {number} y0   First coordinate y value
 * @param {number} z0   First coordinate y value
 * @param {number} x1   Second coordinate x value
 * @param {number} y1   Second coordinate y value
 * @param {number} z1   Second coordinate z value
 * @testing
Draw = CONFIG.GeometryLib.Draw
let [t0, t1] = canvas.tokens.controlled
pixels = bresenhamLine(t0.center.x, t0.center.y, t1.center.x, t1.center.y)
for ( let i = 0; i < pixels.length; i += 2 ) {
  Draw.point({ x: pixels[i], y: pixels[i + 1]}, { radius: 1 });
}
 */
export function bresenhamLine3d(x0, y0, z0, x1, y1, z1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  z0 = Math.round(z0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  z1 = Math.round(z1);
  const pixels = [x0, y0, z0];

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const dz = Math.abs(z1 - z0);

  const dx2 = dx * 2;
  const dy2 = dy * 2;
  const dz2 = dz * 2;

  const sx = (x1 > x0) ? 1 : -1;
  const sy = (y1 > y0) ? 1 : -1;
  const sz = (z1 > z0) ? 1 : -1;

  // Driving axis is X-axis
  if ( dx >= dy && dx >= dz ) {
    let p0 = dy2 - dx;
    let p1 = dz2 - dx;
    while ( x0 !== x1 ) {
      x0 += sx;
      if ( p0 >= 0 ) {
        y0 += sy;
        p0 -= dx2;
      }
      if ( p1 >= 0 ) {
        z0 += sz;
        p1 -= dx2;
      }
      p0 += dy2;
      p1 += dz2;
      pixels.push(x0, y0, z0);
    }

  // Driving axis is Y-axis
  } else if ( dy >= dx && dy >= dz ) {
    let p0 = dx2 - dy;
    let p1 = dz2 - dy;
    while ( y0 !== y1 ) {
      y0 += sy;
      if ( p0 >= 0 ) {
        x0 += sx;
        p0 -= dy2;
      }
      if ( p1 >= 0 ) {
        z0 += sz;
        p1 -= dy2;
      }
      p0 += dx2;
      p1 += dz2;
      pixels.push(x0, y0, z0);
    }

  // Driving axis is z-axis
  } else {
    let p0 = dy2 - dz;
    let p1 = dx2 - dz;
    while ( z0 != z1 ) {
      z0 += sz;
      if ( p0 >= 0 ) {
        y0 += sy;
        p0 -= dz2;
      }
      if ( p1 >= 0 ) {
        x0 += sx;
        p1 -= dz2;
      }
      p0 += dy2;
      p1 += dx2;
      pixels.push(x0, y0, z0);
    }
  }
  return pixels;
}

/**
 * Bresenham line algorithm to generate pixel coordinates for a line between two 3d points.
 * https://www.geeksforgeeks.org/bresenhams-algorithm-for-3-d-line-drawing/
 * All coordinates must be positive or zero.
 * @param {Point3d} a   Start position of the segment
 * @param {Point3d} b   End position of the segment
 * @returns {Iterator<Point3d>}
 * @testing
 */
export function* bresenhamLine3dIterator(a, b) {
  const Point3d = CONFIG.GeometryLib.threeD.Point3d;
  a = Point3d._tmp.copyFrom(a);
  b = Point3d._tmp2.copyFrom(b);
  a.roundDecimals();
  b.roundDecimals();
  yield a.clone();

  const delta = b.subtract(a, Point3d._tmp3);
  delta.x = Math.abs(delta.x);
  delta.y = Math.abs(delta.y);
  delta.z = Math.abs(delta.z);
  const delta2 = delta.multiplyScalar(2);

  const sx = (b.x > a.x) ? 1 : -1;
  const sy = (b.y > a.y) ? 1 : -1;
  const sz = (b.z > a.z) ? 1 : -1;

  // Driving axis is X-axis
  if ( delta.x >= delta.y && delta.x >= delta.z ) {
    let p0 = delta2.y - delta.x;
    let p1 = delta2.z - delta.x;
    while ( a.x !== b.x ) {
      a.x += sx;
      if ( p0 >= 0 ) {
        a.y += sy;
        p0 -= delta2.x;
      }
      if ( p1 >= 0 ) {
        a.z += sz;
        p1 -= delta2.x;
      }
      p0 += delta2.y;
      p1 += delta2.z;
      yield a.clone();
    }

  // Driving axis is Y-axis
  } else if ( delta.y >= delta.x && delta.y >= delta.z ) {
    let p0 = delta2.x - delta.y;
    let p1 = delta2.z - delta.y;
    while ( a.y !== b.y ) {
      a.y += sy;
      if ( p0 >= 0 ) {
        a.x += sx;
        p0 -= delta2.y;
      }
      if ( p1 >= 0 ) {
        a.z += sz;
        p1 -= delta2.y;
      }
      p0 += delta2.x;
      p1 += delta2.z;
      yield a.clone();
    }

  // Driving axis is z-axis
  } else {
    let p0 = delta2.y - delta.z;
    let p1 = delta2.x - delta.z;
    while ( a.z !== b.z ) {
      a.z += sz;
      if ( p0 >= 0 ) {
        a.y += sy;
        p0 -= delta2.z;
      }
      if ( p1 >= 0 ) {
        a.x += sx;
        p1 -= delta2.z;
      }
      p0 += delta2.y;
      p1 += delta2.x;
      a.clone();
    }
  }
}

/**
 * Bresenham line algorithm to generate pixel coordinates for a line between two 4d points.
 * https://www.geeksforgeeks.org/bresenhams-algorithm-for-3-d-line-drawing/
 * All coordinates must be positive or zero.
 * @param {number} x0   First coordinate x value
 * @param {number} y0   First coordinate y value
 * @param {number} z0   First coordinate z value
 * @param {number} k0   First coordinate k value
 * @param {number} x1   Second coordinate x value
 * @param {number} y1   Second coordinate y value
 * @param {number} z1   Second coordinate z value
 * @param {number} k1   Second coordinate k value
 */
export function bresenhamLine4d(x0, y0, z0, k0, x1, y1, z1, k1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  z0 = Math.round(z0);
  k0 = Math.round(k0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  z1 = Math.round(z1);
  k1 = Math.round(k1);
  const pixels = [x0, y0, z0, k0];

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const dz = Math.abs(z1 - z0);
  const dk = Math.abs(k1 - k0);

  const dx2 = dx * 2;
  const dy2 = dy * 2;
  const dz2 = dz * 2;
  const dk2 = dk * 2;

  const sx = (x1 > x0) ? 1 : -1;
  const sy = (y1 > y0) ? 1 : -1;
  const sz = (z1 > z0) ? 1 : -1;
  const sk = (k1 > k0) ? 1 : -1;

  // Driving axis is X-axis
  if ( dx >= dy && dx >= dz && dx >= dk ) {
    let p0 = dy2 - dx;
    let p1 = dz2 - dx;
    let p2 = dk2 - dx;
    while ( x0 !== x1 ) {
      x0 += sx;
      if ( p0 >= 0 ) {
        y0 += sy;
        p0 -= dx2;
      }
      if ( p1 >= 0 ) {
        z0 += sz;
        p1 -= dx2;
      }
      if ( p2 >= 0 ) {
        k0 += sk;
        p2 -= dx2;
      }
      p0 += dy2;
      p1 += dz2;
      p2 += dk2;
      pixels.push(x0, y0, z0, k0);
    }

  // Driving axis is Y-axis
  } else if ( dy >= dx && dy >= dz && dy >= dk ) {
    let p0 = dx2 - dy;
    let p1 = dz2 - dy;
    let p2 = dk2 - dy;
    while ( y0 !== y1 ) {
      y0 += sy;
      if ( p0 >= 0 ) {
        x0 += sx;
        p0 -= dy2;
      }
      if ( p1 >= 0 ) {
        z0 += sz;
        p1 -= dy2;
      }
      if ( p2 >= 0 ) {
        k0 += sk;
        p2 -= dy2;
      }
      p0 += dx2;
      p1 += dz2;
      p2 += dk2;
      pixels.push(x0, y0, z0, k0);
    }

  // Driving axis is z-axis
  } else if ( dz >= dx && dz >= dy && dz >= dk ) {
    let p0 = dy2 - dz;
    let p1 = dx2 - dz;
    let p2 = dk2 - dz;
    while ( z0 !== z1 ) {
      z0 += sz;
      if ( p0 >= 0 ) {
        y0 += sy;
        p0 -= dz2;
      }
      if ( p1 >= 0 ) {
        x0 += sx;
        p1 -= dz2;
      }
      if ( p2 >= 0 ) {
        k0 += sk;
        p2 -= dz2;
      }
      p0 += dy2;
      p1 += dx2;
      p2 += dk2;
      pixels.push(x0, y0, z0, k0);
    }

  // Driving axis is k-axis
  } else {
    let p0 = dx2 - dk;
    let p1 = dy2 - dk;
    let p2 = dz2 - dk;
    while ( k0 !== k1 ) {
      k0 += sk;
      if ( p0 >= 0 ) {
        x0 += sx;
        p0 -= dk2;
      }
      if ( p1 >= 0 ) {
        y0 += sx;
        p1 -= dz2;
      }
      if ( p2 >= 0 ) {
        z0 += sz;
        p2 -= dk2;
      }
      p0 += dx2;
      p1 += dy2;
      p2 += dz2;
      pixels.push(x0, y0, z0, k0);
    }
  }
  return pixels;
}

/**
 * Trim line segment to its intersection points with a rectangle.
 * If the endpoint is inside the rectangle, keep it.
 * Note: points on the right or bottom border of the rectangle do not count b/c we want the pixel positions.
 * @param {PIXI.Rectangle} rect
 * @param {Point} a
 * @param {Point} b
 * @returns { Point[2]|null } Null if both are outside.
 */
export function trimLineSegmentToPixelRectangle(rect, a, b) {
  rect = new PIXI.Rectangle(rect.x, rect.y, rect.width - 1, rect.height - 1);

  if ( !rect.lineSegmentIntersects(a, b, { inside: true }) ) return null;

  const ixs = rect.segmentIntersections(a, b);
  if ( ixs.length === 2 ) return ixs;
  if ( ixs.length === 0 ) return [a, b];

  // If only 1 intersection:
  //   1. a || b is inside and the other is outside.
  //   2. a || b is on the edge and the other is outside.
  //   3. a || b is on the edge and the other is inside.
  // Point on edge will be considered inside by _getZone.

  // 1 or 2 for a
  const aOutside = rect._getZone(a) !== PIXI.Rectangle.CS_ZONES.INSIDE;
  if ( aOutside ) return [ixs[0], b];

  // 1 or 2 for b
  const bOutside = rect._getZone(b) !== PIXI.Rectangle.CS_ZONES.INSIDE;
  if ( bOutside ) return [a, ixs[0]];

  // 3. One point on the edge; other inside. Doesn't matter which.
  return [a, b];
}

/**
 * Do two segments overlap?
 * Overlap means they intersect or they are collinear and overlap
 * @param {PIXI.Point} a   Endpoint of segment A|B
 * @param {PIXI.Point} b   Endpoint of segment A|B
 * @param {PIXI.Point} c   Endpoint of segment C|D
 * @param {PIXI.Point} d   Endpoint of segment C|D
 * @returns {boolean}
 */
export function doSegmentsOverlap(a, b, c, d) {
  if ( foundry.utils.lineSegmentIntersects(a, b, c, d) ) return true;

  // If collinear, B is within A|B or D is within A|B
  const pts = findOverlappingPoints(a, b, c, d);
  return pts.length;
}

/**
 * Find the points of overlap between two segments A|B and C|D.
 * @param {PIXI.Point} a   Endpoint of segment A|B
 * @param {PIXI.Point} b   Endpoint of segment A|B
 * @param {PIXI.Point} c   Endpoint of segment C|D
 * @param {PIXI.Point} d   Endpoint of segment C|D
 * @returns {PIXI.Point[]} Array with 0, 1, or 2 points.
 *   The points returned will be a, b, c, and/or d, whichever are contained by the others.
 *   No points are returned if A|B and C|D are not collinear, or if they do not overlap.
 *   A single point is returned if a single endpoint is shared.
 */
export function findOverlappingPoints(a, b, c, d) {
  if ( !foundry.utils.orient2dFast(a, b, c).almostEqual(0)
    || !foundry.utils.orient2dFast(a, b, d).almostEqual(0) ) return [];

  // B is within A|B or D is within A|B
  const abx = Math.minMax(a.x, b.x);
  const aby = Math.minMax(a.y, b.y);
  const cdx = Math.minMax(c.x, d.x);
  const cdy = Math.minMax(c.y, d.y);

  const p0 = new PIXI.Point(
    Math.max(abx.min, cdx.min),
    Math.max(aby.min, cdy.min)
  );

  const p1 = new PIXI.Point(
    Math.min(abx.max, cdx.max),
    Math.min(aby.max, cdy.max)
  );

  const xEqual = p0.x.almostEqual(p1.x);
  const yEqual = p0.y.almostEqual(p1.y);
  if ( xEqual && yEqual ) return [p0];
  if ( xEqual ^ yEqual
  || (p0.x < p1.x && p0.y < p1.y)) return [p0, p1];

  return [];
}

/** @type {enum} */
export const IX_TYPES = {
  NONE: 0,
  NORMAL: 1,
  ENDPOINT: 2,
  OVERLAP: 3
};

/**
 * @typedef {object} SegmentIntersection
 * Represents intersection between two segments, a|b and c|d
 * @property {PIXI.Point} pt          Point of intersection
 * @property {number} t0              Intersection location on the a|b segment
 * @property {number} t1              Intersection location on the c|d segment
 * @property {IX_TYPES} ixType        Type of intersection
 * @property {number} [endT0]         If overlap, this is the end intersection on a|b
 * @property {number} [endT1]         If overlap, this is the end intersection on c|d
 * @property {PIXI.Point} [endPoint]  If overlap, the ending intersection
 */

/**
 * Locate collisions between two segments. Uses almostEqual to get near collisions.
 * 1. Shared endpoints.
 * 2. Endpoint of one segment within the other segment.
 * 3. Two segments intersect.
 * 4. Collinear segments overlap: return start and end of the intersections.
 * @param {PIXI.Point} a        Endpoint on a|b segment
 * @param {PIXI.Point} b        Endpoint on a|b segment
 * @param {PIXI.Point} c        Endpoint on c|d segment
 * @param {PIXI.Point} d        Endpoint on c|d segment
 * @returns {SegmentIntersection|null}
 */
export function segmentCollision(a, b, c, d) {
  // Endpoint intersections can occur as part of a segment overlap. So test overlap first.
  // Overlap will be fast if the segments are not collinear.
  return segmentOverlap(a, b, c, d)
    ?? endpointIntersection(a, b, c, d)
    ?? segmentIntersection(a, b, c, d);
}

/**
 * Determine if two segments intersect at an endpoint and return t0, t1 based on that intersection.
 * Does not consider segment collinearity, and only picks the first shared endpoint.
 * (If segments are collinear, possible they are the same and share both endpoints.)
 * @param {PIXI.Point} a        Endpoint on a|b segment
 * @param {PIXI.Point} b        Endpoint on a|b segment
 * @param {PIXI.Point} c        Endpoint on c|d segment
 * @param {PIXI.Point} d        Endpoint on c|d segment
 * @returns {SegmentIntersection|null}
 */
export function endpointIntersection(a, b, c, d) {
  const type = IX_TYPES.ENDPOINT;
  if ( a.key === c.key || c.almostEqual(a) ) return { t0: 0, t1: 0, pt: a, type };
  if ( a.key === d.key || d.almostEqual(a) ) return { t0: 0, t1: 1, pt: a, type };
  if ( b.key === c.key || c.almostEqual(b) ) return { t0: 1, t1: 0, pt: b, type };
  if ( b.key === d.key || d.almostEqual(b) ) return { t0: 1, t1: 1, pt: b, type };
  return null;
}

/**
 * Determine if two segments intersect and return t0, t1 based on that intersection.
 * Generally will detect endpoint intersections but no special handling.
 * To ensure near-endpoint-intersections are captured, use endpointIntersection.
 * Will not detect overlap. See segmentOverlap
 * @param {PIXI.Point} a        Endpoint on a|b segment
 * @param {PIXI.Point} b        Endpoint on a|b segment
 * @param {PIXI.Point} c        Endpoint on c|d segment
 * @param {PIXI.Point} d        Endpoint on c|d segment
 * @returns {SegmentIntersection|null}
 */
export function segmentIntersection(a, b, c, d) {
  if ( !foundry.utils.lineSegmentIntersects(a, b, c, d) ) return null;
  const ix = CONFIG.GeometryLib.utils.lineLineIntersection(a, b, c, d, { t1: true });
  ix.pt = PIXI.Point.fromObject(ix);
  ix.type = IX_TYPES.NORMAL;
  return ix;
}

/**
 * Determine if two collinear segments overlap and return the two points at which the segments
 * begin/end their overlap. If you just need the points, use findOverlappingPoints.
 * @param {PIXI.Point} a        Endpoint on a|b segment
 * @param {PIXI.Point} b        Endpoint on a|b segment
 * @param {PIXI.Point} c        Endpoint on c|d segment
 * @param {PIXI.Point} d        Endpoint on c|d segment
 * @returns {SegmentIntersection|null}
 *  Either an ENDPOINT or an OVERLAP intersection.
 */
export function segmentOverlap(a, b, c, d) {
  const pts = findOverlappingPoints(a, b, c, d);
  if ( !pts.length ) return null;

  // Calculate t value for a single point, which must be an endpoint.
  if ( pts.length === 1 ) {
    const pt = pts[0];
    const res = { pt, type: IX_TYPES.ENDPOINT };
    res.t0 = pt.almostEqual(a) ? 0 : 1;
    res.t1 = pt.almostEqual(c) ? 0 : 1;
    return res;
  }

  // Calculate t value for overlapping points.
  const res = { type: IX_TYPES.OVERLAP };
  const distAB = PIXI.Point.distanceBetween(a, b);
  const distCD = PIXI.Point.distanceBetween(c, d);
  const tA0 = PIXI.Point.distanceBetween(a, pts[0]) / distAB;
  const tA1 = PIXI.Point.distanceBetween(a, pts[1]) / distAB;
  const tC0 = PIXI.Point.distanceBetween(c, pts[0]) / distCD;
  const tC1 = PIXI.Point.distanceBetween(c, pts[1]) / distCD;

  if ( tA0 <= tA1 ) {
    res.t0 = tA0;
    res.endT0 = tA1;
    res.t1 = tC0;
    res.endT1 = tC1;
    res.pt = pts[0];
    res.endPt = pts[1];
  } else {
    res.t0 = tA1;
    res.endT0 = tA0;
    res.t1 = tC1;
    res.endT1 = tC0;
    res.pt = pts[1];
    res.endPt = pts[0];
  }

  return res;
}
