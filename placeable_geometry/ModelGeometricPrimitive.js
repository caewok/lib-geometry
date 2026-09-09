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
   * @param {number} [opts.density]     Density when dealing with circles, ellipses
   * @returns {Polygon3d[]} Array of top, bottom, and 3+ sides.
   */
  static _facesFromPolygon(poly, { topZ, bottomZ, ...opts } = {}) {
    let top;
    if ( poly instanceof PIXI.Circle ) top = Circle3d.fromCircle(poly, topZ);
    else if ( poly instanceof PIXI.Ellipse ) top = Ellipse3d.fromEllipse(poly, topZ);
    else if ( poly instanceof PIXI.Rectangle ) top = Quad3d.fromRectangle(poly, topZ);
    else if ( poly.points.length === 6 ) top =  Triangle3d.fromPolygon(poly, opts.topZ);
    else if ( poly.points.lenght === 8 ) top =  Quad3d.fromPolygon(poly, opts, topZ);
    else top = Polygon3d.fromPolygon(poly, topZ);

    return this._facesFromPolygon3d(top, bottomZ, opts);
  }

  /**
   * Extrude a polygon 3d down, adding sides and a matching bottom.
   * Assumes that the top is parallel to XY plane.
   * @param {Polygon3d} top       The top shape
   * @param {number} bottomZ      The bottom elevation
   * @returns {Polygon3d[]}
   */
  static _facesFromPolygon3d(top, bottomZ, opts) {
    const bottom = top.clone();
    bottom.setZ(bottomZ);
    bottom.reverseOrientation();
    return [top, bottom, ...top.buildTopSides(bottomZ, opts)];
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
    // For each face, moving opposite the normal should intersect an odd number of other faces.
    // (Draw line from face through the polygon, out the other side.)

    // By default, the first face is the top, second is the bottom. See _facesFromPolygon3d.
    // Top and bottom can still use the centroid.
    const centroid = this.constructor.calculateCentroid(faces);
    const iter = faces.values();
    const top = iter.next().value;
    if ( top.isFacing(centroid) ) return false;

    const bottom = iter.next().value;
    if ( bottom.isFacing(centroid) ) return false;

    // Check each side face
    using dir = Point3d.tmp;
    const isEven = (num) => (num & 1) === 0;
    for ( const face of iter ) {
      const origin = face.centroid;
      face.plane.normal.multiplyScalar(-1, dir);
      let numIx = 0;
      for ( const otherFace of faces ) {
        if ( otherFace === face ) continue;
        numIx += Boolean(otherFace.intersection(origin, dir, { maxT: Number.POSITIVE_INFINITY, holesBlock: true }));
      }
      if ( isEven(numIx) ) return false;
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

export class ExtrudedPolygonPrimitiveWithHoles extends ExtrudedPolygonPrimitive {

  /**
   * Build an extruded (along the z-axis) shape from a 2d polygon.
   * @param {string} id           Identifier for this shape.
   * @param {PIXI.Polygon} poly   Polygon to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygon(id, poly, opts) { return ExtrudedPolygonPrimitive.fromPolygon(id, poly, opts); }

  /**
   * Extrudes multiple polygons for a single shape, handles holes.
   * @param {string} id                 Identifier for this shape.
   * @param {PIXI.Polygon[]} polys      2d polygons to use.
   * @param {object} [opts]
   * @param {number} [opts.topZ]        Top elevation
   * @param {number} [opts.bottomZ]     Bottom elevation
   * @param {number} [opts.density]     Density when dealing with circles, ellipses
   * @returns {ExtrudedPolygonPrimitive}
   */
  static fromPolygons(id, polys, opts = {}) {
    if ( polys.length === 1 ) return super.fromPolygon(id, polys[0], opts);
    const isHole = poly => poly.isHole ?? !poly.isPositive;
    if ( !polys.some(isHole) ) return super.fromPolygons(id, polys, opts);
    this._makeElevationFinite(opts);

    const islands = this._buildIslands(polys);

    const allProtoFaces = [];
    for ( const { solid, holes } of islands ) {
      const top = Polygons3d.fromPolygons([solid, ...holes], opts.topZ);
      const faces = this._facesFromPolygon3d(top, opts.bottomZ, opts);
      allProtoFaces.push(...this.canvasToPrototypeFaces(faces, opts));
    }
    return new this(id, allProtoFaces);
  }

  /**
   * From 3d polygons, construct a recursive tree of solid + holes
   * A root solid pairs with its direct hole children only.
   * Each o those holes' direct solid children become new island roots one level down.
   * @param {PIXI.Polygon[]} rings
   * @returns {object[]}
   * - @prop {PIXI.Polygon} solid
   * - @prop {PIXI.Polygon[]} holes
   */
  static _buildIslands(rings) {
    const parent = this._buildRingParents(rings);
    const children = rings.map(() => []);
    parent.forEach((p, i) => {
      if ( p !== null ) children[p].push(i);
    });

    const islands = []; // { solid: Polygon3d, holes: Polygon3d[] }

    function processSolid(solidIdx) {
      const holeIdxs = children[solidIdx].filter(c => rings[c].isHole);
      islands.push({ solid: rings[solidIdx], holes: holeIdxs.map(h => rings[h]) });

      // Recurse: Any solid ring nested inside one of these holes starts a new island.
      for ( const holeIdx of holeIdxs ) children[holeIdx]
        .filter(c => !rings[c].isHole)
        .forEach(processSolid);
    }

    rings.forEach((ring, i) => {
      if ( !ring.isHole && parent[i] === null ) processSolid(i);
    });

    return islands;
  }

  /**
   * Find each ring's immediate parent: the smallest other ring (solid or hole)
   * that contains it. Assumes clean, non-self-intersecting rings that are either
   * disjoint or fully nested (true for Clipper-cleaned region shapes).
   * @param {PIXI.Polygon[]} rings
   * @returns {number[]} Index of parent polygon for each ring
   */
  static _buildRingParents(planarRings) {
    const areas = planarRings.map(r => Math.abs(r.signedArea()));
    const testPoints = planarRings.map(r => r.interiorPoint());
    return planarRings.map((ring, i) => {
      let parent = null;
      let parentArea = Number.POSITIVE_INFINITY;
      for ( let j = 0, n = planarRings.length; j < n; j += 1 ) {
        if ( i === j || areas[j] >= parentArea ) continue;
        if ( planarRings[j].contains(testPoints[i].x, testPoints[i].y) ) {
          parent = j;
          parentArea = areas[j];
        }
      }
      return parent;
    });
  }

  // ----- NOTE: Face creation ----- //

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

    // After updating the faces, also transform the _refCentroid, if any.

    // Build a matrix to transform each face;
    const M = this.toPrototypeModel(opts);
    const protoFaces = super.canvasToPrototypeFaces(faces, opts);
    const numSides = protoFaces.length;
    for ( let i = 0; i < numSides; i += 1 ) {
      const protoFace = protoFaces[i];
      const face = faces[i];
      M.multiplyPoint3d(face._refCentroid, protoFace._refCentroid);
    }
    return protoFaces;
  }

  /**
   * Update the faces for this primitive.
   */
  _generateFaces(faces) {
    super._generateFaces(faces);

    // After updating the faces, also transform the _refCentroid, if any.
    const M = this.modelMatrix.model;
    const numSides = this.prototypeFaces.length;
    const protoFaces = this.prototypeFaces;
    for ( let i = 0; i < numSides; i += 1 ) {
      const protoFace = protoFaces[i];
      const face = faces[i];
      M.multiplyPoint3d(protoFace._refCentroid, face._refCentroid);
    }
  }

  // ----- NOTE: Debugging ----- //

  /**
   * Handle local centroid validation for orientation.
   * @param {Polygon3d} face
   * @returns {boolean} True if not facing the local center or is hole.
   */
  static validateFaceOrientation(face) {
    // Side walls: refCentroid = the ring (solid or hole) they belong to.
    // Cap faces (Polygons3d, possibly with holes): their own centroid already reflects
    // just that one island's rings, since each Polygons3d is build per-island.
    const testPoint = face.refCentroid ?? face.centroid;
    return face.isFacing(testPoint) === Boolean(face.isHole);
  }


  // TODO: Probably need to preserve refCentroid when cloning/copying Polygon3d
  // When transforming, need to transform that refCentroid

  /**
   * Test whether all faces of this shape face outward as expected.
   * Outward means from an outside viewer, the face is counter-clockwise.
   * @returns {boolean} True if all faces point outward.
   */
  prototypeFacesOutward() {
    const faces = this.prototypeFaces;
    return faces.length >= 3 && faces.every(face => this.constructor.validateFaceOrientation(face));
  }

  /**
   * Test whether all faces of this shape face outward as expected.
   * Outward means from an outside viewer, the face is counter-clockwise.
   * @returns {boolean} True if all faces point outward.
   */
  facesOutward() {
    const faces = this.faces;
    return faces.length >= 3 && faces.every(face => this.constructor.validateFaceOrientation(face));
  }
}
