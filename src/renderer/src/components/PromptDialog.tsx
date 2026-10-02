import { useState } from 'react';
import { usePrompt, type PromptRequest } from '@/lib/prompt';

export function PromptDialog(): JSX.Element | null {
  const req = usePrompt((s) => s.req);
  if (!req) return null;
  return <PromptBody key={req.title + req.initial} req={req} />;
}

function PromptBody({ req }: { req: PromptRequest }): JSX.Element {
  const [value, setValue] = useState(req.initial);
  const ok = (): void => req.resolve(value);
  const cancel = (): void => req.resolve(null);

  return (
    <div className="overlay center" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="dialog" style={{ width: 360 }}>
        <h3>{req.title}</h3>
        <div className="field">
          <input
            autoFocus
            value={value}
            placeholder={req.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ok();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              }
            }}
          />
        </div>
        <div className="actions">
          <button className="btn" onClick={cancel}>Cancel</button>
          <button className="btn primary" onClick={ok}>OK</button>
        </div>
      </div>
    </div>
  );
}
