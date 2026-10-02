# AgentO

여러 AI 에이전트 CLI 세션(Claude Code · Codex · Gemini CLI · Ollama · 셸)을 하나의 보드에서 관리하는 데스크톱 앱.
UI를 닫아도 세션은 백그라운드 데몬이 계속 소유하고, 다시 열면 현재 상태로 바로 복원된다.

## 구조

```
src/
  daemon/    백그라운드 데몬 — node-pty 세션 소유, WebSocket 서버, SQLite 저장, 로그
  main/      Electron 메인 — 창, 메뉴, 트레이, 데몬 기동/연결, IPC
  preload/   window.desktop 브리지
  renderer/  React UI — 좌 sidebar(프로젝트/파일 트리), 캔버스 보드, 우 sidebar(세션 상세/인박스), 상태 바
  shared/    protocol.ts(클라이언트↔데몬 메시지), ws-client.ts, extra.ts(메뉴 명령 id)
```

- 데몬은 `%APPDATA%\AgentO` (macOS: `~/Library/Application Support/AgentO`)에
  `daemon.json`(port/token/pid), `asm.db`(SQLite), `logs/<sessionId>.log`, `daemon.log`를 둔다.
- UI는 `daemon.json`을 읽어 `ws://127.0.0.1:<port>`에 붙고, 없으면 데몬을 detached로 띄운다.
- 창 닫기 = 트레이로 숨김. File › "종료(세션 유지)" 는 UI만 종료, "모든 세션 중지 후 종료"는 데몬까지 내린다.

## 개발

```bash
npm install          # node-pty, better-sqlite3 네이티브 빌드 (Windows: VS Build Tools + Python 필요)
npm run dev          # Electron + Vite dev
npm run typecheck
npm run build
npm run dist:win     # NSIS 설치본 + 포터블 exe → dist/
npm run dist:mac     # dmg + zip (macOS 에서 실행)
```

첫 실행 시 데몬이 PATH에서 `claude`, `codex`, `gemini`, `ollama` 를 자동 감지한다.

## 단축키

Ctrl+N 새 세션 · Ctrl+P 빠른 열기 · Ctrl+Shift+P 명령 팔레트 · Ctrl+B 사이드바 ·
Ctrl+1/2/3 보드/분할/탭 · Ctrl+= / − / 0 확대·축소·100% · Ctrl+Shift+0 전체 맞춤 ·
Ctrl+Shift+W 입력 대기 세션으로 · F2 이름 변경 · F11 집중 모드

## 환경 변수

`AGENTO_DATA_DIR` (구 `ASM_DATA_DIR`) 데이터 폴더 · `ASM_PORT` 데몬 포트(기본 47831) · `ASM_HIBERNATE_MIN` 자동 절전 대기 분(기본 30)

## 2차 예정

세션 체인(A 완료 → B 시작), 웹 세션 카드(chatgpt.com / gemini.google.com 내장), git diff 뷰,
사용량 실데이터 연동, 자동 업데이트, 설정 화면.
