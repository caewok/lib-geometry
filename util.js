/* globals
CONFIG,
canvas,
foundry,
CONST
*/
"use strict";

import { CenteredRectangle } from "./CenteredPolygon/CenteredRectangle.js";
import { CenteredPolygon } from "./CenteredPolygon/CenteredPolygon.js";
import { Ellipse } from "./Ellipse.js";

// Functions that would go in foundry.utils if that object were extensible
export function registerFoundryUtilsMethods() {
  CONFIG.GeometryLib ??= {};
  CONFIG.GeometryLib.registered ??= new Set();
  if ( CONFIG.GeometryLib.registered.has("utils") ) return;

  CONFIG.GeometryLib.utils = {
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
    trimLineSegmentToPixelRectangle
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
    case CONST.DRAWING_TYPES.RECTANGLE:
      return CenteredRectangle.fromDrawing(drawing);
    case CONST.DRAWING_TYPES.ELLIPSE:
      return Ellipse.fromDrawing(drawing);
    case CONST.DRAWING_TYPES.POLYGON:
      return CenteredPolygon.fromDrawing(drawing);
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

export function* bresenhamLineIterator(x0, y0, x1, y1) {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  x1 = Math.floor(x1);
  y1 = Math.floor(y1);

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;
  let err = dx - dy;
  yield { x: x0, y: y0 };
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

    yield { x: x0, y: y0 };
  }
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
