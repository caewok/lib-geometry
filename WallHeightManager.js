/* globals
canvas,
CONFIG,
foundry,
game,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { GEOMETRY_LIB_ID } from "./const.js";
import { registerWallHeight, registerTokenHeight } from "./patching.js";

// Patches required.
export const PATCHES = {};
PATCHES.WALL_HEIGHT = {};

/**
 * Wall height labels for FoundryVTT (v13/v14).
 *
 * Displays the top/bottom elevation of walls on the canvas while:
 *   - the current user is a GM,
 *   - the Walls layer is active, and
 *   - the "Wall Heights" toolbar toggle is enabled.
 *
 * Heights are read from wall.document.flags["wall-height"].top / .bottom.
 * null / undefined / ±Infinity are treated as unbounded and not displayed.
 * If neither bound is finite, no label is drawn for that wall.
 *
 * Performance notes (scenes can have thousands of walls):
 *   - A PIXI.Text owns its own canvas and GPU texture, so each distinct string
 *     ("▲", "▼", "10", "-5", ...) is rendered to a Text exactly once and cached.
 *     Labels are built from lightweight PIXI.Sprites that share those textures.
 *   - Labels exist only while they are visible (GM, walls layer active, toggle on).
 *     Otherwise they are destroyed, and they are rebuilt when shown again.
 *   - A wall refresh that does not change top/bottom just repositions its label.
 *
 * Change MODULE_ID to your module's id.
 */

/* -------------------------------------------- */
/*  NOTE: Shared texture cache                  */
/* -------------------------------------------- */

/**
 * Renders each distinct string once and hands out the resulting texture.
 * Sprites that use these textures must not destroy them.
 */
class LabelTextures {
  /** @type {Map<string, PIXI.Text>} */
  static #sources = new Map();

  /** @type {Map<string, {top: number, bottom: number}>} */
  static #ink = new Map();

  static get fontSize() {
    const size = canvas.grid?.size ?? 100;
    return Math.max(16, Math.round(size * 0.2));
  }

  static createTextStyle() {
    return new PIXI.TextStyle({
      fontFamily: CONFIG.defaultFontFamily ?? "Signika",
      fontSize: this.fontSize,
      fill: 0xFFFFFF,
      stroke: 0x000000,
      strokeThickness: 4,
      lineJoin: "round"
    });
  }

/**
   * Vertical extent of the drawn pixels for a string, in texture coordinates
   * (the same units as sprite.height).
   * @param {string} str
   * @returns {{top: number, bottom: number}}
   */
  static inkBounds(str) {
    let bounds = this.#ink.get(str);
    if ( bounds ) return bounds;

    this.get(str); // Ensure the source Text exists and is rendered.
    const source = this.#sources.get(str);
    const { width, height } = source.canvas;
    const res = source.resolution || 1;
    const data = source.context.getImageData(0, 0, width, height).data;

    // Find the first and last pixel rows containing visible pixels.
    let top = -1;
    let bottom = -1;
    for ( let y = 0; y < height; y += 1 ) {
      let hasInk = false;
      for ( let x = 0; x < width; x += 1 ) {
        if ( data[((y * width) + x) * 4 + 3] > 16 ) { hasInk = true; break; }
      }
      if ( !hasInk ) continue;
      if ( top < 0 ) top = y;
      bottom = y + 1;
    }
    if ( top < 0 ) { top = 0; bottom = height; } // No ink found; fall back to the full texture.

    bounds = { top: top / res, bottom: bottom / res };
    this.#ink.set(str, bounds);
    return bounds;
  }

  /**
   * Get the shared texture for a string, rendering it on first use.
   * @param {string} str
   * @returns {PIXI.Texture}
   */
  static get(str) {
    let source = this.#sources.get(str);
    if ( !source ) {
      source = new PIXI.Text(str, this.createTextStyle());
      this.#sources.set(str, source); // Never added to the stage; it only owns the texture.
      source.updateText(false); // Force the canvas to render. False = ignore the dirty flag.
    }
    // In PixiJS v7 (Foundry v13) Text is a Sprite, and its texture is rendered on access.
    // PixiJS v8 would be:
    //   return canvas.app.renderer.generateTexture({ target: source });
    return source.texture;
  }

  /** Destroy all cached textures. Call only when no sprites are using them (e.g., a new canvas). */
  static clear() {
    for ( const source of this.#sources.values() ) source.destroy();
    this.#sources.clear();
  }
}


/**
 * Handle wall elevation, configuration, and use.
 * Also handles related token vertical heights.
 * Replacement for deprecated Wall Height module.
 */
export class WallHeightManager {

  static get TEMPLATES() {
    return {
      WALL_CONFIG: `modules/${CONFIG[GEOMETRY_LIB_ID].CONFIG.controllingModule}/scripts/geometry/templates/wall-config.html`,
      TOKEN_CONFIG: `modules/${CONFIG[GEOMETRY_LIB_ID].CONFIG.controllingModule}/scripts/geometry/templates/token-config.html`,
    };
  }

  static initialize({ wallElevations = true, tokenVerticalHeights = true } = {}) {
    foundry.applications.handlebars.loadTemplates(Object.values(this.TEMPLATES)).then(_value => console.debug("Templates loaded."));
    if ( wallElevations ) registerWallHeight();
    if ( tokenVerticalHeights ) registerTokenHeight();
  }

  // ----- NOTE: Wall label manager ----- //

  /** @type {PIXI.Container|null} */
  static container = null;

  /** @type {Map<Wall, PIXI.Container>} */
  static labels = new Map();

  /** Have labels been built for all walls since they were last cleared? */
  static populated = false;

  /** Is the display currently enabled by the toolbar toggle? */
  static showHeights = true;

  static get enabled() {
    return Boolean(game.user.isGM && canvas.walls?.active && this.showHeights);
  }

  /** Read a finite height from the wall flags, or null if unbounded. */
  static getHeight(wall, key) {
    const value = wall.document.flags?.["wall-height"]?.[key];
    if ( value === null || value === undefined ) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  // ----- NOTE: Canvas lifecycle ----- //

  /** Create the container that holds all labels, as a child of the walls layer. */
  static initContainer() {
    if ( this.container && !this.container.destroyed ) this.container.destroy({ children: true });

    this.labels.clear();
    this.populated = false;
    LabelTextures.clear(); // Font size depends on the scene's grid size.

    const layer = canvas.walls;
    if ( !layer ) return;
    const container = new PIXI.Container();
    container.eventMode = "none";
    container.zIndex = 1000;
    container.visible = false;
    layer.sortableChildren = true;
    layer.addChild(container);
    this.container = container;
  }

  static teardown() {
    this.labels.clear();
    this.populated = false;
    this.container = null; // Destroyed along with the walls layer.
  }

  // ----- NOTE: Label construction ----- //

  /**
   * Create a label from shared textures. The container's pivot is set to its
   * center, so positioning it places the whole label on that point.
   * Markers form a left-aligned column; values are right-aligned to a common edge.
   * @param {number|null} top
   * @param {number|null} bottom
   * @returns {PIXI.Container}
   */
  static createLabel(top, bottom) {
    const label = new PIXI.Container();
    label.top = top;
    label.bottom = bottom;

    const rows = [];
    if ( top !== null ) rows.push(["▲", String(top), true]);
    if ( bottom !== null ) rows.push(["▼", String(bottom), false]);

    const gap = Math.round(LabelTextures.fontSize * 0.4);
    const markers = [];
    const values = [];
    for ( const [markerStr, valueStr] of rows ) {
      const marker = new PIXI.Sprite(LabelTextures.get(markerStr));
      const value = new PIXI.Sprite(LabelTextures.get(valueStr));
      value.anchor.set(1, 0); // Right-align the number to its x position.
      label.addChild(marker, value);
      markers.push(marker);
      values.push(value);
    }

    const markerWidth = Math.max(...markers.map(m => m.width));
    const valueWidth = Math.max(...values.map(v => v.width));
    const lineHeight = Math.max(...markers.map(m => m.height), ...values.map(v => v.height));
    const rightEdge = markerWidth + gap + valueWidth;

    rows.forEach(([markerStr, valueStr, isTop], i) => {
      const y = i * lineHeight;
      const m = LabelTextures.inkBounds(markerStr);
      const v = LabelTextures.inkBounds(valueStr);

      // Top row: align the bottoms of the triangle and number.
      // Bottom row: align the tops of the triangle and number.
      const dy = isTop ? (m.bottom - v.bottom) : (m.top - v.top);

      markers[i].position.set(0, y);
      values[i].position.set(rightEdge, y + dy);
    });

    label.pivot.set(rightEdge / 2, (rows.length * lineHeight) / 2);
    return label;
  }

  // ----- NOTE: Per-wall updates ----- //

  /** Create, update, or remove the label for a single wall. */
  static updateWall(wall) {
    if ( !this.enabled || !this.populated ) return; // Labels are built lazily in populate().
    if ( !this.container || this.container.destroyed ) return;
    if ( !wall || wall.destroyed || wall.isPreview || !wall.document?.id ) return;

    const top = this.getHeight(wall, "top");
    const bottom = this.getHeight(wall, "bottom");
    if ( top === null && bottom === null ) {
      this.removeWall(wall);
      return;
    }

    // Rebuild the label only if the heights changed.
    let label = this.labels.get(wall);
    if ( !label || label.destroyed || label.top !== top || label.bottom !== bottom ) {
      this.removeWall(wall);
      label = this.createLabel(top, bottom);
      this.container.addChild(label);
      this.labels.set(wall, label);
    }

    const { x, y } = wall.center;
    label.position.set(x, y);
  }

  static removeWall(wall) {
    const label = this.labels.get(wall);
    if ( !label ) return;
    // Destroy the sprites but not the shared textures (the default for Sprite#destroy).
    if ( !label.destroyed ) label.destroy({ children: true });
    this.labels.delete(wall);
  }

  // ----- NOTE: Bulk updates and visibility ----- //

  /** Build labels for every wall. */
  static populate() {
    this.populated = true;
    for ( const wall of canvas.walls.placeables ) this.updateWall(wall);
  }

  /** Destroy all labels. */
  static clearLabels() {
    for ( const label of this.labels.values() ) {
      if ( !label.destroyed ) label.destroy({ children: true });
    }
    this.labels.clear();
    this.populated = false;
  }

  /**
   * Bring the display in line with the current state: build labels when they
   * should be shown, and free them when they should not.
   */
  static sync() {
    if ( !canvas.ready || !canvas.walls ) return;
    if ( !this.container || this.container.destroyed ) return;
    if ( this.enabled ) {
      this.container.visible = true;
      if ( !this.populated ) this.populate();
    } else {
      this.container.visible = false;
      if ( this.populated ) this.clearLabels();
    }
  }

  /** Rebuild every label from scratch. */
  static refreshAll() {
    this.clearLabels();
    this.sync();
  }
}

// ----- NOTE: Canvas lifecycle and hooks ----- //

function getSceneControlButtons(controls) {
  if ( !game.user.isGM ) return;
  const walls = controls.walls ?? controls.find?.(c => c.name === "walls");
  if ( !walls ) return;

  const tool = {
    name: "wallHeights",
    title: "Show Wall Heights",
    icon: "fa-solid fa-arrows-up-down",
    toggle: true,
    active: true,
    order: Object.keys(walls.tools ?? {}).length,
    onChange: (_event, active) => {
      WallHeightManager.showHeights = active;
      WallHeightManager.sync();
    },
  };

  if ( Array.isArray(walls.tools) ) walls.tools.push(tool);
  else walls.tools.wallHeights = tool;
}

PATCHES.WALL_HEIGHT.HOOKS = {
  getSceneControlButtons,

  canvasReady: () => {
    WallHeightManager.initContainer();
    WallHeightManager.sync();
  },
  canvasTearDown: () => WallHeightManager.teardown(),

  refreshWall: wall => WallHeightManager.updateWall(wall),
  updateWall: wallD => WallHeightManager.updateWall(wallD.object),
  deleteWall: wallD => {
    if ( wallD.object ) WallHeightManager.removeWall(wallD.object);
  },

  // Show/hide when active layer changes.
  renderSceneControls: () => WallHeightManager.sync(),
  activateCanvasLayer: () => WallHeightManager.sync(),
  deactivateCanvasLayer: () => WallHeightManager.sync(),
};
