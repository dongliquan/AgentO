import { create } from 'zustand';

// The Electron renderer does not support window.prompt() (it throws). Use an in-app dialog instead.

export interface PromptRequest {
  title: string;
  initial: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
}

export const usePrompt = create<{ req: PromptRequest | null }>(() => ({ req: null }));

/** Ask for a single line of text. Returns null if cancelled. */
export function askText(title: string, opts: { initial?: string; placeholder?: string } = {}): Promise<string | null> {
  usePrompt.getState().req?.resolve(null);
  return new Promise((resolve) => {
    usePrompt.setState({
      req: {
        title,
        initial: opts.initial ?? '',
        placeholder: opts.placeholder,
        resolve: (v) => {
          usePrompt.setState({ req: null });
          resolve(v);
        }
      }
    });
  });
}
