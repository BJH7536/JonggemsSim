# tools/ — 관객 (정훈)

기획 지원 도구:

- `persona-booth.html` — 게임 없이 이벤트 버튼으로 AI 시청자 반응을 확인하는 기획(소윤)
  작업대. **실제 엔진(`engine/chat.js`)·실제 캐스트(`data/personas/cast.js`)·실제 어휘
  (`games/*/chat-data.js`)를 그대로 사용한다** — 부스에서 보이는 그대로 게임에서 나온다.
  게임 5종 탭 · 페르소나 솔로 모드 · 실게임과 같은 형태의 표본 사실 슬롯 · 연속 재생 ·
  엔진 로그(발화/폐기 + 폐기 사유: 슬롯 누락/반복). 브라우저로 직접 열거나(`file://` 동작)
  레포 루트에서 `python -m http.server 8770` 후 `http://127.0.0.1:8770/tools/persona-booth.html`.
  어휘 수정 → 저장 → 새로고침이 작업 루프다
- `validate.mjs` — data/·게임 어휘 계약 검증 (`node tools/validate.mjs`, 의존성 0).
  캐스트(JSON 형식·톤·중복)와 어휘(start/end·flavor 6개·톤 6종·슬롯 정합·BURST 범위)를
  검사한다. GitHub Actions(`.github/workflows/validate.yml`)가 PR마다 자동 실행 —
  통과하면 `data/` 변경은 셀프 머지 가능 (CONTRIBUTING 규칙 2)
- `resonance-sandbox.html` — 공명 판정층의 **실행 가능한 사양**. 게임과 똑같은 코드
  (`games/shell/shell.js`)를 직접 호출하므로 사양과 구현이 어긋날 수 없다. 이벤트를 쏘면
  공명·호오·배분·뜨내기 내역이 표로 나오고, 원형 벡터(흥미도 v / 호오 val)를 슬라이더로
  만진 뒤 **"코드로 내보내기"**로 `ARCH` 블록을 복사해 반영한다. 상수(경제 임계·혼합 바닥·
  변이율·이탈률·다양성 보너스)도 값 탐색용으로 노출. 60초 경과 버튼으로 뜨내기 이탈 확인
