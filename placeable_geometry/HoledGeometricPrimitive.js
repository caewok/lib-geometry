/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";
import { CombinedGeometricPrimitive } from "./CombinedGeometricPrimitive.js";
import { ExtrudedPolygonPrimitiveWithHoles } from "./ModelGeometricPrimitive.js";
import { CutawayPolygon } from "../CutawayPolygon.js";
import { Polygons3d } from "../3d/Polygon3d.js";

/**
 * One solid with 0 or more vertical holes through it. Typical of a Foundry region island.
 *
 * Children:
 * - solid: any extruded shape with the [bottom, top, ...sides] face order and topFace/bottomFace
 *   (cube, cylinder, hexagon, extruded polygon). Its prototype and matrix are untouched.
 * - holes: the same kinds of shape. Each hole is a normal primitive, so resizing a hole is a matrix change.
 *
 * Drawing: the solid and the holes contribute only their side walls.
 * The top and bottom caps cannot be a unit prototype times a matrix, because they depend on the solid and
 * every hole together. They are one derived primitive, rebuilt lazily when any child changes.
 *
 * Restrictions (all from the FoundryVTT case this is for):
 * - Holes go all the way through. Keep their z-range equal to the solid's; use setElevation.
 * - Tops and bottoms are fixed. Do not rotate the solid or holes about the x or y axes.
 */
export class HoledPrimitive extends CombinedGeometricPrimitive {

  /** @type {string} */
  static TYPE = "HoledPrimitive";

  /** @type {string[]} */
  static TYPE_HIERARCHY = [this.TYPE, ...super.TYPE_HIERARCHY ];

  /**
   * @typedef {ExtrudedInstancePrimitive|ExtrudedPolygonPrimitive} HolePrimitive
   */

  /** @type {GeometricPrimitive} */
  solid;

  /** @type {HolePrimitive[]} */
  holes = [];

  /**
   * @param {string} id
   * @param {GeometricPrimitive} solid
   * @param {HolePrimitive[]} [holes]
   */
  constructor(id, solid, holes = []) {
    super(id);
    if ( solid ) this.addChild(solid);
    holes.forEach(hole => this.addHole(hole));
  }

  destroy(children = true) {
    this.#caps = null;
    this.holes.length = 0;
    super.destroy(children);
  }

  // ----- NOTE: Children ----- //

  /**
   * Ensure consistency between children and the solids/holes.
   * It is assumed the child will be marked as hole if it is a hole.
   * May result in a stranded solid if not handled by user.
   * @param {GeometricPrimitive} child
   * @returns {boolean} True if added
   */
  addChild(child) {
    if ( !super.addChild(child) ) return false;
    if ( child.isHole ) this.holes.push(child);
    else {
      if ( this.solid ) this.removeChild(this.solid);
      this.solid = child;
    }
    return true;
  }

  /**
   * Ensure consistency between children and the solids/holes.
   * It is assumed the child will be marked as hole if it is a hole.
   * May result in a stranded solid if not destroyed or captured by the user.
   * @param {GeometricPrimitive} child
   * @returns {boolean} True if added
   */
  removeChild(child) {
    if ( !super.removeChild(child) ) return false;
    if ( child.isHole ) {
      const i = this.holes.indexOf(child);
      if ( ~i ) this.holes.splice(i, 1);
    } else this.solid = null;
    return true;
  }


  // ----- NOTE: Single solid ----- //

  /**
   * Replace the solid for this region.
   * May result in a stranded solid if not destroyed or captured by the user.
   * @param {HolePrimitive} solid
   * @returns {Boolean} True if replacement was needed.
   */
  replaceSolid(solid) {
    if ( this.solid === solid ) return false;

    // Remove the old solid
    if ( this.solid && !this.removeChild(this.solid) ) return false;
    this.solid = null;

    // Add the new solid.
    if ( solid.isHole ) solid.reverseOrientation();
    this.addChild(solid);
    return true;
  }

  // ----- NOTE: Holes ----- //

  /**
   * Add a hole to this shape.
   * A hole's walls (normals) should face toward its center.
   * @param {HolePrimitive} hole
   * @returns {HolePrimitive|undefined}
   */
  addHole(hole) {
    if ( !hole.isHole ) hole.reverseOrientation();
    return this.addChild(hole);
  }

  /**
   * Remove a hole from this shape.
   * @param {HolePrimitive} hole
   * @returns {boolean} True if the hole was in this shape.
   */
  removeHole(hole) { return this.removeChild(hole); }

  // ----- NOTE: Elevation ----- //

   /**
   * Set the elevation range of the solid and all holes together, so they cannot drift apart.
   * @param {number} bottomZ
   * @param {number} topZ
   */
  setElevation(bottomZ, topZ) {
    // Ensure the top and bottom values are consistent.
    bottomZ ??= this.bottomZ;
    topZ ??= this.topZ;
    this.bottomZ = bottomZ;
    this.topZ = topZ;

    // Set every child's position and scale along the z axis.
    const z = (topZ + bottomZ) / 2;
    const height = topZ - bottomZ;
    for ( const child of this.children ) {
      using position = child.modelMatrix.translation;
      using scale = child.modelMatrix.scale;
      position.z = z;
      scale.z = height;
      child.setPosition(position);
      child.setScale(scale);
    }
  }

  #topZ;

  #bottomZ;

  get topZ() { return (this.#topZ ??= this.aabb.max.z); }

  get bottomZ() { return (this.#bottomZ ??= this.aabb.min.z); }

  set topZ(value) { this.#topZ = value; }

  set bottomZ(value) { this.#bottomZ = value; }

  // ----- NOTE: Derived top/bottom caps ----- //

  /** @type {ModelGeometricPrimitive|null} */
  #caps = null;

  /**
   * Top and bottom faces of the solid, with holes cut out.
   * Rebuilt lazily after any change to a child or to this primitive's own transform.
   * @type {ModelGeometricPrimitive}
   */
  get caps() {
    this._syncWorld();
    if ( !this.#caps || this.isDirty(this.constructor.DIRTY.DERIVED) ) {
      this.#caps?.destroy();
      this.#caps = this.#buildCaps();
      this._clearDirty(this.constructor.DIRTY.DERIVED);
    }
    return this.#caps;
  }

  #buildCaps() {
    const topFaces = this._buildTopFaces();
    const bottomFaces = this._buildBottomFaces();

    // Treat the faces as prototypes, using an identity matrix.
    return new ExtrudedPolygonPrimitiveWithHoles(`${this.id}_caps`, [...bottomFaces, ...topFaces]);
  }

  /**
   * Build the top faces.
   * @returns {Polygon3d[]}
   */
  _buildTopFaces() {
    const polys = [...this.solid.topFaces, ...this.holes.flatMap(h => h.topFaces)];
    return [Polygons3d.from3dPolygons(polys)];
  }

  /**
   * Build the bottom faces.
   * @returns {Polygon3d[]}
   */
  _buildBottomFaces() {
    const polys = [...this.solid.bottomFaces, ...this.holes.flatMap(h => h.bottomFaces)];
    return [Polygons3d.from3dPolygons(polys)];
  }

  // ----- NOTE: Drawables and faces ----- //

  /**
   * Retrieve the solid walls, hole walls, and derived caps.
   * @yields {GeometricDrawableData}
   */
  *drawables(_opts) {
    for ( const drawable of this.solid.drawables({ sidesOnly: true }) ) {
      drawable.opacity *= this.opacity;
      yield drawable;
    }

    for ( const hole of this.holes ) {
      for ( const drawable of hole.drawables({ sidesOnly: true }) ) {
        drawable.opacity *= this.opacity;
        yield drawable;
      }
    }

    for ( const drawable of this.caps.drawables() ) {
      drawable.opacity *= this.opacity;
      yield drawable;
    }
  }

  /**
   * Walls of the solid and holes plus the derived caps.
   * @param {Polygon3d[]} out
   */
  _collectFaces(out) {
    for ( const face of this.solid.sideFaces ) out.push(face);
    for ( const hole of this.holes ) {
      for ( const face of hole.sideFaces ) out.push(face);
    }
    for ( const face of this.caps.faces ) out.push(face);

  }

  // ----- NOTE: AABB ---- //

  _calculateAABB(aabb) {
    // Holes lie inside the solid, so the solid's box is the box.
    return aabb.copyFrom(this.solid.aabb);
  }

  // ----- NOTE: Queries ----- //

  /**
   * Inside the solid's footprint and outside every hole.
   * @param {PIXI.Point} canvasLoc
   * @returns {boolean}
   */
  containsProjectedXY(canvasLoc) {
    // Holes are vertical, so a 2d test is exact. It needs each hole's containsProjectedXY to be exact,
    // which it is for the shapes that test their bottom face (cube, cylinder, hexagon, extruded polygon).
    if ( !this.solid.containsProjectedXY(canvasLoc) ) return false;
    return !this.holes.some(hole => hole.containsProjectedXY(canvasLoc));
  }

  /**
   * Determine where a ray first hits this object in 3d.
   * Ignores intersections behind the ray.
   * @param {Point3d} rayOrigin
   * @param {Point3d} rayDirection
   * @param {object} [opts]
   * @param {boolean} [opts.sidesOnly=false]
   * @param {number} [opts.minT=0]        Ignore hits earlier in the segment than this (multiple of rayDirection)
   * @param {number} [opts.maxT=1]        Ignore hits later in the segment than this (multiple of rayDirection)
   * @returns {number|null} The distance along the ray, as a multiple of rayDirection
   */
  rayIntersection(rayOrigin, rayDirection, { _sidesOnly = false, ...opts } = {}) {
    const crossings = [];
    for ( const child of [this.solid, ...this.holes] ) {
      for ( const face of child.faces ) this.constructor.faceCrossings(face, rayOrigin, rayDirection, crossings);
    }
    const clustered = this.constructor.clusterCrossings(crossings);
    return this.constructor.firstBlockedT(clustered, { ...opts, direction: this.direction });
  }

  /**
   * Solid cross-sections minus hole cross-sections.
   * @param {PIXI.Point} start
   * @param {PIXI.Point} end
   * @returns {CutawayPolygon[]}
   */
  verticalSlice(start, end) {
    if ( start.almostEqual(end) ) return [];
    if ( !this.aabb.overlapsSegment(start, end, ["x", "y"]) ) return [];

    // Slice the solid first to get the cutaway before subtracting holes.
    const solidCuts = this.solid.verticalSlice(start, end);
    if ( !solidCuts.length ) return [];

    // Slice each hole.
    const ClipperPaths = CONFIG[GEOMETRY_LIB_ID].CONFIG.ClipperPaths;
    const holeCuts = this.holes.flatMap(hole => hole.verticalSlice(start, end));
    if ( !holeCuts.length ) return ClipperPaths.unionPolygons(solidCuts)
      .map(poly => CutawayPolygon.fromPolygon(poly, start, end));

    // Cut the holes out from the solid cutaway.
    holeCuts.forEach(holeCut => holeCut.reverseOrientation());
    return ClipperPaths.diffPolygons(solidCuts, holeCuts)
      .map(poly => CutawayPolygon.fromPolygon(poly, start, end));
  }

  /**
   * The solid's internal points that are not inside a hole.
   * The center is kept as is.
   * @param {object} ip   Modified in place
   * @returns {object}
   */
  _generateInternalPoints(ip) {
    const BUCKETS = ["top", "middle", "bottom"];
    const solidPoints = this.solid.internalPoints;
    const inHole = pt => this.holes.some(hole => hole.containsProjectedXY(pt));
    ip.center = solidPoints.center;
    for ( const bucket of BUCKETS ) {
      ip[bucket] = {
        corners: (solidPoints[bucket].corners).filter(pt => !inHole(pt)),
        mids: (solidPoints[bucket].mids).filter(pt => !inHole(pt)),
      };
    }
    return ip;
  }
}

