/**
 * Pane scaling host half. The plugin has no host-side behaviour: the cordis
 * plugin id and the client bundle are all the host Loader needs, and the
 * browser half owns every DOM/CSS write.
 */

/** The cordis plugin id; must match the bundle patch row and never start with `ui-skin-`. */
export const name = 'ui-plugin-scaling'

/**
 * Required plugin shape. cordis only accepts a function, a class, or an object
 * with an `apply`, so a module exporting `name` alone never gets a loader fiber
 * and the boot diagnostic reports the row as `failed to import`.
 */
export function apply(): void {}
