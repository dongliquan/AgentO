import { useStore } from '@/store';

/** Opens a file in its own viewer window; without the desktop bridge it falls back to a card on the Ground. */
export function openFile(path: string, cwd: string): void {
  if (window.desktop?.openFileWindow) window.desktop.openFileWindow(path);
  else useStore.getState().openFileCard(path, cwd);
}
