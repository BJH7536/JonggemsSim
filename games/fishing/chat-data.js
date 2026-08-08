/* 심연낚시 — AI 시청자 이벤트 어휘.
 *
 * 이 게임의 결은 "기다림의 긴장"이다. 화력쇼(반사)·pocket(훈수)과 달리 낚시는
 * 아무 일도 안 일어나는 시간이 콘텐츠다 — 잔입질에 낚이는 스트리머를 놀리는 mock,
 * 심해 캐스팅의 기다림을 못 견디는 worry가 주연이 된다.
 *
 * 소윤(기획) 접점. 스키마 확정 후 data/events/fishing.json 으로 이관 (contract.md 1절).
 * 톤 6종 = hype / worry / info / mock / cheer / question. 이벤트당 flavor 6개 이상.
 * STIM = [위험, 파괴, 숙련, 유머] 0~1 — 공명 모델(PR #4) 대비 자극 벡터.
 */
window.FISHING_CHAT = {
  T: {
    start: { facts: [], flavor: [
      ['hype', '심연낚시 왔다!!'], ['cheer', '오늘 전설 하나 뽑자'], ['question', '어디 수심부터 가요?'],
      ['info', '심해가 기대값은 제일 높음'], ['mock', '또 얕은물서 잡어나 뜨겠지 ㅋㅋ'],
      ['cheer', '출첵!!'], ['worry', '줄만 안 끊기면 된다…'], ['hype', '드디어 켰다 ㅋㅋ'] ] },
    cast: { facts: ['{zone} 캐스팅!', '{zone}에 던졌다', '루어 {zone} 투하'], flavor: [
      ['hype', '들어간다!!'], ['cheer', '이번엔 대물 각!!'], ['question', '거긴 뭐가 물어요?'],
      ['info', '깊을수록 입질은 늦고 어종은 크다'], ['mock', '또 헛챔질 준비하시고 ㅋㅋ'],
      ['worry', '기다리는 동안 사람 빠지는데…'] ] },
    nibble: { facts: [], flavor: [
      ['worry', '어 뭔가 건드린다!!'], ['mock', '낚이지 마라 페이크다 ㅋㅋ'], ['info', '잔입질엔 챔질 금지'],
      ['question', '지금 당기는 거 아니에요??'], ['hype', '온다 온다 온다'], ['mock', '손 떨리는 거 다 보임 ㅋㅋ'],
      ['worry', '참아… 참아…'] ] },
    bite: { facts: [], flavor: [
      ['hype', '왔다!!!!'], ['hype', '지금!!! 당겨!!!'], ['cheer', '챔질 가즈아!!'],
      ['worry', '놓치지 마!!!'], ['info', '창 1초도 안 된다 바로 당겨'], ['question', '이게 진짜예요??'],
      ['hype', 'ㄷㄷㄷㄷㄷ'] ] },
    hook: { facts: [], flavor: [
      ['hype', '걸었다!!!'], ['cheer', '후킹 성공!!'], ['info', '이제 텐션 관리가 전부다'],
      ['worry', '줄 조심해 줄!!'], ['question', '뭐가 걸린 거예요?'], ['mock', '잡어면 웃긴다 ㅋㅋ'],
      ['hype', '릴 감아 릴!!'] ] },
    strike_miss: { facts: [], flavor: [
      ['mock', 'ㅋㅋㅋㅋ 잔입질에 낚였다'], ['mock', '그게 페이크라고 했잖아'], ['worry', '아 아깝다…'],
      ['info', '진입질은 화면이 번쩍인다'], ['mock', '물고기가 더 똑똑하네 ㅋㅋ'], ['cheer', '괜찮아 다시 던져!!'],
      ['question', '방금 뭐였어요?'] ] },
    tension_edge: { facts: ['텐션 {t}%에서 버틴다!!', '{t}% 클러치 ㄷㄷㄷ', '텐션 {t}% 미친 줄타기'], flavor: [
      ['hype', '끊긴다 끊긴다!!!'], ['worry', '놔!! 잠깐 놔!!'], ['info', '90% 위가 제일 빨리 끌려옴'],
      ['hype', '이게 낚시지!!!'], ['mock', '심장으로 낚시하는 사람 ㅋㅋ'], ['cheer', '버텨라!!!'],
      ['question', '저거 안 끊겨요??'] ] },
    land_small: { facts: ['{name} 랜딩 +{gain}', '{name} 잡았다 +{gain}'], flavor: [
      ['cheer', '오 한 마리!!'], ['info', '소형은 몸풀기용이다'], ['mock', '귀엽네 ㅋㅋ 방생각'],
      ['question', '저거 먹을 수 있어요?'], ['cheer', '순조롭다 순조로워'], ['mock', '이거 잡으려고 방송 켰냐 ㅋㅋ'] ] },
    land_mid: { facts: ['{name} 랜딩!! +{gain}', '{name} 끌어올렸다 +{gain}'], flavor: [
      ['hype', '오 씨알 좋다!!'], ['cheer', '이게 낚시지!!'], ['info', '중층 기대값 딱 이 정도'],
      ['mock', '이제 좀 방송 같네 ㅋㅋ'], ['question', '몇 kg짜리예요?'], ['hype', '폼 오르는 중!!'] ] },
    land_big: { facts: ['대형 {name} 랜딩!!! +{gain}', '{name} 올라왔다 ㄷㄷ +{gain}', '{name} +{gain} 미쳤다'], flavor: [
      ['hype', '대물이다!!!!'], ['cheer', '캬아아아 이거지!!!'], ['info', '심해 기다린 보람이 있다'],
      ['hype', '클립 각!!!'], ['mock', '저걸 안 놓치네;;'], ['cheer', '박수 갈겨!!!'],
      ['worry', '팔 괜찮으세요??'] ] },
    land_legend: { facts: ['전설 어종 {name} 랜딩!!! +{gain}', '{name}…?? 실화냐 +{gain}', '{name} 등장 ㄷㄷㄷ +{gain}'], flavor: [
      ['hype', '?????????'], ['hype', '전설이다!!! 전설!!!'], ['cheer', '이거 보려고 살았다!!!'],
      ['info', '심해 최상위 어종입니다 여러분'], ['mock', '이건 각본이지 ㅋㅋㅋ'], ['question', '저거 도감에 있어요??'],
      ['hype', '방송 역사에 남는다!!'], ['cheer', '박수!!! 박수!!!'] ] },
    escape: { facts: [], flavor: [
      ['mock', 'ㅋㅋㅋㅋ 놓쳤다'], ['worry', '아 아깝다 진짜…'], ['info', '슬랙 주면 바늘이 빠진다'],
      ['mock', '물고기: 수고요 ㅋㅋ'], ['cheer', '다음 놈 잡으면 된다!!'], ['question', '방금 큰 놈이었죠?'] ] },
    line_snap: { facts: ['줄 끊김!!! 구경값 +{gain} ㅋㅋ', '터졌다 ㅋㅋㅋ +{gain}명 유입', '줄 나갔는데 +{gain} 레전드'], flavor: [
      ['hype', 'ㅋㅋㅋㅋㅋㅋㅋ'], ['hype', '레전드 방송사고'], ['mock', '낚싯대가 불쌍하다 ㅋㅋ'],
      ['cheer', '이거 보러 왔다!!!'], ['worry', '수리 8초… 아깝다'], ['info', '텐션 100 넘기면 무조건 끊김'],
      ['question', '줄 몇 호 쓰는 거예요?'] ] },
    trash: { facts: ['{name} ㅋㅋ 잡어다', '{name} 낚음 ㅋㅋㅋ'], flavor: [
      ['mock', 'ㅋㅋㅋㅋ 잡어'], ['mock', '심혈 기울여서 잡은 게 저거냐'], ['info', '얕은물은 절반이 잡어입니다'],
      ['question', '저것도 물고기예요?'], ['cheer', '괜찮아 손맛은 봤잖아'], ['mock', '방생해라 불쌍하다 ㅋㅋ'] ] },
    nag: { facts: [], flavor: [
      ['mock', '캐스팅 안 하고 뭐 함 ㅋㅋ'], ['worry', '가만히 있으면 사람 빠져요…'], ['question', '어디 던질지 고민 중?'],
      ['info', '고민할 시간에 심해나 가라'], ['mock', '물멍 방송이냐 ㅋㅋ'], ['worry', '빨리 뭐라도 던져요'] ] },
    idle: { facts: [], flavor: [
      ['question', '오늘 목표 어종 뭐예요?'], ['cheer', '물소리 힐링이다'], ['mock', '물고기가 스트리머 관찰 중 ㅋㅋ'],
      ['info', '심해는 기다림이 리스크다'], ['question', '몇 시까지 방송해요?'], ['hype', '슬슬 대물 각인데'],
      ['worry', '너무 조용한데…'], ['mock', '수면이 제일 열일하네'] ] },
    donation: { facts: ['{d}명 몰고 온 도네 ㄷㄷ', '도네 유입 +{d} ㄷㄷ'], flavor: [
      ['cheer', '큰손 등장!!'], ['hype', '도네 감사합니다!!'], ['mock', '줄값 하시라고 ㅋㅋ'],
      ['question', '방금 도네 얼마예요?'], ['cheer', '갓청자다'], ['info', '도네는 어황과 무관합니다'] ] },
    milestone: { facts: ['{v}명 돌파 ㄷㄷ', '벌써 {v}명 ㅋㅋ'], flavor: [
      ['hype', '떡상 중!!'], ['cheer', '축하합니다!!'], ['info', '다 줄 끊기는 거 보러 온 사람들'],
      ['mock', '어시장보다 붐빈다 ㅋㅋ'], ['hype', '차트 역주행'], ['question', '최고 동접 몇이에요?'] ] },
    end: { facts: [], flavor: [
      ['cheer', '수고하셨습니다!!'], ['question', '다음 방송 언제예요?'], ['cheer', '잘 봤습니다'],
      ['mock', '마지막 줄 끊김 아쉬웠다 ㅋㅋ'], ['hype', '오늘 랜딩 레전드였다'], ['info', '조과 정리하러 갑니다'] ] },
  },
  BURST: { land_legend: 4, line_snap: 4, land_big: 3, bite: 2, hook: 2, land_mid: 2, escape: 2,
           tension_edge: 2, strike_miss: 2, trash: 2, start: 2, end: 2 },
  // [위험, 파괴, 숙련, 유머]
  STIM: {
    start: [0, 0, 0, .2], cast: [.2, 0, .2, 0], nibble: [.3, 0, .1, .2], bite: [.6, 0, .3, 0],
    hook: [.5, 0, .7, .1], strike_miss: [.1, 0, 0, .8], tension_edge: [.9, .2, .8, 0],
    land_small: [.1, 0, .4, .1], land_mid: [.3, 0, .6, .1], land_big: [.6, .1, .9, .1],
    land_legend: [.8, .2, 1, .2], escape: [.3, 0, .1, .6], line_snap: [.7, 1, .1, .7],
    trash: [0, 0, 0, .9], nag: [.1, 0, 0, .5], idle: [0, 0, 0, .3],
    donation: [0, 0, 0, .4], milestone: [.2, 0, .3, .3], end: [0, 0, 0, .2],
  },
};
