# AgentO Timeline 보기 설계 — 프로젝트의 기능 완료 타임라인

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

**대상 버전**: AgentO 1.0.0 (2026-10-21)
**관련 코드**: `src/renderer/src/lib/threads.ts` · `lib/progress.ts` · `components/TeamLog.tsx` · `components/Toolbar.tsx` · `store.ts`
**읽는 사람**: AgentO 를 이어서 개발하는 사람, 그리고 이 보기를 쓸 감독(사용자)

<a id="toc"></a>

## 목차 <span class="hctl"><label for="xo" style="color:#0969da;cursor:pointer;text-decoration:underline">▼ 전체 펼치기</label> · <label for="xc" style="color:#0969da;cursor:pointer;text-decoration:underline">▶ 전체 접기</label></span>

- [**1. 개요 — 프로젝트의 진행을 git log 처럼**](#cat-1) (3 항목)
- [**2. 데이터 — 점과 선을 무엇으로 만드나**](#cat-2) (4 항목)
- [**3. 화면 — 그래프, 상세, 조작**](#cat-3) (3 항목)
- [**4. 구현 계획**](#cat-4) (3 항목)
- [**5. 정할 것과 후속 과제**](#cat-5) (2 항목)

---

<a id="cat-1"></a>

# <span class="num">1</span> 개요 — 프로젝트의 진행을 git log 처럼 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 보기 모드에 「Timeline」을 추가한다. 프로젝트는 main 브랜치, 파트는 브랜치, 일 한 조각이 끝날 때마다 push 처럼 점이 찍히고, 감독 지시가 다 끝나면 main 으로 merge 된다. 점을 누르면 그 기능이 무엇이었는지 바로 보인다.

<div class="it">
<input type="checkbox" id="i1-1a" class="ca" style="display:none">
<input type="checkbox" id="i1-1b" class="cb" style="display:none">
<label for="i1-1a" class="ih la"><span class="n">1.1</span><b>화면 그림</b> <span class="sub">세로 시간축 · 레인 = 파트 · 점 = 완료된 일</span></label>
<label for="i1-1b" class="ih lb"><span class="n">1.1</span><b>화면 그림</b> <span class="sub">세로 시간축 · 레인 = 파트 · 점 = 완료된 일</span></label>
<div class="ib">

지금 무엇이 어디까지 됐는지를 Logs(대화 순서)나 Ground(현재 상태)로는 한눈에 보기 어렵다. History 는 **시간에 따른 결과물**만 남긴 그래프다.

<div style="font-family:'Noto Sans KR',sans-serif;display:flex;gap:14px;align-items:flex-start;overflow-x:auto">
<svg width="620" height="330" viewBox="0 0 620 330" style="flex:0 0 auto;background:#fff;border:1px solid #e9ecef;border-radius:8px">
<text x="14" y="20" font-size="11" fill="#868e96">최신 ↑</text>
<text x="40" y="44" font-size="11" font-weight="700" fill="#1a4d8f">main · Sample-App</text>
<text x="190" y="44" font-size="11" font-weight="700" fill="#1a7f37">백엔드</text>
<text x="270" y="44" font-size="11" font-weight="700" fill="#1a7f37">프론트</text>
<text x="350" y="44" font-size="11" font-weight="700" fill="#1a7f37">QA</text>
<line x1="70" y1="56" x2="70" y2="318" stroke="#1a4d8f" stroke-width="3"/>
<line x1="200" y1="96" x2="200" y2="262" stroke="#1a7f37" stroke-width="2.5"/>
<line x1="280" y1="96" x2="280" y2="206" stroke="#1a7f37" stroke-width="2.5"/>
<line x1="360" y1="150" x2="360" y2="206" stroke="#1a7f37" stroke-width="2.5" stroke-dasharray="5 4"/>
<path d="M70 290 C 120 290, 200 285, 200 262" fill="none" stroke="#1a7f37" stroke-width="2"/>
<path d="M70 290 C 140 290, 280 230, 280 206" fill="none" stroke="#1a7f37" stroke-width="2"/>
<path d="M200 96 C 200 80, 120 76, 70 76" fill="none" stroke="#cf7700" stroke-width="2"/>
<path d="M280 96 C 280 84, 140 80, 70 78" fill="none" stroke="#cf7700" stroke-width="2"/>
<circle cx="70" cy="290" r="8" fill="#7c3aed"/><text x="86" y="294" font-size="11" fill="#212529">감독 지시: 시뮬레이션 MVP</text>
<circle cx="200" cy="230" r="6" fill="#1a7f37"/><text x="212" y="234" font-size="10.5" fill="#495057">수집·파서 (ef9f918)</text>
<circle cx="280" cy="180" r="6" fill="#1a7f37"/><text x="292" y="184" font-size="10.5" fill="#495057">관제실 화면 (7389a74)</text>
<circle cx="360" cy="180" r="6" fill="#fff" stroke="#1a7f37" stroke-width="2.5"/><text x="372" y="184" font-size="10.5" fill="#495057">검증 진행 중</text>
<circle cx="200" cy="150" r="6" fill="#1a7f37"/><text x="212" y="154" font-size="10.5" fill="#495057">자동수정 엔진</text>
<circle cx="70" cy="76" r="9" fill="#cf7700"/><text x="86" y="72" font-size="11" font-weight="700" fill="#212529">지시 완료 (merge)</text>
<text x="86" y="88" font-size="10" fill="#868e96">조각 3/3 보고 · 10-20 14:40</text>
</svg>
<div style="flex:0 0 auto;width:168px;border:1px solid #e9ecef;border-radius:8px;padding:9px;background:#fcfcfd;font-size:10px">
<div style="font-weight:700;font-size:11px;color:#495057;margin-bottom:7px;border-bottom:1px solid #e9ecef;padding-bottom:4px">범례</div>
<div style="border-left:3px solid #1a4d8f;padding-left:6px;margin-bottom:6px"><b style="color:#1a4d8f">main</b><br><span style="color:#868e96">프로젝트 하나 = 굵은 줄 하나</span></div>
<div style="border-left:3px solid #1a7f37;padding-left:6px;margin-bottom:6px"><b style="color:#1a7f37">branch</b><br><span style="color:#868e96">파트 하나 = 레인 하나</span></div>
<div style="border-left:3px solid #7c3aed;padding-left:6px;margin-bottom:6px"><b style="color:#7c3aed">지시 (fork)</b><br><span style="color:#868e96">감독 지시가 파트로 갈라짐</span></div>
<div style="border-left:3px solid #1a7f37;padding-left:6px;margin-bottom:6px"><b style="color:#1a7f37">push</b><br><span style="color:#868e96">조각 완료 보고 하나</span></div>
<div style="border-left:3px solid #cf7700;padding-left:6px;margin-bottom:6px"><b style="color:#cf7700">merge</b><br><span style="color:#868e96">모든 조각 보고 = 지시 완료</span></div>
<div style="border-top:1px dashed #e9ecef;padding-top:7px;color:#495057">속 빈 점 = 진행 중</div>
</div>
</div>


<p class="cap">그림 — Sample-App 프로젝트의 History 예시. 아래가 과거, 위가 최신(git log --graph 와 같은 방향).</p>

</div>
</div>

<div class="it">
<input type="checkbox" id="i1-2a" class="ca" style="display:none">
<input type="checkbox" id="i1-2b" class="cb" style="display:none">
<label for="i1-2a" class="ih la"><span class="n">1.2</span><b>git 과 AgentO 의 대응</b> <span class="sub">main · branch · push · merge 를 무엇으로 정하나</span></label>
<label for="i1-2b" class="ih lb"><span class="n">1.2</span><b>git 과 AgentO 의 대응</b> <span class="sub">main · branch · push · merge 를 무엇으로 정하나</span></label>
<div class="ib">

| git | AgentO | 데이터 출처 |
|---|---|---|
| 저장소 · **main** | 프로젝트 (top-level) | `projects` (parentId 없음) |
| **branch** | 파트 (part) | `projects.parentId` = 프로젝트, 파트 없는 세션은 main 레인 |
| **fork** (브랜치 시작점) | 감독 지시가 파트 세션으로 내려간 지점 | Logs 스레드의 directive (`buildThreads`) |
| **push** (commit) | 일 한 조각의 **완료 보고** | report (`pieceResult` = finished, `report_up`) |
| **merge** | 그 지시의 모든 조각이 보고됨 = 지시 완료 | `orderProgress` done = total, 또는 Done 표시 |
| commit hash | 보고에 적힌 커밋 해시 (`ef9f918`) | 보고 본문에서 추출 |
| 진행 중 브랜치 | 아직 보고가 없는 조각 | 지시는 있고 보고는 없음 (속 빈 점) |

</div>
</div>

<div class="it">
<input type="checkbox" id="i1-3a" class="ca" style="display:none">
<input type="checkbox" id="i1-3b" class="cb" style="display:none">
<label for="i1-3a" class="ih la"><span class="n">1.3</span><b>목적과 범위</b> <span class="sub">Ground · Split · Tabs 다음 4번째 보기</span></label>
<label for="i1-3b" class="ih lb"><span class="n">1.3</span><b>목적과 범위</b> <span class="sub">Ground · Split · Tabs 다음 4번째 보기</span></label>
<div class="ib">

- **목적**: 프로젝트마다 「무슨 기능이 언제, 어느 파트에서 끝났나」를 한 화면에서 본다. 점 하나 = 기능 하나.
- **보기 모드**: 툴바의 `Ground · Split · Tabs` 옆에 **Timeline** (`Ctrl+4`). 내부 id `timeline`.
- **토큰 0**: 이미 기록된 지시·보고(inbox)만 읽는다. 세션에 묻거나 요약을 만들지 않는다.
- **범위 밖**: 실제 git 저장소의 커밋 그래프를 그대로 보여 주는 것(2단계에서 보조로만 붙인다, 4.2).

</div>
</div>

---

<a id="cat-2"></a>

# <span class="num">2</span> 데이터 — 점과 선을 무엇으로 만드나 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 새 데이터는 만들지 않는다. Logs 탭이 쓰는 스레드(감독 지시 → 하위 지시 → 보고)를 레인 위의 점과 선으로 바꾼다.

<div class="it">
<input type="checkbox" id="i2-1a" class="ca" style="display:none">
<input type="checkbox" id="i2-1b" class="cb" style="display:none">
<label for="i2-1a" class="ih la"><span class="n">2.1</span><b>노드 종류</b> <span class="sub">지시 · 조각 · 완료 · 진행 중</span></label>
<label for="i2-1b" class="ih lb"><span class="n">2.1</span><b>노드 종류</b> <span class="sub">지시 · 조각 · 완료 · 진행 중</span></label>
<div class="ib">

<div class="lay">
<div class="cd" style="border-top-color:#7c3aed"><b>Order (fork)</b><span class="k">main 레인</span><span class="s">감독의 지시(Manager 탭·루틴). Direct(세션 직접 입력)는 제외 — 대화일 뿐 일의 단위가 아니다</span></div>
<div class="ar">→</div>
<div class="cd" style="border-top-color:#1a7f37"><b>Piece (push)</b><span class="k">파트 레인</span><span class="s">선수·코치가 일을 끝내고 올린 보고 하나. 제목 = 보고 첫 줄, 해시가 있으면 태그</span></div>
<div class="ar">→</div>
<div class="cd" style="border-top-color:#cf7700"><b>Merge</b><span class="k">main 레인</span><span class="s">그 지시의 조각이 전부 보고됨(또는 Done). 조각 수·끝난 시각</span></div>
<div class="cd" style="border-top-color:#adb5bd"><b>Open</b><span class="k">파트 레인 · 속 빈 점</span><span class="s">지시는 갔고 보고는 아직 — 지금 진행 중인 일</span></div>
</div>

</div>
</div>

<div class="it">
<input type="checkbox" id="i2-2a" class="ca" style="display:none">
<input type="checkbox" id="i2-2b" class="cb" style="display:none">
<label for="i2-2a" class="ih la"><span class="n">2.2</span><b>무엇을 「주요 기능」으로 보나</b> <span class="sub">잡음은 빼고 결과만</span></label>
<label for="i2-2b" class="ih lb"><span class="n">2.2</span><b>무엇을 「주요 기능」으로 보나</b> <span class="sub">잡음은 빼고 결과만</span></label>
<div class="ib">

| 넣는다 | 뺀다 | 이유 |
|---|---|---|
| 감독 지시 (Order) | Direct 입력, 상태 확인(Ask for status), 자동 Fresh start | 일의 단위가 아니라 대화·관리 |
| 선수의 `finished` 보고, `report_up` | 코치의 `replied`(일을 넘겼다는 답) | 넘긴 것은 결과가 아니다 — 결과는 선수의 보고로 찍힌다 |
| 결과 없이 멈춘 조각(`stopped`, error) | 같은 보고의 반복(같은 본문) | 멈춘 것은 빨간 점으로 남겨야 보인다 |

- 툴바 필터: **All / Pieces only / With commits** (해시가 있는 점만 — 「push 한 것만」).
- 같은 세션이 같은 지시 아래서 여러 번 보고하면 점을 여러 개 찍는다 (git 의 연속 commit).

</div>
</div>

<div class="it">
<input type="checkbox" id="i2-3a" class="ca" style="display:none">
<input type="checkbox" id="i2-3b" class="cb" style="display:none">
<label for="i2-3a" class="ih la"><span class="n">2.3</span><b>레인 배정</b> <span class="sub">파트 = 레인, 파트 없는 세션 = main</span></label>
<label for="i2-3b" class="ih lb"><span class="n">2.3</span><b>레인 배정</b> <span class="sub">파트 = 레인, 파트 없는 세션 = main</span></label>
<div class="ib">

- 레인 순서 = 사이드바 트리의 파트 순서. 수석코치(Coach)·팀 Head Coach 의 보고는 main 레인에 찍는다.
- 세션이 나중에 다른 파트로 옮겨져도 **그 보고가 올라온 때의 파트**에 남는 게 맞지만, 지금 기록에는 당시 파트가 없다 → 1단계는 현재 파트 기준, 기록에 `projectId` 를 남기는 것은 후속 과제(5.2).
- 닫힌 프로젝트·삭제된 세션: 레인은 남기고 점은 회색(이력이므로).

</div>
</div>

<div class="it">
<input type="checkbox" id="i2-4a" class="ca" style="display:none">
<input type="checkbox" id="i2-4b" class="cb" style="display:none">
<label for="i2-4a" class="ih la"><span class="n">2.4</span><b>커밋 해시 추출</b> <span class="sub">보고 본문에서</span></label>
<label for="i2-4b" class="ih lb"><span class="n">2.4</span><b>커밋 해시 추출</b> <span class="sub">보고 본문에서</span></label>
<div class="ib">

- 보고 본문의 `커밋 ef9f918`, `` `0cc6338b7` ``, `commit abc1234` 처럼 **커밋 맥락**에 붙은 7~12자리 16진수만 뽑는다(일반 숫자·색상코드 제외).
- 점의 태그로 보이고, 누르면 복사. 2단계에서 저장소를 알면 `git show` 요약(파일 수·+/-)을 붙인다.

</div>
</div>

---

<a id="cat-3"></a>

# <span class="num">3</span> 화면 — 그래프, 상세, 조작 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 왼쪽은 레인 그래프, 점을 누르면 오른쪽 패널에 그 기능의 상세가 열린다.

<div class="it">
<input type="checkbox" id="i3-1a" class="ca" style="display:none">
<input type="checkbox" id="i3-1b" class="cb" style="display:none">
<label for="i3-1a" class="ih la"><span class="n">3.1</span><b>레이아웃</b> <span class="sub">프로젝트별 그래프 · 세로 시간축</span></label>
<label for="i3-1b" class="ih lb"><span class="n">3.1</span><b>레이아웃</b> <span class="sub">프로젝트별 그래프 · 세로 시간축</span></label>
<div class="ib">

- **상단 바**: 프로젝트 칩(Manager·Inbox·Logs 와 같은 공유 필터, 여러 개면 프로젝트별 그래프를 위아래로), 기간(7일 · 30일 · 전체), 검색, 필터(2.2).
- **그래프**: 한 행 = 점 하나(시간순, 최신 위). 왼쪽부터 main 레인, 파트 레인들. 행 오른쪽에 제목(보고 첫 줄) · 세션 · 시각 · 해시 태그.
- **선**: fork = main 의 지시 점에서 파트 레인으로 내려가는 곡선, merge = 마지막 조각에서 main 으로 돌아오는 곡선. 진행 중 조각은 점선.
- 색: main = 프로젝트 색, 파트 레인 = 프로젝트 색의 옅은 단계(같은 프로젝트임을 유지), 지시 = Manager 색, merge = 완료 색.

</div>
</div>

<div class="it">
<input type="checkbox" id="i3-2a" class="ca" style="display:none">
<input type="checkbox" id="i3-2b" class="cb" style="display:none">
<label for="i3-2a" class="ih la"><span class="n">3.2</span><b>점을 누르면</b> <span class="sub">오른쪽 패널 「History」 상세</span></label>
<label for="i3-2b" class="ih lb"><span class="n">3.2</span><b>점을 누르면</b> <span class="sub">오른쪽 패널 「History」 상세</span></label>
<div class="ib">

| 점 | 상세에 보이는 것 | 버튼 |
|---|---|---|
| Order | 지시 전문, 진행률(조각 n/m), 받은 세션들 | Flow (기존 흐름도), Logs 에서 보기 |
| Piece | 보고 전문(서식), 해시·파일 링크(클릭해 열기), 보고한 세션 · 파트 · 시각 | 세션 열기, 같은 레인 이전·다음 |
| Merge | 조각 목록(각 조각 제목 · 세션), 걸린 시간 | — |
| Open | 받은 지시, 지금 하는 일(실행 중 도구 → 마지막 문장) | 세션 열기, Ask for status |

</div>
</div>

<div class="it">
<input type="checkbox" id="i3-3a" class="ca" style="display:none">
<input type="checkbox" id="i3-3b" class="cb" style="display:none">
<label for="i3-3a" class="ih la"><span class="n">3.3</span><b>조작</b> <span class="sub">키보드 · 접기</span></label>
<label for="i3-3b" class="ih lb"><span class="n">3.3</span><b>조작</b> <span class="sub">키보드 · 접기</span></label>
<div class="ib">

- ↑ ↓ 로 점 이동, Enter = 상세, `C` = 해시 복사.
- 지시 점을 접으면 그 지시의 조각들이 한 줄로 묶인다(긴 프로젝트에서 「주요 기능만」 보기).
- 그래프는 보이는 행만 그린다(수천 개 보고도 가볍게).

</div>
</div>

---

<a id="cat-4"></a>

# <span class="num">4</span> 구현 계획 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 1단계는 렌더러만으로 끝난다(데몬 재시작 없음). 실제 git 정보는 2단계에서 보조로 붙인다.

<div class="it">
<input type="checkbox" id="i4-1a" class="ca" style="display:none">
<input type="checkbox" id="i4-1b" class="cb" style="display:none">
<label for="i4-1a" class="ih la"><span class="n">4.1</span><b>1단계 — 기록 기반 그래프</b> <span class="sub">렌더러만 · 토큰 0</span></label>
<label for="i4-1b" class="ih lb"><span class="n">4.1</span><b>1단계 — 기록 기반 그래프</b> <span class="sub">렌더러만 · 토큰 0</span></label>
<div class="ib">

| 파일 | 내용 |
|---|---|
| `store.ts` | `ViewMode` 에 `'history'`, 툴바·메뉴·`Ctrl+4` |
| `lib/history.ts` (새) | 스레드 → 레인·행 계산(`buildHistory`), 해시 추출, 필터 — 순수 함수, 상태당 한 번 계산(`lib/closed.ts` 캐시 방식) |
| `components/HistoryView.tsx` (새) | 상단 바 + SVG 레인 + 행 목록(가상 스크롤) |
| `components/RightPanel.tsx` | 선택한 점의 상세(3.2) — 기존 `OrderCard`·`inboxHtml`·`OrderProgress` 재사용 |

</div>
</div>

<div class="it">
<input type="checkbox" id="i4-2a" class="ca" style="display:none">
<input type="checkbox" id="i4-2b" class="cb" style="display:none">
<label for="i4-2a" class="ih la"><span class="n">4.2</span><b>2단계 — 실제 git 붙이기</b> <span class="sub">데몬 `git.log` · 선택</span></label>
<label for="i4-2b" class="ih lb"><span class="n">4.2</span><b>2단계 — 실제 git 붙이기</b> <span class="sub">데몬 `git.log` · 선택</span></label>
<div class="ib">

- 데몬에 `git.show {repo, hash}` (파일 수·+/-·메시지) — 해시 태그를 누르면 요약.
- 파트 폴더가 git 저장소면 `git log --since` 로 보고에 없는 커밋도 회색 점으로 보이게 하는 옵션.
- 저장소 판단은 파트·프로젝트 폴더의 `.git` 유무.

</div>
</div>

<div class="it">
<input type="checkbox" id="i4-3a" class="ca" style="display:none">
<input type="checkbox" id="i4-3b" class="cb" style="display:none">
<label for="i4-3a" class="ih la"><span class="n">4.3</span><b>성능</b> <span class="sub"></span></label>
<label for="i4-3b" class="ih lb"><span class="n">4.3</span><b>성능</b> <span class="sub"></span></label>
<div class="ib">

- `buildHistory` 는 inbox·sessions·projects 가 바뀔 때만, 프로젝트별로 다시 계산. 상태 바뀔 때마다 그래프 전체를 다시 그리지 않도록 행 컴포넌트는 `memo`.
- SVG 는 보이는 범위의 행만 그린다(행 높이 고정 → 위치 계산이 단순).

</div>
</div>

---

<a id="cat-5"></a>

# <span class="num">5</span> 정할 것과 후속 과제 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 아래 세 가지는 만들기 전에 정해야 한다.

<div class="it">
<input type="checkbox" id="i5-1a" class="ca" style="display:none">
<input type="checkbox" id="i5-1b" class="cb" style="display:none">
<label for="i5-1a" class="ih la"><span class="n">5.1</span><b>결정 필요</b> <span class="sub">사용자 선택</span></label>
<label for="i5-1b" class="ih lb"><span class="n">5.1</span><b>결정 필요</b> <span class="sub">사용자 선택</span></label>
<div class="ib">

| 질문 | 결정 (2026-10-21) | 버린 안 |
|---|---|---|
| 점의 단위 | **기능 완료** — 한 조각(지시)에 보고·커밋이 여러 번이어도 최종 완료 보고 하나가 점 하나 | 보고(push) 하나마다 점 · 실제 git 커밋만 |
| 이름 | **Timeline** | History · Graph |
| 위치 | 가운데 화면(기능 이름에 폭이 필요)이되, 툴바에서 세션 배치(Ground·Split·Tabs)와 **구분선으로 나눈 별도 버튼** — 성질이 다름(세션 보기가 아니라 Logs 같은 기록 보기). Timeline 에서는 Auto Arrange·Fit All·Focus 숨김 (2026-10-23) | 오른쪽 패널 탭(폭 부족) · 세션 보기와 한 묶음 |
| 모양 | git 그래프를 엄격히 따르지 않음 — 날짜 줄 + 파트 레인 + 점, 읽기 쉬운 타임라인이 우선 | git log --graph 그대로 |
| 직접 입력(Direct) | 일을 시킨 직접 입력은 포함, 짧은 질문(물음표로 끝나는 80자 미만)은 제외 | Direct 전부 제외 |
| 조각이 하나뿐인 지시 | 기능 점 한 줄(제목 = 감독이 쓴 말, 한 단어 답이면 보고 첫 줄) | 지시·기능·완료 세 줄 |

</div>
</div>

<div class="it">
<input type="checkbox" id="i5-2a" class="ca" style="display:none">
<input type="checkbox" id="i5-2b" class="cb" style="display:none">
<label for="i5-2a" class="ih la"><span class="n">5.2</span><b>후속 과제</b> <span class="sub"></span></label>
<label for="i5-2b" class="ih lb"><span class="n">5.2</span><b>후속 과제</b> <span class="sub"></span></label>
<div class="ib">

- 보고 기록(inbox)에 당시 `projectId` 를 남겨, 세션이 파트를 옮겨도 점이 원래 레인에 남게 한다(데몬).
- 보고 제목을 더 짧게 — 지금은 첫 줄. 선수 지침에 「보고 첫 줄은 기능 이름 한 줄」을 넣으면 그래프가 깔끔해진다(토큰 0).
- 마일스톤(태그): 감독이 점에 이름을 붙이는 기능(`v0.3 시연판`).

</div>
</div>

---
