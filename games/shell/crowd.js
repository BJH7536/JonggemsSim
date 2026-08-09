/* 군중 — 시청자 100종(data/personas/viewers.js, 소윤)을 발화층에 붙인다. 소유: 무대.
 *
 * 지금까지 100종은 도감의 불멸 관측단 12명만 읽혔고 나머지 88명은 메모리에만 있었다
 * (speech·spawn·volume 전 필드 참조 0건). 여기서 88명을 채팅 캐스트로 승격한다 —
 * 8명이 돌려막던 채팅이 실제 군중이 된다.
 *
 * 경계:
 *   - 관측단 12명은 제외한다. 발화층/판정층 분리는 ADR-006의 전제다 (말 없는 판정 개체)
 *   - 반대 방향도 지킨다: 군중은 도감 칸을 열지 않는다 (dex.roster가 crowd 표식을 건너뛴다).
 *     말하는 개체와 판정하는 개체를 섞으면 파장이 발화 성공 여부에 물든다 (C3b 위반)
 *   - 변환만 한다. 값의 정본은 100종 JSON(소윤) — 여기서 페르소나를 새로 저작하지 않는다
 *   - C3: spawn·volume은 "누가 말할지"만 정한다. 시청자 수·보상 어디에도 닿지 않는다
 */
(function () {
  'use strict';

  // 사분면 → 기존 시각·경제 언어. dex.js의 QCOLOR와 같은 값을 쓴다 (같은 개체가 두 화면에서
  // 다른 색이면 안 된다). 원형 매핑도 dex.js 주석의 해석 그대로 — Q3 불구경 / Q4 뜨내기.
  var QCOLOR = { Q1: '#ffb0c8', Q2: '#ffd27a', Q3: '#ff8d5a', Q4: '#a8c8f0' };
  var QARCH  = { Q1: 'fan',     Q2: 'expert', Q3: 'thrill',  Q4: 'casual' };
  // 톤은 contract.md 3절 공인 6종의 부분집합이어야 한다 (selftest가 검사한다).
  // 100종 JSON에는 톤 필드가 없으므로 사분면에서 유도한다 — 공용 어휘 폴백에만 쓰인다.
  var QTONE  = {
    Q1: ['cheer', 'hype'],      // 장인의 팬 — 사람을 응원한다
    Q2: ['info', 'question'],   // 분석가 — 판을 읽는다
    Q3: ['hype', 'mock'],       // 리액션 사냥꾼 — 반응을 노린다
    Q4: ['mock', 'worry'],      // 사고 구경꾼 — 사고를 기다린다
  };

  // 군중 배율 — 88명을 그대로 풀면 저작 캐스트 8명 몫이 15%까지 떨어진다(실측). 티키타카(ADR-003)와
  // 단골 기억은 그 8명 전용 연출이라 같이 사라진다. 0.42는 8명 몫이 ~35%로 돌아오는 값 —
  // 채팅의 3분의 2는 모르는 닉이고 나머지는 아는 얼굴이다. selftest가 이 대역을 지킨다.
  var CROWD_GAIN = 0.42;

  Shell.Crowd = {
    joined: 0,

    // 100종 → 캐스트 형식. 관측단은 걸러낸다
    build: function () {
      var V = window.JONG_VIEWERS;
      if (!V || !V.personas) return [];
      var imm = V.immortal_observers || [];
      return V.personas.filter(function (p) { return imm.indexOf(p.id) < 0; }).map(function (p) {
        var sp = p.speech || {}, ex = sp.exemplars || {}, say = null;
        // 개체 고유 발화 — 지금 정본에는 개체당 spike 또는 observe 한 줄씩 들어 있다.
        // 없는 상황은 공용 어휘(게임 chat-data)로 내려간다
        if (ex.spike || ex.observe) say = { spike: ex.spike || null, observe: ex.observe || null };
        return {
          nick: p.name, color: QCOLOR[p.q] || '#8a9bb8',
          tones: QTONE[p.q] || ['hype'], arch: QARCH[p.q] || 'casual',
          // 등장 빈도 = spawn(등장 확률) × volume(말수). 엔진의 원형 가중치에 곱해진다.
          // 저작 캐스트 8명은 weight가 없어 1.0 — 티키타카·단골 기억의 주역이라 밀리면 안 된다
          weight: CROWD_GAIN * p.spawn * (0.3 + 0.7 * p.volume),
          say: say, crowd: true,
        };
      });
    },

    // 부팅 — 엔진 배열에 제자리 push (Dex.init과 같은 방식. 참조를 갈아끼우지 않는다)
    init: function () {
      if (!window.Chat || this.joined) return;
      var list = this.build();
      list.forEach(function (p) {
        var dup = Chat.personas.some(function (q) { return q.nick === p.nick; });
        if (!dup) Chat.personas.push(p);
      });
      this.joined = list.length;
    },
  };
})();
