import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import './lib/theme';
import { App } from './App';
import { PanelsApp } from './PanelsApp';
import { startClient } from './client';
import { initPanelsBridge } from './panels-bridge';
import { IS_PANELS, VIEWER_FILE } from './lib/role';
import { FileWindow } from './components/FileWindow';
import { initNotifications } from './lib/notify';
import { applyStoredWidths } from './components/Splitter';

applyStoredWidths();
initPanelsBridge();
// reports / finished orders: the main window only (the panels window would repeat them)
if (!IS_PANELS && !VIEWER_FILE) initNotifications();
void startClient();

// No StrictMode: xterm instances must mount exactly once per card.
createRoot(document.getElementById('root') as HTMLElement).render(
  VIEWER_FILE ? <FileWindow path={VIEWER_FILE} /> : IS_PANELS ? <PanelsApp /> : <App />
);
