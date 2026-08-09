# engine/ — 관객 (정훈)

AI 시청자 채팅 엔진. `prototypes/05-hwaryeok-show.html`에서 추출 →
`games/shell/` 임시 거처를 거쳐 2026-08-09 이관 완료.

| 파일 | 내용 |
|---|---|
| `chat.js` | 채팅 엔진 — 톤·fact/flavor·검증 게이트(슬롯 포함·비반복 <0.72·재실패 폐기)·버스트 타이밍·`[LLM-INTEGRATION-POINT]` |
| `llm.js` | LLM 어댑터 — `proxy/` 경유 발화 생성. 게이트는 chat.js에 유지, 실패는 전부 로컬 폴백 (proxy/README.md 2절) |

- 페르소나 캐스트는 `data/personas/cast.js`(소윤)에서 로드 — 스크립트 포함 순서상 엔진보다 먼저
- 무대(셸)가 의존하는 안정 표면: `stage.emit(ev, facts)` → `Chat.load/reset/react/sys`
- 검증: `node tools/validate.mjs`(데이터 계약) + `games/shell/selftest.html`(게이트 동작)
- 미리보기: `tools/persona-booth.html`
