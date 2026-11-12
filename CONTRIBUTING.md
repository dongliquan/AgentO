# Contributing

Thanks for looking at AgentO. Issues and pull requests are welcome.

## Set up

```bash
npm install      # builds node-pty and better-sqlite3 for Electron (Windows: VS Build Tools + Python)
npm run dev      # run the app
npm run typecheck
npm run smoke    # daemon smoke test with a throwaway data folder; no AI calls
```

On Windows, run these from a normal terminal. If you start them from inside VS Code or Claude Code, unset
`ELECTRON_RUN_AS_NODE` and `NoDefaultCurrentDirectoryInExePath` first, or Electron and the node-pty build fail.

## Layout

| Folder | Content |
|---|---|
| `src/daemon/` | Background daemon (pure Node, never import `electron` here) |
| `src/main/` | Electron main process |
| `src/renderer/` | React UI |
| `src/shared/` | Message protocol (`protocol.ts`) and shared helpers; change it in daemon and renderer together |

## Conventions

- TypeScript strict. UI text is English.
- State changes go through the daemon; the renderer only updates optimistically.
- Colors come from the tokens in `styles.css`; no new hard-coded colors.
- Keep pull requests small and say how you checked them (typecheck, smoke, what you clicked).
