import type { PanelsRelay } from '@shared/extra';

/** True in the detached panels window (left sidebar + right panel), false in the main board window. */
export const IS_PANELS = window.panels?.role === 'panels';

/** The file shown by a viewer window ('viewer' role), undefined in the other windows. */
export const VIEWER_FILE = window.panels?.role === 'viewer' ? window.panels.file : undefined;

/** Send to the other window through the main process (no-op when the bridge is missing). */
export function relay(msg: PanelsRelay): void {
  window.panels?.relay(msg);
}
