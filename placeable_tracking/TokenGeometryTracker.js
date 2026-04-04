/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableGeometryTracker } from "./PlaceableGeometryTracker.js";
import { TokenGeometry } from "../placeable_geometry/TokenGeometry.js";

export class TokenGeometryTracker extends PlaceableGeometryTracker {

  static DOCUMENT_NAME = "Token";

  static LAYER = "tokens";

  static GEOMETRY = TokenGeometry;

  static UPDATE_KEYS = new Set([
    ...TokenGeometry.TRACKER_TYPES.position,
    ...TokenGeometry.TRACKER_TYPES.scale,
    ...TokenGeometry.TRACKER_TYPES.shape,
  ]);

  // Pull out the position refresh flags separately.
  static REFRESH_KEYS = new Set(TokenGeometry.TRACKER_TYPES.refresh);
}


/* NOTE: Token documents change on refresh.

// On canvas load.
refreshToken|Original Token 1500,2300	source 1500,2300
refreshToken|Original Token 2300,2400	source 2300,2400

// Hover over token, drag
refreshToken|Preview Token 1100,2100	source 1100,2100
refreshToken|Preview Token 1100,2200	source 1100,2100
refreshToken|Preview Token 1100,2300	source 1100,2100
updateToken|Original Token 1100,2100	source 1100,2300

// Token animate from {1100,2100} -> {1100,2300}
moveToken|Original Token 1100,2100	source 1100,2300
refreshToken|Original Token 1100,2110.3199999964227	source 1100,2300
refreshToken|Original Token 1100,2121.5399999964234	source 1100,2300
refreshToken|Original Token 1100,2144.699999992847	source 1100,2300
refreshToken|Original Token 1100,2152.739999992848	source 1100,2300
refreshToken|Original Token 1100,2166.0599999892706	source 1100,2300
refreshToken|Original Token 1100,2185.5599999785422	source 1100,2300
refreshToken|Original Token 1100,2194.0199999785414	source 1100,2300
refreshToken|Original Token 1100,2222.699999978541	source 1100,2300
refreshToken|Original Token 1100,2230.259999964236	source 1100,2300
refreshToken|Original Token 1100,2246.339999957083	source 1100,2300
refreshToken|Original Token 1100,2251.379999946353	source 1100,2300
refreshToken|Original Token 1100,2265.839999935624	source 1100,2300
refreshToken|Original Token 1100,2300	source 1100,2300


*/
