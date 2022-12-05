/* globals
PIXI,
canvas,
ClipperLib,
Ray
*/
"use strict";

import { Point3d } from "./3d/Point3d.js";
import { ClipperPaths } from "./ClipperPaths.js";
import { Plane } from "./3d/Plane.js";
// import { TokenPoints3d } from "./TokenPoints3d.js";
import { Draw } from "./Draw.js";

/* Testing
api = game.modules.get("tokenvisibility").api
Point3d = api.Point3d
Shadow = api.Shadow
visionSource = _token.vision
shadowPolygonForElevation = api.shadowPolygonForElevation
polygonToRectangle = api.polygonToRectangle
intersectConstrainedShapeWithLOS = api.intersectConstrainedShapeWithLOS

target = _token


let [wall] = canvas.walls.placeables
s0 = Shadow.construct(wall, visionSource, CONFIG.GeometryLib.utils.gridUnitsToPixels(0))
s10 = Shadow.construct(wall, visionSource, CONFIG.GeometryLib.utils.gridUnitsToPixels(10))


s30 = Shadow.construct(wall, visionSource, CONFIG.GeometryLib.utils.gridUnitsToPixels(30))

// Project to bottom surface.
Token losHeight = 30; elevation = 25
surface elevation = 0
wall at 20, 10

// Project to top surface:
token losHeight = 0; elevation = -5
surface elevation = 30

*/

/*
 Looking at a cross-section:
  V----------W----O-----?
  | \ Ø      |    |
Ve|    \     |    |
  |       \  |    |
  |          \    |
  |        We|  \ | <- point O where obj can be seen by V for given elevations
  ----------------•----
  |<-   VO      ->|
 e = height of V (vision object)
 Ø = theta
 W = terrain wall

 Looking from above:
              •
             /| 𝜶 is the angle VT to VT.A
          •/ -|
         /|   |
       /  | S | B
     /    |   |
   / 𝜶  B |   |
 V -------W---• O
 (and mirrored on bottom)
 S = shadow area
 B = bright area

 naming:
 - single upper case: point. e.g. V
 - double upper case: ray/segment. e.g. VT
 - lower case: descriptor. e.g., Ve for elevation of V.

Bottom wall to surface is similar:
 Looking at a cross-section:
  V----------W----O-----?
  | \ I      |    |
Ve| K  \   We|    |
  |       \  |    |
  |          \    |
  |           L  \ | <- point O where obj can be seen by V for given elevations
  ----------------•----
  |<-   VO   |  ->|
             |<- Point where wall would touch the surface

*/

export class Shadow extends PIXI.Polygon {
  constructor(...points) {
    super(...points);

    // Round to nearest pixel to avoid some visual artifacts when joining shadows
    this.points = this.points.map(val => Math.round(val));

    if ( !this.isClosed ) {
      const ln = this.points.length;
      this.addPoint({ x: this.points[ln - 2], y: this.points[ln -1] });
    }

  }

  static upV = new Point3d(0, 0, 1);

  /**
   * Build the parallelogram representing a shadow cast from a wall.
   * Looking top-down with a light or other source object at a given elevation
   * above a wall.
   * This method used by Elevated Vision.
   * TODO: Replace with better version using projection that handles planes.
   * @param {Wall} w
   * @param {LightSource} source
   * @return {Shadow}
   */
  static constructShadow(wall, source, surfaceElevation = 0) {
    /*
     Looking at a cross-section:
      V----------T----O-----?
      | \ Ø      |    |
    Ve|    \     |    |
      |       \  |    |
      |          \    |
      |        Te|  \ | <- point O where obj can be seen by V for given elevations
      ----------------•----
      |<-   VO      ->|
     e = height of V (vision object)
     Ø = theta
     T = terrain wall

     Looking from above:
                  •
                 /| 𝜶 is the angle VT to VT.A
              •/ -|
             /|   |
           /  | S | B
         /    |   |
       / 𝜶  B |   |
     V -------T---• O
     (and mirrored on bottom)
     S = shadow area
     B = bright area

     naming:
     - single upper case: point. e.g. V
     - double upper case: ray/segment. e.g. VT
     - lower case: descriptor. e.g., Ve for elevation of V.

    */

    // Note: elevation should already be in grid pixel units
    let Oe = surfaceElevation;
    let Te = wall.topZ; // TO-DO: allow floating walls to let light through the bottom portion
//     let Oe = 0; // TO-DO: allow this to be modified by terrain elevation
    let Ve = source.elevationZ;
    if ( Ve <= Te ) return null; // Vision object blocked completely by wall

    // Need the point of the wall that forms a perpendicular line to the vision object
    const Tix = CONFIG.GeometryLib.utils.perpendicularPoint(wall.A, wall.B, source);
    if ( !Tix ) return null; // Line collinear with vision object
    const VT = new Ray(source, Tix);

    // If any elevation is negative, normalize so that the lowest elevation is 0
    const min_elevation = Math.min(Ve, Oe, Te);
    if ( min_elevation < 0 ) {
      const adder = Math.abs(min_elevation);
      Ve = Ve + adder;
      Oe = Oe + adder;
      Te = Te + adder;
    }

    // Theta is the angle between the 3-D sight line and the sight line in 2-D
    const theta = Math.atan((Ve - Te) / VT.distance); // Theta is in radians
    const TOdist = (Te - Oe) / Math.tan(theta); // Tan wants radians
    const VOdist = VT.distance + TOdist;

    /* Testing
    // Ray extending out V --> T --> O
    api.drawing.drawPoint(source, {color: api.drawing.COLORS.yellow})

    VO = Ray.towardsPoint(source, Tix, VOdist)
    api.drawing.drawPoint(VO.B, {color: api.drawing.COLORS.lightblue})
    */

    // We know the small triangle on each side:
    // V --> T --> wall.A and
    // V --> T --> wall.B
    // We need the larger encompassing triangle:
    // V --> O --> ? (wall.A side and wall.B side)

    // Get the distances between Tix and the wall endpoints.
    const distA = PIXI.Point.distanceBetween(wall.A, Tix);
    const distB = PIXI.Point.distanceBetween(wall.B, Tix);


    /* Testing
    // Ray extending Tix --> Wall.A
    rayTA = new Ray(wall.A, Tix);
    rayTA.distance

    rayTB = new Ray(wall.B, Tix);
    rayTB.distance;
    */

    // Calculate the hypotenuse of the big triangle on each side.
    // That hypotenuse is used to extend a line from V past each endpoint.
    // First get the angle
    const alphaA = Math.atan(distA / VT.distance);
    const alphaB = Math.atan(distB / VT.distance);

    // Now calculate the hypotenuse
    const hypA = VOdist / Math.cos(alphaA);
    const hypB = VOdist / Math.cos(alphaB);

    // Extend a line from V past wall T at each endpoint.
    // Each distance is the hypotenuse ont he side.
    // given angle alpha.
    // Should form the parallelogram with wall T on one parallel side
    const VOa = Ray.towardsPoint(source, wall.A, hypA);
    const VOb = Ray.towardsPoint(source, wall.B, hypB);

    /* Testing
    // Rays extending V --> T.A or T.B --> end of shadow
    api.drawing.drawSegment(VOa, {color: api.drawing.COLORS.green})
    api.drawing.drawSegment(VOb, {color: api.drawing.COLORS.orange})
    api.drawing.drawSegment({A: VOa.B, B: VOb.B}, {color: api.drawing.COLORS.gray})
    */

    const shadow = new this([wall.A, VOa.B, VOb.B, wall.B]);

    /* Testing
    api.drawing.drawShape(shadow)
    */

    // Cache some values
    shadow.wall = wall;
    shadow.source = source;
    shadow.VT = VT;
    shadow.theta = theta;
    shadow.alpha = { A: alphaA, B: alphaB };

    return shadow;
  }

  /**
   * Intersect this shadow against a polygon and return a new shadow.
   * Copy relevant data from this shadow.
   * Used primarily by ElevatedVision to intersect against the sweep.
   */
  intersectPolygon(poly) {
    // Cannot rely on the super.intersectPolygon because we need to retrieve all the holes.
    const solution = this.clipperClip(poly, { cliptype: ClipperLib.ClipType.ctIntersection });

    return solution.map(pts => {
      const polyIx = PIXI.Polygon.fromClipperPoints(pts);
      const model = new this.constructor();
      Object.assign(model, polyIx);

      model.wall = this.wall;
      model.source = this.source;
      model.VT = this.VT;
      model.theta = this.theta;
      model.alpha = this.alpha;

      return model;
    });
  }

  /**
   * Construct a shadow using the following assumptions
   * - Origin is above the shadow surface
   * - Points A and B represent the top of the wall
   * - Wall has infinite bottom height, extending to A and B
   * - Wall A to bottom and B to bottom are orthogonal to coordinate plane
   * - Wall is 2d
   * - Surface plane can be oriented in various ways.
   * @param {Point3d} A   Top point of the wall
   * @param {Point3d} B   Top point of the wall. AB are parallel to XY plane.
   * @param {Point3d} origin      Viewer location.
   * @param {Plane} surfacePlane  Plane onto which to project shadow.
   * @returns {Point3d[]|null} Null if shadow not formed.
   *   Infinite shadows truncated to canvas maxR.
   */
  static complexSurfaceOriginAbove(A, B, origin, surfacePlane) {
    const upV = Shadow.upV;

    // Debugging
    // Direction of the surfacePlane in relation to the origin.
    const ixOrigin = surfacePlane.lineIntersection(origin, upV);
    if ( ixOrigin.z.almostEqual(origin.z) ) {
      console.warn("complexSurfaceOriginAbove origin is on the plane");
      return null;
    } else if ( origin.z < ixOrigin.z ) {
      console.warn("complexSurfaceOriginAbove origin is below the plane");
      return null;
    }

    // Truncate wall to be above the surface
    // Where does the (infinite) wall cross the surface?
    const ixAB = surfacePlane.lineSegmentIntersection(A, B);
    if ( ixAB ) {
      // Truncate wall to be above the surface
      // Can use the intersection point: will create a triangle shadow.
      // (Think flagpole shadow.)
      if ( A.z < ixAB.z ) {
        const newA = new Point3d();
        const t = B.projectToAxisValue(A, 0, "z", newA);
        if ( !t || t < 0 || t > 1 ) return null; // Wall portion completely behind surface.
        if ( newA.almostEqual(B) ) return null;
        A = newA;
      } else if ( B.z < ixAB.z ) {
        const newB = new Point3d();
        const t = A.projectToAxisValue(B, 0, "z", newB);
        if ( !t || t < 0 || t > 1 ) return null; // Wall portion completely behind surface.
        if ( newB.almostEqual(A) ) return null;
        B = newB;
      }

    } else if ( A.z < surfacePlane.point.z ) return null; // Does not cross the surface. Reject if endpoint is on the wrong side.

    // Intersection points of origin --> wall endpoint --> surface
    const ixOriginA = wallPointSurfaceIntersection(A, origin, surfacePlane);
    const ixOriginB = wallPointSurfaceIntersection(B, origin, surfacePlane);

    // Debugging
    if ( !ixOriginA || !ixOriginB ) {
      console.warn("complexSurfaceOriginAbove ixOriginA or ixOriginB is null");
      return null;
    }

    // If the intersection point is above the origin, then the surface is twisted
    // such that the surface is between the origin and the wall at that point.
    if ( !ixOriginA || !ixOriginB || ixOriginA.z > origin.z || ixOriginB.z > origin.z ) return null;

    // Find the intersection points of the wall with the surfacePlane
    const ixWallA = surfacePlane.lineIntersection(A, upV);
//     if ( !ixWallA ) return null; // Unlikely, but possible?

    const ixWallB = surfacePlane.lineIntersection(B, upV);
//     if ( !ixWallB ) return null; // Unlikely, but possible?

    // Debugging
    if ( !ixWallA || !ixWallB ) {
      console.warn("complexSurfaceOriginAbove ixWallA or ixWallB is null");
      return null;
    }

    // Surface intersection must be below the origin
    if ( origin.z < ixOriginA.z ) {
      console.warn("complexSurfaceOriginAbove origin.z < ixOriginA.z");
      return null;
    }

    if ( origin.z < ixOriginA.z ) {
      console.warn("complexSurfaceOriginAbove origin.z < ixOriginA.z");
      return null;
    }

    const pts = [
      ixWallA,
      ixOriginA,
      ixOriginA,
      ixWallB
    ];

    const out = new Shadow(pts);
    out._points3d = pts;
    return out;
  }


//   static simpleFromPoints3d(A, B, C, D, origin, surfacePlane) {
//     // Determine whether origin is above or below surface plane
//     const ixOrigin = surfacePlane.lineIntersection(origin, Shadow.upV);
//     if ( !ixOrigin ) return null;
//     const diff = origin.z - ixOrigin.z;
//     return diff > 0 ? Shadow.buildFromPoints3dXYOrientationOriginAbove(A, B, C, D, origin, surfacePlane)
//       : diff < 0 ? Shadow.buildFromPoints3dXYOrientationOriginBelow(A, B, C, D, origin, surfacePlane)
//       : null;
//   }

  /**
   * Construct shadow using strong assumptions about the set-up.
   * - Origin is above the shadow surface.
   * - Shadow surface assumed parallel to XY plane, such that it does not intersect AB or CD.
   * - Shadow surface elevation is at surfacePlane.point.z.
   * - Points A and B represent the top of the wall.
   * - Points C and D represent the bottom of the wall.
   * - AC is orthogonal to the XY plane, as is BD. AC and BD are parallel as are AB and CD.
   *   (Wall is a 2d rectangle on a plane, not a parallelogram.)
   * @param {Point3d} A   Top point of the wall
   * @param {Point3d} B   Top point of the wall. AB are parallel to XY plane.
   * @param {Point3d} C   Bottom point of the wall.
   * @param {Point3d} D   Bottom point of the wall. CD are parallel to XY plane. AC and BD are parallel.
   * @param {Point3d} origin      Viewer location.
   * @param {Plane} surfacePlane  Plane onto which to project shadow.
   * @returns {Shadow|null} Null if shadow not formed or if shadow would be equivalent to LOS
   *  because it is infinite and starts at the wall-surface intersection.
   */
  static simpleSurfaceOriginAbove(A, B, C, D, origin, surfacePlane) {
    const surfaceElevation = surfacePlane.point.z;
    if ( origin.z <= surfaceElevation ) {
      console.error("simpleSurfaceOriginAbove given origin below the surface plane.");
      return null;
    }

    if ( origin.z <= C.z ) return null; // Viewer is below the wall bottom.

//     const upV = Shadow.upV;

    // Because the surfacePlane is parallel to XY, we can infer the intersection of the wall.
    // const ixAC = surfacePlane.lineIntersection(A, upV);
    // const ixBD = surfacePlane.lineIntersection(B, upV);
    const ixAC = new Point3d(A.x, A.y, surfacePlane.point.z);
    const ixBD = new Point3d(B.x, B.y, surfacePlane.point.z);

    const ixOriginA = wallPointSurfaceIntersection(A, origin, surfacePlane);
    const ixOriginB = wallPointSurfaceIntersection(B, origin, surfacePlane);

    // Debugging
    if ( !ixOriginA || !ixOriginB ) {
      console.warn("simpleSurfaceOriginAbove ixOriginA or ixOriginB is null");
      return null;
    }

    let ixOriginC;
    if ( C.z <= ixAC.z ) {
      // Wall bottom at C is below the surface, so shadow extends from wall --> surface intersection
      ixOriginC = ixAC;
    } else {
      // Established above that viewer is above the wall bottom.
      // Find origin --> C --> surface
      ixOriginC = surfacePlane.lineSegmentIntersection(origin, C);
    }

    let ixOriginD;
    if ( D.z <= ixBD.z ) {
      // Wall bottom at C is below the surface, so shadow extends from wall --> surface intersection
      ixOriginD = ixBD;
    } else {
      // Established above that viewer is above the wall bottom.
      // Find origin --> C --> surface
      ixOriginD = surfacePlane.lineSegmentIntersection(origin, D);
    }

    // Debugging
    if ( !ixOriginA || !ixOriginB ) {
      console.warn("simpleSurfaceOriginAbove ixOriginC or ixOriginBDis null");
      return null;
    }

    return new Shadow([
      ixOriginC,
      ixOriginA,
      ixOriginB,
      ixOriginD
    ]);
  }

  /**
   * Construct shadow using strong assumptions about the set-up.
   * - Origin is below the shadow surface.
   * - Shadow surface assumed nearly parallel to XY plane, such that it does not intersect AB or CD.
   * - Points A and B represent the top of the wall.
   * - Points C and D represent the bottom of the wall.
   * - AC is orthogonal to the XY plane, as is BD. AC and BD are parallel as are AB and CD.
   *   (Wall is a 2d rectangle on a plane, not a parallelogram.)
   * @param {Point3d} A   Top point of the wall
   * @param {Point3d} B   Top point of the wall. AB are parallel to XY plane.
   * @param {Point3d} C   Bottom point of the wall.
   * @param {Point3d} D   Bottom point of the wall. CD are parallel to XY plane. AC and BD are parallel.
   * @param {Point3d} origin      Viewer location.
   * @param {Plane} surfacePlane  Plane onto which to project shadow.
   * @returns {Shadow|null} Null if shadow not formed or if shadow would be equivalent to LOS
   *  because it is infinite and starts at the wall-surface intersection.
   */
  static simpleSurfaceOriginBelow(A, B, C, D, origin, surfacePlane) {
    // Turn everything upside down.
    A.z *= -1;
    B.z *= -1;
    C.z *= -1;
    D.z *= -1;
    origin.z *= -1;
    surfacePlane.point.z *= -1;

    const shadow = Shadow.simpleSurfaceOriginAbove(A, B, C, D, origin, surfacePlane);

    // Turn everything right-side up, just in case they are used elsewhere.
    A.z *= -1;
    B.z *= -1;
    C.z *= -1;
    D.z *= -1;
    origin.z *= -1;
    surfacePlane.point.z *= -1;

    return shadow;
  }

  /**
   * Construct shadow using strong assumptions about the set-up.
   * Shadow will be projected onto a surface parallel to XY plane at provided elevation.
   * @param {Wall} wall                 Wall placeable, with bottomZ and topZ properties.
   * @param {Point3d} origin            Viewer location in 3d space.
   * @param {number} surfaceElevation   Elevation of the surface onto which to project shadow.
   * @returns {Shadow|null}
   */
  static constructFromWall(wall, origin, surfaceElevation = 0) {
    // If the viewer elevation equals the surface elevation, no shadows to be seen.
    if ( origin.z.almostEqual(surfaceElevation) ) return null;

    const { A, B } = wall;
    let { topZ, bottomZ } = wall;

    // Run simple tests to avoid further computation
    // Viewer and the surface elevation both above the wall, so no shadow
    if ( origin.z >= topZ && surfaceElevation >= topZ ) return null;

    // Viewer and the surface elevation both below the wall, so no shadow
    else if ( origin.z <= bottomZ && surfaceElevation <= bottomZ ) return null;

    // Projecting downward from source; if below bottom of wall, no shadow.
    else if ( origin.z >= surfaceElevation && origin.z <= bottomZ ) return null;

    // Projecting upward from source; if above bottom of wall, no shadow.
    else if ( origin.z <= surfaceElevation && origin.z >= topZ ) return null;

    const bottomInfinite = !isFinite(bottomZ);
    const topInfinite = !isFinite(topZ);
    if ( bottomInfinite && topInfinite ) return null; // Infinite shadow

    const maxR = canvas.dimensions.maxR;
    if ( bottomInfinite ) bottomZ = -maxR;
    if ( topInfinite ) topZ = maxR;

    const pointA = new Point3d(A.x, A.y, topZ);
    const pointB = new Point3d(B.x, B.y, topZ);
    const pointC = new Point3d(A.x, A.y, bottomZ);
    const pointD = new Point3d(B.x, B.y, bottomZ);
    const surfacePlane = new Plane(new Point3d(0, 0, surfaceElevation), Shadow.upV);

    return origin.z > surfaceElevation
      ? Shadow.simpleSurfaceOriginAbove(pointA, pointB, pointC, pointD, origin, surfacePlane)
      : Shadow.simpleSurfaceOriginBelow(pointA, pointB, pointC, pointD, origin, surfacePlane);
  }

  /**
   * In top-down view, construct shadows for a token on the scene.
   * @param {Token} token               Token in the scene
   * @param {Point3d} origin            Viewer location in 3d space
   * @param {object} options
   * @param {number} [surfaceElevation] Elevation of the surface onto which to project shadows
   * @param {string} [type]             Wall restriction type, for token constrained border
   * @param {boolean} [halfHeight]      Whether to use half the token height
   * @returns {Shadow[]|null}
   */
//   static constructfromToken(token, origin, { surfaceElevation = 0, type = "sight", halfHeight = false } = {}) {
//     // If the viewer elevation equals the surface elevation, no shadows to be seen
//     if ( origin.z.almostEqual(surfaceElevation) ) return null;
//
//     // Need Token3dPoints to find the sides that face the origin.
//     const token3d = new TokenPoints3d(token, { type, halfHeight });
//     const { bottomZ, topZ } = token3d;
//
//     // Run simple tests to avoid further computation
//     // Viewer and the surface elevation both above the wall, so no shadow
//     if ( origin.z >= topZ && surfaceElevation >= topZ ) return null;
//
//     // Viewer and the surface elevation both below the wall, so no shadow
//     else if ( origin.z <= bottomZ && surfaceElevation <= bottomZ ) return null;
//
//     // Projecting downward from source; if below bottom of wall, no shadow.
//     else if ( origin.z >= surfaceElevation && origin.z <= bottomZ ) return null;
//
//     // Projecting upward from source; if above bottom of wall, no shadow.
//     else if ( origin.z <= surfaceElevation && origin.z >= topZ ) return null;
//
//     const sides = token3d._viewableSides(origin);
//
//     const shadows = [];
//     for ( const side of sides ) {
//       // Build a "wall" based on side points
//       // Need bottomZ, topZ, A, B
//       const wall = {
//         A: side.points[0],
//         B: side.points[3],
//         topZ,
//         bottomZ
//       };
//       const shadow = Shadow.constructFromWall(wall, origin, surfaceElevation);
//       if ( shadow ) shadows.push(shadow);
//     }
//
//     return shadows;
//   }

  /**
   * Draw a shadow shape on canvas. Used for debugging.
   * Optional:
   * @param {HexString} color   Color of outline shape
   * @param {number} width      Width of outline shape
   * @param {HexString} fill    Color used to fill the shape
   * @param {number} fillAlpha      Alpha transparency between 0 and 1
   */
  draw({ color = Draw.COLORS.gray, width = 1, fill = Draw.COLORS.gray, fillAlpha = .5 } = {} ) {
    Draw.shape(this, { color, width, fill, fillAlpha });
  }

  /**
   * Given a boundary polygon and an array of Shadows (holes), combine using Clipper.
   * @param {PIXI.Polygon} boundary   Polygon, such as an los polygon
   * @param {Shadow[]} shadows        Array of Shadows
   * @param {object} [options]    Options that vary Clipper results.
   * @param {number} [options.scalingFactor]  Scaling used for more precise clipper integers
   * @param {number} [options.cleanDelta]     Passed to ClipperLib.Clipper.CleanPolygons.
   * @returns {ClipperPaths|PIXI.Polygon} Array of Clipper paths representing the resulting combination.
   */
  static combinePolygonWithShadows(boundary, shadows, { scalingFactor = 1, cleanDelta = 0.1 } = {}) {
    if ( shadows instanceof PIXI.Polygon ) shadows = [shadows];

    if ( !shadows.length ) return boundary;

    const shadowPaths = ClipperPaths.fromPolygons(shadows, { scalingFactor });

    // Make all the shadow paths orient the same direction
    shadowPaths.paths.forEach(path => {
      if ( !ClipperLib.Clipper.Orientation(path) ) path.reverse();
    });

    const combinedShadowPaths = shadowPaths.combine();
    combinedShadowPaths.clean(cleanDelta);

    const out = combinedShadowPaths.diffPolygon(boundary);
    out.clean(cleanDelta);
    return out;
  }
}

/**
 *
 */
function wallPointSurfaceIntersection(A, origin, surfacePlane) {
  // Viewer is above top of the wall, so find origin --> A --> surface
  if ( origin.z > A.z ) return surfacePlane.lineSegmentIntersection(origin, A);

  // Viewer is below top of the wall, so find far point to use
  const maxR2 = Math.pow(canvas.dimensions.maxR, 2);
  const rA = Ray.towardsPointSquared(origin, A, maxR2);
  const pA = new Point3d(rA.B.x, rA.B.y, origin.z);
  return surfacePlane.lineIntersection(pA, Shadow.upV);
}
