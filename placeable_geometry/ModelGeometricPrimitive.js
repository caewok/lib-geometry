/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";
import { Polygon3d  } from "../3d/Polygon3d.js";
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

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    const top = this.faces[0];
    const bottom = this.faces[1];
    const poly = top.toPlanarPolygon();
    const topZ = top.points[0].z;
    const bottomZ = bottom.points[0].z;

    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };
    return poly.cutaway(start, end, opts);
  }
}

