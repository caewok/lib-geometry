/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { GEOMETRY_LIB_ID, OTHER_MODULES } from "./const.js";
import { renderTemplateSync } from "./util.js";

// Patches for the Wall Config
export const PATCHES = {};
PATCHES.WALL_HEIGHT = {};

function renderWallConfig(app, html, data) {
  const WH = OTHER_MODULES.WALL_HEIGHT;
  const doc = app.document ?? app.wall.document;
  const elev = doc.flags?.[WH.ID] ?? { top: null, bottom: null }; // Null is default ∞/-∞

  // Identify the modules that requested token height configuration.'
  const moduleNames = [...CONFIG[GEOMETRY_LIB_ID].CONFIG.wallHeightModules.values()].map(id => game.i18n.localize(`${id}.nameAbbr`));

  const wm = CONFIG[GEOMETRY_LIB_ID].wallHeightManager;
  const myHTML = renderTemplateSync(wm.TEMPLATES.WALL_CONFIG, {
    ...data,
    [GEOMETRY_LIB_ID]: { top: elev.top, bottom: elev.bottom, moduleName: `${moduleNames.join("/")}: Elevation` },
  });
  if ( !myHTML ) return;

  const container = document.createElement("div");
  container.innerHTML = myHTML;
  const divSet = html.querySelector("div[data-application-part='body']");
  if ( !divSet ) return;
  divSet.appendChild(container);
  app.setPosition(app.position);
}

PATCHES.WALL_HEIGHT.HOOKS = {
  renderWallConfig
};