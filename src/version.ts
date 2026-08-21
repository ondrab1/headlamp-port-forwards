/**
 * Build marker, bumped by hand on each install.
 *
 * Exists because there was no way to tell from the UI which build was actually
 * loaded - Headlamp reads plugins at startup, and `npm start` rewrites the same
 * file - so fixes could not be told apart from stale bundles.
 */
export const PLUGIN_BUILD = '2026-08-21T12:50';
