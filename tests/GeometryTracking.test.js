/* globals
canvas,
CONFIG,
*/
"use strict";

import { MODULE_ID } from "../../const.js";
import { GEOMETRY_LIB_ID } from "../const.js";

export function registerTests(quench) {
  quench.registerBatch(
    `${MODULE_ID}.libGeometry.GeometryTracking`,

  (context) => {
      const { describe, it, expect, before } = context;

// ----- NOTE: AABB2d.overlapsAABB -----
describe("Walls", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.walls ) {
      mgr.types.push("walls");
      mgr.walls = new mgr.constructor.GEOMETRY_MANAGERS.walls;
      mgr.walls.registerHooks();
      mgr.walls.initializeScene();
    }
  });

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.walls.placeables.forEach(wall => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.walls.geomForPlaceable(wall);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });
});

describe("Tokens", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.tokens ) {
      mgr.types.push("tokens");
      mgr.tokens = new mgr.constructor.GEOMETRY_MANAGERS.token;
      mgr.tokens.registerHooks();
      mgr.tokens.initializeScene();
    }
  });

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.tokens.placeables.forEach(token => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.tokens.geomForPlaceable(token);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });
});

describe("Tiles", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.tiles ) {
      mgr.types.push("tile");
      mgr.tiles = new mgr.constructor.GEOMETRY_MANAGERS.tiles;
      mgr.tiles.registerHooks();
      mgr.tiles.initializeScene();
    }
  });

  describe("Model Matrix", () => {
    it("should have numeric values", () => {
      canvas.tiles.placeables.forEach(tile => {
        const geom = CONFIG[GEOMETRY_LIB_ID].geometryManager.tiles.geomForPlaceable(tile);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });
});

describe("Regions", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.regions ) {
      mgr.types.push("regions");
      mgr.regions = new mgr.constructor.GEOMETRY_MANAGERS.regions;
      mgr.regions.registerHooks();
      mgr.regions.initializeScene();
    }
  });

  describe("Model Matrix", () => {
    // Region shapes have the model matrix
    it("should have numeric values", () => {
      canvas.regions.placeables.forEach(region => {
        const geom = mgr.regions.geomForPlaceable(region);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.regions.placeables.forEach(region => {
        const geom = mgr.regions.geomForPlaceable(region);
        expect(isFinite(geom.aabb.min.x)).to.be.true;
        expect(isFinite(geom.aabb.min.y)).to.be.true;
        expect(Number.isNumeric(geom.aabb.min.z)).to.be.true;
        expect(isFinite(geom.aabb.max.x)).to.be.true;
        expect(isFinite(geom.aabb.max.y)).to.be.true;
        expect(Number.isNumeric(geom.aabb.max.z)).to.be.true;
      });
    });

  });
});

describe("Levels", () => {
  let mgr;
  before(() => {
    mgr = CONFIG[GEOMETRY_LIB_ID].geometryManager;
    if ( !mgr.level ) {
      mgr.types.push("levels");
      mgr.levels.background = new mgr.constructor.GEOMETRY_MANAGERS.backgroundLevels;
      mgr.levels.background.registerHooks();
      mgr.levels.background.initializeScene();

      mgr.levels.foreground = new mgr.constructor.GEOMETRY_MANAGERS.foregroundLevels;
      mgr.levels.foreground.registerHooks();
      mgr.levels.foreground.initializeScene();
    }
  });

  describe("Model Matrix", () => {
    // Region shapes have the model matrix
    it("should have numeric values", () => {
      canvas.scene.levels.forEach(levelD => {
        const geom = mgr.levels.background.geomForPlaceableDocument(levelD);
        expect(geom.modelMatrix.model.arr.every(elem => Number.isNumeric(elem))).to.be.true;
      });
    });
  });

  describe("AABB", () => {
    it("should have numeric values", () => {
      canvas.scene.levels.forEach(levelD => {
        const geom = mgr.levels.geomForPlaceableDocument(levelD);
        expect(isFinite(geom.aabb.min.x)).to.be.true;
        expect(isFinite(geom.aabb.min.y)).to.be.true;
        expect(Number.isNumeric(geom.aabb.min.z)).to.be.true;
        expect(isFinite(geom.aabb.max.x)).to.be.true;
        expect(isFinite(geom.aabb.max.y)).to.be.true;
        expect(Number.isNumeric(geom.aabb.max.z)).to.be.true;
      });
    });

  });
});

},
{ displayName: "libGeometry: Geometry tracking" },
);

}


