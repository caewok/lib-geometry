/* globals
Hooks,
PIXI
*/
"use strict";

import { GEOMETRY_LIB_ID } from "../const.js";
import { WallGeometryTracker } from "../placeable_tracking/WallGeometryTracker.js";
import { TokenGeometryTracker } from "../placeable_tracking/TokenGeometryTracker.js";
import { TileGeometryTracker } from "../placeable_tracking/TileGeometryTracker.js";
import { RegionGeometryTracker } from "../placeable_tracking/RegionGeometryTracker.js";

Hooks.on("quenchReady", (quench) => {
  quench.registerBatch(
    "libGeometry.GeometryTracking",

  (context) => {
      const { describe, it, expect } = context;

// ----- NOTE: AABB2d.overlapsAABB -----
describe("Walls", () => {
  before(() => WallGeometryTracker.registerExistingPlaceables());

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.walls.placeables.forEach(wall => {
        const geom = wall[GEOMETRY_LIB_ID].geometry;
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });
});

describe("Tokens", () => {
  before(() => TokenGeometryTracker.registerExistingPlaceables());

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.tokens.placeables.forEach(token => {
        const geom = token[GEOMETRY_LIB_ID].geometry;
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });
});

describe("Tiles", () => {
  before(() => TileGeometryTracker.registerExistingPlaceables());

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.tiles.placeables.forEach(tile => {
        const geom = tile[GEOMETRY_LIB_ID].geometry;
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });
});

describe("Regions", () => {
  before(() => RegionGeometryTracker.registerExistingPlaceables());

  describe("Model Matrix", () => {
    // Region shapes have the model matrix
    it("should have numeric values", () => {
      canvas.regions.placeables.forEach(region => {
        for ( const shape of region.document.shapes ) {
          const geom = shape[GEOMETRY_LIB_ID].geometry;
          expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
         }
      });
    });
  });
});

},
{ displayName: "libGeometry: Geometry tracking" },
);

});


