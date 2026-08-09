/* 임팩트 계층 — 설계 피크에 강한 피드백 (ADR-009). 소유: 무대.
 *
 * 문제: 큰 사건과 작은 사건의 연출 차이가 flash(.18) 대 flash(.5)였다. 화면은 흔들리는데
 * 소리가 같아서 사건의 크기가 귀로 안 들어왔다. 뼈대(실력 연동 스파이크, 규약 5)가 밋밋했다.
 *
 * 원칙 — 새 저작 테이블을 만들지 않는다. 언제·어느 쪽인지를 이미 있는 신호 둘이 답한다:
 *   언제  = Chat.BURST[ev] === 4 (기획이 저작한 "이 순간의 크기"의 최댓값. 클립 흥미도와 같은 신호)
 *           + 시청자 유입이 Shell.DON.BURST(30%) 이상 (셸이 이미 "대참사급"으로 쓰는 문턱)
 *   어느 쪽 = Shell.CAM_MOOD (캠 표정용으로 이미 모든 이벤트를 aha/panic으로 갈라 둔 표)
 * 새 게임이 기존 이벤트 이름을 쓰면 임팩트는 공짜로 따라온다.
 *
 * 경계:
 *   - 규약 2: 시청자 손실에는 아무것도 붙지 않는다 (loseViewers 경로 무관). 대추락은 시청자
 *     손실이 아니라 플레이 사고다 — 사고도 콘텐츠라서 암울 스팅 대상이 맞다
 *   - 규약 3: 전용 쿨다운 6초. 연쇄 피크에 두 곡이 겹치느니 두 번째를 버린다
 *   - 규약 5: 문턱이 버스트 무게라 랜덤 도네(무게 2)는 임팩트를 못 산다 — 양념은 뼈대가 못 된다
 *   - C3: 전부 연출. 시청자·코인·등급·도감 어디에도 닿지 않는다
 */
(function () {
  'use strict';

  var COOL = 6;        // 임팩트 간 최소 간격(초). DON.FORCE_GAP(3)보다 길게 — 곡이 물리지 않게
  var HEAT_HOLD = 3;   // 사건 뒤 채팅이 두꺼운 시간(초)

  // ---------- 판정 (순수 함수 — selftest가 8개 피크를 못박는다) ----------
  // 조용히 틀리면 대참사에 팡파르가 울린다. 그래서 떼어 둔다.
  Shell.impactOf = function (ev, burst) {
    if (burst !== 4) return null;                    // 설계 피크만. 무게 3 이하는 기존 연출로 충분
    var M = Shell.CAM_MOOD || {};
    if ((M.aha || []).indexOf(ev) >= 0) return 'bright';
    if ((M.panic || []).indexOf(ev) >= 0 || (M.confusion || []).indexOf(ev) >= 0) return 'dark';
    return null;                                     // 분류에 없는 이벤트는 조용히 지나간다
  };

  Shell.Impact = {
    _at: -99,          // 마지막 임팩트 시각 (Shell.now 기준)
    _px: [],           // 폭죽 파티클
    heatUntil: 0,      // 채팅 폭주 유지 시각 — renderViewers가 이 동안 heat를 1로 깐다

    reset: function () { this._at = -99; this._px.length = 0; this.heatUntil = 0; },

    // 사건 관측 — emit 훅. 임팩트를 냈으면 true
    onEvent: function (ev) {
      return this.fire(Shell.impactOf(ev, (window.Chat && Chat.BURST[ev]) || 1));
    },
    // 시청자 급등 관측 — gain 훅. 유입만 들어온다 (손실 경로는 호출하지 않는다, 규약 2)
    onSurge: function (actual, before) {
      if (!(actual >= Math.max(1, before) * Shell.DON.BURST)) return false;
      return this.fire('bright', '+' + Math.round(actual).toLocaleString() + '명');
    },

    fire: function (kind, text) {
      if (!kind || Shell.phase !== 'live') return false;
      if (Shell.now - this._at < COOL) return false;   // 규약 3 — 곡끼리 겹치지 않게
      this._at = Shell.now;
      if (kind === 'bright') { this.odeToJoy(); this.burstFireworks(); }
      else { this.fateMotif(); Shell._shake = Math.max(Shell._shake, 14); }
      this.megaStamp(kind, text);
      this.heatUntil = Shell.now + HEAT_HOLD;          // 채팅 폭주
      return true;
    },

    // ---------- 오디오 — 공개 도메인 모티프를 합성한다 (음원 파일 0바이트) ----------
    // 배포 payload 여유가 165KB뿐이라 MP3는 애초에 불가능하다. 기존 Shell.sfx.tone으로 연주한다.
    // 곡 선정 기준은 "첫 음에 알아듣는가" — 분위기만 맞는 무명 진행으로는 사건이 안 각인된다.

    // 베토벤 5번 1악장 동기 — G G G E♭, 그리고 c단조 하강 아르페지오. 약 2.4초
    fateMotif: function () {
      var S = Shell.sfx, G = 392.00, Eb = 311.13;
      [0, .15, .30].forEach(function (d) { S.tone(G, .13, 'triangle', .16, d); });
      S.tone(Eb, .70, 'triangle', .17, .45);
      S.tone(Eb / 4, 2.2, 'sine', .10, .45);                       // 저음 페달 — 무게
      [[G, .95], [Eb, 1.15], [261.63, 1.35], [196.00, 1.60], [155.56, 1.85]]
        .forEach(function (n) { S.tone(n[0], .45, 'triangle', .12, n[1]); });
    },

    // 환희의 송가 첫 소절 — E E F G G F E D. 약 1.8초, 끝에 으뜸화음
    odeToJoy: function () {
      var S = Shell.sfx;
      var E = 329.63, F = 349.23, G = 392.00, D = 293.66;
      [E, E, F, G, G, F, E, D].forEach(function (f, i) {
        S.tone(f, .17, 'triangle', .15, i * .19);
        S.tone(f * 2, .17, 'sine', .05, i * .19);                  // 옥타브 — 밝기
      });
      [261.63, 329.63, 392.00].forEach(function (f, i) {           // C장3화음으로 닫는다
        S.tone(f, .60, 'triangle', .13, 1.55 + i * .02);
      });
    },

    // ---------- 대형 스탬프 — 기존 #bigStamp에 클래스만 얹는다 (새 DOM 0개) ----------
    // 게임이 같은 박자에 자기 문구를 던졌으면 그걸 크게 쓴다 (GUOI "25m 대추락").
    DEFAULT: { bright: '대박', dark: '대참사' },
    megaStamp: function (kind, text) {
      var el = document.getElementById('bigStamp');
      if (!el) return;
      el.classList.add('mega', kind === 'dark' ? 'megaDark' : 'megaBright');
      Shell.showStamp(text || this.DEFAULT[kind]);
      setTimeout(function () { el.classList.remove('mega', 'megaDark', 'megaBright'); }, 1600);
    },

    // ---------- 폭죽 — 밝은 사건에만. 대참사에 폭죽은 조롱이 된다 (규약 2의 정신) ----------
    burstFireworks: function () {
      var COLORS = ['#ffd24a', '#00ffa3', '#7de8ff', '#ffb0c8', '#ffb447'];
      for (var b = 0; b < 3; b++) {
        var cx = 180 + Math.random() * 600, cy = 70 + Math.random() * 140;
        var col = COLORS[Math.floor(Math.random() * COLORS.length)];
        var delay = b * .22;                                       // 세 발이 연달아 (한 번에 터지면 뭉친다)
        for (var i = 0; i < 26; i++) {
          var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 170;
          this._px.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                          life: 0, max: .8 + Math.random() * .5, c: col, d: delay });
        }
      }
    },

    // 셸의 draw 루프가 매 프레임 부른다 (게임 화면 위, 화면 효과 밑)
    draw: function (ctx, dt) {
      var px = this._px;
      if (!px.length) return;
      for (var i = px.length - 1; i >= 0; i--) {
        var p = px[i];
        if (p.d > 0) { p.d -= dt; continue; }                      // 아직 안 터진 발
        p.life += dt;
        if (p.life >= p.max) { px.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vy += 210 * dt;                                          // 중력 — 떨어져야 폭죽으로 읽힌다
        p.vx *= .985; p.vy *= .985;
        ctx.globalAlpha = 1 - p.life / p.max;
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
    },
  };
})();
