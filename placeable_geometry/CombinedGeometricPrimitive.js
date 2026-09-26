/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { GeometricPrimitive } from "./GeometricPrimitive.js";
import { AABB3d } from "../3d/AABB3d.js";
import { MatrixFloat32 } from "../Matrix.js";
import { Polygon3d } from "../3d/Polygon3d.js";
import { Point3d } from "../3d/Point3d.js";
import { getUniqueIntegerPoints, cutaway } from "../util.js";
import { CutawayPolygon } from "../CutawayPolygon.js";

/**
 * Container to facilitate combining multiple shapes.
 * This does not combine model matrices or vertices/indices.
 * Merely a wrapper for the underlying shapes.
 * Empty shapes are allowed.
 */
export class CombinedGeometricPrimitive extends GeometricPrimitive {

  /**
   * Initialize the values for this geometric primitive.
   */
  initialize() { this.shapes.forEach(shape => shape.initialize()); }

  /**
   * Destroy this geometric primitive, releasing associated memory in buffers.
   */
  destroy() {
    this.shapes.forEach(shape => shape.destroy());
    this.shapes.length = 0;
  }

  // ----- NOTE: Dirty ----- //

  get dirtyShapes() {
    let dirty = 0;
    this.shapes.forEach(shape => dirty |= shape.dirty);
    return dirty;
  }

  set dirtyShapes(flag) { this.shapes.forEach(shape => shape.dirty = flag); }

  isDirtyShapes(flag = this.constructor.DIRTY.ALL) {
    return this.shapes.some(shape => shape.isDirty(flag));
  }

  _clearDirtyShapes(flag) { this.shapes.forEach(shape => shape._clearDirty(flag)) }

  // ----- NOTE: Add/remove shapes ----- //

  /** @type {GeometricPrimitive[]} */
  shapes = [];

  /**
   * Add a primitive shape to this container.
   * @param {GeometricPrimitive} shape
   */
  addShape(shape) {
    this.shapes.push(shape);
    this.dirty = this.constructor.DIRTY.ALL;
  }

  replaceShapeAtIndex(newShape, idx) {
    if ( this.shapes[idx] ) this.shapes[idx].destroy();
    this.shapes[idx] = newShape;
    this.dirty = this.constructor.DIRTY.ALL;
  }

  /**
   * Remove a primitive shape from this container by id.
   * @param {string} id
   * @returns {GeometricPrimitive|null} Null if nothing removed
   */
  removeShapeById(id) {
    const idx = this.shapes.findIndex(shape => shape.id === id);
    if ( !~idx ) return null;
    return this.removeShapeByIndex(idx);
  }

  /**
   * Remove a primitive shape from this container by its index.
   *
   */
  removeShapeByIndex(idx) {
    const shape = this.shapes.splice(idx, 1)[0] || null;
    if ( shape ) this.dirty = this.constructor.DIRTY.ALL;
    return shape;
  }

  // ----- NOTE: AABB ----- //

  _calculateAABB(aabb) {
    const M = this.modelMatrix.model;
    const aabbs = this.shapes.map(shape => {
      shape.updateAABB();
      return shape.aabb.transform(M);
    });
    AABB3d.union(aabbs, aabb);
  }

  /** @type {Point3d} */
  get center() {
    const centers = this.shapes.map(shape => shape.center);

    const M = this.modelMatrix.model;
    const txCenters = centers.map(center => M.multiplyPoint3d(center));
    const poly3d = Polygon3d.from3dPoints(txCenters);
    return poly3d.centroid;
  }

  // ----- NOTE: Model Matrix ----- //

  /**
   * Mworld = Mlocal x M.container (row-major)
   * @returns {Matrix}
   */
  #worldModel = MatrixFloat32.create(4, 4);

  worldModelForShape(shape) { return shape.modelMatrix.model.multiply4x4(this.modelMatrix.model, this.#worldModel); }

  // ----- NOTE: Faces ----- //

  // Prototype faces and faces are stored as a combined set of faces, modified by the world matrix.
  get prototypeFaces() { return this.shapes.flatMap(s => s.prototypeFaces); }

  updateFaces() {
    // Don't need the subshape faces, so can skip.
    // this.shapes.forEach(shape => shape.updateFaces(false)); // Do not trigger validation for subshapes.
    super.updateFaces(); // This will trigger _generateFaces and clear the dirty tag.
  }

  /**
   * Update the faces for this primitive.
   * Default is to use the world matrix on the prototypes.
   */
  _generateFaces(faces) {
    // Release old face points before destroying them.
    faces.forEach(face => face.release());
    const protoFaces = this.prototypeFaces;
    faces.length = protoFaces.length;

    let i = 0;
    for ( const shape of this.shapes ) {
      // Calculate each face from the world model.
      const worldM = this.worldModelForShape(shape);
      const invTransposeM = worldM.invert().transpose();
      for ( const protoFace of shape.prototypeFaces ) {
        faces[i++] = protoFace.transform(worldM, invTransposeM)
      }
    }
  }

  // ----- NOTE: Vertices ----- //

  updateInstanceVertices() {
    this.shapes.forEach(shape => shape.updateInstanceVertices()); // Triggers _generateVerticesForFaces for each shape.
    super.updateInstanceVertices();
  }

//   updateModelVertices() {
//     this.shapes.forEach(shape => shape.updateModelVertices());
//     super.updateModelVertices();
//   }

  // ----- NOTE: Face points ----- //

//   updateFacePoints() {
//     this.shapes.forEach(shape => shape.updateFacePoints());
//     super.updateFacePoints();
//   }


  // ----- NOTE: Internal points ----- //

  // Default is a single set of points based on AABB.
  // TODO: More sophisticated version testing for containment.

//   updateInternalPoints() {
//     this.shapes.forEach(shape => shape.updateInternalPoints());
//   }



  _testFacesOutward(faces) {
    if ( !faces || faces.length < 3 ) return false;

    // Calling this.shapes.every(shape => shape.validate() only works if each subshape is
    // a self-contained 3d shape. But if two adjacent shapes drop their shared face, then
    // the overall shape might be valid but neither subshape would be. Instead, treat as one large object.

    for ( let i = 0, n = faces.length; i < n; i += 1 ) {
      const face = faces[i];
      if ( !this.constructor.testFaceOrientation(face, faces) ) return false;
    }
    return true;
  }

  /**
   * Slice this 3d shape with a vertical plane, returning 2d cross-section(s) as CutawayPolygons.
   * Correctly handles shapes with holes (internal cavities, Polygons3d hole faces, etc.).
   * @param {PIXI.Point|Point3d} start     Starting point of the slice on the XY plane
   * @param {PIXI.Point|Point3d} end       Ending point of the slice on the XY plane
   * @returns {CutawayPolygon[]} Array of CutawayPolygon cross-sections (solids and holes)
   */
  verticalSlice(start, end) {
    // 1. Calculate direction vector along the slice in the XY plane
    using dirXY = Point3d.tmp.set(end.x - start.x, end.y - start.y, 0);
    dirXY.normalize(); // Could divide by 0
    if ( !isFinite(dirXY.x) ) return [];

    // 2. Define slicing plane normal (perpendicular to dirXY in XY plane) and plane distance
    using sliceNormal = Point3d.tmp.set(-dirXY.y, dirXY.x, 0);
    using start3d = Point3d.tmp.set(start.x, start.y, 0);
    const sliceD = start3d.dot(sliceNormal);

    // Signed distance helper from 3d point to slicing plane
    const distToPlane = (pt) => (pt.x * sliceNormal.x + pt.y * sliceNormal.y) - sliceD;

    // 3. Flatten faces, unpacking any Polygons3d compound faces into single Polygon3d rings
    const flatFaces = [];
    for ( const face of this.faces ) {
      if ( !face ) continue;
      if ( face.polygons && Array.isArray(face.polygons) ) flatFaces.push(...face.polygons);
      else flatFaces.push(face);
    }

    // 4. Intersect each face with the vertical plane
    const dirSegments2d = [];
    using tmpPt = Point3d.tmp;
    using dirVec = Point3d.tmp;
    using segVec = Point3d.tmp;

    for ( const face of flatFaces ) {
      if ( !face.isValid() ) continue;

      // Skip faces that are parallel/coplanar with the slice plane
      const faceNormal = face.plane.normal;
      faceNormal.cross(sliceNormal, dirVec);
      if ( dirVec.magnitudeSquared() < 1e-12 ) continue;

      // Find intersection points of face edges with the slicing plane
      const interPoints = [];
      for ( const edge of face.iterateEdges({ close: true }) ) {
        const { a, b } = edge;
        const dA = distToPlane(a);
        const dB = distToPlane(b);

        if ( dA * dB < 0 ) {
          // Edge crosses the plane
          const t = dA / (dA - dB);
          const pInter = Point3d.tmp;
          a.add(b.subtract(a, tmpPt).multiplyScalar(t, tmpPt), pInter);
          interPoints.push(pInter);
        } else if ( Math.abs(dA) < 1e-08 ) {
          interPoints.push(a);
        }
      }

      // Filter duplicate intersection points
      const uniquePts = getUniqueIntegerPoints(interPoints);
      if ( uniquePts.length < 2 ) continue;

      // Select the primary pair of endpoints
      let p1 = uniquePts[0];
      let p2 = uniquePts[1];
      if ( uniquePts.length > 2 ) {
        let maxD2 = -1;
        for ( let i = 0; i < uniquePts.length; i++ ) {
          for ( let j = i + 1; j < uniquePts.length; j++ ) {
            const d2 = uniquePts[i].distanceSquaredBetween(uniquePts[j]);
            if ( d2 > maxD2 ) {
              maxD2 = d2;
              p1 = uniquePts[i];
              p2 = uniquePts[j];
            }
          }
        }
      }

      if ( p1.almostEqual(p2) ) continue;

      // Orient segment along dirVec = N_face x N_slice to guarantee proper 2D winding
      p2.subtract(p1, segVec);
      if ( segVec.dot(dirVec) < 0 ) {
        const swap = p1;
        p1 = p2;
        p2 = swap;
      }

      // Map 3D endpoints to 2D Cutaway coordinates (u = distance along slice, v = z elevation)
      const a2d = cutaway.to2d(p1, start, end);
      const b2d = cutaway.to2d(p2, start, end);

      if ( Math.hypot(b2d.x - a2d.x, b2d.y - a2d.y) < 1e-06 ) {
        a2d.release?.();
        b2d.release?.();
        continue;
      }

      dirSegments2d.push({ a: a2d, b: b2d });
    }

    // 5. Assemble directed 2D segments into closed loops
    return this.#assembleCutawayPolygons(dirSegments2d, start, end);
  }

  /**
   * Stitch directed 2D segments into ordered, closed CutawayPolygon loops.
   * Maintains loop direction so outer boundaries and holes are properly oriented.
   * @param {{a: PIXI.Point, b: PIXI.Point}[]} segments   Directed 2D line segments
   * @param {PIXI.Point} start                          Slice start reference
   * @param {PIXI.Point} end                            Slice end reference
   * @returns {CutawayPolygon[]} Array of CutawayPolygons
   */
  #assembleCutawayPolygons(segments, start, end) {
    if ( !segments.length ) return [];

    const polygons = [];
    const unvisited = [...segments];
    const EPSILON = 1e-04;

    while ( unvisited.length > 0 ) {
      const polyPoints = [];
      const startSeg = unvisited.shift();

      polyPoints.push(startSeg.a);
      let currPt = startSeg.b;
      const loopStart = startSeg.a;

      let maxSteps = unvisited.length + 2;
      while ( maxSteps-- > 0 ) {
        if ( currPt.almostEqual(loopStart, EPSILON) ) break;

        polyPoints.push(currPt);

        // Find the next segment whose start point matches current end point
        let nextIdx = unvisited.findIndex(seg => seg.a.almostEqual(currPt, EPSILON));

        // Precision fallback: locate nearest start point if exact epsilon match fails
        if ( nextIdx === -1 ) {
          let minD2 = EPSILON * EPSILON * 100;
          for ( let i = 0; i < unvisited.length; i++ ) {
            const d2 = Math.hypot(unvisited[i].a.x - currPt.x, unvisited[i].a.y - currPt.y);
            if ( d2 < minD2 ) {
              minD2 = d2;
              nextIdx = i;
            }
          }
        }

        if ( nextIdx === -1 ) break; // Open loop discontinuity

        const nextSeg = unvisited.splice(nextIdx, 1)[0];
        currPt = nextSeg.b;
      }

      if ( polyPoints.length >= 3 ) {
        const cutaway = CutawayPolygon.fromCutawayPoints(polyPoints, start, end);
        polygons.push(cutaway);
      }
    }

    // Release temporary segment 2D points
    for ( const seg of segments ) {
      seg.a.release?.();
      seg.b.release?.();
    }

    return polygons;
  }


}