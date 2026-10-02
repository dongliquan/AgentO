# Shop Team — 협업 규칙

이 폴더는 AgentO 데모 팀이 함께 쓰는 작업 공간이다. 제품은 **쇼핑몰 화면 하나(상품 목록 + 장바구니)** 이고,
내용은 `BRIEF.md` 에 있다. 문서·보고는 한국어로 쓴다.

## 팀과 담당

| AgentO 프로젝트 | 세션 | 담당 |
|---|---|---|
| (팀 전체) | Head Coach | PM. WBS(`wbs.md`) 관리, 하루 계획·배분, 일일 보고(`reports/daily/`) |
| 기획 | Coach · 기획 / 기획자 | 요건정의(`docs/requirements.md`), 화면 설계(`design/wireframe.html`), 질의 응답 |
| 개발 | Coach · 개발 / 개발자 1 · 상품목록 / 개발자 2 · 장바구니 | 요건 분석, 구현(`src/`), backlog 버그 수정 |
| 테스트 | Coach · 테스트 / 테스터 | 테스트 케이스(`tc/test-cases.md`), 자동 테스트(`tests/`), 테스트 실행, backlog 등록·검증 |

## 파일 규칙 — 자기 영역만 고친다

| 파일 | 쓰는 사람 | 다른 사람은 |
|---|---|---|
| `wbs.md`, `reports/daily/*` | Head Coach | 읽기만. 진행 상황은 코치에게 보고 |
| `docs/requirements.md`, `design/*` | 기획 | 읽기만. 모호하면 기획에 질문 (`send_to_session` / `report_up`) |
| `src/*` | 개발 | 테스터는 고치지 않는다 — 버그는 backlog 에 등록 |
| `tc/*`, `tests/*` | 테스트 | 개발자는 고치지 않는다 — 테스트가 틀렸다고 보면 테스터에게 말한다 |
| `backlog.md` | 테스터가 등록, 개발자가 Fixed 로, 테스터가 Verified/Reopened/Closed 로 | 행을 지우지 않는다 |

## backlog.md 형식

한 버그가 한 행이다. ID 는 `BUG-001` 부터 순서대로.

| 상태 | 뜻 | 누가 바꾸나 |
|---|---|---|
| Open | 새 버그 | 테스터 (등록) |
| Fixed | 수정함 — 비고에 무엇을 고쳤는지 | 개발자 |
| Verified | 수정 확인 | 테스터 |
| Reopened | 다시 실패 | 테스터 |
| Closed | 종료 | Head Coach (일일 정리 때) |

## 하루 진행 (매일 반복)

1. Head Coach 가 `wbs.md` 와 `backlog.md` 를 보고 오늘 할 일을 정해 코치들에게 나눈다.
2. 기획은 요건과 화면을 다듬고, 개발·테스트의 질문에 답한다.
3. 개발은 WBS 의 다음 작업을 구현하고, **backlog 의 Open/Reopened 버그를 매일 확인해 고친다.**
4. 테스트는 테스트 케이스를 늘리고 `npm test` 와 화면 확인으로 테스트한 뒤, **Fixed 버그를 검증하고 새 버그를 등록한다.**
5. 각자 끝나면 코치에게 짧게 보고한다(무엇을 했는지, 바뀐 파일, 막힌 점). 코치는 Head Coach 에게 보고한다.
6. Head Coach 가 `wbs.md` 진행률을 갱신하고 `reports/daily/day-N.md` 를 쓴다.

하루 일은 작게 잡는다. 못 끝낸 것은 다음 날로 넘기고 WBS 에 적는다.

## 기술 조건

- 빌드 도구 없음: `src/index.html` 을 브라우저로 바로 연다. 순수 HTML/CSS/JS(ES 모듈).
- 계산 로직은 `src/cart.js`, `src/products.js` 처럼 DOM 과 분리해 테스트할 수 있게 한다.
- 자동 테스트: Node 내장 테스트(`node --test`). `npm test` 로 실행한다. 외부 패키지를 설치하지 않는다.
- 상품 데이터는 `src/data/products.json` 을 쓴다(기획이 바꿀 수 있다).
