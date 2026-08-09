/* 광클쇼 — 과녁이 계속 뜬다. 크기도 배점도 고정. 배수는 오직 연속에서 온다.
 *
 * 이 게임에는 리스크 **선택**이 없다 — 즉시 처리가 언제나 정답이다. 의도된 것이다
 * (docs/superpowers/specs/2026-08-10-reflex-games-design.md §2). 기존 5종이 판단·긴장·수읽기를
 * 맡으므로 여기는 **실행 순도 100%** 축을 담당한다. 공통 명제(안전한 플레이가 최악)는
 * 같은 뼈대의 자매 게임인 풍선쇼가 진다.
 *
 * 긴장은 선택이 아니라 **잃을 것의 크기**에서 온다: 콤보가 높을수록 한 번의 놓침이 비싸고,
 * 스폰율은 라운드마다 오르는데 수명은 짧아진다. 후반의 ×5는 유지하는 것 자체가 도박이다.
 *
 * 규약 2: 놓침은 무연출·무효과음. 콤보가 0으로 돌아가고 숫자만 조용히 빠진다.
 * 규약 5: 뼈대 = 콤보 배수(실력 연동). 양념 = 도네(셸 소유).
 *
 * ⚠ 밸런스는 1차 조율값 — 스윕 검증 전이다.
 */
(function () {
  'use strict';

  var U = Shell.util, clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  var sfx = Shell.sfx;

  var SHOW_TIME = 180;
  var START_VIEWERS = 300;

  // ---------- 밸런스 상수 ----------
  var ROUNDS = 6, ROUND_TIME = 30;
  var RATE = [1, 1.3, 1.6, 2.0, 2.4, 2.9];        // 라운드별 스폰율 배수
  var SPAWN_BASE = 1.2;                            // 초당 스폰 → R6 3.5/s (인간 처리 한계 근처)
  var LIFE = [1.9, 1.7, 1.5, 1.3, 1.15, 1.0];      // 수명은 라운드마다 짧아진다 (풍선쇼와 반대 축)
  var TARGET_R = 24;
  var PAY_BASE = 22;                               // 획득 = BASE × 콤보배수 → 22~110
  var LOSS = 80;                                   // 놓침 정액 — 콤보 리셋이 진짜 벌이다
  var COMBO_STEP = 5, COMBO_ADD = .5, COMBO_MAX = 5;  // 5연속마다 +0.5, 상한 ×5.0 (콤보 40)
  var FLOOD_N = 6;
  var MILES = [1000, 5000, 15000, 60000, 150000];

  // 스폰 금지 구역 — 셸 명판(좌상단)과 스트리머 캠(우하단)에 가리면 못 누른다
  function spawnSpot(list) {
    for (var try_ = 0; try_ < 24; try_++) {
      var x = rnd(46, 914), y = rnd(60, 384);
      if (x < 300 && y < 62) continue;
      if (x > 762 && y > 288) continue;
      var ok = true;
      for (var i = 0; i < list.length; i++) {
        var dx = list[i].x - x, dy = list[i].y - y;
        if (dx * dx + dy * dy < 68 * 68) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    return null;
  }

  // ---------- SFX ----------
  var sfxHit  = function (mul) {
    if (!sfx.gate('cl_h')) return;
    sfx.tone(680 + mul * 90, .05, 'square', .045);
  };
  var sfxUp   = function () {
    if (!sfx.gate('cl_u')) return;
    sfx.tone(784, .08, 'triangle', .09); sfx.tone(1175, .13, 'triangle', .09, .07);
  };
  var sfxRound = function () {
    if (!sfx.gate('cl_r')) return;
    sfx.tone(392, .1, 'sine', .07); sfx.tone(587, .14, 'sine', .06, .09);
  };

  function start(stage) {
    var st = {
      round: 0, roundHit: 0, roundMiss: 0, flooded: false,
      hits: 0, misses: 0, combo: 0, maxCombo: 0, mul: 1, milestone: 1,
      targets: [], rings: [], floaters: [],
      spawnAcc: 0, idleT: 0, chatT: 3, mileIdx: 0,
    };
    var panel = stage.panel;

    function rate() { return SPAWN_BASE * RATE[clamp(st.round, 0, ROUNDS - 1)]; }
    function life() { return LIFE[clamp(st.round, 0, ROUNDS - 1)]; }
    function left(t) { return clamp(1 - (stage.now - t.born) / t.life, 0, 1); }
    function floater(x, y, txt, c) { st.floaters.push({ x: x, y: y, txt: txt, t: 0, c: c }); }

    function comboMul() { return Math.min(COMBO_MAX, 1 + Math.floor(st.combo / COMBO_STEP) * COMBO_ADD); }

    // ---------- HUD · 안내 ----------
    stage.hud('⏱ 방송 <b id="clTime">3:00</b> · R<b id="clRnd">1</b>/6 · ' +
              '처리 <b id="clHit">0</b> · 콤보 <b id="clCombo">0</b> · 놓침 <b id="clMiss">0</b>');
    function renderHUD() {
      var e;
      if ((e = document.getElementById('clRnd'))) e.textContent = st.round + 1;
      if ((e = document.getElementById('clHit'))) e.textContent = st.hits;
      if ((e = document.getElementById('clCombo'))) e.textContent = st.combo;
      if ((e = document.getElementById('clMiss'))) e.textContent = st.misses;
      stage.setChain(st.mul);
    }
    // 조작 UI는 없다 — 캔버스 클릭이 전부다 (인라인 스타일: 셸 CSS 무개입)
    panel.innerHTML =
      '<div style="width:100%;text-align:center;padding:10px 12px;line-height:1.7">' +
        '<div style="font-size:20px;color:#ece7dd"><b>과녁을 클릭해 없앤다.</b> ' +
          '<span style="color:#7de8ff">5연속마다 배수 +0.5</span>, 최대 ' +
          '<span style="color:#ff6b8a">×5.0</span></div>' +
        '<div style="font-size:16px;color:#8a8478">하나라도 놓치면 콤보가 <b>0</b>으로 돌아간다 · ' +
          '30초마다 라운드가 올라 더 자주·더 짧게 뜬다</div>' +
      '</div>';

    // ---------- 라운드 ----------
    function checkRound() {
      var r = clamp(Math.floor((SHOW_TIME - stage.timeLeft) / ROUND_TIME), 0, ROUNDS - 1);
      if (r === st.round) return;
      if (st.roundMiss === 0 && st.roundHit > 0) {
        stage.stamp('R' + (st.round + 1) + ' 무실점');
        stage.emit('perfect_round', { r: String(st.round + 1) });
      }
      st.round = r; st.roundHit = 0; st.roundMiss = 0; st.flooded = false;
      sfxRound();
      stage.ticker('라운드 ' + (r + 1) + ' — 더 자주 뜨고 더 빨리 사라진다', false);
      stage.emit('round_up', { r: String(r + 1) });
      renderHUD();
    }

    // ---------- 처리 ----------
    function hit(t) {
      st.combo++; st.hits++; st.roundHit++;
      st.maxCombo = Math.max(st.maxCombo, st.combo);
      var prev = st.mul;
      st.mul = comboMul();
      var actual = stage.gain(Math.round(PAY_BASE * st.mul), null, 'hit');
      st.rings.push({ x: t.x, y: t.y, born: stage.now });
      floater(t.x, t.y - TARGET_R - 4, '+' + actual.toLocaleString(),
        st.mul >= 4 ? '#ff6b8a' : st.mul >= 2.5 ? '#ffb347' : '#7de8ff');
      sfxHit(st.mul);
      if (st.mul > prev) {
        sfxUp();
        stage.ticker('콤보 ×' + st.mul.toFixed(1) + ' — ' + st.combo + '연속', false);
        if (st.mul >= COMBO_MAX && prev < COMBO_MAX) {
          stage.stamp('콤보 MAX'); stage.flash(.22); stage.shake(4);
          stage.emit('combo_max', { c: String(st.combo) });
        } else {
          stage.emit('combo_up', { x: st.mul.toFixed(1) });
        }
      }
      renderHUD();
    }

    // ---------- 놓침 (규약 2 — 무연출·무효과음) ----------
    function miss(t) {
      stage.lose(LOSS);
      st.misses++; st.roundMiss++;
      var broke = st.combo;
      st.combo = 0; st.mul = 1;
      if (broke >= COMBO_STEP * 2) stage.emit('combo_break', { c: String(broke) });
      renderHUD();
    }

    function ambient() {
      if (st.mileIdx < MILES.length && stage.viewers >= MILES[st.mileIdx]) {
        stage.emit('milestone', { v: MILES[st.mileIdx++].toLocaleString() });
        return;
      }
      if (st.idleT > 3) { stage.emit('nag'); return; }
      stage.emit('idle');
    }

    stage.ticker('방송 시작! 과녁을 클릭해 없애라 — 연속이 곧 배수다', false);
    renderHUD();

    // ================= 인스턴스 =================
    return {
      st: st,

      step: function (dt) {
        var e = document.getElementById('clTime');
        if (e) e.textContent = U.fmtTime(stage.timeLeft);
        checkRound();

        st.spawnAcc += rate() * dt;
        while (st.spawnAcc >= 1) {
          st.spawnAcc -= 1;
          var spot = spawnSpot(st.targets);
          if (!spot) continue;
          st.targets.push({ x: spot.x, y: spot.y, born: stage.now, life: life() });
        }

        for (var i = st.targets.length - 1; i >= 0; i--) {
          if (left(st.targets[i]) <= 0) { miss(st.targets[i]); st.targets.splice(i, 1); }
        }

        if (!st.flooded && st.targets.length >= FLOOD_N) {
          st.flooded = true;
          stage.emit('flood', { n: String(st.targets.length) });
        }

        st.idleT += dt;
        if (st.idleT > 3 && st.targets.length > 0) {
          stage.lose(Math.max(1, stage.viewers * 0.006) * dt);
        }

        stage.donRoll(dt, 9, .45);
        st.chatT -= dt;
        if (st.chatT <= 0) {
          st.chatT = clamp(3.8 - Math.log10(stage.viewers + 10) * .55, 1.2, 3.8) + Math.random() * 1.4;
          ambient();
        }

        st.rings = st.rings.filter(function (r) { return stage.now - r.born < .32; });
        st.floaters = st.floaters.filter(function (f) { f.t += dt; return f.t < .8; });
      },

      // 남은 시간이 적은 것부터 — 겹치면 곧 사라질 것을 살린다
      pointer: function (p, type) {
        if (type !== 'down' || !stage.live) return;
        var best = -1, bestL = 2;
        for (var i = 0; i < st.targets.length; i++) {
          var t = st.targets[i], dx = p.x - t.x, dy = p.y - t.y;
          if (dx * dx + dy * dy > TARGET_R * TARGET_R) continue;
          var l = left(t);
          if (l < bestL) { bestL = l; best = i; }
        }
        if (best < 0) return;
        st.idleT = 0;
        hit(st.targets[best]);
        st.targets.splice(best, 1);
      },

      summary: function () {
        return [
          ['처리 / 놓침', st.hits + ' / ' + st.misses],
          ['최고 콤보', st.maxCombo + '연속 (×' +
            Math.min(COMBO_MAX, 1 + Math.floor(st.maxCombo / COMBO_STEP) * COMBO_ADD).toFixed(1) + ')'],
          ['도달 라운드', 'R' + (st.round + 1) + ' / ' + ROUNDS],
        ];
      },

      dispose: function () { panel.innerHTML = ''; },

      // ================= 캔버스 씬 =================
      draw: function (ctx) {
        var t = stage.now;
        drawArena(ctx, t);
        st.targets.forEach(function (tg) { drawTarget(ctx, tg, t); });
        // 처리 링
        st.rings.forEach(function (r) {
          var k = (t - r.born) / .32;
          ctx.save();
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = '#7de8ff'; ctx.lineWidth = 3 * (1 - k) + 1;
          ctx.beginPath(); ctx.arc(r.x, r.y, TARGET_R + k * 26, 0, TAU); ctx.stroke();
          ctx.restore();
        });
        st.floaters.forEach(function (f) {
          ctx.globalAlpha = 1 - f.t / .8;
          ctx.fillStyle = f.c; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(f.txt, f.x, f.y - f.t * 30);
          ctx.globalAlpha = 1;
        });
        // 콤보 배수 — 화면 중앙 하단에 크게. 잃을 것의 크기가 상시 보여야 긴장이 산다
        if (st.combo > 0) {
          ctx.save();
          ctx.globalAlpha = .5 + .3 * (st.mul - 1) / (COMBO_MAX - 1);
          ctx.fillStyle = st.mul >= 4 ? '#ff6b8a' : st.mul >= 2.5 ? '#ffb347' : '#7de8ff';
          ctx.font = 'bold 64px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('×' + st.mul.toFixed(1), 480, 398);
          ctx.font = 'bold 17px system-ui, sans-serif';
          ctx.fillText(st.combo + ' 연속', 480, 420);
          ctx.restore();
        }
      },
    };

    function drawArena(ctx, t) {
      var g = ctx.createLinearGradient(0, 0, 0, 430);
      g.addColorStop(0, '#0f1622'); g.addColorStop(.6, '#0c121c'); g.addColorStop(1, '#080c14');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 430);
      // 격자 — 표적 위치를 눈이 잡기 쉽게 하는 기준선 (연출 겸 가독)
      ctx.strokeStyle = 'rgba(125,232,255,.05)'; ctx.lineWidth = 1;
      for (var x = 60; x < 960; x += 60) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 430); ctx.stroke();
      }
      for (var y = 50; y < 430; y += 60) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(960, y); ctx.stroke();
      }
      // 스캔 라인 하나 — 화면이 살아 있다는 신호
      var sy = (t * 90) % 480 - 25;
      var sg = ctx.createLinearGradient(0, sy - 22, 0, sy + 22);
      sg.addColorStop(0, 'rgba(125,232,255,0)'); sg.addColorStop(.5, 'rgba(125,232,255,.06)');
      sg.addColorStop(1, 'rgba(125,232,255,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, sy - 22, 960, 44);
    }

    function drawTarget(ctx, tg, t) {
      var l = left(tg);
      var urgent = l < .35;
      // 남은 수명 링 — 수축한다. 이게 없으면 "곧 사라질 것"을 고를 수 없다
      ctx.strokeStyle = urgent ? (Math.sin(t * 24) > 0 ? '#fff' : '#ff5a4a')
                               : 'rgb(' + Math.round(255 - 130 * l) + ',' + Math.round(120 + 110 * l) + ',90)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(tg.x, tg.y, TARGET_R + 8, -Math.PI / 2, -Math.PI / 2 + l * TAU);
      ctx.stroke();
      // 과녁 본체 — 크기 고정
      var bg = ctx.createRadialGradient(tg.x - 7, tg.y - 8, 3, tg.x, tg.y, TARGET_R);
      bg.addColorStop(0, '#ffffff'); bg.addColorStop(.3, '#7de8ff'); bg.addColorStop(1, '#1e6b8c');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(tg.x, tg.y, TARGET_R, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.stroke();
      // 중심 점
      ctx.fillStyle = '#0c121c';
      ctx.beginPath(); ctx.arc(tg.x, tg.y, 5, 0, TAU); ctx.fill();
    }
  }

  Shell.register({
    id: 'click',
    title: '광클쇼',
    tagline: '판단은 없다. 연속으로 처리한 만큼만 배수가 오르고, 하나 놓치면 전부 0이다 — 순수 처리력 시험.',
    duration: SHOW_TIME,
    startViewers: START_VIEWERS,
    usesChain: true,
    chat: window.CLICK_CHAT,
    tuning: {
      SPAWN_BASE: SPAWN_BASE, RATE: RATE, LIFE: LIFE, TARGET_R: TARGET_R,
      PAY_BASE: PAY_BASE, LOSS: LOSS,
      COMBO_STEP: COMBO_STEP, COMBO_ADD: COMBO_ADD, COMBO_MAX: COMBO_MAX,
    },
    foot: '과녁을 <b>클릭</b>해 없앤다 — <b>5연속마다 배수 +0.5</b>, 최대 ×5.0. 수축하는 링이 남은 시간이다<br>' +
          '하나라도 놓치면 <b>콤보 0</b>(무연출·조용히) · 30초마다 라운드가 올라 더 자주 뜨고 더 빨리 사라진다 · ' +
          '<b>후반의 ×5는 유지하는 것 자체가 도박이다</b>',
    thumb: function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0f1622'); g.addColorStop(1, '#080c14');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      [[w * .3, h * .35, 13], [w * .68, h * .3, 10], [w * .5, h * .66, 16]].forEach(function (p) {
        c.strokeStyle = '#ffb347'; c.lineWidth = 2;
        c.beginPath(); c.arc(p[0], p[1], p[2] + 5, -Math.PI / 2, Math.PI * .8); c.stroke();
        var bg = c.createRadialGradient(p[0] - 3, p[1] - 4, 2, p[0], p[1], p[2]);
        bg.addColorStop(0, '#ffffff'); bg.addColorStop(.3, '#7de8ff'); bg.addColorStop(1, '#1e6b8c');
        c.fillStyle = bg;
        c.beginPath(); c.arc(p[0], p[1], p[2], 0, Math.PI * 2); c.fill();
      });
      c.fillStyle = '#ff6b8a'; c.font = 'bold 13px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('×5.0', w * .5, h * .93);
    },
    start: start,
  });
})();
