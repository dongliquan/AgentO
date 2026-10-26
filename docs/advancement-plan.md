# AgentO 고도화 계획 — 프로젝트 메모리 · 일 식별자 · 이벤트 채널

<input type="radio" name="xall" id="xo" checked style="display:none">
<input type="radio" name="xall" id="xc" style="display:none">
<style>
/* ═══ 1. 제목 위계 ═══════════════════════════════════════
   좌측 막대는 h2 전용. 챕터(h1)는 옅은 밴드 + 번호 배지(.num), 소제목(h3)은 옅은 배지(.n3), 문서 제목은 밑줄.
   <a id> 앵커는 <p>로 감싸져 "a + h1" 이 안 걸리므로 :first-of-type 로 구분. */
h1 { font-size: 1.3em; font-weight: 800; color: #2f3640; background: #eef1f4;
     border-radius: 6px; padding: 9px 13px 9px 10px; margin: 2.2em 0 1em }
/* 챕터 번호 배지 — 제목 앞 <span class="num">N</span> (부록은 A) */
.num { display: inline-block; min-width: 1.55em; text-align: center; background: #3f4650; color: #fff;
       border-radius: 6px; padding: 2px 8px; margin-right: 10px; font-size: .9em; line-height: 1.35; vertical-align: 2px }
h1:first-of-type { font-size: 1.5em; color: #212529; background: none; border-radius: 0;
     border-bottom: 3px solid #343a40; padding: 0 0 7px; margin: 1.8em 0 .8em }
h2 { font-size: 1.2em; font-weight: 700; color: #343a40;
     border-left: 6px solid #343a40; padding: 2px 0 2px 11px; margin: 1.5em 0 .6em }
h2:first-of-type { border-left: 0; padding-left: 0 }                          /* 목차 */
details h2:first-of-type { border-left: 6px solid #343a40; padding-left: 11px } /* 부록 A.1 */
h3 { font-size: 1.02em; font-weight: 700; color: #343a40; margin: 1.9em 0 .8em }   /* 항목 안 단락 경계 — 막대 없이 번호 배지로 */
.n3 { display: inline-block; background: #f1f3f5; color: #5b6168; border: 1px solid #dfe3e7;   /* 소제목 배지 N.M.k — 항목 배지보다 한 단 옅게 */
      border-radius: 4px; padding: 0 6px; margin-right: 8px; font-size: .82em; font-weight: 800; vertical-align: 1px }
/* 본문 문단 간격 — 소제목→문단(.8em)보다 문단↔문단(.5em)이 작아야 "소제목이 문단을 거느린다"로 읽힌다. 넓으면 빈 줄이 들어간 듯 보인다(실제 지적) */
.ib p { margin: .3em 0 .5em }
h4 { font-size: .96em; font-weight: 700; color: #6c757d; margin: 1.5em 0 .5em }
h4::before { content: "▸ "; color: #adb5bd }
/* 제목 줄 우측 컨트롤 (float 이라 .hctl 이 든 heading 에만 걸린다) */
.hctl { float: right; font-weight: 400; white-space: nowrap; margin-left: 14px }
h1 .hctl { font-size: .6em; padding-top: .35em }
h1 .hctl a { color: #0969da }
h2 .hctl { font-size: .72em; padding-top: .18em }
/* 부록 헤더(summary.apx) — 챕터 밴드와 같은 모양, 펼침 삼각형 없이 */
summary.apx { list-style: none; cursor: pointer; font-size: 1.3em; font-weight: 800; color: #2f3640;
     background: #eef1f4; border-radius: 6px; padding: 9px 13px 9px 10px; margin: 2.2em 0 1em }
summary.apx::-webkit-details-marker { display: none }  summary.apx::marker { content: "" }
summary.apx .hctl { font-size: .6em; padding-top: .35em }
summary.apx .hctl a { color: #0969da }
/* ═══ 2. 접히는 항목(.it) — 체크박스 방식 ══════════════════
   native details 는 닫힌 내용을 shadow slot에서 숨겨 CSS로 못 되살린다
   → '전체 접기' 뒤 개별 펼치기가 불가. 그래서 체크박스로 상태를 직접 가진다.
   (CSS 주석에 꺾쇠 태그 리터럴을 쓰지 말 것 — 태그 균형 검사에 잡힌다)
   모드별 체크박스 2개(.ca 펼침모드 / .cb 접기모드) → 모드 전환 시 반전 없음.
   ★ .it 는 라디오의 직계 형제 → 모든 규칙에 "~ .it" 와 "~ * .it" 를 함께 쓴다. */
.it { margin: 1.1em 0 1.5em }
.it + .it { border-top: 1px dashed #e3e7ea; padding-top: .9em }   /* 항목 "사이"에만 점선 → 마지막 항목엔 선 없음 */
.it > .ib { padding-left: 14px }                                    /* 본문 들여쓰기 — 헤더와 왼쪽 선이 같으면 소속이 안 보임 */
.it > .ih { display: block; font-size: 1.02em; font-weight: 700; color: #2f3640;
     padding: 4px 0; margin-bottom: .9em; cursor: pointer; user-select: none }
.it > .ih:hover { color: #0969da }
.it > .ih::after { content: "▼"; float: right; color: #adb5bd; font-size: .85em; padding-top: 2px }  /* 펼침 표시 = 우측 */
.ih .n { display: inline-block; background: #e9edf1; color: #3f4650; border-radius: 5px;             /* 옅은 번호 배지 */
         padding: 1px 7px; margin-right: 9px; font-size: .86em; font-weight: 800; vertical-align: 1px }
.ih .sub { color: #6c757d; font-weight: 500; margin-left: 6px; font-size: .92em }                    /* 회색 부제 */
/* 모드에 맞는 라벨 하나만 */
#xo:checked ~ .it > .lb, #xo:checked ~ * .it > .lb,
#xc:checked ~ .it > .la, #xc:checked ~ * .it > .la { display: none }
/* 펼침 모드: 체크 = 사용자가 닫음 */
#xo:checked ~ .it > .ca:checked ~ .ib,        #xo:checked ~ * .it > .ca:checked ~ .ib { display: none }
#xo:checked ~ .it > .ca:checked ~ .la::after,  #xo:checked ~ * .it > .ca:checked ~ .la::after  { content: "▶" }
/* 접기 모드: 체크 = 사용자가 열음 */
#xc:checked ~ .it > .cb:not(:checked) ~ .ib,        #xc:checked ~ * .it > .cb:not(:checked) ~ .ib { display: none }
#xc:checked ~ .it > .cb:not(:checked) ~ .lb::after,  #xc:checked ~ * .it > .cb:not(:checked) ~ .lb::after  { content: "▶" }
/* 목차의 전체 펼치기/접기 라벨 — 현재 모드를 굵게 */
#xo:checked ~ * label[for="xo"], #xc:checked ~ * label[for="xc"] { font-weight: 700 }
/* ═══ 3. 콜아웃 — 막대 없이 둥근 박스 + 라벨 ═════════════════ */
blockquote, .warn, .tip { border: 1px solid; border-radius: 7px;
     margin: .9em 0 1.4em; padding: 9px 12px; color: #333 }
blockquote { border-color: #cfe2f7; background: #f5f9fe }
blockquote > p:first-child { margin-top: 0 }  blockquote > p:last-child { margin-bottom: 0 }
h1 + blockquote, h2 + blockquote, h3 + blockquote { border: 0; background: none; border-radius: 0;   /* 제목 직후 > = 도입문(박스 아님) */
     padding: 0 0 0 2px; margin: -.2em 0 1.3em; font-size: 1.02em; color: #5b6168 }
.warn { border-color: #f0d9ac; background: #fffaf2 }
.warn::before { content: "⚠️ 주의"; display: inline-block; font-weight: 800; font-size: .82em;
     color: #a35d00; background: #fbeccc; border-radius: 20px; padding: 1px 9px; margin-right: 7px }
.tip { border-color: #b9e5c9; background: #f2fbf5 }
.tip::before { content: "💡 쉽게 말하면"; display: inline-block; font-weight: 800; font-size: .82em;
     color: #0b6b39; background: #d8f2e2; border-radius: 20px; padding: 1px 9px; margin-right: 7px }
/* ═══ 4. 표 · 코드 · 구분선 ════════════════════════════════
   표는 좁은 화면에서 표 안에서만 가로 스크롤. th 배경 없으면 본문 zebra보다 약해 보임. */
table { margin: .5em 0 1.5em !important; display: block; width: max-content;
        max-width: 100%; overflow-x: auto; border-collapse: collapse }
th, td { border: 1px solid #e4e7eb; padding: 6px 10px; text-align: left; vertical-align: top }
th { background: #e9edf1; color: #2f3640; font-weight: 700; text-align: center;   /* 배경으로 구분 → 테두리 없이 · 가운데 정렬 (실제 지적) */
     border: 0; white-space: nowrap }
pre { margin: .6em 0 1.5em !important; overflow-x: auto }
code { background: #f1f3f5; padding: 1px 5px; border-radius: 3px; font-size: .92em }
.cap { font-size: .86em; color: #868e96; margin: .3em 0 1.5em; padding-left: 2px }
table + .cap, pre + .cap { margin-top: -1.1em }        /* 표·코드 아래 캡션만 붙인다 — 도표 뒤에 음수면 겹친다(실제 사례) */
div[style*="Noto Sans KR"] { margin: .7em 0 1.5em }      /* 카드 흐름도 컨테이너 하단 여백 */
ul, ol { margin: .6em 0 1em }
hr { border: 0; margin: 2.2em 0 }   /* 선 없이 여백만 — 챕터 구분은 h1 밴드가 함 */
/* ═══ 5. 흐름 카드 — nowrap + 가로 스크롤 (wrap이면 좁은 화면에서 세로로 쌓임) ═══ */
.lay { display: flex; flex-wrap: nowrap; gap: 8px; margin: .7em 0 1.6em;
       align-items: stretch; overflow-x: auto; padding-bottom: 6px }
.cd { flex: 0 0 200px; border: 1px solid #e4e7eb; border-top-width: 4px; border-radius: 7px;
      padding: 8px 10px; background: #fff; font-size: 12px; line-height: 1.5 }
.cd > b { display: block; font-size: 12.5px; margin-bottom: 2px }
.cd .k { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: #495057 }
.cd .s { display: block; margin-top: 4px; color: #6c757d; font-size: 11px }
.ar { align-self: center; color: #adb5bd; font-weight: 800; font-size: 16px; flex: 0 0 auto }
.tg { display: inline-block; font-size: 10.5px; font-weight: 700; border-radius: 20px;
      padding: 1px 8px; margin-right: 4px }
/* ═══ 6. 번호 배지(.cn) — 원문자(circled digits) 대체 ═══════════════════
   U+2460~2473 은 폰트 대체(fallback)로 2·3·5·6 등 일부 글리프 모양이 달라진다(실제 지적).
   본문·표·캡션의 번호는 항상 <span class="cn">N</span> 으로 쓴다. 코드/SQL 안은 (1)(2) 로. */
.cn { display: inline-block; min-width: 1.55em; height: 1.55em; padding: 0 .2em; border-radius: 50%;
      border: 1.5px solid #3f4650; color: #2f3640; background: #fff; text-align: center;
      line-height: 1.45em; font-weight: 800; font-size: .82em; font-family: ui-monospace, Consolas, monospace;
      vertical-align: .08em; margin: 0 .12em }
/* 순서·단계 번호(1→2→3)는 .st(사각), 분류·종류 번호(상품종류 ①~⑥ 등)는 .cn(원형) — 같은 문서에서 두 뜻이 섞이면 모양으로 구분한다 */
.st { display: inline-block; min-width: 1.4em; height: 1.4em; padding: 0 .25em; border-radius: 3px;              /* 순서·단계 번호 — 분류 배지(.cn)와 모양을 가른다 */
      background: #e9edf1; color: #3f4650; text-align: center; line-height: 1.4em; font-weight: 700; font-size: .8em;
      font-family: ui-monospace, Consolas, monospace; vertical-align: .08em; margin: 0 .12em }
</style>

**대상 버전**: AgentO 1.0.x (2026-10-26)
**관련 코드**: `src/daemon/memory.ts` · `src/daemon/team.ts` · `src/daemon/store.ts` · `src/shared/protocol.ts` · `src/renderer/src/components/FilesPanel.tsx`
**읽는 사람**: AgentO 를 이어서 개발하는 사람. 근거 데이터는 2026-10-23 `usage.report`(7일 102M 토큰: 선수 86% · 코치 14%)

<div class="warn">C(프로젝트 메모리)와 B(일 식별자)는 구현됐다(2026-10-26). A 는 설계이며 코드는 아직 없다. 데몬 변경은 데몬 재시작 뒤 적용된다.</div>

<a id="toc"></a>

## 목차 <span class="hctl"><label for="xo" style="color:#0969da;cursor:pointer;text-decoration:underline">▼ 전체 펼치기</label> · <label for="xc" style="color:#0969da;cursor:pointer;text-decoration:underline">▶ 전체 접기</label></span>

- [**1. 결정과 순서**](#cat-1) (2 항목)
- [**2. 프로젝트 메모리 (C)**](#cat-2) (4 항목)
- [**3. 일 식별자 (B)**](#cat-3) (3 항목)
- [**4. 이벤트 채널 (A)**](#cat-4) (3 항목)
- [**5. 보류·후속 (D·E·F·G)**](#cat-5) (2 항목)
- [📎 **부록**](#appendix) — A.1 변경 파일

---


<a id="cat-1"></a>

# <span class="num">1</span> 결정과 순서 — 무엇을, 왜 이 순서로 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 2026-10-26 검토에서 정한 것. 토큰·신뢰성·관측성 세 축 중 구조를 바꾸지 않고 효과가 바로 나는 것부터 간다.

<div class="it">
<input type="checkbox" id="i1-1a" class="ca" style="display:none">
<input type="checkbox" id="i1-1b" class="cb" style="display:none">
<label for="i1-1a" class="ih la"><span class="n">1.1</span><b>감독의 결정</b> <span class="sub">2026-10-26</span></label>
<label for="i1-1b" class="ih lb"><span class="n">1.1</span><b>감독의 결정</b> <span class="sub">2026-10-26</span></label>
<div class="ib">

| 질문 | 결정 | 영향 |
|---|---|---|
| 선수 세션을 headless(이벤트 채널)로 바꿔 터미널 화면 대신 Chat 만 보는 것 | **받아들임** | <span class="tg" style="background:#7c3aed1a;color:#7c3aed">A</span> 추진. TUI 세션은 필요하면 따로 |
| 로컬 모델(Ollama)로 읽기 일 처리 | **보류** (PC 부담) | D 는 하지 않음. 요약·분류는 규칙 기반 유지 |
| 여러 감독·공유 보드 | **감독 1인 전제** | <span class="tg" style="background:#1a4d8f1a;color:#1a4d8f">B</span> 의 일 객체는 소유자·권한 없이 식별자만 |
| macOS 판 | **기능만 동일** | 플랫폼 차이가 큰 A·E 는 Windows 먼저, Mac 은 뒤따라감 |

코치 계층은 유지한다(14% 비용은 이동할 뿐 사라지지 않음 — 2026-10-23 분석). 감독에게 가는 보고만 줄인다(이미 반영: handed on·보고 지침).

</div>
</div>

<div class="it">
<input type="checkbox" id="i1-2a" class="ca" style="display:none">
<input type="checkbox" id="i1-2b" class="cb" style="display:none">
<label for="i1-2a" class="ih la"><span class="n">1.2</span><b>순서</b> <span class="sub">C → B → A, E·F 는 병행, G 는 A 뒤</span></label>
<label for="i1-2b" class="ih lb"><span class="n">1.2</span><b>순서</b> <span class="sub">C → B → A, E·F 는 병행, G 는 A 뒤</span></label>
<div class="ib">

<div class="lay">
 <div class="cd" style="border-top-color:#1a7f4b"><b><span class="tg" style="background:#1a7f4b1a;color:#1a7f4b">1</span> 프로젝트 메모리</b><span class="k">memory.ts · update_memory</span><span class="s">선수 재독 토큰의 근본 대책. 구조 변경 없음. 완료(2026-10-26)</span></div>
 <div class="ar">→</div>
 <div class="cd" style="border-top-color:#1a4d8f"><b><span class="tg" style="background:#1a4d8f1a;color:#1a4d8f">2</span> 일 식별자</b><span class="k">#T123 · inbox.task_id</span><span class="s">Flow·진행률·Timeline·태그를 정규식에서 사실로. 완료(2026-10-26)</span></div>
 <div class="ar">→</div>
 <div class="cd" style="border-top-color:#7c3aed"><b><span class="tg" style="background:#7c3aed1a;color:#7c3aed">3</span> 이벤트 채널</b><span class="k">claude -p stream-json</span><span class="s">화면 긁기 제거. 세션별 TUI/headless 공존</span></div>
 <div class="ar">→</div>
 <div class="cd" style="border-top-color:#8a6d1a"><b><span class="tg" style="background:#8a6d1a1a;color:#8a6d1a">4</span> E·F·G</b><span class="k">PTY 홀더 · 스모크 · Today 홈</span><span class="s">개발 속도와 화면 정리. A 와 병행 또는 그 뒤</span></div>
</div>
<div class="cap">왼쪽부터 순서. C 가 있으면 B 의 지시·보고 형식이, B 가 있으면 A 의 이벤트 매핑이 쉬워진다.</div>

</div>
</div>


---

<a id="cat-2"></a>

# <span class="num">2</span> 프로젝트 메모리 (C) — 세션이 짧게 시작하게 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 프로젝트마다 짧은 공유 메모 하나. 모든 세션이 시작할 때 받고, 도구로 고친다. 선수 턴당 135K 컨텍스트의 상당 부분은 "다시 알아내는 것"이라서, 알아낸 것을 프로젝트 단위로 남기는 것이 재독 토큰을 줄이는 유일한 지렛대다.

<div class="it">
<input type="checkbox" id="i2-1a" class="ca" style="display:none">
<input type="checkbox" id="i2-1b" class="cb" style="display:none">
<label for="i2-1a" class="ih la"><span class="n">2.1</span><b>파일과 형식</b> <span class="sub">`%APPDATA%\AgentO\team\memory\<projectId>.md`</span></label>
<label for="i2-1b" class="ih lb"><span class="n">2.1</span><b>파일과 형식</b> <span class="sub">`%APPDATA%\AgentO\team\memory\<projectId>.md`</span></label>
<div class="ib">

- 최상위 프로젝트마다 하나. 파트는 프로젝트 것을 쓴다(파트 세션도 같은 메모를 받는다).
- 섹션 5개, 순서 고정: **Decisions**(무엇을 왜 정했나) · **Conventions**(브랜치·커밋·테스트 명령) · **Map**(폴더·핵심 파일·진입점) · **Don't**(함정) · **Open**(열린 질문·대기).
- 한 줄 한 사실(`- ` 목록). 상한: 섹션 20줄, 전체 60줄·6000자, 한 줄 240자. 넘으면 데몬이 **거절**하고 줄이라고 답한다 — 모든 세션의 매 호출에 실리기 때문.
- 첫 줄 `# Project memory — <이름>`, 둘째 줄 `<!-- agento:memory … -->` 표식. 데몬 기동·프로젝트 생성·세션 시작 때 없으면 템플릿으로 만든다(`ensureMemory`).

</div>
</div>

<div class="it">
<input type="checkbox" id="i2-2a" class="ca" style="display:none">
<input type="checkbox" id="i2-2b" class="cb" style="display:none">
<label for="i2-2a" class="ih la"><span class="n">2.2</span><b>주입</b> <span class="sub">`--append-system-prompt`</span></label>
<label for="i2-2b" class="ih lb"><span class="n">2.2</span><b>주입</b> <span class="sub">`--append-system-prompt`</span></label>
<div class="ib">

- Claude 세션의 시작·재개·fresh start 때 `launchExtras` 가 메모 본문(내용 있는 섹션만)을 `--append-system-prompt` 로 붙인다. 비어 있으면 붙이지 않는다.
- 시스템 프롬프트라 **매 호출 캐시에 포함**된다 — 그래서 상한이 작다. 돌고 있는 세션은 다음 시작부터 새 내용을 본다(세션은 자주 hibernate 되므로 수 시간 안에 반영).
- Codex 세션은 미주입(후속). 팀 전체 Head Coach(projectId '')는 프로젝트가 없어 받지 않는다.

</div>
</div>

<div class="it">
<input type="checkbox" id="i2-3a" class="ca" style="display:none">
<input type="checkbox" id="i2-3b" class="cb" style="display:none">
<label for="i2-3a" class="ih la"><span class="n">2.3</span><b>도구와 지침</b> <span class="sub">`update_memory` · headMd/coachMd/PLAYER_INSTRUCTIONS</span></label>
<label for="i2-3b" class="ih lb"><span class="n">2.3</span><b>도구와 지침</b> <span class="sub">`update_memory` · headMd/coachMd/PLAYER_INSTRUCTIONS</span></label>
<div class="ib">

| 항목 | 내용 |
|---|---|
| 도구 | `update_memory {section, text, mode?, project_id?}` — mode `append`(기본, 중복 제거) · `replace`(섹션 통째) · `remove`(text 를 포함한 줄 삭제). 모든 역할. 팀 Head Coach 는 `project_id` 필수 |
| 코치·수석코치 | 조각이 끝나거나 결정이 나면 다른 세션이 알아야 할 것을 한 줄씩 기록, 낡은 줄은 replace/remove |
| 선수 | 팀원 모두가 알아야 할 것(관례·위치·함정)을 Conventions/Map/Don't 에 한 줄 |
| fresh start | 인수인계 메모 요청에서 **유일하게 허용되는 도구** — 대화가 지워지기 전에 결정·관례·함정을 메모리에 먼저 옮긴다 |
| UI | `Project.memory`(경로) → Files 탭 머리글 「Memory」 버튼이 파일 창으로 연다. 편집은 Open in ReadO |

</div>
</div>

<div class="it">
<input type="checkbox" id="i2-4a" class="ca" style="display:none">
<input type="checkbox" id="i2-4b" class="cb" style="display:none">
<label for="i2-4a" class="ih la"><span class="n">2.4</span><b>효과 측정</b> <span class="sub">`usage.report` 역할별 턴당 컨텍스트</span></label>
<label for="i2-4b" class="ih lb"><span class="n">2.4</span><b>효과 측정</b> <span class="sub">`usage.report` 역할별 턴당 컨텍스트</span></label>
<div class="ib">

기준선(2026-10-16~23, 7일): 선수 657턴 · 턴당 135K, 코치 158턴 · 턴당 88K. 2주 뒤 같은 지표를 다시 뽑아 **턴당 컨텍스트**와 **fresh start 횟수**가 줄었는지 본다. 메모리 파일 크기(60줄 상한)도 함께.

</div>
</div>


---

<a id="cat-3"></a>

# <span class="num">3</span> 일 식별자 (B) — 추론에서 사실로 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 지금 Flow·진행률·Timeline 기능명·ask/report 태그는 인박스 스레드를 정규식으로 유추한다. 지시마다 데몬이 번호를 붙이고 보고가 번호를 달고 돌아오게 하면 유추가 사라진다. Tasks 탭을 되살리는 것이 아니라 **내부 식별자**다(감독 1인 전제).

<div class="it">
<input type="checkbox" id="i3-1a" class="ca" style="display:none">
<input type="checkbox" id="i3-1b" class="cb" style="display:none">
<label for="i3-1a" class="ih la"><span class="n">3.1</span><b>번호 매기기</b> <span class="sub">`#T<n>` · 프로젝트별 연번</span></label>
<label for="i3-1b" class="ih lb"><span class="n">3.1</span><b>번호 매기기</b> <span class="sub">`#T<n>` · 프로젝트별 연번</span></label>
<div class="ib">

- 지시가 만들어지는 곳 세 군데에서 번호를 받는다: `team.order`(감독 지시), `send_to_session directive=true`(세션→세션), `session.note`(직접 입력). 번호는 프로젝트별 연번(`kv` 에 카운터).
- 전달 본문 머리에 `[Task #T12]` 를 넣는다. 받은 세션은 그 번호로 일한다.
- `report_up` 에 선택 인자 `task`; 데몬의 완료 보고(`finished`/`handed on`)는 pending 의 번호를 자동으로 단다. 세션이 번호를 빠뜨린 보고는 종전처럼 스레드로 붙인다(하위 호환).

</div>
</div>

<div class="it">
<input type="checkbox" id="i3-2a" class="ca" style="display:none">
<input type="checkbox" id="i3-2b" class="cb" style="display:none">
<label for="i3-2a" class="ih la"><span class="n">3.2</span><b>저장과 프로토콜</b> <span class="sub">`inbox.task_id` · `Pending.task`</span></label>
<label for="i3-2b" class="ih lb"><span class="n">3.2</span><b>저장과 프로토콜</b> <span class="sub">`inbox.task_id` · `Pending.task`</span></label>
<div class="ib">

- `inbox` 테이블에 `task_id TEXT` 컬럼(마이그레이션). `InboxItem.taskId?`. `Pending.task` 는 kv 저장에 포함.
- 렌더러 `buildThreads` 는 `taskId` 가 있으면 그것으로 묶고, 없으면 지금의 "마지막 지시" 규칙. `orderProgress` 조각 = 번호, `isAck`/`pieceResult` 는 번호가 있는 보고에서 확정.
- Timeline 기능명: `#T` 의 첫 보고 "기능:" 줄 → 커밋 제목 → 지시문. Report(Done)도 번호 단위.

</div>
</div>

<div class="it">
<input type="checkbox" id="i3-3a" class="ca" style="display:none">
<input type="checkbox" id="i3-3b" class="cb" style="display:none">
<label for="i3-3a" class="ih la"><span class="n">3.3</span><b>화면</b> <span class="sub">태그 옆 번호</span></label>
<label for="i3-3b" class="ih lb"><span class="n">3.3</span><b>화면</b> <span class="sub">태그 옆 번호</span></label>
<div class="ib">

Flow 라벨·Logs·Me 탭의 `MsgTag` 옆에 `#T12` 를 옅게. 같은 번호의 화살표는 Flow 에서 클릭 시 함께 강조. 새 탭은 없다.

</div>
</div>


---

<a id="cat-4"></a>

# <span class="num">4</span> 이벤트 채널 (A) — 화면 긁기에서 벗어나기 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 선수(와 원하면 코치)를 Claude Code 의 headless 모드(`claude -p --output-format stream-json --input-format stream-json`, 구독 로그인 그대로)로 띄우면 메시지 전달·턴 종료·도구 호출·권한 요청·컨텍스트 크기가 전부 이벤트로 온다. plaintext/PROMPT_RE/LIMIT_RE/autoDismiss 가 사라진다.

<div class="it">
<input type="checkbox" id="i4-1a" class="ca" style="display:none">
<input type="checkbox" id="i4-1b" class="cb" style="display:none">
<label for="i4-1a" class="ih la"><span class="n">4.1</span><b>공존</b> <span class="sub">세션별 `mode: tui | headless`</span></label>
<label for="i4-1b" class="ih lb"><span class="n">4.1</span><b>공존</b> <span class="sub">세션별 `mode: tui | headless`</span></label>
<div class="ib">

- `Session.mode` 추가. 기본은 새 선수 = headless, 코치 = headless, 사용자가 직접 쓰는 세션(New Chat, 터미널 작업) = tui. 카드 메뉴에서 전환(새 대화로).
- headless 카드는 Chat 뷰만. Terminal 탭 없음. 권한 요청은 이벤트 → Needs-you 가 사실이 된다(선택지 카드가 화면 재생이 아니라 이벤트의 options).
- 전달: stdin 에 user 메시지 JSON. 붙여넣기·Enter 지연·"did not take the message" 판정이 모두 없어진다.

</div>
</div>

<div class="it">
<input type="checkbox" id="i4-2a" class="ca" style="display:none">
<input type="checkbox" id="i4-2b" class="cb" style="display:none">
<label for="i4-2a" class="ih la"><span class="n">4.2</span><b>데몬 구조</b> <span class="sub">`SessionManager` 어댑터</span></label>
<label for="i4-2b" class="ih lb"><span class="n">4.2</span><b>데몬 구조</b> <span class="sub">`SessionManager` 어댑터</span></label>
<div class="ib">

`PtySession`(지금) 과 `StreamSession`(새것) 이 같은 인터페이스(`start/send/interrupt/stop`, 이벤트 `turn.start/turn.end/tool/permission/usage`)를 구현. `Team` 은 인터페이스만 본다. transcript tail 은 그대로 두되 headless 는 이벤트에서 ChatEntry 를 바로 만든다.

</div>
</div>

<div class="it">
<input type="checkbox" id="i4-3a" class="ca" style="display:none">
<input type="checkbox" id="i4-3b" class="cb" style="display:none">
<label for="i4-3a" class="ih la"><span class="n">4.3</span><b>위험</b> <span class="sub"></span></label>
<label for="i4-3b" class="ih lb"><span class="n">4.3</span><b>위험</b> <span class="sub"></span></label>
<div class="ib">

- `-p` 모드의 권한 처리: `--permission-prompt-tool` 로 MCP 도구에 넘기거나 `canUseTool` 상당의 흐름이 필요 — 설계 시 CLI 버전 확인.
- 세션 재개(`--resume`)와 fresh start 가 stream 모드에서도 같은지 확인.
- 사용자가 직접 끼어들어 타이핑하는 UX 는 Chat 입력창으로 통일된다(이미 그렇게 쓰고 있음).

</div>
</div>


---

<a id="cat-5"></a>

# <span class="num">5</span> 보류·후속 (D·E·F·G) <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 지금 하지 않는 것과 그 이유.

<div class="it">
<input type="checkbox" id="i5-1a" class="ca" style="display:none">
<input type="checkbox" id="i5-1b" class="cb" style="display:none">
<label for="i5-1a" class="ih la"><span class="n">5.1</span><b>D 로컬 모델</b> <span class="sub">보류</span></label>
<label for="i5-1b" class="ih lb"><span class="n">5.1</span><b>D 로컬 모델</b> <span class="sub">보류</span></label>
<div class="ib">

PC 부담으로 보류. 요약·분류는 규칙 기반(태그·askingTail) 유지. 다시 볼 조건: 별도 GPU 또는 서버.

</div>
</div>

<div class="it">
<input type="checkbox" id="i5-2a" class="ca" style="display:none">
<input type="checkbox" id="i5-2b" class="cb" style="display:none">
<label for="i5-2a" class="ih la"><span class="n">5.2</span><b>E PTY 홀더 · F 스모크 스위트 · G Today 홈</b> <span class="sub">A 와 병행 또는 그 뒤</span></label>
<label for="i5-2b" class="ih lb"><span class="n">5.2</span><b>E PTY 홀더 · F 스모크 스위트 · G Today 홈</b> <span class="sub">A 와 병행 또는 그 뒤</span></label>
<div class="ib">

- **E**: 세션마다 작은 PTY 홀더 프로세스 + 명명 파이프. 데몬 재시작이 세션을 끊지 않게. A 가 끝나면 headless 세션은 자식 프로세스라 같은 문제가 남으므로 E 는 A 뒤에도 유효.
- **F**: 오늘 CDP 로 하던 확인을 스크립트 스위트로(`scratchpad/*_1023.js` 가 씨앗). 데몬은 가짜 세션 하네스.
- **G**: Needs you · 진행 중 · 오늘 끝난 기능 · 할 일을 한 화면으로. 기존 데이터만 쓴다. A 뒤 Chat 중심으로 UI 가 단순해질 때.

</div>
</div>


---

<a id="appendix"></a>

<details>
<summary class="apx"><span class="num">A</span> 부록 <span class="hctl"><a href="#toc">↑ 목차로</a></span></summary>

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

