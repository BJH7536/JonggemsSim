/* 풍선쇼 — 떠오르는 풍선이 계속 부푼다. 클수록 비싸고, 너무 키우면 저절로 터진다.
 *
 * 공통 명제 유지 — **안전한 플레이가 최악의 전략이다.**
 *   보이는 족족 즉시 터뜨림 ×1.0 (절대 안 놓침)  ≪  익혀서 터뜨림 ×2~3  ≪  만개 ×4.0
 * 안전은 절대 손해를 안 보는 대신 단가가 바닥이다. 지르려면 여러 개를 동시에 익혀야 하는데,
 * 스폰율은 라운드마다 오르므로 만료가 겹치는 순간 무더기로 잃는다 — 처리량과 단가의 교환.
 *
 * 3D (WebGL): 풍선은 games/balloon/gl.js가 실제 GPU 파이프라인으로 그린다. 오프스크린에
 * 그린 뒤 셸의 2D 캔버스에 합성하는 이유는 gl.js 머리말 참조 (클립 캡처 계약).
 * 깊이가 생기면서 **가까운 풍선이 크게 보이고 판정도 그만큼 커진다** — 원근이 곧 난이도다.
 *
 * 규약 2: 자연 파열은 무연출·무효과음. 숫자만 조용히 빠진다.
 * 규약 3: 큰 자극(만개·콤보 마일스톤)은 서로 겹치지 않게 셸 큐·sfx.gate에 맡긴다.
 * 규약 5: 뼈대 = 익음배수·콤보(실력 연동). 양념 = 도네(셸 소유).
 * 라운드(30초×6)는 게임이 소유하는 내부 구획이다 — 셸의 방송 시계 180초는 건드리지 않는다.
 */
(function () {
  'use strict';

  var U = Shell.util, clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  var sfx = Shell.sfx;

  var SHOW_TIME = 180;
  var START_VIEWERS = 300;

  // ---------- 밸런스 상수 ----------
  var ROUNDS = 6, ROUND_TIME = 30;
  var RATE = [1, 1.3, 1.6, 2.0, 2.4, 2.9];   // 라운드별 스폰율 배수
  var SPAWN_BASE = 0.9;                       // 초당 스폰 (라운드 배수 적용 → R6 2.6/s)
  var LIFE = 2.6;                             // 수명 고정 — 압박은 스폰율만으로 준다
  var R_MIN = 14, R_MAX = 40;
  var PAY_BASE = 30, PAY_SPAN = 3;            // 획득 = BASE × (1 + SPAN×익음도) → 30~120
  // 자연 파열은 정의상 항상 만개 상태에서 일어난다(t=1) — 손실은 상수다.
  var BURST_LOSS = 140;
  var BLOOM_T = 0.9;                          // 만개 판정 익음도
  var FLOOD_N = 6;
  var MILES = [1000, 5000, 15000, 60000, 150000];

  // 깊이 — z가 클수록 카메라에 가깝다. 가까운 풍선은 크게 보이고 클릭 판정도 커진다
  var Z_NEAR = 110, Z_FAR = -170;

  // ---------- 풍선쇼 전용 점수 (시청자 수와 별개) ----------
  // 시청자 수는 셸이 소유하는 방송 성적이다. 이 점수는 "이 게임을 얼마나 잘했나"만 말한다 —
  // 익음배수 × 콤보라 안전 플레이로는 절대 높은 수가 안 나온다 (공통 명제와 같은 방향).
  var SCORE_BASE = 100;
  var COMBO_STEP = 0.05, COMBO_CAP = 20;      // 콤보 1당 +5%, 20에서 상한 (×2.0)
  var COMBO_MILES = [5, 10, 15, 20];

  var COLORS = ['#ff6b8a', '#ffb347', '#7de8ff', '#a8e063', '#c58aff'];
  var RGB = COLORS.map(hex2rgb);

  /* 산식을 순수 함수로 떼어 둔 이유는 shopBuy·rigUp과 같다 — 점수가 조용히 틀리면
     "잘하고 있나"라는 유일한 즉시 피드백이 거짓말을 한다. 검증: games/shell/selftest.html */
  var MATH = {
    payMul: function (t) { return 1 + PAY_SPAN * t; },              // 익음배수 1.0 → 4.0
    comboMul: function (c) { return 1 + COMBO_STEP * Math.min(Math.max(c, 0), COMBO_CAP); },
    score: function (t, combo) {
      return Math.round(SCORE_BASE * MATH.payMul(t) * MATH.comboMul(combo));
    },
    // 상수 140이 설계값이지만 시작 시청자 300에서는 두 번이면 방송이 죽는다 — 초반만 완화
    burstLoss: function (viewers) { return Math.min(BURST_LOSS, Math.max(30, viewers * .25)); },
  };
  window.BALLOON_MATH = MATH;

  function hex2rgb(h) {
    var n = parseInt(h.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  // ---------- 아트 (지연 로드 — contract 4.1 preload) ----------
  // 파열 VFX는 4×4 시트다. 생성물이 흰 배경으로 와서 최적화기가 검정으로 뒤집었고,
  // 여기서 'screen' 블렌드로 얹으면 알파 없이도 이펙트만 떠오른다 (주머니 괴수와 같은 규약)
  var VFX_DUR = 0.42, VFX_GRID = 4;
  var art = { stage: null, pop: null, ready: false, popReady: false };
  function loadArt() {
    if (art.stage) return;
    var im = new Image();
    im.onload = function () { art.ready = true; };
    im.src = 'games/balloon/img/stage-bg.jpg';
    art.stage = im;
    var vp = new Image();
    vp.onload = function () { art.popReady = true; };
    vp.src = 'games/balloon/img/vfx-pop.jpg';
    art.pop = vp;
  }

  // ---------- SFX (절차 합성 — 외부 에셋 0) ----------
  var sfxPop = function (t) {
    if (!sfx.gate('bl_p')) return;
    sfx.noise(.05, .06, 1200 - t * 500);
    sfx.tone(520 - t * 220, .07, 'triangle', .05 + t * .05);
  };
  var sfxBloom = function () {
    if (!sfx.gate('bl_b')) return;
    sfx.tone(523, .08, 'triangle', .09); sfx.tone(784, .09, 'triangle', .09, .06);
    sfx.tone(1047, .16, 'triangle', .1, .12);
  };
  var sfxRound = function () {
    if (!sfx.gate('bl_r')) return;
    sfx.tone(392, .1, 'sine', .07); sfx.tone(587, .14, 'sine', .06, .09);
    sfx.tone(784, .2, 'sine', .06, .18);
  };
  var sfxCombo = function (n) {
    if (!sfx.gate('bl_c')) return;
    var base = 440 * Math.pow(2, Math.min(n, 20) / 24);
    sfx.tone(base, .08, 'square', .05);
    sfx.tone(base * 1.5, .14, 'square', .045, .07);
  };
  // 만개 임박 — 조용한 압박. 이 소리가 "지금이다"를 귀로 알린다
  var sfxRipe = function () {
    if (!sfx.gate('bl_w')) return;
    sfx.tone(1760, .04, 'sine', .028);
  };

  /* ---------- BGM (절차 합성 — 외부 에셋 0) ----------
   * 라운드가 오를수록 템포와 성부가 늘어난다. 압박이 귀로도 올라가야 마지막 라운드가
   * 실제보다 급해 보인다. tone()으로는 못 만든다 — 멈추려면 노드를 들고 있어야 한다. */
  function makeBgm() {
    var a = sfx.ctx && sfx.ctx();
    if (!a) return null;
    var master = a.createGain();
    master.gain.value = 0;
    master.connect(a.destination);
    var SCALE = [0, 3, 5, 7, 10, 12, 15];      // 단5음 계열 — 밝지 않고 몰아친다
    return {
      next: 0, beat: 0, dead: false,
      start: function () {
        this.next = a.currentTime + .08;
        master.gain.cancelScheduledValues(a.currentTime);
        master.gain.setValueAtTime(0, a.currentTime);
        master.gain.linearRampToValueAtTime(.05, a.currentTime + 1.2);
      },
      stop: function () {
        this.dead = true;
        try {
          master.gain.cancelScheduledValues(a.currentTime);
          master.gain.setValueAtTime(master.gain.value, a.currentTime);
          master.gain.linearRampToValueAtTime(0, a.currentTime + .25);
        } catch (e) {}
      },
      note: function (freq, at, dur, type, vol) {
        var o = a.createOscillator(), g = a.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(vol, at + .012);
        g.gain.exponentialRampToValueAtTime(.0001, at + dur);
        o.connect(g); g.connect(master);
        o.start(at); o.stop(at + dur + .02);
      },
      // 프레임마다 호출 — 0.3초 앞까지 미리 예약한다 (rAF 지터에 박자가 흔들리지 않게)
      tick: function (round) {
        if (this.dead) return;
        // 컨텍스트가 suspended였다가(사용자 제스처 전) 깨어나면 currentTime이 훌쩍 뛴다.
        // 그때 밀린 박자를 따라잡으려 들면 수십 음이 한 시각에 몰려 굉음이 된다 —
        // 뒤처졌으면 따라잡지 않고 현재 시각에서 다시 센다
        if (a.state !== 'running') return;
        if (this.next < a.currentTime - .5) { this.next = a.currentTime + .05; this.beat = 0; }
        var bpm = 104 + round * 9;
        var spb = 60 / bpm;
        while (this.next < a.currentTime + .3) {
          var b = this.beat, t = this.next;
          if (b % 2 === 0) this.note(55, t, .16, 'triangle', .5);          // 베이스
          if (b % 4 === 2) this.note(110, t, .1, 'square', .16);           // 오프비트
          if (round >= 1) {
            var s = SCALE[(b * 3) % SCALE.length];
            this.note(220 * Math.pow(2, s / 12), t, .1, 'square', .1);     // 아르페지오
          }
          if (round >= 3 && b % 8 === 6) this.note(880, t, .07, 'sawtooth', .07); // 상단 장식
          this.next += spb; this.beat++;
        }
      },
    };
  }

  // 스폰 금지 구역 — 셸 명판(좌상단)과 스트리머 캠(우하단)에 가리면 못 누른다.
  // 판정은 투영 후 좌표로 하므로 여기서도 투영값을 본다
  function spawnSpot(list, gl) {
    for (var try_ = 0; try_ < 26; try_++) {
      var z = rnd(Z_FAR, Z_NEAR);
      var x = rnd(70, 890), y = rnd(76, 366);
      var p = gl ? gl.project(x, y, z) : { x: x, y: y, scale: 1 };
      if (p.x < 300 && p.y < 62) continue;        // HUD 명판
      if (p.x > 762 && p.y > 288) continue;       // 스트리머 캠
      if (p.x < 40 || p.x > 920 || p.y < 50 || p.y > 392) continue;
      var ok = true;
      for (var i = 0; i < list.length; i++) {
        var q = list[i]._p || { x: list[i].x, y: list[i].y };
        var dx = q.x - p.x, dy = q.y - p.y;
        if (dx * dx + dy * dy < 90 * 90) { ok = false; break; }
      }
      if (ok) return { x: x, y: y, z: z };
    }
    return null; // 자리가 없으면 이번 스폰은 거른다 — 겹쳐 뜨면 누를 수 없다
  }

  function start(stage) {
    var st = {
      round: 0, roundPop: 0, roundMiss: 0, flooded: false,
      pops: 0, blooms: 0, bursts: 0, ripeSum: 0, maxAlive: 0,
      score: 0, scoreShown: 0, combo: 0, bestCombo: 0, comboMile: 0, scorePulse: 0,
      balloons: [], puffs: [], floaters: [], confetti: [], shocks: [],
      spawnAcc: 0, idleT: 0, chatT: 3, mileIdx: 0,
    };
    var panel = stage.panel;
    var gl = window.BalloonGL ? window.BalloonGL.create() : null;
    var bgm = makeBgm();
    if (bgm) bgm.start();
    loadArt();

    function rate() { return SPAWN_BASE * RATE[clamp(st.round, 0, ROUNDS - 1)]; }
    function ripe(b) { return clamp((stage.now - b.born) / LIFE, 0, 1); }
    function floater(x, y, txt, c, big) { st.floaters.push({ x: x, y: y, txt: txt, t: 0, c: c, big: big }); }
    function comboMul() { return MATH.comboMul(st.combo); }

    // 투영 — WebGL이 없으면 z를 무시한 1:1 (2D 폴백)
    function proj(b) {
      return gl ? gl.project(b.x, b.y, b.z) : { x: b.x, y: b.y, scale: 1 };
    }

    // ---------- HUD · 조작 안내 ----------
    stage.hud('⏱ 방송 <b id="blTime">3:00</b> · R<b id="blRnd">1</b>/6 · ' +
              '터뜨림 <b id="blPop">0</b> · 만개 <b id="blBloom">0</b> · 파열 <b id="blBurst">0</b>');
    function renderHUD() {
      var e;
      if ((e = document.getElementById('blRnd'))) e.textContent = st.round + 1;
      if ((e = document.getElementById('blPop'))) e.textContent = st.pops;
      if ((e = document.getElementById('blBloom'))) e.textContent = st.blooms;
      if ((e = document.getElementById('blBurst'))) e.textContent = st.bursts;
    }
    panel.innerHTML =
      '<div style="width:100%;text-align:center;padding:10px 12px;line-height:1.7">' +
        '<div style="font-size:20px;color:#ece7dd"><b>풍선을 클릭해 터뜨린다.</b> 부풀수록 비싸다 — ' +
          '<span style="color:#7de8ff">작을 때 ×1.0</span> · ' +
          '<span style="color:#ffb347">중간 ×2.2</span> · ' +
          '<span style="color:#ff6b8a">만개 ×4.0</span></div>' +
        '<div style="font-size:16px;color:#8a8478">연속으로 터뜨리면 <b style="color:#7de8ff">콤보</b>가 붙어 점수가 커진다 · ' +
          '저절로 터지면 콤보가 끊기고 부푼 만큼 잃는다 · 30초마다 라운드가 올라 풍선이 더 자주 뜬다</div>' +
      '</div>';

    // ---------- 라운드 ----------
    function checkRound() {
      var r = clamp(Math.floor((SHOW_TIME - stage.timeLeft) / ROUND_TIME), 0, ROUNDS - 1);
      if (r === st.round) return;
      if (st.roundMiss === 0 && st.roundPop > 0) {
        stage.stamp('R' + (st.round + 1) + ' 무파열');
        stage.emit('perfect_round', { r: String(st.round + 1) });
      }
      st.round = r; st.roundPop = 0; st.roundMiss = 0; st.flooded = false;
      sfxRound();
      stage.flash(.12);
      stage.ticker('라운드 ' + (r + 1) + ' — 풍선이 더 자주 뜬다', false);
      stage.emit('round_up', { r: String(r + 1) });
      renderHUD();
    }

    // ---------- 터뜨리기 ----------
    function pop(b) {
      var t = ripe(b);
      var bloom = t >= BLOOM_T;
      var mul = MATH.payMul(t);
      var p = proj(b);
      var actual = stage.gain(Math.round(PAY_BASE * mul),
        bloom ? '만개!! ×' + mul.toFixed(1) : null, bloom ? 'bloom' : 'pop');

      // 전용 점수 — 익음배수 × 콤보. 안전 플레이로는 절대 안 오른다
      st.combo++;
      st.bestCombo = Math.max(st.bestCombo, st.combo);
      var pts = MATH.score(t, st.combo);
      st.score += pts;
      st.scorePulse = 1;

      st.pops++; st.roundPop++; st.ripeSum += t;
      st.puffs.push({ x: p.x, y: p.y, r: b.r * p.scale, c: b.c, born: stage.now });
      spawnConfetti(b, p, bloom);
      floater(p.x, p.y - b.r * p.scale - 8, '+' + pts.toLocaleString(), bloom ? '#ff6b8a' : '#ffd27a', bloom);
      sfxPop(t);
      if (bloom) {
        st.blooms++;
        sfxBloom();
        // 충격파 — 만개는 이 게임의 절정이다. 파열 시트·색종이 위에 한 겹 더 얹어
        // "제때 눌렀다"가 화면 전체로 퍼지게 한다 (규약 2 — 획득은 과하게)
        st.shocks.push({ x: p.x, y: p.y, r0: b.r * p.scale, t: 0 });
        stage.flash(.2); stage.shake(5);
        stage.emit('bloom', { gain: actual.toLocaleString() });
      } else if (Math.random() < .12) {
        stage.emit('pop');
      }
      // 콤보 마일스톤 — 큰 자극이라 마일스톤에서만 (규약 3)
      if (st.comboMile < COMBO_MILES.length && st.combo >= COMBO_MILES[st.comboMile]) {
        st.comboMile++;
        sfxCombo(st.combo);
        stage.stamp(st.combo + ' COMBO');
        stage.shake(3);
      }
      stage.setChain(mul * comboMul());
      renderHUD();
    }

    // ---------- 자연 파열 (규약 2 — 무연출·무효과음) ----------
    function burst(b) {
      var p = proj(b);
      // 손실은 상수(140)가 설계값이지만, 시작 시청자가 300이라 두 번만 놓치면 10초 만에
      // 방송이 죽는다 — 처음 잡아 보는 사람은 반드시 두어 번 놓친다. 채널 규모의 1/4로
      // 상한을 둬 초반 즉사만 막는다. 채널이 크면(560명 이상) 원래 상수 그대로다
      stage.lose(MATH.burstLoss(stage.viewers));
      st.bursts++; st.roundMiss++;
      st.combo = 0; st.comboMile = 0;          // 콤보는 조용히 끊긴다 (손실 무연출)
      st.puffs.push({ x: p.x, y: p.y, r: b.r * p.scale, c: '#5a5650', born: stage.now, dull: true });
      if (Math.random() < .35) stage.emit('burst');
      renderHUD();
    }

    // ---------- 색종이 (3D 좌표로 날린 뒤 투영해 그린다 — 깊이를 따른다) ----------
    function spawnConfetti(b, p, bloom) {
      var n = bloom ? 26 : 12;
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU, e = (Math.random() - .35) * 2;
        var sp = (bloom ? 190 : 120) * (.5 + Math.random());
        st.confetti.push({
          x: b.x, y: b.y, z: b.z,
          vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a) * sp) - 40 * e, vz: (Math.random() - .5) * sp,
          c: Math.random() < .5 ? b.c : COLORS[rnd(0, COLORS.length - 1)],
          rot: Math.random() * TAU, vr: (Math.random() - .5) * 14,
          t: 0, life: .7 + Math.random() * .5,
        });
      }
    }

    // ---------- 주변 채팅 ----------
    function ambient() {
      if (st.mileIdx < MILES.length && stage.viewers >= MILES[st.mileIdx]) {
        stage.emit('milestone', { v: MILES[st.mileIdx++].toLocaleString() });
        return;
      }
      if (st.idleT > 3.5) { stage.emit('nag'); return; }
      stage.emit('idle');
    }

    stage.ticker('방송 시작! 풍선을 클릭해 터뜨려라 — 부풀수록 비싸다', false);
    renderHUD();

    // ================= 인스턴스 =================
    return {
      st: st,

      step: function (dt) {
        var e = document.getElementById('blTime');
        if (e) e.textContent = U.fmtTime(stage.timeLeft);
        checkRound();
        if (bgm) bgm.tick(st.round);

        st.spawnAcc += rate() * dt;
        while (st.spawnAcc >= 1) {
          st.spawnAcc -= 1;
          var spot = spawnSpot(st.balloons, gl);
          if (!spot) continue;
          var ci = rnd(0, COLORS.length - 1);
          st.balloons.push({
            x: spot.x, y: spot.y, z: spot.z, born: stage.now, r: R_MIN,
            c: COLORS[ci], rgb: RGB[ci], sway: Math.random() * TAU, warned: false,
          });
        }

        // 부풀기·만료 — 투영값은 클릭 판정과 그리기가 같이 쓰므로 여기서 한 번만 계산한다
        for (var i = st.balloons.length - 1; i >= 0; i--) {
          var b = st.balloons[i];
          var t = ripe(b);
          b.r = R_MIN + (R_MAX - R_MIN) * t;
          b.y -= (6 + t * 10) * dt;                    // 천천히 떠오른다
          b._p = proj(b);
          if (!b.warned && t >= BLOOM_T - .12) { b.warned = true; sfxRipe(); }
          if (t >= 1) { burst(b); st.balloons.splice(i, 1); }
        }
        st.maxAlive = Math.max(st.maxAlive, st.balloons.length);

        if (!st.flooded && st.balloons.length >= FLOOD_N) {
          st.flooded = true;
          stage.emit('flood', { n: String(st.balloons.length) });
        }

        st.idleT += dt;
        if (st.idleT > 3.5 && st.balloons.length > 0) {
          stage.lose(Math.max(1, stage.viewers * 0.006) * dt);
        }

        stage.donRoll(dt, 9, .45);
        st.chatT -= dt;
        if (st.chatT <= 0) {
          st.chatT = clamp(3.8 - Math.log10(stage.viewers + 10) * .55, 1.2, 3.8) + Math.random() * 1.4;
          ambient();
        }

        // 색종이 적분 (중력 + 공기저항)
        for (var k = st.confetti.length - 1; k >= 0; k--) {
          var f = st.confetti[k];
          f.t += dt;
          if (f.t >= f.life) { st.confetti.splice(k, 1); continue; }
          f.vy += 420 * dt; f.vx *= .985; f.vz *= .985;
          f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
          f.rot += f.vr * dt;
        }
        // 점수는 튀지 않고 굴러 올라간다 — 숫자가 도는 동안이 '벌고 있다'는 감각이다
        if (st.scoreShown < st.score) {
          st.scoreShown = Math.min(st.score, st.scoreShown + Math.max(120, (st.score - st.scoreShown) * 7) * dt);
        }
        st.shocks = st.shocks.filter(function (s) { s.t += dt; return s.t < .42; });
        st.scorePulse = Math.max(0, st.scorePulse - dt * 3);
        st.puffs = st.puffs.filter(function (p) { return stage.now - p.born < .45; });
        st.floaters = st.floaters.filter(function (f2) { f2.t += dt; return f2.t < .9; });
      },

      // 겹쳐 있으면 익은 것부터 — 화면에서도 익은 것이 위에 그려진다
      pointer: function (p, type) {
        if (type !== 'down' || !stage.live) return;
        var best = -1, bestT = -1;
        for (var i = 0; i < st.balloons.length; i++) {
          var b = st.balloons[i], q = b._p || proj(b);
          var rr = b.r * q.scale;                     // 가까운 풍선은 판정도 크다
          var dx = p.x - q.x, dy = p.y - q.y;
          if (dx * dx + dy * dy > rr * rr) continue;
          var t = ripe(b);
          if (t > bestT) { bestT = t; best = i; }
        }
        if (best < 0) return;
        st.idleT = 0;
        pop(st.balloons[best]);
        st.balloons.splice(best, 1);
      },

      summary: function () {
        var avg = st.pops ? Math.round(st.ripeSum / st.pops * 100) : 0;
        return [
          ['풍선쇼 점수', st.score.toLocaleString() + '점'],
          ['터뜨림 / 자연 파열', st.pops + ' / ' + st.bursts],
          ['평균 익음도 · 만개', avg + '% · ' + st.blooms + '회'],
          ['최고 콤보 · 최고 동시', st.bestCombo + ' · ' + st.maxAlive + '개'],
        ];
      },

      dispose: function () {
        panel.innerHTML = '';
        if (bgm) bgm.stop();
        if (gl) gl.dispose();
      },

      // ================= 씬 =================
      draw: function (ctx) {
        var t = stage.now;
        drawStudio(ctx, t);

        if (gl) {
          // 뒤에서 앞으로 — 깊이 버퍼가 가려 주지만 만개 글로우(2D)는 순서를 탄다
          var list = st.balloons.slice().sort(function (a, b) { return a.z - b.z; });
          gl.render(list.map(function (b) {
            var rt = ripe(b);
            // 호흡 — 익을수록 빠르고 깊게 헐떡인다. 고무가 버티는 소리를 눈으로 보여 준다.
            // 부피는 유지(가로가 늘면 세로가 준다)해야 부푸는 게 아니라 '눌리는' 것으로 읽힌다
            var br = 1 + .045 * rt * Math.sin(t * (5 + rt * 16) + b.sway);
            return {
              x: b.x + Math.sin(t * 1.7 + b.sway) * (2 + rt * 3), y: b.y, z: b.z, r: b.r,
              sx: br, sy: 1 / br,
              rgb: b.rgb, bloom: rt >= BLOOM_T ? (.5 + .5 * Math.sin(t * 18)) : 0,
            };
          }), 1);
          drawStrings(ctx, t);
          ctx.drawImage(gl.canvas, 0, 0);
          drawGlow(ctx, t);
        } else {
          st.balloons.slice().sort(function (a, b) { return ripe(a) - ripe(b); })
            .forEach(function (b) { drawBalloon2D(ctx, b, t); });
        }

        drawShocks(ctx);
        drawPopFx(ctx, t);
        drawConfetti(ctx);
        drawPuffs(ctx, t);
        st.floaters.forEach(function (f) {
          ctx.globalAlpha = 1 - f.t / .9;
          ctx.fillStyle = f.c;
          ctx.font = 'bold ' + (f.big ? 30 : 21) + 'px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(f.txt, f.x, f.y - f.t * 34);
          ctx.globalAlpha = 1;
        });
        drawScore(ctx);
      },
    };

    // ---------- 배경 ----------
    function drawStudio(ctx, t) {
      if (art.ready) {
        ctx.drawImage(art.stage, 0, 0, 960, 430);
      } else {
        var g = ctx.createLinearGradient(0, 0, 0, 430);
        g.addColorStop(0, '#1b1830'); g.addColorStop(.55, '#161426'); g.addColorStop(1, '#0e0d18');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 430);
      }
      // 조명 콘 — 깜빡임이 방송의 생동감이라 정지 이미지로 대체하지 않는다
      [280, 680].forEach(function (lx, k) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var fl = 1 + .06 * Math.sin(t * 5 + k * 2.3);
        var cone = ctx.createRadialGradient(lx, -20, 10, lx, 300, 330 * fl);
        cone.addColorStop(0, 'rgba(170,150,255,.10)'); cone.addColorStop(1, 'rgba(170,150,255,0)');
        ctx.fillStyle = cone; ctx.fillRect(lx - 330, 0, 660, 430);
        ctx.restore();
      });
    }

    // ---------- 3D 보조 레이어 ----------
    function drawStrings(ctx, t) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      st.balloons.forEach(function (b) {
        var p = b._p || proj(b), rr = b.r * p.scale;
        var sway = Math.sin(t * 1.7 + b.sway) * (2 + ripe(b) * 3) * p.scale;
        ctx.lineWidth = Math.max(.8, 1.4 * p.scale);
        ctx.beginPath();
        ctx.moveTo(p.x + sway, p.y + rr * 1.24);
        ctx.quadraticCurveTo(p.x + sway * 1.6, p.y + rr + 18 * p.scale, p.x - sway, p.y + rr + 34 * p.scale);
        ctx.stroke();
      });
      ctx.restore();
    }

    // 만개 창은 못 보면 "지금 터뜨릴까"라는 선택 자체가 성립하지 않는다 — 3D 위에 덧그린다
    function drawGlow(ctx, t) {
      // 파열 임박 링 — 만개 전부터 조여 온다. 0.3초짜리 만개 창만으로는 반응할 시간이 없어
      // "언제 터질지"가 운이 된다. 링이 닫히는 속도가 곧 남은 시간이다
      ctx.save();
      st.balloons.forEach(function (b) {
        var rt = ripe(b);
        if (rt < .72) return;
        var p = b._p || proj(b), rr = b.r * p.scale;
        var k = (rt - .72) / .28;                       // 0 → 1 로 조여든다
        ctx.strokeStyle = 'rgba(255,150,180,' + (.25 + .5 * k) + ')';
        ctx.lineWidth = 1.5 + 2 * k;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * (2.2 - 1.05 * k), 0, TAU);
        ctx.stroke();
      });
      ctx.restore();

      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      st.balloons.forEach(function (b) {
        var rt = ripe(b);
        if (rt < BLOOM_T) return;
        var p = b._p || proj(b), rr = b.r * p.scale;
        var a = .26 + .18 * Math.sin(t * 18);
        var gl2 = ctx.createRadialGradient(p.x, p.y, rr * .5, p.x, p.y, rr * 2.1);
        gl2.addColorStop(0, 'rgba(255,120,160,' + a + ')');
        gl2.addColorStop(1, 'rgba(255,120,160,0)');
        ctx.fillStyle = gl2;
        ctx.fillRect(p.x - rr * 2.1, p.y - rr * 2.1, rr * 4.2, rr * 4.2);
      });
      ctx.restore();
    }

    function drawConfetti(ctx) {
      ctx.save();
      st.confetti.forEach(function (f) {
        var p = gl ? gl.project(f.x, f.y, f.z) : { x: f.x, y: f.y, scale: 1 };
        var s = 7 * p.scale;
        ctx.globalAlpha = clamp(1 - f.t / f.life, 0, 1);
        ctx.fillStyle = f.c;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(f.rot);
        ctx.fillRect(-s * .5, -s * .28, s, s * .56);
        ctx.restore();
      });
      ctx.restore();
    }

    // 생성 VFX 시트 — 있으면 터짐의 주역, 없으면 아래 벡터 퍼프가 그대로 받는다
    function drawPopFx(ctx, t) {
      if (!art.popReady) return;
      var im = art.pop, n = VFX_GRID * VFX_GRID;
      var fw = im.naturalWidth / VFX_GRID, fh = im.naturalHeight / VFX_GRID;
      var inx = fw * .04, iny = fh * .04;   // 시트 격자선 제거 (생성물이 칸을 선으로 나눠 온다)
      st.puffs.forEach(function (p) {
        if (p.dull) return;                  // 자연 파열은 무연출 (규약 2)
        var k = (t - p.born) / VFX_DUR;
        if (k < 0 || k >= 1) return;
        var idx = Math.min(n - 1, (k * n) | 0);
        var size = p.r * 5.2;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = k > .8 ? (1 - k) * 5 : 1;
        ctx.drawImage(im,
          (idx % VFX_GRID) * fw + inx, ((idx / VFX_GRID) | 0) * fh + iny,
          fw - inx * 2, fh - iny * 2,
          p.x - size / 2, p.y - size / 2, size, size);
        ctx.restore();
      });
    }

    function drawPuffs(ctx, t) {
      st.puffs.forEach(function (p) {
        var k = (t - p.born) / .45;
        ctx.save();
        ctx.globalAlpha = (1 - k) * (p.dull ? .45 : .8);
        ctx.strokeStyle = p.c; ctx.lineWidth = p.dull ? 2 : 3.5;
        for (var i = 0; i < 8; i++) {
          var a = i / 8 * TAU + p.born;
          var r0 = p.r * (.7 + k * .9), r1 = r0 + (p.dull ? 5 : 12) * (1 - k);
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
          ctx.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    /* 전용 점수 — 방송 내내 화면에 떠 있어야 한다. 정산 리포트에서만 보여 주면
       "잘하고 있나"를 플레이 중에 알 수 없다 (미션 피드백과 같은 이유) */
    function drawScore(ctx) {
      var pulse = 1 + st.scorePulse * .18;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.fillText('SCORE', 480, 26);
      ctx.translate(480, 62); ctx.scale(pulse, pulse);
      ctx.fillStyle = st.scorePulse > .01 ? '#fff3c4' : '#ffd27a';
      ctx.font = 'bold 40px Georgia, serif';
      ctx.fillText(Math.round(st.scoreShown).toLocaleString(), 0, 0);
      ctx.restore();

      if (st.combo >= 2) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 8;
        ctx.fillStyle = st.combo >= 10 ? '#ff6b8a' : '#7de8ff';
        ctx.font = 'bold 26px system-ui, sans-serif';
        ctx.fillText(st.combo + ' COMBO  ×' + comboMul().toFixed(2), 480, 96);
        ctx.restore();
      }
      // 고콤보 — 화면 테두리가 달아오른다. 숫자만으로는 "지금 불붙었다"가 안 읽힌다
      if (st.combo >= 10) {
        var heat = Math.min(1, (st.combo - 10) / 10);
        ctx.save();
        var eg = ctx.createLinearGradient(0, 0, 0, 430);
        var a2 = (.12 + .1 * heat) * (.75 + .25 * Math.sin(stage.now * 9));
        eg.addColorStop(0, 'rgba(255,107,138,' + a2 + ')');
        eg.addColorStop(.22, 'rgba(255,107,138,0)');
        eg.addColorStop(.78, 'rgba(255,107,138,0)');
        eg.addColorStop(1, 'rgba(255,107,138,' + a2 + ')');
        ctx.fillStyle = eg; ctx.fillRect(0, 0, 960, 430);
        ctx.restore();
      }
    }

    // 만개 충격파 — 3D 위, 색종이 아래
    function drawShocks(ctx) {
      ctx.save();
      st.shocks.forEach(function (s) {
        var k = s.t / .42;
        ctx.globalAlpha = (1 - k) * .55;
        ctx.strokeStyle = '#ffd6e2';
        ctx.lineWidth = 3 * (1 - k) + .8;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r0 + 140 * k, 0, TAU);
        ctx.stroke();
      });
      ctx.restore();
    }

    // ---------- 2D 폴백 (WebGL 불가 환경) ----------
    function drawBalloon2D(ctx, b, t) {
      var rt = ripe(b);
      var sway = Math.sin(t * 1.7 + b.sway) * (2 + rt * 3);
      var x = b.x + sway, y = b.y;
      var bloom = rt >= BLOOM_T;
      if (bloom) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var g2 = ctx.createRadialGradient(x, y, b.r * .4, x, y, b.r * 2);
        var a = .28 + .18 * Math.sin(t * 18);
        g2.addColorStop(0, 'rgba(255,120,160,' + a + ')'); g2.addColorStop(1, 'rgba(255,120,160,0)');
        ctx.fillStyle = g2; ctx.fillRect(x - b.r * 2, y - b.r * 2, b.r * 4, b.r * 4);
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x, y + b.r * 1.06);
      ctx.quadraticCurveTo(x + sway * 1.6, y + b.r + 16, x - sway, y + b.r + 30); ctx.stroke();
      var bg = ctx.createRadialGradient(x - b.r * .32, y - b.r * .38, b.r * .1, x, y, b.r * 1.1);
      bg.addColorStop(0, '#ffffff'); bg.addColorStop(.22, b.c); bg.addColorStop(1, shade(b.c, -.32));
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.ellipse(x, y, b.r * .92, b.r * 1.06, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = bloom ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.25)';
      ctx.lineWidth = bloom ? 2.4 : 1.5; ctx.stroke();
      ctx.fillStyle = shade(b.c, -.4);
      ctx.beginPath(); ctx.moveTo(x - 4, y + b.r * 1.04); ctx.lineTo(x + 4, y + b.r * 1.04);
      ctx.lineTo(x, y + b.r * 1.16); ctx.closePath(); ctx.fill();
    }

    function shade(hex, k) {
      var n = parseInt(hex.slice(1), 16);
      var r = clamp(((n >> 16) & 255) * (1 + k), 0, 255) | 0;
      var g = clamp(((n >> 8) & 255) * (1 + k), 0, 255) | 0;
      var b = clamp((n & 255) * (1 + k), 0, 255) | 0;
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }
  }

  Shell.register({
    id: 'balloon',
    title: '풍선쇼',
    tagline: '보이는 족족 터뜨리면 절대 안 놓치지만 전부 최저가다. 익힐수록 비싸지고, 욕심이 겹치는 순간 무더기로 터진다.',
    duration: SHOW_TIME,
    startViewers: START_VIEWERS,
    usesChain: true,
    chat: window.BALLOON_CHAT,
    preload: loadArt,
    tuning: {
      SPAWN_BASE: SPAWN_BASE, RATE: RATE, LIFE: LIFE,
      PAY_BASE: PAY_BASE, PAY_SPAN: PAY_SPAN,
      BURST_LOSS: BURST_LOSS, BLOOM_T: BLOOM_T,
      SCORE_BASE: SCORE_BASE, COMBO_STEP: COMBO_STEP, COMBO_CAP: COMBO_CAP,
    },
    foot: '풍선을 <b>클릭</b>해 터뜨린다 — 부풀수록 비싸다(×1.0 → ×4.0). ' +
          '하얗게 빛나면 <b>만개</b>(×4.0) · <b>가까이 뜬 풍선일수록 크고 누르기 쉽다</b><br>' +
          '연속으로 터뜨리면 <b>콤보</b>가 붙어 전용 점수가 커진다 · 저절로 터지면 콤보가 끊기고 크게 잃는다(무연출) · ' +
          '30초마다 라운드가 올라 풍선이 더 자주 뜬다',
    thumb: function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1b1830'); g.addColorStop(1, '#0e0d18');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      [[w * .3, h * .58, 13, '#7de8ff'], [w * .52, h * .44, 20, '#ffb347'], [w * .74, h * .3, 27, '#ff6b8a']]
        .forEach(function (p) {
          c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 1;
          c.beginPath(); c.moveTo(p[0], p[1] + p[2]); c.lineTo(p[0], p[1] + p[2] + 12); c.stroke();
          c.fillStyle = p[3];
          c.beginPath(); c.ellipse(p[0], p[1], p[2] * .92, p[2] * 1.06, 0, 0, Math.PI * 2); c.fill();
        });
    },
    start: start,
  });
})();
