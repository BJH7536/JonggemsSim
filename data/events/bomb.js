/* 해체쇼 — AI 시청자 이벤트 어휘.
 *
 * 이 게임의 결은 "긴장"이다. 폭탄 시계가 도는 동안 관객은 판독(겁쟁이)과
 * 감컷(도박사)을 실시간으로 평가한다 — 판독엔 mock, 감컷엔 hype, 폭발엔 축제.
 *
 * 소윤(기획) 소유 — 2026-08-09 games/에서 data/events/로 이관 완료 (contract.md 1절, ADR-002).
 * 톤 6종 = hype / worry / info / mock / cheer / question. 이벤트당 flavor 6개 이상.
 * STIM = [위험, 파괴, 숙련, 유머] 0~1 — 공명 모델용 (PR #4 대비).
 */
window.BOMB_CHAT = {
  T: {
    start: { facts: [], flavor: [
      ['hype', '해체쇼 왔다!!'], ['cheer', '오늘 무사고 가자'], ['question', '이거 터지면 어떻게 돼요?'],
      ['info', '판독은 안전빵, 감컷이 배당임'], ['mock', '오늘도 판독충 방송이겠지 ㅋㅋ'],
      ['worry', '심장 약한 사람 퇴장하세요'], ['hype', '드가자!!'], ['cheer', '출첵!!'] ] },
    new_bomb: { facts: ['와이어 {wires}가닥 · 제한 {limit}초', '이번 의뢰 {wires}가닥 {limit}초', '{limit}초짜리 {wires}가닥 들어옴'], flavor: [
      ['hype', '다음 폭탄!!'], ['worry', '시간 점점 짧아지는데??'], ['question', '함정 몇 개예요?'],
      ['info', '라운드 오를수록 함정 늘어남'], ['cheer', '이번에도 살리자'], ['mock', '이건 좀 쫄리네 ㅋㅋ'] ] },
    scan_reveal: { facts: ['판독 결과 — {result}', '돋보기 판정: {result}', '{result} 확정 떴다'], flavor: [
      ['mock', '또 돋보기 ㅋㅋ 겁쟁이'], ['info', '판독 3초는 공짜가 아니다'], ['question', '판독하면 돈 안 줘요?'],
      ['worry', '시간 가는데 괜찮아요?'], ['mock', '판독쇼 하러 왔나'], ['info', '확정 정보는 배당을 죽인다'],
      ['cheer', '꼼꼼한 것도 실력이죠'] ] },
    cut_safe: { facts: [], flavor: [
      ['info', '판독선 컷은 배당 0임'], ['mock', '안전빵 ㅋㅋ 시시하다'], ['cheer', '착실하네요'],
      ['question', '이러면 돈 얼마 벌어요?'], ['mock', '이게 방송이냐 작업이지'], ['worry', '너무 느긋한데…'] ] },
    cut_paid: { facts: ['노판독 감컷 +{gain}!!', '감으로 잘라서 +{gain}', '미판독 컷 성공 +{gain} ㄷㄷ'], flavor: [
      ['hype', '감컷!!!'], ['cheer', '이거지 이거!!'], ['mock', '운빨 ㅋㅋ 인정은 한다'],
      ['info', '미판독 컷이 진짜 배당이다'], ['question', '방금 몇 프로 도박이에요?'],
      ['hype', '손 미쳤다 ㄷㄷ'], ['worry', '심장 떨려서 못 보겠네'] ] },
    boom: { facts: ['폭발 ㅋㅋㅋ 구경값 +{gain}', '터졌다!! 유입 +{gain}', '대참사 +{gain} ㄷㄷ'], flavor: [
      ['hype', 'ㅋㅋㅋㅋㅋ 터졌다!!!'], ['mock', '그럴 줄 알았다 ㅋㅋ'], ['cheer', '이 맛에 본다!!'],
      ['info', '폭발도 콘텐츠다, 유입 봐라'], ['question', '작업대 괜찮아요??'],
      ['hype', '클립 각!!!'], ['worry', '고막 나갈 뻔;;'] ] },
    defused: { facts: ['해체 완료 +{gain}', '의뢰 마감 +{gain}', '폭탄 잠재움 +{gain}'], flavor: [
      ['cheer', '해체 완료!!'], ['hype', '깔끔하다!!'], ['info', '연쇄 배수 오르는 중'],
      ['mock', '좀 심심하게 살았네 ㅋㅋ'], ['question', '다음 폭탄 언제 와요?'], ['cheer', '수고했어요!!'] ] },
    defused_clutch: { facts: ['{sec}초 남기고 해체 +{gain}!!!', '잔여 {sec}초 클러치 +{gain}', '{sec}초 컷 해체 ㄷㄷ +{gain}'], flavor: [
      ['hype', '미쳤다 진짜!!!'], ['cheer', '이거 보려고 방송 본다!!'], ['worry', '수명 깎이는 방송이다'],
      ['info', '2초 미만 해체는 클러치 판정'], ['mock', '각본 아니냐 이거 ㅋㅋ'],
      ['hype', '클립 박제!!!'], ['question', '심장 괜찮으세요??'] ] },
    timeout_boom: { facts: [], flavor: [
      ['mock', '멍때리다 터짐 ㅋㅋㅋ'], ['mock', '가만히 있다 폭발은 처음 봄'], ['worry', '아까운 폭탄…'],
      ['info', '방치 폭발은 구경값도 없다'], ['question', '자리 비우셨어요?'],
      ['mock', '이건 볼거리도 아니다'], ['worry', '집중 좀 해요 제발'] ] },
    chain_up: { facts: ['연쇄 ×{x} 돌입', '배수 ×{x}로 상승', '연쇄 ×{x}!!'], flavor: [
      ['hype', '배수 올랐다!!'], ['cheer', '연쇄 가즈아!!'], ['info', '지금 자르는 게 제일 크다'],
      ['mock', '끊길 때가 제일 재밌는데 ㅋㅋ'], ['question', '최대 몇 배예요?'], ['hype', '폼 미쳤다!!'] ] },
    nag: { facts: [], flavor: [
      ['worry', '폭탄 시계 돌아가는데요??'], ['mock', '구경만 하는 해체사 ㅋㅋ'], ['question', '뭐부터 자를 거예요?'],
      ['info', '고민하는 동안 시간만 탄다'], ['mock', '화면 멈춘 줄'], ['worry', '빨리 손 대요 좀'] ] },
    idle: { facts: [], flavor: [
      ['question', '최고 배당 얼마였어요?'], ['cheer', '보는 맛 있다'], ['mock', '슬슬 하나 터질 각 ㅋㅋ'],
      ['info', '감컷은 시간 많을수록 큼'], ['question', '몇 시까지 해요?'],
      ['cheer', '정주행 중입니다'], ['hype', '큰 거 한 방 가자'] ] },
    donation: { facts: ['{d}명 몰고 온 도네 ㄷㄷ', '도네 유입 +{d} ㄷㄷ'], flavor: [
      ['cheer', '큰손 등장!!'], ['hype', '도네 감사합니다!!'], ['mock', '수리비 하시라고 ㅋㅋ'],
      ['question', '방금 도네 얼마예요?'], ['cheer', '갓청자다'], ['info', '도네는 실력과 무관합니다'] ] },
    milestone: { facts: ['{v}명 돌파 ㄷㄷ', '벌써 {v}명 ㅋㅋ'], flavor: [
      ['hype', '떡상 중!!'], ['cheer', '축하합니다!!'], ['info', '폭발 구간이 유입 구간이다'],
      ['mock', '다 터지는 거 보러 옴 ㅋㅋ'], ['hype', '차트 역주행'], ['question', '최고 동접 몇이에요?'] ] },
    end: { facts: [], flavor: [
      ['cheer', '수고하셨습니다!!'], ['question', '다음 방송 언제예요?'], ['cheer', '잘 봤습니다'],
      ['mock', '마지막 폭발 아쉬웠다 ㅋㅋ'], ['hype', '오늘 클러치 레전드'], ['info', '클립 정리하러 갑니다'] ] },
  },
  BURST: { boom: 4, defused_clutch: 4, cut_paid: 2, defused: 2, chain_up: 2,
           timeout_boom: 2, new_bomb: 1, start: 2, end: 2 },
  // [위험, 파괴, 숙련, 유머] — 공명 모델 자극 벡터 (PR #4 대비, 현재 미소비)
  STIM: {
    start: [.2, .1, .1, .2], new_bomb: [.5, .2, .2, .1], scan_reveal: [.2, 0, .5, .1],
    cut_safe: [.1, 0, .3, .1], cut_paid: [.8, .2, .7, .2], boom: [.9, 1, .1, .7],
    defused: [.3, 0, .8, .1], defused_clutch: [1, .2, 1, .3], timeout_boom: [.4, .8, 0, .5],
    chain_up: [.5, .1, .7, .2], nag: [.2, 0, 0, .5], idle: [.1, 0, 0, .3],
    donation: [.1, 0, .1, .4], milestone: [.3, .1, .2, .3], end: [.1, 0, .2, .2],
  },
};
