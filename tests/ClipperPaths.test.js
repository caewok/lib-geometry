/* globals
CONST,
PIXI,
*/
"use strict";

import { ClipperPaths } from "../ClipperPaths.js";
import { MODULE_ID } from "../../const.js";

export function registerTests(quench) {

  quench.registerBatch(
    `${MODULE_ID}.libGeometry.ClipperPaths`,
    (context) => {
      const { describe, it, before, expect } = context;

    describe("ClipperPaths Class", () => {
      let squarePoints;
      let scalingFactor;

      before(() => {
        scalingFactor = CONST.CLIPPER_SCALING_FACTOR || 1e6;
        // A 100x100 square at origin
        squarePoints = [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 }
        ];
      });

      // --- Initialization & Scaling ---
      describe("Constructor & Scaling", () => {
        it("should initialize with an empty array of paths by default", () => {
          const cp = new ClipperPaths();
          expect(cp.paths).to.be.an("array").that.is.empty;
        });

        it("should correctly update coordinates when scalingFactor is changed", () => {
          const cp = new ClipperPaths();
          cp.addPathPoints(squarePoints); // Internal: 100 * scale

          const initialX = cp.paths[0][1].X;
          const newScale = scalingFactor * 2;
          cp.scalingFactor = newScale;

          expect(cp.paths[0][1].X).to.equal(initialX * 2);
          expect(cp.scalingFactor).to.equal(newScale);
        });

        it("should throw an error if scaling factor is set to 0 or negative", () => {
          const cp = new ClipperPaths();
          expect(() => { cp.scalingFactor = 0; }).to.throw();
          expect(() => { cp.scalingFactor = -1; }).to.throw();
        });
      });

      // --- Conversion Helpers ---
      describe("Static Conversion Helpers", () => {
        it("should convert PIXI points to Clipper paths and back", () => {
          const path = ClipperPaths.pointsToPath(squarePoints, 1);
          expect(path[1]).to.deep.equal({ X: 100, Y: 0 });

          const backToPoints = ClipperPaths.pathToPoints(path, 1);
          expect(backToPoints[1].x).to.equal(100);
        });

        it("should flatten a path into a 1D array of numbers", () => {
          const path = [{ X: 10, Y: 20 }, { X: 30, Y: 40 }];
          const flattened = ClipperPaths.flattenPath(path);
          expect(flattened).to.deep.equal([10, 20, 30, 40]);
        });
      });

      // --- Geometry Logic ---
      describe("Geometry Operations", () => {
        it("should detect if a polygon is a rectangle", () => {
          // PIXI.Polygon expects a flat array: [x, y, x, y...]
          const poly = new PIXI.Polygon([0, 0, 100, 0, 100, 100, 0, 100, 0, 0]);
          const result = ClipperPaths.polygonToRectangle(poly);

          expect(result).to.be.an.instanceof(PIXI.Rectangle);
          expect(result.width).to.equal(100);
          expect(result.height).to.equal(100);
        });

        it("should correctly calculate the area of the paths", () => {
          const cp = new ClipperPaths();
          cp.addPathPoints(squarePoints);
          // Area of 100x100 square = 10000
          // Scaling factor affects internal area, but the getter should normalize it.
          expect(Math.abs(cp.area)).to.equal(10000);
        });

        it("should trim paths by area", () => {
          const cp = new ClipperPaths();
          cp.addPathPoints(squarePoints); // Area 10000
          cp.addPathPoints([{x:0,y:0}, {x:1,y:0}, {x:0,y:1}]); // Area 0.5

          const trimmed = cp.trimByArea(1);
          expect(trimmed.paths.length).to.equal(1);
        });
      });

      // --- Boolean Operations ---
      describe("Boolean / Clipper Operations", () => {
        it("should perform a union operation on overlapping paths", () => {
          const cp = new ClipperPaths();
          // Square 1: 0,0 to 100,100
          cp.addPathPoints(squarePoints);
          // Square 2: 50,0 to 150,100 (overlaps half)
          cp.addPathPoints([
            { x: 50, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 100 }, { x: 50, y: 100 }
          ]);

          const unioned = cp.union();
          // The result should be a single path representing a 150x100 rectangle
          expect(unioned.paths.length).to.equal(1);
          expect(Math.abs(unioned.area)).to.equal(15000);
        });

        it("should perform a difference operation against a polygon", () => {
          const cp = new ClipperPaths();
          cp.addPathPoints(squarePoints); // 100x100 square

          // Subject polygon: a 50x50 square in the corner
          const subject = new PIXI.Polygon([0, 0, 50, 0, 50, 50, 0, 50]);

          // Subtracting the 100x100 from the 50x50 results in nothing (or empty)
          // because the subject is entirely inside the clip paths.
          const diff = cp.diffPolygon(subject);
          expect(diff.paths.length).to.equal(0);
        });
      });

      // --- Advanced Features ---
      describe("Advanced Conversion", () => {
        it("should generate valid Earcut coordinates", () => {
          const cp = new ClipperPaths();
          cp.addPathPoints(squarePoints);
          const earcutData = cp.toEarcutCoordinates();

          expect(earcutData.vertices).to.have.lengthOf(8); // 4 points * 2 dims
          expect(earcutData.dimensions).to.equal(2);
        });

        it("should simplify a single path back to a PIXI geometry", () => {
          const cp = new ClipperPaths();
          cp.addPathPoints(squarePoints);
          const simplified = cp.simplify();

          // Square should simplify to a Rectangle
          expect(simplified).to.be.an.instanceof(PIXI.Rectangle);
        });
      });
    });
  }, {
    displayName: "ClipperPaths Unit Tests"
  });

}