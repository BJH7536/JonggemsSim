# ADR-002 — data/ 페르소나는 "JSON 리터럴을 담은 .js 캐리어"로 싣는다

- **무엇을**: `data/personas/cast.js`는 `window.JONG_CAST = <엄격한 JSON 배열>;` 한 문장이다.
  contract.md 2절이 말한 "페르소나별 *.json" 대신 이 형식을 v1 캐리어로 확정한다.
- **왜**: 배포물은 `file://`에서 동작해야 하는데(루트 CLAUDE.md 기술 스택), 브라우저는
  `file://`에서 fetch/XHR로 .json을 읽는 것을 CORS로 막는다. `<script src>`는 막지 않는다.
- **JSON은 유지된다**: 우변은 엄격한 JSON이어야 하고 `tools/validate.mjs`가 JSON.parse로
  강제한다 — 기획(소윤)은 여전히 "JSON을 쓴다"고 생각하면 된다.
- **대안**: ① 순수 .json + 로컬 서버 필수화 — "링크 클릭 즉시 플레이" 요건과 충돌.
  ② 빌드 스텝으로 json→js 변환 — 의존성 0 원칙과 충돌. 둘 다 기각.
- **적용 범위**: 추후 `data/events/<게임>.json`도 같은 캐리어(`window.*_CHAT`)를 쓴다 —
  현행 `games/*/chat-data.js`가 이미 그 형식이라 이관은 파일 이동만으로 끝난다.
