import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import './lib/theme';
import { App } from './App';
import { PanelsApp } from './PanelsApp';
import { startClient } from './client';
import { initPanelsBridge } from './panels-bridge';
import { IS_PANELS } from './lib/role';
import { applyStoredWidths } from './components/Splitter';

applyStoredWidths();
initPanelsBridge();
void startClient();

// No StrictMode: xterm instances must mount exactly once per card.
createRoot(document.getElementById('root') as HTMLElement).render(IS_PANELS ? <PanelsApp /> : <App />);
