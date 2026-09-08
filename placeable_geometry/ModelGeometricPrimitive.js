/* globals
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { VertexObject } from "../placeable_vertices/VertexObject.js";
import { Polygon3d, Triangle3d, Circle3d, Ellipse3d, Quad3d, Polygons3d } from "../3d/Polygon3d.js";
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
  }

  /**
   * Destroy this geometric primitive, releasing associated memory in buffers.
   */
  destroy() {
    this.prototypeFaces.forEach(face => face.release());
    this.prototypeFaces.length = 0;
    super.destroy();
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
  static canvasToPrototypeFaces(faces, opts) {
    // Default approach is that the faces equal the prototype faces; model matrix is identity.
    if ( !(opts.center || opts.dims || opts.angles || opts.anchors ) ) return faces;

    // Build a matrix to transform each face;
    const M = this.toPrototypeModel(opts);
    const invTransposeM = M.invert().transpose();
    return faces.map(face => face.transform(M, undefined, invTransposeM));
  }

  /**
   * Build the model used to convert canvas faces to a prototype.
   * @param {object} [opts]                   Parameters used to translate canvas faces back to prototype
   * @param {Point3d} [opts.center]
   * @param {Point3d} [opts.dims]
   * @param {Point3d} [opts.angles]
   * @param {Point3d} [opts.anchors]
   * @returns {Matrix}
   */
  static toPrototypeModel({ center, dims, angles, anchors } = {}) {
    // Build a model matrix.
    const modelMatrix = ModelMatrixAnchor.create();
    if ( center ) modelMatrix.translation = center;
    if ( angles ) modelMatrix.rotation = angles;
    if ( dims ) modelMatrix.scale = dims;
    if ( anchors ) modelMatrix.anchor = anchors;

    // Invert the model matrix to construct prototype faces.
    // Use the inverse to construct the prototype faces.
    return modelMatrix.model.invert();
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
    return new this(id, [prototypeFace]);
  }

  prototypeFacesOutward() { return true; } // Handled with facesOutward.

  facesOutward() {
    // Confirm the prototype face is oriented same as the original.
    const prototypeFace = this.prototypeFaces[0];
    const poly3d = this.faces[0];
    const ctr = poly3d.centroid.clone();
    ctr.z += 1;
    const protoCenter = Point3d.tmp.set(0, 0, 1); // 1 above the origin.
    return !(prototypeFace.isFacing(protoCenter) ^ poly3d.isFacing(ctr));
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
   * Build an extruded (along the z-axis) shape from a 2d polygon.
   * @param {string} id           Identifier for this shape.
   * @param {PIXI.Polygon} poly   Polygon to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @param {number} [opts.density]     Density when dealing with circles, ellipses
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygon(id, poly, opts = {}) {
    this._makeElevationFinite(opts);
    const faces = this._facesFromPolygon(poly, opts);
    const prototypeFaces = this.canvasToPrototypeFaces(faces, opts);
    return new this(id, prototypeFaces);
  }

  /**
   * Extrudes multiple polygons for a single shape, handles holes.
   * @param {string} id                 Identifier for this shape.
   * @param {PIXI.Polygon[]} polys       2d polygons to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @param {number} [opts.density]     Density when dealing with circles, ellipses
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygons(id, polys, opts = {}) {
    if ( polys.length === 1 ) return this.fromPolygon(id, polys[0], opts);
    this._makeElevationFinite(opts);
    const allProtoFaces = [];

    // Construct extruded 3d shape for each polygon in turn.
    for ( const poly of polys )  {
      const faces = this._facesFromPolygon(poly, opts);
      const prototypeFaces = this.canvasToPrototypeFaces(faces, opts);
      allProtoFaces.push(...prototypeFaces);
    }
    return new this(id, allProtoFaces);
  }


  // ----- NOTE: Factory helpers to construct faces ----- //

  /**
   * Make elevation top and bottom options finite.
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @returns {object} The options, modified in place if present already
   */
  static _makeElevationFinite(opts = {}) {
    opts.topZ ??= Number.POSITIVE_INFINITY;
    opts.bottomZ ??= Number.NEGATIVE_INFINITY;
    if ( !isFinite(opts.topZ) ) opts.topZ = 1e06;
    if ( !isFinite(opts.bottomZ) ) opts.bottomZ = -1e06;
    return opts;
  }
  /**
   * Helper to create a 3d extruded shape from a polygon, with a top and bottom polygon
   * shapes and vertical sides.
   * @param {PIXI.Polygon} poly       Polygon shape to use for top and bottom faces.
   * @param {number} topZ             The top elevation
   * @param {number} bottomZ          The bottom elevation
   * @returns {Polygon3d[]} Array of top, bottom, and 3+ sides.
   */
  static _facesFromPolygon(poly, { topZ, bottomZ } = {}) {
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

   // ----- NOTE: Debug ----- //

  _testFacesOutward(faces) {
    if ( !faces || faces.length < 3 ) return false;

    // Must account for concave polygons, where the face could be facing opposite a centroid.
    // Get the 2d polygon of the shape. For each face, move slightly along the normal and check
    // if the point is contained by the polygon. If it is, the normal is facing the wrong way.

    // By default, the first face is the top, second is the bottom. See _facesFromPolygon3d.
    const centroid = this.constructor.calculateCentroid(faces);
    const iter = faces.values();
    const top = iter.next().value;
    if ( top.isFacing(centroid) ) return false;

    const bottom = iter.next().value;
    if ( bottom.isFacing(centroid) ) return false;

    // Check each side face, testing containment using the bottom polygon.
    const to2dM = bottom.plane.conversion2dMatrix;
    const poly2d = bottom.toPolygon2d();
    using testPt3d = Point3d.tmp;
    for ( const face of iter ) {
      face.points[0].add(face.plane.normal, testPt3d);
      to2dM.multiplyPoint3d(testPt3d, testPt3d);
      if ( poly2d.contains(testPt3d.x, testPt3d.y) ) return false;
    }
    return true;
  }
}

/**
 * Extruded triangle primitive.
 * A 2d planar triangle parallel to the XY axis is extruded along the z axis, with vertical sides.
 * Typical for a cone region.
 */
export class ExtrudedTrianglePrimitive extends ExtrudedPolygonPrimitive {

  /**
   * Build an extruded (along the z-axis) shape from a 2d polygon.
   * @param {string} id           Identifier for this shape.
   * @param {PIXI.Point} a        First point of triangle
   * @param {PIXI.Point} b        Second point of triangle
   * @param {PIXI.Point} c        Third point of triangle
   * @param {object} [opts]       See fromPolygon method.
   * @returns {ExtrudedTrianglePrimitive}
   */
  static fromTriangle(id, a, b, c, opts) {
    const poly = new PIXI.Polygon(a, b, c);
    return this.fromPolygon(id, poly, opts);
  }


  /**
   * Helper to create a 3d extruded shape from a triangle polygon, with a top and bottom polygon
   * shapes and vertical sides.
   * @param {PIXI.Polygon} poly       Polygon shape to use for top and bottom faces.
   * @param {number} topZ             The top elevation
   * @param {number} bottomZ          The bottom elevation
   * @returns {Polygon3d[]} Array of top, bottom, and 3+ sides.
   */
  static _facesFromPolygon(tri, { topZ, bottomZ } = {}) {
    const top = Triangle3d.fromPolygon(tri, topZ);
    return this._facesFromPolygon3d(top, bottomZ);
  }
}
