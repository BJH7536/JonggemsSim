/* 반응 도감·캐스트 해금 데이터 — 소유: 기획(소윤). 스키마는 docs/contract.md 7절, 결정은 ADR-006.
 *
 * 형식: JSON 리터럴 .js 캐리어 (ADR-002) — validate가 JSON.parse + 칸 도달 가능성을 검사한다.
 *
 * 칸 = (개체, 태그). 2026-08-09 태그 승격 — 36태그 데이터(viewer_personas_100_v02.json)가
 * 레포에 착지해 ADR-006이 예고한 승격을 실행했다. 이벤트 이름 → 태그 번역은
 * data/events/tagmap.js가 맡는다 (판정 시 이벤트를 태그로 바꿔 대조).
 *
 * base_triggers = 기본 캐스트 8종의 반응 칸 (시트 1장의 정체성 기반, 태그 초안 — 소윤 검토 대상).
 * unlocks = 해금 대기 캐스트 — 시트 4.2 신규 후보 6종. cost.subs = 구독자(시청자 파생) 소비,
 *           cost.coins = 코인(도네 파생) 소비. 전부 "선택지 개방"만 — 능력 강화 금지 (§8.4).
 * triggers/repellents 값은 36태그 — tagmap에서 도달 가능한 태그만 (validate가 검사, v0.2 §11.3).
 */
window.JONG_DEX = {
  "base_triggers": {
    "불멍장인":     ["catastrophic_fail", "rng_disaster", "greed_punished", "total_wipe"],
    "안전제일":     ["sudden_death", "greed_punished", "improbable_survival", "misclick"],
    "10년차주방장": ["clean_execution", "synergy_found", "meta_choice", "longplan_paid"],
    "오늘첫방문":   ["numbers_revealed", "state_flip", "absurd_outcome"],
    "ㅋㅋ자판기":   ["misclick", "absurd_outcome", "catastrophic_fail", "rng_disaster"],
    "냉정한미식가": ["clean_execution", "improbable_survival", "skill_comeback", "longplan_paid"],
    "응원봉":       ["skill_comeback", "retry_success", "improbable_survival", "clean_execution"],
    "길가던행인":   ["idle", "no_stakes", "numbers_revealed"]
  },
  "unlocks": [
    { "nick": "유목민", "color": "#d0b8f0", "tones": ["question", "mock"], "arch": "casual",
      "cost": { "subs": 15 },
      "triggers": ["idle", "no_stakes"], "repellents": ["numbers_revealed"],
      "desc": "타 방송과 비교하며 넘나든다 — 늘어지는 순간을 가장 먼저 알아챈다" },
    { "nick": "밈제조기", "color": "#ffe66d", "tones": ["hype", "mock"], "arch": "thrill",
      "cost": { "subs": 25 },
      "triggers": ["catastrophic_fail", "total_wipe", "absurd_outcome", "greed_punished"], "repellents": ["clean_execution"],
      "desc": "방송 사건을 유행어로 만든다 — 대참사가 그의 원료다" },
    { "nick": "안티", "color": "#ff6b6b", "tones": ["mock", "info"], "arch": "thrill",
      "cost": { "subs": 40 },
      "triggers": ["misclick", "rng_disaster", "sudden_death"], "repellents": ["improbable_survival", "longplan_paid"],
      "desc": "응원봉의 대립쌍. 잘해도 꼬투리 — 야유도 트래픽이다" },
    { "nick": "큰손", "color": "#ffcf4d", "tones": ["cheer", "hype"], "arch": "fan",
      "cost": { "coins": 5000 },
      "triggers": ["numbers_revealed", "longplan_paid", "rng_jackpot"], "repellents": [],
      "desc": "익명 도네의 인격화 — 큰 도네가 방송 목표를 흔든다" },
    { "nick": "매니저", "color": "#7de8a0", "tones": ["info", "cheer"], "arch": "fan",
      "cost": { "subs": 60 },
      "triggers": ["state_flip", "numbers_revealed", "retry_success"], "repellents": ["idle"],
      "desc": "채팅의 질서 축 — 안티를 견제하고 뉴비를 안내한다" },
    { "nick": "잠수함", "color": "#8a9bb8", "tones": ["info"], "arch": "expert",
      "cost": { "subs": 90 },
      "triggers": ["catastrophic_fail", "improbable_survival", "skill_comeback", "rng_jackpot"],
      "repellents": [],
      "desc": "평소 눈팅만 하다 결정적 순간에만 한 줄 — 그 한 줄의 무게" }
  ]
};
