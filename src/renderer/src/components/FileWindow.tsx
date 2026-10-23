import { useStore } from '@/store';
import { Viewer } from './ViewerTabs';
import { FindBar } from './FindBar';

/** A viewer window's whole page: one file, rendered or raw, read through the daemon like the viewer tabs. */
export function FileWindow({ path }: { path: string }): JSX.Element {
  const connected = useStore((s) => s.connected);
  return (
    <div className="viewer file-window">
      <FindBar />
      {connected ? <Viewer path={path} /> : <div className="tree-empty">Connecting to daemon…</div>}
    </div>
  );
}
