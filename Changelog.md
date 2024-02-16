## 0.2.17
Add `PixelCache` to geometry API. Track tile updates and update the tile pixel cache accordingly if the cache is present.
Change registration flow to not rely on old versions of Patcher.
Add grid units to all elevation configurations.
Fix setting values for elevation configurations and display of values in the config.
Fix libWrapper error when setting multiple elevation placeable configs.

## 0.2.16
Avoid WeilerAtherton in constrained token border for now as it returns failed polygons when a wall intersects at a border point.
Refactor `PIXI.Polygon.prototype.viewablePoints` to avoid intersection testing by taking the points with the largest angles as CW and CCW. This is faster and hopefully more accurate. Test for points contained within the polygon and for degenerate polygons.

## 0.2.15
Add checks to ensure that when measuring distance between points, missing x, y, or z properties will be treated as 0.
Switch to faster `||` when testing for missing z properties. Also catches NaN values.

## 0.2.14
Return `PIXI.Point` for edge vertices when iterating edges for `PIXI.Rectangle`.
Add `iteratePoints` method to `PIXI.Rectangle`.
Add `constrainedTokenBorder` methods to `Token` along with associated hooks for tracking wall updates.
Remove unconnected vertices after removing edges from a `Graph`.

## 0.2.13
Turn off console warnings for locating visible points.

## 0.2.12
Update Hexagon to better handle height/width.
Edits to make elevation config appear properly in tiles and templates configs.
Add `lineSegmentIntersects` method to `PIXI.Circle`.

## 0.2.11
Use source.document instead of source.data.
Set point sources to max integer elevation if undefined, to mimic infinite height.
Use updated Patcher class.
Add elevation config registration.

## 0.2.10
Add ShapeHoled classes.
Add envelop methods.
Add Draw.removeLabel method.
Add rectangle union method.

## 0.2.9
Catch when `actor.statuses` is undefined.

## 0.2.8
Avoid setting tile elevation to null.
Don't overwrite tile elevation if it is undefined.
Avoid changing tile elevation if EV is not active.

## 0.2.7
Fix `Square.prototype.getBounds` when returning a square rotated 45º.
Use Set test instead of switch for checking if the square is rotated 0º or 45º.
Add `Square.prototype.toRectangle`.

## 0.2.6
Allow registration of newer version of geometry lib, skipping if newer version already registered. Deregister hooks as needed.
(Note: Hook deregistration will only work from this version on.)

Add isProne getter to Token.

## 0.2.5
Fixes for testing overlaps. Improved test for circle-polygon overlap; fix for rectangle-polygon overlap. Copy centered polygon when translating.

## 0.2.4
- Fix calculation of polygon centroid.
- Correct error when rotating fixed points.
- Sync TileDocument.prototype.elevation
- Catch when VisionSource has no x,y; use object (token) center instead
- Add check for whether the DUCKING Levels property is present

## 0.2.3
- Fixes to infinite shadow polygons
- Add `invertKey` and `fromAngle` methods.

## 0.2.2
- Don't use cached elevation properties, to avoid caching problems and simplify approach.
- Use token topE for VisionSources.

## 0.2.1
- Fix for PIXI.Point.key getter.
- Use the new v11 status set to check for prone.
- Updates to how the elevation getters work and sync.

## 0.2.0
v11 fixes. Add elevation getters for placeables and sources.

## 0.1.5
Updates based on changes to Elevation Ruler v0.6.6.
- Fix to 2d projection from 3d ray. Better handling of measurement on grids.

## 0.1.4
Updates based on changes to Elevated Vision v0.4.0.
- Add 1x3 matrix calculation.
- Rotation, translate, scale can handle 2d or 3d.

## 0.1.3
Updates based on changes to Elevation Ruler v0.6.4.
- Fix the projection of a 3d ray to 2d when dx, dy, or dz is 0.

## 0.1.2
Updates based on changes to Elevated Vision v0.3.3.
- Add Graph classes with minimum spanning graph and detect cycles methods.
- Add RadixSort classes, used in Graph.
- Sort key and polygon key.
- Use a key getter instead of a method.
- Fix `PIXI.Polygon.prototype.overlap`.
- Use finite wall points whenever constructing a shadow.
- Add `PIXI.Polygon.prototype.clean` and `PIXI.Polygon.prototype.equals`.

## 0.1.1
Updates based on changes to Alternative Token Visibility v0.4.1.
- Correct call to wallPoints in `Shadow.constructFromWall`.
- Properly pass the scaling factor in `ClipperPaths.prototype.toPolygons`.

## 0.1.0
Updates based on changes to Alternative Token Visibility v0.4.0

## 0.0.2
Incorporate GeometryLib into Foundry modules:
- Alternative Token Visibility
- Elevated Vision
- Elevation Ruler
- Light/Sound Mask
- Walled Templates

## 0.0.1.2
Changes to registration functions

## 0.0.1.1
Update imports

## 0.0.1

Initial release prior to using as git submodule.