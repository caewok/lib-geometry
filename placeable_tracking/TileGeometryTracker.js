/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractPlaceableGeometryTracker, allGeometryMixin, noVertexGeometryMixin } from "./AbstractPlaceableGeometryTracker.js";
import { TilePositionTracker, TileScaleTracker, TileRotationTracker } from "./TileTracker.js";

// LibGeometry
import { GEOMETRY_LIB_ID } from "../const.js";
import { AABB3d } from "../AABB.js";
import { MatrixFloat32 } from "../MatrixFlat.js";
import { Point3d } from "../3d/Point3d.js";
import { Quad3d } from "../3d/Polygon3d.js";
import { almostBetween } from "../util.js";

class AbstractTileGeometryTracker extends AbstractPlaceableGeometryTracker {
  /** @type {string} */
  static PLACEABLE_NAME = "Tile";

  /** @type {string} */
  static layer = "tiles";

  /** @type {TrackerKeys} */
  static TRACKERS = {
    position: TilePositionTracker,
    rotation: TileRotationTracker,
    scale: TileScaleTracker,
  };

  get tile() { return this.placeable; }

  get alphaThreshold() { return CONFIG[GEOMETRY_LIB_ID].alphaThreshold || 0; }


  // ----- NOTE: AABB ----- //
  calculateAABB(aabb) { return AABB3d.fromTileAlpha(this.tile, this.alphaThreshold, aabb); }

  // ----- NOTE: Matrices ----- //

  calculateTranslationMatrix(mat) {
    const ctr = this.constructor.tileCenter(this.tile);
    return MatrixFloat32.translation(ctr.x, ctr.y, ctr.z, mat);
  }

  calculateRotationMatrix(mat) {
    const rot = this.constructor.tileRotation(this.tile)
    return MatrixFloat32.rotationZ(rot, true, mat);
  }

  calculateScaleMatrix(mat) {
    const { width, height } = this.constructor.tileDimensions(this.tile);
    return MatrixFloat32.scale(width, height, 1.0, mat);
  }

  // ----- NOTE: Polygon3d ---- //

  /** @type {Faces} */
  _prototypeFaces = {
    top: new Quad3d(),
    bottom: new Quad3d(),
    sides: [],
  }

  /** @type {Faces} */
  faces = {
    top: new Quad3d(),
    bottom: new Quad3d(),
    sides: [],
  }

  /**
   * Update position of the faces.
   */
  _updateFacesPosition() {
    const M = this.modelMatrix;
    this._prototypeFaces.top.transform(M, this.faces.top);
    this._prototypeFaces.bottom.transform(M, this.faces.bottom);
    for ( let i = 0, iMax = this.faces.sides.length; i < iMax; i += 1 ) {
      const prototype = this._prototypeFaces.sides[i];
      const face = this.faces.sides[i];
      prototype.transform(M, face);
    }
  }

  /**
   * Update the faces for this wall.
   * Normal walls have front (top) and back (bottom). One-directional walls have only top.
   */
  _updateFaces() {
    this.#updateFace(this.faces.top);
    if ( this.constructor.isDirectional(this.edge) ) this.faces.bottom = null;
    else {
      this.faces.bottom ??= new Quad3d();
      this.faces.top.clone(this.faces.bottom);
      this.faces.bottom.reverseOrientation();
    }
  }

  /**
   * Define a Quad3d for this wall.
   */
  #updateFace(quad) {
    const wall = this.placeable;
    let topZ = wall.topZ;
    let bottomZ = wall.bottomZ;
    if ( !isFinite(topZ) ) topZ = 1e06;
    if ( !isFinite(bottomZ) ) bottomZ = -1e06;

    quad.points[0].set(...wall.edge.a, topZ);
    quad.points[1].set(...wall.edge.a, bottomZ);
    quad.points[2].set(...wall.edge.b, bottomZ);
    quad.points[3].set(...wall.edge.b, topZ);
    quad.clearCache();
  }

  /**
   * Determine where a ray hits this object in 3d.
   * Stops at the first hit for a triangle facing the correct direction.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {number} [cutoff=1]   Ignore hits further along the ray from this (treat ray as segment)
   * @returns {number|null} The distance along the ray
   */
  rayIntersection(rayOrigin, rayDirection, minT = 0, maxT = Number.POSITIVE_INFINITY) {
    // Top and bottom are the same (just opposite orientations) and so only need to test one.
    const t = this.faces.top.intersectionT(rayOrigin, rayDirection);
    return (t !== null && almostBetween(t, minT, maxT)) ? t : null;
  }


  // ----- NOTE: Tile characteristics ----- //

  /**
   * Determine the tile rotation.
   * @param {Tile} tile
   * @returns {number}    Rotation, in radians.
   */
  static tileRotation(tile) { return Math.toRadians(tile.document.rotation); }

  /**
   * Determine the tile 3d dimensions, in pixel units.
   * Omits alpha border.
   * @param {Tile} tile
   * @returns {object}
   * @prop {number} width       In x direction
   * @prop {number} height      In y direction
   * @prop {number} elevation   In z direction
   */
  static tileDimensions(tile) {
    const { x, y, width, height } = tile.document;
    return {
      x, y, width, height,
      elevation: tile.elevationZ,
    };
  }

  /**
   * Determine the center of the tile, in pixel units.
   * @param {Tile} tile
   * @returns {Point3d}
   */
  static tileCenter(tile) {
    const out = new Point3d();
    const { x, y, width, height, elevation } = this.tileDimensions(tile);
    const dims = Point3d.tmp.set(width, height, 0);
    const TL = Point3d.tmp.set(x, y, elevation);
    const BR = TL.add(dims, Point3d.tmp);
    TL.add(BR, out).multiplyScalar(0.5, out);
    Point3d.release(dims, TL, BR);
    return out;
  }
}

export class TileVertexGeometryTracker extends allGeometryMixin(AbstractTileGeometryTracker) {
  constructor(placeable) {
    const handler = placeable[GEOMETRY_LIB_ID]?.[TileVertexGeometryTracker.ID];
    if ( handler && !(handler instanceof TileVertexGeometryTracker) ) handler.destroy(); // Remove inferior version.
    super(placeable);
  }
}
export class TileGeometryTracker extends noVertexGeometryMixin(AbstractTileGeometryTracker) {}
