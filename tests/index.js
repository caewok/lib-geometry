/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Import tests
import { registerTests as registerAABBTests } from "./AABB.test.js";
import { registerTests as registerClipperPathsTests } from "./ClipperPaths.test.js";
import { registerTests as registerPixelCacheTests } from "./PixelCache.test.js";
import { registerTests as registerPointTests } from "./Point.test.js";
import { registerTests as registerPoint3dTests } from "./Point3d.test.js";
import { registerTests as registerGeometryTrackingTests } from "./GeometryTracking.test.js";
import { registerTests as registerPolygonTests } from "./Polygon.test.js";
import { registerTests as registerVerticesTests } from "./Vertices.test.js";

export function registerTests(quench) {
  registerAABBTests(quench);
  registerClipperPathsTests(quench);
  registerPixelCacheTests(quench);
  registerPointTests(quench);
  registerPoint3dTests(quench);
  registerGeometryTrackingTests(quench);
  registerPolygonTests(quench);
  registerVerticesTests(quench);
}
