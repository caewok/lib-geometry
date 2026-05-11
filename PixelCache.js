/* globals
canvas,
CONFIG,
foundry,
PIXI,
Ray,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "./const.js";
import { extractPixels } from "./extract-pixels.js";
import { roundFastPositive, bresenhamLine, bresenhamLineIterator, trimLineSegmentToPixelRectangle, clamp } from "./util.js";
import { Draw } from "./Draw.js";
import { MatrixFloat32, ModelMatrix2dCenterInverse } from "./Matrix.js";
import { AABB2d } from "./AABB.js";
import * as MarchingSquares from "./marchingsquares-esm.js";


/* Pixel Cache
  Rectangle in local pixel coordinates that contains an array of values ("pixels").
  PixelCache: 1:1 relationship between the local rectangle and the represented shape, except that
    the pixels may be some different resolution. And canvas object may be at any {x,y} position.

  TrimmedPixelCache: 1:1 relationship between the local rectangle and represented shape, except that
    the pixels stored do not include edge pixels with 0 value.

  TilePixelCache: Local rectangle tied to some canvas object (tile) shape. Translations performed
    to move to/from the canvas coordinates and the local.

  Methods to store and retrieve the border for a given alpha threshold.
  Methods to traverse the pixel cache.
*/

/**
 * Represent a local rectangular coordinate system that is linked to a canvas coordinate
 * system by translation, scaling, and rotation.
 * The underlying rectangle is in local coordinates, where 0, 0 is the top left.
 * The rectangle represents pixel positions and contains transforms and methods to
 * move from the local pixels to canvas pixels.
 */

export class LocalCoordinateCache extends AABB2d {

  /** @type {number} */
  #resolution = 1;

  /**
   * Create a local rectangle representing a larger canvas rectangle.
   * Translation, rotation, and scaling can be defined to relate the two.
   * @param {number} width     The width of the local rectangle
   * @param {number} height    The height of the local rectangle
   * @param {object} [opts]
   * @param {number} [opts.resolution=1] Resolution of the local rectangle relative to the canvas;
   *   If resolution < 1, the local rectangle is smaller than the canvas rectangle.
   */
  constructor(localWidth, localHeight, { resolution = 1 } = {}) {
    super();
    this.#resolution = resolution;
    this.min.x = 0;
    this.min.y = 0;
    this.max.x = localWidth - 1; // AABB is inclusive. [min, max]
    this.max.y = localHeight - 1;

    // Center the model before applying rotation and scale.
    this.modelMatrix.modelCenter = { x: localWidth * 0.5, y: localHeight * 0.5 };
    if ( resolution !== 1 ) this.scale = { x: 1, y: 1 }; // Updates when it scales.
    else this.modelMatrix.update(); // To apply the model center change.
  }

  // ----- NOTE: Getters / setters ----- //

  /** @type {number} */
  get resolution() { return this.#resolution; }

  get width() { return this.max.x + 1; } // Actually: max.x - 0 + 1; adjust b/c maxX is inclusive.

  get height() { return this.max.y + 1; } // Actually: max.y - 0 + 1; adjust b/c maxX is inclusive.

  get area() { return this.width * this.height; }

  get left() { return 0; }

  get right() { return this.max.x; }

  get top() { return 0; }

  get bottom() { return this.max.y; }


  // ----- NOTE: Static constructors ----- //

  /**
   * Get the local size for a given resolution.
   * @param {PIXI.Point} size
   * @param {number} [resolution = 1]
   * @param {PIXI.Point} outPoint
   * @returns {PIXI.Point}
   */
  static localSizeForResolution(size, resolution = 1, outPoint) {
    return size.multiplyScalar(resolution, outPoint).ceil(outPoint);
  }

  static canvasSizeForResolution(size, resolution = 1, outPoint) {
    return size.multiplyScalar(1/resolution, outPoint).ceil(outPoint);
  }

  /**
   * Build a local rectangle from a canvas rectangle.
   * @param {PIXI.Rectangle} rect
   * @param {number} [resolution=1]
   */
  static fromCanvasRectangle(rect, resolution = 1, opts = {} ) {
    using size = PIXI.Point.tmp.set(rect.width, rect.height);
    this.localSizeForResolution(size, resolution, size);
    opts.resolution = resolution;
    const out = new this(size.x, size.y, opts);
    out.translation = rect; // Translate to TL.
    return out;
  }

  /**
   * Build a local rectangle from any shape with a getBounds method
   * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse|PIXI.Polygon} shape
   * @param {number} [resolution=1]
   */
  static fromShape(shape, resolution, opts = {}) {
    return this.fromRectangle(shape.getBounds(), resolution, opts);
  }

  // ----- NOTE: Model Matrix ----- //

  /** @type {ModelMatrix2d} */
  modelMatrix = new ModelMatrix2dCenterInverse();

  /**
   * Offset the canvas object in relation to the 0,0 top left of the local rectangle.
   * @prop {number} [x=0]       Amount to move the canvas object along x axis in pixels
   * @prop {number} [y=0]       Amount to move the canvas object along y axis in pixels
   */
  set translation({ x = 0, y = 0 } = {}) {``
    MatrixFloat32.translation(x, y, undefined, this.modelMatrix.translation);
    this.modelMatrix.update(); // Run here so the toCanvasTransform/toLocalTransform can skip update test.
  }

  /**
   * Scale the canvas object in relation to size of the local rectangle.
   * @prop {number} [x=1]       Amount to scale the canvas object in the x direction
   * @prop {number} [y=1]       Amount to scale the canvas object in the y direction
   */
  set scale({x = 1, y = 1} = {}) {
    // Combine scale with resolution.
    // E.g.
    // resolution = 0.25. Local width is 1/4 the size of canvas width.
    const invRes = 1 / this.resolution;
    x *= invRes;
    y *= invRes;
    MatrixFloat32.scale(x, y, undefined, this.modelMatrix.scale);
    this.modelMatrix.update();
  }

  /**
   * Rotate the canvas object around the z axis.
   * @type {number} Angle in radians
   */
  set rotationZ(angle) {
    MatrixFloat32.rotationZ(angle, false, this.modelMatrix.rotation);
    this.modelMatrix.update();
  }

  // ----- NOTE: Modified PIXI methods ----- //

  clone(out) {
    out = super.clone(out);
    this.modelMatrix.clone(out.modelMatrix);
    out.updateTransforms();
    return out;
  }

  // ----- NOTE: Transforms ----- //

  /** @type {MatrixFloat32} */
  get toLocalTransform() { return this.modelMatrix._modelInverse; }

  /** @type {MatrixFloat32} */
  get toCanvasTransform() { return this.modelMatrix._model; }

  /**
   * Update the transforms.
   * Done manually to avoid repeated update checks.
   */
  updateTransforms() {
     if ( this.modelMatrix.updated ) this.modelMatrix.update();
  }

  // ----- NOTE: Bounding box ----- //

  _calculateCanvasBoundingBox() {
    const pts = Array(4);
    let i = 0;
    if ( this.modelMatrix.updated ) this.modelMatrix.update(); // Avoid checking update in the loop.
    for ( const pt of this.iterateVertices() ) {
      this.modelMatrix._model.multiplyPoint2d(pt, pt);
      pts[i] = pt;
    }
    const poly = new PIXI.Polygon(...pts);
    return poly.getBounds();
  }

  // ----- NOTE: Indexing ----- //

  /**
   * Pixel index for a specific texture location
   * @param {number} x      Local texture x coordinate
   * @param {number} y      Local texture y coordinate
   * @returns {number}
   */
  _indexAtLocal(x, y) {
    // Use floor to determine in which "pixel bucket" the coordinate lies.
    x = ~~x;
    y = ~~y;

    // Bounds check.
    const { width, height } = this;
    if ( x < 0 || y < 0 || x >= width || y >= height ) return -1;

    // Return the index.
    return (y * width) + x
  }

  /**
   * Calculate local coordinates given a pixel index.
   * Inverse of _indexAtLocal
   * @param {number} i              The index, corresponding to a pixel in the array.
   * @param {PIXI.Point} outPoint   Point to use to store the coordinate
   * @returns {PIXI.Point} The outPoint, for convenience
   */
  _localAtIndex(i, outPoint) {
    outPoint ??= PIXI.Point.tmp;
    const width = this.width;
    const col = i % width;
    const row = ~~(i / width); // Floor the row.
    return outPoint.set(col, row);
  }

  /**
   * Calculate the canvas coordinates for a specific pixel index
   * @param {number} i    The index, corresponding to a pixel in the array.
   * @param {PIXI.Point} outPoint   Point to use to store the coordinate
   * @returns {PIXI.Point} The outPoint, for convenience
   */
  _canvasAtIndex(i, outPoint) {
    outPoint ??= PIXI.Point.tmp;
    using local = this._localAtIndex(i, PIXI.Point.tmp);
    return this._toCanvasCoordinates(local.x, local.y, outPoint);
  }

  /**
   * Pixel index for a specific texture location
   * @param {number} x      Canvas x coordinate
   * @param {number} y      Canvas y coordinate
   * @returns {number}
   */
  _indexAtCanvas(x, y) {
    const local = this._fromCanvasCoordinates(x, y, PIXI.Point.tmp);
    return this._indexAtLocal(local.x, local.y);
  }

  /**
   * Transform canvas coordinates into the local pixel rectangle coordinates.
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y coordinate
   * @param {PIXI.Point} outPoint   Point to use to store the coordinate
   * @returns {PIXI.Point} The outPoint, for convenience
   */
  _fromCanvasCoordinates(x, y, outPoint) {
    outPoint ??= PIXI.Point.tmp;
    outPoint.set(x, y);
    return this.toLocalTransform.multiplyPoint2d(outPoint, outPoint);
  }

  /**
   * Transform local coordinates into canvas coordinates.
   * Inverse of _fromCanvasCoordinates
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @param {PIXI.Point} outPoint   Point to use to store the coordinate
   * @returns {PIXI.Point} The outPoint, for convenience
   */
  _toCanvasCoordinates(x, y, outPoint) {
    outPoint ??= PIXI.Point.tmp;
    outPoint.set(x, y);
    const canvas = this.toCanvasTransform.multiplyPoint2d(outPoint, outPoint);

    // Avoid common rounding errors, like 19.999999999998.
    canvas.x = fastFixed(canvas.x);
    canvas.y = fastFixed(canvas.y);
    return canvas;
  }

  // ----- NOTE: Neighbor indexing ----- //

  /**
   * For this rectangular frame of local pixels, step backward or forward in the x and y directions
   * from a current index. Presumes index is row-based, such that:
   * 0 1 2 3
   * 4 5 6 7...
   * @param {number} currIdx
   * @param {number} [xStep = 0]
   * @param {number} [yStep = 0]
   * @returns {number} The new index position
   */
  localPixelStep(currIdx, xStep = 0, yStep = 0) {
    // 1. Deconstruct current index to 2D coordinates
    const localPt = this._localAtIndex(currIdx);
    const nx = localPt.x + xStep;
    const ny = localPt.y + yStep;
    return (ny * this.width) + nx; // See _indexAtLocal
  }

  /**
   * Indices of the 8 neighbors to this local pixel index. Does not
   * @param {number} currIdx
   * @returns {number[]}
   */
  localNeighborIndices(currIdx, trimBorder = true) {
    const { width, height } = this;
    const arr = [];

    // 1. Deconstruct current index to 2D coordinates
    const localPt = this._localAtIndex(currIdx);

    for ( let xi = -1; xi < 2; xi += 1 ) {
      for ( let yi = -1; yi < 2; yi += 1 ) {
        if ( !(xi || yi) ) continue;

        const nx = localPt.x + xi;
        const ny = localPt.y + yi;
        if ( trimBorder && ( nx < 0 || nx >= width || ny < 0 || ny >= height ) ) continue;
        arr.push((ny * width) + nx); // See _indexAtLocal.
      }
    }
    return arr;
  }

  // ----- NOTE: Shape conversions to local coordinates

  /**
   * Convert a ray to local texture coordinates
   * @param {Ray}
   * @returns {Ray}
   */
  _rayToLocalCoordinates(ray) {
    return new Ray(
      this._fromCanvasCoordinates(ray.A.x, ray.A.y),
      this._fromCanvasCoordinates(ray.B.x, ray.B.y));
  }

  /**
   * Convert a circle to local texture coordinates
   * @param {PIXI.Circle}
   * @returns {PIXI.Circle}
   */
  _circleToLocalCoordinates(circle) {
    const origin = this._fromCanvasCoordinates(circle.x, circle.y);

    // For radius, use two points of equivalent distance to compare.
    using local = this._fromCanvasCoordinates(circle.radius, 0, PIXI.Point.tmp);
    using local0 = this._fromCanvasCoordinates(0, 0, PIXI.Point.tmp);
    const radius = local.x - local0.x;
    return new PIXI.Circle(origin.x, origin.y, radius);
  }

  /**
   * Convert an ellipse to local texture coordinates
   * @param {PIXI.Ellipse}
   * @returns {PIXI.Ellipse}
   */
  _ellipseToLocalCoordinates(ellipse) {
    const origin = this._fromCanvasCoordinates(ellipse.x, ellipse.y, PIXI.Point.tmp);

    // For halfWidth and halfHeight, use two points of equivalent distance to compare.
    using localDim = this._fromCanvasCoordinates(ellipse.halfWidth, 0, PIXI.Point.tmp);
    using local0 = this._fromCanvasCoordinates(0, 0, PIXI.Point.tmp);
    const halfWidth = localDim.x - local0.x;

    this._fromCanvasCoordinates(ellipse.halfHeight, 0, localDim);
    const halfHeight = localDim.x - local0.x;
    return new PIXI.Ellipse(origin.x, origin.y, halfWidth, halfHeight);
  }

  /**
   * Convert a rectangle to local texture coordinates
   * @param {PIXI.Rectangle} rect
   * @returns {PIXI.Rectangle}
   */
  _rectangleToLocalCoordinates(rect) {
    using TL = this._fromCanvasCoordinates(rect.left, rect.top, PIXI.Point.tmp);
    using BR = this._fromCanvasCoordinates(rect.right, rect.bottom, PIXI.Point.tmp);
    return new PIXI.Rectangle(TL.x, TL.y, BR.x - TL.x, BR.y - TL.y);
  }

  /**
   * Convert a polygon to local texture coordinates
   * @param {PIXI.Polygon}
   * @returns {PIXI.Polygon}
   */
  _polygonToLocalCoordinates(poly) {
    const points = poly.points;
    const ln = points.length;
    const newPoints = Array(ln);
    using local = PIXI.Point.tmp;
    for ( let i = 0; i < ln; i += 2 ) {
      const x = points[i];
      const y = points[i + 1];
      this._fromCanvasCoordinates(x, y, local);
      newPoints[i] = local.x;
      newPoints[i + 1] = local.y;
    }
    return new PIXI.Polygon(newPoints);
  }

  /**
   * Convert a shape to local coordinates.
   * @param {PIXI.Rectangle|PIXI.Polygon|PIXI.Circle|PIXI.Ellipse} shape
   * @returns {PIXI.Rectangle|PIXI.Polygon|PIXI.Circle|PIXI.Ellipse}
   */
  _shapeToLocalCoordinates(shape) {
    switch ( shape.constructor ) {
      case PIXI.Rectangle: return this._rectangleToLocalCoordinates(shape);
      case PIXI.Polygon: return this._polygonToLocalCoordinates(shape);
      case PIXI.Circle: return this._circleToLocalCoordinates(shape);
      case PIXI.Ellipse: return this._ellipseToLocalCoordinates(shape);
      default: throw new Error("applyFunctionToShape|Shape not recognized.");
    }
  }

  /**
   * Trim a line segment to only the portion that intersects this cache bounds.
   * @param {Point} a     Starting location, in canvas coordinates
   * @param {Point} b     Ending location, in canvas coordinates
   * @returns {Point[2]|null} Points, in local coordinates.
   */
  _trimCanvasRayToLocalBounds(a, b) {
    const aLocal = this._fromCanvasCoordinates(a.x, a.y);
    const bLocal = this._fromCanvasCoordinates(b.x, b.y);
    return this._trimLocalRayToLocalBounds(aLocal, bLocal);
  }

  /**
   * Trim a line segment to only the portion that intersects this cache bounds.
   * @param {Point} a     Starting location, in local coordinates
   * @param {Point} b     Ending location, in local coordinates
   * @returns {Point[2]|null}  Points, in local coordinates
   */
  _trimLocalRayToLocalBounds(a, b) {
    const bounds = this;
    return trimLineSegmentToPixelRectangle(bounds, a, b);
  }

  // ----- NOTE: Offset shapes ----- //

  /**
   * Construct a set of offsets from a shape center. An offset is an x,y combination
   * that says how far to move from a given pixel.
   * Used to walk a line and aggregate pixels that are covered by that shape.
   */
  static pixelOffsetGrid(shape, skip = 0) {
    if ( shape instanceof PIXI.Rectangle ) return this.rectanglePixelOffsetGrid(shape, skip);
    if ( shape instanceof PIXI.Polygon ) return this.polygonPixelOffsetGrid(shape, skip);
    if ( shape instanceof PIXI.Circle ) return this.shapePixelOffsetGrid(shape, skip);
    console.warn("PixelCache|pixelOffsetGrid|shape not recognized.", shape);
    return this.polygonPixelOffsetGrid(shape.toPolygon(), skip);
  }

  /**
   * For a rectangle, construct an array of pixel offsets from the center of the rectangle.
   * @param {PIXI.Rectangle} rect
   * @returns {number[]}
   */
  static rectanglePixelOffsetGrid(rect, skip = 0) {
    /* Example
    Draw = CONFIG.GeometryLib.Draw
    api = game.modules.get("elevatedvision").api
    PixelCache = api.PixelCache

    rect = new PIXI.Rectangle(100, 200, 275, 300)
    offsets = PixelCache.rectanglePixelOffsetGrid(rect, skip = 10)

    tmpPt = new PIXI.Point;
    center = rect.center;
    for ( let i = 0; i < offsets.length; i += 2 ) {
      tmpPt.copyFrom({ x: offsets[i], y: offsets[i + 1] });
      tmpPt.add(center.x, center.y, tmpPt);
      Draw.point(tmpPt, { radius: 1 })
      if ( !rect.contains(tmpPt.x, tmpPt.y) )
      log(`Rectangle does not contain {tmpPt.x},${tmpPt.y} (${offsets[i]},${offsets[i+1]})`)
    }
    Draw.shape(rect)

    */

    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    const incr = skip + 1;
    const w_1_2 = Math.floor(width * 0.5);
    const h_1_2 = Math.floor(height * 0.5);
    const xiMax = width - w_1_2;
    const yiMax = height - h_1_2;

    // Handle 0 row and 0 column. Add only if it would have been added by the increment or half increment.
    const addZeroX = ((xiMax - 1) % (Math.ceil(incr * 0.5))) === 0;
    const addZeroY = ((yiMax - 1) % (Math.ceil(incr * 0.5))) === 0;

    // Faster to pre-allocate the array, although the math is hard.
    const startSkip = -3; // -3 to skip outermost edge and next closest pixel. Avoids issues with borders.
    const xMod = Boolean((xiMax - 1) % incr);
    const yMod = Boolean((yiMax - 1) % incr);
    const numX = (xiMax < 2) ? 0 : Math.floor((xiMax + startSkip) / incr) + xMod;
    const numY = (yiMax < 2) ? 0 : Math.floor((yiMax + startSkip) / incr) + yMod;
    const total = (numX * numY * 4 * 2) + (addZeroX * 4 * numY) + (addZeroY * 4 * numX) + 2;
    const offsets = new Array(total);

    // To make skipping pixels work well, set up so it always captures edges and corners
    // and works its way in.
    // And always add the 0,0 point.
    offsets[0] = 0;
    offsets[1] = 0;
    offsets._centerPoint = rect.center; // Helpful when processing pixel values later.
    let j = 2;
    for ( let xi = xiMax + startSkip; xi > 0; xi -= incr ) {
      for ( let yi = yiMax + startSkip; yi > 0; yi -= incr ) {
        // BL quadrant
        offsets[j++] = xi;
        offsets[j++] = yi;

        // BR quadrant
        offsets[j++] = -xi;
        offsets[j++] = yi;

        // TL quadrant
        offsets[j++] = -xi;
        offsets[j++] = -yi;

        // TR quadrant
        offsets[j++] = xi;
        offsets[j++] = -yi;
      }
    }

    // Handle 0 row and 0 column. Add only if it would have been added by the increment or half increment.
    if ( addZeroX ) {
      for ( let yi = yiMax - 3; yi > 0; yi -= incr ) {
        offsets[j++] = 0;
        offsets[j++] = yi;
        offsets[j++] = 0;
        offsets[j++] = -yi;
      }
    }

    if ( addZeroY ) {
      for ( let xi = xiMax - 3; xi > 0; xi -= incr ) {
        offsets[j++] = xi;
        offsets[j++] = 0;
        offsets[j++] = -xi;
        offsets[j++] = 0;
      }
    }

    return offsets;
  }

  // For checking that offsets are not repeated:
  //   s = new Set();
  //   pts = []
  //   for ( let i = 0; i < offsets.length; i += 2 ) {
  //     pt = new PIXI.Point(offsets[i], offsets[i + 1]);
  //     pts.push(pt)
  //     s.add(pt.key)
  //   }

  /**
   * For a polygon, construct an array of pixel offsets from the bounds center.
   * Uses a faster multiple contains test specific to PIXI.Polygon.
   * @param {PIXI.Rectangle} poly
   * @param {number} skip
   * @returns {number[]}
   */
  static polygonPixelOffsetGrid(poly, skip = 0) {
    /* Example
    poly = new PIXI.Polygon({x: 100, y: 100}, {x: 200, y: 100}, {x: 150, y: 300});
    offsets = PixelCache.polygonPixelOffsetGrid(poly, skip = 10)
    tmpPt = new PIXI.Point;
    center = poly.getBounds().center;
    for ( let i = 0; i < offsets.length; i += 2 ) {
      tmpPt.copyFrom({ x: offsets[i], y: offsets[i + 1] });
      tmpPt.add(center.x, center.y, tmpPt);
      Draw.point(tmpPt, { radius: 1 })
      if ( !poly.contains(tmpPt.x, tmpPt.y) )
      log(`Poly does not contain {tmpPt.x},${tmpPt.y} (${offsets[i]},${offsets[i+1]})`)
    }
    Draw.shape(poly)
    */
    const bounds = poly.getBounds();
    const { x, y } = bounds.center;
    const offsets = this.rectanglePixelOffsetGrid(bounds, skip);
    const nOffsets = offsets.length;
    const testPoints = new Array(offsets.length);
    for ( let i = 0; i < nOffsets; i += 2 ) {
      testPoints[i] = x + offsets[i];
      testPoints[i + 1] = y + offsets[i + 1];
    }
    const isContained = this.polygonMultipleContains(poly, testPoints);
    const polyOffsets = []; // Unclear how many pixels until we test containment.
    polyOffsets._centerPoint = offsets._centerPoint;
    for ( let i = 0, j = 0; i < nOffsets; i += 2 ) {
      if ( isContained[j++] ) polyOffsets.push(offsets[i], offsets[i + 1]);
    }
    return polyOffsets;
  }

  /**
   * Run contains test on a polygon for multiple points.
   * @param {PIXI.Polygon} poly
   * @param {number[]} testPoints     Array of [x0, y0, x1, y1,...] coordinates
   * @returns {number[]} Array of 0 or 1 values
   */
  static polygonMultipleContains(poly, testPoints) {
    // Modification of PIXI.Polygon.prototype.contains
    const nPoints = testPoints.length;
    if ( nPoints < 2 ) return undefined;
    const res = new Uint8Array(nPoints * 0.5); // If we really need speed, could use bit packing
    const r = poly.points.length / 2;
    for ( let n = 0, o = r - 1; n < r; o = n++ ) {
      const a = poly.points[n * 2];
      const h = poly.points[(n * 2) + 1];
      const l = poly.points[o * 2];
      const c = poly.points[(o * 2) + 1];

      for ( let i = 0, j = 0; i < nPoints; i += 2, j += 1 ) {
        const x = testPoints[i];
        const y = testPoints[i + 1];
        ((h > y) != (c > y)) && (x < (((l - a) * ((y - h)) / (c - h)) + a)) && (res[j] = !res[j]);
      }
    }
    return res;
  }

  /**
   * For an arbitrary shape with contains and bounds methods,
   * construct a grid of pixels from the bounds center that are within the shape.
   * @param {object} shape      Shape to test
   * @param {number} [skip=0]   How many pixels to skip when constructing the grid
   * @returns {number[]}
   */
  static shapePixelOffsetGrid(shape, skip = 0) {
    const bounds = shape.getBounds();
    const { x, y } = bounds.center;
    const offsets = this.rectanglePixelOffsetGrid(bounds, skip);
    const nOffsets = offsets.length;
    const shapeOffsets = []; // Unclear how many pixels until we test containment.
    shapeOffsets._centerPoint = offsets._centerPoint;
    for ( let i = 0; i < nOffsets; i += 2 ) {
      const xOffset = offsets[i];
      const yOffset = offsets[i + 1];
      if ( shape.contains(x + xOffset, y + yOffset) ) shapeOffsets.push(xOffset, yOffset);
    }
    return shapeOffsets;
  }

  /**
   * Convert a canvas offset grid to a local one.
   * @param {number[]} canvasOffsets
   * @returns {number[]} localOffsets. May return canvasOffsets if no scaling required.
   */
  convertCanvasOffsetGridToLocal(canvasOffsets) {
    // Determine what one pixel move in the x direction equates to for a local move.
    const canvasOrigin = this._toCanvasCoordinates(0, 0);
    using xShift = this._fromCanvasCoordinates(canvasOrigin.x + 1, canvasOrigin.y);
    using yShift = this._fromCanvasCoordinates(canvasOrigin.x, canvasOrigin.y + 1);
    using xFixed = PIXI.Point.tmp.set(1, 0);
    using yFixed = PIXI.Point.tmp.set(0, 1);
    if ( xShift.equals(xFixed) && yShift.equals(yFixed) ) return canvasOffsets;

    const nOffsets = canvasOffsets.length;
    const localOffsets = Array(nOffsets);
    for ( let i = 0; i < nOffsets; i += 2 ) {
      const xOffset = canvasOffsets[i];
      const yOffset = canvasOffsets[i + 1];

      // A shift of 1 pixel in a canvas direction could shift both x and y locally, if rotated.
      localOffsets[i] = (xOffset * xShift.x) + (xOffset * yShift.x);
      localOffsets[i + 1] = (yOffset * xShift.y) + (yOffset * yShift.y);
    }
    return localOffsets;
  }

  // ----- NOTE: Static methods ----- //
  /**
   * Identifies all pixels (grid cells) intersected by a segment.
   * Uses Grid Traversal Algorithm, a.k.a. Digital Differential Analyzer.
   * This algorithm works by calculating exactly when the line crosses the vertical
   * and horizontal grid lines (the boundaries of the "pixels"),
   * identifying every single pixel the segment touches.
   * @param {PIXI.Point} a      Starting coordinate
   * @param {PIXI.Point} b      Ending coordinate
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderSegment(a, b) {
    const pixels = [];

    // 1. Convert start and end points to grid coordinates
    using current = PIXI.Point.tmp;
    using end = PIXI.Point.tmp;
    a.floor(current);
    b.floor(end);

    // 2. Determine step direction (+1 or -1)
    using step = PIXI.Point.tmp.set(
      (b.x > a.x) ? 1 : -1,
      (b.y > a.y) ? 1 : -1,
    );

    // 3. Calculate the distance (t) required to move 1 pixel unit
    // We avoid division by zero by using Infinity if delta is 0
    using delta = b.subtract(a);

    // How far along the ray we must move for the component to change 1 unit
    // pixelSize / |delta| gives us the scale factor per grid cell
    const tDelta = PIXI.Point.tmp.set(
      (delta.x !== 0) ? Math.abs(1 / delta.x) : Infinity,
      (delta.y !== 0) ? Math.abs(1 / delta.y) : Infinity,
    );

    // 4. Calculate the distance to the *first* grid boundary
    const tMax = PIXI.Point.tmp;

    // Distance from current position to right edge of the pixel
    if ( delta.x > 0 ) tMax.x = (current.x + 1 - a.x) / delta.x;

    // Distance from current position to left edge of the pixel
    else if ( delta.x < 0 ) tMax.x = (a.x - current.x) / -delta.x; // simplified
    else tMax.x = Infinity;

    if ( delta.y > 0 ) tMax.y = (current.y + 1 - a.y) / delta.y;
    else if ( delta.y < 0 ) tMax.y = (a.y - current.y) / -delta.y;
    else tMax.y = Infinity;

    // 5. Traverse the grid
    // We loop until we pass the end grid cell
    let iter = 0;
    while (true) {
      if ( iter++ > 100000 ) throw new Error("Iterations exceeded.");

      // Add current pixel
      pixels.push(current.clone());

      // If we reached the target grid cell, break
      if ( current.equals(end) ) break;

      // Move to the next grid cell based on which boundary is closer
      if (tMax.x < tMax.y) {
        tMax.x += tDelta.x;
        current.x += step.x;
      } else {
        tMax.y += tDelta.y;
        current.y += step.y;
      }
    }
    return pixels;
  }

  /**
   * Identifies all pixels (grid cells) intersected by a PIXI.Rectangle.
   * @param {PIXI.Rectangle} rect - The source rectangle (world space)
   * @param {number} [pixelSize=1] - The size of each grid cell
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderRectangle(rect) {
    const pixels = [];

    // 1. Calculate the starting grid index (Top-Left)
    // We use Math.floor to snap to the grid coordinate
    using start = PIXI.Point.tmp.set(rect.x, rect.y);
    start.floor(start);

    // 2. Calculate the ending grid index (Bottom-Right)
    // We subtract a tiny epsilon (0.0001) from the right/bottom edge.
    // Why? If a rectangle ends exactly at 20 (and pixelSize is 10), it occupies
    // pixels 0 and 1, but NOT 2. Without the epsilon, 20/10 = 2, which would
    // wrongly include the next pixel.
    const EPSILON = 0.0001;
    using end = PIXI.Point.tmp.set(
      rect.x + rect.width - EPSILON,
      rect.y + rect.height - EPSILON,
    );
    end.floor(end);

    // 3. Loop through the range
    for ( let y = start.y; y <= end.y; y += 1 ) {
      for ( let x = start.x; x <= end.x; x += 1 ) pixels.push(PIXI.Point.tmp.set(x, y));
    }
    return pixels;
  }

  /**
   * Identifies all pixels (grid cells) intersected by a PIXI.Circle.
   * Uses a Bounding Box scan with a Distance Check.
   * Examines every pixel within the square area that encloses the circle, and then calculate
   * if the center of that pixel (or its closest edge) falls within the circle's radius.
   * @param {PIXI.Circle} circle      The source circle (world space)
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderCircle(circle) {
    const pixels = [];

    // 1. Define the Bounding Box of the circle in grid coordinates
    const radiusSq = circle.radius * circle.radius;
    using center = PIXI.Point.fromObject(circle);
    using radius = PIXI.Point.tmp.set(circle.radius, circle.radius)
    using start = PIXI.Point.tmp;
    using end = PIXI.Point.tmp;

    // E.g,
    // Math.floor((circle.x - circle.radius) / pixelSize)
    // Math.floor((circle.x + circle.radius) / pixelSize)
    center.subtract(radius, start).floor(start);
    center.add(radius, end).floor(end);

    // 2. Iterate through the bounding box

    using closest = PIXI.Point.tmp;
    using next = PIXI.Point.tmp;
    using delta = PIXI.Point.tmp;
    for ( let y = start.y; y <= end.y; y += 1 ) {
      for ( let x = start.x; x <= end.x; x += 1 ) {
        // 3. Find the point within the pixel closest to the circle center
        // This ensures we catch pixels even if only a tiny corner is inside.
        closest.set(x, y);
        next.set(x+1, y+1).min(center, next);
        closest.max(next, closest);

        // const closestX = Math.max(x * pixelSize, Math.min(circle.x, (x + 1) * pixelSize));
        // const closestY = Math.max(y * pixelSize, Math.min(circle.y, (y + 1) * pixelSize));

        // 4. Calculate squared distance (faster than Math.sqrt)
        center.subtract(closest, delta);
        const distanceSq = delta.dot(delta);

        /*
        const dx = circle.x - closestX;
        const dy = circle.y - closestY;
        const distanceSq = (dx * dx) + (dy * dy);
        */

        if ( distanceSq <= radiusSq ) pixels.push(PIXI.Point.tmp.set(x, y));
      }
    }
    return pixels;
  }

  /**
   * Identifies all pixels (grid cells) intersected by a PIXI.Ellipse.
   * Uses a Bounding Box scan with a Distance Check.
   * Examines every pixel within the square area that encloses the ellipse, and then calculate
   * if the center of that pixel (or its closest edge) falls within the ellipse's radius.
   * @param {PIXI.Ellipse} ellipse      The source ellipse (world space)
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderEllipse(ellipse) {
    const pixels = [];

    // 1. Define the Bounding Box in grid coordinates.
    using center = PIXI.Point.fromObject(ellipse);
    using start = PIXI.Point.tmp;
    using end = PIXI.Point.tmp;
    using radius = PIXI.Point.tmp.set(ellipse.width, ellipse.height); // In PIXI, width and height are radii (semi-axes)

    // E.g., Math.floor((ellipse.x - a) / pixelSize);
    center.subtract(radius, start).floor(start);
    center.add(radius, end).floor(end);

    // Pre-calculate squares to save operations in the loop
    radius.multiply(radius, radius);

    // 2. Iterate through the bounding box
    using closest = PIXI.Point.tmp;
    using next = PIXI.Point.tmp;
    using delta = PIXI.Point.tmp;
    for ( let y = start.y; y <= end.y; y += 1 ) {
      for ( let x = start.x; x <= end.x; x += 1 ) {
        // 3. Find the point within the pixel closest to the ellipse center
        closest.set(x, y);
        next.set(x+1, y+1).min(center, next);
        closest.max(next, closest);

        // const closestX = Math.max(x * pixelSize, Math.min(ellipse.x, (x + 1) * pixelSize));
        // const closestY = Math.max(y * pixelSize, Math.min(ellipse.y, (y + 1) * pixelSize));

        // 4. Apply the Ellipse Equation
        // If the result is <= 1, the point is inside or on the boundary
        center.subtract(closest, delta);
        delta.multiply(delta, delta);
        delta.divide(radius, delta);

        if ( (delta.x + delta.y) <= 1 ) pixels.push(PIXI.Point.tmp.set(x, y));
        // const dx = closestX - ellipse.x;
        // const dy = closestY - ellipse.y;
        // if ( (dx * dx) / radius2.x + (dy * dy) / radius2.y <= 1 ) pixels.push(PIXI.Point.tmp.set(x, y));

      }
    }
    return pixels;
  }

  /**
   * Identifies all pixels (grid cells) intersected by a PIXI.Polygon.
   * Uses Scanline Fill Algorithm. This is more complex than a circle or rectangle because
   * polygons can be irregular, concave, or have many vertices.  Checks each horizontal "row" (scanline)
   * of pixels that the polygon covers and find where the polygon's edges intersect that row.
   * @param {PIXI.Polygon} polygon      The source polygon (world space)
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderPolygon(polygon) {
    const pixels = [];

    // 1. Convert flat array to objects and find the bounding box
    // Find the vertical range (minY to maxY) so we don't scan the entire world.
    using aabb = AABB2d.fromPolygon(polygon);

    // 2. Convert Y bounds to grid indices
    const startY = Math.floor(aabb.min.y);
    const endY = Math.floor(aabb.max.y);

    // 3. Process each horizontal scanline
    for ( let gridY = startY; gridY <= endY; gridY += 1 ) {
      // Find the center Y of the current pixel row for intersection testing
      const y = (gridY + 0.5);

      // 4. Find where the scanline intersects each edge of the polygon
      // For every row of pixels, draw an imaginary horizontal line.
      // Calculate where this line hits the "walls" (edges) of the polygon
      const intersections = [];
      for ( const edge of polygon.iterateEdges({ close: true }) ) {
        const p1 = edge.a;
        const p2 = edge.b;

        // Check if the edge crosses the current Y level
        if ( (p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y) ) {
          // Calculate the X coordinate of the intersection
          const intersectX = p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);
          intersections.push(intersectX);
        }
      }

      // 5. Sort intersections from left to right
      intersections.sort((a, b) => a - b);

      // 6. Fill the pixels between pairs of intersections (even-odd rule)
      // The Even-Odd Rule: In geometry, if you start outside a shape and cross an edge,
      // you are now inside. Cross another, and you are outside.
      // This is why we sort the intersections and process them in pairs (i += 2).
      for ( let i = 0, iMax = intersections.length; i < iMax; i += 2 ) {
        const startX = Math.floor(intersections[i]);
        const endX = Math.floor(intersections[i + 1]);
        for ( let gridX = startX; gridX <= endX; gridX += 1 ) pixels.push(PIXI.Point.tmp.set(gridX, gridY));
      }
    }
    return pixels;
  }


  /**
   * Identifies all pixels (grid cells) intersected by a PIXI shape.
   * @param {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} shape      The source shape (world space)
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderShape(shape) {
    switch ( shape.constructor ) {
      case PIXI.Rectangle: return this.pixelsUnderRectangle(shape);
      case PIXI.Polygon: return this.pixelsUnderPolygon(shape);
      case PIXI.Circle: return this.pixelsUnderCircle(shape);
      case PIXI.Ellipse: return this.pixelsUnderEllipse(shape);
      default: throw new Error(`this.name|Shape ${shape.constructor.name} not recognized`, shape);
    }
  }

  /**
   * Consider the nearest neighbor when upscaling or downscaling a texture pixel array.
   * Average together.
   * See https://towardsdatascience.com/image-processing-image-scaling-algorithms-ae29aaa6b36c.
   * @param {number[]} pixels   The original texture pixels
   * @param {number} width      Width of the original texture
   * @param {number} height     Height of the original texture
   * @param {number} resolution Amount to grow or shrink the pixel array size.
   * @param {object} [options]  Parameters that affect which pixels are used.
   * @param {number} [options.channel=0]    Which RGBA channel (0–3) should be pulled?
   * @param {number} [options.skip=4]       How many channels to skip.
   * @param {TypedArray}   [options.arrayClass=Uint8Array]  What array class to use to store the resulting pixel values
   * @returns {number[]}
   */
  static nearestNeighborScaling(pixels, width, height, resolution, { channel, skip, arrayClass, arr } = {}) {
    channel ??= 0;
    skip ??= 4;
    arrayClass ??= Uint8Array;

    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;

    if ( arr && arr.length !== N ) {
      console.error(`PixelCache.nearestNeighborScaling|Array provided must be length ${N}`);
      arr = undefined;
    }
    arr ??= new arrayClass(N);

    for ( let col = 0; col < localWidth; col += 1 ) {
      for ( let row = 0; row < localHeight; row += 1 ) {
        // Locate the corresponding pixel in the original texture.
        const x_nearest = roundFastPositive(col * invResolution);
        const y_nearest = roundFastPositive(row * invResolution);
        const j = ((y_nearest * width * skip) + (x_nearest * skip)) + channel;

        // Fill in the corresponding local value.
        const i = ((~~row) * localWidth) + (~~col);
        arr[i] = pixels[j];
      }
    }
    return arr;
  }

  /**
   * Consider every pixel in the downscaled image as a box in the original.
   * Average together.
   * See https://towardsdatascience.com/image-processing-image-scaling-algorithms-ae29aaa6b36c.
   * @param {number[]} pixels   The original texture pixels
   * @param {number} width      Width of the original texture
   * @param {number} height     Height of the original texture
   * @param {number} resolution Amount to shrink the pixel array size. Must be less than 1.
   * @param {object} [options]  Parameters that affect which pixels are used.
   * @param {number} [options.channel=0]    Which RGBA channel (0–3) should be pulled?
   * @param {number} [options.skip=4]       How many channels to skip.
   * @param {TypedArray}   [options.arrayClass=Uint8Array]  What array class to use to store the resulting pixel values
   * @returns {number[]}
   */
  static boxDownscaling(pixels, width, height, resolution, { channel, skip, arrayClass, arr } = {}) {
    channel ??= 0;
    skip ??= 4;
    arrayClass ??= Uint8Array;

    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;
    if ( arr && arr.length !== N ) {
      console.error(`PixelCache.nearestNeighborScaling|Array provided must be length ${N}`);
      arr = undefined;
    }
    arr ??= new arrayClass(N);

    const boxWidth = Math.ceil(invResolution);
    const boxHeight = Math.ceil(invResolution);

    for ( let col = 0; col < localWidth; col += 1 ) {
      for ( let row = 0; row < localHeight; row += 1 ) {
        // Locate the corresponding pixel in the original texture.
        const x_ = ~~(col * invResolution);
        const y_ = ~~(row * invResolution);

        // Ensure the coordinates are not out-of-bounds.
        const x_end = Math.min(x_ + boxWidth, width - 1) + 1;
        const y_end = Math.min(y_ + boxHeight, height - 1) + 1;

        // Average colors in the box.
        const values = [];
        for ( let x = x_; x < x_end; x += 1 ) {
          for ( let y = y_; y < y_end; y += 1 ) {
            const j = ((y * width * skip) + (x * skip)) + channel;
            values.push(pixels[j]);
          }
        }

        // Fill in the corresponding local value.
        const i = ((~~row) * localWidth) + (~~col);
        const avgPixel = values.reduce((a, b) => a + b, 0) / values.length;
        arr[i] = roundFastPositive(avgPixel);
      }
    }
    return arr;
  }
}


/**
 * Represent a rectangular array of local pixels.
 * The underlying rectangle is in local coordinates.
 */
export class PixelCache extends LocalCoordinateCache {
  /** @type {TypedArray} */
  pixels;

  /** @type {number} */
  maximumPixelValue = 255;

  /** @type {Map<number,AABB>} */
  #thresholdLocalAABB = new Map();

  /** @type {Map<number,PIXI.Rectangle>} */
  #thresholdCanvasBoundingBoxes = new Map();

  /** @type {Map<number,PIXI.Rectangle|PIXI.Polygon>} */
  #thresholdLocalBoundingPolygons = new Map();

  /** @type {Map<number,PIXI.Rectangle|PIXI.Polygon>} */
  #thresholdCanvasBoundingPolygons = new Map();
  
  /** @type {Map<number,ClipperPaths>} */
  #localAlphaISOBands = new Map();
  
  /** @type {Map<number,ClipperPaths>} */
  #canvasAlphaISOBands = new Map();

  /**
   * Construct the local rectangle based on a provided pixel array.
   * @param {object} [opts]
   * @param {class} [opts.pixelsOrClass]        Pixel array or class of the pixel array, which will be created
   *                                            sized to the area of the local rectangle
   * @param {number} [opts.maximumPixelValue]   Largest pixel value for the given class
   * @param {PixelCacheScale} [opts.scale] Values to relate the canvas shape
   */
  constructor(localWidth, localHeight, { pixelsOrClass = Uint8Array, maximumPixelValue, ...opts } = {}) {
    super(localWidth, localHeight, opts);
    this.pixels = ( typeof pixelsOrClass === "function" ) ? new pixelsOrClass(this.area) : pixelsOrClass;
    this.maximumPixelValue = maximumPixelValue ?? this.constructor.maximumPixelValue(this.pixels);
  }

  clone(out) {
    out = super.clone(out);
    out.pixels.set(this.pixels);
    out.maximumPixelValue = this.maximumPixelValue;
    return out;
  }

  // ----- NOTE: Static constructor methods ----- //

  /**
   * @param {TypedArray|number[]} pixels        Array of pixel values, which are stored in place, not copied
   * @param {number} pixelWidth                 The width of the local rectangle
   * @param {object} [opts]
   * @param {class} [opts|opts.pixelClass]   Class of the pixel array to create
   * @param {number} [opts.resolution]          Resolution of the local rectangle
   * @param {PIXI.Point} [opts.translate]       How much to move the canvas shape from local
   */
  static fromPixelArray(pixels, pixelWidth, opts = {}) {
    // Determine the pixel dimensions.
    const nPixels = pixels.length;
    pixelWidth = roundFastPositive(pixelWidth);
    const pixelHeight = Math.ceil(nPixels / pixelWidth);

    // Determine the canvas dimensions.
    opts.pixelsOrClass = pixels;
    return new this(pixelWidth, pixelHeight, opts);
  }

  // ----- NOTE: Transforms ----- //

  /**
   * Reset transforms. Typically used when size or resolution has changed.
   */
  updateTransforms() {
    super.updateTransforms();
    this._clearCanvasThresholdBoundingBoxes();
  }

  /**
   * Clear the threshold bounding boxes. Should be rare, if ever, b/c these are local rects
   * based on supposedly unchanging pixels.
   */
  _clearLocalThresholdBoundingBoxes() {
    this.#thresholdCanvasBoundingBoxes.clear();
    this.#thresholdLocalAABB.clear();
    this.#thresholdLocalBoundingPolygons.clear();
    this.#localAlphaISOBands.clear();
  }

  _clearCanvasThresholdBoundingBoxes() {
    this.#thresholdCanvasBoundingBoxes.clear();
    this.#thresholdCanvasBoundingPolygons.clear();
    this.#thresholdLocalAABB.clear();
    this.#canvasAlphaISOBands.clear();
  }


  // ----- NOTE: Bounding boxes ----- //

  /**
   * Get a local bounding box based on a specific threshold
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {AABB2d} Rectangle based on local coordinates.
   */
  getThresholdLocalAABB(alphaThreshold = 0.75) {
    const map = this.#thresholdLocalAABB;
    if ( !map.has(alphaThreshold) ) map.set(alphaThreshold, this.#calculateLocalAABB(alphaThreshold));
    return map.get(alphaThreshold);
  }

  getThresholdLocalBoundingBox(alphaThreshold = 0.75) {
    const aabb = this.getThresholdLocalAABB(alphaThreshold);
    if ( !isFinite(aabb.min.x) ) return new PIXI.Rectangle();

    return new PIXI.Rectangle(
      aabb.min.x,
      aabb.min.y,
      aabb.max.x - aabb.min.x + 1, // Pad b/c rectangle right/bottom not inclusive.
      aabb.max.y - aabb.min.y + 1,
    );
  }

  /**
   * Get a canvas bounding polygon or box based on a specific threshold.
   * If you require a rectangle, use getThresholdLocalBoundingBox
   * @returns {PIXI.Rectangle|PIXI.Polygon}    Rectangle or polygon in canvas coordinates.
   */
  getThresholdCanvasBoundingBox(alphaThreshold = 0.75) {
    const map = this.#thresholdCanvasBoundingBoxes;
    if ( !map.has(alphaThreshold) ) map.set(alphaThreshold, this.#calculateCanvasBoundingBox(alphaThreshold));
    return map.get(alphaThreshold);
  }

  _calculateCanvasBoundingBox(alphaThreshold = 0.75) {
    if ( alphaThreshold === 1 ) return super._calculateCanvasBoundingBox();
    return this.#calculateCanvasBoundingBox(alphaThreshold);
  }

  /**
   * Calculate a canvas bounding box based on a specific threshold.
   */
  #calculateCanvasBoundingBox(alphaThreshold=0.75) {
    // Pad right and bottom to ensure full coverage for PIXI rectangle or polygon.
    const aabb = this.getThresholdLocalAABB(alphaThreshold);
    const TL = this._toCanvasCoordinates(aabb.min.x, aabb.min.y);
    const TR = this._toCanvasCoordinates(aabb.max.x + 1, aabb.min.y);
    const BL = this._toCanvasCoordinates(aabb.min.x, aabb.max.y + 1);
    const BR = this._toCanvasCoordinates(aabb.max.x + 1, aabb.max.y + 1);

    // Can the box be represented with a rectangle? Points must be horizontal and vertical.
    // Could also be rotated 90º
    if ( (TL.x.almostEqual(BL.x) && TL.y.almostEqual(TR.y))
      || (TL.x.almostEqual(TR.x) && TL.y.almostEqual(BL.y)) ) {
      const xMinMax = Math.minMax(TL.x, TR.x, BL.x, BR.x);
      const yMinMax = Math.minMax(TL.y, TR.y, BL.y, BR.y);
      return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
    }

    // Alternatively, represent as polygon, which allows for a tighter contains test.
    return new PIXI.Polygon(TL, TR, BR, BL);
  }


  /**
   * Calculate a bounding box based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {AABB2d} Rectangle based on local coordinates.
   */
  #calculateLocalAABB(alphaThreshold=0.75) {
    // (Faster or equal to the old method that used one double non-breaking loop.)
    const threshold = alphaThreshold * this.maximumPixelValue;

    // By definition, the local frame uses 0 or positive integers. So we can use -1 as a placeholder value.
    const { left, right, top, bottom } = this;
    let minLeft = -1;
    let maxRight = -1;
    let minTop = -1;
    let maxBottom = -1;
    const aabb = new AABB2d();

    // Test left side
    for ( let x = left; x <= right; x += 1 ) {
      for ( let y = top; y <= bottom; y += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          minLeft = x;
          break;
        }
      }
      if ( ~minLeft ) break;
    }

    if ( !~minLeft ) return aabb; // Empty, defined as max: -∞, min: ∞

    // Test right side
    for ( let x = right; x >= left; x -= 1 ) {
      for ( let y = top; y <= bottom; y += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          maxRight = x;
          break;
        }
      }
      if ( ~maxRight ) break;
    }

    // Test top side
    for ( let y = top; y <= bottom; y += 1 ) {
      for ( let x = left; x <= right; x += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          minTop = y;
          break;
        }
      }
      if ( ~minTop ) break;
    }

    // Test bottom side
    for ( let y = bottom; y >= top; y -= 1 ) {
      for ( let x = left; x <= right; x += 1 ) {
        const a = this._pixelAtLocal(x, y);
        if ( a > threshold ) {
          maxBottom = y;
          break;
        }
      }
      if ( ~maxBottom ) break;
    }

    // No right/bottom padding needed b/c AABB is closed [min, max].
    aabb.min.x = minLeft;
    aabb.max.x = maxRight;
    aabb.min.y = minTop;
    aabb.max.y = maxBottom;
    return aabb;
  }

  /**
   * Calculate a bounding polygon based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Polygon} Polygon based on local coordinates.
   */
  #calculateLocalBoundingPolygon(alphaThreshold = 0.75) {
    // Use Moore Neighborhood with Jacob's stopping criteria.
    // https://www.imageprocessingplace.com/downloads_V3/root_downloads/tutorials/contour_tracing_Abeer_George_Ghuneim/moore.html
    const alphaAABB = this.getThresholdLocalAABB(alphaThreshold);
    const threshold = alphaThreshold * this.maximumPixelValue;

    // Start with the bounding box.
    const { min, max } = alphaAABB;
    const poly = new PIXI.Polygon();
        
    // Scan left and then down until we hit a solid pixel.
    using startPixel = PIXI.Point.tmp;
    let found = false;
    outerLoop: for ( let y = min.y; y < max.y; y += 1 ) {
      for ( let x = min.x; x < max.x; x += 1 ) {
        if ( this._pixelAtLocal(x, y) >= threshold ) {
          startPixel.set(x, y);
          found = true;
          break outerLoop;
        }
      }
    }
    if ( !found ) return poly;
    
    // Set initial pixel and starting entry.
    // Assume for TL start that we entered from the left.
    using startEntry = PIXI.Point.tmp.set(-1, 0);
    using currPixel = startPixel.clone();
    using currEntry = startEntry.clone();
    using testPixel = PIXI.Point.tmp;
    using currDir = startEntry.clone();
    using lastDir = startEntry.clone();
    
    // To facilitate a fast addPoint that can assume a 3-point poly, add a temporary polygon point.
    poly.points.push(startPixel.x, startPixel.y, startPixel.x, startPixel.y);
    
    // Loop until we get back to the beginning pixel.
    // Jacob's stopping: start pixel from the same entry point.   
    const MAX_ITERS = this.width * this.height;
    let iter = 0; 
    do {
      iter += 1;
      // Test each neighboring pixel around the current, moving clockwise.
      // iterateClockwiseNeighborDirections scans starting from the pixel after currEntry.
      const iterFn = this.iterateClockwiseNeighborDirections(currEntry);
      
      let foundNext = false;      
      for ( const dir of iterFn ) {
        currPixel.add(dir, testPixel);
        const a = this._pixelAtLocal(testPixel.x, testPixel.y);
        
        if ( a >= threshold ) {
          // Found the next contour pixel.
          addPoint(poly, testPixel);
          
          // Move to the new pixel.
          currPixel.copyFrom(testPixel);
          
          // Backtrack
          currEntry.copyFrom(dir).multiplyScalar(-1, currEntry);
          currDir.copyFrom(dir);
          
          foundNext = true;
          break;
        }
        lastDir.copyFrom(dir);
      }
      
      if ( !foundNext ) break; // Isolated pixel.
      iter += 1;
      
      // Stopping criteria (Jacob's):
      // Stop if back at start AND entered from the same direction.  
      
          
    }  while ( !(currPixel.equals(startPixel) && lastDir.subtract(currDir, testPixel).equals(startEntry)) && iter < MAX_ITERS );
    // while ( !currPixel.equals(startPixel) && iter < MAX_ITERS );
    //
    // while ( !(currPixel.equals(startPixel) && currEntry.equals(startEntry)) && iter < MAX_ITERS );
    
    if ( iter >= MAX_ITERS ) console.error("calculateLocalBoundingPolygon hit max iterations.");
    
    // Check if the start point is still duplicated and clean.
    const polyIter = poly.iteratePoints();
    using a = polyIter.next().value;
    using b = polyIter.next().value;
    if ( a.equals(b) ) {
      poly.points.unshift();
      poly.points.unshift();
    }
    
    return poly;
  }

/*
164,128
165,128



*/
/*
iter = poly.iteratePoints()
pts = [];
for ( let i = 0; i < 1000; i += 1 ) {
  const pt = iter.next().value
  pts.push(pt)
  Draw.point(pt, { radius: 1 })
}
console.table(pts)
*/

  /**
   * Convert pixels to an array of polygon isobands representing
   * alpha values at or above the threshold. E.g., alpha between 0.75 and 1.
   * @returns {ClipperPaths} The polygon paths or, if error, the local alpha bounding box.
   *   Coordinates returned are local to the tile pixels, between 0 and width/height of the tile pixels.
   */
 
  /**
   * Get solid polygon areas of this cache based on a specific threshold of transparency vs solid.
   * @returns {PIXI.Polygon[]}    Polygons in canvas coordinates
   */
  getCanvasAlphaISOBands(alphaThreshold = 0.75) {
    const map = this.#canvasAlphaISOBands;
    if ( !map.has(alphaThreshold) ) map.set(alphaThreshold, this.#calculateCanvasAlphaISOBands(alphaThreshold));
    return map.get(alphaThreshold);
  }
  
  /**
   * Get solid polygon areas of this cache based on a specific threshold of transparency vs solid.
   * @returns {PIXI.Polygon[]}    Polygons in canvas coordinates
   */
  #calculateCanvasAlphaISOBands(alphaThreshold = 0.75) {
    const localPolys = this.getLocalAlphaISOBands(alphaThreshold);
    return localPolys.map(localPoly => new PIXI.Polygon([...localPoly.iteratePoints()].map(pt => this._toCanvasCoordinates(pt.x, pt.y, pt))));    
  }

  /**
   * Convert these pixels to an array of polygon isobands representing
   * alpha values at or above the threshold. E.g., alpha between 0.75 and 1.
   * @returns {ClipperPaths} The polygon paths or, if error, the local alpha bounding box.
   *   Coordinates returned are local to the tile pixels, between 0 and width/height of the tile pixels.
   */
  _calculateLocalAlphaISOBands(alphaThreshold = 0.75) {
    const threshold = 255 * alphaThreshold;
    const pixels = this.pixels;
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;

    // Convert pixels to isobands.
    const width = this.bufferWidth;
    const height = this.bufferHeight;
    const rowViews = new Array(height);
    for ( let r = 0, start = 0, rMax = height; r < rMax; r += 1, start += width ) {
      // TODO: Use single Typed view instead of slicing?
      rowViews[r] = Array.from(pixels.slice(start, start + width));
    }

    let bands;
    try {
      bands = MarchingSquares.isoBands(rowViews, threshold, 256 - threshold);
    } catch ( err ) {
      console.warn(err);
      const poly = this.getThresholdLocalBoundingPolygon(alphaThreshold);
      return ClipperPaths.fromPolygons([poly]);
    }

    /* Don't want to scale between 0 and 1 b/c using evPixelCache transform on the local coordinates.
    // Create polygons scaled between 0 and 1, based on width and height.
    const invWidth = 1 / width;
    const invHeight = 1 / height;
    const nPolys = lines.length;
    const polys = new Array(nPolys);
    for ( let i = 0; i < nPolys; i += 1 ) {
      polys[i] = new PIXI.Polygon(bands[i].flatMap(pt => [pt[0] * invWidth, pt[1] * invHeight]))
    }
    */
    const nPolys = bands.length;
    const polys = new Array(nPolys);
    for ( let i = 0; i < nPolys; i += 1 ) {
      const poly = new PIXI.Polygon(bands[i].flatMap(pt => pt)); // TODO: Can we lose the flatMap?

      // Polys from MarchingSquares are CW if hole; reverse
      poly.reverseOrientation();
      polys[i] = poly;
    }

    // Use Clipper to clean the polygons. Leave as clipper paths for earcut later.
    const paths = ClipperPaths
      .fromPolygons(polys, { scalingFactor: 100 })
      .clean()
      .trimByArea(CONFIG[GEOMETRY_LIB_ID].CONFIG.alphaAreaThreshold ?? 25)
      
    // Translate by the minimum alpha bounds.
    const aabb = this.getThresholdLocalAABB(alphaThreshold);
    if ( aabb.min.x || aabb.min.y ) {
      const M = MatrixFloat32.translation(aabb.min.x, aabb.min.y);
      return paths.transform(M);
    } else return paths;
  }

  /**
   * Get polygons representing solid (alpha > threshold) areas based on a specific threshold.
   * @param {number} [threshold=0.75]   Values lower than this are treated as transparent (not solid).
   * @returns {PIXI.Polygon[]} Polygons based on local coordinates.
   */
  getLocalAlphaISOBands(alphaThreshold = 0.75) {
    const map = this.#localAlphaISOBands;
    if ( !map.has(alphaThreshold) ) {
      const paths = this._calculateLocalAlphaISOBands(alphaThreshold);
      map.set(alphaThreshold, paths.toPolygons());
    }
    return map.get(alphaThreshold);
  }

  /**
   * Calculate a canvas bounding polygon based on a specific threshold.
   */
  #calculateCanvasBoundingPolygon(alphaThreshold=0.75) {
    const localPoly = this.getThresholdLocalBoundingPolygon(alphaThreshold);
    return new PIXI.Polygon([...localPoly.iteratePoints()].map(pt => this._toCanvasCoordinates(pt.x, pt.y, pt)))
  }

  /**
   * Get a local bounding box based on a specific threshold
   * @param {number} [threshold=0.75]   Values lower than this will be ignored around the edges.
   * @returns {PIXI.Rectangle} Rectangle based on local coordinates.
   */
  getThresholdLocalBoundingPolygon(threshold = 0.75) {
    const map = this.#thresholdLocalBoundingPolygons;
    if ( !map.has(threshold) ) map.set(threshold, this.#calculateLocalBoundingPolygon(threshold));
    return map.get(threshold);
  }

  /**
   * Get a canvas bounding polygon or box based on a specific threshold.
   * If you require a rectangle, use getThresholdLocalBoundingBox
   * @returns {PIXI.Rectangle|PIXI.Polygon}    Rectangle or polygon in canvas coordinates.
   */
  getThresholdCanvasBoundingPolygon(threshold = 0.75) {
    const map = this.#thresholdCanvasBoundingPolygons;
    if ( !map.has(threshold) ) map.set(threshold, this.#calculateCanvasBoundingPolygon(threshold));
    return map.get(threshold);
  }

  // ----- NOTE: Indexing ----- //

  /**
   * Get a pixel value given local coordinates.
   * @param {number} x    Local x coordinate
   * @param {number} y    Local y coordinate
   * @returns {number|null}  Return null otherwise. Sort will put nulls between -1 and 0.
   */
  _pixelAtLocal(x, y) { return this.pixels[this._indexAtLocal(x, y)] ?? null; }

  /**
   * Get a pixel value given canvas coordinates.
   * @param {number} x    Canvas x coordinate
   * @param {number} y    Canvas y coordinate
   * @returns {number}
   */
  pixelAtCanvas(x, y) { return this.pixels[this._indexAtCanvas(x, y)] ?? null; }

  // ----- NOTE: Neighbor indexing ----- //

  /**
   * Retrieve the 8 neighbors to a given index on the local cache.
   * @param {number} currIdx
   * @param {boolean} [trimBorder=true]    If true, exclude the border values
   * @returns {number[]} The values, in column order, skipping the middle value.
   */
  localNeighbors(currIdx, trimBorder = true) {
    return this.localNeighborIndices(currIdx, trimBorder).map(idx => this.pixels[idx]);
  }
  
	/**
	 * For Moore Neighbor tracing.
	 * Iteration function that moves clockwise around a point.
	 * Starts with a desired direction.
	 * @param {PIXI.Point} [endDir]			*Last* direction to test; defaults to starting from TL
	 * @yields {PIXI.Point} A direction vector
	 */
	*iterateClockwiseNeighborDirections(endDir = PIXI.Point.tmp) {
		const indices = [      
			[-1, -1],
			[ 0, -1],
			[ 1, -1],
			[ 1,  0],
			[ 1,  1],
			[ 0,  1],
			[-1,  1],
			[-1,  0], 
		];
		
		// Use the preferred order.
		const endArr = [endDir.x, endDir.y];
		const startIdx = indices.findIndex(elem => elem.equals(endArr)) + 1; // +1 to move this to last.
		const prefix = indices.splice(0, startIdx);
		indices.push(...prefix);
		for ( const idx of indices ) yield PIXI.Point.tmp.set(idx[0], idx[1]);
	}

  // ----- NOTE: Pixel Setting ----- //

  /**
   * Set a single local pixel.
   * @param {PIXI.Point} a      Point, in local coordinates.
   * @param {number} value      Value to set at each pixel.
   */
  _setPixelUnderLocalPoint(pt, value = 0) {
     this.pixels[this._indexAtLocal(pt.x, pt.y)] = value;
  }

  /**
   * Set a single canvas pixel.
   * @param {PIXI.Point} a      Point, in canvas coordinates.
   * @param {number} value      Value to set at each pixel.
   */
  setPixelUnderCanvasPoint(pt, value = 0) {
    this.pixels[this._indexAtCanvas(pt.x, pt.y)] = value;
  }

  /**
   * Use grid traversal to set pixels under a local segment.
   * @param {PIXI.Point} a      Starting location, in local coordinates.
   * @param {PIXI.Point} b      Ending location, in local coordinates.
   * @param {number} value      Value to set at each pixel.
   */
  _setPixelsUnderLocalSegment(a, b, value = 0) {
    const indices = this.constructor.pixelsUnderSegment(a, b);
    indices.forEach(idx => {
      this._setPixelUnderLocalPoint(idx, value);
      idx.release();
    });
  }

  /**
   * Use grid traversal to set pixels under a canvas segment.
   * @param {PIXI.Point} a      Starting location, in canvas coordinates.
   * @param {PIXI.Point} b      Ending location, in canvas coordinates.
   * @param {number} value      Value to set at each pixel.
   */
  setPixelsUnderCanvasSegment(a, b, value = 0) {
    using aLocal = this._fromCanvasCoordinates(a.x, a.y);
    using bLocal = this._fromCanvasCoordinates(b.x, b.y);
    this._setPixelsUnderLocalSegment(aLocal, bLocal, value);
  }

  /**
   * Set pixels under a local shape.
   * @param {PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse|PIXI.Polygon} shape       Shape in local coordinates
   * @param {number} value                Value to set at each pixel.
   */
  _setPixelsUnderLocalShape(shape, value = 0) {
    const indices = this.constructor.pixelsUnderShape(shape);
    indices.forEach(idx => {
      this.pixels[this._indexAtLocal(idx.x, idx.y)] = value;
      idx.release();
    });
  }

  /**
   * Set pixels under a canvas rectangle.
   * @param {PIXI.Rectangle} rect       Rectangle in local coordinates
   * @param {number} value              Value to set at each pixel.
   */
  setPixelsUnderCanvasShape(shape, value = 0) {
    const localShape = this._shapeToLocalCoordinates(shape);
    this._setPixelsUnderLocalShape(localShape, value);
  }

 /**
   * Test whether the pixel cache contains a specific canvas point.
   * See Tile.prototype.containsPixel
   * @param {number} x    Canvas x-coordinate
   * @param {number} y    Canvas y-coordinate
   * @param {number} [alphaThreshold=0.75]  Value required for the pixel to "count."
   * @returns {boolean}
   */
  containsPixel(x, y, alphaThreshold = 0.75) {
    // First test against the bounding box
    const bounds = this.getThresholdCanvasBoundingBox(alphaThreshold);
    if ( !bounds.contains(x, y) ) return false;

    // Next test a specific pixel
    const value = this.pixelAtCanvas(x, y);
    return value > (alphaThreshold * this.maximumPixelValue);
  }

  // ----- NOTE: Segment pixel extraction ----- //

  /**
   * Trim a line segment to only the portion that intersects this cache bounds.
   * @param {Point} a     Starting location, in canvas coordinates
   * @param {Point} b     Ending location, in canvas coordinates
   * @param {number} alphaThreshold   Value of threshold, if threshold bounds should be used.
   * @returns {Point[2]|null} Points, in local coordinates.
   */
  _trimCanvasRayToLocalBounds(a, b, alphaThreshold) {
    const aLocal = this._fromCanvasCoordinates(a.x, a.y);
    const bLocal = this._fromCanvasCoordinates(b.x, b.y);
    return this._trimLocalRayToLocalBounds(aLocal, bLocal, alphaThreshold);
  }

  /**
   * Trim a line segment to only the portion that intersects this cache bounds.
   * @param {Point} a     Starting location, in local coordinates
   * @param {Point} b     Ending location, in local coordinates
   * @param {number} alphaThreshold   Value of threshold, if threshold bounds should be used.
   * @returns {Point[2]|null}  Points, in local coordinates
   */
  _trimLocalRayToLocalBounds(a, b, alphaThreshold) {
    const bounds = alphaThreshold ? this.getThresholdLocalBoundingBox(alphaThreshold) : this;
    return trimLineSegmentToPixelRectangle(bounds, a, b);
  }


  // TODO: Combine the extraction functions so there is less repetition of code.

  /**
   * Extract all pixel values for a canvas ray.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {object} [opts]                 Optional parameters
   * @param {number} [opts.alphaThreshold]  Percent between 0 and 1, used to trim the pixel bounds
   * @param {number[]} [opts.localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [opts.reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {number[]}    The pixel values
   */
  _extractAllPixelValuesAlongCanvasRay(a, b, { alphaThreshold, localOffsets, reducerFn } = {}) {
    const localBoundsIx = this._trimCanvasRayToLocalBounds(a, b, alphaThreshold);
    if ( !localBoundsIx ) return []; // Ray never intersects the cache bounds.

    const pixels = this._extractAllPixelValuesAlongLocalRay(
      localBoundsIx[0], localBoundsIx[1], localOffsets, reducerFn);
    pixels.forEach(pt => this._toCanvasCoordinates(pt.x, pt.y, pt)); // Inline replacement
    return pixels;
  }

  /**
   * Extract all pixel values for a local ray.
   * It is assumed, without checking, that a and be are within the bounds of the shape.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {number[]} [localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {number[]}    The pixel values
   */
  _extractAllPixelValuesAlongLocalRay(a, b, localOffsets, reducerFn) {
    localOffsets ??= [0, 0];
    reducerFn ??= this.constructor.pixelAggregator("first");

    const bresPts = bresenhamLine(a.x, a.y, b.x, b.y);
    const nPts = bresPts.length;
    const pixels = Array(nPts * 0.5);
    for ( let i = 0, j = 0; i < nPts; i += 2, j += 1 ) {
      const pt = PIXI.Point.tmp.set(bresPts[i], bresPts[i + 1]);
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      const currPixel = reducerFn(pixelsAtPoint);
      pt.currPixel = currPixel
      pixels[j] = pt;
    }
    return pixels;
  }

  /**
   * Extract all pixels values along a canvas ray that meet a test function.
   * @param {Point} a   Starting location, in canvas coordinates
   * @param {Point} b   Ending location, in canvas coordinates
   * @param {function} markPixelFn    Function to test pixels: (current pixel, previous pixel); returns true to mark
   * @param {object} [opts]                 Optional parameters
   * @param {number} [opts.alphaThreshold]  Percent between 0 and 1, used to trim the pixel bounds
   * @param {boolean} [opts.skipFirst]      Skip the first pixel if true
   * @param {boolean} [opts.forceLast]      Include the last pixel (at b) even if unmarked
   * @param {number[]} [opts.localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [opts.reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {object[]} Array of objects, each of which have:
   *   - {number} x           Canvas coordinates
   *   - {number} y           Canvas coordinates
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractAllMarkedPixelValuesAlongCanvasRay(a, b, markPixelFn,
    { alphaThreshold, skipFirst, forceLast, localOffsets, reducerFn } = {}) {
    const localBoundsIx = this._trimCanvasRayToLocalBounds(a, b, alphaThreshold);
    if ( !localBoundsIx ) return []; // Ray never intersects the cache bounds.

    const pixels = this._extractAllMarkedPixelValuesAlongLocalRay(
      localBoundsIx[0], localBoundsIx[1], markPixelFn, skipFirst, forceLast, localOffsets, reducerFn);
    pixels.forEach(pt => this._toCanvasCoordinates(pt.x, pt.y, pt)); // inline replacement
    return pixels;
  }

  /**
   * Extract all pixel values along a local ray that meet a test function.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {function} markPixelFn    Function to test pixels: (currentPixel, previousPixel); returns true to mark
   * @param {boolean} skipFirst       Skip the first pixel if true
   * @param {boolean} forceLast        Include the last pixel (at b) even if unmarked
   * @param {number[]} [localOffsets]  Numbers to add to the local x,y position when pulling the pixel(s)
   * @param {function} [reducerFn]     Function that takes pixel array and reduces to a value or object to return
   * @returns {PIXI.Point[]} Array of objects, each of which have:
   *   - {number} x           Local coordinates
   *   - {number} y           Local coordinates
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractAllMarkedPixelValuesAlongLocalRay(a, b, markPixelFn, skipFirst, forceLast, localOffsets, reducerFn) {
    skipFirst ??= false;
    forceLast ??= false;
    localOffsets ??= [0, 0];
    reducerFn ??= this.constructor.pixelAggregator("first");

    const bresPts = bresenhamLine(a.x, a.y, b.x, b.y);
    const pixels = [];
    let prevPixel;
    if ( skipFirst ) {
      const x = bresPts.shift();
      const y = bresPts.shift();
      if ( typeof y === "undefined" ) return pixels; // No more pixels!
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(x, y, localOffsets);
      prevPixel = reducerFn(pixelsAtPoint);
    }

    const nPts = bresPts.length;
    for ( let i = 0; i < nPts; i += 2 ) {
      const pt = PIXI.Point.tmp.set(bresPts[i], bresPts[i + 1]);
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      const currPixel = reducerFn(pixelsAtPoint);
      if ( markPixelFn(currPixel, prevPixel) ) {
        pt.currPixel = currPixel;
        pt.prevPixel = prevPixel;
        pixels.push(pt);
      }
      prevPixel = currPixel;
    }

    if ( forceLast ) {
      const pt = PIXI.Point.tmp.set(bresPts.at(-2), bresPts.at(-1));
      pt.currPixel = prevPixel;
      pt.forceLast = forceLast;
      // Add the last pixel regardless.
      pixels.push(pt);
    }

    return pixels;
  }

  /**
   * Convenience function.
   * Extract the first pixel value along a canvas ray that meets a test function.
   * @param {Point} a   Starting location, in canvas coordinates
   * @param {Point} b   Ending location, in canvas coordinates
   * @param {function} markPixelFn    Function to test pixels.
   *   Function takes current pixel, previous pixel
   * @returns {object|null} If pixel found, returns:
   *   - {number} x           Canvas coordinate
   *   - {number} y           Canvas coordinate
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractNextMarkedPixelValueAlongCanvasRay(a, b, markPixelFn,
    { alphaThreshold, skipFirst, forceLast, localOffsets, reducerFn } = {}) {

    const localBoundsIx = this._trimCanvasRayToLocalBounds(a, b, alphaThreshold);
    if ( !localBoundsIx ) return null; // Ray never intersects the cache bounds.

    const pixel = this._extractNextMarkedPixelValueAlongLocalRay(
      localBoundsIx[0], localBoundsIx[1], markPixelFn, skipFirst, forceLast, localOffsets, reducerFn);
    if ( !pixel ) return pixel;
    this._toCanvasCoordinates(pixel.x, pixel.y, pixel); // inline replacement
    return pixel;
  }

  /**
   * Extract the first pixel value along a local ray that meets a test function.
   * @param {Point} a   Starting location, in local coordinates
   * @param {Point} b   Ending location, in local coordinates
   * @param {function} markPixelFn    Function to test pixels.
   *   Function takes current pixel, previous pixel
   * @returns {PIXI.Point|null} If pixel found, returns:
   *   - {number} x         Local coordinate
   *   - {number} y         Local coordinate
   *   - {number} currPixel
   *   - {number} prevPixel
   */
  _extractNextMarkedPixelValueAlongLocalRay(a, b, markPixelFn, skipFirst, forceLast, localOffsets, reducerFn) {
    skipFirst ??= false;
    forceLast ??= false;
    localOffsets ??= [0, 0];
    reducerFn ??= this.constructor.pixelAggregator("first");

    const bresIter = bresenhamLineIterator(a, b);
    let prevPixel;
    let pt; // Needed to recall the last point for forceLast.
    if ( skipFirst ) {
      // Iterate over the first value
      pt = bresIter.next().value;
      if ( !pt ) return null; // No more pixels!
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      prevPixel = reducerFn(pixelsAtPoint);
    }

    for ( pt of bresIter ) {
      const pixelsAtPoint = this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
      const currPixel = reducerFn(pixelsAtPoint);
      if ( markPixelFn(currPixel, prevPixel) ) {
        pt.currPixel = currPixel;
        pt.prevPixel = prevPixel;
        return pt;
      }
      prevPixel = currPixel;
    }

    // Might be a repeat but more consistent to always pass a forceLast object when requested.
    // Faster than checking for last in the for loop.
    if ( forceLast ) {
      const out = PIXI.Point.fromObject(b);
      out.currPixel = prevPixel;
      out.forceLast = forceLast;
      return out;
    }
    return null;
  }

  /**
   * For a given location, retrieve a set of pixel values based on x/y differences
   * @param {number} x          The center x coordinate, in local coordinates
   * @param {number} y          The center y coordinate, in local coordinates
   * @param {number[]} offsets  Array of offsets: [x0, y0, x1, y1]
   * @returns {number|undefined[]} Array of pixels
   *   Each pixel is the value at x + x0, y + y0, ...
   */
  _pixelsForRelativePointsFromLocal(x, y, offsets) {
    offsets ??= [0, 0];
    const nOffsets = offsets.length;
    const out = new this.pixels.constructor(nOffsets * 0.5);
    for ( let i = 0, j = 0; i < nOffsets; i += 2, j += 1 ) {
      out[j] = this._pixelAtLocal(x + offsets[i], y + offsets[i + 1]);
    }
    return out;
  }

  /**
   * For a given canvas location, retrieve a set of pixel values based on x/y differences
   * @param {number} x                The center x coordinate, in local coordinates
   * @param {number} y                The center y coordinate, in local coordinates
   * @param {number[]} canvasOffsets  Offset grid to use, in canvas coordinate system. [x0, y0, x1, y1, ...]
   * @param {number[]} [localOffsets] Offset grid to use, in local coordinate system. Calculated if not provided.
   * @returns {number|undefined[]} Array of pixels
   *   Each pixel is the value at x + x0, y + y0, ...
   */
  pixelsForRelativePointsFromCanvas(x, y, canvasOffsets, localOffsets) {
    localOffsets ??= this.convertCanvasOffsetGridToLocal(canvasOffsets);
    using pt = this._fromCanvasCoordinates(x, y, PIXI.Point.tmp);
    return this._pixelsForRelativePointsFromLocal(pt.x, pt.y, localOffsets);
  }

  // ----- NOTE: Aggregators ----- //
    /**
   * Utility method to construct a function that can aggregate pixel array generated from offsets
   * @param {string} type     Type of aggregation to perform
   *   - first: take the first value, which in the case of offsets will be [0,0]
   *   - min: Minimum pixel value, excluding undefined pixels.
   *   - max: Maximum pixel value, excluding undefined pixels
   *   - sum: Add pixels. Returns object with total, numUndefined, numPixels.
   *   - countThreshold: Count pixels greater than a threshold.
   *     Returns object with count, numUndefined, numPixels, threshold.
   * @param {number} [threshold]    Optional pixel value used by "count" methods
   * @returns {function}
   */
  static pixelAggregator(type, threshold = -1) {
    let reducerFn;
    let startValue;
    switch ( type ) {
      case "first": return pixels => pixels[0];
      case "min": {
        reducerFn = (acc, curr) => {
          if ( curr == null ) return acc; // Undefined or null.
          return Math.min(acc, curr);
        };
        break;
      }
      case "max": {
        reducerFn = (acc, curr) => {
          if ( curr == null ) return acc;
          return Math.max(acc, curr);
        };
        break;
      }
      case "average":
      case "sum": {
        startValue = { numNull: 0, numPixels: 0, total: 0 };
        reducerFn = (acc, curr) => {
          acc.numPixels += 1;
          if ( curr == null ) acc.numNull += 1; // Undefined or null.
          else acc.total += curr;
          return acc;
        };

        // Re-zero values in case of rerunning with the same reducer function.
        reducerFn.initialize = () => {
          startValue.numNull = 0;
          startValue.numPixels = 0;
          startValue.total = 0;
        };

        break;
      }

      case "average_eq_threshold":
      case "count_eq_threshold": {
        startValue = { numNull: 0, numPixels: 0, threshold, count: 0 };
        reducerFn = (acc, curr) => {
          acc.numPixels += 1;
          if ( curr == null ) acc.numNull += 1; // Undefined or null.
          else if ( curr === acc.threshold ) acc.count += 1;
          return acc;
        };

        // Re-zero values in case of rerunning with the same reducer function.
        reducerFn.initialize = () => {
          startValue.numNull = 0;
          startValue.numPixels = 0;
          startValue.count = 0;
        };
        break;
      }

      case "average_gt_threshold":
      case "count_gt_threshold": {
        startValue = { numNull: 0, numPixels: 0, threshold, count: 0 };
        reducerFn = (acc, curr) => {
          acc.numPixels += 1;
          if ( curr == null ) acc.numNull += 1; // Undefined or null.
          else if ( curr > acc.threshold ) acc.count += 1;
          return acc;
        };

        // Re-zero values in case of rerunning with the same reducer function.
        reducerFn.initialize = () => {
          startValue.numNull = 0;
          startValue.numPixels = 0;
          startValue.count = 0;
        };

        break;
      }
      case "median_no_null": {
        return pixels => {
          pixels = pixels.filter(x => x != null); // Strip null or undefined (undefined should not occur).
          const nPixels = pixels.length;
          const half = Math.floor(nPixels / 2);
          pixels.sort((a, b) => a - b);
          if ( nPixels % 2 ) return pixels[half];
          else return Math.round((pixels[half - 1] + pixels[half]) / 2);
        };
      }

      case "median_zero_null": {
        return pixels => {
          // Sorting puts undefined at end, null in front. Pixels should never be null.
          const nPixels = pixels.length;
          const half = Math.floor(nPixels / 2);
          pixels.sort((a, b) => a - b);
          if ( nPixels % 2 ) return pixels[half];
          else return Math.round((pixels[half - 1] + pixels[half]) / 2);
        };
      }
    }

    switch ( type ) {
      case "average": reducerFn.finalize = acc => acc.total / acc.numPixels; break; // Treats undefined as 0.
      case "average_eq_threshold":
      case "average_gt_threshold": reducerFn.finalize = acc => acc.count / acc.numPixels; break; // Treats undefined as 0.
    }

    const reducePixels = this.reducePixels;
    const out = pixels => reducePixels(pixels, reducerFn, startValue);
    out.type = type; // For debugging.
    return out;
  }

  /**
   * Version of array.reduce that improves speed and handles some unique cases.
   * @param {number[]} pixels
   * @param {function} reducerFn      Function that takes accumulated values and current value
   *   If startValue is undefined, the first acc will be pixels[0]; the first curr will be pixels[1].
   * @param {object} startValue
   * @returns {object} The object returned by the reducerFn
   */
  static reducePixels(pixels, reducerFn, startValue) {
    const numPixels = pixels.length;
    if ( numPixels < 2 ) return pixels[0];

    if ( reducerFn.initialize ) reducerFn.initialize();
    let acc = startValue;
    let startI = 0;
    if ( typeof startValue === "undefined" ) {
      acc = pixels[0];
      startI = 1;
    }
    for ( let i = startI; i < numPixels; i += 1 ) {
      const curr = pixels[i];
      acc = reducerFn(acc, curr);
    }

    if ( reducerFn.finalize ) acc = reducerFn.finalize(acc);
    return acc;
  }

  // ----- NOTE: Static methods ----- //
  static maximumPixelValue(arr) {
    if ( Array.isArray(arr) ) return Number.MAX_SAFE_INTEGER;

    // 1. Check if the input is actually a TypedArray
    if (!ArrayBuffer.isView(arr) || arr instanceof DataView) {
      throw new Error("Input must be a standard TypedArray (e.g., new Int8Array())");
    }

    // 2. Define maximums for each TypedArray type
    // Note: We map the constructor directly to the logic or value
    const constructor = arr.constructor;
    switch (constructor) {
      case Int8Array: return 127; // 2^7 - 1
      case Uint8Array:
      case Uint8ClampedArray: return 255; // 2^8 - 1
      case Int16Array: return 32767; // 2^15 - 1
      case Uint16Array: return 65535; // 2^16 - 1
      case Int32Array: return 2147483647; // 2^31 - 1
      case Uint32Array: return 4294967295; // 2^32 - 1

      // 3. Handle BigInt types (Return values as BigInts, denoted by 'n')
      case BigInt64Array: return 9223372036854775807n;  // 2^63 - 1
      case BigUint64Array: return 18446744073709551615n; // 2^64 - 1

      // 4. Handle Float types
      case Float32Array:
      case Float64Array: return Number.MAX_SAFE_INTEGER; // While floats technically go higher, this is the max safe INTEGER

      default: throw new Error("Unknown TypedArray type");
    }
  }

  /**
   * Identifies all pixels (grid cells) intersected by a segment.
   * Uses Grid Traversal Algorithm, a.k.a. Digital Differential Analyzer.
   * This algorithm works by calculating exactly when the line crosses the vertical
   * and horizontal grid lines (the boundaries of the "pixels"),
   * identifying every single pixel the segment touches.
   * @param {PIXI.Point} a      Starting coordinate
   * @param {PIXI.Point} b      Ending coordinate
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderSegment(a, b) {
    const pixels = [];

    // 1. Convert start and end points to grid coordinates
    using current = PIXI.Point.tmp;
    using end = PIXI.Point.tmp;
    a.floor(current);
    b.floor(end);

    // 2. Determine step direction (+1 or -1)
    using step = PIXI.Point.tmp.set(
      (b.x > a.x) ? 1 : -1,
      (b.y > a.y) ? 1 : -1,
    );

    // 3. Calculate the distance (t) required to move 1 pixel unit
    // We avoid division by zero by using Infinity if delta is 0
    using delta = b.subtract(a);

    // How far along the ray we must move for the component to change 1 unit
    // pixelSize / |delta| gives us the scale factor per grid cell
    const tDelta = PIXI.Point.tmp.set(
      (delta.x !== 0) ? Math.abs(1 / delta.x) : Infinity,
      (delta.y !== 0) ? Math.abs(1 / delta.y) : Infinity,
    );

    // 4. Calculate the distance to the *first* grid boundary
    const tMax = PIXI.Point.tmp;

    // Distance from current position to right edge of the pixel
    if ( delta.x > 0 ) tMax.x = (current.x + 1 - a.x) / delta.x;

    // Distance from current position to left edge of the pixel
    else if ( delta.x < 0 ) tMax.x = (a.x - current.x) / -delta.x; // simplified
    else tMax.x = Infinity;

    if ( delta.y > 0 ) tMax.y = (current.y + 1 - a.y) / delta.y;
    else if ( delta.y < 0 ) tMax.y = (a.y - current.y) / -delta.y;
    else tMax.y = Infinity;

    // 5. Traverse the grid
    // We loop until we pass the end grid cell
    let iter = 0;
    while (true) {
      if ( iter++ > 100000 ) throw new Error("Iterations exceeded.");

      // Add current pixel
      pixels.push(current.clone());

      // If we reached the target grid cell, break
      if ( current.equals(end) ) break;

      // Move to the next grid cell based on which boundary is closer
      if (tMax.x < tMax.y) {
        tMax.x += tDelta.x;
        current.x += step.x;
      } else {
        tMax.y += tDelta.y;
        current.y += step.y;
      }
    }
    return pixels;
  }

  /**
   * Identifies all pixels (grid cells) intersected by a PIXI.Rectangle.
   * @param {PIXI.Rectangle} rect - The source rectangle (world space)
   * @param {number} [pixelSize=1] - The size of each grid cell
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderRectangle(rect) {
    const pixels = [];

    // 1. Calculate the starting grid index (Top-Left)
    // We use Math.floor to snap to the grid coordinate
    using start = PIXI.Point.tmp.set(rect.x, rect.y);
    start.floor(start);

    // 2. Calculate the ending grid index (Bottom-Right)
    // We subtract a tiny epsilon (0.0001) from the right/bottom edge.
    // Why? If a rectangle ends exactly at 20 (and pixelSize is 10), it occupies
    // pixels 0 and 1, but NOT 2. Without the epsilon, 20/10 = 2, which would
    // wrongly include the next pixel.
    const EPSILON = 0.0001;
    using end = PIXI.Point.tmp.set(
      rect.x + rect.width - EPSILON,
      rect.y + rect.height - EPSILON,
    );
    end.floor(end);

    // 3. Loop through the range
    for ( let y = start.y; y <= end.y; y += 1 ) {
      for ( let x = start.x; x <= end.x; x += 1 ) pixels.push(PIXI.Point.tmp.set(x, y));
    }
    return pixels;
  }

  /**
   * Identifies all pixels (grid cells) intersected by a PIXI.Circle.
   * Uses a Bounding Box scan with a Distance Check.
   * Examines every pixel within the square area that encloses the circle, and then calculate
   * if the center of that pixel (or its closest edge) falls within the circle's radius.
   * @param {PIXI.Circle} circle      The source circle (world space)
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderCircle(circle) {
    const pixels = [];

    // 1. Define the Bounding Box of the circle in grid coordinates
    const radiusSq = circle.radius * circle.radius;
    using center = PIXI.Point.fromObject(circle);
    using radius = PIXI.Point.tmp.set(circle.radius, circle.radius)
    using start = PIXI.Point.tmp;
    using end = PIXI.Point.tmp;

    // E.g,
    // Math.floor((circle.x - circle.radius) / pixelSize)
    // Math.floor((circle.x + circle.radius) / pixelSize)
    center.subtract(radius, start).floor(start);
    center.add(radius, end).floor(end);

    // 2. Iterate through the bounding box

    using closest = PIXI.Point.tmp;
    using next = PIXI.Point.tmp;
    using delta = PIXI.Point.tmp;
    for ( let y = start.y; y <= end.y; y += 1 ) {
      for ( let x = start.x; x <= end.x; x += 1 ) {
        // 3. Find the point within the pixel closest to the circle center
        // This ensures we catch pixels even if only a tiny corner is inside.
        closest.set(x, y);
        next.set(x+1, y+1).min(center, next);
        closest.max(next, closest);

        // const closestX = Math.max(x * pixelSize, Math.min(circle.x, (x + 1) * pixelSize));
        // const closestY = Math.max(y * pixelSize, Math.min(circle.y, (y + 1) * pixelSize));

        // 4. Calculate squared distance (faster than Math.sqrt)
        center.subtract(closest, delta);
        const distanceSq = delta.dot(delta);

        /*
        const dx = circle.x - closestX;
        const dy = circle.y - closestY;
        const distanceSq = (dx * dx) + (dy * dy);
        */

        if ( distanceSq <= radiusSq ) pixels.push(PIXI.Point.tmp.set(x, y));
      }
    }
    return pixels;
  }

  /**
   * Identifies all pixels (grid cells) intersected by a PIXI.Ellipse.
   * Uses a Bounding Box scan with a Distance Check.
   * Examines every pixel within the square area that encloses the ellipse, and then calculate
   * if the center of that pixel (or its closest edge) falls within the ellipse's radius.
   * @param {PIXI.Ellipse} ellipse      The source ellipse (world space)
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderEllipse(ellipse) {
    const pixels = [];

    // 1. Define the Bounding Box in grid coordinates.
    using center = PIXI.Point.fromObject(ellipse);
    using start = PIXI.Point.tmp;
    using end = PIXI.Point.tmp;
    using radius = PIXI.Point.tmp.set(ellipse.width, ellipse.height); // In PIXI, width and height are radii (semi-axes)

    // E.g., Math.floor((ellipse.x - a) / pixelSize);
    center.subtract(radius, start).floor(start);
    center.add(radius, end).floor(end);

    // Pre-calculate squares to save operations in the loop
    radius.multiply(radius, radius);

    // 2. Iterate through the bounding box
    using closest = PIXI.Point.tmp;
    using next = PIXI.Point.tmp;
    using delta = PIXI.Point.tmp;
    for ( let y = start.y; y <= end.y; y += 1 ) {
      for ( let x = start.x; x <= end.x; x += 1 ) {
        // 3. Find the point within the pixel closest to the ellipse center
        closest.set(x, y);
        next.set(x+1, y+1).min(center, next);
        closest.max(next, closest);

        // const closestX = Math.max(x * pixelSize, Math.min(ellipse.x, (x + 1) * pixelSize));
        // const closestY = Math.max(y * pixelSize, Math.min(ellipse.y, (y + 1) * pixelSize));

        // 4. Apply the Ellipse Equation
        // If the result is <= 1, the point is inside or on the boundary
        center.subtract(closest, delta);
        delta.multiply(delta, delta);
        delta.divide(radius, delta);

        if ( (delta.x + delta.y) <= 1 ) pixels.push(PIXI.Point.tmp.set(x, y));
        // const dx = closestX - ellipse.x;
        // const dy = closestY - ellipse.y;
        // if ( (dx * dx) / radius2.x + (dy * dy) / radius2.y <= 1 ) pixels.push(PIXI.Point.tmp.set(x, y));

      }
    }
    return pixels;
  }

  /**
   * Identifies all pixels (grid cells) intersected by a PIXI.Polygon.
   * Uses Scanline Fill Algorithm. This is more complex than a circle or rectangle because
   * polygons can be irregular, concave, or have many vertices.  Checks each horizontal "row" (scanline)
   * of pixels that the polygon covers and find where the polygon's edges intersect that row.
   * @param {PIXI.Polygon} polygon      The source polygon (world space)
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderPolygon(polygon) {
    const pixels = [];

    // 1. Convert flat array to objects and find the bounding box
    // Find the vertical range (minY to maxY) so we don't scan the entire world.
    const aabb = AABB2d.fromPolygon(polygon);

    // 2. Convert Y bounds to grid indices
    const startY = Math.floor(aabb.min.y);
    const endY = Math.floor(aabb.max.y);
    aabb.release();

    // 3. Process each horizontal scanline
    for ( let gridY = startY; gridY <= endY; gridY += 1 ) {
      // Find the center Y of the current pixel row for intersection testing
      const y = (gridY + 0.5);

      // 4. Find where the scanline intersects each edge of the polygon
      // For every row of pixels, draw an imaginary horizontal line.
      // Calculate where this line hits the "walls" (edges) of the polygon
      const intersections = [];
      for ( const edge of polygon.iterateEdges({ close: true }) ) {
        const p1 = edge.a;
        const p2 = edge.b;

        // Check if the edge crosses the current Y level
        if ( (p1.y <= y && p2.y > y) || (p2.y <= y && p1.y > y) ) {
          // Calculate the X coordinate of the intersection
          const intersectX = p1.x + (y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);
          intersections.push(intersectX);
        }
      }

      // 5. Sort intersections from left to right
      intersections.sort((a, b) => a - b);

      // 6. Fill the pixels between pairs of intersections (even-odd rule)
      // The Even-Odd Rule: In geometry, if you start outside a shape and cross an edge,
      // you are now inside. Cross another, and you are outside.
      // This is why we sort the intersections and process them in pairs (i += 2).
      for ( let i = 0, iMax = intersections.length; i < iMax; i += 2 ) {
        const startX = Math.floor(intersections[i]);
        const endX = Math.floor(intersections[i + 1]);
        for ( let gridX = startX; gridX <= endX; gridX += 1 ) pixels.push(PIXI.Point.tmp.set(gridX, gridY));
      }
    }
    return pixels;
  }

  /**
   * Identifies all pixels (grid cells) intersected by a PIXI shape.
   * @param {PIXI.Polygon|PIXI.Rectangle|PIXI.Circle|PIXI.Ellipse} shape      The source shape (world space)
   * @returns {PIXI.Point[]} Array of points representing grid indices
   */
  static pixelsUnderShape(shape) {
    switch ( shape.constructor ) {
      case PIXI.Rectangle: return this.pixelsUnderRectangle(shape);
      case PIXI.Polygon: return this.pixelsUnderPolygon(shape);
      case PIXI.Circle: return this.pixelsUnderCircle(shape);
      case PIXI.Ellipse: return this.pixelsUnderEllipse(shape);
      default: throw new Error(`this.name|Shape ${shape.constructor.name} not recognized`, shape);
    }
  }

  static extractPixelsFromTexture(texture, frame) {
    const out = extractPixels(canvas.app.renderer, texture, frame); // Res: pixels, x, y, width, height
    out.resolution = texture.resolution || 1;
    return out;
  }

  /**
   * Combine multiple channels of pixels using a callback function.
   * @param {number[]} pixels         Array of pixels to consolidate.
   * @param {function} combineFn      Function to combine multiple channels of pixel data.
   * @param {number} [numChannels=4]  Number of channels
   * @param {class} [arrayClass]      What array class to use to store the resulting pixel values
   */
  static combinePixels(pixels, combineFn, numChannels = 4, arrayClass) {
    const numPixels = pixels.length;
    arrayClass ??= pixels.constructor;
    const combinedPixels = new arrayClass(Math.ceil(numPixels * (1 / numChannels)));
    for ( let i = 0, j = 0; i < numPixels; i += numChannels, j += 1 ) {
      combinedPixels[j] = combineFn(...pixels.slice(i, i + numChannels));
    }
    return combinedPixels;
  }

  /**
   * Extract a pixel channel. E.g., for RGBA, extract green with selectedChannel = 1, numChannels = 4.
   * @param {number[]|TypedArray} pixels        Pixel array containing all channels
   * @param {number} selectedChannel            Channel to extract, starting at 0
   * @param {number} numChannels                Total number of channels
   * @param {number[]|TypedArray} outArray      Array to store the result
   * @returns {number[]|TypedArray} The outArray
   */
  static extractPixelChannel(pixels, selectedChannel = 0, numChannels = selectedChannel + 1, outArray) {
    const n = Math.ceil(pixels.length / numChannels);
    outArray ??= new pixels.constructor(n);
    for ( let i = selectedChannel, j = 0; i < n; i += numChannels, j += 1 ) outArray[j] = pixels[i]
    return outArray;
  }

  /**
   * Consider the nearest neighbor when upscaling or downscaling a texture pixel array.
   * Average together.
   * See https://towardsdatascience.com/image-processing-image-scaling-algorithms-ae29aaa6b36c.
   * @param {number[]} pixels   The original texture pixels
   * @param {number} width      Width of the original texture
   * @param {number} height     Height of the original texture
   * @param {number} resolution Amount to grow or shrink the pixel array size.
   * @param {object} [options]  Parameters that affect which pixels are used.
   * @param {TypedArray}   [options.arrayClass=Uint8Array]  What array class to use to store the resulting pixel values
   * @returns {number[]}
   */
  static nearestNeighborScaling(pixels, width, height, resolution, { arrayClass, arr } = {}) {
    arrayClass ??= Uint8Array;

    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;

    if ( arr && arr.length !== N ) {
      console.error(`PixelCache.nearestNeighborScaling|Array provided must be length ${N}`);
      arr = undefined;
    }
    arr ??= new arrayClass(N);

    for ( let col = 0; col < localWidth; col += 1 ) {
      for ( let row = 0; row < localHeight; row += 1 ) {
        // Locate the corresponding pixel in the original texture.
        const x_nearest = roundFastPositive(col * invResolution);
        const y_nearest = roundFastPositive(row * invResolution);
        const j = (y_nearest * width) + x_nearest;

        // Fill in the corresponding local value.
        const i = ((~~row) * localWidth) + (~~col);
        arr[i] = pixels[j];
      }
    }
    return arr;
  }

  /**
   * Consider every pixel in the downscaled image as a box in the original.
   * Average together.
   * See https://towardsdatascience.com/image-processing-image-scaling-algorithms-ae29aaa6b36c.
   * @param {number[]} pixels   The original texture pixels
   * @param {number} width      Width of the original texture
   * @param {number} height     Height of the original texture
   * @param {number} resolution Amount to shrink the pixel array size. Must be less than 1.
   * @param {object} [options]  Parameters that affect which pixels are used.
   * @param {TypedArray}   [options.arrayClass=Uint8Array]  What array class to use to store the resulting pixel values
   * @returns {number[]}
   */
  static boxDownscaling(pixels, width, height, resolution, { arrayClass, arr } = {}) {
    arrayClass ??= Uint8Array;

    const invResolution = 1 / resolution;
    const localWidth = Math.round(width * resolution);
    const localHeight = Math.round(height * resolution);
    const N = localWidth * localHeight;
    if ( arr && arr.length !== N ) {
      console.error(`PixelCache.nearestNeighborScaling|Array provided must be length ${N}`);
      arr = undefined;
    }
    arr ??= new arrayClass(N);

    const boxWidth = Math.ceil(invResolution);
    const boxHeight = Math.ceil(invResolution);

    for ( let col = 0; col < localWidth; col += 1 ) {
      for ( let row = 0; row < localHeight; row += 1 ) {
        // Locate the corresponding pixel in the original texture.
        const x_ = ~~(col * invResolution);
        const y_ = ~~(row * invResolution);

        // Ensure the coordinates are not out-of-bounds.
        const x_end = Math.min(x_ + boxWidth, width - 1) + 1;
        const y_end = Math.min(y_ + boxHeight, height - 1) + 1;

        // Average colors in the box.
        const values = [];
        for ( let x = x_; x < x_end; x += 1 ) {
          for ( let y = y_; y < y_end; y += 1 ) {
            const j = (y * width) + x;
            values.push(pixels[j]);
          }
        }

        // Fill in the corresponding local value.
        const i = ((~~row) * localWidth) + (~~col);
        const avgPixel = values.reduce((a, b) => a + b, 0) / values.length;
        arr[i] = roundFastPositive(avgPixel);
      }
    }
    return arr;
  }

  // ----- NOTE: Debug drawing ----- //

  /**
   * Creates a function that maps a value to a color between blue and red.
   *
   * @param {number} min      The minimum value of the range (Blue/Cold).
   * @param {number} max      The maximum value of the range (Red/Hot).
   * @returns {function}
   *  - @param {number} value   Value clamped between min and max
   *  - @returns {number} PIXI-compatible hex integer
   */
  static createHeatMap(min, max) {
    return function(value) {
      // 1. Normalize the value to a 0-1 range
      // Clamp the value to ensure it stays within the min/max bounds
      const clampedValue = Math.max(min, Math.min(max, value));

      // Calculate ratio (0 = min, 1 = max)
      const ratio = (clampedValue - min) / (max - min);

      // 2. Map ratio to Hue
      // Blue is 240°, Red is 0°.
      // We want to go from 240 down to 0 based on the ratio.
      const hue = (1 - ratio) * 240;

      // 3. Convert HSL to RGB
      // Using standard saturation (100%) and lightness (50%) for vibrant colors
      const saturation = 100;
      const lightness = 50;

      return Draw.hslToHex(hue, saturation, lightness);
    };
  }

  /**
   * Draw a representation of this pixel cache on the canvas, where alpha channel is used
   * to represent values. For debugging.
   */
  draw({ color = Draw.COLORS.blue, gammaCorrect = false, local = false, skip = 10, radius = 1, maximumPixelValue, colorFn, alphaFn } = {}) {
    maximumPixelValue ??= this.maximumPixelValue;
    colorFn ??= _value => color;
    alphaFn ??= value => clamp(value / maximumPixelValue, 0, 1);

    // Gamma correction for alpha.
    let gammaFn;
    if ( gammaCorrect ) {
      const GAMMA_EXP = 1 / 2.2;
      gammaFn = alpha => Math.pow(alpha, GAMMA_EXP);
    } else gammaFn = alpha => alpha;

    const ln = this.pixels.length;
    const coordFn = local ? this._localAtIndex : this._canvasAtIndex;
    skip += 1; // For incrementing i.
    for ( let i = 0; i < ln; i += skip ) {
      const value = this.pixels[i];
      if ( !value ) continue;
      const color = colorFn(value);
      const alpha = gammaFn(alphaFn(value));
      using pt = coordFn.call(this, i);
      Draw.point(pt, { color, alpha, radius });
    }
  }

  /**
   * For debugging, to test coordinate conversion.
   * Use `pixelAtLocal` or `pixelAtCanvas` to get the value. Unlike `draw`, which iterates from the pixel indices directly.
   */
  drawFromCoords({color = Draw.COLORS.blue, gammaCorrect = false, skip = 10, radius = 1, local = false, maximumPixelValue, colorFn, alphaFn } = {}) {
    maximumPixelValue ??= this.maximumPixelValue;
    colorFn ??= _value => color;
    alphaFn ??= value => clamp(value / maximumPixelValue, 0, 1);

    // Gamma correction for alpha.
    let gammaFn;
    if ( gammaCorrect ) {
      const GAMMA_EXP = 1 / 2.2;
      gammaFn = alpha => Math.pow(alpha, GAMMA_EXP);
    } else gammaFn = alpha => alpha;

    const { right, left, top, bottom } = this;
    let coordFn;
    let valueFn;
    if ( local ) {
      coordFn = (localX, localY) => PIXI.Point.tmp.set(localX, localY);
      valueFn = this._pixelAtLocal;
    } else {
      coordFn = (localX, localY) => this._toCanvasCoordinates(localX, localY);
      valueFn = (localX, localY) => {
        using canvasPt = this._toCanvasCoordinates(localX, localY);
        return this.pixelAtCanvas(canvasPt.x, canvasPt.y);
      }
    }

    skip += 1; // For incrementing.
    for ( let localX = left; localX <= right; localX += skip ) {
      for ( let localY = top; localY <= bottom; localY += skip ) {
        const value = valueFn.call(this, localX, localY);
        if ( !value ) continue;
        const color = colorFn(value);
        const alpha = gammaFn(alphaFn(value));
        using pt = coordFn.call(this, localX, localY);
        Draw.point(pt, { color, alpha, radius });
      }
    }
  }
}

/**
 * Pixel cache that has pixel values === 0 trimmed around the border.
 * See Foundry's TextureLoader.getTextureAlphaData
 * Used to ignore 0-alpha pixels around the border.
 */
export class TrimmedPixelCache extends PixelCache {
  /**
   * Bounds of the actual pixel data relative to the full local frame.
   * @type {PIXI.Rectangle}
   */
  #bufferBounds = new AABB2d();

  /**
   * @param {AABB2d} [opts.bufferBounds]      Where the non-trimmed pixels are relative to the full local frame.
   */
  constructor(fullWidth, fullHeight, { bufferBounds, ...opts } = {}) {
    super(fullWidth, fullHeight, opts);
    if ( bufferBounds ) bufferBounds.clone(this.#bufferBounds);
    else {
      this.#bufferBounds.min.copyFrom(this.min);
      this.#bufferBounds.max.copyFrom(this.max);
    }
  }

  // ----- NOTE: Getters / setters ----- //

  get bufferBounds() { return this.#bufferBounds.clone(); }

  get bufferWidth() { return this.#bufferBounds.max.x - this.#bufferBounds.min.x + 1; }

  get bufferHeight() { return this.#bufferBounds.max.y - this.#bufferBounds.min.y + 1; }


  // ----- NOTE: Static factory method ----- //

  /**
   * From a non-trimmed pixel array, trim the pixels and create a new pixel cache.
   * @param {TypedArray} pixels
   * @param {number} pixelWidth     The width of the pixel rectangle
   * @param {object} [opts]         Options passed to the constructorfullHeight = 5;
   * @returns {TrimmedPixelCache}
   */
  static fromPixelArray(pixels, untrimmedLocalWidth, opts = {}) {
    untrimmedLocalWidth = roundFastPositive(untrimmedLocalWidth);
    const untrimmedLocalHeight = Math.ceil(pixels.length / untrimmedLocalWidth);
    const aabb = this.minMaxNonZeroPixels(pixels, untrimmedLocalWidth, untrimmedLocalHeight, opts);

    // Create new trimmed buffer
    const trimmedWidth = aabb.max.x - aabb.min.x + 1;  // Include both the min and max indices.
    const trimmedHeight = aabb.max.y - aabb.min.y + 1; // Include both the min and max indices.
    const trimmedPixels = new pixels.constructor(trimmedWidth * trimmedHeight);
    for ( let i = 0, y = aabb.min.y; y < aabb.max.y; y++ ) {
      for ( let x = aabb.min.x; x < aabb.max.x; x++, i++ ) {
        trimmedPixels[i] = pixels[((untrimmedLocalWidth * y) + x)];
      }
    }
    opts.pixelsOrClass = trimmedPixels;
    opts.bufferBounds = aabb;
    return new this(untrimmedLocalWidth, untrimmedLocalHeight, opts);
  }

  // ----- NOTE: Static methods ----- //

  /**
   * Determine the min/max pixel coordinates for an array of pixels.
   * Meaning, the first and last coordinates of non-zero pixels.
   * See Foundry's TextureLoader.getTextureAlphaData.
   * @param {TypedArray} pixels     Array of pixels to trim
   * @param {number} width          Width of the pixel rectangle
   * @param {number} height         Heigh of the pixel rectangle
   * @returns {AABB2d}
   */
  static minMaxNonZeroPixels(pixels, width, height) {
    const aabb = new AABB2d();
    aabb.min.x = width;
    aabb.min.y = height;
    aabb.max.x = 0;
    aabb.max.y = 0;

    let i = 0;
    for ( let y = 0; y < height; y += 1 ) {
      for ( let x = 0; x < width; x += 1 ) {
        const alpha = pixels[i++];
        if ( alpha === 0 ) continue;
        if ( x < aabb.min.x ) aabb.min.x = x;
        if ( x >= aabb.max.x ) aabb.max.x = x;
        if ( y < aabb.min.y ) aabb.min.y = y;
        if ( y >= aabb.max.y ) aabb.max.y = y;
      }
    }

    // Special case when the whole texture is alpha 0
    if ( aabb.min.x > aabb.max.x ) aabb.min.x = aabb.min.y = aabb.max.x = aabb.max.y = 0;
    return aabb;
  }

  // ----- NOTE: Indexing ----- //

  /**
   * Override the base indexing logic to account for the buffer offset.
   */
  _indexAtLocal(x, y) {
    // Use floor to determine in which "pixel bucket" the coordinate lies.
    x = ~~x;
    y = ~~y;
     
    // Check against trimmed bounds, not full frame.
    // Could use bufferBounds.contains but this is faster. 
    const { min, max } = this.#bufferBounds;
    if ( x < min.x || x > max.x || y < min.y || y > max.y ) return -1;
    
    // Return the index, accounting for the trimmed bounds.
    const width = (max.x - min.x) + 1;
    return ((y - min.y) * width) + (x - min.x);  
  }
  
  /**
   * Override the base indexing logic to account for the buffer offset.
   */
  _localAtIndex(i, outPoint) {
    outPoint ??= PIXI.Point.tmp;
    const { min, max } = this.#bufferBounds;
    const width = (max.x - min.x) + 1;
    
    const col = i % width;
    const row = ~~(i / width); // Floor the row.
    
    // Add back the offset to get the coordinate in full local frame
    return outPoint.set(col + min.x, row + min.y);
  }

  /**
   * Return 0 for the trimmed "void" area; null if outside the full frame.
   */
  _pixelAtLocal(x, y) {
    const idx = this._indexAtLocal(x, y);
    if ( ~idx ) return this.pixels[idx];

    // If in the full frame, but not in the buffer area, return 0.
    return this.contains(x, y) ? 0 : null;
  }
}


/**
 * Pixel cache specific to a tile texture.
 * Adds additional handling for tile rotation, scaling, converting from a tile cache.
 */
export class TilePixelCache extends TrimmedPixelCache {
  /** @type {Tile} */
  tile;

  /**
   * @param {Tile} [options.tile]   Tile for which this cache applies
                                    If provided, scale will be updated
   * @inherits
   */
  constructor(fullWidth, fullHeight, { tile, ...opts } = {}) {
    super(fullWidth, fullHeight, opts);
    this.tile = tile;
    this.updateTransforms();
  }

  // ----- NOTE: Tile data getters ----- //

  /** @type {number} */
  get alphaThreshold() { return this.tile.document.texture.alphaThreshold || 0; }

  get tileRotation() { return Math.toRadians(this.tile.document.rotation); }

  get tileTranslation() {
    const tileD = this.tile.document;
    const anchor = this.tileAnchorTranslation;
    return { x: tileD.x - anchor.x, y: tileD.y - anchor.y };
  }

  get tileScale() {
    // Scale, accounting for document width/height and tile texture width/height.
    const tileD = this.tile.document;
    const tex = tileD.object.texture;
    const { scaleX, scaleY } = tileD.texture;
    const proportionalWidth = tileD.width / tex.width;
    const proportionalHeight = tileD.height / tex.height;
    return {
      x: proportionalWidth * scaleX,
      y: proportionalHeight * scaleY,
    };
  }
  
  get tileAnchorTranslation() {
    const tileD = this.tile.document;
    const { anchorX, anchorY } = tileD.texture;
    return { 
      x: anchorX * tileD.width,
      y: anchorY * tileD.height,
    }
  }

  /**
   * For backwards compatibility only.
   */
  _resize() { this.updateTransforms(); }

  /**
   * For backwards compatibility only.
   */
  clearTransforms() { this.updateTransforms(); }

  /**
   * Transform canvas coordinates into the local pixel rectangle coordinates.
   * @inherits
   */
  updateTransforms() {
    // Set translation, rotation, and scale from the tile document.
    this.modelMatrix.modelCenter = this.tileAnchorTranslation;
    this.translation = this.tileTranslation;
    this.rotationZ = this.tileRotation;
    this.scale = this.tileScale;    
    super.updateTransforms();
  }

  /**
   * Convert a tile's alpha channel to a pixel cache.
   * At the moment mostly for debugging, b/c overhead tiles have an existing array that
   * can be used.
   * @param {Tile} tile     Tile to pull a texture from
   * @param {object} opts   Options passed to `scalePixels` method
   * @returns {TilePixelCache}
   */
  static fromTileChannel(tile, channel = 3, opts = {}) {
    const res = this.extractPixelsFromTexture(tile.texture);
    opts.pixelsOrClass = this.extractPixelChannel(res.pixels, channel, 4);
    opts.tile = tile;
    return new this(res.width, res.height, opts);
  }

  /**
   * Convert an overhead tile's alpha channel to a pixel cache.
   * Relies on already-cached overhead tile pixel data.
   * @param {Tile} tile     Tile to pull a texture from
   * @param {object} opts   Options passed to `fromTexture` method
   * @returns {TilePixelCache}
   */
  static fromOverheadTileAlpha(tile, opts = {}) {
    if ( Number.isNumeric(opts) ) opts = { resolution: opts }; // Backwards compatibility.

    // See TextureLoader.getTextureAlphaData.
    // Returns non-inclusive pixels. E.g., [minX, maxX)
    opts.resolution ||= 1;
    const texData = foundry.canvas.TextureLoader.getTextureAlphaData(tile.texture, opts.resolution);

    // Define bounds of actual data within the full texture frame.
    opts.bufferBounds = new AABB2d();
    opts.bufferBounds.min.set(texData.minX, texData.minY);
    opts.bufferBounds.max.set(texData.maxX - 1, texData.maxY - 1); // Make inclusive: [minX, maxX].
    opts.pixelsOrClass = texData.data;
    opts.tile = tile;
    return new this(texData.width, texData.height, opts);
  }

  // ----- NOTE: Methods that rely on alphaThreshold ---- //
  /**
   * Test whether the pixel cache contains a specific canvas point.
   * See Tile.prototype.containsPixel
   * @param {number} x    Canvas x-coordinate
   * @param {number} y    Canvas y-coordinate
   * @param {number} [alphaThreshold=0.75]  Value required for the pixel to "count."
   * @returns {boolean}
   */
  containsPixel(x, y, alphaThreshold) { return super.containsPixel(x, y, alphaThreshold ?? this.alphaThreshold); }

  /**
   * Trim a line segment to only the portion that intersects this cache bounds.
   * @param {Point} a     Starting location, in local coordinates
   * @param {Point} b     Ending location, in local coordinates
   * @param {number} alphaThreshold   Value of threshold, if threshold bounds should be used.
   * @returns {Point[2]|null}  Points, in local coordinates
   */
  _trimLocalRayToLocalBounds(a, b, alphaThreshold) { return super._trimLocalRayToLocalBounds(a, b, alphaThreshold ?? this.alphaThreshold); }

}

/**
 * Store a point, a t value, and the underlying coordinate system
 */
export class Marker {
  /** @type {PIXI.Point} */
  #point;

  /** @type {number} */
  t = -1;

  /** @type {object} */
  range = {
    start: new PIXI.Point(),  /** @type {PIXI.Point} */
    end: new PIXI.Point()       /** @type {PIXI.Point} */
  };

  /** @type {object} */
  options = {};

  /** @type {Marker} */
  next;

  constructor(t, start, end, opts = {}) {
    this.t = t;
    this.options = opts;
    this.range.start.copyFrom(start);
    this.range.end.copyFrom(end);
  }

  /** @type {PIXI.Point} */
  get point() { return this.#point ?? (this.#point = this.pointAtT(this.t)); }

  /**
   * Given a t position, project the location given this marker's range.
   * @param {number} t
   * @returns {PIXI.Point}
   */
  pointAtT(t) { return this.range.start.projectToward(this.range.end, t); }

  /**
   * Build a new marker and link it as the next marker to this one.
   * If this marker has a next marker, insert in-between.
   * Will insert at later spot as necessary
   * @param {number} t      Must be greater than or equal to this t.
   * @param {object} opts   Will be combined with this marker options.
   * @returns {Marker}
   */
  addSubsequentMarker(t, opts) {
    if ( this.t === t ) { return this; }

    // Insert further down the line if necessary.
    if ( this.next && this.next.t < t ) return this.next.addSubsequentMarker(t, opts);

    // Merge the options with this marker's options and create a new marker.
    if ( t < this.t ) console.error("Marker asked to create a next marker with a previous t value.");
    const next = new this.constructor(t, this.range.start, this.range.end, { ...this.options, ...opts });

    // Insert at the correct position.
    if ( this.next ) next.next = this.next;
    this.next = next;
    return next;
  }

  /**
   * Like addSubsequentMarker but does not merge options and performs less checks.
   * Assumes it should be the very next item and does not check for existing next object.
   */
  _addSubsequentMarkerFast(t, opts) {
    const next = new this.constructor(t, this.range.start, this.range.end, opts);
    this.next = next;
    return next;
  }
}

/**
 * Class used by #markPixelsForLocalCoords to store relevant data for the pixel point.
 */
export class PixelMarker extends Marker {

  static calculateOptsFn(cache, coords ) {
    const width = cache.localFrame.width;
    return i => {
      const localX = coords[i];
      const localY = coords[i+1];
      const idx = (localY * width) + localX;
      const currPixel = cache.pixels[idx];
      return { localX, localY, currPixel };
    };
  }
}

// ----- NOTE: Helper functions ----- //

/**
 * Fix a number to 8 decimal places
 * @param {number} x    Number to fix
 * @returns {number}
 */
const POW10_8 = Math.pow(10, 8);
function fastFixed(x) { return Math.round(x * POW10_8) / POW10_8; }



/**
 * Add a new polygon point if not duplicate. 
 * Removes intermediate point if the last two points plus this one are collinear.
 * @param {PIXI.Polygon} poly			Polygon with at least 3 points.
 * @param {PIXI.Point} pt
 * @returns {PIXI.Polygon}
 */
function addPoint(poly, pt) {
  const iter = poly.reverseIteratePoints();
  using b = iter.next().value;
  if ( b.almostEqual(pt) ) return poly;
  
  // Note: Could compare deltas of a|b and b|c but that would only work for grids.
  using a = iter.next().value;
  if ( foundry.utils.orient2dFast(a, b, pt).almostEqual(0) ) {
    poly.points.pop();
    poly.points.pop();
  }
  poly.points.push(pt.x, pt.y);
  return poly;
}
