import type { DesktopApi } from '@shared/protocol';
import type { PanelsRelay, WindowRole } from '@shared/extra';

export interface DesktopEvents {
  /** fired when a notification is clicked */
  onFocusSession(cb: (sessionId: string) => void): () => void;
  /** fired after Help › Restart Daemon succeeds; re-read getDaemonInfo() and reconnect */
  onDaemonRestarted(cb: () => void): () => void;
}

/** Detached panels window (left sidebar + right panel in one window). */
export interface PanelsApi {
  /** which window this renderer runs in */
  role: WindowRole;
  /** open the panels window, or close it when already open */
  toggle(): void;
  isOpen(): Promise<boolean>;
  /** fired in the main window when the panels window opens or closes */
  onState(cb: (open: boolean) => void): () => void;
  /** send to the other window (main ↔ panels) */
  relay(msg: PanelsRelay): void;
  onRelay(cb: (msg: PanelsRelay) => void): () => void;
}

declare global {
  interface Window {
    desktop: DesktopApi;
    desktopEvents: DesktopEvents;
    panels: PanelsApi;
  }
}

export {};
