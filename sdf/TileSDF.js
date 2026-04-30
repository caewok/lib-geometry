/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { Matrix } from "../Matrix.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../const.js";
import { Polygon3d } from "../3d/Polygon3d.js";
import { AABB2d } from "../AABB.js";
import { SDF } from "./SDF.js";

export class TileSDF extends SDF {

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