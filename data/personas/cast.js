/* AI 시청자 페르소나 캐스트 — 소유: 기획(소윤). 값 저작은 여기서, 스키마는 docs/contract.md 2절.
 *
 * 형식: JSON 리터럴을 담은 .js 캐리어 (file:// 제약 — ADR-002). 대입문 우변은 반드시
 * 엄격한 JSON이어야 한다 (쌍따옴표·후행 콤마 금지) — tools/validate.mjs가 JSON.parse로 검사한다.
 *
 * 규칙 (data/personas/CLAUDE.md):
 *   tones = contract.md 3절 공인 6종(hype/worry/info/mock/cheer/question)의 부분집합.
 *   arch  = 소속 경제 원형 (공명 판정층 ADR-004 §7.2 다대일 매핑 — thrill/fan/expert/casual).
 *           발화 캐스팅 가중치에만 쓰인다. 페르소나가 경제를 움직이는 게 아니라,
 *           경제(관객 구성)가 누가 말할지를 정하는 단방향이다 (C3 유지).
 *   신규 페르소나는 3축 덮개(위험 선호/정보 깊이/애정 온도) 자리를 시트에 명시할 것 —
 *   설계 시트 원본은 prototypes/05-hwaryeok-personas.md.
 */
window.JONG_CAST = [
  { "nick": "불멍장인",     "color": "#ff8d5a", "tones": ["hype", "mock"], "arch": "thrill" },
  { "nick": "안전제일",     "color": "#7fd4ff", "tones": ["worry", "question"], "arch": "fan" },
  { "nick": "10년차주방장", "color": "#ffd27a", "tones": ["info", "mock"], "arch": "expert" },
  { "nick": "오늘첫방문",   "color": "#b8f5c4", "tones": ["question", "cheer"], "arch": "casual" },
  { "nick": "ㅋㅋ자판기",   "color": "#f0a8ff", "tones": ["hype", "mock"], "arch": "thrill" },
  { "nick": "냉정한미식가", "color": "#c9c4ba", "tones": ["mock", "info"], "arch": "expert" },
  { "nick": "응원봉",       "color": "#ffb0c8", "tones": ["cheer", "hype"], "arch": "fan" },
  { "nick": "길가던행인",   "color": "#a8c8f0", "tones": ["question", "worry", "cheer"], "arch": "casual" }
];
