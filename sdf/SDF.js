/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { Matrix } from "../Matrix.js";
import { Draw } from "../Draw.js";

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
   * Subtract sd b from sd a. (E.g, a - b.)
   * Not commutative.
   * NOTE: Opposite how https://iquilezles.org/articles/distfunctions/ does it.
   * @param {number} a			Distance of first SDF
   * @param {number} b			Distance of second SDF
   * @param {number} Distance to the combined object.
   */
  static subtraction(a, b) { return Math.max(a, -b); }
  
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
	 * Distance to a 2d segment.
	 * Already uses canvas coordinates; no transform required.
	 * @param {PIXI.Point} p			The point to measure distance to. 			
	 * @param {PIXI.Point} a			Endpoint of the segment, in canvas coordinates
	 * @param {PIXI.Point} b			Endpoint of the segment, in canvas coordinates
	 * @returns {number} Always positive or zero; no inside for a segment.
	 */	 
	static sdSegment(p, a, b) { 
	  const res = this._sdSquaredSegment(p, a, b);
	  return Math.sqrt(Math.abs(res)) * Math.sign(res);   
	} 
	 
	static _sdSquaredSegment(p, a, b) {
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
	static sdCircle(p, r) { return p.magnitude() - r; }
		
	/**
	 * Distance to a 2d PIXI circle.
	 * @param {PIXI.Point} p						The point to measure distance to			
	 * @param {PIXI.Circle} cir					Circle
	 * @returns {number}
	 */
	static sdPIXICircle(p, cir) {
	  using txMat = Matrix.translation(-cir.x, -cir.y);
	  using txPt = txMat.multiplyPoint2d(p);
	  return this.sdCircle(txPt, cir.radius);
	}
			
	/**
	 * Distance to a 2d ellipse.
	 * @param {PIXI.Point} p			The point to measure distance to.	
	 * @param {PIXI.Point} ab			Semi-axes of the ellipse. If ab.x === ab.y, it will be a circle.
	 *   - ab.x: radius along x-axis
	 *   - ab.y: radius along y-axis
	 * @returns {number}
	 */
	static sdEllipse(p, ab) { 
	  const res = this._sdSquaredEllipse(p, ab);
	  return Math.sqrt(Math.abs(res)) * Math.sign(res); 
	}
	
	static _sdSquaredEllipse(p, ab) {
	  if ( ab.x.almostEqual(ab.y) ) return (this.sdCircle(p, ab.x) ** 2);
	  
	  using pAbs = p.abs();	 	  
	  using abTmp = PIXI.Point.fromObject(ab);
	  if ( pAbs.x > pAbs.y ) {
	    [pAbs.x, pAbs.y] = [pAbs.y, pAbs.x];
	    [abTmp.x, abTmp.y] = [abTmp.y, abTmp.x];
	  }
	  
	  const l = (abTmp.y ** 2) - (abTmp.x ** 2);
	  const m = (abTmp.x * pAbs.x) / l;
	  const n = (abTmp.y * pAbs.y) / l;
	  const m2 = m ** 2;
	  const n2 = n ** 2;
	  const c = (m2 + n2 - 1.0) / 3.0;
	  const c3 = c ** 3;
	  const d = c3 + (m2 * n2);
	  const q = d + (m2 * n2);
	  const g = m + (m * n2);
	  let co;
	  if ( d < 0.0 ) {
	    const h = Math.acos(q / c3) / 3.0;
	    const s = Math.cos(h) + 2.0;
	    const t = Math.sin(h) * Math.sqrt(3.0);
	    const rx = Math.sqrt(m2 - (c * (s + t)));
	    const ry = Math.sqrt(m2 - (c * (s - t)));
	    co = ry + (Math.sign(l) * rx) + (Math.abs(g) / (rx * ry));
	    	    
	  } else {
	    const c2 = c ** 2;
			const h = 2.0 * m * n * Math.sqrt(d);
			const s = Math.pow(q + h, 1.0 / 3.0);
			const t = c2 / s;
			const rx = -(s + t) - (c * 4.0) + (2.0 * m2);
			const ry = (s - t) * Math.sqrt(3.0);
			const rm = Math.sqrt((rx ** 2) + (ry ** 2));
			co = (ry / Math.sqrt(rm - rx)) + (2.0 * g / rm);						
	  }
	  
	  co = (co - m) / 2.0;
	  const si = Math.sqrt(Math.max(1.0 - (co ** 2), 0.0));
	  
	  // Get the closest point in the absolute (positive) quadrant.
	  // Use abTmp here because axes may have been switched earlier.
	  using r = PIXI.Point.tmp.set(co,si);
	  r.multiply(abTmp, r);
	  const s = Math.sign(pAbs.y - r.y);
	  const len2 = r.subtract(pAbs, r).magnitudeSquared();
	  return len2 * s;	  
	}
	
	// (10 * 3) ** 2 = 900
	// 10^2 * 3^2 = 900

	/**
	 * Distance to a 2d PIXI ellipse.
	 * @param {PIXI.Point} p						The point to measure distance to			
	 * @param {PIXI.Ellipse} ellipse		Ellipse
	 * @returns {number}
	 */
	static sdPIXIEllipse(p, ellipse) { return Math.sqrt(this._sdSquaredPIXIEllipse(p, ellipse)); } 
	 
	static _sdSquaredPIXIEllipse(p, ellipse) {
	  using txMat = Matrix.translation(-ellipse.x, -ellipse.y);
	  using txPt = txMat.multiplyPoint2d(p);
	  using b = PIXI.Point.tmp.set(ellipse.width, ellipse.height);
	  return this._sdSquaredEllipse(txPt, b);
	}
	
	/**
	 * Distance to a 2d rectangle. (Exact.)
	 * @param {PIXI.Point} p			The point to measure distance to		
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
	 * Distance to a 2d axis-aligned bounding box. (Exact.)
	 * @param {PIXI.Point} p			The point to measure distance to		
	 * @param {AABB2d} aabb				Bounding box
	 * @returns {number}
	 */
	static sdAABB2d(p, aabb) {
	  using b = PIXI.Point.tmp;
	  aabb.max.subtract(aabb.min, b).multiplyScalar(0.5, b);
	  return this.sdRectangle(p, b);
	}
	
	/**
	 * Distance to a 2d PIXI rectangle.
	 * @param {PIXI.Point} p						The point to measure distance to			
	 * @param {PIXI.Rectangle} rect			Rectangle
	 * @returns {number}
	 */
	static sdPIXIRectangle(p, rect) {
	  const ctr = rect.center;
	  using txMat = Matrix.translation(-ctr.x, -ctr.y);
	  using txPt = txMat.multiplyPoint2d(p);
	  using b = PIXI.Point.tmp.set(rect.width * 0.5, rect.height * 0.5);
	  return this.sdRectangle(txPt, b);
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
   * @param {PIXI.Point[]} v					The polygon vertices
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
      const c0 = p.y >= v[i].y;
      const c1 = p.y < v[j].y;
      const c2 = (e.x * w.y) > (e.y * w.x);
      if ( (c0 && c1 && c2) || !(c0 || c1 || c2) ) s *= -1.0;
    }
    return s * Math.sqrt(d);
  }

  /**
	 * Distance to a point from a 2d PIXI Polygon.
	 * All polygons, but holes must be handled using subtraction.
   * @param {PIXI.Point} p						The point to measure distance to.			
   * @param {PIXI.Polygon} poly				The polygon
   * @returns {number}
   */
  static sdPIXIPolygon(p, poly) { 
    using v0 = PIXI.Point.tmp.set(poly.points.at(0), poly.points.at(1));
    using pv0 = p.subtract(v0);
    let d = pv0.dot2();
    let s = 1.0;
    using e = PIXI.Point.tmp;
    using w = PIXI.Point.tmp;
    using f = PIXI.Point.tmp;
    for ( const { a, b } of poly.iterateEdges() ) {
      a.subtract(b, e);
      p.subtract(b, w);
      const mult = Math.clamp(w.dot(e) / e.dot2(), 0.0, 1.0);
      w.subtract(e.multiplyScalar(mult, f), f);
      d = Math.min(d, f.dot2());
      const c0 = p.y >= b.y;
      const c1 = p.y < a.y;
      const c2 = (e.x * w.y) > (e.y * w.x);
      if ( (c0 && c1 && c2) || !(c0 || c1 || c2) ) s *= -1.0;
    }
    return s * Math.sqrt(d);
  }
  
  /**
	 * Distance to a point from an array of 2d PIXI Polygons.
	 * Must start with a non-hole polygon; holes then subtracted out.
   * @param {PIXI.Point} p						The point to measure distance to.			
   * @param {PIXI.Polygon[]} polys		The polygons
   * @returns {number}
   */
  static sdPIXIPolygonsWithHoles(p, polys) {
    const iter = polys[Symbol.iterator]();
    const poly = iter.next().value;
    let d = this.sdPIXIPolygon(p, poly);
    for ( const poly of iter ) {
      const op = poly.isPositive ? "union" : "subtraction";
      d = this[op](d, this.sdPIXIPolygon(p, poly));      
    } 
    return d;
  }
  
  /**
   * Return a distance function that measures distance from a group of 2d polygons.
   * @param {PIXI.Polygon} polys
   * @returns {SDF}
   */  
  static sdfPIXIPolygons(polys) {
    if ( polys.length === 1 ) return p => this.sdPIXIPolygon(p, polys[0]);
		if ( polys.some(poly => !poly.isPositive) ) return p => this.sdPIXIPolygonsWithHoles(p, polys);
		return p => this.union(...polys.map(poly => this.sdPIXIPolygon(p, poly)));
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
    using v3 = PIXI.Point.tmp.set(
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
	static _dSquaredNearestCornerBoxBrute(p, b) {
		let dMin = Number.POSITIVE_INFINITY;
		const corners = [
		   PIXI.Point.tmp.set(-1, -1),
		   PIXI.Point.tmp.set(-1, 1),
		   PIXI.Point.tmp.set(1, -1),
		   PIXI.Point.tmp.set(1, 1),
		];
		for ( const corner of corners) {
			corner.multiply(b);
			const d2 = PIXI.Point.distanceSquaredBetween(p, corner);
			dMin = Math.min(dMin, d2);
		}
		corners.forEach(c => c.release());
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
	 * @param {Plane} plane			  The plane
	 * @returns {number}
	 */ 
  static sdPlane(p, plane) { 
    // Alt: p.dot(plane.normal) + d (plane.constant)
    using p0 = p.subtract(plane.point);
    return p0.dot(plane.normal);
  }
  
  /**
   * 3d planar triangle. In canvas coordinates.
   * @param {Point3d} p					The point to measure distance to.
   * @param {Triangle3d} tri		Triangle
   * @param {Point3d} a					First corner
   * @param {Point3d} b					Second corner
   * @param {Point3d} c					Third corner
   * @returns {number}
   */
  static sdTriangle3d(p, tri) { 
    const res = this._sdSquaredTriangle3d(p, tri); 
    return Math.sqrt(Math.abs(res)) * Math.sign(res); 
  } 
   
  static _sdSquaredTriangle3d(p, tri) {
    const { a, b, c } = tri;
  
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
    
    // Check if point is outside the edges.
    // If sign of dot product is negative, it is outside that edge's region.
    const inside = 
      Math.sign(xba.dot(pa)) + 
      Math.sign(xcb.dot(pb)) +
      Math.sign(xac.dot(pc))
    === 3.0;
    if ( !inside ) {
      // Point projection is outside; find distance to nearest edge.
      using tmp = Point3d.tmp;
      const baScalar = Math.clamp(ba.dot(pa) / ba.dot2(), 0.0, 1.0);
      const cbScalar = Math.clamp(cb.dot(pb) / cb.dot2(), 0.0, 1.0);
      const acScalar = Math.clamp(ac.dot(pc) / ac.dot2(), 0.0, 1.0);
      
      const dotBA = ba.multiplyScalar(baScalar, tmp).subtract(pa, tmp).dot2();
      const dotCB = cb.multiplyScalar(cbScalar, tmp).subtract(pb, tmp).dot2();
      const dotAC = ac.multiplyScalar(acScalar, tmp).subtract(pc, tmp).dot2();
      return Math.min(dotBA, dotCB, dotAC);
    }
    
    // Point is inside the triangle boundaries; return squared distance to plane.
    return (nor.dot(pa) ** 2) / nor.dot2();
  }
  
  /**
   * Distance to 3d planar rectangle. 
   * @param {Point3d} p					The point to measure distance to
   * @param {Point3d} b					Width, height (in y), and vertical height
   * @returns {number}
   */
  static sdRectangle3d(p, b) { 
    const res = this._sdSquaredRectangle3d(p, b); 
    return Math.sqrt(Math.abs(res)) * Math.sign(res);   
  } 
   
  static _sdSquaredRectangle3d(p, b) {
    // If on the plane, simply the 2d distance.
    if ( p.z.almostEqual(0) ) return this.sdRectangle(p.to2d(), b.to2d()) ** 2;
  
    // If within the rectangle, simply the height differential.
    // Rectangle centered on origin.
    if ( p.x.between(b.x * -0.5, b.x * 0.5) && p.y.between(b.y * -0.5, b.y * 0.5) ) return p.z;
    
    // Otherwise, it is the 3d distance to the closest edge.
    // Depends on the quadrant the point is in.
    // Can determine by using Pythagorean theorem from the 2d distance.
    const dist2d = this.sdRectangle(p.to2d(), b.to2d());
    return (dist2d ** 2) + (p.z ** 2);
  }
  
  /**
   * 3d planar quad. In canvas coordinates.
   * @param {Point3d} p					The point to measure distance to
   * @param {Quad3d} quad				The quad
   * @returns {number}
   */
  static sdQuad3d(p, quad) { 
    const res = this._sdSquaredQuad3d(p, quad); 
    return Math.sqrt(Math.abs(res)) * Math.sign(res); 
  } 
   
  static _sdSquaredQuad3d(p, quad) {
    const { a, b, c, d } = quad;
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
    
    const inside = 
      Math.sign(xba.dot(pa)) + 
      Math.sign(xcb.dot(pb)) +
      Math.sign(xdc.dot(pc)) +
      Math.sign(xad.dot(pd))
    === 4;
    if ( !inside ) {
      using tmp = Point3d.tmp;
      const baScalar = Math.clamp(ba.dot(pa) / ba.dot2(), 0.0, 1.0);
      const cbScalar = Math.clamp(cb.dot(pb) / cb.dot2(), 0.0, 1.0);
      const dcScalar = Math.clamp(dc.dot(pc) / dc.dot2(), 0.0, 1.0);
      const adScalar = Math.clamp(ad.dot(pd) / ad.dot2(), 0.0, 1.0);
    
      const dotBA = ba.multiplyScalar(baScalar, tmp).subtract(pa, tmp).dot2();
      const dotCB = cb.multiplyScalar(cbScalar, tmp).subtract(pb, tmp).dot2();
      const dotDC = dc.multiplyScalar(dcScalar, tmp).subtract(pc, tmp).dot2();
      const dotAD = ad.multiplyScalar(adScalar, tmp).subtract(pd, tmp).dot2();
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
    const res = this._sdSquaredPolygon3d(p, poly3d); 
    return Math.sqrt(Math.abs(res)) * Math.sign(res); 
  } 
   
  static _sdSquaredPolygon3d(p, poly3d) {
    // Calculate planar distance: dot product of the vector from any vertex to P with the normal.
    // (P - v0) • n
    const plane = poly3d.plane;
    const normal = plane.normal;
    const origin = plane.point;   
    
    // Calculate signed distance to infinite plane.
    // dist = (P - PlaneOrigin) • PlaneNormal
    using tmp = Point3d.tmp;
    const distPlane = p.subtract(origin, tmp).dot(normal);
    
    // Project point onto the plane.
    using projectedP = p.subtract(normal.multiplyScalar(distPlane, tmp));
    
    // If inside the polygon boundary, distance to polygon is distance to plane.
    if ( poly3d._isIntersectionWithinPolygon(projectedP) ) return distPlane ** 2;
    
    // Otherwise, get the 2d distance by checking all edges of the polygon.
    let minDist2 = Number.POSITIVE_INFINITY;
    for ( const edge of poly3d.iterateEdges() ) {
      const { a, b } = edge;
      using v = b.subtract(a);
      using w = p.subtract(a);
      
      // Project w onto v to find t, clamped to [0, 1].
      const v2 = v.dot2();
      const t = v2 === 0 ? 0 : Math.max(0, Math.min(1, w.dot(v) / v2));
      
      // Determine the edge intersection using t.
      using proj = v.multiplyScalar(t);
      using closest = a.add(proj);
      
      // Calculate squared distance to point on edge.
      const d2 = Point3d.distanceSquaredBetween(p, closest);
      minDist2 = Math.min(minDist2, d2);
    }
    
    // Final distance is square root; do not reapply sign from plane distance.
    // (Can be 0 but cannot be negative for a flat planar object.)
    return minDist2;
  }
  
  static sdPolygon3dWithHoles(p, polys3d) {
    const iter = polys3d.polygons[Symbol.iterator];
    const poly3d = iter.next().value;
    let d = this.sdPolygon3d(p, poly3d);
    for ( const poly3d of iter ) {
      // Tiles are all along the x/y plane, so can easily extract them.
      const op = poly3d.isHole ? "subtraction" : "union";
      d = this[op](d, this.sdPolygon3d(p, poly3d));      
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
	static sdCube(p, b) {
	  using q = Point3d.tmp;
	  using zero = Point3d.tmp;
	  p.abs(q).subtract(b, q);
	  const c = Math.min(Math.max(q.x, q.y, q.z), 0.0);
	  const l = q.max(zero, q).magnitude();
	  return l + c;
	}
	
	  
  /**
   * Distance to 3d bounding box.
   * @param {Point3d} p				The point to measure distance to.
   * @param {AABB3d} aabb			The bounding box
   * @returns {number}
   */
  static sdAABB3d(p, aabb) {
    using b = Point3d.tmp;
    aabb.max.subtract(aabb.min, b).multiplyScalar(0.5, b);
    return this.sdBox(p, b);
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
  static drawHeatmap(primitive, aabb, { elevationZ, step = 2, epsilon = 1e-08, ...drawOpts } = {}) {
    drawOpts.radius ??= 2;
    drawOpts.alpha ??= 0.5;
    drawOpts.fillAlpha ??= drawOpts.alpha;
    
    using pt = Number.isNumeric(elevationZ) ? Point3d.tmp.set(0, 0, elevationZ) : PIXI.Point.tmp;  
    const maxD = PIXI.Point.distanceBetween(aabb.min, aabb.max) / 2;
    const heatmap = CONFIG.GeometryLib.lib.PixelCache.createHeatMap(0, maxD);
    for ( let x = aabb.min.x; x < aabb.max.x; x += step ) {
			for ( let y = aabb.min.y; y < aabb.max.y; y += step ) {
				pt.set(x, y)
				const dist = primitive(pt);
				drawOpts.color = dist.almostEqual(0, epsilon) ? Draw.COLORS.white : heatmap(Math.abs(dist));
				drawOpts.fill = drawOpts.color;
				Draw.point(pt, drawOpts);
			}
		}
	}
}

	
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

/* Testing
AABB2d = CONFIG.GeometryLib.lib.AABB2d
Draw = CONFIG.GeometryLib.lib.Draw
Point3d = CONFIG.GeometryLib.lib.threeD.Point3d
Matrix = CONFIG.GeometryLib.lib.Matrix
SDF = CONFIG.GeometryLib.lib.sdf.SDF
RegionSDF = CONFIG.GeometryLib.lib.sdf.RegionSDF
TileSDF = CONFIG.GeometryLib.lib.sdf.TileSDF
TokenSDF = CONFIG.GeometryLib.lib.sdf.TokenSDF
Polygon3d = CONFIG.GeometryLib.lib.threeD.Polygon3d
Triangle3d = CONFIG.GeometryLib.lib.threeD.Triangle3d
Circle3d = CONFIG.GeometryLib.lib.threeD.Circle3d

cir1 = new PIXI.Circle(50, 50, 100)
cir2 = new PIXI.Circle(120, 50, 80)
Draw.shape(cir1, { color: Draw.COLORS.blue })
Draw.shape(cir2, { color: Draw.COLORS.green })

txMat1 = Matrix.translation(-cir1.x, -cir1.y)
txPt = PIXI.Point.tmp
prim1 = p => {
  txMat1.multiplyPoint2d(p, txPt);
  return SDF.sdCircle(txPt, cir1.radius);
}
aabb1 = AABB2d.fromCircle(cir1)
aabb1.pad({ x: 20, y: 20 });

SDF.drawHeatmap2d(prim1, aabb1)
Draw.shape(cir1, { color: Draw.COLORS.black })	

txMat2 = Matrix.translation(-cir2.x, -cir2.y)
prim2 = p => {
  txMat2.multiplyPoint2d(p, txPt);
  return SDF.sdCircle(txPt, cir2.radius);
}
aabb2 = AABB2d.fromCircle(cir2)
aabb2.pad({ x: 20, y: 20 });
SDF.drawHeatmap2d(prim2, aabb2)
Draw.shape(cir2, { color: Draw.COLORS.black })


// combined
aabb = AABB2d.union([aabb1, aabb2])
prim = p => SDF.union(prim1(p), prim2(p))
SDF.drawHeatmap2d(prim, aabb)
Draw.shape(cir1, { color: Draw.COLORS.black })
Draw.shape(cir2, { color: Draw.COLORS.black })
*/
