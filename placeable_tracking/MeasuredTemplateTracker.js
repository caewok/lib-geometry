/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { PlaceableTracker } from "./AbstractPlaceableTracker.js";

class AbstractMeasuredTemplateTracker extends PlaceableTracker {
  /** @type {string} */
  static PLACEABLE_NAME = "MeasuredTemplate";

  /** @type {string} */
  static layer = "templates";
}

export class MeasuredTemplatePositionTracker extends AbstractMeasuredTemplateTracker {
  /** @type {string} */
  static ID = "positionTracker";

  static DOCUMENT_KEYS = new Set([
    "x",
    "y",
    "elevation",
    "direction",
  ]);
}

export class MeasuredTemplateScaleTracker extends AbstractMeasuredTemplateTracker {
  /** @type {string} */
  static ID = "scaleTracker";

  static DOCUMENT_KEYS = new Set([
    "distance",
    "width",
  ]);
}

export class MeasuredTemplateShapeTracker extends AbstractMeasuredTemplateTracker {
  /** @type {string} */
  static ID = "shapeTracker";

  static DOCUMENT_KEYS = new Set([
    "t",
    "angle",
  ]);
}
