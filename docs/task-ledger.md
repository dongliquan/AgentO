# 일 장부(Task Ledger) 설계 — 일의 상태를 데몬이 직접 기록한다

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

**대상 버전**: AgentO 1.0.0 (2026-11-17)
**관련 코드**: `src/daemon/ledger.ts` · `src/daemon/team.ts`(훅) · `src/shared/protocol.ts`(`TaskRec`) · `src/renderer/src/components/ProjectNow.tsx`
**읽는 사람**: AgentO 를 이어서 개발하는 사람, 그리고 감독(사용자)

<a id="toc"></a>

## 목차 <span class="hctl"><label for="xo" style="color:#0969da;cursor:pointer;text-decoration:underline">▼ 전체 펼치기</label> · <label for="xc" style="color:#0969da;cursor:pointer;text-decoration:underline">▶ 전체 접기</label></span>

- [**1. 왜 장부가 필요한가**](#cat-1)
- [**2. 상태와 전이**](#cat-2)
- [**3. 데이터와 코드 위치**](#cat-3)
- [**4. 화면에서 쓰는 방법**](#cat-4)
- [**5. 이번 범위와 후속 과제**](#cat-5)

---

<a id="cat-1"></a>

# <span class="num">1</span> 왜 장부가 필요한가 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 감독이 "지금 어디까지 왔나, 끝났나, 내가 답할 게 있나"를 한 곳에서 믿고 볼 수 있어야 한다. 지금은 세션 대화의 말투를 읽어 그 상태를 추측한다.

## 1.1 추측으로 상태를 만들 때 생긴 문제

일(#T)의 상태가 데몬 안에는 `pending`(누가 누구의 결과를 기다리나)과 인박스 글로만 있고, 화면은 보고서 문장에서 정규식과 단어 겹침으로 "끝났나·질문 중인가"를 판정한다.

| 사례 | 원인 |
|---|---|
| Codex 가 요청을 되풀이만 했는데 완료로 처리됨 | 완료를 "턴이 끝남"으로만 판정 |
| 질문 문장 속 `#T399` 때문에 출처가 엉뚱한 세션으로 표시됨 | 출처를 단어 겹침으로 찾음 |
| 끝난 일이 Needs you 에 다시 올라옴 | 질문 여부를 문장 끝 모양으로 판정 |
| 같은 일이 HC · Coach · 선수 대화에 따로 존재 | 층마다 자기 대화로 기억하고 번호와 문장으로만 연결 |

## 1.2 목표

- 일의 상태는 **데몬이 본 사건**(보냄 · 시작함 · 끝남 · 막힘 · 질문함)으로만 바뀐다.
- 화면(Now 판, 이후 Needs you)은 장부를 읽기만 한다. 문장을 해석하지 않는다.
- 일 사이의 부모·자식(Coach 가 선수에게 넘긴 일)이 데이터로 남는다.

---

<a id="cat-2"></a>

# <span class="num">2</span> 상태와 전이 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 한 일(#T)은 여섯 상태 중 하나다. 전이는 데몬이 보는 사건에서만 일어난다.

## 2.1 상태 정의

<table>
<thead><tr><th>상태</th><th>뜻</th><th>누가 바꾸나</th></tr></thead>
<tbody>
<tr style="background:#f8f9fa"><td><b>queued</b></td><td>보냈지만 세션에 아직 입력되지 않음 (바쁨·정지·깨우는 중)</td><td>일을 만들 때(<code>openTask</code>)</td></tr>
<tr style="background:#ffffff"><td><b>working</b></td><td>세션이 그 일을 시작함</td><td>전달 시 세션이 이미 일하는 중이거나, 상태 이벤트가 working 이 될 때</td></tr>
<tr style="background:#f8f9fa"><td><b>handed</b></td><td>조율 역할(Coach·HC)이 일을 넘기고 턴을 끝냄 — 결과는 하위 일과 함께 옴</td><td><code>complete()</code> 가 turn 종료 + 위임 표시를 볼 때</td></tr>
<tr style="background:#ffffff"><td><b>reported</b></td><td>세션이 끝냈고 마지막 답이 보낸 쪽에 전달됨</td><td><code>complete()</code></td></tr>
<tr style="background:#f8f9fa"><td><b>asking</b></td><td>세션이 보낸 쪽에 질문했고 답을 기다림</td><td><code>report_up</code> 의 <code>needs_answer=true</code> (명시 신호)</td></tr>
<tr style="background:#ffffff"><td><b>blocked</b></td><td>프롬프트에 막힘, 사용량 한도, 세션이 메시지를 받지 않음, 세션이 멈춤</td><td><code>complete()</code> 의 막힘 분기</td></tr>
</tbody>
</table>

## 2.2 전이 흐름

<div class="lay">
<div class="cd" style="border-top-color:#6c757d"><b>queued</b><span class="s">보냄 · 대기열</span></div>
<span class="ar">→</span>
<div class="cd" style="border-top-color:#2f80ed"><b>working</b><span class="s">시작함</span></div>
<span class="ar">→</span>
<div class="cd" style="border-top-color:#2e7d32"><b>reported</b><span class="s">끝남 · 보고 전달</span></div>
</div>

<div class="lay">
<div class="cd" style="border-top-color:#2f80ed"><b>working</b><span class="s">일하는 중</span></div>
<span class="ar">→</span>
<div class="cd" style="border-top-color:#7e57c2"><b>handed</b><span class="s">넘기고 턴 종료</span></div>
<span class="ar">·</span>
<div class="cd" style="border-top-color:#f2994a"><b>asking</b><span class="s">질문하고 답 대기 — 턴이 끝나도 유지, 새 지시가 오면 answered</span></div>
<span class="ar">·</span>
<div class="cd" style="border-top-color:#d32f2f"><b>blocked</b><span class="s">막힘 — 풀리면 working 으로 돌아옴</span></div>
</div>

<div class="cap">위: 보통의 길. 아래: working 에서 갈라지는 상태들. reported 가 된 일은 늦게 도착한 queued 로 되돌아가지 않는다.</div>

---

<a id="cat-3"></a>

# <span class="num">3</span> 데이터와 코드 위치 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 한 일 = `TaskRec` 한 줄. 데몬 kv 에 저장되어 재시작 뒤에도 남고, 변경분만 `ledger.delta` 로 화면에 간다.

## 3.1 `TaskRec` 필드

| 필드 | 내용 |
|---|---|
| `key` · `id` | `<프로젝트 또는 team>/#T12` · `#T12` (프로젝트마다 연번) |
| `projectId` | 번호가 속한 최상위 프로젝트 ('' = 팀 Head Coach) |
| `from` · `to` | 보낸 이(세션 id 또는 `user`) · 일을 받은 세션 |
| `summary` | 시킨 말의 첫 줄(머리말 제거, 140자) |
| `parent` | 보낸 세션이 그때 하던 일의 `key` — 일의 부모·자식 |
| `state` · `stateAt` · `note` | 상태 · 바뀐 시각 · 막힘·질문 사유 |

## 3.2 데몬에서 일이 생기고 바뀌는 지점

| 사건 | 위치(`team.ts`) | 장부 변화 |
|---|---|---|
| 감독 지시 | `order()` | 수신자마다 `openTask` |
| 감독 직접 입력 | `note()` | `openTask`, 묻던 일은 answered |
| 세션 → 세션 지시 | `send()` (directive) | `openTask`(parent = 보낸 세션의 현재 일) |
| 선수 만들며 첫 지시 | `create_session` | `openTask` |
| 전달(타이핑) | `trackDirective()` | 이미 일하는 중이면 working |
| 일을 시작함 | `onStatus()` | working |
| 턴 종료 | `complete()` | reported / handed / blocked |
| 질문 | `report_up` + `needs_answer` | asking |
| 프로젝트 삭제 | `forgetProject()` | 해당 프로젝트 일 삭제 |

장부는 3000건·완료 후 14일까지 보관한다.

---

<a id="cat-4"></a>

# <span class="num">4</span> 화면에서 쓰는 방법 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 화면은 장부를 읽기만 한다. 문장 해석은 하지 않는다.

## 4.1 Timeline 의 Now 판

- 프로젝트 머리말 아래 **Tasks** 목록: 열려 있는(reported 가 아닌) 일을 asking → blocked → working → queued → handed 순으로, 받은 세션·상태·보낸 이·첫 줄·경과 시간과 함께 보여준다. 줄을 누르면 Ground 의 그 세션으로 간다.
- 세션 행의 「Waiting for you」는 문장 판정에 더해 장부의 `asking` 도 센다.
- 7일 넘게 바뀌지 않은 일은 목록에서 뺀다.

## 4.2 선수·코치 지침

`report_up` 에 `needs_answer`(boolean)가 생겼다. 답이 없으면 계속할 수 없는 질문일 때만 true 로 보내게 한다. 도구 설명으로 전달되므로 지침 파일을 따로 바꾸지 않는다.

---

<a id="cat-5"></a>

# <span class="num">5</span> 이번 범위와 후속 과제 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 1단계는 기록과 Now 판 표시까지다. 기존 추측 로직(Needs you · Inbox · Logs)은 아직 그대로 두었다.

## 5.1 후속 과제

| 과제 | 내용 |
|---|---|
| Needs you 를 장부로 | `asking`·`blocked` 를 알림의 근거로 쓰고 문장 판정(`askingTail`)은 보조로 내린다 |
| 완료의 신뢰성 | Codex 응답이 요청 되풀이일 때 reported 로 세지 않기, 막힌 일 재전송 버튼 |
| 상위 일의 완료 | handed 일을 하위 일이 모두 reported 가 되면 자동으로 reported 로 |
| 화면 통합 | Inbox · Logs · Timeline · Today 가 같은 사건을 따로 보여주는 것을 장부 기준으로 정리 |
| 옛 기록 | 장부는 이번 데몬부터 쌓인다. 이전 일은 비어 있다 |
