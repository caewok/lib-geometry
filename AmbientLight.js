/* globals
CONFIG
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";

// If an ambient light is updated, update the lit token border.

export const PATCHES = {};
PATCHES.CONSTRAINED_TOKEN_BORDER = {};

// ----- NOTE: Hooks ----- //

/**
 * A hook event that fires for every embedded Document type after conclusion of a creation workflow.
 * Substitute the Document name in the hook event to target a specific type, for example "createToken".
 * This hook fires for all connected clients after the creation has been processed.
 *
 * @event createDocument
 * @category Document
 * @param {Document} document                       The new Document instance which has been created
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createAmbientLight(document, options, userId) { ConstrainedTokenBorder._lightsID++; }

/* -------------------------------------------- */

/**
 * A hook event that fires for every Document type after conclusion of an update workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "updateActor".
 * This hook fires for all connected clients after the update has been processed.
 *
 * @event updateDocument
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} changed                          Differential data that was used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateAmbientLight(document, changed, options, userId) { ConstrainedTokenBorder._lightsID++; }

/* -------------------------------------------- */

/**
 * A hook event that fires for every Document type after conclusion of an deletion workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "deleteActor".
 * This hook fires for all connected clients after the deletion has been processed.
 *
 * @event deleteDocument
 * @category Document
 * @param {Document} document                       The existing Document which was deleted
 * @param {Partial<DatabaseDeleteOperation>} options Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteAmbientLight(document, options, userId) { ConstrainedTokenBorder._lightsID++; }


PATCHES.CONSTRAINED_TOKEN_BORDER.HOOKS = { createAmbientLight, updateAmbientLight, deleteAmbientLight };