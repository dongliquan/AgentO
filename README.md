# AgentO

여러 AI 에이전트 CLI 세션(Claude Code · Codex · Gemini CLI · Ollama · 셸)을 하나의 보드(Ground)에서 관리하는 데스크톱 앱(Windows · macOS).
감독(사용자)이 지시하면 Head Coach · Coach · 선수 세션이 나눠 일하고 보고한다.

- **UI를 닫아도 세션은 계속 돈다.** 세션은 백그라운드 데몬과 세션별 홀더 프로세스가 소유하고, UI는 붙었다 떨어지는 화면일 뿐이다. 데몬만 다시 띄워도 세션은 유지된다.
- **구독 로그인(CLI) 방식만 쓴다.** API 키 방식은 쓰지 않는다.
- 설계 문서는 [docs/](docs/), 작업 메모는 [CLAUDE.md](CLAUDE.md).

## 주요 기능

| 영역 | 내용 |
|---|---|
| Ground | 세션 카드를 놓는 캔버스. 프로젝트·파트 영역, 지시·보고 연결선(흐르는 점선), 선택 카드로 이동·확대, 미니맵, Focus 보기 |
| 보기 | Ground · Split · Tabs · Timeline(끝난 기능 기록) · Today(지금 필요한 것 모아 보기) |
| 팀 | Head Coach(팀 전체, 하나) → 프로젝트 Coach → 파트 Coach(선택) → 선수. 지시는 `#T` 작업 번호로 추적, 보고는 자동으로 지시한 쪽에 돌아감 |
| 대화 | Claude·Codex 대화 기록을 카드에서 바로 보기, 도구 호출·팀 메시지·첨부 이미지·파일 링크, 질문·권한 요청 카드 |
| 오른쪽 패널 | Session · Files · Manager(지시) · Inbox(알림) · Logs(팀 대화) · Web(Gemini, ChatGPT) |
| 프로젝트 메모리 | 프로젝트마다 결정·규칙·지도를 한 파일로 두고 Claude 세션 시작 때 주입 |
| 루틴 | 반복 지시(N분마다 · 매일 HH:MM), UI를 닫아도 데몬이 실행 |
| 토큰 관리 | 대화가 커지면 인수인계 메모로 새 대화 시작(Fresh start), 모델 선택, 사용량 리포트 |
| 저장 | 프로젝트를 `.agento` 파일로 저장·열기, Claude Code 세션 가져오기 |
| 파일 | Markdown · JSON · CSV · 이미지 뷰어를 파일별 새 창으로, 변경 파일 표시 |

## 구조

```
src/
  daemon/    백그라운드 데몬 — WebSocket·MCP 서버, SQLite, 팀·루틴·사용량. holder.ts 는 세션 하나를 소유하는 분리 프로세스(데몬이 없어도 CLI 를 계속 돌림)
  main/      Electron 메인 — 창, 메뉴, 트레이, 데몬 기동·연결, 딥링크, IPC
  preload/   window.desktop 브리지
  renderer/  React + zustand + xterm UI
  shared/    protocol.ts(클라이언트↔데몬 메시지, 단일 진실), 레이아웃·평문 변환 등 공용 코드
tests/smoke/ 데몬 스모크(npm run smoke), UI 스모크(npm run smoke:ui)
docs/        설계 문서
```

- 데이터 폴더는 `%APPDATA%\AgentO` (macOS: `~/Library/Application Support/AgentO`): `daemon.json`(port · token · pid), `asm.db`, `logs/`, `holders/`, `team/`(Head Coach·Coach 작업 폴더, 프로젝트 메모리), `attachments/`, `handoff/`.
- UI는 `daemon.json` 을 읽어 `ws://127.0.0.1:<port>` 에 붙는다. 데몬은 데이터 폴더마다 하나만 실행된다.
- 팀 세션은 같은 포트의 HTTP MCP(`/mcp/<sessionId>`, Bearer 토큰)로 서로에게 지시·보고한다. 역할마다 보이는 도구와 권한이 다르다.
- 창 닫기 = 트레이로 숨김. File › "종료(세션 유지)" 는 UI만 종료, "모든 세션 중지 후 종료"는 데몬까지 내린다.
- 팀 세션(선수·Coach)은 기본이 headless(`claude -p` 이벤트 스트림), New Chat 은 터미널(TUI). 카드 메뉴에서 바꿀 수 있다.

## 설치·실행

필요: Node.js(LTS), Claude Code 등 쓸 CLI(`claude`, `codex`, `gemini`, `ollama` 는 PATH 에서 자동 감지, Agents › Connections 에서 설치·로그인 상태 확인).

```bash
npm install          # node-pty, better-sqlite3 네이티브 빌드 (Windows: VS Build Tools + Python 필요)
npm run dev          # Electron + Vite dev (렌더러 포트 47820)
npm run typecheck
npm run build
npm run smoke        # 일회용 데몬으로 24개 확인 (AI 호출 없음)
npm run dist:win     # NSIS 설치본 + 포터블 exe → dist/ (서명 없음)
npm run dist:mac     # dmg + zip (macOS 에서 실행)
```

Windows 에서 VS Code · Claude Code 안에서 실행하면 `ELECTRON_RUN_AS_NODE`, `NoDefaultCurrentDirectoryInExePath` 가 상속되어 Electron·node-pty 빌드가 실패한다. `start-dev.cmd` 가 둘 다 해제한다.
태그 `v*` 를 push 하면 `.github/workflows/release.yml` 이 Windows·macOS 를 빌드한다.

## 단축키

Ctrl+N 새 세션 · Ctrl+P 빠른 열기 · Ctrl+Shift+P 명령 팔레트 · Ctrl+B 사이드바 · Ctrl+F 찾기 ·
Ctrl+1~5 Ground/Split/Tabs/Timeline/Today · Ctrl+= / − / 0 확대·축소·100% · Ctrl+Shift+0 전체 맞춤 ·
Ctrl+Shift+B 패널을 별도 창으로 · Ctrl+, 설정 · F2 이름 변경 · F11 Focus 보기 · Ctrl+Shift+W 입력 대기 세션으로

## 환경 변수

| 변수 | 뜻 |
|---|---|
| `AGENTO_DATA_DIR` | 데이터 폴더 (구 `ASM_DATA_DIR`) |
| `ASM_PORT` | 데몬 포트(기본 47831) |
| `ASM_HIBERNATE_MIN` | 자동 절전 대기 분(기본 30) |
| `AGENTO_HEADLESS=0` | 팀 세션도 터미널(TUI)로 시작 |
| `AGENTO_PLAYER_MODEL` · `AGENTO_COACH_MODEL` · `AGENTO_COACH_EFFORT` | 선수·조율 역할 기본 모델·노력 수준(빈 값 = CLI 기본) |
| `AGENTO_AUTO_FRESH=0` · `AGENTO_AUTO_FRESH_MIN` | 자동 Fresh start 끄기 · 기준 토큰 |
| `AGENTO_AUTO_MODEL=0` | 조사·분석·검토·문서·테스트 이름의 선수를 Sonnet 으로 시작하는 것 끄기 |

## 다른 앱과의 연결

- `agento://dispatch?kind=commit|push&repo=…` 딥링크로 다른 앱(예: 파일 뷰어 ReadO)이 커밋·푸시 지시를 보낼 수 있다(확인 창을 거쳐 열린 프로젝트에만).
- 파일 우클릭 › Open in ReadO 로 ReadO 가 설치돼 있으면 거기서 연다.

## 알려진 한계

- Gemini CLI 는 개인 요금제 지원 종료로 터미널 보기만 된다. Codex 는 대화 보기는 되지만 Fresh start·토큰 리포트는 Claude 만.
- 코드 서명이 없어 Windows 에서 SmartScreen 경고가 뜬다.
- 사용량은 로컬 대화 기록(토큰)만 계산한다. 구독 한도 %는 알 수 없다.
- 자동 업데이트, 세션 체인(A 끝나면 B 시작)은 아직 없다.
