/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { Matrix } from "../Matrix.js";
import { AABB2d } from "../AABB.js";
import { SDFPlaceable } from "./SDF.js";

export class TileSDF extends SDFPlaceable {

  // ----- NOTE: Config ----- //
  
  #alphaThreshold;
  
  /** 
   * Set alpha threshold to undefined to default to the tile threshold.
   * Set to 0 to ignore.
   */
  get alphaThreshold() { 
    return typeof this.#alphaThreshold === "undefined" 
      ? this.tile.document.texture.alphaThreshold 
        : this.#alphaThreshold; 
  }
    
  set alphaThreshold(value) { this.#alphaThreshold = value; }
  
  #useHoles = true;
  
  get useHoles() { return this.#useHoles; }
  
  set useHoles(value) { this.#useHoles = value; }
  
  // ----- NOTE: Getters ----- //

  /** @type {Tile} */
  get tile() { return this.placeable; }
  
  get aabb2d() { return AABB2d.fromTile(this.tile); }
  
  /** @type {number} */
  get rotation() { return this.tile.document.rotation; }

  /** @type {Point3d} */
  get center() { 
    const ctr = this.tile.center;
    const z = this.tile.elevationZ;
    return Point3d.tmp.set(ctr.x, ctr.y, z);  
  }
  
  get elevationZ() { return this.tile.elevationZ; }
  
  /** @type {PIXI.Point} */
  get dims() { return PIXI.Point.tmp.set(this.tile.width, this.tile.height); }
    
  /** @type {Matrix3x3} */
  get rotationMatrix() {
    // Move to origin, rotate, and move back.
    // Tiles rotate from their anchor point.
    const { x, y, rotation, width, height } = this.tile.document;
    const { anchorX, anchorY } = this.tile.document.texture;
    const shiftX = x + (anchorX * width);
    const shiftY = y + (anchorY * height);
    
    using translateM = Matrix.translation(-shiftX, -shiftY);
    using rotM = Matrix.rotationZ(Math.toRadians(rotation), false);
    using invTranslateM = Matrix.translation(shiftX, shiftY);
    const M = Matrix.tmpMatrix(3, 3);
    return translateM.multiply3x3(rotM, M).multiply3x3(invTranslateM, M)    
  }
  
  /** @type {<object>PIXI.Point} */
  get centralAxis() { 
    // Central axis defined by width along the rotation vector from center.
    // Note that tiles rotate around their x, y TL point, not around their center.
    // 45º: SE; 90º: S, ...
    
    // Center segment a|b along center of the tile in y direction.
    const { x, y, width, height } = this.tile.document;
    const a = PIXI.Point.tmp.set(x, y + (height * 0.5));
    const b = PIXI.Point.tmp.set(x + width, y + (height * 0.5));
        
    if ( this.rotation ) {			
			// Translate and rotate the central axis.
			using M = this.rotationMatrix;
			M.multiplyPoint2d(a, a);
			M.multiplyPoint2d(b, b);
    }
    return { a, b }
  }
  
  get isSingleShape() { 
    if ( !this.alphaThreshold ) return true;
    const cache = this.tile.evPixelCache;
    const polys2d = cache.getCanvasAlphaISOBands(this.alphaThreshold);
    return polys2d.length === 1;
  }
  
  /**
   * SDF for a 2d tile.
   * Defaults to the rotated tile.
	 * @param {PIXI.Point} p			The point to measure distance to. 	
	 * @param {Tile} tile
	 * @returns {number}
   */   
  sdf2d() {
    const { alphaThreshold, useHoles } = this;
    let sdfFn;
    if ( !alphaThreshold ) sdfFn = this.rotation ? "_sdfTileRotated" : "_sdfTileBasic";
    else if ( !useHoles ) sdfFn = "_sdfTileAlphaPolygonBounds";
    else sdfFn = "_sdfTileAlphaISOBands";
    return this[sdfFn]();    
  }
 
  /**
   * SDF for a 2d tile without rotation.
	 * @returns {function}
   */
  _sdfTileBasic() {
    const txMat = this.translationMatrix2d;
    const txPt = PIXI.Point.tmp;
    using halfD = this.halfDims;
    const ab = PIXI.Point.tmp.set(halfD.x, halfD.y);
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      return this.constructor.sdRectangle(txPt, ab);
    }
  }

  /**
   * SDF for a 2d tile with rotation.
	 * @returns {function}
   */  
  _sdfTileRotated() {
    const { a, b } = this.centralAxis;
    const height = this.tile.document.height;
    return p => this.constructor.sdOrientedRectangle(p, a, b, height);
  }
    
  /**
   * SDF for a 2d tile with a square alpha threshold
	 * @returns {function}
   */
  _sdfTileAlphaBox() {
    const cache = this.tile.evPixelCache;
    const alphaThreshold = this.alphaThreshold;     
    const quad2d = cache.getThresholdCanvasBoundingBox(alphaThreshold);
    if ( quad2d.type === PIXI.SHAPES.RECT ) return p => this.constructor.sdPIXIRectangle(p, quad2d);  
    else return p => this.constructor.sdPIXIPolygon(p, quad2d);
  }
  
  /**
   * SDF for a 2d tile with a polygon alpha threshold.
	 * @returns {function}
   */
  _sdfTileAlphaPolygonBounds() {
    const cache = this.tile.evPixelCache;
    const alphaThreshold = this.alphaThreshold; 
    const poly = cache.getThresholdCanvasBoundingPolygon(alphaThreshold);
    return p => this.constructor.sdPIXIPolygon(p, poly);  
  }
  
  /**
   * SDF for a 2d tile with a polygon alpha threshold, possibly with holes
	 * @returns {function}
   */
  _sdfTileAlphaISOBands() {
    const alphaThreshold = this.alphaThreshold;
    const cache = this.tile.evPixelCache;
    const polys2d = cache.getCanvasAlphaISOBands(alphaThreshold);
    if ( polys2d.length > 1 ) return p => this.constructor.sdPIXIPolygonsWithHoles(p, polys2d);
    else return p => this.constructor.sdPIXIPolygon(p, polys2d[0]);
  }
     
  /**
   * SDF for a 3d tile, treated as a 3d quad or 3d polygon.
	 * @returns {function}
   */
  sdf3d() { 
    const { alphaThreshold, useHoles } = this;
    let sdfFn;
    if ( !alphaThreshold ) sdfFn = this.rotation ? "_sdf3dTileRotated" : "_sdf3dTileBasic";
    else if ( !useHoles ) sdfFn = "_sdf3dTileAlphaPolygonBounds";
    else sdfFn = "_sdf3dTileAlphaISOBands";
    return this[sdfFn]();      
  }
  
  #makeXYPlanarSDF(sdf2d) {
    const elevationZ = this.elevationZ
    return p => this.constructor.opXYPlanar(p, sdf2d, elevationZ);
  }
  
  /**
   * SDF for a 3d tile without rotation.
	 * @returns {function}
   */
  _sdf3dTileBasic() { return this.#makeXYPlanarSDF(this._sdfTileBasic()); }
  
  /**
   * SDF for a 3d tile with rotation.
	 * @returns {function}
   */
  _sdf3dTileRotated() { return this.#makeXYPlanarSDF(this._sdfTileRotated()); }
  
  /**
   * SDF for a 3d tile with a square alpha threshold
	 * @returns {function}
   */
  _sdf3dTileAlphaBox() { return this.#makeXYPlanarSDF(this._sdfTileAlphaBox()); }
  
  /**
   * SDF for a 3d tile with a square alpha threshold
	 * @returns {function}
   */
  _sdf3dTileAlphaPolygonBounds() { return this.#makeXYPlanarSDF(this._sdfTileAlphaPolygonBounds()); }

  
  /**
   * SDF for a 3d tile with a polygon alpha threshold with holes
	 * @returns {function}
   */
  _sdf3dTileAlphaISOBands() { return this.#makeXYPlanarSDF(this._sdfTileAlphaISOBands()); }
   
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

tile = canvas.tiles.controlled[0]
tSDF = new TileSDF(tile)

tSDF.draw({ padding: 100 })
tSDF.draw({ padding: 100, use3d: true })
tSDF.draw({ padding: 100, elevationZ: tile.elevationZ })
tSDF.draw({ padding: 100, elevationZ: tile.elevationZ + 50 })


// Different shapes
padding = 100
aabb = tSDF.aabb2d;
aabb.min.x -= padding;
aabb.min.y -= padding;
aabb.max.x += padding;
aabb.max.y += padding;

// 2d SDF 
primitive = tSDF._sdfTileBasic()
primitive = tSDF._sdfTileRotated()
primitive = tSDF._sdfTileAlphaBox()
primitive = tSDF._sdfTileAlphaPolygonBounds()
primitive = tSDF._sdfTileAlphaISOBands()

TileSDF.drawHeatmap(primitive, aabb, { step: 10, radius: 10 });

geom = tile.GeometryLib.geometry
geom.alphaThresholdPolygons.top.draw2d({ color: Draw.COLORS.red })

cache = tile.evPixelCache
poly = cache.getThresholdCanvasBoundingPolygon(0.75);
rect = cache.getThresholdCanvasBoundingBox(0.75)


// 3d SDF
primitive = tSDF._sdf3dBasic()
primitive = tSDF._sdf3dRotated()
primitive = tSDF._sdf3dAlpha()
primitive = tSDF._sdf3dAlphaPolygons()



TileSDF.drawHeatmap(primitive, aabb, { step: 10, elevationZ: tile.elevationZ  });
TileSDF.drawHeatmap(primitive, aabb, { step: 10, elevationZ: tile.elevationZ + 50 });


// Distance from token center at elevation.
p = tSDF.center
primitive(p)

p.x = tSDF.tile.document.x - 50
primitive(p)

p.x = tSDF.tile.document.x
primitive(p)

p.x = tSDF.tile.document.x + 50
primitive(p)

p.x = tSDF.center.x
p.z = tSDF.tile.elevationZ + 50
primitive(p)

p.x = tSDF.center.x
p.z = tSDF.tile.elevationZ - 50
primitive(p)



*/