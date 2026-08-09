# data/events — 기획(소윤) 소유, 스키마는 contract.md 1절

게임별 이벤트 어휘·반응 템플릿 (`<게임id>.js`, `window.<ID>_CHAT = { T, BURST }`).
어떤 사건이 방송에 잡히는지(이벤트 목록·facts 키)는 무대(현재)와 협의,
그 사건에 대한 말(템플릿)은 기획(소윤) 소유.

- 수정 → 저장 → `tools/persona-booth.html` 새로고침으로 바로 확인
- 검증: `node tools/validate.mjs` (PR마다 Actions 자동 실행 — 통과 시 셀프 머지)
- 사실 템플릿의 슬롯 집합은 게임이 emit하는 facts 키와 일치해야 한다 —
  이벤트를 새로 만들거나 슬롯을 바꾸려면 무대(현재)와 협의
