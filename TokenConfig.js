/* globals
canvas,
CONFIG,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { GEOMETRY_LIB_ID, OTHER_MODULES } from "./const.js";
import { renderTemplateSync, pixelsToGridUnits } from "./util.js";

// Patches for the Wall Config
export const PATCHES = {};
PATCHES.TOKEN_HEIGHT = {};

function renderTokenConfig(app, html, data) {
  const WH = OTHER_MODULES.WALL_HEIGHT;
  const doc = app.document ?? app.token.document;
  const tokenVerticalHeight = doc.flags?.[WH.ID]?.[WH.FLAGS.TOKEN_HEIGHT] ?? null; // Null is calculated default.

  // Identify the modules that requested token height configuration.'
  const moduleNames = [...CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenHeightModules.values()].map(id => game.i18n.localize(`${id}.name`));

  const wm = CONFIG[GEOMETRY_LIB_ID].wallHeightManager;
  const myHTML = renderTemplateSync(wm.TEMPLATES.TOKEN_CONFIG, {
    ...data,
    [GEOMETRY_LIB_ID]: {
      moduleName: moduleNames.join("/"),
      tokenVerticalHeight,
      calculatedTokenVerticalHeight: pixelsToGridUnits(doc.verticalHeightZ),
      tokenVerticalHeightHint: `Height of the token along the z-axis. Leave blank to auto-calculate based on token size and scale.`,
    }
  });
  if ( !myHTML ) return;

  const container = document.createElement("div");
  container.innerHTML = myHTML;
  const divSet = html.querySelector("div[data-application-part='identity']");
  if ( !divSet ) return;
  divSet.appendChild(container);
  app.setPosition(app.position);
}

PATCHES.TOKEN_HEIGHT.HOOKS = {
  renderTokenConfig,
};