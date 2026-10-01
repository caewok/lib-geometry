/* globals
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { Polygon3d, Polygons3d } from "../3d/Polygon3d.js";
import { ModelMatrixAnchor } from "../ModelMatrix.js";
import { Point3d } from "../3d/Point3d.js";
import { GEOMETRY_LIB_ID } from "../const.js";
import { CutawayPolygon } from "../CutawayPolygon.js";

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

  get baseFace() { return this.faces[0]; }

  prototypeFacesOutward() { return true; } // Handled with facesOutward.

  facesOutward() {
    // Confirm the prototype face is oriented same as the original.
    const prototypeFace = this.prototypeFaces[0];
    const poly3d = this.baseFace;
    const ctr = poly3d.centroid.clone();
    ctr.z += 1;
    const protoCenter = Point3d.tmp.set(0, 0, 1); // 1 above the origin.
    return !(prototypeFace.isFacing(protoCenter) ^ poly3d.isFacing(ctr));
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end, { thickness = 1 } = {}) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end) ) return [];
    const polys = this.baseFace.polygons ?? [this.baseFace];
    const topZ = polys[0].points[0].z;
    const bottomZ = topZ - thickness;
    const opts = { topElevationFn: () => topZ, bottomElevationFn: () => bottomZ };
    const cutaways = polys.map(poly => poly.toPolygon2d().cutaway(start, end, opts));
    if ( cutaways.length < 2 ) return cutaways;
    return CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths.fromPolygons(cutaways)
      .union()
      .clean()
      .toPolygons()
      .map(p => CutawayPolygon.fromPolygon(p, start, end));
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
   * @param {PIXI.Polygon|PIXI.Circle|PIXI.Rectangle|PIXI.Ellipse} poly   Polygon to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @param {number} [opts.density]     Density when dealing with circles, ellipses
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygon(id, poly, opts = {}) {
    this._makeElevationFinite(opts);
    const top = Polygon3d.fromPIXIShape(poly, { elevationZ: opts.topZ });
    const faces = this._facesFromPolygon3d(top, opts.bottomZ, opts);
    const prototypeFaces = this.canvasToPrototypeFaces(faces, opts);
    return new this(id, prototypeFaces);
  }

  /**
   * Extrudes multiple polygons for a single shape, handles holes.
   * @param {string} id                 Identifier for this shape.
   * @param {(PIXI.Polygon|PIXI.Circle|PIXI.Rectangle|PIXI.Ellipse)[]} polys       2d polygons to use.
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
    for ( const poly of polys )  {
      const top = Polygon3d.fromPIXIShape(poly, { elevationZ: opts.topZ });
      const faces = this._facesFromPolygon3d(top, opts.bottomZ, opts)
      const prototypeFaces = this.canvasToPrototypeFaces(faces, opts);
      allProtoFaces.push(...prototypeFaces);
    }
    return new this(id, allProtoFaces);
  }

  get topFace() { return this.faces[1]; }

  get bottomFace() { return this.faces[0]; }

  get baseFace() { return this.faces[0]; }

  /**
   * Does this shape's XY dimensions potentially contain this canvas location?
   * Meant to be a relatively quick test. Should only reject if it is certain not to contain it.
   * @param {PIXI.Point} canvasLoc
   * @returns {boolean}
   */
  containsProjectedXY(canvasLoc) {
    return this.bottomFace.containsProjectedXY(canvasLoc);
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
   * Extrude a polygon 3d down, adding sides and a matching bottom.
   * Assumes that the top is parallel to XY plane.
   * @param {Polygon3d} top       The top shape
   * @param {number} bottomZ      The bottom elevation
   * @returns {Polygon3d[]}
   */
  static _facesFromPolygon3d(top, bottomZ, _opts) {
    const bottom = top.clone();
    bottom.setZ(bottomZ);
    bottom.reverseOrientation();

    const EPSILON = 1e-04; // Larger epsilon because these side will eventually be transformed to a smaller prototype.
    return [bottom, top, ...top.buildTopSides(bottomZ, EPSILON)];
  }

  /**
   * Determine all top, bottom, and mid corners along with midpoints between for the
   * hexagon cylinder.
   * @returns {object}
   */
  getInternalPoints() {
    return this.constructor.calculatePolygonCylinderInternalPoints(this.topFace, this.bottomFace);
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s).
   * @param {PIXI.Point} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point} end        Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end, { topZ, bottomZ } = {}) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end) ) return [];
    const { topFace, bottomFace } = this;

    // Because the bottom face is parallel to XY plane, we can just drop the Z axis.
    const poly = bottomFace.toPolygon2d();
    topZ ??= topFace.points[0].z;
    bottomZ ??= bottomFace.points[0].z;

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
    // For each face, moving opposite the normal should intersect an odd number of other faces.
    // (Draw line from face through the polygon, out the other side. Line should be moving into the polygon.)

    // While ExtrudedPolygonPrimitive should not have holes, its child class may.
    // Handle holes here to avoid duplicating the code. Performance hit can be avoided by turning off validation except for debugging.

    // Could test top and bottom using the centroid, but not guaranteed to have top at 0 and bottom at 1.
    // Simpler to test all faces using shoelace.
    for ( let i = 0, n = faces.length; i < n; i += 1 ) {
      const face = faces[i];
      if ( !this.constructor.testFaceOrientation(face, faces) ) return false;
    }
    return true;
  }
}

export class ExtrudedPolygonPrimitiveWithHoles extends ExtrudedPolygonPrimitive {

  /**
   * Extrudes polygons for a single island (one solid + its holes).
   * @param {string} id                 Identifier for this shape.
   * @param {(PIXI.Polygon|PIXI.Circle|PIXI.Rectangle|PIXI.Ellipse)[]} solids        Solid 2d polygon to use
   * @param {(PIXI.Polygon|PIXI.Circle|PIXI.Rectangle|PIXI.Ellipse)[]} holes      2d polygon holes to use
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @param {number} [opts.density]     Density when dealing with circles, ellipses
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygons() {
    console.error("ExtrudedPolygonPrimitiveWithHoles#fromPolygons is not implemented. Use only 1 solid per extruded shape.");
  }

  /**
   * Extrudes polygons for a single island (one solid + its holes).
   * @param {string} id           Identifier for this shape.
   * @param {PIXI.Polygon|PIXI.Circle|PIXI.Rectangle|PIXI.Ellipse} solid   Polygon to use.
   * @param {(PIXI.Polygon|PIXI.Circle|PIXI.Rectangle|PIXI.Ellipse)[]} holes      2d polygon holes to use
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygon(id, solid, holes = [], opts) {
    if ( !holes.length ) return super.fromPolygon(id, poly, opts);
    this._makeElevationFinite(opts);

    const top = new Polygons3d();
    top.polygons.push(Polygon3d.fromPIXIShape(solid, { elevationZ: opts.topZ, isHole: false }));
    top.polygons.push(...holes.map(hole => Polygon3d.fromPIXIShape(hole, { elevationZ: opts.topZ, isHole: true })));
    const faces = this._facesFromPolygon3d(top, opts.bottomZ, opts);
    const allProtoFaces = this.canvasToPrototypeFaces(faces, opts);
    return new this(id, allProtoFaces);
  }

  /**
   * Cuts the extruded polygon with a vertical plane and returns 2D rectangular cross-sections.
   * @param {PIXI.Point|Point3d} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point|Point3d} end       Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]} Array of CutawayPolygon cross-sections (solids and holes)   */
  verticalSlice(start, end, { topZ, bottomZ } = {}) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end) ) return [];

    // Construct the 2d cutaway polygons, accounting for holes.
    const { topFace, bottomFace } = this;
    if ( !bottomFace.polygons ) return super.verticalSlice(start, end, { topZ, bottomZ });

    // Determine top and bottom elevations.
    topZ ??= topFace.points[0].z;
    bottomZ ??= bottomFace.points[0].z;
    const opts = {
      topElevationFn: () => topZ,
      bottomElevationFn: () => bottomZ,
    };

    // Because the bottom face is parallel to XY plane, we can just drop the Z axis.
    const cutaways = [];
    for ( const poly of this.bottomFace.polygons ) {
      const poly2d = poly.toPolygon2d().cutaway(start, end, opts);
      if ( poly2d ) cutaways.push(...poly2d);
    }
    if ( !cutaways.length ) return [];

    // Use Clipper to union the cutaways. Holes go straight through, leaving 1+ solid polygons.
    // Must convert from distance squared to ensure correct intersections of any diagonals.
    // For this basic ExtrudedPolygonPrimitiveWithHoles, no diagonals should exist.
    // (Flat top + flat bottom + vertical sides ==> rectangle cutaways)
    const paths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths.fromPolygons(cutaways);
    const out = paths
      .union()
      .clean()
      .toPolygons();

    return out.map(poly => CutawayPolygon.fromPolygon(poly, start, end));
  }


}
