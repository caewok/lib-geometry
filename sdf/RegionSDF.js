/* globals
canvas,
CONFIG,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Matrix } from "../Matrix.js";
import { SDFPlaceable } from "./SDF.js";
import { AABB2d } from "../AABB.js";

const TM_ID = "terrainmapper";

// ----- NOTE: ShapeData classes ----- //

class ShapeSDFAbstract extends SDFPlaceable {

  /** @type {RegionShapeData} */
  get shapeData() { return this.placeable; }

  get region() { return this.shapeData.parent.object; }

  get regionDocument() { return this.shapeData.parent; }

  get index() { return this.regionDocument.shapes.findIndex(elem => elem === this.shapeData); }

  get aabb2d() { return AABB2d.fromShape(this.shapeData); }

  /** @type {PIXI.Point} */
	get center() {
	  const ctr = this.shapeData.center;
	  return PIXI.Point.tmp.set(ctr.x, ctr.y);
	}

  get rotation() { return Math.toRadians(this.shapeData.rotation); }

  _translationRotationMatrix() {
    using center = this.center;
    using txMat = Matrix.translation(-center.x, -center.y);
    using rotMat = Matrix.rotationZ(-this.rotation, false);
    return rotMat.multiply3x3(txMat);
  }
}

class CircleShapeSDF extends ShapeSDFAbstract {

  get radius() { return this.shapeData.radius; }

  /**
   * Distance function for a region circle shape.
   * @return {SDF} A function to measure distance from a point.
   */
  sdf2d() {
    // Forgo garbage collection for speed of pre-allocated matrix.
    const txMat = this.translationMatrix2d;
    const txPt = PIXI.Point.tmp;
    const r = this.radius;
    return p => {
       txMat.multiplyPoint2d(p, txPt);
       return this.constructor.sdCircle(txPt, r);
    }
  }
}

class EllipseShapeSDF extends ShapeSDFAbstract {

  get radius() {  return PIXI.Point.tmp.set(this.shapeData.radiusX, this.shapeData.radiusY); }

  /**
   * Distance function for a region ellipse shape.
   * @return {SDF} A function to measure distance from a point.
   */
  sdf2d() {
    // Forgo garbage collection for speed of pre-allocated matrix.
    const ab = this.radius;
    const M = this._translationRotationMatrix();
    const txPt = PIXI.Point.tmp;
    return p => {
      M.multiplyPoint2d(p, txPt);
      return this.constructor.sdEllipse(p, ab);
    }
  }
}

class ConeShapeSDF extends ShapeSDFAbstract {

  get radius() { return this.shapeData.radius; }

  get angle() { return  Math.toRadians(this.shapeData.angle); }

  get curvature() { return this.shapeData.curvature; }

  /**
   * Distance function for a region cone shape
   * @return {SDF} A function to measure distance from a point.
   */
  sdf2d() {
    switch ( this.curvature ) {
      case "flat": return this._sdf2dConeFlat();
      case "round": return this._sdf2dConeRound();
      case "semicircle": return this._sdf2dConeSemiCircle();
    }
  }

  _sdf2dConeFlat() {
    const { angle, radius } = this;
    const M = this._translationRotationMatrix();
    const txPt = PIXI.Point.tmp;
		const theta_1_2 = angle * 0.5;
		const q = PIXI.Point.tmp.set(
			Math.tan(theta_1_2 * radius), // Half-width of the base
			radius, // Altitude
		);
		return p => {
			M.multiplyPoint2d(p, txPt);
			return this.constructor.sdTriangleIsosceles(txPt, q);
		}
  }

  _sdf2dConeRound() {
    const { angle, radius } = this;
		const theta_1_2 = angle * 0.5;
		const M = this._translationRotationMatrix();
    const txPt = PIXI.Point.tmp;
		const c = PIXI.Point.tmp.set(
			Math.sin(theta_1_2),
			Math.cos(theta_1_2),
		);
		return p => {
			M.multiplyPoint2d(p, txPt);
			return this.constructor.sdPie(txPt, c, radius);
		};
  }

  _sdf2dConeSemiCircle() {
		// Radius is the length from the cone point through the half-circle center to the half-circle edge.
		// Radius = h + r
		// h = s * cos(¯/2)
		// Triangle's base is the diameter of the semi-circle, so r = h * tan(¯/2)
		// H = h + r
		// H = h + h * tan(¯/2) = h(1 + tan(¯/2))
		// h = H / (1 + tan(¯/2))
		const { radius: totalH, angle: theta } = this;
		const M = this._translationRotationMatrix();
    const txPt = PIXI.Point.tmp;
		const h = totalH / (1 + Math.tan(theta / 2));
		const r = totalH - h;
		return p => {
			M.multiplyPoint2d(p, txPt);
			return this.constructor.sdConeSemiCircle(txPt, r, h);
		};
  }
}

class RectangleShapeSDF extends ShapeSDFAbstract {
  get width() { return this.shapeData.width; }

  get height() { return this.shapeData.height; }

  sdf2d() {
    const w1_2 = this.width * 0.5;
    const h1_2 = this.height * 0.5
    const txMat = this.translationMatrix2d;

    if ( this.rotation === 0 ) {
      // Forgo garbage collection for speed of pre-allocated matrix.
      const txPt = PIXI.Point.tmp;
      const b = PIXI.Point.tmp.set(w1_2, h1_2);
      return p => {
        txMat.multiplyPoint2d(p, txPt);
        return this.constructor.sdRectangle(txPt, b);
      }
    }

    // TODO: Fix b/c rotation is around the TL corner.
    using ctr = this.center;
    const a = PIXI.Point.tmp.set(ctr.x - w1_2, ctr.y);
    const b = PIXI.Point.tmp.set(ctr.x + w1_2, ctr.y);
    const rotMat = Matrix.rotationZ(-this.rotation, false);
    const M = rotMat.multiply3x3(txMat);
    M.multiplyPoint2d(a);
    M.multiplyPoint2d(b);
    return p => this.constructor.sdOrientedRectangle(p, a, b, h1_2);
  }

}

class LineShapeSDF extends RectangleShapeSDF {

  get width() { return this.shapeData.length; }

  get height() { return this.shapeData.width; }

}

class RingShapeSDF extends ShapeSDFAbstract {

  get outerWidth() { return this.shapeData.outerWidth; }

  get innerWidth() { return this.shapeData.innerWidth; }

  /**
   * Distance function for a region ring shape.
   * @returns {number}
   */
  sdf2d() {
    // innerWidth
    // outerWidth
    // radius
    // rotation (unused?)
    // Total width is innerWidth - radius to radius + outerWidth
    const { outerWidth, innerWidth, radius } = this;
    const txMat = this.translationMatrix2d;
    const txPt = PIXI.Point.tmp;
    const outerRadius = radius + outerWidth;
    const width = outerWidth - innerWidth;
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      const outerCircleFn = p => this.constructor.sdCircle(p, outerRadius);
      return this.opOnion(txPt, outerCircleFn, width);
    }
  }
}

// Emanation or rounded rectangle.
class EmanationShapeSDF extends ShapeSDFAbstract {

  get width() { return this.shapeData.base.width * canvas.grid.size; }

  get height() { return this.shapeData.base.height * canvas.grid.size; }

  get radius() { return this.shapeData.radius; }

  /**
   * Distance function for a region emanation shape (rounded rectangle).
   * @returns {number}
   */
  sdf2d() {
    // base.height, base.width (e.g, 1, 2): number of grid spaces in each direction from center.
    // radius (of the corner)
    const M = this._translationRotationMatrix();
    const txPt = PIXI.Point.tmp;
    const { width, height, radius } = this;
    const b = PIXI.Point.tmp.set(width, height);
    const r = radius;
    return p => {
      M.multiplyPoint2d(p, txPt);
      return this.constructor.sdRoundedRectangle(p, b, r);
    };
  }
}

class PolygonShapeSDF extends ShapeSDFAbstract {

  get points() { return this.shapeData.points; }

  /**
   * Distance function for a region polygon shape.
   * @returns {number}
   */
  static sdf2d() {
    // points
    // rotation
    const rotMat = Matrix.rotationZ(-this.rotation, false);
    const txPt = PIXI.Point.tmp;
    const poly = new PIXI.Polygon(this.points);
    return p => {
      rotMat.multiplyPoint2d(p, txPt);
      return this.constructor.sdPIXIPolygon(txPt, poly);
    };
  }
}

/**
 * This ignores an individual shape in favor of its polygons.
 */
class PolygonsShapeSDF extends ShapeSDFAbstract {

  get polygons() { return this.shapeData.polygons; }

  sdf2d() { return this.constructor.sdfPIXIPolygons(this.polygons); }
}

/**
 * This ignores the individual shapes in favor of the region.document.polygons.
 */
/*
class PolygonsRegionShapeSDF extends PolygonsShapeSDF {

  get region() { return this.placeable; }

  get polygons() { return this.region.polygons }

}
*/


const SHAPE_CLASS = {
  circle: CircleShapeSDF,
  ellipse: EllipseShapeSDF,
  cone: ConeShapeSDF,
  emanation: EmanationShapeSDF,
  line: LineShapeSDF,
  polygon: PolygonShapeSDF,
  rectangle: RectangleShapeSDF,
  ring: RingShapeSDF,
  polygons: PolygonsShapeSDF,

  // grid: GridShapeSDF,
  // token: TokenShapeSDF,
};

// ----- NOTE: Region class ----- //

/**
 * For regions, treat similarly to RegionGeometry; consider circles, rectangles, ellipses separately.
 * In v14, we have rotation for regions.
 * Shapes:
 * - circles
 * - rectangles
 * - ellipses
 * - polygons
 * - rings (only circular for now)
 * - lines, which are just rectangles defined slightly differently
 * - cones (flat (isoceles triangle), round, semicircle)
 * - emanations (rounded rectangles)
 *
 * These shapes are extruded to create the 3d region.
 * - plateau: simple extrusion
 * - ramp: extrusion + sideways extruded triangle
 * - steps: extrusion + sideways extruded steps
 */
export class RegionSDF extends SDFPlaceable {

  get region() { return this.placeable; }

  get shapes() { return this.region.document.shapes; }

  get aabb2d() { return AABB2d.fromRegion(this.region); }

  get isSingleShape() { return this.shapes.length === 1; }

  shapeSDFs = [];

  constructor(region) {
    super(region);
    this.initializeShapeSDFs();
  }

  initializeShapeSDFs() {
    this.shapeSDFs.length = 0;
    for ( const shapeData of this.shapes ) {
			const type = shapeData.gridBased ? "polygons" : shapeData.type;
			const cl = SHAPE_CLASS[type] || PolygonsShapeSDF;
			if ( !SHAPE_CLASS[type] ) console.warn(`Region shape type ${shapeData.type} not yet implemented. Using polygons.`);

			this.shapeSDFs.push(new cl(shapeData));
    }
  }

  // ----- NOTE: 2d SDFs ----- //

  /**
   * 2d signed distance function for this region.
   * @returns {function}
   */
  sdf2d() {
    const { region, shapes } = this;

    // Combine the various region primitives, using union plus subtraction to remove holes.
    // Could union all shapes at once, but would need separate hole handling.
    // Instead, follow logic of sdPolygon3dWithHoles.
    if ( !shapes.length ) return _p => Number.POSITIVE_INFINITY;

    // TODO: More nuanced test for whether the walls actually restrict the current shape.
    if ( region.document.restriction.enabled ) return this.constructor.sdfRegionPolygons(region.document.polygons);

    const shapeSDFs = this.shapeSDFs.map(obj => obj.sdf2d());
    return p => {
      let d = shapeSDFs[0](p); // NOTE: Assumes no hole to start.
      for ( let i = 1, n = shapeSDFs.length; i < n; i += 1 ) {
        const op = shapes[i].hole ? "subtraction" : "union";
        d = this.constructor[op](d, shapeSDFs[i](p));
      }
      return d;
    };
  }


  // ----- NOTE: 3d SDFs ----- //

  /**
   * 3d signed distance function for this region.
   * @returns {function}
   */
  sdf3d() {
    // Extrude all vertically.
    // Add ramps and steps separately.
    // Before this, filter out non-TM plateaus if needed.
    const region = this.region;
    const tm = region[TM_ID];

    // Extrude to either TM plateau, TM ramp/step bottom, or region elevation.

    // TODO: Need to center the region correctly for the height.
    const sdf2d = this.sdf2d();
    if ( !tm || !tm.isElevated ) return this._sdf3dBasicRegion(sdf2d);

    // Plateau
    if ( tm.isPlateau ) return this._sdf3dPlateau(sdf2d);

    // Ramp, single plane
    if ( !tm.rampStepSize && !tm.splitPolygons ) return this._sdf3dRamp(sdf2d);

    // Ramp, multi-plane
    if ( !tm.rampStepSize && tm.splitPolygons ) return this._sdf3dMultiPlaneRamp(sdf2d);

    // Steps, single plane
    if ( tm.rampStepSize && !tm.splitPolygons ) return this._sdf3dSteps(sdf2d);

    // Stairs, multi-plane
    if ( tm.rampStepSize && tm.splitPolygons ) return this._sdf3dMultiPlaneSteps(sdf2d);
  }

  /**
   * Convert a 2d sdf into a 3d shape for this region.
   * @param {SDF2d} sdf2d				The 2d region shape to use
   * @returns {SDF3d}
   */
  _sdf3dBasicRegion(sdf2d) {
    const h = this.region[TM_ID].finiteRegionHeight;
    const halfHeight = h * 0.5;
    return p => {
      using pTx = p.clone();
      pTx.z -= halfHeight;
      return this.constructor.opExtrusion(pTx, sdf2d, h);
    }
  }

  /**
   * Convert a 2d sdf into a plateau shape for this region.
   * @param {SDF2d} sdf2d				The 2d region shape to use
   * @returns {SDF3d}
   */
  _sdf3dPlateau(sdf2d) {
    const h = this.region[TM_ID].finitePlateauHeight;
    const halfHeight = h * 0.5;
    return p => {
      using pTx = p.clone();
      pTx.z -= halfHeight;
      return this.constructor.opExtrusion(pTx, sdf2d, h);
    }
  }

  /**
   * Convert a 2d sdf into a ramp shape for this region.
   * @param {SDF2d} sdf2d				The 2d region shape to use
   * @returns {SDF3d}
   */
  _sdf3dRamp(sdf2d) {
    const tm = this.region[TM_ID];
		const h = tm.finitePlateauHeight;
		const halfHeight = h * 0.5;
		const plane = tm.calculateSingleRampPlane();

		// Extrude a 3d shape to the top of the ramp, then cut the shape using the plane to form a ramp.
		// Depends on plane normal pointing up.
		return p => {
		  using pTx = p.clone();
      pTx.z -= halfHeight;
			const shapeDist = this.constructor.opExtrusion(pTx, sdf2d, h);
			const planeDist = this.constructor.sdFromPlane(p, plane);
			return this.constructor.intersection(shapeDist, planeDist);
		}
  }

  /**
   * Convert a 2d sdf into a ramp shape for this region, where each shape has a distinct ramp.
   * @param {SDF2d} sdf2d				The 2d region shape to use
   * @returns {SDF3d}
   */
  _sdf3dMultiPlaneRamp(sdf2d) {
    const tm = this.region[TM_ID];
		const h = tm.finitePlateauHeight;
		const halfHeight = h * 0.5;
		const planes = tm.calculateMultiPolygonRampPlanes();

		// Extrude a 3d shape for each region shape, and intersect the corresponding plane.
		return p => {
			const dists = sdf2d.map((sdf, idx) => {
			  using pTx = p.clone();
        pTx.z -= halfHeight;
				const shapeDist = this.constructor.opExtrusion(pTx, sdf, h);
				const planeDist = this.constructor.sdFromPlane(p, planes[idx]);
				return this.constructor.intersection(shapeDist, planeDist);
			});
			return this.constructor.union(...dists);
		}
  }

  /**
   * Convert a 2d sdf into a steps shape for this region.
   * @param {SDF2d} sdf2d				The 2d region shape to use
   * @returns {SDF3d}
   */
  _sdf3dSteps(sdf2d) {
    const tm = this.region[TM_ID];

		// Extrude a 3d shape to the bottom of the stairs, then union with extruded steps.
		// NOTE: Steps extruded depth-wise, not vertically.
		const n = tm.numSteps;
		const gridUnitsToPixels = CONFIG.GeometryLib.lib.utils.gridUnitsToPixels;
		const baseH = gridUnitsToPixels(tm.rampFloor) - tm.finiteRegionBottom;
		const stepsH = gridUnitsToPixels(tm.plateauElevation - tm.rampFloor);
		const rampPoints = tm._calculatePolygonRampPoints(this.region.document.polygons);
		const halfBaseHeight = baseH * 0.5;
		const halfStepsHeight = stepsH * 0.5;
		const wh = PIXI.Point.tmp.set(
			PIXI.Point.distanceBetween(rampPoints[0], rampPoints[1]),
			rampPoints[1].z - rampPoints[0].z,
		);

		// Rotate to extrude steps perpendicular to canvas.
		const rotMat = Matrix.rotationX(Math.PI_1_2) // 90¼ rotation around X axis.
		const txMat = Matrix.translation(0, 0, baseH);

		// To determine how far the stairs have to go, can either:
		// 1. Rotate the polygons to align with the ramp direction and then get the top/bottom bounds
		// 2. Pick arbitrary extremely large spacing.

		// SDF is the combined 3d shape + steps.
		return p => {
      using pTx = p.clone();
      pTx.z -= halfBaseHeight;
			const baseShapeDist = this.constructor.opExtrusion(pTx, sdf2d, baseH);

      pTx.z = p.z - halfStepsHeight;
			txMat.multiplyPoint3d(pTx, pTx)
			const stepShapeDist = this.constructor.opExtrusion(pTx, sdf2d, stepsH)

			// Rotate to extrude steps perpendicular to canvas.
			rotMat.multiplyPoint3d(pTx, pTx);
			const sdfSteps = this.constructor.sdStairs(pTx, wh, n);
			const stepsDist = this.constructor.opExtrusion(pTx, sdfSteps, 1e06);

			// Intersect steps with the underlying shape.
			// Then combine with the base.
			return this.constructor.union(
				baseShapeDist,
				this.intersection(stepShapeDist, stepsDist),
			);
		};
  }

  /**
   * Convert a 2d sdf into a steps shape for this region, where each shape has distinct steps.
   * @param {SDF2d} sdf2d				The 2d region shape to use
   * @returns {SDF3d}
   */
  _sdf3dMultiPlaneSteps(sdf2d) {
    const tm = this.region[TM_ID];

		// Calculate for each polygon.
		const n = tm.numSteps;
		const gridUnitsToPixels = CONFIG.GeometryLib.lib.utils.gridUnitsToPixels;
		const baseH = gridUnitsToPixels(tm.rampFloor) - tm.finiteRegionBottom;
		const stepsH = gridUnitsToPixels(tm.plateauElevation - tm.rampFloor);
		const halfBaseHeight = baseH * 0.5;
		const halfStepsHeight = stepsH * 0.5;
		const rampPoints = this.region.document.shapes.forEach(shape => tm._calculatePolygonRampPoints(shape.polygons));
		const wh = rampPoints.forEach(rp => {
			PIXI.Point.tmp.set(
				PIXI.Point.distanceBetween(rp[0], rp[1]),
				rp[1].z - rp[0].z,
			);
		});

		// Rotate to extrude steps perpendicular to canvas.
		const rotMat = Matrix.rotationX(Math.PI_1_2) // 90¼ rotation around X axis.
		const txMat = Matrix.translation(0, 0, baseH);

		return p => {
		  using pTx = p.clone();
      pTx.z -= halfBaseHeight;

			const dists = sdf2d.map((sdf, idx) => {
				const baseShapeDist = this.constructor.opExtrusion(pTx, sdf, baseH);

        pTx.z = p.z - halfStepsHeight;
				txMat.multiplyPoint3d(pTx, pTx)
				const stepShapeDist = this.constructor.opExtrusion(pTx, sdf, stepsH)

				// Rotate to extrude steps perpendicular to canvas.
				rotMat.multiplyPoint3d(pTx, pTx);
				const sdfSteps = this.constructor.sdStairs(pTx, wh[idx], n);
				const stepsDist = this.constructor.opExtrusion(pTx, sdfSteps, 1e06);

				// Intersect steps with the underlying shape.
				// Then combine with the base.
				return this.constructor.union(
					baseShapeDist,
					this.constructor.intersection(stepShapeDist, stepsDist),
				);
			});
			return this.constructor.union(...dists);
		};
  }
}



/* Testing
AABB2d = CONFIG.GeometryLib.lib.AABB2d
Draw = CONFIG.GeometryLib.lib.Draw
Point3d = CONFIG.GeometryLib.lib.threeD.Point3d
Matrix = CONFIG.GeometryLib.lib.Matrix
SDF = CONFIG.GeometryLib.lib.sdf.SDF
RegionSDF = CONFIG.GeometryLib.lib.sdf.RegionSDF
TileSDF = CONFIG.GeometryLib.lib.sdf.TileSDF
TokenSDF = CONFIG.GeometryLib.lib.sdf.TokenSDF

cir1 = new PIXI.Circle(50, 50, 100)
cir2 = new PIXI.Circle(120, 50, 80)
Draw.shape(cir1, { color: Draw.COLORS.blue })
Draw.shape(cir2, { color: Draw.COLORS.green })

txMat1 = Matrix.translation(-cir1.x, -cir1.y)
txPt = PIXI.Point.tmp
prim1 = p => {
  txMat1.multiplyPoint2d(p, txPt);
  return SDF.sdCircle(txPt, cir1.radius);
}
aabb1 = AABB2d.fromCircle(cir1)
aabb1.pad({ x: 20, y: 20 });

SDF.drawHeatmap2d(prim1, aabb1)
Draw.shape(cir1, { color: Draw.COLORS.black })

txMat2 = Matrix.translation(-cir2.x, -cir2.y)
prim2 = p => {
  txMat2.multiplyPoint2d(p, txPt);
  return SDF.sdCircle(txPt, cir2.radius);
}
aabb2 = AABB2d.fromCircle(cir2)
aabb2.pad({ x: 20, y: 20 });
SDF.drawHeatmap2d(prim2, aabb2)
Draw.shape(cir2, { color: Draw.COLORS.black })


// combined
aabb = AABB2d.union([aabb1, aabb2])
prim = p => SDF.union(prim1(p), prim2(p))
SDF.drawHeatmap2d(prim, aabb)
Draw.shape(cir1, { color: Draw.COLORS.black })
Draw.shape(cir2, { color: Draw.COLORS.black })
*/
