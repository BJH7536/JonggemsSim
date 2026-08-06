# Assets/ — 반입 에셋 스테이징

기존 Unity 프로젝트 두 개에서 종겜스에 쓸 만한 소재를 골라 옮겨 둔 곳이다.
**아직 게임에 연결되어 있지 않다.** 여기 있는 것은 후보이지 채택분이 아니다.

| 폴더 | 원본 | 목록 |
|---|---|---|
| `ThowSword_Assets/` | `C:\stopresent\Unity\TheSword\Assets\@Resources` | [SOURCES.md](ThowSword_Assets/SOURCES.md) |
| `RE001_Assets/` | `C:\stopresent\Unity\RE001\Assets\@Resources` | [SOURCES.md](RE001_Assets/SOURCES.md) |

## 왜 커밋되지 않는가 (`.gitignore`)

이 폴더의 **바이너리는 기본적으로 커밋하지 않는다.** 목록(`SOURCES.md`)과 이 문서만 올린다.

이유 두 가지다.

1. **라이선스.** 두 원본 프로젝트 모두 유료 에셋스토어 팩이 섞여 있다 —
   TheSword의 `Retro Arsenal`(유료 SFX 팩), RE001의 `IMPORTS/25 Pixel Sprite effects`·
   `DamageNumbersPro`·`DarkFantasyGUI` 등. 파일명만으로 원 소재가 자작인지 팩인지
   갈라지지 않는 것들이 있다(예: `PixelForestSummer_FullHD_layer01.png`은 팩 파일명 그대로다).
   NAN 2026은 **외부 에셋 출처·라이선스 명시를 의무화**하고 무단 도용 시 선발을 취소하며
   (`docs/nan2026-requirements.md`), 이 레포는 **public**이라 커밋 = 재배포다.
   에셋스토어 표준 EULA는 원본 파일이 추출 가능한 형태의 재배포를 금지한다.
2. **로드 예산.** 원본 그대로는 12MB다. 심사 요건이 "링크 클릭 즉시 플레이"이고
   현재 빌드는 코드 전체가 100KB 미만이다. 12MB를 그냥 얹으면 이 강점을 스스로 버린다.

## 해제 절차

원 소재의 라이선스를 확인해 **재배포·상업적 이용이 가능한 것만** 골랐다면:

1. `.gitignore`의 `Assets/**` 예외에 해당 경로를 추가한다
   (예: `!Assets/ThowSword_Assets/faces-96/`)
2. 그 항목을 `SOURCES.md`에서 `판정: 확인 완료 — <라이선스>`로 고친다
3. **AI 활용 기술 문서(제출물 4번)의 "외부 에셋 / 오픈소스 출처"에 그대로 옮긴다.** 필수다.

## 이미 웹용으로 가공해 둔 것

`ThowSword_Assets/faces-96/` — 감정 일러스트 17종을 잘라 96×96 아바타로 만든 것.
원본은 1500×1500 다중 프레임 시트(5.4MB)라 그대로는 못 쓴다. 알파 투영으로 프레임을
나누고 내용이 가장 많은 칸(= 연출이 완성된 마지막 프레임)만 뽑아 정사각 패딩 후 축소했다.
**17개 201KB — 원본의 3.6%**. 로드 예산 안에 들어온다.

용도 후보: AI 시청자 채팅의 리액션 이모트, 또는 대형 이벤트(대참사·정상 등반) 팝업.
페르소나 아바타로는 부적합하다 — 8명이 필요한데 캐릭터가 2종뿐이라 같은 얼굴이 겹친다.
채택 여부는 라이선스 확인과 소윤·정훈 협의 후에.

재생성: 스크립트는 커밋하지 않았다. 필요하면 `SOURCES.md`의 원본 경로에서 다시 뽑으면 된다.
