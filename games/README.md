# games/ — 무대 (현재)

방송 셸(게임 선택·방송 루프·정산), 시청자 경제(수 증감·언락·게임 단위 신선도 — 규약 1·4),
게임↔셸 인터페이스, 개별 게임, 배포.

## 구조

```
/index.html               GitHub Pages 진입점 — 링크 클릭 즉시 플레이 (NAN 2026 제출물 1번)
games/shell/shell.js      셸: 허브·시청자 경제·신선도·방송 루프·정산   ← 계약 구현
games/shell/chat.js       AI 시청자 채팅 엔진 (임시 거처 — engine/로 이관 예정)
games/shell/shell.css     셸 + 게임 조작 UI 스타일
games/shell/selftest.html 자체 점검 (규약 4 회전 · 채팅 검증 게이트)
games/hwaryeok/           화력쇼 — 프로토타입 이식본 (critic 4차 승인 밸런스 보존)
games/giving-up/          Giving Up On It — 2번째 게임
```

게임↔셸 계약의 **규범 문서는 `docs/contract.md` 4절**이다. 코드와 어긋나면 문서가 맞다.

## 실행

브라우저로 `index.html`을 직접 열거나 (외부 의존성·네트워크 0건, `file://` 동작),
`python -m http.server 8770` 후 `http://127.0.0.1:8770/`.

자체 점검: `games/shell/selftest.html` — 전부 `ok`여야 한다.
탭이 백그라운드로 가면 rAF 정지로 방송이 자동 일시정지된다(의도된 동작).

## 검증 기록 (2026-08-06)

- 자체 점검 13/13 통과
- 화력쇼 이식: 숙련 플레이 180초 완주 179,949명 / 언락 2단계 / 정산·구독자 이월 정상.
  인간 반응(0.30초) 시뮬레이션에서 고배율 수습·대참사·연쇄 ×3.0 경로 전부 확인
- Giving Up On It: 실마우스 등반·추락 경제 확인. 추락 신선도 감쇠 실측
  (779 → 626 → 402 → 224 → 89) — 같은 낙차 반복이 실제로 물린다
- 게임 단위 신선도: 화력쇼 1회 방송 후 허브 카드 70% 표시 + 회복 안내 확인

**미검증**: Giving Up On It의 난이도·조작감은 전략 스윕을 거치지 않았다
(화력쇼는 `prototypes/05-hwaryeok-spec.md`의 critic 4차 승인본). 사람 손으로 만져봐야 한다.

## 새 게임 추가

`docs/contract.md` 4.5절. 셸과 다른 게임은 건드리지 않는다.
