import { useEffect } from 'react';
import { useStore } from '@/store';
import { onThemeChange } from '@/lib/theme';
import logo from '@/assets/logo.png';
import { MenuBar } from './MenuBar';

const isMac = window.desktop?.platform === 'darwin';

/** Push the current panel/text colors to the native window-control overlay. */
export function syncTitleBarColors(): void {
  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue('--panel').trim();
  const fg = css.getPropertyValue('--text').trim();
  if (bg && fg) window.desktop?.setTitleBarColors?.(bg, fg);
}

export function TopBar(): JSX.Element {
  const openPalette = useStore((s) => s.openPalette);
  const connected = useStore((s) => s.connected);
  useEffect(() => {
    syncTitleBarColors();
    return onThemeChange(() => requestAnimationFrame(syncTitleBarColors));
  }, []);

  return (
    <div className={`topbar ${isMac ? 'mac' : ''}`}>
      <img className="app-logo" src={logo} alt="AgentO" title="AgentO" draggable={false} />
      {/* macOS keeps the menu in the system menu bar */}
      {!isMac && <MenuBar />}
      <div className="search-wrap">
        <button className="search" onClick={() => openPalette('quick')} title="Ctrl+P / Ctrl+Shift+P">
          <span>⌕</span>
          <span className="ellipsis">Search sessions, folders (Ctrl+P) · Commands (Ctrl+Shift+P)</span>
        </button>
      </div>
      {!connected && <div className="conn">Daemon disconnected</div>}
    </div>
  );
}
