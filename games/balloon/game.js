/* 풍선쇼 — 떠오르는 풍선이 계속 부푼다. 클수록 비싸고, 너무 키우면 저절로 터진다.
 *
 * 공통 명제 유지 — **안전한 플레이가 최악의 전략이다.**
 *   보이는 족족 즉시 터뜨림 ×1.0 (절대 안 놓침)  ≪  익혀서 터뜨림 ×2~3  ≪  만개 ×4.0
 * 안전은 절대 손해를 안 보는 대신 단가가 바닥이다. 지르려면 여러 개를 동시에 익혀야 하는데,
 * 스폰율은 라운드마다 오르므로 만료가 겹치는 순간 무더기로 잃는다 — 처리량과 단가의 교환.
 *
 * 규약 2: 자연 파열은 무연출·무효과음. 숫자만 조용히 빠진다.
 * 규약 5: 뼈대 = 익음배수(실력 연동). 양념 = 도네(셸 소유).
 * 라운드(30초×6)는 게임이 소유하는 내부 구획이다 — 셸의 방송 시계 180초는 건드리지 않는다.
 *
 * ⚠ 밸런스는 1차 조율값 — 스윕 검증 전이다 (docs/superpowers/specs/2026-08-10-reflex-games-design.md §7).
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
  // 즉시 터뜨림(+30) 4~5회분이라, 하나 놓치면 안전 플레이의 벌이가 통째로 날아간다
  var BURST_LOSS = 140;
  var BLOOM_T = 0.9;                          // 만개 판정 익음도
  var FLOOD_N = 6;                            // 동시 이 개수 넘으면 과밀 (라운드당 1회 발화)
  var MILES = [1000, 5000, 15000, 60000, 150000];

  var COLORS = ['#ff6b8a', '#ffb347', '#7de8ff', '#a8e063', '#c58aff'];

  // 스폰 금지 구역 — 셸 명판(좌상단)과 스트리머 캠(우하단)에 가리면 못 누른다
  function spawnSpot(list) {
    for (var try_ = 0; try_ < 24; try_++) {
      var x = rnd(52, 908), y = rnd(66, 378);
      if (x < 300 && y < 62) continue;        // HUD 명판
      if (x > 762 && y > 288) continue;       // 스트리머 캠
      var ok = true;
      for (var i = 0; i < list.length; i++) {
        var dx = list[i].x - x, dy = list[i].y - y;
        if (dx * dx + dy * dy < 86 * 86) { ok = false; break; }
      }
      if (ok) return { x: x, y: y };
    }
    return null; // 자리가 없으면 이번 스폰은 거른다 — 겹쳐 뜨면 누를 수 없다
  }

  // ---------- SFX (절차 합성 — 외부 에셋 0) ----------
  var sfxPop   = function (t) {
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
  };

  function start(stage) {
    var st = {
      round: 0, roundPop: 0, roundMiss: 0, flooded: false,
      pops: 0, blooms: 0, bursts: 0, ripeSum: 0, maxAlive: 0,
      balloons: [], puffs: [], floaters: [],
      spawnAcc: 0, idleT: 0, chatT: 3, mileIdx: 0,
    };
    var panel = stage.panel;

    function rate() { return SPAWN_BASE * RATE[clamp(st.round, 0, ROUNDS - 1)]; }
    function ripe(b) { return clamp((stage.now - b.born) / LIFE, 0, 1); }
    function floater(x, y, txt, c) { st.floaters.push({ x: x, y: y, txt: txt, t: 0, c: c }); }

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
    // 조작 UI는 없다 — 캔버스 클릭이 전부다. 패널은 배수 규칙만 상시 띄운다.
    // 셸 CSS를 건드리지 않으려 인라인 스타일로 둔다 (해체쇼와 같은 규약)
    panel.innerHTML =
      '<div style="width:100%;text-align:center;padding:10px 12px;line-height:1.7">' +
        '<div style="font-size:20px;color:#ece7dd"><b>풍선을 클릭해 터뜨린다.</b> 부풀수록 비싸다 — ' +
          '<span style="color:#7de8ff">작을 때 ×1.0</span> · ' +
          '<span style="color:#ffb347">중간 ×2.2</span> · ' +
          '<span style="color:#ff6b8a">만개 ×4.0</span></div>' +
        '<div style="font-size:16px;color:#8a8478">저절로 터지면 부푼 만큼 크게 잃는다 · ' +
          '30초마다 라운드가 올라 풍선이 더 자주 뜬다</div>' +
      '</div>';

    // ---------- 라운드 ----------
    function checkRound() {
      var r = clamp(Math.floor((SHOW_TIME - stage.timeLeft) / ROUND_TIME), 0, ROUNDS - 1);
      if (r === st.round) return;
      // 직전 라운드 마감 — 무실점이면 그것만 짚는다 (획득 없는 순수 연출)
      if (st.roundMiss === 0 && st.roundPop > 0) {
        stage.stamp('R' + (st.round + 1) + ' 무파열');
        stage.emit('perfect_round', { r: String(st.round + 1) });
      }
      st.round = r; st.roundPop = 0; st.roundMiss = 0; st.flooded = false;
      sfxRound();
      stage.ticker('라운드 ' + (r + 1) + ' — 풍선이 더 자주 뜬다', false);
      stage.emit('round_up', { r: String(r + 1) });
      renderHUD();
    }

    // ---------- 터뜨리기 ----------
    function pop(b) {
      var t = ripe(b);
      var bloom = t >= BLOOM_T;
      var mul = 1 + PAY_SPAN * t;
      var actual = stage.gain(Math.round(PAY_BASE * mul),
        bloom ? '만개!! ×' + mul.toFixed(1) : null, bloom ? 'bloom' : 'pop');
      st.pops++; st.roundPop++; st.ripeSum += t;
      st.puffs.push({ x: b.x, y: b.y, r: b.r, c: b.c, born: stage.now });
      floater(b.x, b.y - b.r - 6, '+' + actual.toLocaleString(), bloom ? '#ff6b8a' : '#ffd27a');
      sfxPop(t);
      if (bloom) {
        st.blooms++;
        stage.flash(.18); stage.shake(4);
        stage.emit('bloom', { gain: actual.toLocaleString() });
      }
      // 연쇄 미터를 익음배수 표시로 재사용 — 마지막으로 터뜨린 값이 떠 있는다
      stage.setChain(mul);
      renderHUD();
    }

    // ---------- 자연 파열 (규약 2 — 무연출·무효과음) ----------
    function burst(b) {
      stage.lose(BURST_LOSS);
      st.bursts++; st.roundMiss++;
      st.puffs.push({ x: b.x, y: b.y, r: b.r, c: '#5a5650', born: stage.now, dull: true });
      if (Math.random() < .35) stage.emit('burst');
      renderHUD();
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

        // 스폰
        st.spawnAcc += rate() * dt;
        while (st.spawnAcc >= 1) {
          st.spawnAcc -= 1;
          var spot = spawnSpot(st.balloons);
          if (!spot) continue;
          st.balloons.push({
            x: spot.x, y: spot.y, born: stage.now, r: R_MIN,
            c: COLORS[rnd(0, COLORS.length - 1)], sway: Math.random() * TAU,
          });
        }

        // 부풀기·만료
        for (var i = st.balloons.length - 1; i >= 0; i--) {
          var b = st.balloons[i];
          var t = ripe(b);
          b.r = R_MIN + (R_MAX - R_MIN) * t;
          if (t >= 1) { burst(b); st.balloons.splice(i, 1); }
        }
        st.maxAlive = Math.max(st.maxAlive, st.balloons.length);

        // 과밀 — 라운드당 한 번만 짚는다
        if (!st.flooded && st.balloons.length >= FLOOD_N) {
          st.flooded = true;
          stage.emit('flood', { n: String(st.balloons.length) });
        }

        // 방치 — 조용한 이탈 (규약 2)
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

        st.puffs = st.puffs.filter(function (p) { return stage.now - p.born < .45; });
        st.floaters = st.floaters.filter(function (f) { f.t += dt; return f.t < .9; });
      },

      // 겹쳐 있으면 익은 것부터 — 화면에서도 익은 것이 위에 그려진다
      pointer: function (p, type) {
        if (type !== 'down' || !stage.live) return;
        var best = -1, bestT = -1;
        for (var i = 0; i < st.balloons.length; i++) {
          var b = st.balloons[i], dx = p.x - b.x, dy = p.y - b.y;
          if (dx * dx + dy * dy > b.r * b.r) continue;
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
          ['터뜨림 / 자연 파열', st.pops + ' / ' + st.bursts],
          ['평균 익음도 · 만개', avg + '% · ' + st.blooms + '회'],
          ['최고 동시 부풀림', st.maxAlive + '개'],
        ];
      },

      dispose: function () { panel.innerHTML = ''; },

      // ================= 캔버스 씬 =================
      draw: function (ctx) {
        var t = stage.now;
        drawStudio(ctx, t);
        // 익은 것이 위 — 겹쳤을 때 클릭 우선순위와 그리는 순서를 맞춘다
        st.balloons.slice().sort(function (a, b) { return ripe(a) - ripe(b); })
          .forEach(function (b) { drawBalloon(ctx, b, t); });
        drawPuffs(ctx, t);
        st.floaters.forEach(function (f) {
          ctx.globalAlpha = 1 - f.t / .9;
          ctx.fillStyle = f.c; ctx.font = 'bold 21px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(f.txt, f.x, f.y - f.t * 34);
          ctx.globalAlpha = 1;
        });
      },
    };

    function drawStudio(ctx, t) {
      var g = ctx.createLinearGradient(0, 0, 0, 430);
      g.addColorStop(0, '#1b1830'); g.addColorStop(.55, '#161426'); g.addColorStop(1, '#0e0d18');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 430);
      // 무대 조명 콘 둘 — 깜빡임이 방송의 생동감이라 정지 이미지로 바꾸지 않는다
      [280, 680].forEach(function (lx, k) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var fl = 1 + .06 * Math.sin(t * 5 + k * 2.3);
        var cone = ctx.createRadialGradient(lx, -20, 10, lx, 300, 330 * fl);
        cone.addColorStop(0, 'rgba(170,150,255,.11)'); cone.addColorStop(1, 'rgba(170,150,255,0)');
        ctx.fillStyle = cone; ctx.fillRect(lx - 330, 0, 660, 430);
        ctx.restore();
      });
      // 바닥 라인
      ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(0, 404, 960, 2);
    }

    function drawBalloon(ctx, b, t) {
      var rt = ripe(b);
      var sway = Math.sin(t * 1.7 + b.sway) * (2 + rt * 3);
      var x = b.x + sway, y = b.y;
      var bloom = rt >= BLOOM_T;

      // 만개 구간 표시 — 이 창을 못 보면 "지금 터뜨릴까"라는 선택 자체가 성립하지 않는다
      if (bloom) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var gl = ctx.createRadialGradient(x, y, b.r * .4, x, y, b.r * 2);
        var a = .28 + .18 * Math.sin(t * 18);
        gl.addColorStop(0, 'rgba(255,120,160,' + a + ')'); gl.addColorStop(1, 'rgba(255,120,160,0)');
        ctx.fillStyle = gl; ctx.fillRect(x - b.r * 2, y - b.r * 2, b.r * 4, b.r * 4);
        ctx.restore();
      }

      // 실
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x, y + b.r * 1.06);
      ctx.quadraticCurveTo(x + sway * 1.6, y + b.r + 16, x - sway, y + b.r + 30); ctx.stroke();
      // 몸통 — 세로로 살짝 긴 타원 + 하이라이트
      var bg = ctx.createRadialGradient(x - b.r * .32, y - b.r * .38, b.r * .1, x, y, b.r * 1.1);
      bg.addColorStop(0, '#ffffff'); bg.addColorStop(.22, b.c); bg.addColorStop(1, shade(b.c, -.32));
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.ellipse(x, y, b.r * .92, b.r * 1.06, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = bloom ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.25)';
      ctx.lineWidth = bloom ? 2.4 : 1.5; ctx.stroke();
      // 매듭
      ctx.fillStyle = shade(b.c, -.4);
      ctx.beginPath(); ctx.moveTo(x - 4, y + b.r * 1.04); ctx.lineTo(x + 4, y + b.r * 1.04);
      ctx.lineTo(x, y + b.r * 1.16); ctx.closePath(); ctx.fill();
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
    tuning: {
      SPAWN_BASE: SPAWN_BASE, RATE: RATE, LIFE: LIFE,
      PAY_BASE: PAY_BASE, PAY_SPAN: PAY_SPAN,
      BURST_LOSS: BURST_LOSS, BLOOM_T: BLOOM_T,
    },
    foot: '풍선을 <b>클릭</b>해 터뜨린다 — 부풀수록 비싸다(×1.0 → ×4.0). ' +
          '하얗게 빛나면 <b>만개</b>(×4.0), 그 창은 0.3초뿐이다<br>' +
          '저절로 터지면 부푼 만큼 크게 잃는다(무연출·조용히) · 30초마다 라운드가 올라 풍선이 더 자주 뜬다 · ' +
          '<b>여러 개를 동시에 익히는 것이 이 방송의 도박이다</b>',
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
