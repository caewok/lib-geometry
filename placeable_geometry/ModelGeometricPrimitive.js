/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";
import { Point3d } from "../3d/Point3d.js";
import { Polygon3d, Quad3d  } from "../3d/Polygon3d.js";
import { AABB2d } from "../AABB.js";
import { ModelMatrixAnchor } from "../ModelMatrix.js";

/**
 * ModelGeometricPrimitives are one-offs.
 * They are not updated; instead they would get destroyed and rebuilt.
 * To facilitate re-use, the prototype faces can be provided or
 * calculated using fromCanvasFaces. Then the model matrix can modify the resulting faces.
 */
export class ModelGeometricPrimitive extends GeometricPrimitive {

  constructor(id, prototypeFaces) {
    super(id);
    this.prototypeFaces = prototypeFaces;
  }

  // ----- NOTE: Factory functions ----- //

  static fromCanvasFaces(id, faces, { center, dims, angles, anchors } = {}) {
    // Default approach is that the faces equal the prototype faces; model matrix is identity.
    if ( !(center || dims || angles || anchors ) ) return new this(id, faces);

    // Build a model matrix.
    const modelMatrix = new ModelMatrixAnchor();
    if ( center ) modelMatrix.translation = center;
    if ( angles ) modelMatrix.rotation = angles;
    if ( dims ) modelMatrix.scale = dims;
    if ( anchors ) modelMatrix.anchor = anchors;

    // Invert the model matrix to construct prototype faces.
    // Use the inverse to construct the prototype faces.
    const invM = modelMatrix.model.invert();
    const prototypeFaces = faces.map(face => face.transform(invM));
    return new this(id, prototypeFaces);
  }

  // ----- NOTE: Faces ----- //

  /** @type {Polygon3d[]} */
  #prototypeFaces = [];

  get prototypeFaces() { return this.#prototypeFaces; }

  set prototypeFaces(value) {
    if ( !Array.isArray(value) ) value = [value];
    this.#prototypeFaces.length = 0;
    this.#prototypeFaces.push(...value);
    this.dirty = this.constructor.DIRTY.ALL;
  }

  // ----- NOTE: Vertices ----- //

  static instanceVO = null;

  /** @type {VertexObject} */
  instanceVO = new VertexObject();

  /** @type {VertexObject} */
  #modelVO = new VertexObject();

  get modelVO() {
    if ( this.isDirty(this.constructor.VERTICES) ) this.updateModelVO();
    return this.#modelVO;
  }

  /**
   * Update this geom's instance vertices.
   * @param {Float32Array[]} [vertices]       Vertices, including normals.
   */
  updateInstanceVertices(vertices) {
    // Add vertices from faces or from vertex array.
    const vo = this.instanceVO;
    vertices ??= this.constructor.verticesFromFaces(this.prototypeFaces, true);
    vo.hasNormals = true;
    vo.hasUVs = false;
    this.constructor.updateVertexObject(vo, vertices);
    this.dirty = this.constructor.DIRTY.VERTICES;
  }

  /**
   * Defaults to using the model faces to construct the vertices.
   */
  updateModelVO(vertices) {
    vertices ??= this.constructor.verticesFromFaces(this.faces, true);
    const vo = this.modelVO ;
    vo.hasNormals = true;
    vo.hasUVs = false;
    this.constructor.updateVertexObject(vo, vertices);
    this.constructor.viTracker.updateFacet({ id: this.id, newVertices: vo.vertices, newIndices: vo.indices });
    this._clearDirty(this.constructor.VERTICES);
  }
}

/**
 * Planar polygon. Use for some polygon alpha shapes.
 */
export class PlanarPolygonPrimitive extends ModelGeometricPrimitive {

  /**
   * Build a shape from a 3d polygon.
   * @param {string} id           Identifier for this shape
   * @param {Polygon3d} poly3d    3d planar polygon to use
   * @returns {PlanarPolygonPrimitive}
   */
  static fromPolygon3d(id, poly3d, opts) { return this.fromCanvasFaces(id, [poly3d], opts); }
}

/**
 * Extruded polygon primitive.
 * A 2d planar polygon parallel to the XY axis is extruded along the z axis, with vertical sides.
 * Typical for regions.
 */
export class ExtrudedPolygonPrimitive extends ModelGeometricPrimitive {

  // ----- NOTE: Factory functions ----- //

  /**
   * Build an extruded (along the z-axis) shape from a 2d polygon.
   * @param {string} id           Identifier for this shape.
   * @param {PIXI.Polygon} poly   Polygon to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygon(id, poly, { topZ = Number.POSITIVE_INFINITY, bottomZ = Number.NEGATIVE_INFINITY, ...opts } = {}) {
    if ( !isFinite(topZ) ) topZ = 1e06;
    if ( !isFinite(bottomZ) ) bottomZ = -1e06;
    const faces = this.#facesFromPolygon(poly, topZ, bottomZ);
    return this.fromCanvasFaces(id, faces, opts);
  }

  /**
   * Extrudes multiple polygons for a single shape, handles holes.
   * @param {string} id                 Identifier for this shape.
   * @param {PIXI.Polygon[]} poly       2d polygons to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygons(id, polys, { topZ = Number.POSITIVE_INFINITY, bottomZ = Number.NEGATIVE_INFINITY, ...opts } = {}) {
    if ( polys.length === 1 ) return this.fromPolygon(id, polys[0], { topZ, bottomZ, ...opts });
    if ( !isFinite(topZ) ) topZ = 1e06;
    if ( !isFinite(bottomZ) ) bottomZ = -1e06;
    const faces = [];
    for ( const poly of polys ) faces.push(...this.#facesFromPolygon(poly, topZ, bottomZ));
    return this.fromCanvasFaces(id, faces, opts);
  }

  // ----- NOTE: Factory helpers to construct faces ----- //

  /**
   * Helper to create a 3d extruded shape from a polygon, with a top and bottom polygon
   * shapes and vertical sides.
   * @param {PIXI.Polygon} poly       Polygon shape to use for top and bottom faces.
   * @param {number} topZ             The top elevation
   * @param {number} bottomZ          The bottom elevation
   * @returns {Polygon3d[]} Array of top, bottom, and 1+ sides.
   */
  static #facesFromPolygon(poly, topZ, bottomZ) {
    const top = Polygon3d.fromPolygon(poly, topZ);
    return this._facesFromPolygon3d(top, bottomZ);
  }

  /**
   * Extrude a polygon 3d down, adding sides and a matching bottom.
   * Assumes that the top is parallel to XY plane.
   * @param {Polygon3d} top       The top shape
   * @param {number} bottomZ      The bottom elevation
   * @returns {Polygon3d[]}
   */
  static _facesFromPolygon3d(top, bottomZ) {
    const bottom = top.clone();
    bottom.setZ(bottomZ);
    bottom.reverseOrientation();
    return [top, bottom, ...top.buildTopSides(bottomZ)];
  }

  /**
   * Determine all top, bottom, and mid corners along with midpoints between for the
   * hexagon cylinder.
   * @returns {object}
   */
  getInternalPoints() {
    const top = this.faces[0];
    const bottom = this.faces[1];
    return this.constructor.calculatePolygonCylinderInternalPoints(top, bottom);
  }
}



/**
 * Steps. Closely related to ramps.
 * Use the model primitive b/c as number of steps change, so does the shape.
 */
export class StepsPrimitive extends ModelGeometricPrimitive {

  /**
   * Construct steps from provided dimensions.
   * @param {object} [opts]
   * @param {number} [opts.numSteps]
   * @param {number} [opts.stepSize]
   * @param {number} [opts.rampWidth]
   * @param {number} [opts.rampZHeight]
   * @param {Point3d} [opts.rampStart]
   * @param {Point3d} [opts.rampEnd]
   */
  /*
  static fromDimensions({ numSteps, stepSize, rampWidth, rampZHeight, rampStart, rampEnd, startZ, endZ } = {}) {
    if ( !((rampWidth && rampZHeight)
        || (rampStart && rampEnd)) ) throw Error("StepsPrimitive.fromDimensions|Either start/end or width and height must be provided.");


  }
  */

  /*
  static rectangularBaseSteps() {



  }
  */

  /*
  static polygonBaseSteps() {}
  */

  /**
   * @param {object} [opts]
   * @param {Point3d} [opts.baseTL]        The TL of the rectangular base of the steps.
   * @param {number} [opts.baseWidth]       Width of the base (x-axis)
   * @param {number} [opts.baseLength]      Length of the base (y-axis)
   * @param {number} [opts.totalHeight]     Overall vertical height (z-axis)
   * @param {number} [opts.numSteps=1]          The number of steps to include
   * @returns {Polygon3d|Quad3d[]} The faces
   */
  /*
  static _createStepFaces({ baseTL, baseWidth, baseLength, totalHeight, numSteps = 1 } = {}) {

  }
  */

  static _createUnitSteps(numSteps) {
    const faces = [];

    // Unit shape spans from -0.5 to 0.5.
    const min = 0.5;
    const max = 0.5;

    // Step dimensions are easy.
    const stepDepth = 1.0 / numSteps;
    const stepHeight = 1.0 / numSteps;

    using a = Point3d.tmp;
    using b = Point3d.tmp;
    using c = Point3d.tmp;
    using d = Point3d.tmp;

    // Base quad (parallel to XY plane).
    faces.push(Quad3d.from4Points(
      a.set(min, min, min),
      b.set(max, min, min),
      c.set(max, max, min),
      d.set(min, max, min),
    ));

    // Back quad (perpendicular to XY plane).
    faces.push(Quad3d.from4Points(
      a.set(min, max, min),
      b.set(max, max, min),
      c.set(max, max, max),
      d.set(min, max, max),
    ));

    // Arrays to collect perimeter points for the left and right side polygons.
    const leftSidePoints = [Point3d.tmp.set(min, min, min)];
    const rightSidePoints = [Point3d.tmp.set(max, min, min)];
    for ( let i = 0; i < numSteps; i += 1 ) {
      const currentY = min + (i * stepDepth);
      const nextY = min + ((i + 1) * stepDepth);
      const currentZ = min + (i * stepHeight);
      const nextZ = min + ((i + 1) * stepHeight);

      // Vertical plank/riser (perpendicular to XY plane)
      faces.push(Quad3d.from4Points(
        a.set(min, currentY, currentZ),
        b.set(max, currentY, currentZ),
        c.set(max, currentY, nextZ),
        d.set(min, currentY, nextZ),
      ));

      // Horizontal plank/tread (parallel to XY plane)
      faces.push(Quad3d.from4Points(
        a.set(min, currentY, nextZ),
        b.set(max, currentY, nextZ),
        c.set(max, nextY, nextZ),
        d.set(min, nextY, nextZ),
      ));

      // Map side profile points.
      // Up the riser...
      leftSidePoints.push(Point3d.tmp.set(min, currentY, nextZ));
      rightSidePoints.push(Point3d.tmp.set(max, currentY, nextZ));

      // ...and back across the tread.
      leftSidePoints.push(Point3d.tmp.set(min, nextY, nextZ));
      rightSidePoints.push(Point3d.tmp.set(max, nextY, nextZ));
    }

    // Close the side polygons by adding the bottom-back corners.
    leftSidePoints.push(Point3d.tmp.set(min, max, min));
    rightSidePoints.push(Point3d.tmp.set(max, max, min));

    // Side polygons.
    faces.push(
      Polygon3d.from3dPoints(leftSidePoints),
      Polygon3d.from3dPoints(rightSidePoints),
    )
    leftSidePoints.forEach(pt => pt.release());
    rightSidePoints.forEach(pt => pt.release());

    return faces;
  }

  /**
   * Create steps with a base polygon.
   * Stairs ascend along the y-axis (minY to maxY, or south); rotate the polygon accordingly.
   * @param {PIXI.Polygon} poly         The base shape, rotated so that the steps rise to the south
   * @param {number} totalHeight        Total height in pixels
   * @param {number} numSteps           Number of steps
   * @param {number} [bottomZ=0]        Elevation of the base
   * @returns {Quad3d|Polygon3d[]}
   */
  static _createPolygonSteps(basePoly, totalHeight, numSteps = 1, bottomZ = 0) {
    const faces = [];

    // Find the bounding box to determine start/end of stairs.
    using aabb = AABB2d.fromPolygon(basePoly);
    const stepDepth = (aabb.max - aabb.min) / numSteps;
    const stepHeight = totalHeight / numSteps;
    const minY = aabb.min.y;
    const maxY = aabb.max.y;
    const minZ = bottomZ;
    const maxZ = minZ + totalHeight;

    using a = Point3d.tmp;
    using b = Point3d.tmp;
    using c = Point3d.tmp;
    using d = Point3d.tmp;

    // Base polygon (footprint at base z)
    faces.push(Polygon3d.from2dPolygon(basePoly, bottomZ));

    // TODO: Implement slice, intersection lines, perimeter segments
    /**
     * Slicing an N-sided polygon requires boolean clipping (e.g., Sutherland-Hodgman).
     * slicePolygon(polygon, startY, endY) -> returns an array of Points for the enclosed area.
     * getIntersectionLines(polygon, Y) -> returns array of line segments where the polygon crosses Y.
     * getPerimeterSegments(polygon, startY, endY) -> returns the outer boundary line segments.
     */

    // Generate steps via polygon slicing
    for ( let i = 0; i < numSteps; i += 1 ) {
      const currentY = minY + (i * stepDepth);
      const nextY = minY + ((i + 1) * stepDepth);
      const currentZ = minZ + (i * stepHeight);
      const nextZ = minZ + ((i + 1) * stepHeight);

      // Tread (parallel to XY plane at nextZ).
      const treadPoints2d = basePoly.slice(currentY, nextY);
      if ( treadPoints2d.length >= 3 ) faces.push(Polygon3d.from2dPoints(treadPoints2d, nextZ));

      // Riser (perpendicular to XY plane at currentY).
      // Find the horizontal line segment(s) where the step begins.
      const riserSegments2d = basePoly.getIntersectionLines(currentY);
      riserSegments2d.forEach(segment => faces.push(Quad3d.from4Points(
        a.set(segment.startX, currentY, currentZ),
        b.set(segment.endX, currentY, currentZ),
        c.set(segment.endX, currentY, nextZ),
        d.set(segment.startX, currentY, nextZ),
      )));

      // Sides (following the perimeter of the base).
      // Extrude the outer boundary edges of the polygon downward to enclose the stairs.
      const sideSegments2d = basePoly.getPerimeterSegments(currentY, nextY);
      sideSegments2d.forEach(segment => faces.push(Quad3d.from4Points(
        a.set(segment.startX, segment.startY, minZ),
        b.set(segment.endX, segment.endY, minZ),
        c.set(segment.endX, segment.endY, nextZ),
        d.set(segment.startX, segment.startY, nextZ),
      )));
    }

    // Back (perpendicular to XY plane at maxY)
    const backSegments2d = basePoly.getIntersectionLines(maxY);
    backSegments2d.forEach(segment => faces.push(Quad3d.from4Points(
      a.set(segment.startX, maxY, minZ),
      b.set(segment.endX, maxY, minZ),
      c.set(segment.endX, maxY, maxZ),
      d.set(segment.startX, maxY, maxZ),
    )));

    return faces;
  }
}



/**
 * Curve.
 * Estimate surface points lattice. Delaunay triangulation.
 */

