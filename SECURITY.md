# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately** with GitHub's *Report a vulnerability* button (Security tab) instead of a
public issue. Include what you found, how to reproduce it, and the AgentO version.

## What AgentO can touch

AgentO starts AI agent CLIs (Claude Code, Codex, Gemini CLI, Ollama, shells) on your machine. Those agents act on
your files with the permissions you give them.

- Read permission prompts before you allow them. Use *Always allow* and *Trust this folder* only for tools and
  folders you control.
- The background daemon listens on `127.0.0.1` only. Every connection needs a random token kept in the data folder
  (`%APPDATA%\AgentO` on Windows, `~/Library/Application Support/AgentO` on macOS); anyone who can read that folder
  can control your sessions, so keep it private.
- AgentO has no telemetry. It reads local chat logs of the agents it manages (for example `~/.claude/projects`) to
  show conversations and token usage, and sends nothing anywhere itself.
