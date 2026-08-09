/* 반응 도감·캐스트 해금 데이터 — 소유: 기획(소윤). 스키마는 docs/contract.md 7절, 결정은 ADR-006.
 *
 * 형식: JSON 리터럴 .js 캐리어 (ADR-002) — validate가 JSON.parse + 칸 도달 가능성을 검사한다.
 *
 * 칸 = (개체, 이벤트). 시뮬 레이어 v0.2 §5.1의 (개체, 태그)에서 태그 자리를 임시로 이벤트
 * 이름이 맡는다 — 36태그 데이터(viewer_personas_100_v02.json)가 레포에 착지하면 태그로
 * 승격하고 이 파일은 스키마 그대로 값만 바뀐다 (ADR-006).
 *
 * base_triggers = 기본 캐스트 8종의 반응 칸 (시트 1장의 정체성 기반).
 * unlocks = 해금 대기 캐스트 — 시트 4.2 신규 후보 6종. cost.subs = 구독자(시청자 파생) 소비,
 *           cost.coins = 코인(도네 파생) 소비. 전부 "선택지 개방"만 — 능력 강화 금지 (§8.4).
 * triggers/repellents 값은 전 게임 이벤트 이름 — 없는 이름을 쓰면 영원히 침묵하는 칸이라
 * validate가 실패시킨다 (v0.2 §11.3 필수 검사).
 */
window.JONG_DEX = {
  "base_triggers": {
    "불멍장인":     ["accident", "oilfire", "disaster", "boom", "fall_big", "wipe"],
    "안전제일":     ["oilfire", "near_death", "tension_edge", "timeout_boom", "clutch", "nag"],
    "10년차주방장": ["unlock", "scan_reveal", "advantage", "safe_spam", "milestone", "chain_up"],
    "오늘첫방문":   ["start", "new_bomb", "new_foe", "cast", "climb", "hook"],
    "ㅋㅋ자판기":   ["disaster", "wipe", "miss", "fail", "trash", "strike_miss"],
    "냉정한미식가": ["rescue_big", "defused_clutch", "land_legend", "crit", "done", "summit"],
    "응원봉":       ["rescue", "summit", "defused", "enemy_ko", "land_big", "comeback"],
    "길가던행인":   ["idle", "nag", "stuck", "donation", "milestone", "escape"]
  },
  "unlocks": [
    { "nick": "유목민", "color": "#d0b8f0", "tones": ["question", "mock"], "arch": "casual",
      "cost": { "subs": 15 },
      "triggers": ["start", "idle", "nag", "stuck"], "repellents": ["milestone"],
      "desc": "타 방송과 비교하며 넘나든다 — 늘어지는 순간을 가장 먼저 알아챈다" },
    { "nick": "밈제조기", "color": "#ffe66d", "tones": ["hype", "mock"], "arch": "thrill",
      "cost": { "subs": 25 },
      "triggers": ["disaster", "fall_legend", "boom", "wipe", "line_snap"], "repellents": ["done"],
      "desc": "방송 사건을 유행어로 만든다 — 대참사가 그의 원료다" },
    { "nick": "안티", "color": "#ff6b6b", "tones": ["mock", "info"], "arch": "thrill",
      "cost": { "subs": 40 },
      "triggers": ["fail", "miss", "faint", "escape", "timeout_boom"], "repellents": ["rescue_big", "summit"],
      "desc": "응원봉의 대립쌍. 잘해도 꼬투리 — 야유도 트래픽이다" },
    { "nick": "큰손", "color": "#ffcf4d", "tones": ["cheer", "hype"], "arch": "fan",
      "cost": { "coins": 5000 },
      "triggers": ["donation", "milestone", "summit"], "repellents": [],
      "desc": "익명 도네의 인격화 — 큰 도네가 방송 목표를 흔든다" },
    { "nick": "매니저", "color": "#7de8a0", "tones": ["info", "cheer"], "arch": "fan",
      "cost": { "subs": 60 },
      "triggers": ["start", "end", "milestone", "revive"], "repellents": ["nag"],
      "desc": "채팅의 질서 축 — 안티를 견제하고 뉴비를 안내한다" },
    { "nick": "잠수함", "color": "#8a9bb8", "tones": ["info"], "arch": "expert",
      "cost": { "subs": 90 },
      "triggers": ["summit", "fall_legend", "disaster", "comeback", "defused_clutch", "land_legend"],
      "repellents": [],
      "desc": "평소 눈팅만 하다 결정적 순간에만 한 줄 — 그 한 줄의 무게" }
  ]
};
