/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../3d/Point3d.js";
import { Matrix } from "../Matrix.js";
import { SDF } from "./SDF.js";

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
export class RegionSDF extends SDF {

  // ----- NOTE: 2d SDFs ----- //
  
  static sdf2d(region) {
    // Combine the various region primitives, using union plus subtraction to remove holes.    
    // Could union all shapes at once, but would need separate hole handling.
    // Instead, follow logic of sdPolygon3dWithHoles.
    const shapes = region.document.shapes;
    if ( !shapes.length ) return _p => Number.POSITIVE_INFINITY;
    
    // TODO: More nuanced test for whether the walls actually restrict the current shape.
    const shapeSDFs = region.document.restriction.enabled 
      ? shapes.map(shape => this.sdfPolygons(shape.polygons))
        : shapes.map(shape => this.sdf2dForShape(shape));
        
    return p => {
      let d = shapeSDFs[0](p); // NOTE: Assumes no hole to start.
      for ( let i = 1, n = shapeSDFs.length; i < n; i += 1 ) {
        const op = shapes[i].hole ? "subtract" : "union";
        d = this[op](d, shapeSDFs[i](p));
      } 
      return d;  
    };
  }
  
  static sdf2dForShape(shapeData) {
    if ( shapeData.gridBased ) return this.sdfPolygons(shapeData.polygons);
  
    // shape.constructor.TYPES lists all shape types.
    switch ( shapeData.type ) {
      case "circle": return this._sdfRegionCircle(shapeData);
      case "cone": return this._sdfRegionCone(shapeData);
      case "emanation": return this._sdfRegionEmanation(shapeData);
      case "ellipse": return this._sdfRegionEllipse(shapeData);
      case "line": return this._sdfRegionLine(shapeData);
      case "polygon": return this.sdfPolygons(shapeData.polygons);
      case "rectangle": return this._sdfRegionRectangle(shapeData)
      case "ring": return this._sdfRegionRing(shapeData);
      
      case "grid": 
      case "token": 
      default: {
        console.warn(`Region shape type ${shapeData.type} not yet implemented. Using polygons.`);
        return this.sdfPolygons(shapeData.polygons);
      } 
    }
  }
  
  
  /**
   * Distance function for a region circle shape.
   * @param {CircleShapeData} shapeData			
   * @return {SDF} A function to measure distance from a point.
   */ 
  static _sdfRegionCircle(shapeData) {
    // Forgo garbage collection for speed of pre-allocated matrix.
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const txPt = PIXI.Point.tmp;
    const r = shapeData.radius;
    return p => {
       txMat.multiplyPoint3d(p, txPt);
       return this.sdCircle(txPt, r);
    }
  }
  
  /**
   * Distance function for a region rectangular shape.
   * @param {RectangleShapeData} shapeData
   * @return {SDF} A function to measure distance from a point.
   */
  static _sdfRegionRectangle(shapeData) {
    // rotation
    // width
    // height
    let w1_2;
    let h1_2;
    if ( shapeData instanceof foundry.data.LineShapeData ) {
      w1_2 = shapeData.length * 0.5;
      h1_2 = shapeData.width * 0.5;
    } else {
      w1_2 = shapeData.width * 0.5;
      h1_2 = shapeData.height * 0.5
    }
    
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    
    if ( shapeData.rotation === 0 ) {
      // Forgo garbage collection for speed of pre-allocated matrix.
      const txPt = PIXI.Point.tmp;
      const b = PIXI.Point.tmp.set(w1_2, h1_2);
      return p => {
        txMat.multiplyPoint2d(p, txPt);
        return this.sdRectangle(txPt, b);
      }
    }
    
    // TODO: Fix b/c rotation is around the TL corner.
    const ctr = shapeData.center;
    const a = PIXI.Point.tmp.set(ctr.x - w1_2, ctr.y);
    const b = PIXI.Point.tmp.set(ctr.x + w1_2, ctr.y);
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const M = rotMat.multiply3x3(txMat);
    M.multiplyPoint2d(a);
    M.multiplyPoint2d(b);
    return p => this.sdOrientedRectangle(p, a, b, h1_2);  
  }    
  
	/**
	 * Distance function for a region line shape.
	 * @param {LineShapeData} shapeData
	 * @return {SDF} A function to measure distance from a point.
	 */
	static _sdfRegionLine = this._sdfRegionRectangle;
  
  /**
   * Distance function for a region ellipse shape.
   * @param {EllipseShapeData} shapeData
   * @return {SDF} A function to measure distance from a point.
   */
  static _sdfRegionEllipse(shapeData) {
    // radiusX
    // radiusY
    // rotation
    const ab = PIXI.Point.tmp.set(shapeData.radiusX, shapeData.radiusY);
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const M = rotMat.multiply3x3(txMat);
    const txPt = PIXI.Point.tmp;
    return p => {
      M.multiplyPoint2d(p, txPt);
      return this.sdEllipse(p, ab);
    }
  }
  
  /**
   * Distance function for a region cone shape
   * @param {ConeShapeData} shapeData
   * @return {SDF} A function to measure distance from a point.
   */
  static _sdfRegionCone(shapeData) {
    // angle
    // curvature: flat, round, semicircle
    // radius
    // rotation
    
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const M = rotMat.multiply3x3(txMat);
    const txPt = PIXI.Point.tmp;
    
    switch ( shapeData.curvature ) {
      case "flat": {
        const theta_1_2 = Math.toRadians(shapeData.angle) * 0.5;
        const q = PIXI.Point.tmp.set(
          Math.tan(theta_1_2 * shapeData.radius), // Half-width of the base
          shapeData.radius, // Altitude
        );
        return p => {
          M.multiplyPoint2d(p, txPt);
          return this.sdTriangleIsosceles(txPt, q);
        }
      }
      case "round": {
        const theta_1_2 = Math.toRadians(shapeData.angle) * 0.5;
        const c = PIXI.Point.tmp.set(
          Math.sin(theta_1_2),
          Math.cos(theta_1_2),
        );
        const r = shapeData.radius;
        return p => {
          M.multiplyPoint2d(p, txPt);
          return this.sdPie(txPt, c, r);
        };
      }
      
      case "semicircle": {
        // Radius is the length from the cone point through the half-circle center to the half-circle edge.
        // Radius = h + r
        // h = s * cos(Ø/2)
        // Triangle's base is the diameter of the semi-circle, so r = h * tan(Ø/2)
        // H = h + r
        // H = h + h * tan(Ø/2) = h(1 + tan(Ø/2))
        // h = H / (1 + tan(Ø/2))
        const totalH = shapeData.radius;
        const theta = Math.toRadians(shapeData.angle);
        const h = totalH / (1 + Math.tan(theta / 2));
        const r = totalH - h;
        return p => {
          M.multiplyPoint2d(p, txPt);
          return this.sdConeSemiCircle(txPt, r, h);
        };
      }
    }
  }
  
  /**
   * Distance function for a region ring shape.
   * @param {RingShapeData} shapeData
   * @returns {number}
   */
  static _sdfRegionRing(shapeData) {
    // innerWidth
    // outerWidth
    // radius
    // rotation (unused?)
    // Total width is innerWidth - radius to radius + outerWidth
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const txPt = PIXI.Point.tmp;
    const outerRadius = shapeData.radius + shapeData.outerWidth;
    const width = shapeData.outerWidth - shapeData.innerWidth;
    return p => {
      txMat.multiplyPoint2d(p, txPt);
      const outerCircleFn = p => this.sdCircle(p, outerRadius);
      return this.opOnion(txPt, outerCircleFn, width);
    }
  }
  
  /**
   * Distance function for a region emanation shape (rounded rectangle).
   * @param {EmanationShapeData} shapeData
   * @returns {number}
   */
  static _sdfRegionEmanation(shapeData) {
    // base.height, base.width (e.g, 1, 2): number of grid spaces in each direction from center.
    // radius (of the corner)
    const txMat = Matrix.translate(-shapeData.x, -shapeData.y);
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const M = rotMat.multiply3x3(txMat);
    const txPt = PIXI.Point.tmp;
    
    const b = PIXI.Point.tmp.set(
      shapeData.base.width * canvas.grid.size,
      shapeData.base.height * canvas.grid.size,
    );
    const r = shapeData.radius;
    return p => {
      M.multiplyPoint2d(p, txPt);
      return this.sdRoundedRectangle(p, b, r);
    };
  }
  
  /**
   * Distance function for a region polygon shape.
   * @param {PolygonShapeData} shapeData
   * @returns {number}
   */
  static _sdfRegionPolygon(shapeData) {
    // points
    // rotation
    const rotMat = Matrix.rotationZ(-shapeData.rotation, false);
    const txPt = PIXI.Point.tmp;
    const poly = new PIXI.Polygon(shapeData.points);
    return p => {
      rotMat.multiplyPoint2d(p, txPt);
      return this.sdPolygon2d(txPt, poly);
    };
  }
  
  // ----- NOTE: 3d SDFs ----- //
  
  static sdf3d(region) {
    // Extrude all vertically. 
    // Add ramps and steps separately.
    // Before this, filter out non-TM plateaus if needed.
    const gridUnitsToPixels = CONFIG.GeometryLib.lib.utils.gridUnitsToPixels;
    
    
    // Extrude to either TM plateau, TM ramp/step bottom, or region elevation.
    const tm = region.terrainmapper;
    
    // TODO: Need to center the region correctly for the height. 
    const sdf2d = tm && tm.isSteps  
      ? tm.shapes.map(shape => this.sdf2dForShape(shape)) : this.sdf2d(region);
    
    if ( !tm || !tm.isElevated ) {
      const h = tm.finiteRegionHeight;
      return p => this.opExtrusion(p, sdf2d, h);
    }
    
    // Plateau
    if ( tm.isPlateau ) {
      const h = tm.finitePlateauHeight;
      return p => this.opExtrusion(p, sdf2d, h);      
    }
    
    // Ramp, single plane
    if ( !tm.rampStepSize && !tm.splitPolygons ) {
      const h = tm.finitePlateauHeight;
      const plane = tm.calculateSingleRampPlane();
      
      // Extrude a 3d shape to the top of the ramp, then cut the shape using the plane to form a ramp.
      // Depends on plane normal pointing up.
      return p => {
        const shapeDist = this.opExtrusion(p, sdf2d, h);
        const planeDist = this.sdFromPlane(p, plane);
        return this.intersection(shapeDist, planeDist);
      }
    }
    
    // Ramp, multi-plane
    if ( !tm.rampStepSize && tm.splitPolygons ) {
      const h = tm.finitePlateauHeight;
      const planes = tm.calculateMultiPolygonRampPlanes();
      
      // Extrude a 3d shape for each region shape, and intersect the corresponding plane.
      return p => {
        const dists = sdf2d.map((sdf, idx) => {
          const shapeDist = this.opExtrusion(p, sdf, h);
          const planeDist = this.sdFromPlane(p, planes[idx]);
          return this.intersection(shapeDist, planeDist);
        });
        return this.union(...dists);
      }
    }
    
    // Steps, single plane
    if ( tm.rampStepSize && !tm.splitPolygons ) {
      // Extrude a 3d shape to the bottom of the stairs, then union with extruded steps.
      // NOTE: Steps extruded depth-wise, not vertically.
      const n = tm.numSteps;
      const baseH = gridUnitsToPixels(tm.rampFloor) - tm.finiteRegionBottom;
      const stepsH = gridUnitsToPixels(tm.plateauElevation - tm.rampFloor);
      const rampPoints = tm._calculatePolygonRampPoints(region.polygons);
      const wh = PIXI.Point.tmp.set(
        PIXI.Point.distanceBetween(rampPoints[0], rampPoints[1]),
        rampPoints[1].z - rampPoints[0].z,
      );
      
      // Rotate to extrude steps perpendicular to canvas.
      const rotMat = Matrix.rotationX(Math.PI_1_2) // 90º rotation around X axis.
      const txMat = Matrix.translation(0, 0, baseH);
      const pTx = Point3d.tmp;
      
      // To determine how far the stairs have to go, can either:
      // 1. Rotate the polygons to align with the ramp direction and then get the top/bottom bounds
      // 2. Pick arbitrary extremely large spacing.
      
      // SDF is the combined 3d shape + steps.
      return p => {
        const baseShapeDist = this.opExtrusion(p, sdf2d, baseH);
        
        txMat.multiplyPoint3d(p, pTx)
        const stepShapeDist = this.opExtrusion(pTx, sdf2d, stepsH)
        
        // Rotate to extrude steps perpendicular to canvas.
        rotMat.multiplyPoint3d(pTx, pTx);
        const sdfSteps = this.sdStairs(pTx, wh, n);
        const stepsDist = this.opExtrusion(pTx, sdfSteps, 1e06);
        
        // Intersect steps with the underlying shape.
        // Then combine with the base.
        return this.union(
          baseShapeDist,
          this.intersection(stepShapeDist, stepsDist),
        );
      };
    }
    
    // Stairs, multi-plane
    if ( tm.rampStepSize && tm.splitPolygons ) {
      // Calculate for each polygon.
      const n = tm.numSteps;
      const baseH = gridUnitsToPixels(tm.rampFloor) - tm.finiteRegionBottom;
      const stepsH = gridUnitsToPixels(tm.plateauElevation - tm.rampFloor);
      const rampPoints = region.document.shapes.forEach(shape => tm._calculatePolygonRampPoints(shape.polygons));
      const wh = rampPoints.forEach(rp => {
				PIXI.Point.tmp.set(
					PIXI.Point.distanceBetween(rp[0], rp[1]),
					rp[1].z - rp[0].z,
				);
			});
      
      // Rotate to extrude steps perpendicular to canvas.
      const rotMat = Matrix.rotationX(Math.PI_1_2) // 90º rotation around X axis.
      const txMat = Matrix.translation(0, 0, baseH);
      const pTx = Point3d.tmp;
      
      return p => {
        const dists = sdf2d.map((sdf, idx) => {
					const baseShapeDist = this.opExtrusion(p, sdf, baseH);
					
					txMat.multiplyPoint3d(p, pTx)
					const stepShapeDist = this.opExtrusion(pTx, sdf, stepsH)
					
					// Rotate to extrude steps perpendicular to canvas.
					rotMat.multiplyPoint3d(pTx, pTx);
					const sdfSteps = this.sdStairs(pTx, wh[idx], n);
					const stepsDist = this.opExtrusion(pTx, sdfSteps, 1e06);
					
					// Intersect steps with the underlying shape.
					// Then combine with the base.
					return this.union(
						baseShapeDist,
						this.intersection(stepShapeDist, stepsDist),
					);          
        });
        return this.union(...dists);
      };
    }    
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
