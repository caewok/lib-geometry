/* globals
PIXI,
*/
"use strict";

import { Point3d } from "./3d/Point3d.js";
import { gridUnitsToPixels, clamp } from "./util.js";
import { Draw } from "./Draw.js";
import { Polygon3d, Triangle3d, Quad3d } from "./3d/Polygon3d.js";
import { ElevatedPoint } from "./3d/ElevatedPoint.js";
import { GEOMETRY_LIB_ID } from "./const.js";

/**
 * A cutaway polygon is a 2d representation of a vertical slice of a shape.
 * That slice is usually a quadrilateral but may be more complex shapes depending on the
 * underlying 3d object.
 * The cutaway polygon tracks its associated 3d start|end segment so it can be transformed.
 */
export class CutawayPolygon extends PIXI.Polygon {

  /** @type {PIXI.Point} */
  start = new PIXI.Point();

  /** @type {Point3d} */
  end = new PIXI.Point();

  /** @type {number} */
  get top() { return this.getBounds().bottom; } // Y values are reversed.

  /** @type {number} */
  get bottom() { return this.getBounds().top; } // Y values are reversed.

  get isHole() { return this.isPositive; } // Reversed from Foundry coordinates.

  /**
   * Create a new polygon from a series of cutaway points.
   * @param {Point[]} pts
   * @param {Point3d|PIXI.Point} start
   * @param {Point3d|PIXI.Point} end
   * @returns {CutawayPolygon}
   */
  static fromCutawayPoints(pts, start, end) {
    const poly = new this(pts);
    poly.start.copyFrom(start);
    poly.end.copyFrom(end);
    return poly;
  }

   /**
   * Create a new polygon from a series of cutaway points already in a polygon.
   * @param {PIXI.Polygon} poly
   * @param {Point3d|PIXI.Point} start
   * @param {Point3d|PIXI.Point} end
   * @returns {CutawayPolygon} The same polygon, modified in place to be a cutaway.
   */
  static fromPolygon(poly, start, end) {
    poly.start = new PIXI.Point();
    poly.end = new PIXI.Point();

    poly.start.copyFrom(start);
    poly.end.copyFrom(end);
    Object.setPrototypeOf(poly, this.prototype);
    return poly;
  }

  /**
   * Convert to 3d canvas points.
   * @returns {Iterator<Point3d>}
   */
  to3dPoints() { return this.iteratePoints().map(pt => this._from2d(pt)); }

  /**
   * Convert the cutaway to 3d planar polygon.
   */
  to3dPlanarPolygon() {
    const pts = [...this.to3dPoints()];
    switch ( this.points.length ) {
      case 3: return Triangle3d.from3dPoints(pts);
      case 4: return Quad3d.from3dPoints(pts);
      default: return Polygon3d.from3dPoints(pts);
    }
  }

  // ----- NOTE: Conversion to/from 2d ----- //

  /**
   * Convert 2d cutaway point to 3d position.
   * @param {PIXI.Point} pt2d
   * @param {PIXI.Point} start2d
   * @param {PIXI.Point} end2d
   * @param {ElevatedPoint} [outPoint]
   * @returns {ElevatedPoint}
   */
  static from2d(cutawayPt, start2d, end2d, outPoint) {
    outPoint ??= ElevatedPoint.tmp;
    start2d.towardsPoint(end2d, cutawayPt.x, outPoint);
    outPoint.z = cutawayPt.y;
    return outPoint;
  }

  /**
   * Convert 3d position to 2d cutaway point. Inverse of from2d.
   * @param {Point3d} pt2d
   * @param {PIXI.Point} start2d
   * @param {PIXI.Point} end2d
   * @param {PIXI.Point} [outPoint]
   * @returns {PIXI.Point}
   */
  static to2d(pt3d, start2d, end2d, outPoint) {
    outPoint ??= PIXI.Point.tmp;
    using pt2d = pt3d.to2d();
    const dist = PIXI.Point.distanceBetween(pt2d, start2d);
    outPoint.set(dist, pt3d.z);

    // Dot product of the directional vectors gives the sign.
    using dirAB = end2d.subtract(start2d);
    using dirAP = pt2d.subtract(start2d);
    if ( dirAB.dot(dirAP) < 0 ) outPoint.x *= -1;
    return outPoint;
  }

  /**
   * Union 2d cutaways into non-overlapping CutawayPolygons.
   * @param {CutawayPolygon[]} cutaways
   * @param {PIXI.Point} [start]
   * @param {PIXI.Point} [end]
   * @returns {CutawayPolygon[]}
   */
  static union(cutaways, start, end) {
    if ( cutaways.length < 2 ) return cutaways;
    start ??= cutaways[0].start;
    end ??= cutaways[0].end;
    return CONFIG[GEOMETRY_LIB].CONFIG.ClipperPaths.fromPolygons(cutaways)
      .union()
      .clean()
      .toPolygons()
      .map(poly => this.fromPolygon(poly, start, end));
  }

  /**
   * Convert x,y to 3d position
   * @param {PIXI.Point} cutawayPoint
   * @returns {ElevatedPoint}
   */
  _from2d(cutawayPoint, outPoint) {
    return this.constructor.from2d(cutawayPoint, this.start, this.end, outPoint);
  }

  /**
   * Convert 3d point to 2d position
   * @param {Point3d} pt3d
   * @returns {PIXI.Point}
   */
  _to2d(pt3d, outPoint) {
    return this.constructor.to2d(pt3d, this.start, this.end, outPoint);
  }

  /**
   * Return 1+ quad cutaways for a given PIXI shape.
   * @param {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} shape
   * @param {PIXI.Point} a       Starting endpoint for the segment
   * @param {PIXI.Point} b       Ending endpoint for the segment
   * @param {object} [opts]
   * @param {PIXI.Point} [opts.start]              Starting endpoint for the segment
   * @param {PIXI.Point} [opts.end]                Ending endpoint for the segment
   * @param {function} [opts.topElevationFn]    Function to calculate the top elevation for a position
   * @param {function} [opts.bottomElevationFn] Function to calculate the bottom elevation for a position
   * @param {number} [opts.isHole=false]        Treat this shape as a hole; reverse the points of the returned polygon
   * @returns {CutawayPolygon[]}
   */
  static cutawayBasicShape(shape, a, b, opts = {}) {
    if ( !shape.lineSegmentIntersects(a, b, { inside: true }) ) return [];
    opts.start ??= a;
    opts.end ??= b;
    opts.topElevationFn ??= () => 1e06;
    opts.bottomElevationFn ??= () => -1e06;

    const ixs = shape.segmentIntersections(a, b);
    if ( ixs.length === 0 ) return [this.quadCutaway(a, b, opts)];
    if ( ixs.length === 1 ) {
      const ix0 = Point3d.fromObject(ixs[0]);
      ix0.t0 = ixs[0].t0;

      // Intersects only at start point.
      if ( ix0.t0.almostEqual(0) ) {
        const bInside = shape.contains(b.x, b.y);
        if ( bInside ) return [this.quadCutaway(a, b, opts)];

        // A is the end. Back up one to construct proper polygon and return.
        using newA2d = a.towardsPoint(b, -1);
        return [this.quadCutaway(newA2d, a, opts)];
      }

      // Intersects only at end point.
      if ( ix0.t0.almostEqual(1) ) {
        const aInside = shape.contains(a.x, a.y);
        if ( aInside ) return [this.quadCutaway(a, b, opts)];

        // B is at end. Move one step further from the end to construct proper polygon and return.
        using newB2d = b.towardsPoint(a, -1);
        return [this.quadCutaway(b, newB2d, opts)];
      }

      // Intersects somewhere along the segment.
      if ( shape.contains(a.x, a.y) ) return [this.quadCutaway(a, ix0, opts)];
      else return [this.quadCutaway(ix0, b, opts)];
    }

    // Handle 2+ intersections with a polygon shape.
    // More than 2 are possible if the polygon is not simple. May go in and out of it.
    ixs.sort((a, b) => a.t0 - b.t0);
    if ( !ixs.at(-1).t0.almostEqual(1) ) ixs.push(b);
    if ( ixs[0].t0.almostEqual(0) ) ixs.shift();

    // Shoelace: move in and out of the polygon, constructing a quad for every "in"
    // Go from a --> ix --> ... --> ix --> b unless last ix is at b.
    const quads = [];
    let prevIx = a;
    let isInside = shape.contains(prevIx.x, prevIx.y);
    for ( const ix of ixs ) {
      if ( isInside ) quads.push(this.quadCutaway(prevIx, ix, opts));
      isInside = !isInside;
      prevIx = ix;
    }
    return quads;
  }

  /**
   * Construct a single vertical quadrangle based on a line moving through a 3d polygon.
   * @param {PIXI.Point} a               Starting cutaway point for the segment
   * @param {PIXI.Point} b               Ending cutaway point for the segment
   * @param {object} [opts]
   * @param {PIXI.Point} [opts.start]              Starting endpoint for the segment
   * @param {PIXI.Point} [opts.end]                Ending endpoint for the segment
   * @param {function} [opts.topElevationFn]    Function to calculate the top elevation for a position
   * @param {function} [opts.bottomElevationFn] Function to calculate the bottom elevation for a position
   * @param {boolean} [opts.isHole=false]       Is this polygon a hole? If so, reverse points and use max/min elevations.
   * @returns {CutawayPolygon} Returns points such that a is on the left, b is on the right.
   *   Points are clockwise but reversed from Foundry: Move from a to b takes you around the "top" of the polygon, through positive elevation.
   */
  static quadCutaway(a, b, { start, end, topElevationFn, bottomElevationFn, isHole = false } = {}) {
    start ??= a;
    end ??= b;
    topElevationFn ??= () => 1e06;
    bottomElevationFn ??= () => -1e06;

    // Retrieve the pixel elevation for the a and b points.
    // Holes should extend very high and very low so they cut everything.
    let topA, topB, bottomA, bottomB;
    if ( isHole ) {
      topA = topB = 1e06;
      bottomA = bottomB = -1e06;
    } else {
      topA = topElevationFn(a);
      topB = topElevationFn(b);
      bottomA = bottomElevationFn(a);
      bottomB = bottomElevationFn(b);
    }

    // Set the four corners of the 2d quad.
    using a2d = this.to2d(a, start, end); // Can ignore z; will set below.
    using b2d = this.to2d(b, start, end); // Can ignore z; will set below.
    const corners = PIXI.Point.buildNObjects(4);
    corners[0].set(a2d.x, topA); // TL
    corners[1].set(b2d.x, topB); // TR
    corners[2].set(b2d.x, bottomB); // BR
    corners[3].set(a2d.x, bottomA); // BL

    // _isPositive is y-down clockwise. For Foundry canvas, this is CCW.
    // Returns y-up clockwise.
    const out = isHole ? this.fromCutawayPoints(corners.reverse(), start, end) : this.fromCutawayPoints(corners, start, end);
    PIXI.Point.release(...corners);
    return out;
  }

  /**
   * Draw at 0,0.
   * Flip y so it faces up.
   */
  draw(opts = {}) {
    opts.color ??= Draw.COLORS.red;
    opts.fill ??= Draw.COLORS.red;
    opts.fillAlpha ??= 0.3;

    // Locate the minimum point that is above an arbitrarily low value so we don't draw excessively large polys.
    const LOWEST = gridUnitsToPixels(-100);
    const HIGHEST = gridUnitsToPixels(100);
    const invertedPolyPoints = [];
    for ( const pt of this.iteratePoints() ) {
      pt.y = -clamp(pt.y, LOWEST, HIGHEST);  // Arbitrary cutoff for low and high elevations.
      invertedPolyPoints.push(pt);
    }

    const invertedPoly = new PIXI.Polygon(...invertedPolyPoints);
    Draw.shape(invertedPoly, opts);
    invertedPolyPoints.forEach(pt => pt.release());
  }
}
