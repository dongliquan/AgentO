import { useStore } from '@/store';
import { useToasts } from '@/lib/notify';

/** Opens a file in its own viewer window; without the desktop bridge it falls back to a card on the Ground. */
export function openFile(path: string, cwd: string): void {
  if (window.desktop?.openFileWindow) window.desktop.openFileWindow(path);
  else useStore.getState().openFileCard(path, cwd);
}

/** Opens a file in ReadO (for a closer look: editing, search, git); says so when ReadO cannot be started. */
export function openInReadO(path: string): void {
  const api = window.desktop?.openInReadO;
  if (!api) {
    useToasts.getState().push({ title: 'Open in ReadO needs the desktop app', body: path });
    return;
  }
  void api(path).then((err) => {
    if (err) useToasts.getState().push({ title: 'Open in ReadO', body: err });
  });
}
