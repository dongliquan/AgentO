# AgentO 2.0 통합 설계서

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

**버전**: 통합 초안 0.1 (2026-11-18)  
**기준 자료**: 상세 재설계서(2026-11-17) · 아키텍처 명세(2026-11-17) · 1.0 제품 설계 리뷰 · 비슷한 앱 조사 · Claude Code 훅/세션 간 메시지 확인 · Codex 검토 2회  
**상태**: 결정 대기 항목이 있는 초안. 감독이 새 설계서를 올리면 그 내용으로 고친다.

<div class="warn">이 문서는 "정해진 것"과 "제안", "미결"을 표시로 가른다. 표에서 <b>확정</b>은 이미 구현·결정된 것, <b>제안</b>은 이 문서의 권고, <b>미결</b>은 감독의 결정이 필요한 것이다.</div>

<a id="toc"></a>

## 목차

- [**1. 제품 정의와 원칙**](#cat-1)
- [**2. 결정 현황**](#cat-2) — 확정 · 제안 · 미결
- [**3. 세션 상태 모델**](#cat-3)
- [**4. 생존과 복구**](#cat-4)
- [**5. 세션 간 협업**](#cat-5)
- [**6. 프로젝트 메모리와 이어하기**](#cat-6)
- [**7. 화면 구성**](#cat-7)
- [**8. 자동화 (Autopilot)**](#cat-8)
- [**9. 구조 · 데이터 · 배포**](#cat-9)
- [**10. 단계별 로드맵**](#cat-10)
- [**11. 검증**](#cat-11)
- [**12. 위험과 범위 밖**](#cat-12)
- [📎 **부록**](#appendix) — A.1 조사 근거 · A.2 문서 간 어긋남 · A.3 1.1에서 이어받는 자산 · A.4 사용자 상세 재설계서 대조 · A.5 Codex 최종 검토

---

<a id="cat-1"></a>

# <span class="num">1</span> 제품 정의와 원칙 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> AgentO는 여러 AI CLI 세션을 한 화면에서 관리하고, 앱을 닫거나 교체해도 세션을 살려 두며, 세션끼리 가볍게 일을 주고받게 하는 데스크톱 앱이다.

### <span class="n3">1.1</span> 제품 한 문장과 세 가지 가치

> **AgentO keeps your AI work alive, recoverable, and connected.**

| 가치 | 사용자가 얻는 것 | 판단 기준 |
|---|---|---|
| Manage | 여러 세션을 한곳에서 만들고 본다 | 세션을 찾는 데 걸리는 시간 |
| Persist | 앱·UI·데몬이 바뀌어도 세션이 살아 있고 돌아온다 | 재연결 성공률, 수동 재생성 횟수 |
| Connect | 세션끼리 일을 주고받고 결과를 돌려받는다 | 전달 성공률, 혼선 없음 |

우선순위는 Persist → Manage → Connect 순이며, 이 순서를 바꾸지 않는다.

### <span class="n3">1.2</span> 설계 원칙

1. 모든 세션은 대등하다. Head Coach·Coach·Part 같은 **필수 권한 계층은 두지 않는다**(1.1에서 제거했고, 2.0 main에서도 커밋 d6401b7로 제거했다). 큰 작업에서 한 세션이 다른 세션들에게 일을 나누는 **선택적 조정 역할은 허용**한다. 이것은 사용자가 정하는 쓰임새일 뿐, 별도 권한·도구·화면 계층이 아니다(D12).
2. 기능을 더하기 전에 화면과 개념의 중복을 줄인다. 같은 일을 하는 화면은 합치거나 지운다.
3. 세션 상태는 추측하지 않고 근거(프로세스, 제공자 이벤트, 대화 기록)로 표시한다. 근거가 없으면 "알 수 없음"으로 둔다.
4. 상태의 단일 진실은 데몬이다. 화면은 표시와 입력만 맡는다.
5. 구독 로그인 방식의 CLI만 쓴다. API 키 방식은 쓰지 않는다.
6. 자동화는 상태가 정확해진 뒤에 얹는다.

### <span class="n3">1.3</span> 범위 밖

- 자체 IDE나 코드 편집기
- 다단계 에이전트 조직도, 위계 보고
- 모든 세션을 하나로 합친 전역 채팅, 칸반 같은 프로젝트 관리
- 안전장치 없는 완전 자율 파일 수정
- 제공자 차이를 억지로 같은 화면·같은 복구 모델로 맞추는 일

---

<a id="cat-2"></a>

# <span class="num">2</span> 결정 현황 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 세 설계 문서가 서로 다르게 적은 부분과 이번 조사로 새로 생긴 선택지를 한 표로 모았다. 미결은 감독이 정하면 이 문서가 확정으로 바뀐다.

### <span class="n3">2.1</span> 확정

| 항목 | 내용 | 근거 |
|---|---|---|
| 팀 위계 제거 | 팀 없는 1.1.0을 따로 냈고 2.0도 위계 없이 간다. **※ 11-18 상세 재설계서는 Head Coach/Coach 규칙 유지를 제안 → D12에서 다시 정한다** | 사용자 결정(2026-11-17) |
| 3계층 프로세스 | 화면 · 데몬 · 세션별 홀더. 홀더가 CLI를 소유하고 데몬이 재시작돼도 재부착한다 | 구현·스모크 검증 |
| 단일 실행 데몬 | 이름 있는 파이프 잠금으로 중복 실행 방지 | 구현 |
| 세션 무중단 배포 | 새 폴더에 빌드, 데몬과 화면만 교체, 홀더 유지 | `scripts/deploy-keep-sessions.sh` |
| 구독 로그인 전용 | API 키 방식 없음 | 제품 원칙 |
| 이어하기 기반 | Pick up where you left off, 깨울 때 경과 시간 안내, 큰 대화 보호 | 1.1 구현 |

### <span class="n3">2.2</span> 미결 — 감독의 결정이 필요한 것

<table>
<thead><tr><th>번호</th><th>질문</th><th>선택지</th><th>제안</th></tr></thead>
<tbody>
<tr style="background:#f8f9fa"><td><b>D1</b></td><td>2.0은 어느 코드에서 시작하나</td><td>release/1.1(팀 코드 제거됨) · main(팀 코드 포함 2.0.0)</td><td><b>release/1.1</b>에서 시작하고 main에만 있는 문서·시험·스크립트를 옮긴다. 팀 코드를 다시 걷어내는 일을 피한다</td></tr>
<tr style="background:#ffffff"><td><b>D2</b></td><td>Project / Part / Folder 구조</td><td>폴더 1개 = 작업공간(평면) · 프로젝트에 폴더 여러 개 · 지금처럼 파트까지</td><td><b>프로젝트(폴더 여러 개) 유지, 파트 삭제.</b> 한 프로젝트에 폴더 여러 개는 AgentO의 처음 목적이다</td></tr>
<tr style="background:#f8f9fa"><td><b>D3</b></td><td>프로젝트 메모리의 원본 위치</td><td>데이터 폴더(지금) · 저장소 안 <code>.agento/</code></td><td><b>저장소 안 파일을 원본</b>으로 하고, 개인·비밀·로컬 전용은 데이터 폴더에 둔다. 폴더가 여러 개면 주 폴더 하나를 정해야 한다(6.2)</td></tr>
<tr style="background:#ffffff"><td><b>D4</b></td><td>오른쪽 패널 탭</td><td>Files · Inbox · Inspector 3탭 · 1.1의 Session · Files · Inbox · Web</td><td><b>1.1의 4탭(Session · Files · Inbox · Web)을 유지.</b> Inspector는 별도 탭이 아니라 Session 안의 접힌 상세로 둔다. Web은 사용 기록을 보고 정한다</td></tr>
<tr style="background:#f8f9fa"><td><b>D5</b></td><td>협업의 주인</td><td>AgentO 전달 경로 · Claude Code 공식 세션 간 메시지 · 둘 다</td><td><b>AgentO가 본문·전달 상태·재시도의 주인.</b> 공식 메시지는 사용자가 Claude 세션끼리 직접 쓰는 부가 기능으로 두고 AgentO 장부에는 합치지 않는다(5.3)</td></tr>
<tr style="background:#ffffff"><td><b>D6</b></td><td>상태 모델</td><td>한 문자열 · 생명주기와 주의를 나눈 두 축</td><td><b>두 축 + 근거 필드.</b> 두 문서가 정의한 상태 수가 달라(9+3 vs 5) 3장의 표로 통일한다</td></tr>
<tr style="background:#f8f9fa"><td><b>D7</b></td><td>Autopilot의 위치</td><td>기본 기능 · 설정 안의 고급 기능 · 삭제</td><td><b>고급 기능, 기본 화면에서 숨김.</b> 안정화 뒤(로드맵 5단계) 2.0 범위를 정한다. 삭제는 하지 않는다</td></tr>
<tr style="background:#ffffff"><td><b>D8</b></td><td>제공자 범위</td><td>모든 제공자 동등 · 1급과 터미널 전용 구분</td><td><b>Claude Code와 Codex는 1급</b>(대화 보기·상태·이어하기), Gemini·Ollama·셸은 터미널 전용. Gemini 개인 요금제 CLI는 지원이 끝났다</td></tr>
<tr style="background:#f8f9fa"><td><b>D9</b></td><td>홀더를 고정 런타임으로 옮길까</td><td>지금처럼 빌드 폴더의 실행 파일 · <code>%APPDATA%</code>의 고정 런타임</td><td><b>먼저 가능한지 확인.</b> 네이티브 모듈(node-pty, better-sqlite3)이 Electron 버전에 묶여 있어 고정 런타임이 쉽지 않다(4.4)</td></tr>
<tr style="background:#ffffff"><td><b>D10</b></td><td>상태 판정에 훅을 쓸까</td><td>화면 판정만 · 훅 우선 + 화면 보조</td><td><b>훅 우선 + 화면 보조.</b> 시험 결과가 나오면 확정(3.3)</td></tr>
<tr style="background:#f8f9fa"><td><b>D11</b></td><td>화면 스타일</td><td>지금(Windows에 가까움) · Mac 스타일</td><td><b>확정: 2.0부터 Mac 스타일.</b> 1.x 화면은 바꾸지 않는다. 세부는 7.5</td></tr>
<tr style="background:#ffffff"><td><b>D12</b></td><td>Head Coach / Coach / Part Coach / Worker 역할과 규칙</td><td>제거(2.1 확정) · 공식 유지(상세 재설계서) · 역할 이름만 남김</td><td><b>감독이 다시 정한다.</b> 2.1의 확정(11-17)과 상세 재설계서(11-18)가 정반대다. 제안: 위계 규칙·권한 강제는 두지 않고, 큰 작업에서 부를 수 있는 「조정 역할」 표시만 남긴다(A.4)</td></tr>
<tr style="background:#f8f9fa"><td><b>D13</b></td><td>Task와 Session을 얼마나 나눌까</td><td>지금(<code>#T</code> 번호 + 4상태) · 정식 Task Ledger(10상태, 완료 기준·근거·승인)</td><td><b>단계적으로.</b> 먼저 <code>activeTaskId</code>, 완료 Task 보호(후속은 새 Task + <code>parentTaskId</code>), 늦은 응답을 원래 Task에 귀속. 완료 기준·승인·10상태는 쓰임을 본 뒤(A.4)</td></tr>
<tr style="background:#ffffff"><td><b>D14</b></td><td>Hibernate 기본값</td><td>자동(유휴 시) · 수동만 · 안전 조건을 만족할 때만 자동</td><td><b>초기 기본값 Manual Only(수동만)</b>, 측정 후 자동 Hibernate 허용(「유휴 때 자동」은 선택), 「항상 유지」 지정 가능. Wake 전에 점검하고 불확실하면 「Recovery Required」(A.4, 3.1·4.3과 맞춤)</td></tr>
<tr style="background:#f8f9fa"><td><b>D15</b></td><td>기본 작업 화면</td><td>Ground(지금) · Focused Workspace(세션 하나 + Active Task)</td><td><b>Focused를 기본, Ground는 고급 배치.</b> 하단에 Task Inbox(Needs You · Running · Blocked · 오늘 완료). 7장·D11과 함께 정한다</td></tr>
<tr style="background:#ffffff"><td><b>D16</b></td><td>「이어서 하기」 동작을 몇 가지로 나눠 보여 줄까</td><td>지금(세 가지: 재연결 · 대화 재개 · 새로 시작) · 네 가지(+ Task Switch / Context Refresh)</td><td><b>네 동작을 UI와 로그에서 구분</b>(Task Switch, Context Refresh, Fresh start, Wake). 4.1의 세 뜻에 두 가지를 더한다</td></tr>
</tbody>
</table>

---

<a id="cat-3"></a>

# <span class="num">3</span> 세션 상태 모델 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 상태는 "프로세스가 어떤가"와 "사용자가 해야 할 일이 있는가"를 나눠 적고, 둘 다 어떤 근거로 정했는지 함께 가진다.

### <span class="n3">3.1</span> 두 축

| 축 | 값 | 뜻 |
|---|---|---|
| 생명주기 | starting · running · hibernated · ended | 프로세스와 세션의 상태 |
| 일 진행(running 안) | working · idle · unknown | 지금 일하는지, 쉬는지, 알 수 없는지 |
| 종료 사유(ended 안) | closed(사용자가 끝냄) · failed(오류 종료) · interrupted(예상치 못한 중단) | 이어하기 안내가 달라진다 |
| 주의 | none · needs_you · limit | 사용자 응답이 필요한가, 사용량 한도로 쉬는가 |

- 주의는 생명주기를 덮어쓰지 않는다. 일하다가 권한을 묻는 세션은 running + working + needs_you다.
- Completed 같은 값은 따로 두지 않는다. "턴이 끝남"은 idle로 표현하고, 명시적 끝 이벤트가 있었는지는 근거로 남긴다.

### <span class="n3">3.2</span> 판정 규칙

1. 프로세스가 살아 있다는 이유만으로 working이라고 하지 않는다.
2. 출력이 오래 없다는 이유만으로 멈췄다고 하지 않는다.
3. 근거가 불충분하면 unknown으로 두고 화면에도 그렇게 보인다.
4. 사용자가 끝낸 세션은 interrupted가 아니라 closed로 기록한다.
5. 근거에는 출처(홀더 · 제공자 이벤트 · 대화 기록 · 화면 · 사용자), 관찰 시각, 이벤트 ID를 남긴다. 같은 이벤트가 두 번 와도 한 번만 반영한다.
6. 데몬이 재시작되면 현재 상태를 모든 근거에서 다시 계산한다(화면 재연결 때도 전체 상태를 다시 받는다).

### <span class="n3">3.3</span> 근거로 쓸 수 있는 것과 확인 상태

| 알고 싶은 것 | 근거 | 확인 |
|---|---|---|
| 프로세스 생존 | 홀더 · 자식 프로세스 | 확인 (구현됨) |
| 턴 끝남 | Claude Code `Stop` 훅 (마지막 답 본문 포함) | **TUI·headless 모두 실제 수신 확인.** 입력 뒤 약 1.5~3초 안에 도착 |
| 선택지 질문(AskUserQuestion) | `PreToolUse`(도구 이름 AskUserQuestion) + `PermissionRequest` 가 같은 순간에, 약 6초 뒤 `Notification`(permission_prompt) | **TUI에서 실제 수신 확인** |
| 일반 도구 권한 질문 | `PermissionRequest`, `Notification` | 문서만 확인. 시험 환경에서 쓰기·셸 명령이 자동 허용돼 질문이 뜨지 않아 **재현 못 함** |
| 유휴 | `Notification` (idle_prompt) | **TUI에서 확인.** 턴이 끝난(Stop) 약 60초 뒤 도착 |
| API 오류 종료 | `StopFailure` | 문서 확인 |
| 사용자가 Esc로 끊음 | `Stop`이 오지 않음 (질문 중 Esc 시험에서 이벤트 없음) | **TUI에서 확인** — 끊김은 화면·프로세스 근거로 따로 판정 |
| 폴더 신뢰 창, auto mode 안내창 | 훅 없음 | **TUI에서 확인** — 두 창이 떠 있는 동안 훅이 0건. 화면 판정 유지 |
| 사용 한도 대기 | 훅이 이 상태에 발생하는지 불명 | **미확인**(재현 못 함) — 화면 판정 유지 |
| 세션 시작 | `SessionStart` | 문서에 있으나 TUI·headless 모두 수신되지 않음 — 쓰지 않는다 |
| headless 상태 | stream-json 이벤트 | 확인 (구현됨) |
| Codex 상태 | rollout 파일 | 확인 (구현됨) |

- 훅은 `--settings '<JSON>'`으로 세션을 시작할 때만 넣는다. 사용자의 전역 설정 파일은 건드리지 않는다. HTTP 훅이면 데몬이 직접 받는다. 이 방식은 TUI와 headless 모두에서 동작을 확인했다(Claude Code 2.1.326).
- 폴더 신뢰 창의 기본 선택은 "No, exit"이다. 아래 화살표를 먼저 보내야 "Yes"가 되므로, 자동 수락 규칙은 키 순서까지 규칙 파일에 적는다(9.1).
- 화면 판정은 없애지 않는다. 훅이 없는 사건(선택지, 폴더 신뢰, 한도)과 훅 없는 제공자의 대체 경로로 남기고, 약한 근거로 표시한다.
- "훅 이벤트를 받음"과 "상태를 확정함"은 다른 일이다. Stop이 왔어도 이어서 큐에 쌓인 일이 시작될 수 있으므로 데몬은 다음 이벤트까지 보고 확정한다.

---

<a id="cat-4"></a>

# <span class="num">4</span> 생존과 복구 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> AgentO의 가장 큰 차별점이다. 비슷한 앱 대부분은 세션 유지를 tmux에 맡기거나 아예 다루지 않는다.

<div class="lay">
<div class="cd" style="border-top-color:#3b82f6"><b>화면</b><span class="k">Electron</span><span class="s">닫거나 교체해도 세션은 그대로</span></div>
<div class="ar">⇄</div>
<div class="cd" style="border-top-color:#0ea5e9"><b>데몬</b><span class="k">순수 Node · SQLite · MCP</span><span class="s">상태의 단일 진실, 단일 실행</span></div>
<div class="ar">⇄</div>
<div class="cd" style="border-top-color:#14b8a6"><b>홀더 (세션마다)</b><span class="k">이름 있는 파이프</span><span class="s">CLI를 소유, 데몬 없이도 생존</span></div>
<div class="ar">→</div>
<div class="cd" style="border-top-color:#64748b"><b>CLI</b><span class="k">Claude · Codex · Gemini · 셸</span><span class="s">구독 로그인</span></div>
</div>

### <span class="n3">4.1</span> "복구"의 세 가지 뜻

세 방식은 화면에서 같은 동작처럼 보이면 안 된다.

| 방식 | 언제 | 화면에 보일 이름 | 이어지는 것 |
|---|---|---|---|
| 재부착 | 홀더가 살아 있다 | (자동, 표시 없음) | 프로세스와 대화 전부 |
| 대화 재개 | 홀더는 없고 제공자 대화 파일이 있다 | Resume | 대화 기록. 프로세스 안의 일은 끊김 |
| 맥락 이어하기 | 대화를 이어갈 수 없거나 너무 크다 | Start fresh from notes | 인수인계 메모와 프로젝트 메모리만 |

### <span class="n3">4.2</span> 복구 흐름

1. 화면이 데몬에 연결하고 전체 상태를 받는다.
2. 데몬은 살아 있는 홀더에 재부착한다(데몬이 재시작됐을 때도 같다).
3. 홀더가 없는 세션은 마지막 확인 정보(마지막 요청, 마지막 답, 시각, 종료 코드)와 이어하기 방식을 보여 준다.
4. 사용자가 Resume · Start fresh · Close 중 고른다. 데몬이 임의로 고르지 않는다.

### <span class="n3">4.3</span> 안전 원칙

- 복구를 위해 기존 세션을 자동으로 종료하지 않는다.
- 같은 제공자 대화를 두 번 띄우지 않는다. 홀더 시작이 늦어져 두 번째가 뜨던 사고가 있었다(시작 대기 30초, 데몬 없이 60초 지나면 홀더 자진 종료로 막음).
- 재연결·재깨움은 횟수 제한이 있고(3분에 3번) 넘으면 멈추고 알린다.
- 사용 한도 중에는 깨우지 않는다.
- 세션 종료는 사용자 요청 또는 명시한 정책에서만 한다. **Hibernate의 초기 기본값은 Manual Only(수동만)**이고, 휴면·깨움 성공률을 측정한 뒤 자동 Hibernate(유휴 때)를 허용한다(D14). 사용자의 답을 기다리는 세션은 휴면시키지 않는다. 지금 구현은 30분 유휴 시 자동 휴면(`ASM_HIBERNATE_MIN`)이라 2.0에서 바꿔야 한다.

### <span class="n3">4.4</span> 홀더와 배포 — 풀어야 할 문제 (D9)

- 홀더는 자기를 띄운 빌드 폴더의 Electron 실행 파일로 돈다. 그래서 그 폴더를 덮어쓸 수 없고, 배포마다 새 폴더가 생겨 정리가 필요하다.
- 고정 런타임(`%APPDATA%\AgentO\runtime`)으로 옮기면 폴더 문제가 사라진다. 하지만 node-pty와 better-sqlite3는 Electron 버전에 맞춰 빌드돼 있어 일반 Node로는 못 돌린다. 먼저 홀더만 별도 실행 파일로 분리할 수 있는지 확인한다.
- 어느 쪽이든 데몬과 홀더의 버전 호환 규칙이 필요하다. 버전이 다른 홀더가 오래 남지 않게 회수·정리하는 기준도 정한다.

### <span class="n3">4.5</span> 복구 정보는 최소로 시작

- 저장할 것: 마지막 요청과 답(대화 기록에서 읽음), 마지막 활동 시각, 종료 코드, 작업 폴더, 마지막 상태의 근거.
- 상세서가 제안한 복구 관리자·복구 일지·AI 요약 전체는 만들지 않는다. 실제 복구 실패가 확인되면 그때 늘린다. AI 요약은 원본 사실이 아니라 "요약"으로 표시한다.

---

<a id="cat-5"></a>

# <span class="num">5</span> 세션 간 협업 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 일을 부탁하고 결과를 돌려받는 것까지만 한다. 위계 보고, 자동 승진 같은 개념은 두지 않는다.

### <span class="n3">5.1</span> 요청 모델

| 필드 | 내용 |
|---|---|
| 번호 | 프로젝트별 연번 `#T<n>` (지금 구현과 같음) |
| 보낸 쪽 · 받는 쪽 | 세션 ID. 같은 프로젝트 안에서만 보낼 수 있다 |
| 본문 | 부탁할 일과 끝났다고 볼 기준 |
| 상태 | requested(보냄) · delivered(전달됨) · answered(답이 옴) · failed(실패·취소) |

> 초기 4상태(requested · delivered · answered · failed)로 시작한다. 세션별 Active Task와 이벤트(늦게 온 응답 등)의 Task 귀속은 로드맵 2단계에서 다룬다(D13, A.4).

- 상세서의 Draft · Accepted · In Progress · Needs Clarification는 두지 않는다. 가벼운 부탁보다 업무 관리에 가까워진다. "수락 단계가 실제 문제를 푸는가"가 확인되면 그때 더한다.
- 같은 요청이 두 번 전달되지 않게 번호를 키로 쓴다. 재시도할 때도 같은 번호를 쓴다.
- 받는 세션이 쉬고 있으면 깨워서 전달하고, 질문 화면이 떠 있으면 보류하고 사용자에게 알린다(지금 구현).
- 전달한 글이 세션에 닿지 않았으면 한 번 자동 재전송하고, 또 실패하면 사용자에게 알린다(지금 구현).
- **전달이 멈춘 것처럼 보이면 안 된다.** 쉬고 있는 세션에게 가는 글은 기다리게 하지 않는다. 기다리게 하는 경우(진행 메모를 다른 메시지에 얹기, 같은 때 끝난 보고 20초 묶기, 프롬프트 응답 대기)는 화면에 「N개 대기 중 · 이유 · 몇 분째」를 보여 준다. 상한도 짧게 둔다(지금 얹기 상한은 15분).

### <span class="n3">5.2</span> 화면과 장부

- 사용자가 보는 곳은 Inbox 하나다. "내 판단이 필요한 것"과 "세션끼리 주고받은 일의 상태"를 같은 줄에 섞지 않는다.
- 카드 사이 연결선은 최근 전달을 보여 주는 보조 표시다. 연결선을 끌어서 결과를 전달하는 기능은 2.0 초안(아키텍처 명세)에 있지만 필수는 아니다.

### <span class="n3">5.3</span> 공식 세션 간 메시지와의 관계 (D5)

- Claude Code에 공식 세션 간 메시지(`ListAgents`, `SendMessage`)가 생겼다. Windows 네이티브는 v2.1.234 이상이 필요하다.
- 공식 기능은 Claude 세션끼리 평문 전달만 한다. 대기열, 번호, 재시도, 다른 CLI(Codex 등), 전달 결과 표시는 없다.
- 그래서 AgentO의 전달 경로는 "여러 CLI를 잇고, 데몬에 남고, 전달 결과가 보이는" 얇은 층으로 남긴다. 두 경로를 함께 쓰면 본문과 상태의 주인이 둘이 되어 사용자가 혼란스러우므로, 주인은 AgentO 하나로 정한다.
- 외부 프로세스(데몬)가 공식 소켓으로 보낼 수 있는지는 확인하지 않았다. 확인되기 전에는 의존하지 않는다.

### <span class="n3">5.4</span> 권한과 경계

- 요청은 같은 프로젝트의 세션에만 보낸다. 프로젝트 사이에 맥락이 섞이지 않게 검사한다.
- 받는 세션은 부탁받은 일의 파일 수정 범위를 요청 본문에서 확인한다. 보낸 세션의 권한 승인은 넘어가지 않는다.
- 다른 세션의 대화 전체를 복사해 보내지 않는다. 필요한 맥락만 보낸다.

### <span class="n3">5.5</span> 전달이 멈췄을 때 보여 주기

> 2026-11-18 사용 중 두 번 겪었다. 글은 데몬 큐에 쌓였는데 사용자는 세션이 멈춘 것으로만 보았다. 원칙: **기다리는 글은 반드시 이유와 함께 화면에 보인다.**

| 막히는 이유 | 지금 | 2.0 표시 |
|---|---|---|
| 받는 쪽이 일하는 중 | 화면에 대기 표시 없음 | 「작업 중이라 대기 · N개」 |
| 진행 메모를 다른 메시지에 얹으려고 기다림(최대 15분) | 표시 없음. 코치 답까지 얹어서 15분 지연된 사례 | 일을 넘기지 않은 답은 바로 전달(고침). 얹기가 남으면 「다음 일과 함께 보낼 메모 · N분째」 |
| 보고를 20초 모아 한 번에 보냄 | 표시 없음 | 20초라 표시는 생략 |
| 질문·확인 창이 열려 있음 | 아는 창만 Chat에 표시(폴더 추가 창은 고침) | 모르는 창도 「CLI가 창에서 멈춤 · 글 N개 대기 · Terminal 열기」 |
| 사용량 한도 | Limit 표시, 인박스 알림 | 유지. 리셋 시각과 대기 글 수 |
| 세션이 꺼져 있음·깨우는 중 | 인박스에 한 번 알림 | 「깨우는 중 · N분째」 |
| 닫힌 프로젝트 | 큐에 보류 | 「프로젝트가 닫혀 있음」 |

- 대기 중인 글 수와 가장 오래된 글의 경과 시간은 카드 머리와 Session 탭에 같이 보인다. 일정 시간(예: 3분)을 넘으면 Needs you로 올린다.
- 자동 응답(폴더 신뢰, 폴더 추가)은 키 순서(`↓` 먼저 등)와 확인한 CLI 버전을 규칙 파일에 적는다(9.1). 규칙이 못 푼 창은 위 표의 「모르는 창」 경로로 사람에게 넘어간다.
- 창이 열려 있는 동안에는 Enter 재시도를 하지 않는다(「No, exit」가 눌려 세션이 끝나는 것을 막기 위해, 고침).

---

<a id="cat-6"></a>

# <span class="num">6</span> 프로젝트 메모리와 이어하기 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 메모리는 긴 대화 기록이 아니라, 새 세션이 빠르게 일을 이해하기 위한 짧은 사실 모음이다.

### <span class="n3">6.1</span> 지금 구현 (유지)

| 항목 | 내용 |
|---|---|
| 섹션 | Decisions · Conventions · Map · Don't · Open |
| 한 줄 한 사실 | 섹션당 20줄, 전체 60줄, 6000자 상한. 넘으면 거절하고 줄이라고 안내 |
| 쓰는 법 | MCP 도구 `update_memory` (추가·바꾸기·지우기) |
| 읽는 법 | Claude 세션 시작·재개·fresh start 때 시스템 프롬프트에 주입 |
| 보이는 곳 | Files 탭 머리글의 Memory 버튼 |

### <span class="n3">6.2</span> 저장 위치 (D3)

- 현재는 데이터 폴더(`team/memory/<projectId>.md`)다. 저장소를 다른 PC에서 열면 맥락이 사라지고, 프로젝트와 함께 옮겨지지 않는다.
- 제안: 저장소 안 `.agento/memory.md`를 원본으로 한다. 팀이 검토할 수 있고 프로젝트와 함께 이동한다. 커밋될 수 있으므로 비밀·개인 정보는 넣지 않고, 로컬 전용 항목은 데이터 폴더 파일에 따로 둔다.
- 풀어야 할 점: 프로젝트에 폴더가 여러 개일 때 원본은 어느 폴더에 두나(주 폴더 지정). 동시에 두 세션이 고칠 때의 충돌 처리. 파일이 저장소에 생기는 것을 `.gitignore`로 안내할지.
- 상세서가 제안한 여러 파일(overview, decisions, …)과 DB 엔티티 방식은 지금 규모에 무겁다. 단일 파일 + 섹션을 유지한다.

### <span class="n3">6.3</span> Fresh start와 이어하기

- 긴 대화는 인수인계 메모를 만들게 한 뒤 새 대화로 시작한다. 메모 끝에 직전 요청과 마지막 답 원문을 붙인다. 직전 대화는 "이전 대화"로 되돌릴 수 있다.
- 사용자가 최근에 입력한 세션은 크기와 무관하게 자동으로 새로 시작하지 않는다.
- 쉬던 세션을 깨울 때 쉬었던 시간과 "그동안 브랜치·파일이 바뀌었을 수 있다"는 안내를 붙인다(20분 이상 쉰 경우).
- 앱을 다시 켜면 "Pick up where you left off" 카드가 세션마다 마지막 요청과 답을 보여 주고 Resume을 제안한다.

---

<a id="cat-7"></a>

# <span class="num">7</span> 화면 구성 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 화면 수를 줄이는 것이 목표다. "봐야 할 탭이 너무 많아서 찾기 어렵다"가 감독이 직접 한 말이다.

### <span class="n3">7.1</span> 기본 구성

| 영역 | 내용 | 비고 |
|---|---|---|
| 왼쪽 | 프로젝트와 세션 트리. 접을 수 있다 | 세션 행: 아이콘, 이름, 상태 배지 |
| 가운데 | Ground(기본) · Split · Tabs | 세션 카드의 Chat / Terminal 전환 유지 |
| 오른쪽 | Session · Files · Inbox · Web | D4. 두 번째 패널로 나란히 놓기 가능 |
| 가운데 보기 중 하나 | Today | 사용자 판단 필요, 하는 중, 끝난 것, 이어하기 카드 (보기 모드: Ground · Split · Tabs · Today) |
| 아래 | 상태 막대 | 데몬 연결, 사용량 |

### <span class="n3">7.2</span> 합치거나 지우는 것

| 기존 | 결정 |
|---|---|
| Manager 탭, Logs 탭, Activity, Orders, Flow, Timeline | 1.1에서 이미 제거. 상세서가 "제거 후보"로 둔 Flow도 팀 기능과 함께 없어졌다 |
| Inspector | 별도 탭을 만들지 않고 Session 안에 접힌 상세(모델, 대화 크기, 모드, 작업 폴더, 상태 근거)로 둔다 |
| 상태 배지·점·글자 | 같은 뜻을 여러 모양으로 보이지 않게 한 곳으로 모은다 |
| 터미널 보기 아래 입력창·Go/Steps/Best 버튼 | 지운다. 터미널은 CLI 원래 모습 그대로 두고 입력은 터미널 안에서 한다. Codex는 `--no-alt-screen`(인라인 모드)으로 띄워 위로 스크롤된다 |

- 터미널 보기에서 입력창을 지우면서 생기는 위험: Codex 터미널에 한글을 직접 치면 글자가 빠지거나 갈라지던 문제가 다시 나타날 수 있다(1.1에서 입력창으로 우회한 이유). 먼저 터미널 직접 입력 시험(11.2)을 하고, 문제가 확인되면 입력창을 되살리지 않고 터미널 입력 방식(IME 처리)으로 풀 수 있는지 본다.
- 남은 화면(Today, Split, Tabs, Web 탭)도 사용 빈도가 낮다는 이유만으로 바로 지우지 않는다. 사용 기록(`UI Usage`)을 본 뒤 정한다. 상세서 16.3의 같은 원칙이다.

### <span class="n3">7.3</span> 시선 규칙

- 브랜드 색(파랑)은 핵심 실행 버튼(New Session, Send)에만 쓴다.
- 경고 색(주황·빨강)은 주의가 필요한 것(입력 대기, 대화 크기 임계, 오류, 한도)에만 쓴다.
- 자주 쓰는 빠른 답(Go · Steps · Best · Branch)은 입력창에 포커스가 있을 때만 보인다.

### <span class="n3">7.4</span> 비슷한 앱에서 참고할 화면 아이디어

| 아이디어 | 출처 | 2.0에 넣을지 |
|---|---|---|
| 세션 점 하나에 우선순위(막힘 > 안 본 완료 > 작업 중 > 쉼) | Herdr | 제안 — "안 본 완료" 표시를 트리와 Pick up에 |
| 새 세션을 별도 git worktree에서 시작하는 선택지 | Orca, Conductor 등 대부분 | 제안 — 선택 기능, 기본은 지금처럼 공유 폴더 |
| 긴 대화를 오염시키지 않는 곁가지 질문(side chat) | Claude Code 데스크톱 | 후보 — Fresh start보다 가벼운 대안 |
| 보기 모드 Verbose · Normal · Summary | Claude Code 데스크톱 | 후보 |

### <span class="n3">7.5</span> Mac 스타일 (D11, 2.0부터 적용)

> 감독 결정(2026-11-18): 2.0부터 Mac 스타일로 간다. 1.x 화면은 그대로 둔다. Windows에서 쓰더라도 모양은 Mac 스타일이고, Mac에서 열어도 같다.

| 번호 | 변경 | 내용 |
|---|---|---|
| M1 | 메뉴 막대 제거 | Windows의 창 안 HTML 메뉴 막대를 없애고 앱 메뉴는 버튼 하나로 모은다. 제목 줄에는 앱 이름만 둔다 |
| M2 | 둥근 모서리 체계 | 창 > 패널 > 카드 > 버튼 순으로 안쪽일수록 작게(concentric). 선(border)을 줄이고 옅은 배경 차이와 그림자로 구분한다 |
| M3 | 사이드바 | 왼쪽은 떠 있는 패널(가장자리 여백, 둥근 모서리, 옅은 그림자). 오른쪽은 콘텐츠 옆에 붙는 패널 |
| M4 | 툴바 | 버튼을 의미별로 묶는다. 누르지 않는 상태 표시는 배경 없이 둔다. 중요한 버튼만 강조색 |
| M5 | 상태 표시 | 점과 배지로 조용히. 주의 색은 정말 필요한 곳에만(7.3과 같은 규칙) |
| M6 | Mac 전용 효과 | vibrancy·liquid glass는 **Mac 실기기에서 보면서 나중에.** 이 PC(Windows)에서는 확인할 수 없다. dmg 빌드와는 무관하다(릴리스 흐름은 이미 Mac dmg를 만든다) |

- 유리 효과는 최상위에 떠 있는 핵심 컨트롤에만 아껴 쓴다는 것이 Apple의 원칙이다(WWDC25 세션 310). 웹 기반 화면에서는 CSS로 모양만 따라 한다.
- 에이전트 관리 앱(Codex 앱, Conductor)은 "사이드바 = 프로젝트와 세션, 가운데 = 대화, 상태는 점·배지"라는 구조를 쓴다. 유리 효과보다 이 정보 구조가 더 중요하다.
- 화면만 바뀌는 수정이므로 세션을 끊지 않고 배포할 수 있다. 로드맵 2단계(화면 단순화)와 함께 진행한다.

---

<a id="cat-8"></a>

# <span class="num">8</span> 자동화 (Autopilot) <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 자동화는 "상태가 정확하다"는 전제 위에서만 안전하다. 그래서 상태·복구 뒤에 둔다.

### <span class="n3">8.1</span> 단계

| 단계 | 내용 | 2.0 범위 |
|---|---|---|
| A | 상태 감지와 알림 | 기본 |
| B | 안전한 재연결(홀더 재부착) | 기본 |
| C | 한 세션이 자리를 비운 사이 이어서 진행(현재의 solo Autopilot) | 설정 안의 고급 기능 |
| D | 새 세션을 만들어 맥락 전달 | 사용자 승인이 있을 때만, 로드맵 5단계 이후 |
| E | 파일 수정·명령 실행을 포함한 자율 작업 | 범위 밖 |

### <span class="n3">8.2</span> 지금 구현된 안전장치 (유지)

- 프로젝트마다 켜고 끄며, 한 세션이 맡는다.
- 시간당 6번 넘게 이어가면 멈춘다. 이어가기가 두 번 연속 진전이 없으면 멈춘다.
- 사용자만 할 수 있는 일은 메모리 Open에 적고 건너뛴다.
- 끝나면 `AUTOPILOT DONE`을 선언한다. 한도 중, 닫힌 프로젝트, 입력 화면이 떠 있을 때는 보내지 않는다.
- 자동이 멈추면 인박스에 사유가 남는다.

---

<a id="cat-9"></a>

# <span class="num">9</span> 구조 · 데이터 · 배포 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

### <span class="n3">9.1</span> 코드 구조 원칙

- 데몬 코드는 Electron을 import하지 않는다(순수 Node).
- 화면은 상태를 소유하지 않는다. 낙관적 갱신을 해도 최종 상태는 데몬 응답으로 맞춘다.
- 화면과 데몬의 메시지 타입은 `src/shared/protocol.ts` 하나가 진실이다.
- 제공자(Claude, Codex, …)별 차이는 어댑터 안에 가둔다. 어댑터는 "관찰할 수 있는 이벤트"와 "이어하기 방식"만 능력으로 선언한다. 모든 제공자를 같은 상태·복구 모델로 맞추지 않는다.
- 프롬프트 자동 수락 규칙(폴더 신뢰, 디렉터리 추가, 선택창)은 코드에 박지 않고 규칙 파일로 분리한다. CLI 문구가 바뀌어도 규칙 파일만 고치면 된다. 새로 만들 때 규칙은 어느 CLI 버전에서 확인했는지를 함께 적는다.

### <span class="n3">9.2</span> 데이터

- 세션 ID와 제공자 세션 ID를 구분한다.
- 이벤트는 가능한 한 덧붙이기만 하고, 현재 상태는 세션 행에 캐시한다.
- 상태를 바꾼 근거를 기록한다.
- 환경 변수·토큰·인증 정보는 로그와 메모리에 쓰지 않는다.
- 스키마 변경은 번호 있는 마이그레이션으로 한다. 1.1 데이터(프로젝트, 세션, 인박스, 장부)는 2.0이 그대로 읽는다. 파트가 사라지면 파트의 세션은 부모 프로젝트로 옮긴다.

### <span class="n3">9.3</span> 배포

1. 새 폴더에 빌드한다.
2. 실행 중인 홀더는 그대로 두고 데몬과 화면만 교체한다.
3. 새 데몬이 기존 홀더에 재부착했는지 확인한다.
4. 쓰이지 않는 이전 빌드 폴더를 지운다.
5. `killSessions`는 사용자가 명시적으로 요청할 때만 쓴다.

- D9가 풀리면(고정 런타임) 2번과 4번이 단순해진다.

### <span class="n3">9.4</span> 보안

- 로컬 파이프·WebSocket은 이 PC의 프로세스만 접근한다. MCP는 세션별 토큰을 쓴다.
- 파일 수정·삭제·셸 실행 권한은 승인 카드(허용 / 이 세션 동안 / 이 폴더 신뢰)로 사용자가 정한다.
- 프로젝트 사이 맥락이 섞이지 않게 경계를 검사한다.

---

<a id="cat-10"></a>

# <span class="num">10</span> 단계별 로드맵 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

> 한 번에 다시 만들지 않는다. 1.1에서 이어받아 단계마다 사용할 수 있는 상태로 둔다.

| 단계 | 목표 | 주요 작업 | 끝났다고 볼 기준 |
|---|---|---|---|
| 0 | 기준선 | 생명주기 시험(데몬 강제 종료, CLI만 종료, 홀더만 종료) 실행, 훅 TUI 시험, 화면·기능 사용 기록 확인, 결정 D1~D10 | 현재 성공·실패 표가 있고 결정이 정리됨 |
| 1 | 생존·복구·상태 근거 | 두 축 상태 모델, 훅 우선 판정(Claude), 근거 기록, 복구 3방식 구분, 홀더 호환 규칙 | UI·데몬 재시작 후 재부착, 복구 불가 이유 표시, 시험에 포함 |
| 2 | 화면 단순화 + Mac 스타일(M1~M5) | Inspector를 Session 안으로, 상태 표시 통일, "안 본 완료", 남은 화면의 사용 기록 검토 | 같은 정보를 두 화면에서 관리하지 않음 |
| 3 | 프로젝트 메모리 | 저장 위치 확정(D3), 충돌 처리, 인수인계 템플릿 | 새 세션이 규칙과 현재 일을 이해, 메모 갱신 추적 가능 |
| 4 | 협업 | 요청 4상태, 번호 기반 중복 방지, 프로젝트 경계 검사 | 보냄·전달·답·실패가 보이고 중복 전달 없음 |
| 5 | 자동화 | solo Autopilot 정리, 단계 B 자동 재연결 | 한도·중단 조건이 분명하고 무한 반복 없음 |

- 단계 0의 시험은 끝났다. 생명주기 시험 9개를 스모크에 넣어 36/36 통과했다(데몬 강제 종료 후 재부착·입력, CLI만 종료 시 종료 기록과 재시작, 홀더만 종료 시 감지와 재시작). 훅 시험은 위 3.3의 표가 결과이고, 일반 도구 권한 질문과 사용 한도 두 가지만 재현하지 못했다. 남은 것은 결정 D1~D10이다.
- 1.1에서 이미 있는 것은 부록 A.3에 있다.

---

<a id="cat-11"></a>

# <span class="num">11</span> 검증 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

### <span class="n3">11.1</span> 지금 있는 시험

- `npm run typecheck`
- `npm run smoke` — 일회용 데몬으로 확인한다(시작, 프로젝트, 홀더, 입력, 재시작 후 재부착, 권한 보류, 프로젝트 삭제 등). main 기준 36개이고 모두 통과했다(1.1은 27개). AI 호출 없음.
- `npm run smoke:ui` — 실제 창에 읽기 전용으로 확인(별도 실행 환경 필요)

### <span class="n3">11.2</span> 더할 시험

| 영역 | 시나리오 |
|---|---|
| 생명주기 | 데몬 강제 종료 후 재기동, CLI만 종료, 홀더만 종료는 추가 완료. 화면 재실행 반복은 아직 |
| 상태 | 훅 이벤트 중복·누락, 훅 없는 사건(선택지·폴더 신뢰·한도), 데몬 재시작 뒤 상태 재계산 |
| 복구 | 대화 파일이 큰 세션의 재개, 제공자 대화가 없는 경우, 같은 대화 중복 재개 방지 |
| 협업 | 받는 세션이 없음·종료됨, 같은 번호 재전송, 다른 프로젝트로 보내기 |
| 전달 지연 | 쉬는 세션에게 가는 답이 바로 도착하는지(얹기 아님), 질문 창이 열린 세션에 글을 보내면 Enter를 누르지 않고 화면에 이유가 나오는지, 폴더 추가 창이 좁은 카드에서도 자동 허용되는지 |
| 터미널 | Codex가 인라인 모드로 떠서 위로 스크롤되는지, 입력창 없이 한글을 터미널에 바로 칠 때 글자가 빠지는지(예전에는 입력창으로 우회했음) |
| 데이터 | 마이그레이션, 경로가 바뀐 프로젝트, 오래된 세션 |

### <span class="n3">11.3</span> 성공 지표 (측정부터)

UI 재시작 후 재연결 성공률, 데몬 재시작 후 복구 성공률, 사용자가 세션을 다시 만든 횟수, 상태 오표시 횟수, 놓친 Needs you, 기본 작업까지 거치는 화면 수. 기준선을 잰 뒤 목표 수치를 정한다.

---

<a id="cat-12"></a>

# <span class="num">12</span> 위험과 범위 밖 <span class="hctl"><a href="#toc">↑ 목차로</a></span>

### <span class="n3">12.1</span> 위험

| 위험 | 대응 |
|---|---|
| 홀더가 업그레이드 경계가 된다(버전이 다른 홀더가 쌓임) | 호환 규칙과 회수 기준을 1단계에서 정한다. D9 확인 |
| 훅·화면·프로세스가 서로 다른 상태를 말한다 | 근거 출처와 우선순위를 정하고 unknown을 허용한다 |
| 저장소에 커밋되는 메모리에 비밀이 섞인다 | 비밀 금지 규칙, 로컬 전용 파일 분리, 크기 상한 |
| 협업 경로가 둘이라 혼란 | AgentO가 주인(D5) |
| 제공자 CLI 문구가 바뀌어 자동 수락이 깨진다 | 규칙 파일 분리, 규칙마다 확인한 CLI 버전 기록 |
| 한 폴더 두 세션이 파일을 충돌시킨다 | worktree 선택 기능(7.4), 같은 폴더 경고 |
| 코치가 Codex에게 보낸 답이 15분 뒤에야 도착했다(2026-11-18 14:03 보낸 글이 14:18:45 전달. Codex는 14:09부터 쉬고 있었다) | 원인: 코치의 「replied」 답은 일을 넘기지 않고 직접 답한 경우에도 「얹기」로 큐에 들어가 15분까지 단독 전달이 미뤄졌다. 2.0 작업 폴더에서 일을 넘긴 경우에만 얹도록 고쳤다(`team.ts`). 남은 일: 대기 중인 이유를 화면에 표시(5.1) |
| 보낸 글에 세션이 반응하지 않는다(2026-11-18, 데모-UI 개발: Claude가 「새 폴더 추가(attachments)를 믿을까요? 기본값 No, exit」 창에서 멈춤. 보낸 지시 3개가 답 없음) | 원인: 폴더 추가 자동 허용이 이번에 동작하지 않았다(긴 경로가 좁은 카드에서 줄바꿈되면 경로를 잘못 읽는 것으로 추정). 줄바꿈을 넘어 읽도록 고쳤고, 이런 창이 열려 있으면 Enter 재시도가 「No, exit」를 누르지 않게 했다. Chat 화면은 이 창을 몰라 그냥 글을 큐에만 쌓았고 Terminal에서만 보였다 → 모르는 창이라도 「CLI가 창에서 멈춤」으로 Chat에 알린다. 폴더 추가 창은 「Yes, add it / No, exit」 카드로 Chat에서 바로 답하게 했고(`ChatView.tsx`, `prompts.ts`), 이제 Needs you에도 올라간다. 남은 일: 모르는 창도 같은 알림(「이 창에 답해야 글이 전달됨」 + 쌓인 글 수 + Terminal 열기), 규칙은 키 순서와 확인한 CLI 버전과 함께 규칙 파일로 분리(9.1) |
| 큰 대화로 비용과 지연이 커진다 | 대화 크기 표시, 자동 fresh start 기준과 보호 규칙 |
| Gemini CLI가 연결되지 않는다(이 PC 점검, 2026-11-18: CLI 0.68.0 설치됨, `oauth_creds.json` 없음, 설정은 `gemini-api-key` 방식인데 `GEMINI_API_KEY` 환경 변수 없음, `gemini -p`가 응답 없이 끝남) | 인증이 없는 것이 원인으로 보인다. Connections 화면이 「로그인 안 됨」과 필요한 조치(API 키 또는 Code Assist 로그인)를 알려 주고, 세션이 응답 없이 끝나면 그 이유를 표시한다. Gemini는 터미널 전용(D8)이라 연결이 안 돼도 다른 제공자에는 영향이 없다 |

### <span class="n3">12.2</span> 지금 하지 말 것

- 훅 상태 정확도, 홀더 호환 규칙, 협업의 주인이 정해지기 전에 Autopilot이나 새 협업 층을 더하지 않는다.
- 사용 기록을 보기 전에 남은 화면(Split, Tabs, Today, Web)을 지우지 않는다.
- 설계서가 정리되기 전에 2.0 구조 변경(파트 삭제, 메모리 이전)을 시작하지 않는다.

---

<hr style="margin:4.5em 0 2em">

<a id="appendix"></a>

<details>
<summary class="apx"><span class="num">A</span> 부록 <span class="hctl"><a href="#toc">↑ 목차로</a></span></summary>

## A.1 조사 근거

### 비슷한 앱 (2026-11-18 조사, 대부분 2차 자료)

| 도구 | 성격 | 세션 유지 | 참고할 점 |
|---|---|---|---|
| Orca | 데스크톱+모바일, worktree 병렬, 코디네이터 | 원격 호스트 실행(복구 방식 설명 없음) | 기능 범위가 매우 넓다. 무거워진 방향의 예 |
| Claude Squad, CCManager | tmux + worktree 터미널 앱 | tmux가 유지 | 상태 표시 |
| Conductor | Mac 앱, worktree, diff·PR | 해당 없음 | 변경 검토 흐름 |
| Vibe Kanban | 칸반 보드 + worktree | 해당 없음 | 에이전트가 MCP로 보드 조작 |
| Herdr | Rust 멀티플렉서, 상태 인식 | 레이아웃만 복원, Windows 미지원 | 상태 우선순위, 훅 통합 |
| Paseo, Happier | 데몬 + 폰/웹 클라이언트 | 데몬 유지, 재시작 후 재개 | 모바일 알림(후순위) |
| Claude Code 데스크톱 | 병렬 세션 사이드바 | 보관·재개 | side chat, 보기 모드 |

- 세션 유지와 복구를 핵심으로 내세운 도구는 찾지 못했다(검색의 한계가 있다). Windows에서 되는 것은 더 드물다.

### Claude Code 훅과 세션 간 메시지 (공식 문서 확인)

- 훅 이벤트: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Notification(종류별 필터), Stop, StopFailure 등. HTTP 훅으로 로컬 주소에 직접 POST할 수 있다. `--settings`로 세션별 주입이 가능하다.
- 실제 시험: headless에서 `--settings`의 HTTP 훅이 UserPromptSubmit·Stop을 보냈고 Stop에 마지막 답 본문이 들어 있었다(Claude Code 2.1.326). SessionStart는 headless에서 수신되지 않았다. TUI는 시험 중.
- 공식 세션 간 메시지: `ListAgents`·`SendMessage`, 수신 정책 `crossSessionInbound`(accept·hold·refuse), 평문만, Windows는 파이프 사용.

### Codex 검토 (읽기 전용으로 2회)

- 1차는 요약만, 2차는 원문 3개를 읽고 답했다.
- 공통 지적: 홀더의 버전 경계, 상태의 단일 진실, 메모리와 협업의 경계, 상태 확정과 이벤트 수신의 분리.
- 2차에서 철회·보강: Autopilot 삭제 권고 철회(기본 화면에서 숨기고 안정화 뒤 판단), 메모리는 저장소 안 파일이 맞지만 단일 `memory.md`로 확정은 이르다.

## A.2 세 문서 사이의 어긋남과 이 문서의 처리

| 주제 | 어긋남 | 이 문서 |
|---|---|---|
| 화면 | 1.0 리뷰는 Today에 통합, 상세서는 Overview·Activity·Files·Context·Settings, 아키텍처서는 Files·Inbox·Inspector | D4 — Session·Files·Inbox |
| 데이터 구조 | 상세서는 Project/Part/Folder, 아키텍처서는 평면 Workspace | D2 — 프로젝트(폴더 여러 개)만 |
| 메모리 | 상세서는 여러 파일과 DB, 아키텍처서는 `.agento/memory.md` | D3 — 단일 파일, 저장소 안 |
| 협업 | 상세서는 8상태 Task Request, 아키텍처서는 3상태 Handoff 패킷 | 4상태(5.1) |
| 상태 | 상세서는 9 + 3, 아키텍처서는 5 | 3장의 두 축 |
| 홀더 런타임 | 아키텍처서만 고정 런타임을 제안 | D9 — 먼저 확인 |

## A.3 1.1에서 이어받는 자산

| 자산 | 상태 |
|---|---|
| 홀더, 단일 실행 데몬, 데몬 재시작 후 재부착 | 구현·스모크 확인 |
| Headless 세션(stream-json), 권한 카드 | 구현 |
| 프로젝트 메모리(`update_memory`), Fresh start, 이전 대화 복원 | 구현 |
| 일 장부(`#T` 번호, 상태 기록), 자동 재전송 | 구현 |
| Pick up where you left off, 깨움 안내, 휴면 보호 | 구현 |
| 폴더 신뢰·디렉터리 추가 자동 수락, 선택창 인식 | 구현(코드에 박힘 — 규칙 파일로 분리 예정) |
| solo Autopilot(한도·무진전 정지) | 구현 |
| 무중단 배포 스크립트 | 구현 |
| 보기 모드(Ground · Split · Tabs · Today), 오른쪽 탭(Session · Files · Inbox · Web) | 구현 |
| 스모크 시험 27개(1.1) · 36개(main, 생명주기 9개 포함) | 통과 |


## A.4 사용자 상세 재설계서(2026-11-18)와의 대조

> 출처: `AgentO_2.0_Detailed_Redesign.md`(미완 초안, 22개 장). 이 문서와 겹치는 것은 이미 반영돼 있고, 다른 것은 결정 D12~D16으로 올렸다. 확정으로 바꾸는 것은 감독이 정한 뒤에 한다.

### 이미 같은 방향이거나 이 문서에 있는 것

| 상세 재설계서 | 이 문서 |
|---|---|
| 홀더가 CLI를 소유, 데몬 재시작 후 재연결, 단일 실행 | 2.1, 4장 |
| Hibernate보다 재연결 우선, 무한 재시도 금지 | 4.3, 12장(깨우기 반복 제한) |
| 재개 세 방식 구분(홀더 재연결 · 대화 재개 · 새 세션) | 4.1 |
| Recovery Summary(마지막 요청·응답·확인된 사실, 근거) | 4.2, 4.5 |
| 프로젝트 메모리는 짧은 사실 모음, 전체 대화 전달 금지 | 6장 |
| 상태 판단 근거 기록, 이벤트는 가능한 한 추가만 | 3장 |
| 세션 무중단 배포, `killSessions`는 명시 요청 때만 | 2.1, 9.3 |
| 시험(Hibernate·Wake, UI·데몬 재시작, 늦은 응답) | 11장 |
| 비밀·토큰을 로그에 남기지 않음, 프로젝트 경계 검사 | 5.4, 9.4 |

### 새로 받아들일 것(D 번호 없이 바로 반영 후보)

- **늦게 온 응답은 원래 요청 Task에 붙인다.** 연결이 불확실하면 현재 Task에 붙이지 않고 「Unassigned」. 지금은 마지막 지시에 묶는 규칙이라 같은 문제가 생길 수 있다(5.1에 추가 필요).
- **보내기 전에 받는 세션과 Task를 보여 준다**(「Sending to: … · #T」). 완료된 Task로 보내면 막거나 후속 Task를 제안한다.
- **완료된 Task는 자동으로 되살리지 않는다.** 후속은 새 Task + `parentTaskId`, 다시 열기는 명시 요청만.
- **Wake 전 점검**(홀더가 살아 있나, 중복 실행 위험, 마지막 Task, 로그 있음)과 불확실할 때의 「Recovery Required」 상태.
- **같은 세션의 입력은 직렬로**: 한 세션의 Active Task는 하나, 진짜 병렬은 다른 세션으로(상세서 3.3).
- **새 Task에는 관련 맥락만 전달**하고 전체 과거 대화는 주지 않는다. 대화가 커지면 Context Refresh/Fresh start를 제안하되 자동으로 새 세션을 만들지 않는다(지금의 자동 fresh start와 다른 점 — D16과 함께 정한다).

### 충돌하거나 무겁다고 본 것

| 상세 재설계서 | 문제 | 처리 |
|---|---|---|
| Head Coach/Coach/Part Coach/Worker 규칙을 공식 유지 | 11-17 결정(위계 제거)과 반대. 규칙·MCP 권한을 다시 만들어야 하고 「가벼운 협업」이라는 처음 방향과 멀다 | D12 |
| 10개 Task 상태, 완료 기준·근거·승인, TaskEvent·SessionEvent·RecoveryRecord 테이블 | 1인 사용자 도구에 비해 무겁다. 4상태 요청이 지금 쓰임에 충분한지 먼저 본다 | D13 |
| 한 세션 안에서 Task 경계를 CLI에 전달(「Task Switch」 메시지) | CLI는 한 대화로 이어지므로 경계는 약속일 뿐이다. 효과는 Claude·Codex에서 시험해야 안다 | D13, 11.2에 시험 추가 |
| Manager·Orders·Today·Activity를 Task Inbox·Inspector로 통합 | 1.1에서 Manager·Logs·Orders·Flow·Timeline은 이미 지웠다. 남은 것은 Today와 Inbox | 7.2와 이미 같은 방향. 하단 Task Inbox는 D15 |
| 기본 화면을 Focused Workspace로, Ground는 고급 | 1.1의 기본은 Ground. 바꾸면 화면 전체가 달라진다 | D15 |
| 로드맵 1단계가 Task Ledger | 이 문서는 상태·복구·전달 신뢰를 먼저 한다(10장) | 10장 유지, D13을 정한 뒤 순서 재검토 |

### 부록 A의 「확인이 필요한 항목」 중 이 문서에서 이미 확인한 것

- Hibernate가 실제로 프로세스를 멈추는가: 멈춘다(홀더가 CLI를 끝내고 같은 대화를 다시 연다). 대화 재개에 실패하면 새로 시작한다.
- 세션 재개 방식: Claude Code는 `--resume <id>`, Codex는 `codex resume <id>`, Gemini는 `--resume`(터미널 전용).
- 같은 기록에 여러 Task가 섞이는 것: 지금도 `#T` 번호로 지시·보고를 묶지만, 대화 파일 안의 Task 구분은 없다.

## A.5 Codex 최종 검토 (2026-11-18)

> 출처: Coach · AgentO의 지시 #T75(Codex 의견 전달). 검토 원문은 이 문서에 옮기지 않았고, 아래 세 가지가 반영한 내용이다.

| 지적 | 반영 |
|---|---|
| 요청 상태를 처음부터 많이 두지 말 것 | 5.1: 초기 4상태 유지, 세션별 Active Task와 이벤트 귀속은 로드맵 2단계 |
| 위계 제거가 조정 역할까지 막으면 안 됨 | 1.2: 선택적 조정 역할은 허용, 필수 권한 계층은 아님(D12) |
| 자동 Hibernate는 측정 전에 기본으로 켜지 말 것 | 4.3·D14: 초기 기본값 Manual Only, 측정 후 자동 허용 |

</details>
