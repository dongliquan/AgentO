# AgentO — 프로젝트 컨텍스트 프롬프트

아래 전체를 새 세션의 첫 메시지로 붙여 넣는다. (2026-11-17 기준. **main = 2.0 개발**(단순 모드 기본), **1.0 = `release/1.0` 브랜치·태그 `v1.0.1`**(팀 모드가 기본인 이전 모습 + 수정 3개). 두 버전은 같은 `%APPDATA%\AgentO` 데이터를 쓰며 동시에 실행하지 않는다.)

---

너는 **AgentO** 의 개발을 돕는다. AgentO 는 여러 AI 에이전트 CLI 세션(Claude Code 중심, Codex·Gemini·Ollama·셸)을 한 화면에서 관리하는 Windows(+macOS) 데스크톱 앱이다. 소스 `C:\ClaudeCode\AgentO`, 데이터 `%APPDATA%\AgentO`. 사용자에게는 **한국어**로 답하고, UI 문구와 코드는 **영어**로 쓴다.

## 1. 만든 이유와 기준 (모든 판단의 잣대)

- 사용자는 VS Code·IntelliJ 의 Claude 플러그인(세션 하나씩)만 써 왔다. 통합 관리 도구 Orca 를 잠깐 써 봤지만 너무 무거워 버렸다.
- 그래서 AgentO 의 의도는 셋이다: **(A) 단순한 세션 관리**(플러그인 세션처럼, 여러 개를 한곳에서), **(B) 세션이 살아 있게**(UI 를 닫거나 앱을 다시 켜도 이어서 작업), **(C) 가벼운 협업**(세션끼리 일을 부탁하고 결과를 받는다).
- 무거운 프로젝트 관리·위계 오케스트레이션(Orca 류)은 피해야 할 것이다. 새 기능은 A·B·C 에 닿는지로 판단하고, 새 화면을 늘리기보다 **중복 화면을 합치거나 지우는 쪽**을 택한다.
- 사용자가 가장 싫어하는 것: 앱 교체·재시작 때 세션이 전부 멈추는 것, 멈춘 세션이 어디까지 했는지 안 보이는 것, 화면(탭)이 많아 찾기 어려운 것.

## 2. 구조

- `src/daemon/` 순수 Node 데몬(electron import 금지): node-pty 세션, ws 서버 + 같은 포트의 HTTP MCP(`POST /mcp/<sessionId>`, Bearer), better-sqlite3(`asm.db`), 로그.
- **홀더**(`src/daemon/holder.ts`, `out/holder/index.js`): 세션마다 작은 분리 프로세스가 CLI(pty 또는 headless stream)를 소유한다. 데몬·UI 가 꺼져도 세션이 산다. 데몬은 단일 실행 잠금(파이프)을 쓰고 시작 때 살아 있는 홀더에 reattach 한다. 홀더는 **자기를 띄운 빌드 폴더의 exe 를 쓰므로 그 폴더는 덮어쓸 수 없다.**
- `src/main/` Electron 메인(창, 메뉴, 트레이, 데몬 기동). `src/preload/` 브리지. `src/renderer/` React + zustand + xterm. `src/shared/protocol.ts` 가 클라이언트↔데몬 메시지의 단일 진실(바꾸면 양쪽 수정).
- 세션 모드: `tui`(실제 `claude` 를 pty 로 띄운 원본 터미널 — IntelliJ 플러그인과 같은 화면) / `headless`(`claude -p --input-format stream-json`, 화면 없음, Terminal 탭은 활동 로그). New Session·New Chat 은 tui 기본, 팀이 만드는 세션은 headless 기본.
- Claude 세션은 `--session-id` 로 띄우고 `~/.claude/projects/*/<id>.jsonl` 을 tail 해 대화(Chat 보기)·완료 판정·토큰을 만든다. Codex 는 `~/.codex/sessions` rollout. CLI 는 구독 로그인만 쓴다(API 키 금지).
- 데이터: Project > (Part) > Folder > Session. 세션 배치·상태·인박스·일 장부는 DB/kv 에 있고 **상태는 데몬이 진실, 렌더러는 낙관적 갱신만**.

## 3. 기능 (현재)

### 기본(단순 모드 — 기본값)
- 왼쪽 트리(프로젝트 ⊃ 파트, 세션), 가운데 보기 4가지: **Ground**(카드 보드, 단순 모드는 자체 격자 배치), **Split**, **Tabs**, **Today**. Ctrl+1~5. Auto Arrange·Fit All·Focus.
- 오른쪽 탭: **Session**(대화/Terminal 전환, 입력창), **Files**(프로젝트 폴더 트리·git 표시·파일 창), **Web**(Gemini/ChatGPT).
- 세션 카드: 상태 점·배지, 모델 칩(클릭해 변경), 대화 크기 칩, 카드 ⋯ 메뉴(Hibernate/Resume/Restart/Fresh Start/Run Headless/Autopilot…).
- 입력창: Send·Go·Steps·Best·Branch 빠른 답, 예/아니요·번호 선택지 빠른 답, ↑/↓ 입력 기록, 이미지 첨부, **입력 내용은 세션별 드래프트로 보관**.
- 세션 유지: 30분 쉬는(waiting) 세션은 자동 hibernate(대화는 `--resume` 로 복원). **Pick up where you left off**(Today): 멈춘 세션의 마지막 요청·마지막 답 끝부분·시각·긴 대화 표시, Resume 버튼, 앱을 닫을 때 실행 중이던 세션 "Resume all".
- 깨울 때 AgentO 가 붙이는 안내: 20분 넘게 멈췄으면 "얼마나 멈췄는지, repo/branch 가 바뀌었을 수 있으니 상태를 확인하라", 쌓인 메시지는 번호·시각으로 구분.
- 알림: 사용자 판단이 필요한 것(Needs you: 프롬프트에서 멈춘 세션, 보고가 질문으로 끝남, 큰 대화), 완료·오류 토스트·OS 알림, 사용량 한도 표시(Limit).
- 자동 처리: 폴더 신뢰·"Adding a new directory"(AgentO 폴더·등록 폴더) 확인 창 자동 수락, 선택형 설정 창 닫기, 놓친 메시지 재전송.
- 프로젝트 메모리(`update_memory`, 섹션 Decisions/Conventions/Map/Don't/Open, 상한 있음): Claude 세션 시작 때 주입. Fresh start(인수인계 메모 → 새 대화) 수동·자동(대화 150K 토큰 이상 등).
- Autopilot(프로젝트별): 자리를 비운 동안 알아서 이어감. Coach 가 있으면 Coach 가, 없으면 **세션 하나**(카드 메뉴 "Autopilot")가 직접. 켜면 먼저 "끝났다는 기준·남은 일"을 메모리 Open 에 적고, 쉴 때 이어가며, 목록이 비면 `AUTOPILOT DONE`. 한도: 1시간 6회, 진전 없이 2회.
- 그 밖: 프로젝트 닫기/열기·`.agento` 저장, Claude Code 세션 가져오기, 토큰 사용 리포트, Agent Connections(설치·로그인 상태), 다크/라이트(공통 xO 테마), 패널 분리 창, `agento://` 딥링크(ReadO 연동), 파일 창(md/json/csv 뷰어).

### 팀 모드 (선택, 툴바 두 사람 아이콘, localStorage `asm.teamMode`)
- 세션 위계: Head Coach(팀 전체, 하나) · Coach(프로젝트당 하나) · 파트 Coach · 선수. 도구(MCP): list_sessions, read_session, send_to_session, report_up(`needs_answer`), wait_for_sessions, create_session, interrupt/resume_session, update_memory 등. Coach 는 파일을 쓰지 않고 선수에게 일을 나눈다. 완료는 데몬이 감지해 지시한 쪽에 자동 보고(대기열, 20초 묶음).
- 지시 번호 `#T<n>`(프로젝트별 연번)과 **일 장부**(`src/daemon/ledger.ts`, `TaskRec`: queued/working/handed/reported/asking/blocked, 부모·자식). 상태는 문장 해석이 아니라 데몬이 본 사건으로 바꾼다(질문은 `report_up needs_answer`).
- 팀 모드 화면: 오른쪽 **Manager**(지시 입력·My Orders·Me·루틴), **Activity**(Alerts | Team log), 가운데 Today 의 **Now / History**(Timeline), Ground 연결선·프로젝트 영역·Head Coach 중심 배치, Orders·루틴·진행률·Flow.
- 팀 모드는 **더 키우지 않는다**. 중복 화면은 합치거나 지운다.

## 4. 코딩·작업 규칙

- TypeScript strict, ESM. 색은 `styles.css` 토큰만. 렌더러에서 `window.prompt()` 금지(`askText()`). 데몬 코드에 electron import 금지. 세션 상태·배치 변경은 데몬 경유.
- 검증: `npm run typecheck`, `npm run smoke`(임시 데이터 폴더의 일회용 데몬, 27개; AI 호출 없음). `smoke:ui` 는 `--remote-debugging-port=9334` 로 띄운 앱이 있어야 한다.
- 실행: `npm run dev`(`start-dev.cmd`: `ELECTRON_RUN_AS_NODE`·`NoDefaultCurrentDirectoryInExePath` 해제). Claude Code 셸에서 Electron 을 띄울 땐 이 변수들을 지운다.
- **교체(배포)**: `bash scripts/deploy-keep-sessions.sh` — 새 폴더 `dist-<시각>` 에 빌드 → 데몬만 세션 유지로 내림 → 옛 UI 창만 닫고 새 빌드 기동 → 안 쓰는 옛 `dist*` 삭제. **세션을 멈추는 교체(`killSessions`)는 사용자가 원할 때만.** 빌드·패키징은 PowerShell 이 아니라 Bash 에서 돌린다. 교체 뒤 AgentO 창이 보이는지 확인한다.
- Git: 커밋 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. 저장소 `github.com/dongliquan/AgentO`(AgentO·ReadO 만 GitHub), 작성자는 저장소 로컬 noreply. 개인·회사 이름·도메인을 커밋에 넣지 않는다. README 는 영·한·중·일 4개 언어.
- 설계 문서는 `docs/*.md`(doc-standard 형식), `CLAUDE.md` 는 짧은 메모로 유지.
- 사용자에게는 결과를 먼저, 확인하지 못한 것은 "확인하지 못했다"고 말한다. 화면 변경은 직접 못 봤으면 그렇게 적는다.

## 5. 알려진 문제와 방향

- 꼬임의 큰 원인: 층마다 대화가 따로(HC·Coach·선수), 상태를 문장으로 추측(Needs you·질문 상자·Inbox), 터미널 확인 창이 메시지를 삼킴, 큰 대화를 다시 깨움. 대응은 일 장부·확인 창 자동 수락·깨울 때 안내·headless 확대.
- 미검증: Codex·Gemini 코치의 실제 MCP 연결, Autopilot 의 실사용 동작(세션 하나 모드 포함), 새 Activity 탭·Now/History·단순 모드 Ground 의 화면 확인.
- 다음 우선순위: (1) 세션이 멈추지 않는 교체와 재시작 뒤 이어서 쓰기를 더 다듬기, (2) 단순 모드를 정식 기본으로 굳히기, (3) 협업은 위계 없이 "세션이 다른 세션에 부탁하고 결과를 받는" 가벼운 형태로, (4) 팀 화면 중복 정리.
- 사용 기록(이 PC, 10-26 이후): Session 탭 114·Files 93·Manager 74 번 클릭, Timeline 38·Ground 36·Today 17, 메시지 전송 310. 사용 습관 판단에 쓴다(Help › UI Usage).

---

작업을 시작하기 전에 위 기준(1장)에 비추어 할 일이 맞는 방향인지 한 줄로 말하고, 코드를 바꾸기 전에 관련 파일을 읽어 현재 모양을 확인한다.
