## 0.4.3
Refactor: Renames RegionMovementWaypoint3d to ElevatedPoint and fixes various bugs.

This change renames RegionMovementWaypoint3d to ElevatedPoint, consolidating point handling in the 3D geometry library. It also includes numerous bug fixes and optimizations across various geometry-related classes, improving accuracy and stability.

### Changes
Renamed: RegionMovementWaypoint3d.js is deleted, and its functionality is merged into a new ElevatedPoint.js file.

Class Hierarchy: GridCoordinates3d now extends ElevatedPoint instead of RegionMovementWaypoint3d.

AABB: Modified AABB2d and AABB3d to improve segment overlap testing and containment checks. Simplified from factory methods.

PIXI Extensions: Added segmentIntersections to PIXI.Circle that returns t0 values. Added lineSegmentCrosses to PIXI.Polygon. Improved intersection calculations. RoundedRectangle class added.

MatrixFlat: Added a subset method to extract a portion of the matrix.

CutawayPolygon: Modified CutawayPolygon to ensure clockwise point order in a y-up coordinate system. InsertTopSteps method removed.

Point3d: Added t0 property to store intersection distances. Switched from Math.pow to ** operator.

CanvasEdges: Modified Edge and CanvasEdges to patch for v13.

### Impact
Behavioral Changes: Improved accuracy of intersection calculations in PIXI.Circle, PIXI.Polygon, AABB, and RoundedRectangle.

Dependencies Affected: GridCoordinates3d, HexGridCoordinates3d, and other classes using the renamed ElevatedPoint class are updated.

Performance: Optimized Point.towardsPoint and switched to faster orient2d method, which should improve performance.


## 0.4.2
Refactor: Replace instanceof with class type checking; add instanceOrTypeOf.

This change replaces instanceof checks with a more robust class type verification using a new instanceOrTypeOf utility function. It also introduces class type sets to ClipperPaths and Clipper2Paths as an alternative to instanceof.

Needed b/c different modules may load parallel versions of classes like Point3d, but these should be seen as the same class.

### Changes
Replaced instanceof checks with instanceOrTypeOf in Ray3d.js for type validation of Point3d instances.

Introduced classTypes static property (Set) and inheritsClassType, matchesClass, overlapsClass methods to ClipperPaths.js and Clipper2Paths.js as an alternative to instanceof. These Sets contain the name of the class and a parent class.

Updated ConstrainedTokenBorder.js to use the inheritsClassType method of ClipperPaths and Clipper2Paths instead of instanceof.

Added instanceOrTypeOf utility function to util.js to handle checking if an object is an instance of a given class type or has a matching class type, and added it to the Foundry utils.

### Impact
Replaces the potential issues of using instanceof that occur when a class is defined in a different context or has been modified during runtime.

Provides a more reliable class type verification mechanism across different modules.

Adds more robust type validation for shapes to ensure only ClipperPaths or Clipper2Paths are used by the ConstrainedTokenBorder class' clipperShapeToPolygon method.

May improve the robustness of type checking throughout the code.

## 0.4.1
Implement object pooling for 3D geometry classes.

This change introduces object pooling using a Pool class for Point3d and related 3D geometry classes to improve performance by reducing object creation/destruction overhead.

Initial testing of homogenous points.
Homogenous Point (HPoint) Class: Created HPoint2d, HPoint3d, HLine2d, and HPlane classes representing homogenous points and lines in 2D and planes in 3D.  These classes use 4D vectors to represent points/lines/planes at infinity and to simplify geometric calculations, also introducing functions to perform plane and ray intersections.

### Changes
Object Pooling: Implemented a Pool class to manage instances of Point3d, GridCoordinates3d, HexGridCoordinates3d, RegionMovementWaypoint3d and BarycentricPoint.

Static tmp and releaseObj methods are added to these classes to facilitate acquiring and releasing objects from the pool.  Static buildNObjects was added to PIXI.Point and Point2dTyped for pool construction.

Point3d modifications: Point3d now uses the Pool class for object management, including the addition of releaseObj and buildNObjects functions. The release function now calls the static releaseObj method.

Class Type Checking: Replaced inheritsClassType, objectMatchesClassType, and objectOverlapsClassType with matchesClass and overlapsClass to remove the need for an object parameter and instead check only the class.

TypedArrays Implementation: Point2dTyped and Point3dTyped are backed by typed arrays for optimal data layout in memory.

Minor fixes: registration.js file is updated to version "0.4.1" and unnecessary NULL_SET imports removed.

### Impact

Performance:  The introduction of object pooling should lead to performance gains in scenarios with frequent object creation and deletion for 3D geometry. TypedArrays will also improve performance by optimizing the memory layout and access.

API Changes: The addition of static tmp and releaseObj methods to Point3d and related classes changes how these objects are intended to be used. Code using these classes must be adapted to use the pooling mechanism.

Dependencies: Code using 3D geometry classes now depends on the Pool class.


## 0.4.0 (Formerly known as 0.3.21)
Fix setting / getting wall elevation and simplify MODULE_KEYS structure.
Misc. fixes.
Fixes to MatrixFlat and added perspective code.
Switch to handle v13 patches while keeping v12 compatibility.
Added:
• Clipper 2
• LitTokenShape
• Tentative unit testing approach
• Pooling for PIXI.Point and Point3d in lieu of Point3d.tmp method.
• Alternative to using instanceof for testing shapes
• Polygon3d, Ellipse3d, Circle3d, Triangle3d, Quad3d, Polygons3d
• Barycentric
• Sphere
• AABB
Removed reliance on GEOMETRY_CONFIG; use imports instead.

## 0.3.20
Update Bresenham alogorithms for speed, simplicity, and to fix skipping hex spaces.
Remove constructor from ConstrainedTokenBorder so it will function like expected for Polygon methods that create new polygons.
Add MatrixFlag as future Matrix replacement.
Add min/max PIXI.Point methods.
Add divide method to PIXI.Point.
Add iterator to PIXI.Point.

## 0.3.19
Fix for Elevation Ruler #227: diagonals not measured properly. Correct how `_singleOffsetDistanceFn` tallies grid offsets.


## 0.3.18
Deprecation: Use `canvas.grid.sizeX` and `sizeY`.

## 0.3.17
Use simpler drawing cutoffs for y elevation.
Fix Wall Height module not changing when editing multiple walls.

## 0.3.16
Fix undefined quadtree in `CanvasEdges`.
Catch when a polygon, ellipse is not positive and don't use WeilerAtherton.

## 0.3.15
Add quadtree to `CanvasEdges`.
Split out `Edge` vs `CanvasEdge` patches.
Fix handling of negative values in `convertToDistanceCutaway`.

## 0.3.14
Move `CutawayPolygon` and related cutaway methods to libGeometry.

## 0.3.13
More fixes for the `alternatingGridDistance` test.

## 0.3.12
Fix alternating test in `alternatingGridDistance` so it does 5/10/5, not 10/5/10.

## 0.3.11
Add `HexGridCoordinates3d` class.
Add `roundNearWhole` utility.

## 0.3.10
Set diagonals to the game setting for hex grids.

## 0.3.9
Move `Point3d._tmp` to a static object and add `_tmp` for subclasses.
Add `RegionWaypoint3d`, `GridCoordinates`, and `GridCoordinates3d` classes.

## 0.3.8
Fix `findOverlappingPoints` when one segment is completely encompassed by a longer segment. (Was returning 1 endpoint when should be returning 2 endpoints.)

## 0.3.7
Add `cutaway` methods to construct a vertical 2d slice of a 3d shape.
Add `rotateAroundCenter` method to `PIXI.Rectangle`.

## 0.3.6
Fix for tile pixel cache in v12.
Add `localNeighbors` and `localPixelStep` methods to PixelCache.

## 0.3.5
Use PIXI.Points for `_fixedPoints` in CenteredPolygon so that the points can be rotated. Closes issue #108 in Elevation Ruler.
Add `ClipperPaths#joinPaths` method.
Passthrough pregenerated edges for `Polygon#lineSegmentIntersects` to avoid rebuilding the edges if not necessary.

## 0.3.4
Handle Wall, Edge classes in Draw.segment.
Add an internal PIXI.Point.invert that returns object, for non-keys.
Fix for test if can convert polygon to rectangle.
Add `ClipperPaths#union` method that unions polygons without filling.

## 0.3.3
Switch to using TextureLoader.getTextureAlphaData.
Fix the `fromOverheadTileAlpha` method given changes to `TextureLoader.getTextureAlphaData`.
Use `wall.edge.a`.
Change Tile overhead test.

## 0.3.2
Use `token#getShape()` instead of `token#shape` in `token#tokenBorder` so it works even if the token shape is not yet defined.
Use `wall.edge.a` instead of `wall.A`.

## 0.3.1
Add temporary static points to `PIXI.Point` and `Point3d`.
Redo constrained token border to use CanvasEdges in v12.
Change `Math.clamped` to `Math.clamp`.
Deprecate `Token#tokenShape`.

## 0.3.0
Foundry v12 compatibility. No tested backwards compatibility.
Removed `Math.SQRT3` which is now set in base Foundry.
Add `roundDecimals` to `CONFIG.GeometryLib.utils`.
Change `getProperty` to `foundry.utils.getProperty`.
Change `canvas.grid.isHex` to `isHexagonal`.

## 0.2.20
Fix for `Circle.prototype.area` calculation.

## 0.2.19
Add `Ellipse.prototype.lineSegmentIntersects`.

## 0.2.18
Add enumerated `IX_TYPES` and segment functions:
 - `doSegmentsOverlap`
 - `findOverlappingPoints`
 - `segmentCollision`
 - `endpointIntersection`
 - `segmentIntersection`
 - `segmentOverlap`

## 0.2.17
Add `PixelCache` to geometry API. Track tile updates and update the tile pixel cache accordingly if the cache is present.
Change registration flow to not rely on old versions of Patcher.
Add grid units to all elevation configurations.
Fix setting values for elevation configurations and display of values in the config.
Fix libWrapper error when setting multiple elevation placeable configs.
Fix for point sources not having `elevationE` and `elevationZ` getters. Fixes issue with elevated vision shadows being too long.

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