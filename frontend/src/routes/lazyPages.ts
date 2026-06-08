// Centralized lazy route chunks + preload helpers.
//
// Why this lives in its own module (not App.tsx): both App.tsx (which renders
// the lazy components) and Sidebar.tsx (which preloads a chunk on nav hover)
// need access. Importing from App.tsx would create a cycle
// (App → Layout → Sidebar → App). A leaf module breaks that.
//
// Each chunk has a single importer function. `lazy()` uses it to render; the
// preload helpers call the SAME function to warm Vite's module cache early.
// Vite dedupes — calling the importer twice fetches the chunk once.

import { lazy } from 'react';

// One importer per code-split page. Path keys match the router nav `to` values
// so Sidebar can preload by route on hover.
const importers = {
  '/admin':            () => import('../pages/Admin'),
  '/accounting':       () => import('../pages/Accounting'),
  '/approval-history': () => import('../pages/ApprovalHistory'),
  '/dev/i18n':         () => import('../pages/DevI18n'),
  // Settlement uses a dynamic path (/applications/:id/settlement); preloaded
  // on demand from the application detail flow rather than a nav link.
  settlement:          () => import('../pages/Settlement'),
} as const;

export const LazyPages = {
  Admin:           lazy(importers['/admin']),
  Accounting:      lazy(importers['/accounting']),
  ApprovalHistory: lazy(importers['/approval-history']),
  Settlement:      lazy(importers.settlement),
  DevI18n:         lazy(importers['/dev/i18n']),
};

/**
 * Preload a single route's chunk — call on nav-link hover/focus so the JS is
 * already parsed by the time the user clicks. No-op for non-lazy routes.
 */
export function preloadRoute(path: string): void {
  const fn = importers[path as keyof typeof importers];
  if (fn) void fn();
}

/**
 * Preload every lazy chunk once. Call during idle time after first paint so
 * subsequent navigation to any heavy page is instant (no chunk-download
 * loader). Runs at most once per session.
 */
let preloadedAll = false;
export function preloadAllRoutes(): void {
  if (preloadedAll) return;
  preloadedAll = true;
  for (const fn of Object.values(importers)) void fn();
}
