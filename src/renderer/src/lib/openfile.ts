import { useToasts } from '@/lib/notify';

/** Opens a file in its own viewer window (the same file's window comes to the front). */
export function openFile(path: string, _cwd: string): void {
  window.desktop?.openFileWindow?.(path);
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
