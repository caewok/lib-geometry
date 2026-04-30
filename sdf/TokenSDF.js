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
import { SDF } from "./SDF.js";

export class TokenSDF extends SDF {

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

/* Testing
AABB2d = CONFIG.GeometryLib.lib.AABB2d
Draw = CONFIG.GeometryLib.lib.Draw
Point3d = CONFIG.GeometryLib.lib.threeD.Point3d
Matrix = CONFIG.GeometryLib.lib.Matrix
SDF = CONFIG.GeometryLib.lib.sdf.SDF
RegionSDF = CONFIG.GeometryLib.lib.sdf.RegionSDF
TileSDF = CONFIG.GeometryLib.lib.sdf.TileSDF
TokenSDF = CONFIG.GeometryLib.lib.sdf.TokenSDF

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
