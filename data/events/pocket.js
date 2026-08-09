/* 주머니 괴수 — AI 시청자 이벤트 어휘.
 *
 * 이 게임의 존재 이유는 "훈수"다. 턴제는 관객이 수를 같이 읽는 장르라
 * info/mock 톤이 처음으로 주연이 된다 — 화력쇼(환호)·GUOI(조롱)와 세 번째 결.
 *
 * 소윤(기획) 소유 — 2026-08-09 games/에서 data/events/로 이관 완료 (contract.md 1절, ADR-002).
 * 톤 6종 = hype / worry / info / mock / cheer / question. 이벤트당 flavor 6개 이상.
 */
window.POCKET_CHAT = {
  T: {
    start: { facts: [], flavor: [
      ['hype', '괴수 배틀 왔다!!'], ['cheer', '오늘 연승 가즈아'], ['question', '스타팅 뭐예요?'],
      ['info', '타입 상성이 절반이다 이 게임'], ['mock', '오늘도 안정타만 누르겠지 ㅋㅋ'],
      ['cheer', '출첵!!'], ['worry', '전멸만 하지 말자…'], ['hype', '드디어 켰다 ㅋㅋ'] ] },
    risky_hit: { facts: ['{mv} 적중 {dmg}딜 +{gain}!!', '도박수 {mv} 꽂혔다 — {dmg}뎀 +{gain}', '{dmg} 딜 ㄷㄷ {mv} +{gain}'], flavor: [
      ['hype', '들어갔다!!!'], ['cheer', '이거지 이거!!'], ['info', '명중 55%를 지르는 게 방송이지'],
      ['mock', '운빨 ㅋㅋㅋ 인정은 한다'], ['question', '저 기술 명중률 몇이에요?'], ['hype', 'ㄷㄷㄷㄷ'],
      ['worry', '심장 떨려서 못 보겠네'] ] },
    ultra_hit: { facts: ['필살기 {mv} {dmg}뎀 +{gain}!!!', '{mv} 적중 ㅋㅋㅋ {dmg}딜 +{gain}', '{dmg} 뎀지 미쳤다 {mv} +{gain}'], flavor: [
      ['hype', '?????? 저게 맞네'], ['cheer', '캬아아아아!!'], ['mock', '저걸 지르는 미친놈 ㅋㅋ'],
      ['info', '명중 38%짜리입니다 여러분'], ['hype', '클립 각!!!'], ['question', '이거 도박 중독 아님??'],
      ['cheer', '박수 갈겨!!!'] ] },
    crit: { facts: ['급소!! {mv} {dmg}뎀 +{gain}', '{mv} 크리티컬 {dmg}딜 +{gain}!!'], flavor: [
      ['hype', '급소다!!!'], ['cheer', '오늘 손 미쳤다'], ['mock', '운을 실력이라고 우기는 중'],
      ['info', '급소는 12%, 오늘 벌써 몇 번째냐'], ['hype', 'ㅋㅋㅋㅋ 개터졌다'], ['question', '급소 확률 몇%예요?'] ] },
    miss: { facts: ['{mv} 빗나감…'], flavor: [
      ['mock', 'ㅋㅋㅋㅋㅋㅋ'], ['mock', '그럴 줄 알았다'], ['worry', '아 아깝다…'],
      ['info', '기대값 계산은 하고 지른 거겠지'], ['mock', '도박 중독 말로가 이렇다'], ['cheer', '괜찮아 다음 턴!!'] ] },
    enemy_ko: { facts: ['{name} KO!! {streak}연승 +{gain}', '연승 {streak}연째 — {name} 잡고 +{gain}!!'], flavor: [
      ['hype', 'KO!!!'], ['cheer', '연승 가즈아!!'], ['info', '연쇄 배수 오르는 중 — 지금이 벌 때다'],
      ['mock', '상대가 약한 거 아니냐 ㅋㅋ'], ['question', '몇 연승째예요?'], ['hype', '폼 미쳤다!!'] ] },
    comeback: { facts: ['체력 {hp} 남기고 역전 KO +{gain}!!!', '체력 {hp}에서 역전 ㅋㅋㅋ +{gain}'], flavor: [
      ['hype', '레전드다 레전드!!!'], ['cheer', '이거 보려고 방송 본다!!!'], ['hype', 'ㅋㅋㅋㅋㅋㅋㅋ 살았어'],
      ['info', '빈사에서 지르는 게 제일 큰 수익이다'], ['mock', '각본 아니냐 이거'], ['question', '심장 괜찮으세요??'],
      ['cheer', '박수!!! 박수!!!'], ['worry', '수명 깎이는 방송이다 진짜'] ] },
    player_hit: { facts: ['{dmg} 맞았다', '아 {dmg} 뎀지…'], flavor: [
      ['worry', '체력 관리 좀…'], ['mock', '그러게 왜 안 피하냐 ㅋㅋ'], ['info', '다음 턴에 교체각 봐야 함'],
      ['worry', '아슬아슬한데'], ['question', '포션 같은 건 없어요?'], ['cheer', '버텨버텨!!'] ] },
    near_death: { facts: [], flavor: [
      ['worry', '빈사다 빈사!!'], ['hype', '지금이야!! 지르는 타이밍!!'], ['info', '여기서 역전 KO가 최고 수익이다'],
      ['mock', '어차피 죽을 거 필살기나 쓰자 ㅋㅋ'], ['question', '교체 안 해요??'], ['worry', '아 심장…'],
      ['cheer', '한 방 남았다 믿는다!!'] ] },
    faint: { facts: ['{name} 기절…'], flavor: [
      ['mock', 'ㅋㅋㅋ 눕는 거 보소'], ['worry', '아이고…'], ['info', '무리한 딜교였다'],
      ['mock', '내가 했으면 살렸다'], ['cheer', '다음 애로 복수하자'], ['question', '몇 마리 남았어요?'] ] },
    wipe: { facts: [], flavor: [
      ['mock', '전멸 ㅋㅋㅋㅋㅋ'], ['worry', '아 이건 좀…'], ['hype', '이것도 컨텐츠다 ㅋㅋ'],
      ['info', '회복하는 동안 시청자 샌다'], ['mock', '오늘의 하이라이트(나쁜 쪽)'], ['question', '회복 얼마나 걸려요?'] ] },
    revive: { facts: [], flavor: [
      ['cheer', '풀피 복귀!!'], ['hype', '2라운드 가자!!'], ['info', '이제 연쇄 다시 쌓아야 함'],
      ['mock', '이번엔 전멸하지 말자 제발'], ['question', '아까 왜 진 거예요?'], ['cheer', '다시 달리자!!'] ] },
    advantage: { facts: ['{name} 교체 — 상성 유리!'], flavor: [
      ['info', '이게 맞는 교체다'], ['cheer', '오 판단 좋다!!'], ['hype', '상성 싸움 이겼다'],
      ['mock', '드디어 머리를 쓰네 ㅋㅋ'], ['question', '상성표 어디서 봐요?'], ['info', '유리 상성은 1.5배입니다'] ] },
    disadvantage: { facts: [], flavor: [
      ['mock', '불리한 타입으로 비비는 중 ㅋㅋ'], ['info', '교체하는 게 기대값 높다'], ['question', '왜 안 바꿔요??'],
      ['mock', '고집 방송'], ['worry', '이러다 기절각인데'], ['info', '불리 상성은 딜이 0.67배로 깎임'] ] },
    safe_spam: { facts: [], flavor: [
      ['mock', '안정타만 6번째 ㅋㅋ'], ['info', '같은 기술만 쓰면 시청자가 물립니다'], ['mock', '이게 방송이냐 작업이지'],
      ['question', '다른 기술은 장식이에요?'], ['info', '신선도 떨어져서 수익도 깎이는 중'], ['worry', '노잼 각 잡히는 중…'] ] },
    new_foe: { facts: ['다음 도전자 {name} 등장!'], flavor: [
      ['hype', '다음 상대!!'], ['question', '쟤 무슨 타입이에요?'], ['info', '상성 확인하고 교체각 보자'],
      ['cheer', '이번에도 잡자!!'], ['mock', '얘도 3턴컷 각 ㅋㅋ'], ['worry', '점점 세지는데…'] ] },
    donation: { facts: ['{d}명 몰고 온 도네 ㄷㄷ', '도네 유입 +{d} ㄷㄷ'], flavor: [
      ['cheer', '큰손 등장!!'], ['hype', '도네 감사합니다!!'], ['mock', '치료비 하시라고 ㅋㅋ'],
      ['question', '방금 도네 얼마예요?'], ['cheer', '갓청자다'], ['info', '도네는 실력과 무관합니다'] ] },
    milestone: { facts: ['{v}명 돌파 ㄷㄷ', '벌써 {v}명 ㅋㅋ'], flavor: [
      ['hype', '떡상 중!!'], ['cheer', '축하합니다!!'], ['info', '연승 구간이 유입 구간이다'],
      ['mock', '다 역전패 보러 온 사람들 ㅋㅋ'], ['hype', '차트 역주행'], ['question', '최고 동접 몇이에요?'] ] },
    idle: { facts: [], flavor: [
      ['question', '고민 중이세요?'], ['info', '장고 끝에 악수 둔다'], ['mock', '수읽기 하는 척 ㅋㅋ'],
      ['cheer', '천천히 해요~'], ['question', '어떤 기술 쓸 거예요?'], ['mock', '화면 멈춘 줄'],
      ['info', '가만히 있으면 시청자 빠집니다'], ['hype', '슬슬 큰 거 한 방 각인데'] ] },
    end: { facts: [], flavor: [
      ['cheer', '수고하셨습니다!!'], ['question', '다음 방송 언제예요?'], ['cheer', '잘 봤습니다'],
      ['mock', '마지막 판 아쉬웠다 ㅋㅋ'], ['hype', '오늘 역전극 레전드였다'], ['info', '연승 기록 정리하러 갑니다'] ] },
  },
  // wipe는 무게 3에 남긴다. 무게 4(= ADR-009 임팩트 문턱)로 올리는 안을 계측으로 기각했다:
  // 전멸이 런당 5~10회라 "설계 피크"가 될 만큼 드물지 않다. 다른 게임의 피크는 전부 크기
  // 문턱을 넘은 사건인데(GUOI는 낙차 25m 이상만 fall_legend) 전멸에는 문턱이 없다.
  // 피크가 필요하면 "높은 연승에서의 전멸"처럼 문턱이 달린 별도 이벤트여야 한다 (ADR-010 후속)
  BURST: { comeback: 4, ultra_hit: 3, crit: 3, wipe: 3, enemy_ko: 2, risky_hit: 2, faint: 2,
           advantage: 2, near_death: 2, start: 2, end: 2 },
  // 자극 벡터 [danger, chaos, skill, fun] — 공명 배분용 (resonance-model.md §7.3, 초안: 정훈 / 검토: 소윤)
  // 이 게임의 결은 **수읽기**다 — 관객이 같이 계산한다. 숙련을 세우고 파괴는 최소로
  // (2차 태깅: 게임 간 관객 프로필이 겹치던 문제 교정. resonance-model.md §6)
  STIM: {
    risky_hit: [.5, 0, .75, .25], ultra_hit: [.7, .1, .9, .35], crit: [.4, .1, .65, .4],
    miss: [.25, .05, .1, .5], enemy_ko: [.15, 0, .85, .15], comeback: [.9, .1, 1, .25],
    player_hit: [.4, .1, .15, .1], near_death: [.85, .05, .35, .1], faint: [.25, .25, .1, .3],
    wipe: [.3, .5, .05, .4], revive: [0, 0, .3, .25], advantage: [0, 0, .95, .1],
    disadvantage: [.15, 0, .55, .3], safe_spam: [0, 0, .1, .35], new_foe: [.15, 0, .4, .15],
    donation: [0, 0, 0, .5], milestone: [0, 0, .25, .35],
  },
};
