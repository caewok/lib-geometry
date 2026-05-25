/* globals
canvas,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { Matrix } from "../Matrix.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { TokenGeometry } from "../placeable_geometry/TokenGeometry.js";
import { AABB2d } from "../AABB.js";
import { AABB3d } from "../3d/AABB3d.js";
import { SDFPlaceable } from "./SDF.js";

export class TokenSDF extends SDFPlaceable {

  get token() { return this.placeable; }

  get aabb2d() { return AABB2d.fromToken(this.token); }

  get aabb3d() { return AABB3d.fromToken(this.token); }

  // ---- NOTE: Token getters ----- //

  get geom() { return this.token[GEOMETRY_LIB_ID]?.[GEOMETRY_ID]; }

  get shapeType() {
    const TYPES = TokenGeometry.SHAPE_TYPES;
    const geom = this.geom;
    if ( geom ) return geom.shapeType;
    return canvas.grid.isHexagonal ? TYPES.HEXAGONAL : TYPES.CUBE;
  }

  /** @type {Point3d} */
  get center() {
    const { center, topZ, bottomZ } = this.token;
    const ctr = Point3d.fromObject(center);
    ctr.z = bottomZ + ((topZ - bottomZ) * 0.5);
    return ctr;
  }

  /** @type {Point3d} */
  get dims() {
    const token = this.token;
    const { topZ, bottomZ } = token;
    const { width, height } = token.document;
    const w = width * canvas.grid.size;
    const h = height * canvas.grid.size;
    const vHeight = topZ - bottomZ;
    return Point3d.tmp.set(w, h, vHeight);
  }


  // ---- NOTE: SDF 2d ----- //

  /**
   * Signed distance function for a given token
   */
  _sdf2d({ shapeType } = {}) {
    if ( this.token.isConstrainedTokenBorder ) return this._sdfConstrainedBorder();

    shapeType ??= this.shapeType;
    const TYPES = TokenGeometry.SHAPE_TYPES;
    switch ( shapeType ) {
      // For spherical and ellipsoid, use 2d versions.
      case TYPES.SPHERICAL: return this._sdfCircle();
      case TYPES.ELLIPSOID:
      case TYPES.ELLIPSE: return this._sdfEllipse();
      case TYPES.CUBE: return this._sdfRectangle();
      case TYPES.HEXAGONAL: return this._sdfHexagon();
      default: return this._sdfPolygon();
    }
  }

  _sdfConstrainedBorder() {
    const border = this.token.constrainedTokenBorder;
    const SHAPES = PIXI.SHAPES;
    switch ( border.type ) {
      case SHAPES.POLY: return this._sdfPolygon(border); // Could be constrained or a hex shape.

      // If not a polygon, then not constrained.
      case SHAPES.RECT: return this._sdfRectangle();
      case SHAPES.CIRC: return this._sdfCircle();
      case SHAPES.ELIP: return this._sdfEllipse();
      default: return this._sdfPolygon(border);
    }
  }

  _sdfCircle() {
    const txMat = this.translationMatrix2d;
    const txPt = PIXI.Point.tmp;
    using halfD = this.halfDims;
    const r = Math.max(halfD.x, halfD.y);
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      return this.constructor.sdCircle(txPt, r);
    }
  }

  _sdfEllipse() {
    const txMat = this.translationMatrix2d;
    const txPt = PIXI.Point.tmp;
    using halfD = this.halfDims;
    const ab = PIXI.Point.tmp.set(halfD.x, halfD.y);
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      return this.constructor.sdEllipse(txPt, ab);
    };
  }

  _sdfRectangle() {
    const txMat = this.translationMatrix2d;
    const txPt = PIXI.Point.tmp;
    using halfD = this.halfDims;
    const ab = PIXI.Point.tmp.set(halfD.x, halfD.y);
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      return this.constructor.sdRectangle(txPt, ab);
    };
  }

  _sdfHexagon() {
    const { width, height } = this.token.document;
    if ( (width === 1 || width == 0.5) && (height === 1 || height === 0.5) ) {
			const txMat = this.translationMatrix2d;
			const txPt = PIXI.Point.tmp;

			// In-radius (apothem) is the shorter of grid.sizeX and grid.sizeY.
			// Depends on whether the hexes are column- or row-based.
			// (Obviously only works correctly on a hex grid.)
			const apothem = Math.min(canvas.grid.sizeX, canvas.grid.sizeY) * 0.5 * width;
			return p => {
				txMat.multiplyPoint2d(p, txPt);
				return this.constructor.sdHexagon(txPt, apothem);
			};
    } else return this._sdfPolygon(); // Custom hex shapes.
  }

  _sdfPolygon(poly) {
    const geom = this.geom;
    let points;
    poly ??= this.token.tokenBorder.toPolygon();
    return p => this.constructor.fromSquaredDistance(this.constructor.sdPIXIPolygon(p, poly));
  }

  /**
   * 3d SDF for this token.
   * Simple version for testing.
   * @param {SHAPE_TYPES} shapeType			The shape that represents the token
   * @returns {number}
   */
  _sdf3dSimple(opts) {
    const primitive = this.sdf2d(opts);
    using dims = this.dims;
    const h = dims.z;
    return p => this.constructor.opExtrusion(p, p => primitive(p.to2d()), h * 0.5);
  }

  // ----- NOTE: SDF 3d ----- //

  /**
   * SDF for a 3d token.
   * Same as _sdf3d, but use different variations depending on shape type.
   * More efficient for shapes like spheres.
   * @param {SHAPE_TYPES} shapeType			The shape that represents the token
   * @returns {number}
   */
  _sdf3d(opts = {}) {
    if ( this.token.isConstrainedTokenBorder ) return this._sdfToken3d(opts);

    opts.shapeType ??= this.shapeType;
    const TYPES = TokenGeometry.SHAPE_TYPES;
    const txPt = Point3d.tmp;
    const txMat = this.translationMatrix3d;

    switch ( opts.shapeType ) {
      case TYPES.SPHERICAL: return this._sdfSphere();
      case TYPES.ELLIPSOID: return this._sdfEllipsoid();
      case TYPES.CUBE: return this._sdfCube();
      case TYPES.ELLIPSE: return this._sdfEllipse3d();
      case TYPES.HEXAGONAL: return this._sdfHexagon3d();
      default: return p => this._sdf3dSimple(opts)(p);
    }
  }

  _sdfSphere() {
    const txPt = Point3d.tmp;
    using dims = this.halfDims;
    const r = Math.max(dims.x, dims.y, dims.z);
    const txMat = this.translationMatrix3d;
    return p => {
      txMat.multiplyPoint3d(p, txPt);
      return this.constructor.sdSphere(txPt, r);
    }
  }

  _sdfEllipsoid() {
    const txPt = Point3d.tmp;
    const r = this.halfDims;
    const txMat = this.translationMatrix3d;
    return p => {
      txMat.multiplyPoint3d(p, txPt);
      return this.constructor.sdEllipsoid(txPt, r);
    }
  }

  _sdfCube() {
    const txPt = Point3d.tmp;
    const b = this.halfDims;
    const txMat = this.translationMatrix3d;
    return p => {
      txMat.multiplyPoint3d(p, txPt);
      return this.constructor.sdCube(txPt, b);
    }
  }

  _sdfCylinder() {
    const primitive = this._sdfCircle();
    using dims = this.dims;
    const h = dims.z;
    return p => this.constructor.opExtrusion(p, p => primitive(p.to2d()), h * 0.5);
  }

  _sdfCircle3d = this._sdfCylinder;

  _sdfEllipse3d() {
    return this._sdf3dSimple({ shapeType: TokenGeometry.SHAPE_TYPES.ELLIPSE });
  }

  _sdfHexagon3d() {
    return this._sdf3dSimple({ shapeType: TokenGeometry.SHAPE_TYPES.HEXAGONAL });
  }

  _sdfPolygon3d(poly) {
    const primitive = this._sdfPolygon(poly);
    using dims = this.dims;
    const h = dims.z;
    return p => this.constructor.opExtrusion(p, p => primitive(p.to2d()), h * 0.5);
  }
}

/* Testing
AABB2d = CONFIG.GeometryLib.lib.AABB2d
Draw = CONFIG.GeometryLib.lib.Draw
Point3d = CONFIG.GeometryLib.lib.threeD.Point3d
Matrix = CONFIG.GeometryLib.lib.Matrix
SDF = CONFIG.GeometryLib.lib.sdf.SDF
RegionSDF = CONFIG.GeometryLib.lib.sdf.RegionSDF
TileSDF = CONFIG.GeometryLib.lib.sdf.TileSDF
TokenSDF = CONFIG.GeometryLib.lib.sdf.TokenSDF

// Tokens

tSDF = new TokenSDF(_token)
tSDF.draw({ padding: 100 })
tSDF.draw({ padding: 100, use3d: true })
tSDF.draw({ padding: 100, elevationZ: _token.topZ })
tSDF.draw({ padding: 100, elevationZ: _token.topZ + 50 })

// Different shapes
padding = 100
aabb = tSDF.aabb2d;
aabb.min.x -= padding;
aabb.min.y -= padding;
aabb.max.x += padding;
aabb.max.y += padding;

// 2d SDF
primitive = tSDF._sdfCircle()
primitive = tSDF._sdfEllipse()
primitive = tSDF._sdfRectangle()
primitive = tSDF._sdfHexagon()
primitive = tSDF._sdfPolygon()
primitive = tSDF._sdfConstrainedBorder()

TokenSDF.drawHeatmap(primitive, aabb);

// 3d SDF
primitive = tSDF._sdfSphere()
primitive = tSDF._sdfEllipsoid()
primitive = tSDF._sdfCube()
primitive = tSDF._sdfEllipse3d()
primitive = tSDF._sdfCylinder()
primitive = tSDF._sdfCircle3d()
primitive = tSDF._sdfHexagon3d()
primitive = tSDF._sdfPolygon3d()


TokenSDF.drawHeatmap(primitive, aabb, { elevationZ: 0 });
TokenSDF.drawHeatmap(primitive, aabb, { elevationZ: _token.topZ  });
TokenSDF.drawHeatmap(primitive, aabb, { elevationZ: _token.topZ + 50 });


// Distance from token center at elevation.
p = tSDF.center
primitive(p)

p.z = tSDF.token.bottomZ
primitive(p)

p.z = tSDF.token.topZ
primitive(p)

p.z = tSDF.token.topZ * 2
primitive(p)

// All tokens
canvas.tokens.placeables.forEach(token => {
  tSDF = new TokenSDF(token)
  tSDF.draw({ padding: 100 })
})




*/
