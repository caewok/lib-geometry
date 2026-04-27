/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { Matrix } from "../Matrix.js";
import { Draw } from "../Draw.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { Polygon3d } from "../3d/Polygon3d.js";
import { TokenGeometry } from "../placeable_geometry/TokenGeometry.js";
import { AABB2d } from "../AABB.js";

/* 
SDF for placeables.

Includes corner distance in 2d and edge distance in 3d.
*/



/**
 * All SDF functions operate at the origin, with no rotation.
 * Except sdSegment and sdOrientedRectangle.
 */
export class SDF {
 
  // ----- NOTE: Operators ----- //
  
  /**
   * Revolve a 2d primitive to create a 3d object
   * @param {Point3d} p					The point to measure distance to. 
   * @param {SDF2d} primitive 	2d primitive to revolve
   * @param {number} o					Origin point for the revolution
   * @returns {number}
   */
  static opRevolution(p, primitive, o) {
    using p2d = p.to2d();
    const ln = p2d.magnitude;
    using q = PIXI.Point.tmp.set(
      ln - o,
      p.y
    );
    return primitive(q);
  }

  /**
   * Extrude a 2d primitive by a certain height to create a 3d object.
   * @param {Point3d} p					The point to measure distance to.			
	 * @param {SDF2d} primitive 	The 2d SDF function to extrude.
	 * @param {number} h					Height of the resulting 3d SDF
	 * @returns {number} Distance
	 */
	static opExtrusion(p, primitive, h) {
		const d = primitive(p.to2d());
		using w = PIXI.Point.tmp.set(
			d,
			Math.abs(p.z) - h,
		);
		const mm = Math.min(Math.max(w.x, w.y), 0.0);
		using zero = PIXI.Point.tmp.set(0, 0);
		w.max(zero, w);
		return mm + w.magnitude();
	}
	
	/**
	 * Make an annular shape, like a ring or onion layers.
	 * @param {Point3d|PIXI.Point} p					The point to measure distance to
	 * @param {SDF} primitive									The original shape function	
	 * @param {number} r											Radius to subtract from the edge
	 * @returns {number}
	 */
	static opOnion(p, primitive, r = 0) {
	  const dist = primitive(p);
	  return Math.abs(dist) - r;
	}
	
	// ----- NOTE: Boolean operators ----- //

  /**
   * Union two sdfs. True SDF only for exterior.
   * @param {...number} args			Distance of each sdf
   * @param {number} Minimum distance.
   */
  static union = Math.min;
  
  /**
   * Subtract two sdfs. Does not produce a true SDF. 
   * Not commutative.
   * @param {number} a			Distance of first SDF
   * @param {number} b			Distance of second SDF
   * @param {number} Distance to the combined object.
   */
  static subtraction(a, b) { return Math.max(-a, b); }
  
  /**
   * Intersect two sdfs. Does not produce a true SDF.
   * @param {...number} args			Distance of each sdf
   * @param {number} Maximum distance.
   * @param {number} Distance to the combined object.
   */
  static intersection = Math.max;
  
  /**
   * Xor multiple sdfs. True SDF only for exterior.
   * @param {...number} ...args			Distance of each SDF
   * @param {number} b			Distance of second SDF
   * @param {number} Distance to the combined object.
   */
  static xor(...args) { return Math.max(Math.min(...args), -Math.max(...args)); } 
    
  // ----- NOTE: 2d SDF ---- //

	/**
	 * Distance squared to a 2d segment.
	 * Already uses canvas coordinates; no transform required.
	 * @param {PIXI.Point} p			The point to measure distance to. 			
	 * @param {PIXI.Point} a			Endpoint of the segment, in canvas coordinates
	 * @param {PIXI.Point} b			Endpoint of the segment, in canvas coordinates
	 * @returns {number} Always positive or zero; no inside for a segment.
	 */	 
	static sdSquaredSegment(p, a, b) {
		using pa = p.subtract(a);
		using ba = b.subtract(a);
		const h = Math.clamp(pa.dot(ba) / ba.dot(ba), 0.0, 1.0);
		ba.multiplyScalar(h, ba);
		return pa.subtract(ba).magnitudeSquared();
	}
	
	/**
	 * Distance to a 2d circle.
	 * @param {PIXI.Point} p			The point to measure distance to.			
	 * @param {number} r					Radius
	 * @returns {number}
	 */
	static sdCircle(p, r) { p.magnitude() - r; }
			
	/**
	 * Distance to a 2d ellipse.
	 * @param {PIXI.Point} p			The point to measure distance to.	
	 * @param {PIXI.Point} ab			Semi-axes of the ellipse. If ab.x === ab.y, it will be a circle.
	 *   - ab.x: radius along x-axis
	 *   - ab.y: radius along y-axis
	 * @returns {number}
	 */
	static sdEllipse(p, ab) {
	  if ( ab.x.almostEqual(ab.y) ) return this.sdCircle(p, ab.x);
	  
	  using pTmp = PIXI.Point.fromObject(p);
	  using abTmp = PIXI.Point.fromObject(ab);
	  pTmp.abs(pTmp);
	  if ( pTmp.x > pTmp.y ) {
	    [pTmp.x, pTmp.y] = [pTmp.y, pTmp.x];
	    [abTmp.x, abTmp.y] = [abTmp.y, abTmp.x];
	  }
	  
	  const l = (abTmp.y ** 2) - (abTmp.x ** 2);
	  const m = (abTmp.x * pTmp.x) / l;
	  const m2 = m ** 2;
	  const n = (abTmp.y * pTmp.y) / l;
	  const n2 = n ** 2;
	  const c = (m2 + n2 - 1.0) / 3.0;
	  const c3 = c ** 3;
	  const q = c3 + (m2 * n2 * 2.0);
	  const d = c3 + (m2 * n2);
	  const g = m + (m2 * n2);
	  let co;
	  if ( d < 0.0 ) {
	    const h = Math.acos(q / c3) / 3.0;
	    const s = Math.cos(h);
	    const t = Math.sin(h) * Math.sqrt(3.0);
	    const rx = Math.sqrt(-c * (s + t + 2.0) + m2);
	    const ry = Math.sqrt(-c * (s - t + 2.0) + m2);
	    co = (ry + (Math.sign(l) * rx) + (Math.abs(g) / (rx * ry)) - m) / 2.0;
	  } else {
			const h = 2.0 * m * n * Math.sqrt(d);
			const s = Math.sign(q + h) * Math.pow(Math.abs(q + h), 1.0 / 3.0);
			const u = Math.sign(q - h) * Math.pow(Math.abs(q - h), 1.0 / 3.0);
			const rx = -s - u - c * 4.0 + 2.0 * m2;
			const ry = (s - u) * Math.sqrt(3.0);
			const rm = Math.sqrt((rx ** 2) + (ry ** 2) );
			co = (ry / Math.sqrt(rm - rx) + (2.0 * g/rm) - m) / 2.0;
	  }
	  
	  using r = PIXI.Point.tmp.set(
	    co,
	    Math.sqrt(1.0 - (co ** 2)),
	  );
	  r.multiply(ab, r);
	  const s = Math.sign(p.y - r.y);
	  return r.subtract(p, r).magnitude() * s;
	}

	/**
	 * Distance to a 2d rectangle. (Exact.)
	 * @param {PIXI.Point} p			The point to measure distance to.			
	 * @param {PIXI.Point} b			Box half-extents (width/2, height/2)
	 * @returns {number}
	 */
	static sdRectangle(p, b) {
		// abs(p) - b
		using d = p.abs(); 
		d.subtract(b, d);
		
		// min(max(d.x,d.y),0.0)
		const mm = Math.min(Math.max(d.x, d.y), 0.0);
		
		// length(max(d, 0.0))
		using zero = PIXI.Point.tmp.set(0, 0);
		d.max(zero, d);
		return d.magnitude() + mm;
	}
	
	/**
	 * Distance to a 2d rectangle. (Exact.)
	 * @param {PIXI.Point} p			The point to measure distance to.	
	 * @param {number} r					In-radius (apothem): distance from center to midpoint of a side
	 * (Convert from circumRadius (R) using: r = R * √3/2 ~= R * 0.866)
	 */
	static sdHexagon(p, r) {
	  using k = Point3d.tmp.set(-0.866025404, 0.5, 0.577350269);
	  using pNew = p.abs();
	  using k2d = k.to2d();
	  using tmp = PIXI.Point.tmp;
	  const c = 2.0 * Math.min(k2d.dot(pNew), 0.0);
	  pNew.subtract(k2d.multiplyScalar(c, tmp), pNew);
	  tmp.set(
	    Math.clamp(pNew.x, -k.z * r, k.z * r),
	    r,
	  );
	  pNew.subtract(tmp, pNew);
	  return pNew.magnitude() * Math.sign(pNew.y);
	}
	
	/** 
	 * sdOrientedRectangle: a and b are the start and end points of the central axis, where th is the thickness or half-width
	 * Box is "swept" along the line segment, where width is 2 x th.
	 * Already uses canvas coordinates; no transform required.
	 * @param {PIXI.Point} p			The point to measure distance to. 			
	 * @param {PIXI.Point} a			Endpoint of the central axis, in canvas coordinates
	 * @param {PIXI.Point} b			Endpoint of the central, in canvas coordinates
	 * @param {number} th					Thickness or half-width
	 * @returns {number} _
	 */
	static sdOrientedRectangle(p, a, b, th) {
		// Normalized direction vector.		
		using dir = PIXI.Point.tmp;
		const l = b.subtract(a, dir).magnitude();
		dir.normalize(dir);
	
		// Center point displacement.
		// p - (a + b) * 0.5
		using q = PIXI.Point.tmp;
		a.add(b, q).multiplyScalar(0.5, q);
		p.subtract(q, q);
			
		// Rotate q into the box's local coordinate system.
		// q = mat2(d.x, -d.y, d.y, d.x) * q (column-major)
		// [d.x, d.y]
		// [-d.y, d.x]
		using res = PIXI.Point.tmp.set(
			(q.x * dir.x) + (q.y * dir.y),
			(q.x * -dir.y) + (q.y * dir.x)
		);
			
		// q = abs(q) - vec2(1, th) * 0.5
		res.abs(res);
		using v = PIXI.Point.tmp.set(l * 0.5, th * 0.5);
		res.subtract(v, q);
		
		// length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)
		const mm = Math.min(Math.max(q.x, q.y), 0.0);
		using zero = PIXI.Point.tmp.set(0, 0);
		q.max(zero, q);
		return q.magnitude() + mm;
	} 
	
	/**
	 * Distance to a point from a 2d polygon.
	 * All polygons, but holes must be handled using subtraction.
   * @param {PIXI.Point} p						The point to measure distance to.			
   * @param {PIXI.Polygon} poly				The polygon
   * @returns {number}
   */
  static sdPolygon(p, v) {  
    using pv0 = p.subtract(v[0]);
    let d = pv0.dot2();
    const n = v.length;
    let s = 1.0;
    using e = PIXI.Point.tmp;
    using w = PIXI.Point.tmp;
    using b = PIXI.Point.tmp;
    for ( let i = 0, j = n - 1; i < n; j = i, i += 1 ) {
      v[j].subtract(v[i], e);
      p.subtract(v[i], w);
      const mult = Math.clamp(w.dot(e) / e.dot2(), 0.0, 1.0);
      w.subtract(e.multiplyScalar(mult, b), b);
      d = Math.min(d, b.dot2());
      const c0 = p.y >= v[i].y 
      const c1 = p.y < v[j].y 
      const c2 = (e.x * w.y) > (e.y * w.x);
      if ( (c0 && c1 && c2) || !(c0 || c1 || c2) ) s *= -1.0;
    }
    return s * Math.sqrt(d);
  }
  
  static sdPolygon2d(p, poly) {
    using v0 = PIXI.Point.tmp.set(poly.points[0], poly.points[1]); // Or 2, 3?
    using pv0 = p.subtract(v0);
    let d = pv0.dot2();
    let s = 1.0;
    
    using e = PIXI.Point.tmp;
    using w = PIXI.Point.tmp;
    using f = PIXI.Point.tmp;
    for ( const { a, b } of poly.iterateEdges() ) {
      a.subtract(b, e); // From Inigo Quilez: a = v[j]
      p.subtract(b, w); // From Inigo Quilez: b = v[i]
      
      const mult = Math.clamp(w.dot(e) / e.dot2(), 0.0, 1.0);
      w.subtract(e.multiplyScalar(mult, f), f);
      d = Math.min(d, b.dot2());
      const c0 = p.y >= b.y 
      const c1 = p.y < a.y 
      const c2 = (e.x * w.y) > (e.y * w.x);
      if ( (c0 && c1 && c2) || !(c0 || c1 || c2) ) s *= -1.0;
    }
    return s * Math.sqrt(d);
  }
  
  static sdPolygonsWithHoles(p, polys) {
    const iter = polys[Symbol.iterator];
    const poly = iter.next().value;
    let d = this.sdPolygon(p, [...poly.iteratePoints()]);
    for ( const poly of iter ) {
      const op = poly.isHole ? "subtract" : "union";
      d = op(d, this.sdPolygon(p, [...poly.iteratePoints()]));      
    } 
    return d;
  }
  
  /**
   * Return a distance function that measures distance from a group of 2d polygons.
   * @param {PIXI.Polygon} polys
   * @returns {SDF}
   */
  static sdfPolygons(polys) {
    if ( polys.length === 1 ) return p => this.sdPolygon2d(p, polys[0]);
		if ( polys.some(poly => !poly.isPositive) ) return p => this.sdPolygonsWithHoles(p, polys);
		return p => this.union(...polys.map(poly => this.sdPolygon2d(p, poly)));
  }
  
  /**
   * Distance to a point from a 2d step object.
   * Stairs start at 0,0 and clim toward point defined by wh.
   * Step size (of an individual step) is wh/n. 
   * @param {PIXI.Point} p						The point to measure distance to
   * @param {PIXI.Point} wh						Total width and height of the entire staircase
   *   - x: horizontal distance from start of first step to end of last step
   *   - y: represent the vertical distance from base to top of the stairs
   * @param {number} n  Number of steps; individual "teeth" or levels generated
   * @returns {number}
   */
  static sdStairs(p, wh, n) {
    using ba = wh.multiplyScalar(n);
    using v0 = PIXI.Point.tmp.set(
      Math.clamp(p.x, 0.0, ba.x),
      0.0,
    );
    using v1 = PIXI.Point.tmp.set(
      ba.x,
      Math.clamp(p.y, 0.0, ba.y),
    );
    let d = Math.min(
      p.subtract(v0, v0).dot2(),
      p.subtract(v1, v1).dot2(),
    );
    let s = Math.sign(Math.max(-p.y, p.x - ba.x));
    
    const dia = wh.magnitude();
    const mat0 = Matrix.fromColumnMajorArray([wh.x, -wh.y, wh.y, wh.x], 2, 2);
    using pDia = p.multiplyScalar(dia);
    using pNew = mat0.multiplyPoint2d(pDia);
    const id = Math.clamp(Math.round(pNew.x/dia), 0.0, n - 1.0);
    pNew.x -= (id * dia);
    
    using pNewDia = pNew.multiplyScalar(dia);
    const mat1 = Matrix.fromColumnMajorArray([wh.x, wh.y, -wh.y, wh.x], 2, 2);
    mat1.multiplyPoint2d(pNewDia, pNew);
    
    const hh = wh.y / 2.0;
    pNew.y -= hh;
    if ( pNew.y > (hh * Math.sign(p.x)) ) s = 1.0;
    if ( !(id < 0.5 || p.x > 0.0) )  pNew.multiplyScalar(-1, pNew);
        
    using v2 = PIXI.Point.tmp.set(
      0.0,
      Math.clamp(p.y, -hh, hh),
    );
    using v3 = PIXI.Point.set(
      Math.clamp(p.x, 0.0, wh.x),
      hh,
    );
    d = Math.min(d, p.subtract(v2, v2).dot2(), p.subtract(v3, v3).dot2());
    return Math.sqrt(d) * s;
  }
  
  /**
   * Distance to a point from a 2d box with rounded corners.
   * See https://iquilezles.org/articles/distfunctions2d/ for a version that allows different
   * radii for each corner.
   * @param {PIXI.Point} p						The point to measure distance to
   * @param {PIXI.Point} b						Box half-extents (width/2, height/2)
   * @param {number} r								Radius of the corners
   * @returns {number}
   */
  static sdRoundedRectangle(p, b, r) {
    using q = PIXI.Point.tmp;
    using rr = PIXI.Point.tmp.set(r, r);
    using zero = PIXI.Point.tmp;
    p.abs(q).subtract(b, q).add(rr, q);
    const c = Math.min(Math.max(q.x, q.y), 0.0);
    const l = q.max(zero, q).magnitude();
    return c + l + r;
  }		  	
  
  /**
   * Distance to a point from a 2d isosceles triangle.
   * @param {PIXI.Point} p						The point to measure distance to
   * @param {PIXI.Point} q						Dimensions relative to apex:
   *  - q.x: half-width of the base (distance from central vertical axis to either bottom corner)
   *  - q.y: height (altitude) of the triangle (distance from apex to the base)
   * @returns {number}
   */
  static sdTriangleIsosceles(p, q) {
    using pNew = PIXI.Point.fromObject(p);
    pNew.x = Math.abs(pNew.x);
    using a = PIXI.Point.tmp;
    using b = PIXI.Point.tmp;
    
    const cA = Math.clamp(p.dot(q) / q.dot2(), 0.0, 1.0);
    p.subtract(q.multiplyScalar(cA, a), a);
    
    const cB = Math.clamp(p.x / q.x, 0.0, 1.0);
    using v = PIXI.Point.tmp.set(cB, 1.0);
    p.subtract(q.multiply(v, b), b);
    
    const s = -Math.sign(q.y);
    const dX = Math.min(a.dot2(), b.dot2());
    const dY = Math.min(
      s * ((p.x * q.y) - (p.y * q.x)),
      s * (p.y - q.y),
    );
    return -Math.sqrt(dX) * Math.sign(dY);
  }
  
  /**
   * Distance to a point from a 2d "ice cream cone," meaning a triangular cone + half-circle.
   * Adapted from sdUnevenCapsule from https://iquilezles.org/articles/distfunctions2d/
   * @param {PIXI.Point} p						The point to measure distance to
   * @param {number} r								Radius of the semi-circle
   * @param {number} h								Height from cone point to half-circle center
   * @returns {number}
   */
  static sdConeSemiCircle(p, r, h) {
    // Like sdUnevenCapsule. r1 = r; r2 = 0.
    using pNew = PIXI.Point.fromObject(p);
    pNew.x = Math.abs(pNew.x);
    const b = r / h;
    const a = Math.sqrt(1 - (b ** 2));
    
    using v0 = PIXI.Point.tmp.set(-b, a);
    const k = p.dot(v0);
    if ( k < 0.0 ) return pNew.magnitude() - r;
    if ( k > (a * h) ) {
      using v1 = PIXI.Point.tmp.set(0.0, h);
      return pNew.subtract(v1, v1).magnitude();
    } 
    using v2 = PIXI.Point.tmp.set(a, b);
    return p.dot(v2);
  }
  
  /**
   * Distance to a point from a 2d "pie slice," meaning a triangular cone + arc
   * From sdPie from https://iquilezles.org/articles/distfunctions2d/
   * @param {PIXI.Point} p						The point to measure distance to
   * @param {PIXI.Point} c						Angle (aperture) of the pie slice
   *   If total opening angle is Ø	
   * - c.x: sin(Ø/2)
   * - c.y: cos(Ø/2)
   * E.g., 90º (PI / 2) pie slice is { x: sin(PI / 4), y: cos(PI / 4) }
   * @param {number} r								Radius of the pie: distance from origin to circular outer edge
   * @returns {number}
   */
  static sdPie(p, c, r) {
    using pNew = PIXI.Point.fromObject(p);
    pNew.x = Math.abs(pNew.x);
    const l = pNew.magnitude() - r;
    
    using tmp = PIXI.Point.tmp;
    const m = pNew.subtract(c.multiplyScalar(Math.clamp(pNew.dot(c), 0.0, r), tmp), tmp).magnitude(); 
    return Math.max(l, m * Math.sign((c.y * p.x - c.x * p.y)));
  }
   
  // ----- NOTE: 2d Corners ----- //
  
  /** 
   * Nearest corner of a 2d segment to a point.
   * @param {PIXI.Point} p			The point to measure distance to.			
	 * @param {PIXI.Point} a			Endpoint of the segment, in canvas coordinates
	 * @param {PIXI.Point} b			Endpoint of the segment, in canvas coordinates
   * @returns {number} Always positive or zero; no inside for a segment.
   */
  static dCornerSquaredSegment(p, a, b) { 
    return Math.min(
      PIXI.Point.distanceSquaredBetween(p, a),
      PIXI.Point.distanceSquaredBetween(p, b),
    );
  }
    
  /**
   * Nearest "corner" of a 2d circle. Because it has no corners, returns distance to the edge.
   * @param {PIXI.Point} p			The point to measure distance to.			
	 * @param {number} r					Radius
	 * @returns {number}
	 */	
	static dCornerCircle(p, r) { return this.sdCircle(p, r); }
	
  /**
   * Nearest "corner" of a 2d ellipse. Because it has no corners, returns distance to the edge.
   * @param {PIXI.Point} p			The point to measure distance to.			
	 * @param {PIXI.Point} ab			Semi-axes of the ellipse. If ab.x === ab.y, it will be a circle.
	 *   - ab.x: radius along x-axis
	 *   - ab.y: radius along y-axis
	 * @returns {number}
	 */	
	static dCornerEllipse(p, ab) { return this.sdEllipse(p, ab); }
	
	/** 
	 * Nearest corner of a 2d box to a point.
	 * @param {PIXI.Point} p			The point to measure distance to.			
	 * @param {PIXI.Point} b			Box half-extents (width/2, height/2)
	 * @returns {number} Distance squared
	 */
	static dCornerSquaredBox(p, b) {
		// TODO: Use Foundry rectangle approach to get quadrants?
		using corner = PIXI.Point.tmp;
		corner.x = (Math.sign(p.x) || 1) * b.x;
		corner.y = (Math.sign(p.y) || 1) * b.y;
		return PIXI.Point.distanceSquaredBetween(p, corner);
	}
	  
	/**
	 * Brute force by taking the minimum of the four corners, for testing.
	 */
	static _dSquaredNearestCornerBoxBrute(p, d) {
		let dMin = Number.POSITIVE_INFINITY;
		using corner = PIXI.Point.tmp;
		for ( const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
			corner.set(dx * d.x, dy * dy);
			const d2 = PIXI.Point.distanceSquaredBetween(p, corner);
			dMin = Math.min(dMin, d2);
		}
		return dMin;
	}  
	/**
	 * Nearest corner of an oriented 2d box.
	 * (The sdf function measures distance to a 2d edge.) 
	 * @param {PIXI.Point} p			The point to measure distance to. 			
	 * @param {PIXI.Point} a			Endpoint of the central axis, in canvas coordinates
	 * @param {PIXI.Point} b			Endpoint of the central, in canvas coordinates
	 * @param {number} th					Thickness or half-width
	 * @returns {number} 
	 */
	static dCornerSquaredOrientedBox(p, a, b, th) {
		// Where does p lie along the central axis?
		const tCentral = closestPointToSegmentT(p, a, b);
		let majorPt = tCentral > 0.5 ? b : a;
		
		// Where does p lie along the minor axis?
		using delta = b.subtract(a);
		using normal = PIXI.Point.tmp.set(-delta.y, delta.x);
		normal.normalize(normal).multiplyScalar(th, normal);
		
		using nA = majorPt.add(normal);
		using nB = majorPt.subtract(normal);
		const tMinor = closestPointToSegmentT(p, nA, nB);
		const corner = tMinor > 0.5 ? nB : nA;
		return PIXI.Point.distanceSquaredBetween(p, corner); 
	}
	
	static dCornerOrientedBox(p, a, b, th) { return this.dCornerSquaredOrientedBox(p, a, b, th); }
  
	// Brute force version for testing.
	static _dCornerSquaredOrientedBoxBrute(p, a, b, th) {
		using corner = PIXI.Point.tmp
		let dMin = Number.POSITIVE_INFINITY;
		
		using delta = b.subtract(a);
		using normal = PIXI.Point.tmp.set(-delta.y, delta.x);
		normal.normalize(normal).multiplyScalar(th, normal);
		a.add(normal, corner);
		let d2 = PIXI.Point.distanceSquaredBetween(p, corner);
		dMin = Math.min(dMin, d2);
		
		a.subtract(normal, corner);
		d2 = PIXI.Point.distanceSquaredBetween(p, corner);
		dMin = Math.min(dMin, d2);
		
		b.add(normal, corner);
		d2 = PIXI.Point.distanceSquaredBetween(p, corner);
		dMin = Math.min(dMin, d2);
		
		b.subtract(normal, corner);
		d2 = PIXI.Point.distanceSquaredBetween(p, corner);
		dMin = Math.min(dMin, d2);
		
		return dMin;
	}

  // ----- NOTE: 3d SDF ----- //
  
  /**
   * Distance from a sphere.
   * @param {Point3d} p					The point to measure distance to.
   * @param {number} r					Radius
   * @returns {number}
   */
  static sdSphere(p, r) { return p.magnitude() - r; }
  
  /**
   * Distance from an ellipsoid
   * @param {Point3d} p					The point to measure distance to.
   * @param {Point3d} r					Radius in x, y, and z dimensions
   * @returns {number}
   */
  static sdEllipsoid(p, r) {
    const tmp = Point3d.tmp;
    const k0 = p.divide(r, tmp).magnitude();
    const k1 = p.divide(r.multiply(r, tmp), tmp).magnitude();
    return k0 * (k0 - 1.0) / k1;
  }
   
   /** 
    * Distance from a plane. 
	  * @param {Point3d} p					The point to measure distance to.
	  * @param {Point3d} n					Normalized vector
	  * @param {number} h						Offset from the origin along the normal vector (d, as additive offset). 
    * @returns {number}
    */
  static sdPlane(p, n, h) { return p.dot(n) + h; }
 
   /** 
    * Distance from a plane. 
	  * @param {Point3d} p					The point to measure distance to.
	  * @param {Plane} plane			  The plane
    * @returns {number}
    */ 
  static sdFromPlane(p, plane) { 
    using p0 = p.subtract(plane.point);
    return p0.dot(plane.normal);
  }
  
  /**
   * 3d planar triangle. In canvas coordinates.
   * @param {Point3d} p					The point to measure distance to.
   * @param {Point3d} a					First corner
   * @param {Point3d} b					Second corner
   * @param {Point3d} c					Third corner
   * @returns {number}
   */
  static sdTriangle3d(p, a, b, c) {
    using ba = b.subtract(a);
    using cb = c.subtract(b);
    using ac = a.subtract(c);
    
    using pa = p.subtract(a);
    using pb = p.subtract(b);
    using pc = p.subtract(c);
    
    using nor = ba.cross(ac);
    
    using xba = ba.cross(nor);
    using xcb = cb.cross(nor);
    using xac = ac.cross(nor);
    
    const test = Math.sqrt(
      Math.sign(xba.dot(pa)) + 
      Math.sign(xcb.dot(pb)) +
      Math.sign(xac.dot(pc))
    );
    if ( test < 2.0 ) {
      const dotBA = ba.multiplyScalar(Math.clamp(ba.dot(pa) / ba.dot2(), ba).subtract(pa, ba)).dot2();
      const dotCB = cb.multiplyScalar(Math.clamp(cb.dot(pb) / cb.dot2(), ba).subtract(pb, cb)).dot2();
      const dotAC = ac.multiplyScalar(Math.clamp(ac.dot(pc) / ac.dot2(), ac).subtract(pc, ac)).dot2();
      return Math.min(dotBA, dotCB, dotAC);
    }
    return (nor.dot(pa) ** 2) / nor.dot2();
  }
  
  /**
   * 3d planar rectangle. 
   * @param {Point3d} p					The point to measure distance to
   * @param {Point3d} b					Width, height (in y), and vertical height
   * @returns {number}
   */
  static sdRectangle3d(p, b) {
    // If on the plane, simply the 2d distance.
    if ( p.z.almostEqual(0) ) return this.sdRectangle(p.to2d(), b.to2d());
  
    // If within the rectangle, simply the height differential.
    // Rectangle centered on origin.
    if ( p.x.between(b.x * -0.5, b.x * 0.5) && p.y.between(b.y * -0.5, b.y * 0.5) ) return p.z;
    
    // Otherwise, it is the 3d distance to the closest edge.
    // Depends on the quadrant the point is in.
    // Can determine by using Pythagorean theorem from the 2d distance.
    const dist2d = this.sdRectangle(p.to2d(), b.to2d());
    return Math.sqrt((dist2d ** 2) + (p.z ** 2));
  }
  
  /**
   * 3d planar quad. In canvas coordinates.
   * @param {Point3d} p					The point to measure distance to
   * @param {Point3d} a					First corner
   * @param {Point3d} b					Second corner
   * @param {Point3d} c					Third corner
   * @param {Point3d} d					Fourth corner
   * @returns {number}
   */
  static sdQuad3d(p, a, b, c, d) {
    using ba = b.subtract(a);
    using cb = c.subtract(b);
    using dc = d.subtract(c);
    using ad = a.subtract(d);
    
    using pa = p.subtract(a);
    using pb = p.subtract(b);
    using pc = p.subtract(c);
    using pd = p.subtract(d);
    
    using nor = ba.cross(ad);
    
    using xba = ba.cross(nor);
    using xcb = cb.cross(nor);
    using xdc = dc.cross(nor);
    using xad = ad.cross(nor);
    
    const test = Math.sqrt(
      Math.sign(xba.dot(pa)) + 
      Math.sign(xcb.dot(pb)) +
      Math.sign(xdc.dot(pc)) +
      Math.sign(xad.dot(pd))
    );
    if ( test < 3.0 ) {
      const dotBA = ba.multiplyScalar(Math.clamp(ba.dot(pa) / ba.dot2(), ba).subtract(pa, ba)).dot2();
      const dotCB = cb.multiplyScalar(Math.clamp(cb.dot(pb) / cb.dot2(), ba).subtract(pb, cb)).dot2();
      const dotDC = dc.multiplyScalar(Math.clamp(dc.dot(pc) / dc.dot2(), dc).subtract(pc, dc)).dot2();
      const dotAD = ad.multiplyScalar(Math.clamp(ad.dot(pd) / ad.dot2(), ad).subtract(pd, ad)).dot2();
      return Math.min(dotBA, dotCB, dotDC, dotAD);
    }
    return (nor.dot(pa) ** 2) / nor.dot2();
  }

 /**
   * 3d planar polygon. In canvas coordinates.
   * @param {Point3d} p							The point to measure distance to.
   * @param {Polygon3d} poly3d			The polygon
   * @returns {number}
   */
  static sdPolygon3d(p, poly3d) {
    // Calculate the plane normal from the first 3 vertices.
    const normal = poly3d.plane.normal;
    
    // Project point onto plane.
    // using pProj = poly3d.plane.projectPointOnPlane(p);
    // Calculate manually b/c the h value is reused.
    using pv0 = p.subtract(poly3d.points[0]);
    const h = pv0.dot(normal);
    using pProj = Point3d.tmp;
    p.subtract(normal.multiplyScalar(h, pProj), pProj);
    
    
    // 2d SDF logic (summing squared distances to segments)
    let minDist2 = Number.POSITIVE_INFINITY;
    let inside = true;
    using ba = Point3d.tmp;
    using pa = Point3d.tmp;
    using delta = Point3d.tmp;
    using xbp = Point3d.tmp;
    for ( const { a, b } of poly3d.iterateEdges() ) {
      b.subtract(a, ba);
      pProj.subtract(a, pa);
      
      // Distance to line segment.
      const t = Math.clamp(pa.dot(ba) / ba.dot2(), 0.0, 1.0);
      pa.subtract(ba.multiplyScalar(t, delta), delta);
      minDist2 = Math.min(minDist2, delta.dot2());
      
      // Winding number or cross product check for "inside-ness."
      ba.cross(pa, xbp);
      if ( normal.dot(xbp) < 0.0 ) inside = false;
    }
    
    inside ? Math.abs(h) : Math.sqrt(minDist2 + (h ** 2));
  }
  
  static sdPolygon3dWithHoles(p, poly3d) {
    const iter = poly3d.polygons[Symbol.iterator];
    const poly = iter.next().value;
    let d = this.sdPolygon(p, [...poly.iteratePoints()]);
    for ( const poly of iter ) {
      // Tiles are all along the x/y plane, so can easily extract them.
      const op = poly.isHole ? "subtract" : "union";
      d = this[op](d, this.sdPolygon3d(p, [...poly.iteratePoints()]));      
    }
    return d;
  }

	/**
	 * Distance from a 3d box.
	 * Because a and b are in canvas coordinates, the box is at the canvas coordinates
	 * but with height 0 to h in the z axis. 
	 * @param {Point3d} p					The point to measure distance to.
	 * @param {PIXI.Point} a			Endpoint of the central axis, in canvas coordinates
	 * @param {PIXI.Point} b			Endpoint of the central, in canvas coordinates
	 * @param {number} th					Thickness or half-width
	 * @param {number} h					Height of the box
	 * @returns {number}
	 */			
	static sdOrientedRectangle3d(p, a, b, th, h) {
		const primitive = p => this.sdOrientedRectangle(p, a, b, th);
		return this.opExtrusion(p, primitive, h);
	}
	
	/**
	 * Alternative sdf for a box. 
	 * Aligned with the grid, but rotating the point beforehand can achieve an oriented rectangle. 
	 * @param {Point3d} p					The point to measure distance to.
	 * @param {Point3d} b					Three dimensions (half-sizes)
	 * @returns {number}
	 */
	static sdBox(p, b) {
	  using q = Point3d.tmp;
	  using zero = Point3d.tmp;
	  p.abs(q).subtract(b, q);
	  const c = Math.min(Math.max(q.x, q.y, q.z), 0.0);
	  const l = q.max(zero, q).magnitude();
	  return l + c;
	}
		
	// ----- NOTE: 3d Edges ----- //
	
	/** 
	 * Distance to a top or bottom edge of a 3d extruded SDF, where h is the height.
	 * @param {Point3d} p												The point to measure distance to.			
	 * @param {SDFSquared2d} primitiveSquared 					The 2d SDF function.
	 * @param {number} h												Height of the 3d SDF
	 * @returns {number} distance
	 */
	static dEdgeSquaredTopBottom(p, primitiveSquared, h) {
		// In 2d, the distance to the edge of the top or bottom face equals the 2d SDF.
		const d2 = primitiveSquared(p.to2d());
		
		// Distance from the bottom (0) or top (h) vertically.  
		const dz = Math.min(Math.abs(p.z), Math.abs(p.z - h));
		
		// Is this point inside the extruded object?
		const inside = (d2 < 0 && p.z.between(0, h)) ? -1 : 1;
		
		// Pythagorean to calculate the hypotenuse.
		return (Math.abs(d2) + (dz ** 2)) * inside;
	}

	static dEdgeTopBottomEdge(p, primitive, h) { 
		const d2 = this.dEdgeSquaredTopBottom(p, primitive, h);
		return Math.sign(d2) * Math.sqrt(Math.abs(d2)); 
	}
	
	/**
	 * Distance to a side (vertical) edge of a 3d extruded SDF, where h is the height.
	 * @param {Point3d} p																The point to measure distance to.			
	 * @param {dSquaredCorner} primitiveSquaredCorner 	The 2d corner squared function.
	 * @param {number} h																Height of the 3d SDF
	 * @returns {number} distance
	 */
	static dEdgeSquaredVertical(p, primitiveSquaredCorner, h) {
		// A vertical edge becomes a corner in 2d. 
		const d2 = primitiveSquaredCorner(p.to2d());
		
		// If within the height of the object, we are done.
		if ( p.z.between(0, h) ) return d2;
		
		// If above or below, use Pythagorean theorem to determine the diagonal.
		// Distance from the bottom (0) or top (h) vertically.  
		// Above or below, so not inside. Take the absolute value of d2.
		const dz = Math.min(Math.abs(p.z), Math.abs(p.z - h));
		return Math.abs(d2) + (dz ** 2); 
	}

  // ----- NOTE: Debug ----- 
  
  /**
   * Draw a heatmap for given boundary box of a distance measure.
   * @param {SDF} primitive				Function that takes a point and returns distance
   * @param {AABB2d} aabb					Bounds to draw
   * @param {number} maxD					Maximum distance to measure
   */
  static drawHeatmap2d(primitive, aabb, { step = 2, radius = 2, fillAlpha = 0.5 } = {}) {
    const maxD = PIXI.Point.distanceBetween(aabb.min, aabb.max) / 2;
    const heatmap = CONFIG.GeometryLib.lib.PixelCache.createHeatMap(0, maxD);
    const pt = PIXI.Point.tmp;
    for ( let x = aabb.min.x; x < aabb.max.x; x += step ) {
			for ( let y = aabb.min.y; y < aabb.max.y; y += step ) {
				pt.set(x, y)
				const dist = primitive(pt);
				const color = dist.almostEqual(0) ? Draw.COLORS.white : heatmap(Math.abs(dist));
				Draw.point(pt, { radius, color, fill: color, fillAlpha });
			}
		}
	}
	
	static drawHeatmap3d(primitive, aabb, { elevation = 0, step = 2, radius = 2, fillAlpha = 0.5 } = {}) {
    const maxD = PIXI.Point.distanceBetween(aabb.min, aabb.max) / 2;
    const heatmap = CONFIG.GeometryLib.lib.PixelCache.createHeatMap(0, maxD);
    const pt = Point3d.tmp;
    pt.z = elevation;    
    for ( let x = aabb.min.x; x < aabb.max.x; x += step ) {
			for ( let y = aabb.min.y; y < aabb.max.y; y += step ) {
				pt.set(x, y)
				const dist = primitive(pt);
				const color = dist.almostEqual(0) ? Draw.COLORS.white : heatmap(Math.abs(dist));
				Draw.point(pt, { radius, color, fill: color, fillAlpha });
			}
		}	  
	}
	
	// TODO: Move this to a constructed class that stores the placeable.
	
  /**
   * Signed distance for a placeable in 2d. 
   * @param {PIXI.Point} p			The point to measure distance to
   * @param {PlaceableObject} 	placeable
   * @param {...} opts					Options passed to the sdf method 
   * @returns {number}
   */
	static sd2d(p, placeable, ...opts) {
	  const fn = this.sdf2d(placeable, ...opts);
	  return fn(p);
	}
	
  /**
   * Signed distance for a placeable in 3d. 
   * @param {Point3d} p					The point to measure distance to
   * @param {PlaceableObject} 	placeable
   * @param {...} opts					Options passed to the sdf method 
   * @returns {number}
   */
	static sd3d(p, placeable, ...opts) {
	  const fn = this.sdf3d(placeable, ...opts);
	  return fn(p);
	}
	
	static sdf2d(_placeable, ..._opts) { throw Error("Must be defined by child class."); }
	
	static sdf3d(_placeable, ..._opts) { throw Error("Must be defined by child class."); }
	
	static aabb2d(_placeable) { throw Error("Must be defined by child class.");  }
	
  static draw2d(placeable, { padding = 0, ...opts } = {}) {
    const primitive = this.sdf2d(placeable, opts);
    const aabb = this.aabb2d(placeable);
    aabb.min.x -= padding;
    aabb.min.y -= padding;
    aabb.max.x += padding;
    aabb.max.y += padding;
    return this.drawHeatmap2d(primitive, aabb, opts);
  }
  
  static draw3d(placeable, { padding = 0, ...opts } = {}) {
    const primitive = this.sdf3d(placeable, opts);
    const aabb = this.aabb2d(placeable);
    aabb.min.x -= padding;
    aabb.min.y -= padding;
    aabb.max.x += padding;
    aabb.max.y += padding;
    opts.elevation ??= placeable.elevationZ;
    return this.drawHeatmap3d(primitive, aabb, opts);
  }
}

export class TileSDF {

  /**
   * SDF for a 2d tile.
   * Defaults to the rotated tile.
	 * @param {PIXI.Point} p			The point to measure distance to. 	
	 * @param {Tile} tile
	 * @param {object} [opts]
	 * @param {boolean} [opts.useAlphaThreshold=false] 		If true, use the polygon border that removes the 
	 *   transparent alpha pixels at the edge of the tile border
	 * @param {boolean} [opts.useHoles=false] 						If true, use the polygon alpha border
	 *   and cut holes for the transparent portions within the tile.
	 * @returns {number}
   */   
  static sdf2d(tile, { useAlphaThreshold = false, useHoles = false } = {}) {
    let sdfFn;
    if ( !(useAlphaThreshold || useHoles) ) sdfFn = tile.document.rotation ? "_sdfTileRotated" : "_sdfTileBasic";
    else if ( !useHoles ) sdfFn = "_sdfTileAlpha";
    else sdfFn = "_sdfTileAlphaPolygons";
    return this[sdfFn](tile);    
  }
 
  /**
   * SDF for a 2d tile without rotation.
	 * @param {Tile} tile
	 * @returns {function}
   */
  static _sdfTileBasic(tile) {
    const pTx = PIXI.Point.tmp;
    const b = PIXI.Point.tmp.set(tile.document.width, tile.document.height);
    const center = tile.center;  
    return p => {
      p.subtract(center, pTx);
      this.sdRectangle(pTx, b);
    }
  }

  /**
   * SDF for a 2d tile with rotation.
	 * @param {Tile} tile
	 * @returns {function}
   */  
  static _sdfTileRotated(tile) {
    // Need the central axis, defined by width along the rotation vector from center.
    // Note that tiles rotate around their x, y TL point, not around their center.
    // It is assumed that tile scale is not relevant, just tile width and height.
    // 45º: SE; 90º: S, ...
    
    // Move to origin, rotate, and move back.
    const { x, y, width, height, rotation } = tile.document;
    
    using translateM = Matrix.translation(-x, -y);
    using rot = Matrix.rotationZ(rotation, false);
    using invTranslateM = Matrix.translation(x, y);
    using M = Matrix.tmpMatrix(3, 3);
    invTranslateM.multiply3x3(rot, M).multiply3x3(translateM, M);
    
    // Central axis.
    const a = PIXI.Point.fromObject(tile.center);
    const b = PIXI.Point.fromObject(tile.center);
    a.x += width * 0.5;
    b.x -= width * 0.5;
    
    // Translate and rotate the central axis.
    M.multiplyPoint2d(a, a);
    M.multiplyPoint2d(b, b);
    
    // Calculate the SDF.
    return p => this.sdOrientedRectangle(p, a, b, height);
  }
  
  /**
   * SDF for a 2d tile with a polygon alpha threshold
	 * @param {Tile} tile
	 * @returns {function}
   */
  _sdfTileAlpha(tile) {
    const cache = tile.evPixelCache;
    const alphaThreshold = tile.document.texture.alphaThreshold;
    if ( !cache || alphaThreshold == 1 || alphaThreshold === 0 ) return tile.document.rotation 
      ? this._sdfTileRotated(tile) : this._sdfTileBasic(tile);
      
    const poly = cache.getThresholdCanvasBoundingPolygon(alphaThreshold);
    const points = [...poly.iteratePoints()];
    return p => this.sdPolygon(p, points);    
  }
  
  /**
   * SDF for a 2d tile with a polygon alpha threshold with holes
	 * @param {Tile} tile
	 * @returns {function}
   */
  _sdfTileAlphaPolygons(tile) {
    const geom = tile[GEOMETRY_LIB_ID][GEOMETRY_ID];
    const polys = geom?.alphaThresholdPolygons;  
    const alphaThreshold = tile.document.texture.alphaThreshold;
    if ( !polys || alphaThreshold == 1 || alphaThreshold === 0 ) return tile.document.rotation 
      ? this._sdfTileRotated(tile) : this._sdfTileBasic(tile);
 
    // TODO: Fix convertTileToIsoBands error.
    // TODO: Handle rotated tiles correctly in geometry.
    const polys2d = polys.map(poly => {
      const p = poly.to2d();
      p.isHole = poly.isHole;
      return p;
    });
    return p => this.sdPolygonsWithHoles(p, polys2d);
  }
     
  /**
   * SDF for a 3d tile, treated as a 3d quad or 3d polygon.
	 * @param {Tile} tile
	 * @param {object} [opts]
	 * @param {boolean} [opts.useAlphaThreshold=false] 		If true, use the polygon border that removes the 
	 *   transparent alpha pixels at the edge of the tile border
	 * @param {boolean} [opts.useHoles=false] 						If true, use the polygon alpha border
	 *   and cut holes for the transparent portions within the tile.
	 * @returns {number}
   */
  static sdf3d(tile, { useAlphaThreshold = false, useHoles = false } = {}) { 
    let sdfFn;
    if ( !(useAlphaThreshold || useHoles) ) sdfFn = tile.document.rotation ? "_sdfTile3dRotated" : "_sdfTile3dBasic";
    else if ( !useHoles ) sdfFn = "_sdfTile3dAlpha";
    else sdfFn = "_sdfTile3dAlphaPolygons";
    return this[sdfFn](tile);      
  }
  
  /**
   * SDF for a 3d tile without rotation.
	 * @param {Tile} tile
	 * @returns {number}
   */
  static _sdfTile3dBasic(tile) {
    const ctr = tile.center;
    using b = PIXI.Point.tmp.set(tile.document.width, tile.document.height)    
    return p => {
      using pTx = p.subtract(ctr);
      return this.sdRectangle3d(pTx, b);
    }
  }
  
  /**
   * SDF for a 3d tile with rotation.
	 * @param {Tile} tile
	 * @returns {number}
   */
  static _sdfTile3dRotated(tile) {
    // Move to origin, rotate, and move back.
    const { x, y, width, height, rotation } = tile.document;
    using translateM = Matrix.translation(-x, -y);
    using rot = Matrix.rotationZ(rotation, false);
    using invTranslateM = Matrix.translation(x, y);
    using M = Matrix.tmpMatrix(3, 3);
    invTranslateM.multiply3x3(rot, M).multiply3x3(translateM, M);
    
    // Four corners
    using a = PIXI.Point.tmp.set(x, y);
    using b = PIXI.Point.tmp.set(x + width, y);
    using c = PIXI.Point.tmp.set(x + width, y + height);
    using d = PIXI.Point.tmp.set(x, y + height);
    
    // Translate and rotate the central axis.
    M.multiplyPoint2d(a, a);
    M.multiplyPoint2d(b, b);
    M.multiplyPoint2d(c, c);
    M.multiplyPoint2d(d, d);
    
    // Add tile elevation to locate 3d corners.
    const elevationZ = tile.elevationZ;
    const a3d = Point3d.tmp.set(a.x, a.y, elevationZ);
    const b3d = Point3d.tmp.set(b.x, b.y, elevationZ);
    const c3d = Point3d.tmp.set(c.x, c.y, elevationZ);
    const d3d = Point3d.tmp.set(d.x, d.y, elevationZ);
    return p => this.sdQuad3d(p, a3d, b3d, c3d, d3d);
  } 
  
  /**
   * SDF for a 3d tile with a polygon alpha threshold
	 * @param {Tile} tile
	 * @returns {number}
   */
  static _sdfTile3dAlpha(tile) {
    const cache = tile.evPixelCache;
    const alphaThreshold = tile.document.texture.alphaThreshold;
    if ( !cache || alphaThreshold == 1 || alphaThreshold === 0 ) return tile.document.rotation 
      ? this._sdfTile3dRotated(tile) : this._sdfTile3dBasic(tile);
      
    const poly = cache.getThresholdCanvasBoundingPolygon(alphaThreshold);
    const poly3d = Polygon3d.fromPolygon(poly, tile.elevationZ);
    return p => this.sdPolygon3d(p, poly3d);
  }
  
  /**
   * SDF for a 3d tile with a polygon alpha threshold with holes
	 * @param {Point3d} p			The point to measure distance to. 	
	 * @param {Tile} tile
	 * @returns {number}
   */
 static  _sdTile3dAlphaPolygons(p, tile) {
    const geom = tile[GEOMETRY_LIB_ID][GEOMETRY_ID];
    const polys = geom?.alphaThresholdPolygons;  
    const alphaThreshold = tile.document.texture.alphaThreshold;
    if ( !polys || alphaThreshold == 1 || alphaThreshold === 0 ) return tile.document.rotation 
      ? this._sdTileRotated(p, tile) : this._sdTileBasic(p, tile);
 
    // TODO: Fix convertTileToIsoBands error.
    // TODO: Handle rotated tiles correctly in geometry.
    return this.sdPolygon3dWithHoles(p, polys.top.polygons);
  }
  
  static aabb2d(tile) { return AABB2d.fromTile(tile); }
}

export class TokenSDF {

  static aabb2d(token) { return AABB2d.fromToken(token); }
   
  /**
   * Signed distance function for a given token
   */
  static sdf2d(token, shapeType) {
    if ( token.isConstrainedTokenBorder ) return this._sdfTokenPolygon(token);

    const geom = token[GEOMETRY_LIB_ID][GEOMETRY_ID];
    shapeType ??= geom.shapeType;
    const TYPES = TokenGeometry.SHAPE_TYPES;    
    switch ( shapeType ) {
      // For spherical and ellipsoid, use 2d versions.
      case TYPES.SPHERICAL: return this._sdfTokenCircle(token);
      case TYPES.ELLIPSOID: 
      case TYPES.ELLIPSE: return this._sdfEllipse(token);
      case TYPES.CUBE: return this._sdfRectangle(token);
      case TYPES.HEXAGONAL: {
        const { width, height } = token.document; 
        const w = width * canvas.grid.size;
        const h = height * canvas.grid.size;
        if ( (w === 1 || w === 0.5) && (h === 1 || h === 0.5) ) {
          // TODO: Need to rotate depending on grid.
          // TODO: Need correct hexagon radius.
          return this._sdfHexagon(token);
        } else return this._sdfPolygon(token)
      }
    }
  }

  static _sdfTokenCircle(token) {
    const ctr = token.center;
    const txMat = Matrix.translation(-ctr.x, -ctr.y);
    const txPt = PIXI.Point.tmp;
    const { width, height } = token.document; 
    const w = width * canvas.grid.size;
    const h = height * canvas.grid.size;
    const r = Math.max(w, h) * 0.5;
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      return this.sdCircle(txPt, r);
    }
  }
  
  static _sdfTokenEllipse(token) {
    const ctr = token.center;
    const txMat = Matrix.translation(-ctr.x, -ctr.y);
    const txPt = PIXI.Point.tmp;
    const { width, height } = token.document; 
    const w = width * canvas.grid.size;
    const h = height * canvas.grid.size;
    const ab = PIXI.Point.tmp(w * 0.5, h * 0.5);
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      return this.sdEllipse(txPt, ab);
    };
  }
  
  static _sdfTokenRectangle(token) {
    const ctr = token.center;
    const txMat = Matrix.translation(-ctr.x, -ctr.y);
    const txPt = PIXI.Point.tmp;
    const { width, height } = token.document; 
    const w = width * canvas.grid.size;
    const h = height * canvas.grid.size;
    const ab = PIXI.Point.tmp(w * 0.5, h * 0.5);
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      return this.sdRectangle(txPt, ab);
    };   
  }
  
  static _sdfTokenHexagon(token) {
    const ctr = token.center;
    const txMat = Matrix.translation(-ctr.x, -ctr.y);
    const txPt = PIXI.Point.tmp;
    const w = token.document.width * canvas.grid.size;
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      return this.sdRectangle(txPt, w * 0.5);
    };     
  }
  
  static _sdfTokenPolygon(token) {
    const geom = token[GEOMETRY_LIB_ID][GEOMETRY_ID];
    const points = [...geom.faces.top.toPolygon2d().iteratePoints()];
    return p => this.sdPolygon(p, points);
  }
  
  /**
   * SDF for a 3d token. 
   * Simple version for testing.
	 * @param {Token} token
   * @param {SHAPE_TYPES} shapeType			The shape that represents the token
   * @returns {number}
   */
  static _sdf3d(token, shapeType) {
    const primitive = this.sdf2d(token, shapeType);
    const h = token.topZ - token.bottomZ;
    return p => this.opExtrusion(p, p => primitive(p.to2d()), h);
  }
  
  /**
   * SDF for a 3d token. 
   * Same as _sdf3d, but use different variations depending on shape type.
   * More efficient for shapes like spheres.
	 * @param {Token} token
   * @param {SHAPE_TYPES} shapeType			The shape that represents the token
   * @returns {number}
   */
  static sdf3d(token, shapeType) {
    if ( token.isConstrainedTokenBorder ) return this._sdfToken3d(token, shapeType);
    
    const geom = token[GEOMETRY_LIB_ID][GEOMETRY_ID];
    shapeType ??= geom.shapeType;
    const TYPES = geom.constructor.SHAPE_TYPES;
    
    const { center, topZ, bottomZ } = token;
    using ctr = Point3d.tmp.fromObject(center);
    ctr.z = bottomZ + ((topZ - bottomZ) * 0.5);
    const { width, height } = token.document; 
    const w = width * canvas.grid.size;
    const h = height * canvas.grid.size;
    const vHeight = topZ - bottomZ;
    const txMat = Matrix.translate(-ctr.x, -ctr.y, -ctr.z);
    const txPt = Point3d.tmp;
    
    switch ( shapeType ) {
      case TYPES.SPHERICAL: {
        return p => {
          txMat.multiplyPoint3d(p, txPt);
          return this.sdSphere(txPt, Math.max(w, h, vHeight));
        };        
      }
      case TYPES.ELLIPSOID: {
        return p => {
          txMat.multiplyPoint3d(p, txPt);
          return this.sdEllipsoid(txPt, Point3d.tmp.set(w, h, vHeight));
        };
      }
      case TYPES.CUBE: {
        return p => {
          txMat.multiplyPoint3d(p, txPt);
          return this.sdBox(txPt, Point3d.tmp.set(w, h, vHeight));
        };
      }
      case TYPES.ELLIPSE: 
      default: return p => this._sdf3d(p, token, shapeType);
    }
  } 
  
  static _sdfTokenSphere(token) {
    const { center, topZ, bottomZ } = token;
    using ctr = Point3d.tmp.fromObject(center);
    ctr.z = bottomZ + ((topZ - bottomZ) * 0.5);
    
    const { width, height } = token.document; 
    const w = width * canvas.grid.size;
    const h = height * canvas.grid.size;
    const vHeight = topZ - bottomZ;
    
    const txMat = Matrix.translate(-ctr.x, -ctr.y, -ctr.z);
    const txPt = Point3d.tmp;
    const r = Math.max(w, h, vHeight);
    return p => {
      txMat.multiplyPoint3d(p, txPt);
      this.sdSphere(txPt, r);
    }
  }
  
  static _sdfTokenEllipsoid(token) {
    const { center, topZ, bottomZ } = token;
    using ctr = Point3d.tmp.fromObject(center);
    ctr.z = bottomZ + ((topZ - bottomZ) * 0.5);
    
    const { width, height } = token.document; 
    const w = width * canvas.grid.size;
    const h = height * canvas.grid.size;
    const vHeight = topZ - bottomZ;
    
    const txMat = Matrix.translate(-ctr.x, -ctr.y, -ctr.z);
    const txPt = Point3d.tmp;
    const r = Point3d.tmp.set(w, h, vHeight);
    return p => {
      txMat.multiplyPoint3d(p, txPt);
      this.sdEllipsoid(txPt, r);
    }    
  }
  
  static _sdfTokenCube(token) {
    const { center, topZ, bottomZ } = token;
    using ctr = Point3d.tmp.fromObject(center);
    ctr.z = bottomZ + ((topZ - bottomZ) * 0.5);
    
    const { width, height } = token.document; 
    const w = width * canvas.grid.size;
    const h = height * canvas.grid.size;
    const vHeight = topZ - bottomZ;
    
    const txMat = Matrix.translate(-ctr.x, -ctr.y, -ctr.z);
    const txPt = Point3d.tmp;
    const r = Point3d.tmp.set(w, h, vHeight);
    return p => {
      txMat.multiplyPoint3d(p, txPt);
      this.sdBox(txPt, r);
    }    
  }
  
  static _sdfTokenEllipse3d(token) {
    return this._sdf3d(token, TokenGeometry.SHAPE_TYPES.ELLIPSE);
  }
  
  static _sdfTokenHexagon3d(token) {
    return this._sdf3d(token, TokenGeometry.SHAPE_TYPES.HEXAGONAL);
  }
}

/**
 * For regions, treat similarly to RegionGeometry; consider circles, rectangles, ellipses separately.
 * In v14, we have rotation for regions.
 * Shapes:
 * - circles
 * - rectangles
 * - ellipses
 * - polygons 
 * - rings (only circular for now)
 * - lines, which are just rectangles defined slightly differently
 * - cones (flat (isoceles triangle), round, semicircle)
 * - emanations (rounded rectangles)
 *
 * These shapes are extruded to create the 3d region.
 * - plateau: simple extrusion
 * - ramp: extrusion + sideways extruded triangle
 * - steps: extrusion + sideways extruded steps
 */
export class RegionSDF {

  // ----- NOTE: 2d SDFs ----- //
  
  static sdf2d(region) {
    // Combine the various region primitives, using union plus subtraction to remove holes.    
    // Could union all shapes at once, but would need separate hole handling.
    // Instead, follow logic of sdPolygon3dWithHoles.
    const shapes = region.document.shapes;
    if ( !shapes.length ) return _p => Number.POSITIVE_INFINITY;
    
    // TODO: More nuanced test for whether the walls actually restrict the current shape.
    const shapeSDFs = region.document.restriction.enabled 
      ? shapes.map(shape => this.sdfPolygons(shape.polygons))
        : shapes.map(shape => this.sdf2dForShape(shape));
        
    return p => {
      let d = shapeSDFs[0](p); // NOTE: Assumes no hole to start.
      for ( let i = 1, n = shapeSDFs.length; i < n; i += 1 ) {
        const op = shapes[i].hole ? "subtract" : "union";
        d = this[op](d, shapeSDFs[i](p));
      } 
      return d;  
    };
  }
  
  static sdf2dForShape(shapeData) {
    if ( shapeData.gridBased ) return this.sdfPolygons(shapeData.polygons);
  
    // shape.constructor.TYPES lists all shape types.
    switch ( shapeData.type ) {
      case "circle": return this._sdfRegionCircle(shapeData);
      case "cone": return this._sdfRegionCone(shapeData);
      case "emanation": return this._sdfRegionEmanation(shapeData);
      case "ellipse": return this._sdfRegionEllipse(shapeData);
      case "line": return this._sdfRegionLine(shapeData);
      case "polygon": return this.sdfPolygons(shapeData.polygons);
      case "rectangle": return this._sdfRegionRectangle(shapeData)
      case "ring": return this._sdfRegionRing(shapeData);
      
      case "grid": 
      case "token": 
      default: {
        console.warn(`Region shape type ${shapeData.type} not yet implemented. Using polygons.`);
        return this.sdfPolygons(shapeData.polygons);
      } 
    }
  }
  
  
  /**
   * Distance function for a region circle shape.
   * @param {CircleShapeData} shapeData			
   * @return {SDF} A function to measure distance from a point.
   */ 
  static _sdfRegionCircle(shapeData) {
    // Forgo garbage collection for speed of pre-allocated matrix.
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const txPt = PIXI.Point.tmp;
    const r = shapeData.radius;
    return p => {
       txMat.multiplyPoint3d(p, txPt);
       return this.sdCircle(txPt, r);
    }
  }
  
  /**
   * Distance function for a region rectangular shape.
   * @param {RectangleShapeData} shapeData
   * @return {SDF} A function to measure distance from a point.
   */
  static _sdfRegionRectangle(shapeData) {
    // rotation
    // width
    // height
    let w1_2;
    let h1_2;
    if ( shapeData instanceof foundry.data.LineShapeData ) {
      w1_2 = shapeData.length * 0.5;
      h1_2 = shapeData.width * 0.5;
    } else {
      w1_2 = shapeData.width * 0.5;
      h1_2 = shapeData.height * 0.5
    }
    
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    
    if ( shapeData.rotation === 0 ) {
      // Forgo garbage collection for speed of pre-allocated matrix.
      const txPt = PIXI.Point.tmp;
      const b = PIXI.Point.tmp.set(w1_2, h1_2);
      return p => {
        txMat.multiplyPoint2d(p, txPt);
        return this.sdRectangle(txPt, b);
      }
    }
    
    // TODO: Fix b/c rotation is around the TL corner.
    const ctr = shapeData.center;
    const a = PIXI.Point.tmp.set(ctr.x - w1_2, ctr.y);
    const b = PIXI.Point.tmp.set(ctr.x + w1_2, ctr.y);
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const M = rotMat.multiply3x3(txMat);
    M.multiplyPoint2d(a);
    M.multiplyPoint2d(b);
    return p => this.sdOrientedRectangle(p, a, b, h1_2);  
  }    
  
	/**
	 * Distance function for a region line shape.
	 * @param {LineShapeData} shapeData
	 * @return {SDF} A function to measure distance from a point.
	 */
	static _sdfRegionLine = this._sdfRegionRectangle;
  
  /**
   * Distance function for a region ellipse shape.
   * @param {EllipseShapeData} shapeData
   * @return {SDF} A function to measure distance from a point.
   */
  static _sdfRegionEllipse(shapeData) {
    // radiusX
    // radiusY
    // rotation
    const ab = PIXI.Point.tmp.set(shapeData.radiusX, shapeData.radiusY);
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const M = rotMat.multiply3x3(txMat);
    const txPt = PIXI.Point.tmp;
    return p => {
      M.multiplyPoint2d(p, txPt);
      return this.sdEllipse(p, ab);
    }
  }
  
  /**
   * Distance function for a region cone shape
   * @param {ConeShapeData} shapeData
   * @return {SDF} A function to measure distance from a point.
   */
  static _sdfRegionCone(shapeData) {
    // angle
    // curvature: flat, round, semicircle
    // radius
    // rotation
    
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const M = rotMat.multiply3x3(txMat);
    const txPt = PIXI.Point.tmp;
    
    switch ( shapeData.curvature ) {
      case "flat": {
        const theta_1_2 = Math.toRadians(shapeData.angle) * 0.5;
        const q = PIXI.Point.tmp.set(
          Math.tan(theta_1_2 * shapeData.radius), // Half-width of the base
          shapeData.radius, // Altitude
        );
        return p => {
          M.multiplyPoint2d(p, txPt);
          return this.sdTriangleIsosceles(txPt, q);
        }
      }
      case "round": {
        const theta_1_2 = Math.toRadians(shapeData.angle) * 0.5;
        const c = PIXI.Point.tmp.set(
          Math.sin(theta_1_2),
          Math.cos(theta_1_2),
        );
        const r = shapeData.radius;
        return p => {
          M.multiplyPoint2d(p, txPt);
          return this.sdPie(txPt, c, r);
        };
      }
      
      case "semicircle": {
        // Radius is the length from the cone point through the half-circle center to the half-circle edge.
        // Radius = h + r
        // h = s * cos(Ø/2)
        // Triangle's base is the diameter of the semi-circle, so r = h * tan(Ø/2)
        // H = h + r
        // H = h + h * tan(Ø/2) = h(1 + tan(Ø/2))
        // h = H / (1 + tan(Ø/2))
        const totalH = shapeData.radius;
        const theta = Math.toRadians(shapeData.angle);
        const h = totalH / (1 + Math.tan(theta / 2));
        const r = totalH - h;
        return p => {
          M.multiplyPoint2d(p, txPt);
          return this.sdConeSemiCircle(txPt, r, h);
        };
      }
    }
  }
  
  /**
   * Distance function for a region ring shape.
   * @param {RingShapeData} shapeData
   * @returns {number}
   */
  static _sdfRegionRing(shapeData) {
    // innerWidth
    // outerWidth
    // radius
    // rotation (unused?)
    // Total width is innerWidth - radius to radius + outerWidth
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const txPt = PIXI.Point.tmp;
    const outerRadius = shapeData.radius + shapeData.outerWidth;
    const width = shapeData.outerWidth - shapeData.innerWidth;
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      const outerCircleFn = p => this.sdCircle(p, outerRadius);
      return this.opOnion(txPt, outerCircleFn, width);
    }
  }
  
  /**
   * Distance function for a region emanation shape (rounded rectangle).
   * @param {EmanationShapeData} shapeData
   * @returns {number}
   */
  static _sdfRegionEmanation(shapeData) {
    // base.height, base.width (e.g, 1, 2): number of grid spaces in each direction from center.
    // radius (of the corner)
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const M = rotMat.multiply3x3(txMat);
    const txPt = PIXI.Point.tmp;
    
    const b = PIXI.Point.tmp.set(
      shapeData.base.width * canvas.grid.size,
      shapeData.base.height * canvas.grid.size,
    );
    const r = shapeData.radius;
    return p => {
      M.multiplyPoint2d(p, txPt);
      return this.sdRoundedRectangle(p, b, r);
    };
  }
  
  /**
   * Distance function for a region polygon shape.
   * @param {PolygonShapeData} shapeData
   * @returns {number}
   */
  static _sdfRegionPolygon(shapeData) {
    // points
    // rotation
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const txPt = PIXI.Point.tmp;
    const poly = new PIXI.Polygon(shapeData.points);
    return p => {
      rotMat.multiplyPoint2d(p, txPt);
      return this.sdPolygon2d(txPt, poly);
    };
  }
  
  // ----- NOTE: 3d SDFs ----- //
  
  static sdf3d(region) {
    // Extrude all vertically. 
    // Add ramps and steps separately.
    // Before this, filter out non-TM plateaus if needed.
    const gridUnitsToPixels = CONFIG.GeometryLib.lib.utils.gridUnitsToPixels;
    
    
    // Extrude to either TM plateau, TM ramp/step bottom, or region elevation.
    const tm = region.terrainmapper;
    
    // TODO: Need to center the region correctly for the height. 
    const sdf2d = tm && tm.isSteps  
      ? tm.shapes.map(shape => this.sdf2dForShape(shape)) : this.sdf2d(region);
    
    if ( !tm || !tm.isElevated ) {
      const h = tm.finiteRegionHeight;
      return p => this.opExtrusion(p, sdf2d, h);
    }
    
    // Plateau
    if ( tm.isPlateau ) {
      const h = tm.finitePlateauHeight;
      return p => this.opExtrusion(p, sdf2d, h);      
    }
    
    // Ramp, single plane
    if ( !tm.rampStepSize && !tm.splitPolygons ) {
      const h = tm.finitePlateauHeight;
      const plane = tm.calculateSingleRampPlane();
      
      // Extrude a 3d shape to the top of the ramp, then cut the shape using the plane to form a ramp.
      // Depends on plane normal pointing up.
      return p => {
        const shapeDist = this.opExtrusion(p, sdf2d, h);
        const planeDist = this.sdFromPlane(p, plane);
        return this.intersection(shapeDist, planeDist);
      }
    }
    
    // Ramp, multi-plane
    if ( !tm.rampStepSize && tm.splitPolygons ) {
      const h = tm.finitePlateauHeight;
      const planes = tm.calculateMultiPolygonRampPlanes();
      
      // Extrude a 3d shape for each region shape, and intersect the corresponding plane.
      return p => {
        const dists = sdf2d.map((sdf, idx) => {
          const shapeDist = this.opExtrusion(p, sdf, h);
          const planeDist = this.sdFromPlane(p, planes[idx]);
          return this.intersection(shapeDist, planeDist);
        });
        return this.union(...dists);
      }
    }
    
    // Steps, single plane
    if ( tm.rampStepSize && !tm.splitPolygons ) {
      // Extrude a 3d shape to the bottom of the stairs, then union with extruded steps.
      // NOTE: Steps extruded depth-wise, not vertically.
      const n = tm.numSteps;
      const baseH = gridUnitsToPixels(tm.rampFloor) - tm.finiteRegionBottom;
      const stepsH = gridUnitsToPixels(tm.plateauElevation - tm.rampFloor);
      const rampPoints = tm._calculatePolygonRampPoints(region.polygons);
      const wh = PIXI.Point.tmp.set(
        PIXI.Point.distanceBetween(rampPoints[0], rampPoints[1]),
        rampPoints[1].z - rampPoints[0].z,
      );
      
      // Rotate to extrude steps perpendicular to canvas.
      const rotMat = Matrix.rotationX(Math.PI_1_2) // 90º rotation around X axis.
      const txMat = Matrix.translation(0, 0, baseH);
      const pTx = Point3d.tmp;
      
      // To determine how far the stairs have to go, can either:
      // 1. Rotate the polygons to align with the ramp direction and then get the top/bottom bounds
      // 2. Pick arbitrary extremely large spacing.
      
      // SDF is the combined 3d shape + steps.
      return p => {
        const baseShapeDist = this.opExtrusion(p, sdf2d, baseH);
        
        txMat.multiplyPoint3d(p, pTx)
        const stepShapeDist = this.opExtrusion(pTx, sdf2d, stepsH)
        
        // Rotate to extrude steps perpendicular to canvas.
        rotMat.multiplyPoint3d(pTx, pTx);
        const sdfSteps = this.sdStairs(pTx, wh, n);
        const stepsDist = this.opExtrusion(pTx, sdfSteps, 1e06);
        
        // Intersect steps with the underlying shape.
        // Then combine with the base.
        return this.union(
          baseShapeDist,
          this.intersection(stepShapeDist, stepsDist),
        );
      };
    }
    
    // Stairs, multi-plane
    if ( tm.rampStepSize && tm.splitPolygons ) {
      // Calculate for each polygon.
      const n = tm.numSteps;
      const baseH = gridUnitsToPixels(tm.rampFloor) - tm.finiteRegionBottom;
      const stepsH = gridUnitsToPixels(tm.plateauElevation - tm.rampFloor);
      const rampPoints = region.document.shapes.forEach(shape => tm._calculatePolygonRampPoints(shape.polygons));
      const wh = rampPoints.forEach(rp => {
				PIXI.Point.tmp.set(
					PIXI.Point.distanceBetween(rp[0], rp[1]),
					rp[1].z - rp[0].z,
				);
			});
      
      // Rotate to extrude steps perpendicular to canvas.
      const rotMat = Matrix.rotationX(Math.PI_1_2) // 90º rotation around X axis.
      const txMat = Matrix.translation(0, 0, baseH);
      const pTx = Point3d.tmp;
      
      return p => {
        const dists = sdf2d.map((sdf, idx) => {
					const baseShapeDist = this.opExtrusion(p, sdf, baseH);
					
					txMat.multiplyPoint3d(p, pTx)
					const stepShapeDist = this.opExtrusion(pTx, sdf, stepsH)
					
					// Rotate to extrude steps perpendicular to canvas.
					rotMat.multiplyPoint3d(pTx, pTx);
					const sdfSteps = this.sdStairs(pTx, wh[idx], n);
					const stepsDist = this.opExtrusion(pTx, sdfSteps, 1e06);
					
					// Intersect steps with the underlying shape.
					// Then combine with the base.
					return this.union(
						baseShapeDist,
						this.intersection(stepShapeDist, stepsDist),
					);          
        });
        return this.union(...dists);
      };
    }    
  }
  
  
}

// ---- NOTE: Helper functions ----- //

/**
 * Identify the t-value on segment A|B closest to C.
 * @param {Point} c     The reference point C
 * @param {Point} a     Point A on segment AB
 * @param {Point} b     Point B on segment AB
 * @returns {number}    T-value, where 0 is a and 1 is b. Negative numbers are before a; >1 is after b.
 * @see {@link https://en.wikipedia.org/wiki/Distance_from_a_point_to_a_line#Line_defined_by_two_points}
 */
function closestPointToSegmentT(c, a, b) {
  using d = b.subtract(a);
  if ( d.x === 0 && d.y === 0 ) return 0;
  
  using ca = c.subtract(a);
  return ca.dot(d) / d.dot(d);  
}

/**
 * Distance squared to a segment A|B.
 * @param {Point} c     The reference point C
 * @param {Point} a     Point A on segment AB
 * @param {Point} b     Point B on segment AB
 * @returns {number}
 */
/*
function distanceSquaredToSegment(c, a, b) {
  if ( a.almostEqual(b) ) return PIXI.Point.distanceBetweenSquared(a, c);
  const x = a.almostEqual(b) ? a : foundry.utils.closestPointToSegment(c, a, b);
  return PIXI.Point.distanceSquaredBetween(x, c);
}
*/
