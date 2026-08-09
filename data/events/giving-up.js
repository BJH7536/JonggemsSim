/* Giving Up On It — AI 시청자 이벤트 어휘.
 *
 * 화력쇼와 톤이 정반대여야 한다: 화력쇼 채팅은 "초 단위 반응"에 붙고,
 * 이쪽은 "느린 긴장 → 대추락"에 붙는다. 같은 페르소나 8종이 다른 게임에서
 * 다르게 말하는 게 종겜스의 관전 포인트라, 어휘를 게임별로 완전히 분리한다.
 *
 * 소윤(기획) 소유 — 2026-08-09 games/에서 data/events/로 이관 완료 (contract.md 1절, ADR-002).
 * 톤 6종 = hype / worry / info / mock / cheer / question. 이벤트당 flavor 6개 이상.
 */
window.GIVINGUP_CHAT = {
  T: {
    start: { facts: [], flavor: [
      ['hype', '오늘 이거 한다고?? ㅋㅋㅋ'], ['worry', '이 게임은 사람을 망쳐요'], ['question', '정상까지 가는 거예요?'],
      ['mock', '오늘 방송 조기종료 각'], ['cheer', '멘탈 지켜요!!'], ['info', '곡괭이 갈고리를 걸어서 미는 겁니다'],
      ['hype', '기다렸다 이 게임'], ['mock', '항아리 아저씨 또 왔네'] ] },
    climb: { facts: ['{h}m 신기록', '{h}m 찍었다', '와 {h}m'], flavor: [
      ['cheer', '오 잘 올라가는데?'], ['info', '지금 폼 좋습니다'], ['hype', '가자 가자!!'],
      ['mock', '지금 떨어지면 개웃긴데'], ['worry', '조심조심…'], ['cheer', '이대로만 가요'],
      ['question', '최고 기록이 몇이에요?'] ] },
    fall: { facts: ['{d}m 추락 +{gain}', '{d}m 미끄러짐 ㅋㅋ +{gain}명', '아 {d}m… +{gain}은 벌었다'], flavor: [
      ['mock', 'ㅋㅋㅋㅋ'], ['worry', '아이고…'], ['hype', '떨어지는 맛에 본다'],
      ['cheer', '괜찮아요 다시!!'], ['info', '저기는 원래 다 미끄러짐'], ['mock', '예상했다'],
      ['question', '방금 왜 미끄러진 거예요?'] ] },
    fall_big: { facts: ['{d}m 대추락!! +{gain}', '{d}m 낙하 ㅋㅋㅋ +{gain}명', '{gain}명 유입 ㄷㄷ {d}m'], flavor: [
      ['hype', 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋ'], ['mock', '오늘의 명장면'], ['worry', '아 진심 아깝다'],
      ['hype', '클립 각!!!'], ['cheer', '괜찮아 괜찮아 진짜 괜찮아'], ['mock', '표정 봐 ㅋㅋ'],
      ['question', '지금 화면 밖으로 나간 거죠?'], ['info', '20분 작업 날아갔네요'] ] },
    fall_legend: { facts: ['처음부터 {d}m 떨어짐 +{gain} ㅋㅋㅋㅋ', '{d}m 리셋 레전드 +{gain}', '{gain}명 폭발 유입 ㄷㄷㄷ {d}m'], flavor: [
      ['hype', 'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ'], ['hype', '이거 보러 왔습니다'], ['mock', '오늘 방송 여기서 끝났다'],
      ['cheer', '박수… 아니 위로…'], ['hype', '역대급이다 진짜'], ['worry', '괜찮으신 거죠…?'],
      ['question', '멘탈 남아있어요?'], ['mock', '나였으면 컴퓨터 껐다'] ] },
    clutch: { facts: [], flavor: [
      ['hype', '오오오 살렸다!!'], ['cheer', '캬 이거지!!'], ['info', '방금 반응 좋았음'],
      ['mock', '운 좋았네 ㅋㅋ'], ['worry', '심장 떨어질 뻔'], ['hype', 'ㄷㄷㄷ'],
      ['question', '방금 어떻게 잡은 거예요?'] ] },
    stuck: { facts: [], flavor: [
      ['mock', '멈춰있으면 사람들 나가요'], ['worry', '왜 안 움직여요…'], ['question', '길 잃으셨어요?'],
      ['info', '가만히 있으면 시청자 빠집니다'], ['mock', '생각이 길다'], ['cheer', '천천히 해도 돼요!'],
      ['mock', '화면 멈춘 줄'] ] },
    summit: { facts: ['정상 등반 +{gain}!!!'], flavor: [
      ['hype', '???????'], ['cheer', '진짜 올라갔다!!!'], ['hype', '레전드다 레전드'],
      ['cheer', '축하합니다!!!'], ['mock', '이걸 깬다고?'], ['info', '이건 기록감입니다'],
      ['question', '몇 번 만에 성공한 거예요?'] ] },
    donation: { facts: ['{d}명 몰고 온 도네 ㄷㄷ', '도네 유입 +{d} ㄷㄷ'], flavor: [
      ['cheer', '위로금 도네 ㅋㅋ'], ['hype', '큰손 등장!!'], ['mock', '멘탈 수리비래요'],
      ['question', '방금 도네 얼마예요?'], ['cheer', '갓청자 등장'], ['info', '도네는 실력이랑 무관합니다'] ] },
    milestone: { facts: ['{v}명 돌파 ㄷㄷ', '벌써 {v}명 ㅋㅋ'], flavor: [
      ['hype', '떡상 중 ㄷㄷ'], ['cheer', '축하합니다!!'], ['mock', '다 추락 보러 온 사람들'],
      ['info', '이 게임은 원래 클립으로 큽니다'], ['hype', '차트 역주행'], ['question', '어디서 소문났대요?'] ] },
    idle: { facts: [], flavor: [
      ['question', '이 게임 몇 시간짜리예요?'], ['cheer', '보는 맛이 있다'], ['mock', '아직 안 떨어졌네'],
      ['info', '곡괭이를 아래로 눌러야 뜹니다'], ['question', '엔딩 보신 적 있어요?'], ['cheer', '정주행 중입니다'],
      ['hype', '슬슬 큰 거 한 번 각인데'], ['mock', '평화롭다… 너무 평화로운데?'] ] },
    end: { facts: [], flavor: [
      ['cheer', '수고하셨습니다!!'], ['question', '다음 방송 언제예요?'], ['mock', '오늘 추락 모음 만들어야지'],
      ['cheer', '잘 봤습니다'], ['hype', '오늘 레전드였다'], ['info', '클립 정리하러 갑니다'] ] },
  },
  BURST: { fall_legend: 4, fall_big: 3, summit: 4, clutch: 2, fall: 2, climb: 2, start: 2, end: 2 },
};
