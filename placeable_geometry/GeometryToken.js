/* globals
canvas,
CONFIG,
CONST,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractInstancedVertices, AbstractModelVerticesMixin, VertexObject } from "./GeometryDesc.js";
import { Rectangle3dVertices, Polygon3dVertices, Hex3dVertices, SphereVertices, Ellipse3dVertices } from "./BasicVertices.js";
import { GEOMETRY_LIB_ID } from "../const.js";
import { mix } from "../mixwith.js";

export class TokenInstancedVertices extends AbstractInstancedVertices {

  static type = "Token";

  static shapeForToken(token) {
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) return "spherical";
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useChosenTokenShape ) return token.document.shape;

    // Per token#getShape
    // Gridless: ellipses or rectangles.
    const TS = CONST.TOKEN_SHAPES;
    if ( canvas.grid.isGridless ) {
      if ( token.document.shape === TS.TRAPEZOID_1
        || token.document.shape === TS.TRAPEZOID_2 ) return TS.RECTANGLE_1;
      return token.document.shape;
    }

    // Hex grids: only hexes.
    if ( canvas.grid.isHexagonal ) return token.document.shape === TS.TRAPEZOID_2
      ? TS.TRAPEZOID_2 : TS.TRAPEZOID_1;

    // Square grids: only rectangles.
    return token.document.shape === TS.RECTANGLE_2 ? TS.RECTANGLE_2 : TS.RECTANGLE_1;
  }

  static _optionsForPlaceable(token, opts = {}) {
    const TS = CONST.TOKEN_SHAPES;
    opts.shape = this.shapeForToken(token);
    switch ( opts.shape ) {
      case "spherical":
        opts.density = SphereVertices.defaultDensityForDimensions(opts.width, opts.height, token.topZ - token.bottomZ);
        break;

      case TS.ELLIPSE_1:
      case TS.ELLIPSE_2:
        opts.density = Ellipse3dVertices.defaultDensityForDimensions(opts.width, opts.height, token.topZ - token.bottomZ);
        break;

      case TS.TRAPEZOID_1:
      case TS.TRAPEZOID_2:
        opts.width = token.document.width;
        opts.height = token.document.height;
        break;

      /* Nothing to add for basic rectangles.
      case TS.RECTANGLE_1:
      case TS.RECTANGLE_2:
      */
    }
    return opts;
  }

  static labelArr({ shape, width = 1, height = 1, density, ...opts } = {}) {
    const arr = super.labelArr(opts);

    const TS = CONST.TOKEN_SHAPES;
    shape ??= TS.RECTANGLE_1;

    // Allow spherical to overide other settings.
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.useTokenSphere ) shape = "spherical";

    arr.push(`shape_${shape}`);
    switch ( shape ) {
      case "spherical": density ??= SphereVertices.defaultDensityForDimensions(width, height, Math.max(width, height));
      case TS.ELLIPSE_1: /* eslint-disable-line no-fallthrough */
      case TS.ELLIPSE_2: {
        density ??= Ellipse3dVertices.defaultDensityForDimensions(width, height);
        arr.push(`density_${density}`);
        break;
      }

      case TS.TRAPEZOID_1:
      case TS.TRAPEZOID_2: {
        arr.push(`width_${width.toPrecision(2)}`, `height_${height.toPrecision(2)}`)
        break;
      }

      /* Nothing to add for basic rectangles.
      case TS.RECTANGLE_1:
      case TS.RECTANGLE_2:
      */
    }
    return arr;
  }

  static calculateVertices({ shape, width = 1, height = 1, density } = {}) {
    const TS = CONST.TOKEN_SHAPES;
    shape ??= TS.RECTANGLE_1;
    switch ( shape ) {
      case TS.RECTANGLE_1:
      case TS.RECTANGLE_2: return Rectangle3dVertices._getUnitVertices();

      case "spherical": return SphereVertices._getUnitVertices(density);

      case TS.ELLIPSE_1:
      case TS.ELLIPSE_2: return Ellipse3dVertices._getUnitVertices(density);

      case TS.TRAPEZOID_1:
      case TS.TRAPEZOID_2: return Hex3dVertices.calculateVertices(shape, { width, height });
    }
  }
}


// ----- NOTE: Constrained Models ----- //

export class ConstrainedTokenModelVertices extends mix(TokenInstancedVertices).with(AbstractModelVerticesMixin) {

  get token() { return this.placeable; }

  get instanced() { return !this.token.isConstrainedTokenBorder; }

  calculateModel(opts = {}) {
    if ( this.instanced ) return super.calculateModel(opts);

    // Get vertices for the constrained token polygon.
    const { topZ, bottomZ, constrainedTokenBorder } = this.token;
    const vo = new VertexObject();
    vo.vertices = Polygon3dVertices.calculateVertices(constrainedTokenBorder.toPolygon(), { topZ, bottomZ });
    vo.dropNormalsAndUVs({ keepNormals: opts.hasNormals, keepUVs: opts.hasUVs, out: vo });
    vo.condense(vo);
    return vo;
  }
}

export class LitTokenModelVertices extends mix(TokenInstancedVertices).with(AbstractModelVerticesMixin) {

  get token() { return this.placeable; }

  get instanced() {
    const { litTokenBorder, tokenBorder } = this.token;
    return litTokenBorder && litTokenBorder.equals(tokenBorder);
  }

  calculateModel(opts = {}) {
    if ( this.instanced ) return this.constructor.calculateModelForPlaceable(this.token, opts);

    // Get vertices for the constrained token polygon.
    const { litTokenBorder, topZ, bottomZ } = this.token;
    const border = litTokenBorder || this.placeable.constrainedTokenBorder;
    const vo = new VertexObject();
    vo.vertices = Polygon3dVertices.calculateVertices(border.toPolygon(), { topZ, bottomZ });
    vo.dropNormalsAndUVs({ keepNormals: opts.hasNormals, keepUVs: opts.hasUVs, out: vo });
    vo.condense(vo);
    return vo;
  }
}

export class BrightLitTokenModelVertices extends mix(TokenInstancedVertices).with(AbstractModelVerticesMixin) {

  get token() { return this.placeable; }

  get instanced() {
    const { litTokenBorder, tokenBorder } = this.token;
    return litTokenBorder && litTokenBorder.equals(tokenBorder);
  }

  calculateModel(opts = {}) {
    if ( this.instanced ) return this.constructor.calculateModelForPlaceable(this.token, opts);

    // Get vertices for the constrained token polygon.
    const { litTokenBorder, topZ, bottomZ } = this.token;
    const border = litTokenBorder || this.placeable.constrainedTokenBorder;
    const vo = new VertexObject();
    vo.vertices = Polygon3dVertices.calculateVertices(border.toPolygon(), { topZ, bottomZ });
    vo.dropNormalsAndUVs({ keepNormals: opts.hasNormals, keepUVs: opts.hasUVs, out: vo });
    vo.condense(vo);
    return vo;
  }
}
