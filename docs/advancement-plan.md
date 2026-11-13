# AgentO 고도화 계획 — 프로젝트 메모리 · 일 식별자 · 이벤트 채널

**대상 버전**: AgentO 1.0.x (2026-10-26)
**관련 코드**: `src/daemon/memory.ts` · `src/daemon/team.ts` · `src/daemon/store.ts` · `src/shared/protocol.ts` · `src/renderer/src/components/FilesPanel.tsx`
**읽는 사람**: AgentO 를 이어서 개발하는 사람. 근거 데이터는 2026-10-23 `usage.report`(7일 102M 토큰: 선수 86% · 코치 14%)

> C(프로젝트 메모리)·B(일 식별자)·A(이벤트 채널, headless 세션)·E(세션 홀더 — 데몬 재시작에도 세션 유지)·F(스모크 스위트 `npm run smoke` / `smoke:ui`)·G(Today 홈, Ctrl+5)가 구현됐다(2026-10-26). D(로컬 모델)만 보류. 데몬 변경은 데몬 재시작 뒤 적용된다.

<a id="toc"></a>

## 목차 

- [**1. 결정과 순서**](#cat-1) (2 항목)
- [**2. 프로젝트 메모리 (C)**](#cat-2) (4 항목)
- [**3. 일 식별자 (B)**](#cat-3) (3 항목)
- [**4. 이벤트 채널 (A)**](#cat-4) (3 항목)
- [**5. 보류·후속 (D·E·F·G)**](#cat-5) (2 항목)
- [📎 **부록**](#appendix) — A.1 변경 파일

---

<a id="cat-1"></a>

# 1 결정과 순서 — 무엇을, 왜 이 순서로 

> 2026-10-26 검토에서 정한 것. 토큰·신뢰성·관측성 세 축 중 구조를 바꾸지 않고 효과가 바로 나는 것부터 간다.

## 1.1 감독의 결정 — 2026-10-26

| 질문 | 결정 | 영향 |
|---|---|---|
| 선수 세션을 headless(이벤트 채널)로 바꿔 터미널 화면 대신 Chat 만 보는 것 | **받아들임** | A 추진. TUI 세션은 필요하면 따로 |
| 로컬 모델(Ollama)로 읽기 일 처리 | **보류** (PC 부담) | D 는 하지 않음. 요약·분류는 규칙 기반 유지 |
| 여러 감독·공유 보드 | **감독 1인 전제** | B 의 일 객체는 소유자·권한 없이 식별자만 |
| macOS 판 | **기능만 동일** | 플랫폼 차이가 큰 A·E 는 Windows 먼저, Mac 은 뒤따라감 |

코치 계층은 유지한다(14% 비용은 이동할 뿐 사라지지 않음 — 2026-10-23 분석). 감독에게 가는 보고만 줄인다(이미 반영: handed on·보고 지침).

## 1.2 순서 — C → B → A, E·F 는 병행, G 는 A 뒤

- **1 프로젝트 메모리** — `memory.ts · update_memory` — 선수 재독 토큰의 근본 대책. 구조 변경 없음. 완료(2026-10-26)
- **2 일 식별자** — `#T123 · inbox.task_id` — Flow·진행률·Timeline·태그를 정규식에서 사실로. 완료(2026-10-26)
- **3 이벤트 채널** — `claude -p stream-json` — 화면 긁기 제거. 세션별 TUI/headless 공존. 완료(2026-10-26)
- **4 E·F·G** — `PTY 홀더 · 스모크 · Today 홈` — 개발 속도와 화면 정리. A 와 병행 또는 그 뒤

> 왼쪽부터 순서. C 가 있으면 B 의 지시·보고 형식이, B 가 있으면 A 의 이벤트 매핑이 쉬워진다.

---

<a id="cat-2"></a>

# 2 프로젝트 메모리 (C) — 세션이 짧게 시작하게 

> 프로젝트마다 짧은 공유 메모 하나. 모든 세션이 시작할 때 받고, 도구로 고친다. 선수 턴당 135K 컨텍스트의 상당 부분은 "다시 알아내는 것"이라서, 알아낸 것을 프로젝트 단위로 남기는 것이 재독 토큰을 줄이는 유일한 지렛대다.

## 2.1 파일과 형식 — `%APPDATA%\AgentO\team\memory\.md`

- 최상위 프로젝트마다 하나. 파트는 프로젝트 것을 쓴다(파트 세션도 같은 메모를 받는다).
- 섹션 5개, 순서 고정: **Decisions**(무엇을 왜 정했나) · **Conventions**(브랜치·커밋·테스트 명령) · **Map**(폴더·핵심 파일·진입점) · **Don't**(함정) · **Open**(열린 질문·대기).
- 한 줄 한 사실(`- ` 목록). 상한: 섹션 20줄, 전체 60줄·6000자, 한 줄 240자. 넘으면 데몬이 **거절**하고 줄이라고 답한다 — 모든 세션의 매 호출에 실리기 때문.
- 첫 줄 `# Project memory — <이름>`, 둘째 줄 `<!-- agento:memory … -->` 표식. 데몬 기동·프로젝트 생성·세션 시작 때 없으면 템플릿으로 만든다(`ensureMemory`).

## 2.2 주입 — `--append-system-prompt`

- Claude 세션의 시작·재개·fresh start 때 `launchExtras` 가 메모 본문(내용 있는 섹션만)을 `--append-system-prompt` 로 붙인다. 비어 있으면 붙이지 않는다.
- 시스템 프롬프트라 **매 호출 캐시에 포함**된다 — 그래서 상한이 작다. 돌고 있는 세션은 다음 시작부터 새 내용을 본다(세션은 자주 hibernate 되므로 수 시간 안에 반영).
- Codex 세션은 미주입(후속). 팀 전체 Head Coach(projectId '')는 프로젝트가 없어 받지 않는다.

## 2.3 도구와 지침 — `update_memory` · headMd/coachMd/PLAYER_INSTRUCTIONS

| 항목 | 내용 |
|---|---|
| 도구 | `update_memory {section, text, mode?, project_id?}` — mode `append`(기본, 중복 제거) · `replace`(섹션 통째) · `remove`(text 를 포함한 줄 삭제). 모든 역할. 팀 Head Coach 는 `project_id` 필수 |
| 코치·수석코치 | 조각이 끝나거나 결정이 나면 다른 세션이 알아야 할 것을 한 줄씩 기록, 낡은 줄은 replace/remove |
| 선수 | 팀원 모두가 알아야 할 것(관례·위치·함정)을 Conventions/Map/Don't 에 한 줄 |
| fresh start | 인수인계 메모 요청에서 **유일하게 허용되는 도구** — 대화가 지워지기 전에 결정·관례·함정을 메모리에 먼저 옮긴다 |
| UI | `Project.memory`(경로) → Files 탭 머리글 「Memory」 버튼이 파일 창으로 연다. 편집은 Open in ReadO |

## 2.4 효과 측정 — `usage.report` 역할별 턴당 컨텍스트

기준선(2026-10-16~23, 7일): 선수 657턴 · 턴당 135K, 코치 158턴 · 턴당 88K. 2주 뒤 같은 지표를 다시 뽑아 **턴당 컨텍스트**와 **fresh start 횟수**가 줄었는지 본다. 메모리 파일 크기(60줄 상한)도 함께.

---

<a id="cat-3"></a>

# 3 일 식별자 (B) — 추론에서 사실로 

> 지금 Flow·진행률·Timeline 기능명·ask/report 태그는 인박스 스레드를 정규식으로 유추한다. 지시마다 데몬이 번호를 붙이고 보고가 번호를 달고 돌아오게 하면 유추가 사라진다. Tasks 탭을 되살리는 것이 아니라 **내부 식별자**다(감독 1인 전제).

## 3.1 번호 매기기 — `#T` · 프로젝트별 연번

- 지시가 만들어지는 곳 세 군데에서 번호를 받는다: `team.order`(감독 지시), `send_to_session directive=true`(세션→세션), `session.note`(직접 입력). 번호는 프로젝트별 연번(`kv` 에 카운터).
- 전달 본문 머리에 `[Task #T12]` 를 넣는다. 받은 세션은 그 번호로 일한다.
- `report_up` 에 선택 인자 `task`; 데몬의 완료 보고(`finished`/`handed on`)는 pending 의 번호를 자동으로 단다. 세션이 번호를 빠뜨린 보고는 종전처럼 스레드로 붙인다(하위 호환).

## 3.2 저장과 프로토콜 — `inbox.task_id` · `Pending.task`

- `inbox` 테이블에 `task_id TEXT` 컬럼(마이그레이션). `InboxItem.taskId?`. `Pending.task` 는 kv 저장에 포함.
- 렌더러 `buildThreads` 는 `taskId` 가 있으면 그것으로 묶고, 없으면 지금의 "마지막 지시" 규칙. `orderProgress` 조각 = 번호, `isAck`/`pieceResult` 는 번호가 있는 보고에서 확정.
- Timeline 기능명: `#T` 의 첫 보고 "기능:" 줄 → 커밋 제목 → 지시문. Report(Done)도 번호 단위.

## 3.3 화면 — 태그 옆 번호

Flow 라벨·Logs·Me 탭의 `MsgTag` 옆에 `#T12` 를 옅게. 같은 번호의 화살표는 Flow 에서 클릭 시 함께 강조. 새 탭은 없다.

---

<a id="cat-4"></a>

# 4 이벤트 채널 (A) — 화면 긁기에서 벗어나기 

> 선수(와 원하면 코치)를 Claude Code 의 headless 모드(`claude -p --output-format stream-json --input-format stream-json`, 구독 로그인 그대로)로 띄우면 메시지 전달·턴 종료·도구 호출·권한 요청·컨텍스트 크기가 전부 이벤트로 온다. plaintext/PROMPT_RE/LIMIT_RE/autoDismiss 가 사라진다.

## 4.1 공존 — 세션별 `mode: tui | headless`

- `Session.mode` 추가. 기본은 새 선수 = headless, 코치 = headless, 사용자가 직접 쓰는 세션(New Chat, 터미널 작업) = tui. 카드 메뉴에서 전환(새 대화로).
- headless 카드는 Chat 뷰만. Terminal 탭 없음. 권한 요청은 이벤트 → Needs-you 가 사실이 된다(선택지 카드가 화면 재생이 아니라 이벤트의 options).
- 전달: stdin 에 user 메시지 JSON. 붙여넣기·Enter 지연·"did not take the message" 판정이 모두 없어진다.

## 4.2 데몬 구조 — `SessionManager` 어댑터

`PtySession`(지금) 과 `StreamSession`(새것) 이 같은 인터페이스(`start/send/interrupt/stop`, 이벤트 `turn.start/turn.end/tool/permission/usage`)를 구현. `Team` 은 인터페이스만 본다. transcript tail 은 그대로 두되 headless 는 이벤트에서 ChatEntry 를 바로 만든다.

## 4.3 위험 —

- `-p` 모드의 권한 처리: `--permission-prompt-tool` 로 MCP 도구에 넘기거나 `canUseTool` 상당의 흐름이 필요 — 설계 시 CLI 버전 확인.
- 세션 재개(`--resume`)와 fresh start 가 stream 모드에서도 같은지 확인.
- 사용자가 직접 끼어들어 타이핑하는 UX 는 Chat 입력창으로 통일된다(이미 그렇게 쓰고 있음).

---

<a id="cat-5"></a>

# 5 보류·후속 (D·E·F·G) 

> 지금 하지 않는 것과 그 이유.

## 5.1 D 로컬 모델 — 보류

PC 부담으로 보류. 요약·분류는 규칙 기반(태그·askingTail) 유지. 다시 볼 조건: 별도 GPU 또는 서버.

## 5.2 E PTY 홀더 · F 스모크 스위트 · G Today 홈 — A 와 병행 또는 그 뒤

- **E**: 세션마다 작은 PTY 홀더 프로세스 + 명명 파이프. 데몬 재시작이 세션을 끊지 않게. A 가 끝나면 headless 세션은 자식 프로세스라 같은 문제가 남으므로 E 는 A 뒤에도 유효.
- **F**: 오늘 CDP 로 하던 확인을 스크립트 스위트로(`scratchpad/*_1023.js` 가 씨앗). 데몬은 가짜 세션 하네스.
- **G**: Needs you · 진행 중 · 오늘 끝난 기능 · 할 일을 한 화면으로. 기존 데이터만 쓴다. A 뒤 Chat 중심으로 UI 가 단순해질 때.

---

<a id="appendix"></a>

<details>
<summary>A 부록 </summary>

## A.1 변경 파일 (B 단계, 2026-10-26)

| 파일 | 변경 |
|---|---|
| `src/daemon/store.ts` | `inbox.task_id` 컬럼(마이그레이션), `addInbox(…, taskId)`, `nextTaskId(projectId)`(kv `tasks` 카운터) |
| `src/daemon/team.ts` | `newTask`/`taskOf`, order·note·send(directive)·create_session 에 번호, `Queued.task`→`Pending.task`(저장 포함), 완료 보고·record 에 번호, 헤더 `— #T12` |
| `src/shared/protocol.ts` | `InboxItem.taskId?` |
| `src/renderer/src/lib/threads.ts` | 번호 있는 보고는 같은 번호의 지시 아래로(없으면 종전 규칙) |
| `MsgTag.tsx` · OrderFlow · TeamFeedItem · MyTalk · `styles.css` | 태그 옆 `#T12` |

## A.2 변경 파일 (C 단계, 2026-10-26)

| 파일 | 변경 |
|---|---|
| `src/daemon/memory.ts` | 새 파일 — 경로·템플릿·파싱·`updateMemory`(상한)·`memorySystemPrompt` |
| `src/daemon/team.ts` | `launchExtras` 주입, `rootProject()`, 도구 `update_memory`, 지침 3곳 |
| `src/daemon/store.ts` · `index.ts` | `Project.memory` 경로, 생성·기동 때 `ensureMemory` |
| `src/daemon/freshstart.ts` | 인수인계 요청에 메모리 먼저 |
| `src/shared/protocol.ts` | `Project.memory?` |
| `src/renderer/src/components/FilesPanel.tsx` · `styles.css` | Files 머리글 「Memory」 |

</details>
