/* 화력쇼 — AI 시청자 이벤트 어휘 (게임 16종 이벤트 × 톤별 템플릿).
 *
 * 소윤(기획) 접점. 스키마가 `data/`로 확정되면 이 파일은 data/events/hwaryeok.json 로더로
 * 대체된다 — 그때까지 게임이 자기 어휘를 직접 들고 있는다 (contract.md 1절).
 *
 * 규약: facts = 사실 슬롯 포함(검증 대상, 버스트의 첫 줄만), flavor = [톤, 리액션].
 *       톤 6종 = hype / worry / info / mock / cheer / question. 이벤트당 flavor 6개 이상.
 */
window.HWARYEOK_CHAT = {
  T: {
    start: { facts: [], flavor: [
      ['hype', '왔다!!'], ['cheer', '오늘도 불쇼 가즈아'], ['question', '오늘 메뉴 뭐예요?'],
      ['cheer', '출첵합니다'], ['hype', '드디어 켰네 ㅋㅋ'], ['worry', '오늘은 주방 안 태우겠지…'],
      ['info', '초보는 정석 모드부터 보면 됨'], ['mock', '지각 방송 ㅋㅋ'] ] },
    accident: { facts: ['화구 {b} {acc}!!', '{b}번 {acc} 떴다', '어어 {b}번 {acc} 각이다'], flavor: [
      ['hype', '사고다!!! 집중!!'], ['worry', '빨리 꺼요 빨리!!'], ['question', '저거 놔두면 어떻게 돼요?'],
      ['mock', '이 주방 오늘도 평화롭네 ㅋㅋ'], ['cheer', '수습쇼 보여줘!!'], ['hype', '왔다 왔다 ㅋㅋㅋ'],
      ['worry', '아 심장 떨려'], ['info', '침착하게 번호 누르면 됨'] ] },
    oilfire: { facts: ['기름 화재!! {b}번!!', '{b}번 기름불이다!!'], flavor: [
      ['hype', '끄지 마 끄지 마 ㅋㅋㅋ'], ['worry', '꺼!!! 제발 꺼!!!'], ['mock', '솔직히 대참사 보고 싶다'],
      ['hype', '불기둥 ㄷㄷㄷ'], ['worry', '이번엔 진짜 위험해'], ['question', '이거 일부러 놔두는 사람도 있어요?'],
      ['info', '1.2초 안에 못 끄면 터진다'], ['cheer', '침착해 소화각이야!!'] ] },
    rescue: { facts: ['+{gain} ㄷㄷ', '수습 +{gain}!!', '{gain}명 유입 ㅋㅋ'], flavor: [
      ['hype', '손 뭐냐 ㄷㄷ'], ['cheer', '이게 방송이지!!'], ['info', '반응속도 미쳤다'],
      ['mock', '운빨 반박 불가 ㅋㅋ'], ['question', '방금 뭐 누른 거예요?'], ['hype', '개잘하네 ㅋㅋㅋ'],
      ['cheer', '폼 미쳤다!!'] ] },
    rescue_big: { facts: ['고배율 수습 +{gain}!!!', '+{gain} ㅋㅋㅋ 미쳤다', '{gain}명 폭발 유입 ㄷㄷㄷ'], flavor: [
      ['hype', '방금 그거 클립 각!!!'], ['cheer', '캬아아아 이거지!!!'], ['info', '프레임 단위 수습이다 저건'],
      ['hype', 'ㄷㄷㄷㄷㄷ'], ['mock', '저걸 살리네;;'], ['cheer', '박수 갈겨!!!'], ['question', '이 사람 프로임??'] ] },
    fail: { facts: ['아 {acc} 놓쳤다', '{acc} 실패…'], flavor: [
      ['mock', '집중 안 하냐'], ['worry', '아깝다…'], ['mock', '음 식었네'],
      ['info', '창 끝나기 전에 눌러야 함'], ['mock', '…'], ['worry', '괜찮아 다음 거 잡자'] ] },
    disaster: { facts: ['대참사 +{gain} ㅋㅋㅋㅋ', '주방 터졌는데 +{gain}명 ㅋㅋㅋ', '{gain}명 유입 레전드'], flavor: [
      ['hype', 'ㅋㅋㅋㅋㅋㅋㅋㅋ'], ['hype', '레전드 방송사고'], ['mock', '소방서 안 부르냐 ㅋㅋ'],
      ['cheer', '이거 보러 왔다!!!'], ['hype', '클립 각 미쳤다'], ['question', '화구 저거 고쳐지는 거예요??'],
      ['info', '12초 파손이면 손해 꽤 큰데'], ['worry', '진짜 괜찮은 거 맞지…?'] ] },
    done: { facts: ['{dish} 완성이요'], flavor: [
      ['cheer', '오 맛있겠다'], ['mock', '무사고 방송 노잼'], ['info', '완성은 +40밖에 안 줌'],
      ['mock', '잘하는데… 심심하네'], ['question', '사고는 언제 나요?'], ['cheer', '플레이팅 좋다'],
      ['mock', '안전운전 ㅋㅋ'] ] },
    unlock: { facts: ['{label}'], flavor: [
      ['hype', '드디어!!!'], ['cheer', '커진다 커져!!'], ['hype', '이제 시작이지 ㅋㅋ'],
      ['info', '여기서부터 스노볼임'], ['cheer', '가즈아!!!'], ['question', '뭐가 열린 거예요?'] ] },
    donation: { facts: ['{d}명 몰고 온 도네 ㄷㄷ', '도네 유입 +{d} ㄷㄷ'], flavor: [
      ['cheer', '큰손 등장 ㄷㄷ'], ['hype', '도네 감사합니다!!'], ['mock', '나도 쏘고 싶다…'],
      ['question', '방금 도네 얼마예요?'], ['cheer', '역시 갓청자'], ['hype', '도네버프 가즈아'] ] },
    chain3: { facts: [], flavor: [
      ['hype', '연쇄 ×3 풀배율!!!'], ['info', '지금부터 수습 하나가 세 배다'], ['cheer', '폼 미쳤다 유지해!!'],
      ['hype', '불 붙었다 ㅋㅋㅋ'], ['worry', '끊기면 아까운데 집중'], ['cheer', '가보자 가보자!!'] ] },
    milestone: { facts: ['{v}명 돌파 ㄷㄷ', '벌써 {v}명 ㅋㅋ'], flavor: [
      ['hype', '떡상 중 ㄷㄷ'], ['cheer', '축하합니다!!'], ['info', '이 속도면 다음 언락 금방임'],
      ['mock', '어디서 다 왔대 ㅋㅋ'], ['hype', '차트 역주행 각'], ['question', '최고 기록이 몇 명이에요?'] ] },
    nag: { facts: ['화구 {b}번 놀고 있어요'], flavor: [
      ['worry', '빈 화구 시청자 샌다…'], ['mock', '화구 놀리는 방송 처음 봄'], ['info', '빈 화구는 초당 0.5%씩 빠짐'],
      ['question', '왜 불 안 올려요?'], ['mock', '월세 아깝다 월세'], ['worry', '빨리 뭐라도 올려요'] ] },
    idle: { facts: [], flavor: [
      ['question', '오늘 메뉴 추천 받아요?'], ['cheer', '보는 맛이 있다'], ['mock', '불맛 좀 보여줘 봐'],
      ['info', '속성 모드가 기대값은 더 높음'], ['question', '몇 시까지 방송해요?'], ['cheer', '정주행 중입니다'],
      ['hype', '슬슬 사고 하나 각인데'], ['mock', '평화롭다… 너무 평화로운데?'] ] },
    end: { facts: [], flavor: [
      ['cheer', '수고하셨습니다!!'], ['question', '다음 방송 언제예요?'], ['cheer', '잘 봤습니다'],
      ['mock', '마지막에 아쉬웠다 ㅋㅋ'], ['hype', '오늘 레전드였다'], ['info', '클립 정리하러 갑니다'] ] },
  },
  BURST: { disaster: 4, rescue_big: 3, oilfire: 3, rescue: 2, accident: 2, unlock: 2, chain3: 2, start: 2, end: 2 },
};
