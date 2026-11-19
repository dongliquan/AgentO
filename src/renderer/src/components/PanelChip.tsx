/**
 * A collapsed side panel: just its title, floating at the corner of the Ground. Clicking the title opens the panel
 * again (and clicking the title of the open panel folds it back to this).
 */
export function PanelChip({ side, title, onOpen }: { side: 'left' | 'right'; title: string; onOpen: () => void }): JSX.Element {
  return (
    <button className={`panel-chip ${side}`} onClick={onOpen} title={`Show ${title}`}>
      <span className="caret">{side === 'left' ? '▸' : '◂'}</span>
      {title}
    </button>
  );
}
