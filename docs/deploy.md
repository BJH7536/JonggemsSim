# 배포 — GitHub Pages

소유: 현재(무대). 제출물 1번 *"웹 빌드: GitHub Pages 등으로 배포하여, 링크 클릭만으로
브라우저에서 바로 플레이"* (`nan2026-requirements.md`)를 만족시키는 경로다.

## 파이프라인

**빌드 단계가 없다.** 바닐라 HTML/JS/캔버스라 저장소의 파일이 곧 배포물이다.

```
main 브랜치 push  →  GitHub Pages(branch: main, path: /)  →  https://bjh7536.github.io/JonggemsSim/
```

번들러도 Actions 워크플로도 두지 않았다. 정적 파일 8개를 옮기는 데 CI를 끼우면
심사 기간에 고장날 지점만 하나 늘어난다. 필요해지면 그때 넣는다.

- `.nojekyll` — Jekyll 처리를 끈다. 지금은 문제될 파일이 없지만 밑줄로 시작하는 경로가
  하나만 생겨도 조용히 404가 되는 종류의 사고를 미리 막는다.
- 전 경로가 **상대 경로**다. Pages는 `/JonggemsSim/` 서브경로로 서빙하므로 절대 경로(`/games/...`)를
  쓰면 즉시 깨진다. 서브경로 서빙은 실측으로 확인했다 (8개 요청 전부 200).

## 최초 1회 설정 (레포 owner만 가능)

에이전트·협업자 계정은 `admin` 권한이 없어 Pages API가 404다. **owner(BJH7536)가** 해야 한다.

> Settings → Pages → Build and deployment → Source: **Deploy from a branch**
> → Branch: **main** / **/ (root)** → Save

1~2분 뒤 `https://bjh7536.github.io/JonggemsSim/` 가 뜬다.
심사 종료 시점까지 접근 가능한 상태로 유지해야 한다 (제출 유의사항).

## 로드 예산

심사위원이 링크를 열면 3초 안에 플레이가 시작되어야 한다. 현재:

| 항목 | 값 |
|---|---|
| 배포 파일 | 8개 |
| 원본 | 105KB |
| gzip (Pages 기본 적용) | **33KB** |
| DOMContentLoaded (로컬) | 75ms |
| load (로컬) | 100ms |
| 외부 요청 | **0건** (폰트·CDN·이미지·오디오 전부 없음) |

오디오는 전부 `AudioContext` 합성음이고 그래픽은 전부 캔버스 벡터다. 그래서 에셋이 0바이트다.
이건 우연이 아니라 유지할 성질이다 — 외부 에셋이 0이면 라이선스 기재 부담도 0이고
(제출물 4번), 로드도 사실상 즉시다.

**가드**: `games/shell/selftest.html`이 배포 파일 합계를 재서 250KB를 넘으면 실패한다.
`Assets/`(12MB 스테이징)를 배포물이 참조하는지도 함께 검사한다.

## 배포 전 점검

1. `games/shell/selftest.html` — 전부 `ok`
2. 서브경로 확인: 상위 디렉터리에서 `python -m http.server` 후 `/JonggemsSim/` 로 접속
3. 허브 → 게임 2종 각각 방송 → 정산 → 허브 복귀
4. 브라우저 콘솔 에러 0건

## 알려진 제약

- 탭이 백그라운드로 가면 rAF 정지로 방송이 자동 일시정지된다 (의도된 동작).
  시연 영상 촬영 시 탭을 활성 상태로 둘 것.
- 모바일에서 Giving Up On It은 터치 드래그로 조작된다. 화력쇼는 버튼이라 문제없다.
  다만 세로 화면은 좁아 권장하지 않는다.
