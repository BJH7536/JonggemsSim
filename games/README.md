# games/ — 무대 (현재)

방송 셸(게임 선택·방송 루프·정산), 시청자 경제(수 증감·언락·게임 단위 신선도 — 규약 1·4),
게임↔셸 인터페이스, 개별 게임, 배포.

## 구조

```
/index.html               GitHub Pages 진입점 — 링크 클릭 즉시 플레이 (NAN 2026 제출물 1번)
games/shell/shell.js      셸: 허브(방송 준비)·시청자 경제·신선도·공명 판정층·방송 루프·리포트  ← 계약 구현
games/shell/chat.js       AI 시청자 채팅 엔진 — 검증 게이트 (임시 거처, engine/ 이관 예정)
games/shell/llm.js        LLM 어댑터 — proxy/ 경유 실제 LLM 발화 (임시 거처, 위와 동일)
games/shell/config.js     배포 설정 — PROXY_URL 한 칸 (proxy/README.md 절차로 채움)
games/shell/faces/        스트리머 캠 표정 7종 (팀 자작 — Assets/*/SOURCES.md 승인 기록)
games/shell/shell.css     플랫폼 크롬(보라) + 무대(앰버) + 게임 조작 UI
games/shell/selftest.html 자체 점검 — 규약 4 회전·채팅 게이트·게임 계약·지형 기하·payload 예산
games/hwaryeok/           ① 화력쇼 — 프로토타입 이식 (critic 4차 승인 밸런스 보존)
games/giving-up/          ② Giving Up On It — 등반, 조작감 3차 (지형은 selftest가 기하 검증)
games/pocket/             ③ 주머니 괴수 — 턴제 연승전, "훈수" 장르 증명
proxy/                    LLM 프록시 (Vercel) — 설계·배포 절차는 proxy/README.md
```

게임↔셸 계약의 **규범 문서는 `docs/contract.md` 4절**이다. 코드와 어긋나면 문서가 맞다.

## 실행

브라우저로 `index.html`을 직접 열거나 (외부 의존성·네트워크 0건, `file://` 동작),
`python -m http.server 8770` 후 `http://127.0.0.1:8770/`.
`PROXY_URL`이 비어 있으면 AI 시청자는 오프라인 규칙 기반 — 이것도 완전한 모드다.

자체 점검: `games/shell/selftest.html` — 전부 `ok`여야 한다 (2026-08-08 현재 56개).
탭이 백그라운드로 가면 rAF 정지로 방송이 자동 일시정지된다(의도된 동작).

## 게임 3종의 리듬 설계

| 게임 | 리듬 | 채팅의 주연 톤 | 공통 명제의 구현 |
|---|---|---|---|
| 화력쇼 | 초 단위 반사 | hype (환호) | 무사고 완성 +40 ≪ 수습 ≪ 대참사 +1,400 |
| Giving Up On It | 느린 긴장 → 대추락 | mock (조롱) | 등반 1m ≪ 40m 추락 +33,000 |
| 주머니 괴수 | 턴제 수읽기 | info (훈수) | 안정타 ≪ 필살기(38%) ≪ 빈사 역전 KO |

셋 다 **안전한 플레이가 최악의 전략**이고, 규약 4가 세 층으로 돈다:
게임 단위(셸) · 사고 유형/추락/기술 단위(게임) · 안정타 스팸은 채팅이 지적(safe_spam).

## 검증 기록 (2026-08-07, 3차)

- selftest **36/36** — 지형 기하 검증이 실제 결함 2건(사거리 밖 발판·루트 침범 바위)을
  잡아 수정. GUOI "서 있을 때 반복 착지음"은 접촉 중 airVy 상시 0으로 재발화 불가 확인
- 주머니 괴수: 도박 봇 180초 완주 10,133명 — comeback 3·wipe 5·revive 5·disadvantage
  훈수 10 등 이벤트 17종 전 경로 발화, 콘솔 에러 0
- 방송 리포트: 시청자 추이 그래프(피크 마커)·신선도 교차 추천(45% → "화력쇼 틀면 회복")
  실렌더 확인. 허브·톱바·캠 실구동 확인
- **미검증**: GUOI·주머니 괴수 밸런스는 화력쇼급 스윕 전 (데모 조율값). LLM 경로는
  프록시 배포 후 실측 필요 (Vercel 로그인은 사람 몫 — proxy/README.md 4절)

## 새 게임 추가

`docs/contract.md` 4.5절. 셸과 다른 게임은 건드리지 않는다.
캠 표정은 기존 이벤트 이름을 재사용하면 공짜로 따라온다 (shell.js `CAM_MOOD`).
