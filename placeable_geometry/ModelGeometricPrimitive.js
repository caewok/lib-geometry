/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";
import { Polygon3d  } from "../3d/Polygon3d.js";
import { ModelMatrixAnchor } from "../ModelMatrix.js";
import { Point3d } from "../3d/Point3d.js";

/**
 * ModelGeometricPrimitives are one-offs.
 * They are not updated; instead they would get destroyed and rebuilt.
 * To facilitate re-use, the prototype faces can be provided or
 * calculated using canvasToPrototypeFaces. Then the model matrix can modify the resulting faces.
 */
export class ModelGeometricPrimitive extends GeometricPrimitive {

  constructor(id, prototypeFaces) {
    super(id);
    this._prototypeFaces = prototypeFaces;
    this._initializeFaces();
  }


  // ----- NOTE: Faces ----- //

  /** @type {Polygon3d[]} */
  _prototypeFaces = [];

  get prototypeFaces() { return this._prototypeFaces ?? []; } // Needed for constructor, when _prototypeFaces not yet initialized but this getter is.

  /**
   * @param {Polygon3d[]} faces
   * @param {object} [opts]                   Parameters used to translate canvas faces back to prototype
   * @param {Point3d} [opts.center]
   * @param {Point3d} [opts.dims]
   * @param {Point3d} [opts.angles]
   * @param {Point3d} [opts.anchors]
   * @returns {Polygon3d} Prototype faces, which may be same as faces.
   */
  static canvasToPrototypeFaces(faces, { center, dims, angles, anchors } = {}) {
    // Default approach is that the faces equal the prototype faces; model matrix is identity.
    if ( !(center || dims || angles || anchors ) ) return faces;

    // Build a model matrix.
    const modelMatrix = new ModelMatrixAnchor();
    if ( center ) modelMatrix.translation = center;
    if ( angles ) modelMatrix.rotation = angles;
    if ( dims ) modelMatrix.scale = dims;
    if ( anchors ) modelMatrix.anchor = anchors;

    // Invert the model matrix to construct prototype faces.
    // Use the inverse to construct the prototype faces.
    const invM = modelMatrix.model.invert();
    return faces.map(face => face.transform(invM));
  }

  // ----- NOTE: Vertices ----- //

  static instanceVO = null;

  /** @type {VertexObject} */
  instanceVO = new VertexObject();

}

/**
 * Planar polygon. Use for some polygon alpha shapes.
 */
export class PlanarPolygonPrimitive extends ModelGeometricPrimitive {

  /**
   * Force the face to face outward from a given point.
   * @param {Polygon3d[]} faces
   * @param {Point3d} center
   * @returns {Polygon3d[]} The faces, modified in place
   */
  static _faceUp(face) {
    using ctr = face.center.clone();
    ctr.z -= 1;
    if ( face.isFacing(ctr) ) face.reverseOrientation();
    return face;
  }

  /**
   * Build a shape from a 3d polygon.
   * @param {string} id           Identifier for this shape
   * @param {Polygon3d} poly3d    3d planar polygon to use
   * @param {object} [opts]                   Parameters used to translate canvas faces back to prototype
   * @param {Point3d} [opts.center]
   * @param {Point3d} [opts.dims]
   * @param {Point3d} [opts.angles]
   * @param {Point3d} [opts.anchors]
   * @returns {PlanarPolygonPrimitive}
   */
  static fromPolygon3d(id, poly3d, opts) {
    const prototypeFace = this.canvasToPrototypeFaces([poly3d], opts)[0];

    // Confirm the prototype faces are oriented same as the original.
    const ctr = opts.center.clone() || poly3d.center.clone();
    ctr.z += 1
    const protoCenter = Point3d.tmp.set(0, 0, 1); // 1 above the origin.
    if ( prototypeFace.plane.whichSide(protoCenter) !== poly3d.plane.whichSide(ctr) ) prototypeFace.reverseOrientation();
    return new this(id, [prototypeFace]);
  }

  /**
   * Update the faces for this primitive.
   * Default is to use the model matrix.
   * Confirms orientation, which the more complex model matrices can screw up (apparently).
   * @param {Polygon3d[]} faces
   */
  _generateFaces(faces) {
    // Ensure the model faces face the correct direction.
    super._generateFaces(faces);
    const center = this.center.clone();
    center.z += 1;
    if ( this.prototypeFaces[0].plane.whichSide(center) !== faces[0].plane.whichSide(center) ) faces[0].reverseOrientation();
  }
}

/**
 * Extruded polygon primitive.
 * A 2d planar polygon parallel to the XY axis is extruded along the z axis, with vertical sides.
 * Typical for regions.
 */
export class ExtrudedPolygonPrimitive extends ModelGeometricPrimitive {

  // ----- NOTE: Factory functions ----- //

  /**
   * Force each face to face outward from a given point.
   * @param {Polygon3d[]} faces
   * @param {Point3d} center
   * @returns {Polygon3d[]} The faces, modified in place
   */
  static _faceOutwards(faces, center) {
    for ( const face of faces ) {
      if ( face.isFacing(center) ) face.reverseOrientation();
    }
    return faces;
  }

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
    const prototypeFaces = this.canvasToPrototypeFaces(faces, opts);

    // Ensure the prototype faces are facing outward from the origin.
    using origin = Point3d.tmp.set(0, 0, 0);
    for ( const face of prototypeFaces ) {
      if ( face.isFacing(origin) ) face.reverseOrientation();
    }
    return new this(id, prototypeFaces);
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
    const prototypeFaces = this.canvasToPrototypeFaces(faces, opts);

    // Ensure the prototype faces are facing outward from the origin.
    using origin = Point3d.tmp.set(0, 0, 0);
    this._faceOutwards(prototypeFaces, origin);
    return new this(id, prototypeFaces);
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
   * Update the faces for this primitive.
   * Default is to use the model matrix.
   * @param {Polygon3d[]} faces
   */
  _generateFaces(faces) {
    super._generateFaces(faces);
    this.constructor._faceOutwards(faces, this.center);
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

