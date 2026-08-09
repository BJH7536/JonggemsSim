/* 게임 이벤트 → 36태그 매핑 — 시뮬 레이어 v0.2 §6.2의 실장 초안. ADR-002 JSON 캐리어.
 *
 * 소유: 스키마 = 관객(정훈) / 값 = 기획(소윤) — 이 초안은 v0.2 §6.2 표 + fishing·bomb
 * 확장분(무대 작성)이며 **§11.2-2 미결: 팀 확정 전**이다. 태그 어휘의 정본은
 * data/personas/viewer_personas_100_v02.json (소윤, 36태그) — 여기 없는 태그를 쓰면 안 된다.
 *
 * 용도: 반응 도감(ADR-006)의 "칸 = (개체, 이벤트)"를 v0.2 원안 "칸 = (개체, 태그)"로
 * 승격할 때의 다리. 판정층이 이벤트를 관측하면 이 표로 태그를 얻고, 개체의
 * triggers/repellents와 결정론 대조한다 (§5.3 — 발화 성공 여부와 무관, C3b).
 *
 * 도달 가능성 (§11.3 필수 검사, 2026-08-09 실측 — tools 검증 스크립트로 재현 가능):
 *   - 아래 매핑만으로: 100종 중 92 도달, 불멸 관측자 12/12, 사분면 Q1 21/25 · Q2 24/25 ·
 *     Q3 22/25 · Q4 25/25
 *   - 스트리머 표현축 v1 5태그(scream/joy/selfmock/silence/fatigue, §6.4) 추가 시: 99/100
 *   - V-049(속도주행측정, Q2)의 침묵은 record_pace로 해소 — 신기록 페이스는 셸(채널 기록
 *     소유자)이 직접 관측해 방송당 1회 발행한다 (dex.js DIRECT, shell.js paceTag). 이로써
 *     100종 전원이 도달 가능 (V-049는 영입 확장 시, 관측단 V-034·V-044는 즉시).
 *
 * 매핑에 없는 이벤트(start·end·donation·nag 등)는 판정층이 조용히 무시한다 — 도네·시작은
 * 태그 축이 아니라 별도 경제/연출 경로다 (§8.2는 후속).
 */
window.JONG_TAGMAP = {
  "hwaryeok": {
    "accident": ["rng_disaster"],
    "oilfire": ["greed_punished"],
    "rescue": ["skill_comeback"],
    "rescue_big": ["improbable_survival"],
    "fail": ["misclick"],
    "disaster": ["catastrophic_fail"],
    "done": ["clean_execution"],
    "unlock": ["longplan_paid"],
    "milestone": ["numbers_revealed"],
    "chain3": ["synergy_found"],
    "idle": ["idle", "no_stakes"]
  },
  "giving-up": {
    "climb": ["retry_success"],
    "fall": ["misclick"],
    "fall_big": ["greed_punished"],
    "fall_legend": ["catastrophic_fail"],
    "clutch": ["improbable_survival"],
    "stuck": ["no_stakes"],
    "summit": ["longplan_paid"],
    "milestone": ["numbers_revealed"],
    "idle": ["idle"]
  },
  "pocket": {
    "risky_hit": ["rng_jackpot"],
    "ultra_hit": ["rng_jackpot"],
    "crit": ["rng_jackpot"],
    "miss": ["rng_disaster"],
    "enemy_ko": ["clean_execution"],
    "comeback": ["skill_comeback", "improbable_survival"],
    "faint": ["sudden_death"],
    "wipe": ["total_wipe", "catastrophic_fail"],
    "revive": ["state_flip"],
    "advantage": ["synergy_found"],
    "safe_spam": ["no_stakes"],
    "milestone": ["numbers_revealed"],
    "idle": ["idle"]
  },
  "fishing": {
    "cast": ["retry_success"],
    "land_mid": ["clean_execution"],
    "land_big": ["longplan_paid"],
    "land_legend": ["rng_jackpot"],
    "line_snap": ["greed_punished"],
    "escape": ["rng_disaster"],
    "strike_miss": ["misclick"],
    "trash": ["absurd_outcome"],
    "milestone": ["numbers_revealed"],
    "idle": ["idle"]
  },
  "bomb": {
    "boom": ["catastrophic_fail"],
    "timeout_boom": ["sudden_death"],
    "cut_paid": ["meta_choice"],
    "scan_reveal": ["numbers_revealed"],
    "defused": ["clean_execution"],
    "defused_clutch": ["improbable_survival"],
    "chain_up": ["synergy_found"],
    "milestone": ["numbers_revealed"],
    "idle": ["idle"]
  }
};
