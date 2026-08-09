# PAE (Persona Agent Ensemble) 설계 명세서
## 자가복제·이중분화형 게임 흥미도 평가 에이전트 시스템

**버전** v0.1 (설계 초안)
**대상** 범용 (1차 검증 대상: 덱빌더/카드퍼즐/로그라이크 계열 HTML 프로토타입)
**설계 원칙** 절대 점수를 신뢰하지 않는다. 상대 변화와 곡선 형태만을 산출물로 삼는다.

---

## 0. 설계 개요

### 0.1 시스템이 답해야 하는 질문

기존 플레이테스트가 답하는 질문은 "이 게임 재미있나요?"입니다. PAE가 답해야 하는 질문은 다릅니다.

> **"이 플레이 세션의 몇 번째 순간에, 어떤 성향의 플레이어의 흥미가, 왜 꺾이는가?"**

즉 산출물은 점수가 아니라 **페르소나별 시계열 곡선과 그 곡선의 병목 좌표**입니다.

### 0.2 세 가지 설계 제약 (리서치에서 도출)

| 제약 | 근거 | 설계 반영 |
|---|---|---|
| **C1. 절대 점수 금지** | Yannakakis 계열의 순서적(ordinal) 감정 연구 — 상대 라벨이 절대 척도보다 신뢰도 높음 | 모든 흥미도 출력은 `Δ ∈ {-3..+3}`의 순서적 변화량. 절대값은 누적으로만 생성 |
| **C2. 실력이 아닌 난이도 측정기** | Xiao & Yang (2024) — LLM은 인간 실력에 못 미치나 난이도 상관은 r=0.62~0.87 | 플레이어 페르소나의 승패·클리어율을 성과 지표로 쓰지 않음. 오직 콘텐츠 간 **상대 순위**에만 사용 |
| **C3. 관전자는 텔레메트리만 본다** | Melhart et al. (2020) — 40개 게임플레이 특징만으로 시청자 몰입 80% 예측 | 관전자 페르소나에 영상·스크린샷을 주지 않음. 구조화된 feature vector만 입력 |

### 0.3 이름 규약

- **Genome** — 페르소나의 축 값 집합 (유전자)
- **Individual** — Genome으로부터 생성된 페르소나 개체
- **Fork** — 하나의 Individual이 Player/Spectator 두 인스턴스로 분화한 것
- **Run** — 한 번의 플레이 세션 (플레이어 모드는 시뮬레이션, 관전자 모드는 실제 로그)
- **Trace** — Run에 대한 tick별 흥미도 라벨 시퀀스

---

## 1. 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│ L0  SEED GENOME                                             │
│     디자이너가 정의한 1개의 기준 페르소나 (6축 기본값)         │
└────────────────────────┬────────────────────────────────────┘
                         │ replicate()
┌────────────────────────▼────────────────────────────────────┐
│ L1  DIFFERENTIATION ENGINE                                  │
│     축 샘플링 → N개 Individual 생성                          │
│     · 직교성 보장 (축간 거리 최소 임계)                       │
│     · 극단 보존 (분포 꼬리 강제 샘플링)                       │
└────────────────────────┬────────────────────────────────────┘
                         │ fork()  ※ Genome 공유, 관측/출력만 분기
          ┌──────────────┴──────────────┐
┌─────────▼─────────┐          ┌────────▼──────────┐
│ L2a PLAYER FORK   │          │ L2b SPECTATOR FORK│
│  1인칭 경험자      │          │  3인칭 관전자      │
│  입력: StateFrame │          │  입력: TelemetryTick│
│  출력: 행동 + Δ    │          │  출력: Δ + 코멘트  │
│  메모리: 있음(RAG) │          │  메모리: 요약만     │
└─────────┬─────────┘          └────────┬──────────┘
          └──────────────┬──────────────┘
┌────────────────────────▼────────────────────────────────────┐
│ L3  INTEREST ENGINE                                         │
│     Δ 시퀀스 → 습관화 보정 → 누적 곡선 → 지표 추출            │
└────────────────────────┬────────────────────────────────────┘
┌────────────────────────▼────────────────────────────────────┐
│ L4  ORCHESTRATOR                                            │
│     편향보정(스왑·앙상블·N회 반복) → 축별 집계 → 리포트       │
└────────────────────────┬────────────────────────────────────┘
┌────────────────────────▼────────────────────────────────────┐
│ L5  VALIDATION                                              │
│     인간 RankTrace 곡선과 Spearman 상관 → 게이트 판정         │
└─────────────────────────────────────────────────────────────┘
```

**핵심 설계 결정: Fork는 Genome을 공유하고 관측 인터페이스만 다르다.**
같은 성향의 사람이 직접 플레이할 때와 남의 플레이를 볼 때 느끼는 흥미는 다르지만, **그 사람의 취향 자체는 같습니다.** 따라서 Genome(취향)은 복제하고 Perception Layer(관측)만 분기시킵니다. 이것이 "자가복제 후 분화"의 구체적 의미입니다.

---

## 2. 페르소나 게놈 (Genome) 명세

### 2.1 6축 정의

축 선택은 Yannakakis & Togelius의 taxonomy 중 **top-down(이론 주도)** 방식을 채택합니다. 데이터가 아직 없는 프로토타입 단계이기 때문이며, Holmgård et al.(2014)의 "소수의 디자이너 직관 기반 페르소나가 데이터 학습 clone만큼 인간 의사결정을 잘 포착한다"는 결과가 이를 지지합니다.

| 코드 | 축 | 0.0 극단 | 1.0 극단 | 이 축이 지배하는 흥미 |
|---|---|---|---|---|
| `CHL` | 도전 지향 | 안전한 진행 선호 | 고난도 추구 | 난이도 스파이크에서의 반응 부호 |
| `OPT` | 최적화 지향 | 감으로 플레이 | 빌드·수치 파고들기 | 시너지 발견 순간의 진폭 |
| `RSK` | 리스크 선호 | 확정 이득 선호 | 기댓값 도박 선호 | 확률 이벤트·강화 시스템 반응 |
| `NOV` | 신규성 갈망 | 반복에 강함 | 반복에 빠르게 질림 | 습관화 계수 α의 크기 |
| `PAT` | 인내심 | 짧은 세션 | 장기 누적 감내 | 후반 곡선 기울기 |
| `SOC` | 과시·공유 성향 | 혼자 즐김 | 남에게 보여주고 싶음 | 관전자 모드 가중치 |

> **설계 노트** — `SOC` 축은 Sjöblom & Hamari(2017)의 관전 동기 연구와 Som의 "플레이어가 스트리머, AI가 시청자" 컨셉을 잇는 축입니다. 이 축이 높은 Individual의 Spectator Fork는 "이 순간이 클립으로 잘릴 만한가"를 별도 평가합니다.

### 2.2 Genome 스키마

```json
{
  "genome_id": "G-004",
  "label": "최적화형 하드코어",
  "axes": {
    "CHL": 0.85,
    "OPT": 0.90,
    "RSK": 0.35,
    "NOV": 0.45,
    "PAT": 0.80,
    "SOC": 0.30
  },
  "derived": {
    "habituation_alpha": 0.18,
    "delta_sensitivity": 0.9,
    "session_tolerance_ticks": 400
  },
  "backstory": "덱빌더 200시간 이상. 첫 회차부터 시너지 탐색을 우선하며 운에 의존하는 승리를 성취로 치지 않는다.",
  "vocabulary": ["시너지", "덱 압축", "기댓값", "커브"],
  "seed_lineage": "G-000"
}
```

**derived 필드 산출식** (축에서 자동 계산, 하드코딩 금지):

```
habituation_alpha       = 0.05 + 0.30 × NOV        # 신규성 갈망이 높을수록 빨리 질림
delta_sensitivity       = 0.6 + 0.5 × (CHL+OPT)/2  # 성향이 강할수록 반응 진폭 큼
session_tolerance_ticks = 100 + 500 × PAT          # 인내심이 곧 세션 감내 길이
```

`backstory`와 `vocabulary`는 LLM 페르소나 일관성 유지용입니다. 축 값만 프롬프트에 넣으면 페르소나 드리프트가 빠르게 발생하므로, 서사와 어휘를 함께 고정합니다.

---

## 3. 자가복제·분화 프로토콜

### 3.1 replicate() — Seed에서 개체군으로

```python
def replicate(seed_genome, n=8):
    population = [seed_genome]
    while len(population) < n:
        candidate = perturb(seed_genome)          # 축별 가우시안 섭동
        if min_axis_distance(candidate, population) < 0.35:
            continue                               # 너무 비슷하면 폐기 (직교성 보장)
        population.append(candidate)
    population += forced_extremes(seed_genome)     # 축별 0.05 / 0.95 강제 개체
    return population
```

**`forced_extremes`가 필수인 이유** — Bisbee et al.(2024)이 지적한 silicon sampling의 최대 약점은 분포 꼬리(소수·극단 취향)의 체계적 과소대표입니다. LLM에게 자연스럽게 페르소나를 생성시키면 반드시 중앙값으로 수렴합니다. 따라서 각 축의 극단값을 **알고리즘적으로 강제 주입**해야 합니다.

권장 개체 수: **N=8 (탐색 단계) / N=16 (검증 단계)**. 그 이상은 토큰 비용 대비 한계효용이 급감합니다.

### 3.2 fork() — 이중 분화

```python
def fork(individual):
    return {
      "player":    PerceptionLayer(individual, mode="first_person"),
      "spectator": PerceptionLayer(individual, mode="third_person")
    }
```

| | Player Fork | Spectator Fork |
|---|---|---|
| 입력 | `StateFrame` (자연어 상태 + 선택지) | `TelemetryTick` (feature vector) |
| 출력 | `action` + `Δ` + 이유 | `Δ` + 관전 코멘트 + 클립성 판정 |
| 메모리 | 메모리 스트림 + 반성 (Park et al. 구조) | 직전 20 tick 롤링 요약만 |
| 흥미 발생 원천 | 자기 결정의 결과 | 타인 결정의 극적 편차 |
| Genome 축 가중 | CHL·OPT·RSK·PAT 강함 | NOV·SOC 강함 |

**왜 메모리 구조가 다른가** — 플레이어는 자기 빌드·자원·실패 기억이 다음 결정에 영향을 주므로 장기 메모리가 필요합니다. 관전자는 남의 런이므로 맥락은 짧게만 유지되고, 대신 "직전 대비 얼마나 극적인가"에 반응합니다. 이 비대칭은 실제 관전 경험의 구조와 일치합니다.

---

## 4. 관측 인터페이스 계층

### 4.1 PlayerStateFrame (플레이어 포크 입력)

게임 엔진이 매 의사결정 지점마다 생성해야 하는 구조체입니다.

```json
{
  "frame_id": "run003:t0042",
  "t": 42,
  "phase": "combat",
  "narrative": "3층 엘리트 '재의 파수꾼'. 내 HP 34/80, 방어도 0. 적은 다음 턴 18 피해 예고.",
  "resources": { "hp": 34, "max_hp": 80, "gold": 120, "energy": 3, "deck_size": 14 },
  "affordances": [
    {
      "id": "a1",
      "label": "연쇄 점화 (2코스트)",
      "expected": "화상 3중첩, 즉시 피해 없음",
      "uncertainty": 0.15
    },
    {
      "id": "a2",
      "label": "필사의 일격 (3코스트)",
      "expected": "22 피해, 다음 턴 카드 1장 덜 뽑음",
      "uncertainty": 0.05
    }
  ],
  "since_last": { "elapsed_ticks": 1, "events": ["엘리트 조우"] },
  "novelty_flags": ["first_encounter_this_run"],
  "run_context": { "run_id": "run003", "seed": "0xA31F", "ascension": 2 }
}
```

**필드별 설계 의도**

- `narrative` — LLM이 읽을 단일 문단. 여기에 숫자를 전부 나열하지 말 것. 사람이 화면을 보고 파악하는 수준의 정보만 담아야 관측 조건이 인간과 등가가 됩니다. (송재경 Open MMORPG의 "AI에게 별도 API를 주지 않는다" 원칙과 같은 발상)
- `uncertainty` — 결과 불확실성 0~1. 흥미도의 핵심 예측자이며, 특히 `RSK` 축이 높은 페르소나의 Δ에 직접 영향합니다.
- `novelty_flags` — 습관화 계수 계산의 입력. 이 플래그가 비어 있는 tick이 연속되면 `NOV` 높은 페르소나의 Δ가 급격히 음수로 갑니다.

### 4.2 SpectatorTelemetryTick (관전자 포크 입력)

실제 플레이 로그에서 feature extractor가 뽑아낸 벡터입니다. **원본 로그를 그대로 주지 않습니다.**

```json
{
  "t": 42,
  "window": [40, 42],
  "actor": "human_player_017",
  "features": {
    "action_density": 3.4,
    "decision_latency_ms": 4200,
    "resource_swing": 0.42,
    "hp_ratio": 0.075,
    "outcome_delta": { "hp": -18, "score": 340 },
    "combo_depth": 3,
    "retry_count": 1,
    "idle_ms": 0,
    "path_deviation": 0.61
  },
  "salient_events": ["near_death", "combo_x3", "rare_drop"],
  "uncertainty_est": 0.61,
  "clip_summary": "체력 6 남기고 역전"
}
```

### 4.3 Feature 카탈로그 (최소 구현 세트)

Melhart et al.(2020)이 PUBG에서 40개 특징을 사용한 것을 참고하되, 범용 최소 세트로 압축했습니다. **아래 12개는 장르 무관하게 계측 가능해야 합니다.**

| 범주 | Feature | 정의 | 흥미도와의 관계 |
|---|---|---|---|
| 행동 강도 | `action_density` | 윈도 내 입력 수 / 시간 | 낮으면 정체, 과도하면 피로 |
| | `decision_latency_ms` | 선택지 제시~입력 지연 | 중간값이 최적(고민의 증거) |
| | `idle_ms` | 무입력 구간 | 지루함의 강한 프록시 |
| 결과 변동 | `resource_swing` | 주요 자원 변화율 절대값 | 진폭이 곧 극적 긴장 |
| | `hp_ratio` | 생존 여유 | 낮을수록 near-miss 긴장 |
| | `outcome_delta` | tick 순변화 | 부호와 크기 모두 사용 |
| 숙련·표현 | `combo_depth` | 연쇄 성립 깊이 | 성취 스파이크 |
| | `path_deviation` | 최적해 대비 이탈도 | 높으면 실험적 플레이(관전 가치 ↑) |
| 반복성 | `retry_count` | 동일 구간 재시도 | 좌절 신호 (2회↑ 주의) |
| | `content_repeat_n` | 동일 콘텐츠 노출 횟수 | 습관화 입력 |
| 불확실성 | `uncertainty_est` | 결과 예측 엔트로피 | 흥미의 1차 동력 |
| 이벤트 | `salient_events[]` | 사전 정의 태그 집합 | 스파이크 원인 귀속용 |

> **구현 우선순위** — `idle_ms`, `retry_count`, `uncertainty_est`, `resource_swing` 4개만 있어도 1차 프로토타입은 돌아갑니다. 나머지는 점진 추가하십시오.

---

## 5. 흥미도 엔진 (Interest Engine)

### 5.1 순서적 라벨 (Ordinal Delta)

각 Fork는 매 tick마다 아래 구조체 하나만 출력합니다.

```json
{
  "t": 42,
  "delta": 2,
  "axis_attribution": ["RSK", "CHL"],
  "reason": "18 피해 예고 앞에서 확정 처치와 도박 사이의 선택이 생겼다",
  "confidence": 0.8
}
```

`delta ∈ {-3, -2, -1, 0, +1, +2, +3}` — 직전 tick 대비 흥미의 **변화량**입니다. 절대 수준을 묻지 않습니다.

`axis_attribution`이 중요한 이유: 나중에 "이 게임의 흥미는 주로 RSK 축에서 발생한다"는 진단이 가능해집니다. 이것이 곧 **타겟 유저 프로파일의 역산**입니다.

### 5.2 곡선 합성

```
I(0) = 0
I(t) = I(t-1) + delta(t) × sensitivity × h(t)

h(t) = exp( -alpha × repeat_count(content_id, t) )      # 습관화
sensitivity = genome.derived.delta_sensitivity
alpha       = genome.derived.habituation_alpha
```

**습관화 항 `h(t)`가 핵심 설계 요소입니다.** 같은 자극이 반복되면 동일한 `delta` 라벨이 나와도 실제 흥미 증가폭은 감쇠해야 합니다. 이것이 로그라이크·수집형·아이들 게임의 후반부 이탈을 재현하는 메커니즘이며, 도파민 시스템 설계 관점에서 "가변 보상이 왜 고정 보상보다 오래 가는가"를 곡선상에서 드러냅니다.

최종적으로 Run 단위 z-정규화를 적용합니다 (RankTrace의 unbounded 누적 후 정규화 방식).

```
I_norm(t) = (I(t) - mean(I)) / std(I)
```

### 5.3 곡선 지표 (Curve Metrics)

Schell의 interest curve 이론을 계산 가능한 지표로 번역한 것입니다.

| 지표 | 정의 | 해석 기준 |
|---|---|---|
| `hook_slope` | t∈[0, 0.1T] 구간 기울기 | 음수면 초반 훅 실패 (최우선 수정) |
| `valley_depth` | 최대 연속 하강 구간의 낙폭 | 1.5σ 이상이면 병목 확정 |
| `valley_span` | 그 구간의 tick 길이 | 전체의 10% 초과 시 심각 |
| `peak_density` | 국소 최대점 수 / T | 너무 낮으면 밋밋, 너무 높으면 피로 |
| `terminal_slope` | t∈[0.8T, T] 기울기 | 음수 지속 = 이탈 예측 |
| `axis_dominance` | axis_attribution 빈도 분포 | 최상위 축 = 실제 타겟 유저 |
| `fork_gap` | Player 곡선 − Spectator 곡선 | 큰 양수: 하기엔 재밌으나 보기엔 지루 |

> **`fork_gap`은 Som의 "플레이어=스트리머, AI=시청자" 컨셉에 직결되는 고유 지표입니다.** 이 값이 크게 음수인 구간은 "보는 게 더 재밌는 순간" — 즉 스트리밍 친화 콘텐츠입니다. 이 지표를 뽑는 시스템은 현재 문헌상 선례를 확인하지 못했으며, 본 설계의 독자적 기여 영역입니다.

---

## 6. 프롬프트 명세

### 6.1 Player Fork — 행동 및 자기보고

```
[SYSTEM]
너는 아래 성향을 가진 게임 플레이어다. 이 성향에서 절대 벗어나지 마라.

이름: {label}
배경: {backstory}
성향 (0~1):
- 도전 지향 {CHL} / 최적화 지향 {OPT} / 리스크 선호 {RSK}
- 신규성 갈망 {NOV} / 인내심 {PAT} / 과시 성향 {SOC}
자주 쓰는 말: {vocabulary}

규칙:
1. 최선의 수를 두려 하지 마라. 이 성향의 사람이 둘 법한 수를 둬라.
2. 흥미도는 절대 점수가 아니라 "직전 순간 대비 변화"로만 답하라.
3. 이유는 한 문장. 장황하게 쓰지 마라.

[STATE]
{narrative}
자원: {resources}
가능한 행동:
{affordances}
직전 이후 일어난 일: {since_last}

[MEMORY]
{retrieved_memories}   ← recency·importance·relevance 가중 상위 5건

[OUTPUT — JSON only]
{
  "action_id": "...",
  "delta": <-3..+3>,
  "axis_attribution": ["..."],
  "reason": "...",
  "confidence": <0..1>
}
```

### 6.2 Spectator Fork — 관전 평가

```
[SYSTEM]
너는 아래 성향을 가진 사람이며, 지금 다른 사람의 플레이를 지켜보고 있다.
직접 하는 게 아니라 보고 있다는 점을 명심하라.
보는 입장에서는 "내가 잘했다"는 성취감이 없다. 대신 극적인 편차, 예상 밖의 선택,
아슬아슬한 순간에서만 흥미가 생긴다.

성향: {axes}
배경: {backstory}

[TELEMETRY WINDOW]
구간: t={window}
관측된 지표:
{features}
눈에 띈 사건: {salient_events}
불확실성 추정: {uncertainty_est}

[ROLLING CONTEXT]
{last_20_tick_summary}

[OUTPUT — JSON only]
{
  "delta": <-3..+3>,
  "axis_attribution": ["..."],
  "reason": "...",
  "clip_worthy": <true|false>,
  "confidence": <0..1>
}
```

`clip_worthy`는 `SOC` 축이 0.5 이상인 개체에서만 수집합니다.

### 6.3 Reflection — 세션 종료 시 반성

Park et al.의 reflection 단계를 흥미도 진단용으로 특화한 것입니다.

```
[SYSTEM]
너는 방금 한 판을 끝낸 {label}이다.

[TRACE]
{tick별 delta 요약, 상위/하위 10개 구간}

[TASK]
1. 가장 지루했던 구간 3곳을 tick 범위로 지목하고, 왜 지루했는지 말하라.
2. 다시 한 판 더 할 의향이 있나? (yes/no)와 그 이유.
3. 이 게임을 친구에게 설명한다면 한 문장으로 뭐라 하겠나?

[OUTPUT — JSON only]
{ "boredom_spans": [[t,t],...], "replay_intent": bool,
  "replay_reason": "...", "one_line_pitch": "..." }
```

`replay_intent`는 리텐션 프록시로 사용합니다. 이것 역시 절대 신뢰하지 말고, **콘텐츠 A와 B 사이의 상대 비교**로만 쓰십시오.

### 6.4 Judge — 구간 쌍 비교 (편향 보정용)

절대 라벨의 신뢰도를 보강하기 위해, 무작위 tick 쌍에 대해 강제 선택 비교를 수행합니다.

```
[SYSTEM] 너는 {label}이다.
[TASK] 아래 두 구간 중 어느 쪽이 더 흥미로웠나? 반드시 하나를 골라라.
구간 A: {span_a}
구간 B: {span_b}
[OUTPUT] { "winner": "A"|"B", "margin": <1..3>, "reason": "..." }
```

**이 호출은 반드시 A/B 순서를 뒤집어 2회 실행하고, 결과가 뒤집히면 해당 쌍을 폐기합니다.** LLM-as-judge의 위치 편향은 프롬프트 문구로 교정되지 않으며, 스왑 메커니즘으로만 실질 완화됩니다.

---

## 7. 오케스트레이터

### 7.1 실행 루프

```python
def evaluate(game_adapter, seed_genome, n_individuals=8, n_repeats=3):
    population = replicate(seed_genome, n_individuals)
    results = []

    for ind in population:
        forks = fork(ind)

        # --- Player 경로: LLM이 직접 플레이 시뮬레이션 ---
        for r in range(n_repeats):
            trace_p = []
            state = game_adapter.reset(seed=rotate_seed(r))
            while not state.done and len(trace_p) < ind.session_tolerance_ticks:
                out = llm(forks["player"], state.to_frame())
                trace_p.append(out)
                state = game_adapter.step(out.action_id)
            reflection = llm_reflect(forks["player"], trace_p)
            results.append(Trace(ind, "player", r, trace_p, reflection))

        # --- Spectator 경로: 실제 인간 로그를 관전 ---
        for log in human_logs:
            trace_s = [llm(forks["spectator"], tick)
                       for tick in feature_extract(log)]
            results.append(Trace(ind, "spectator", log.id, trace_s))

    return aggregate(results)
```

### 7.2 편향 보정 3종 세트

| 보정 | 대상 편향 | 구현 |
|---|---|---|
| **반복-중앙값** | 샘플링 분산 | 동일 입력 `n_repeats=3` 실행 후 delta 중앙값 채택. 분산 > 1.5면 해당 tick `confidence` 강제 하향 |
| **순서 스왑** | 위치 편향 | Judge 호출 시 A/B 순서 반전 2회, 불일치 시 폐기 |
| **이종 모델 앙상블** | 자기선호 편향 | Player Fork와 Judge를 **서로 다른 계열 모델**로 배정. 같은 모델이 자기 플레이를 평가하지 않게 함 |

추가로 **길이 정규화** — `reason` 필드 길이가 delta 크기와 상관되지 않는지 주기적으로 점검하십시오. 상관이 유의하면 verbosity 편향이 발생 중입니다.

### 7.3 집계

```
축별 곡선 = 해당 축 상위 3개체의 I_norm(t) 평균
전체 곡선 = 전 개체 I_norm(t) 평균 (참고용, 의사결정 근거로 쓰지 말 것)
합의 병목 = 개체 60% 이상에서 valley로 판정된 tick 구간
분열 구간 = 개체 간 delta 부호가 갈리는 tick (= 취향 분기점, 설계상 가장 중요)
```

> **"분열 구간"이 전체 평균보다 훨씬 유용합니다.** 평균 곡선은 취향 차이를 지워버립니다. 어떤 구간에서 하드코어 개체는 +2, 캐주얼 개체는 −2를 냈다면, 그 구간은 "고칠 곳"이 아니라 **"타겟을 정해야 할 곳"**입니다.

---

## 8. 출력 리포트 스펙

```
## 1. 요약
- 최우선 병목: t=[128,164] (합의율 75%, valley_depth 2.1σ)
- 지배 축: OPT (귀속 41%) → 이 게임의 실질 타겟은 최적화형
- fork_gap 최대 구간: t=[210,232] (관전 우위 → 스트리밍 소재)

## 2. 곡선
[전체 / 축별 6개 / Player vs Spectator 오버레이]

## 3. 병목 카드 (구간별)
구간 t=[128,164]
  · 증상: 5개 개체 연속 음수 delta, idle_ms 급증
  · 귀속 축: NOV (신규성 고갈)
  · 페르소나 발언: "여기서부터 아까 본 적 조합이 계속 반복된다"
  · 가설: 3층 적 풀 다양성 부족
  · 검증 방법: 적 풀 +2종 추가 후 재측정, valley_depth 비교

## 4. 분열 구간 (타겟 결정 필요)
t=[88,96] — CHL 상위 개체 +2 / CHL 하위 개체 −2
  → 이 구간의 난이도를 어느 쪽에 맞출지 디자이너 결정 필요

## 5. 신뢰도
- 평균 confidence: 0.74
- 분산 초과로 하향된 tick: 12 / 340 (3.5%)
- 폐기된 Judge 쌍: 8 / 60 (13.3%)
- 인간 상관 (직전 검증): Spearman r = 0.58
```

---

## 9. 검증 프로토콜

### 9.1 절차

1. 인간 플레이테스터 **n ≥ 8** 모집 (동일 프로토타입, 동일 시드)
2. 플레이 후 PAGAN + RankTrace 방식으로 녹화 영상에 대한 연속 흥미도 주석 수집
   - 절대 척도 금지, 상대·무한계 연속 라벨링
3. 인간 평균 곡선 vs PAE 곡선의 **Spearman 순위 상관** 계산
4. 병목 구간 일치도: 인간이 지목한 valley와 PAE valley의 IoU

### 9.2 게이트 판정

| r 값 | 판정 | 조치 |
|---|---|---|
| r ≥ 0.60 | **합격** | 콘텐츠 우선순위 결정에 1차 근거로 사용 가능 |
| 0.40 ≤ r < 0.60 | **조건부** | 보조 지표로만 사용. 최종 판단은 인간 플레이테스트 |
| r < 0.40 | **불합격** | 축 정의 / 프롬프트 / feature 스키마 재설계 |

벤치마크 기준선은 Xiao & Yang(2024)의 r=0.62~0.87입니다. **0.6 도달은 현실적으로 달성 가능한 목표입니다.**

### 9.3 검증에서 반드시 확인할 것

- **소수 취향 재현 실패 여부** — 인간 표본 중 극단적 취향의 개인이 있었다면, 그 사람의 곡선을 PAE의 `forced_extremes` 개체가 재현하는가? 못 한다면 해당 세그먼트는 영구적으로 인간 검증을 유지해야 합니다.
- **한국 시장 특이 패턴** — 강화·확률 시스템에 대한 반응은 LLM 학습 데이터의 서구 중심 편향으로 왜곡될 수 있습니다. 갬블링 로그라이크 같은 프로젝트에서는 이 축(`RSK`)의 검증을 별도로 강화하십시오.

---

## 10. 구현 로드맵

### Phase 1 — Player Fork 단독 PoC (1~2주)

**대상**: 덱빌더/카드퍼즐 HTML 프로토타입 1종 (텍스트 직렬화가 가장 쉬운 장르)

- [ ] 게임에 `StateFrame` 출력 어댑터 추가
- [ ] Genome 스키마 + seed 1개 수기 작성
- [ ] Player 프롬프트 구현, 단일 페르소나로 3런 실행
- [ ] delta 시퀀스 → 곡선 렌더링 (습관화 항 없이 단순 누적부터)
- [ ] 곡선을 눈으로 보고 디자이너 직관과 대조

**전환 기준**: 곡선의 병목 위치가 디자이너가 이미 알고 있던 약점과 질적으로 일치하면 Phase 2로.

### Phase 2 — 분화 + Spectator (2~6주)

- [ ] `replicate()` 구현, N=8 개체군 생성 (극단 강제 포함)
- [ ] feature extractor 구현 (최소 4개 feature)
- [ ] Spectator Fork + 내부 QA 로그 연결
- [ ] 습관화 계수 도입, `fork_gap` 산출
- [ ] 편향 보정 3종 세트 적용

**전환 기준**: 개체 간 곡선이 축에 따라 유의하게 갈리고(분열 구간이 실제로 검출됨), 반복 실행 분산이 허용 범위 내면 Phase 3으로.

### Phase 3 — 검증 및 운용 (6주~)

- [ ] 인간 플레이테스트 n≥8, RankTrace 주석 수집
- [ ] Spearman 상관 산출, 게이트 판정
- [ ] 게이트 통과 시 리포트 자동 생성 파이프라인 상시화

### 저장소 구조 (권장)

```
pae/
├── genome/
│   ├── schema.json
│   ├── seeds/            # 디자이너 작성 seed genome
│   └── replicate.py
├── perception/
│   ├── state_frame.py    # Player 입력 어댑터 규약
│   ├── telemetry.py      # Spectator feature extractor
│   └── adapters/         # 게임별 구현
│       └── deckbuilder_v1.py
├── forks/
│   ├── player.py
│   ├── spectator.py
│   └── prompts/          # 프롬프트 템플릿 (버전 관리 필수)
├── engine/
│   ├── interest_curve.py # 습관화·정규화·지표
│   └── metrics.py
├── orchestrator/
│   ├── runner.py
│   ├── debias.py
│   └── aggregate.py
├── validation/
│   ├── human_import.py   # PAGAN/RankTrace 결과 임포트
│   └── correlate.py
└── reports/
```

**프롬프트 버전 관리를 반드시 하십시오.** 프롬프트 한 줄 수정이 곡선 전체를 바꿉니다. 검증 결과는 항상 프롬프트 커밋 해시와 함께 기록해야 합니다.

---

## 11. 미해결 설계 결정 및 리스크

### 11.1 디자이너가 결정해야 할 것

1. **Player Fork의 게임 접근 방식** — LLM이 실제 게임 로직과 API로 상호작용할 것인가(정확하지만 어댑터 구현 비용), 아니면 게임 규칙을 프롬프트로 주고 순수 시뮬레이션할 것인가(싸지만 규칙 위반 발생)? **권장: 실제 로직 연결.** 시뮬레이션은 존재하지 않는 카드를 만들어내는 실패가 반드시 발생합니다.

2. **tick 단위** — 턴제는 턴 단위가 자연스럽지만, 하이퍼캐주얼 액션은 초 단위 윈도가 필요합니다. 장르별로 다르게 정의하되, 한 프로젝트 안에서는 고정하십시오.

3. **개체 수 대비 반복 수** — 토큰 예산이 고정이라면 `N=8 × 반복3`과 `N=16 × 반복1` 중 선택해야 합니다. **권장: 전자.** 반복 없는 단발 라벨은 분산이 커서 신뢰할 수 없습니다.

### 11.2 알려진 한계

- **비전 의존 게임에는 Player Fork가 부적합** — BALROG는 현 모델이 시각적 의사결정에서 크게 고전하며 일부는 이미지 제공 시 오히려 성능이 하락한다고 보고합니다. 순수 그래픽·타이밍 게임은 Spectator 경로(텔레메트리)만 사용하십시오.
- **통합 아키텍처 자체는 미검증** — "관전자와 플레이어로 자가분화하는 단일 페르소나 에이전트"를 정면으로 다룬 선행 연구는 확인되지 않았습니다. 본 설계는 검증된 구성요소(Melhart의 관전 예측 / Holmgård의 절차적 페르소나 / Park의 메모리·반성 / Yannakakis의 순서적 라벨)의 조합이며, **통합 검증은 Som이 수행해야 할 신규 기여 영역**입니다. 이는 리스크인 동시에 이 프로젝트가 논문·발표 소재로서 갖는 가치이기도 합니다.
- **절대 신뢰 금지 원칙의 실무적 함의** — PAE는 "이 게임이 몇 점인가"에 답하지 않습니다. "A안과 B안 중 어느 쪽 곡선이 나은가", "몇 번째 구간이 병목인가"에만 답합니다. 이 경계를 넘어서 쓰기 시작하면 시스템 전체의 신뢰도가 붕괴합니다.
