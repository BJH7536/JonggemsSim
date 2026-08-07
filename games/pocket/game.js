/* 주머니 괴수 — 포켓몬스터 패러디. 3마리 벤치로 끝없는 연승전을 뛰는 턴제 배틀.
 *
 * 세 번째 게임의 역할은 "훈수 장르" 증명이다. 화력쇼(초 단위 반사)·GUOI(느린 긴장)와 달리
 * 턴제는 관객이 수를 같이 읽는다 — "왜 안 바꿔요??", "명중 38%짜리입니다 여러분" 같은
 * info/mock 톤이 처음으로 주연이 되고, AI 시청자가 게임을 '보고 있다'는 감각이 가장 세다.
 *
 * 공통 명제 유지 — **안전한 플레이가 최악의 전략이다.**
 *   안정타(명중100%) +37   ≪   도박수(55%) +390   ≪   필살기(38%) +1,050   ≪   빈사 역전 KO +1,200×연쇄
 * 규약 4는 "기술 단위 신선도"로: 같은 기술만 누르면 100→70→45→25→10%로 물리고,
 * 다른 기술 2회당 1단계 회복. 안정타 스팸은 채팅이 먼저 지적한다(safe_spam).
 *
 * 규약 5: 뼈대 = 연쇄 배수(연승·셸 미터 재사용) + 기술 신선도. 양념 = 도네.
 * ⚠ 밸런스는 데모용 1차 조율값 — 화력쇼급 스윕 검증 전이다.
 */
(function () {
  'use strict';

  var U = Shell.util, clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  var sfx = Shell.sfx;

  var SHOW_TIME = 180;
  var START_VIEWERS = 300;

  // ---------- 데이터 ----------
  var TYPES = [
    { n: '화염', c: '#ff6a3d', c2: '#ffb447' },
    { n: '물',   c: '#4aa0ff', c2: '#b0d8ff' },
    { n: '풀',   c: '#6fd98f', c2: '#c8f0b8' },
  ];
  // 상성: 불>풀, 물>불, 풀>물. 유리 1.5 / 불리 0.67 / 동타입 1.0
  function typeMult(a, d) {
    if (a === d) return 1;
    if ((a === 0 && d === 2) || (a === 1 && d === 0) || (a === 2 && d === 1)) return 1.5;
    return 0.67;
  }
  var MONS = [
    { n: '불도치', t: 0 }, { n: '물퍽이', t: 1 }, { n: '풀냥', t: 2 },
  ];
  var ENEMY_NAMES = [
    ['화록이', '잿불곰', '용암달팽이'],
    ['물컹이', '소나기새', '거품게'],
    ['덩쿨쥐', '이끼멧돼지', '포자버섯'],
  ];
  // 기술 4종 원형 — 명중이 낮을수록 시청자 보상이 크다 (규약: 리스크가 뼈대)
  var MOVES = [
    { acc: 1.0, pow: 13, gain: 25 },   // 안정타
    { acc: 0.8, pow: 22, gain: 80 },   // 강타
    { acc: 0.55, pow: 40, gain: 260 }, // 도박수
    { acc: 0.38, pow: 68, gain: 700 }, // 필살기
  ];
  var MOVE_NAMES = [
    ['몸통박치기', '불꽃세례', '화염돌진', '대폭발'],
    ['몸통박치기', '물대포', '아쿠아소용돌이', '해일'],
    ['몸통박치기', '잎날가르기', '덩굴쇄도', '숲의심판'],
  ];
  var FRESH = [1, .7, .45, .25, .1]; // 규약 4 — 기술 단위 신선도
  var CRIT = 0.12;
  var MILES = [1000, 5000, 15000, 60000, 150000];

  var sfxHit   = function () { if (!sfx.gate('pk_h')) return; sfx.noise(.1, .09, 300); sfx.tone(160, .08, 'square', .05); };
  var sfxBig   = function () { if (!sfx.gate('pk_b')) return; sfx.noise(.2, .14, 220); sfx.tone(90, .2, 'sine', .12); };
  var sfxMiss  = function () { if (!sfx.gate('pk_m')) return; sfx.tone(300, .12, 'sine', .04, 0); sfx.tone(220, .14, 'sine', .04, .1); };
  var sfxKO    = function () { if (!sfx.gate('pk_k')) return; sfx.tone(523, .1, 'triangle', .1); sfx.tone(784, .12, 'triangle', .1, .09); sfx.tone(1047, .2, 'triangle', .1, .18); };
  var sfxFaint = function () { if (!sfx.gate('pk_f')) return; sfx.tone(200, .2, 'sawtooth', .06); sfx.tone(120, .3, 'sawtooth', .05, .15); };
  var sfxSwap  = function () { if (!sfx.gate('pk_s')) return; sfx.noise(.12, .06, 700); };

  function start(stage) {
    var st = {
      bench: MONS.map(function (m) { return { n: m.n, t: m.t, hp: 100, max: 100 }; }),
      active: 0,
      enemy: null, wins: 0, streak: 1, maxStreak: 1,
      mfresh: [0, 0, 0, 0], mrec: [0, 0, 0, 0],
      lastMoves: [], safeSpamAt: -1,
      phase: 'player',           // player | busy | heal
      timers: [], healT: 0, idleT: 0, warnedND: false,
      kos: 0, faints: 0, crits: 0, comebacks: 0,
      anim: null, hitFlash: { me: 0, foe: 0 }, floaters: [],
      donT: 9 + Math.random() * 7, chatT: 3, mileIdx: 0,
    };
    var panel = stage.panel;

    function me() { return st.bench[st.active]; }
    function alive() { return st.bench.filter(function (m) { return m.hp > 0; }); }
    function after(sec, fn) { st.timers.push({ t: sec, fn: fn }); }
    function floater(x, y, txt, color) { st.floaters.push({ x: x, y: y, txt: txt, t: 0, c: color || '#ffd27a' }); }

    function newEnemy() {
      var t = Math.random() < .7 ? st.wins % 3 : rnd(0, 2); // 대체로 순환 — 교체 학습이 가능해야 상성이 메커닉이 된다
      st.enemy = {
        n: ENEMY_NAMES[t][rnd(0, 2)], t: t,
        hp: 90 + st.wins * 14, max: 90 + st.wins * 14,
        pow: 1 + st.wins * 0.04,
      };
      st.warnedND = false;
      stage.emit('new_foe', { name: st.enemy.n });
      buildPanel();
    }

    // ---------- HUD·패널 ----------
    stage.hud('⏱ 방송 <b id="pkTime">3:00</b> · 연승 <b id="pkWins">0</b> · KO <b id="pkKO">0</b> · 기절 <b id="pkFaint">0</b>');
    function renderHUD() {
      var e;
      if ((e = document.getElementById('pkWins'))) e.textContent = st.wins;
      if ((e = document.getElementById('pkKO'))) e.textContent = st.kos;
      if ((e = document.getElementById('pkFaint'))) e.textContent = st.faints;
      stage.setChain(st.streak);
    }
    function buildPanel() {
      var m = me(), names = MOVE_NAMES[m.t];
      var moves = MOVES.map(function (mv, i) {
        var fm = FRESH[st.mfresh[i]];
        return '<button class="pkmove" data-mv="' + i + '"' + (st.phase !== 'player' ? ' disabled' : '') + '>' +
          '<b>' + (i + 1) + '. ' + names[i] + '</b>' +
          '<span>명중 ' + Math.round(mv.acc * 100) + '% · 위력 ' + mv.pow + '</span>' +
          '<span class="' + (fm < 1 ? 'warn' : '') + '">신선도 ' + Math.round(fm * 100) + '%</span></button>';
      }).join('');
      var bench = st.bench.map(function (b, i) {
        var pct = Math.round(b.hp / b.max * 100);
        return '<button class="pkmon' + (i === st.active ? ' on' : '') + (b.hp <= 0 ? ' dead' : '') + '"' +
          ' data-sw="' + i + '"' + (st.phase !== 'player' || i === st.active || b.hp <= 0 ? ' disabled' : '') + '>' +
          '<b style="color:' + TYPES[b.t].c + '">' + b.n + '</b><span>' + TYPES[b.t].n + '</span>' +
          '<div class="pkhp"><i style="width:' + pct + '%;background:' + (pct > 50 ? '#6fd98f' : pct > 25 ? '#ffb447' : '#ff5a4a') + '"></i></div></button>';
      }).join('');
      var foe = st.enemy ? '<div class="pkfoe">상대 <b style="color:' + TYPES[st.enemy.t].c + '">' + st.enemy.n + '</b> · ' +
        TYPES[st.enemy.t].n + ' · 유리 배수 ×' + typeMult(me().t, st.enemy.t).toFixed(2) + '</div>' : '';
      panel.innerHTML = '<div class="pkbar"><div class="pkmoves">' + moves + '</div>' +
        '<div class="pkside">' + foe + '<div class="pkbench">' + bench + '</div></div></div>';
      renderHUD();
    }
    function onPanelClick(e) {
      var t = e.target.closest('[data-mv],[data-sw]');
      if (!t || t.disabled || !stage.live || st.phase !== 'player') return;
      if (t.dataset.mv != null) playerMove(+t.dataset.mv);
      else playerSwitch(+t.dataset.sw);
    }
    panel.addEventListener('click', onPanelClick);

    // ---------- 신선도 (규약 4 — 기술 단위) ----------
    function useFresh(i) {
      var fm = FRESH[st.mfresh[i]];
      st.mfresh[i] = Math.min(4, st.mfresh[i] + 1);
      st.mrec[i] = 0;
      for (var k = 0; k < 4; k++) if (k !== i) {
        if (++st.mrec[k] >= 2) { st.mrec[k] = 0; st.mfresh[k] = Math.max(0, st.mfresh[k] - 1); }
      }
      return fm;
    }

    // ---------- 플레이어 턴 ----------
    function playerMove(i) {
      st.phase = 'busy'; st.idleT = 0;
      var m = me(), mv = MOVES[i], name = MOVE_NAMES[m.t][i];
      var adv = typeMult(m.t, st.enemy.t);
      var fm = useFresh(i);

      st.lastMoves.push(i);
      if (st.lastMoves.length > 6) st.lastMoves.shift();
      if (st.lastMoves.length === 6 && st.lastMoves.every(function (x) { return x === 0; }) && st.safeSpamAt !== st.wins) {
        st.safeSpamAt = st.wins;
        stage.emit('safe_spam'); // 안정타 스팸은 채팅이 먼저 지적한다
      }
      if (adv < 1 && Math.random() < .3) stage.emit('disadvantage'); // 훈수의 순간

      st.anim = { who: 'me', t: 0 };
      after(0.32, function () {
        if (Math.random() < mv.acc) {
          var crit = Math.random() < CRIT;
          if (crit) st.crits++;
          var dmg = Math.round(mv.pow * adv * (crit ? 2 : 1) * (0.9 + Math.random() * 0.2));
          st.enemy.hp -= dmg;
          st.hitFlash.foe = .3;
          floater(660, 170, '-' + dmg, crit ? '#ff5a4a' : '#fff');
          var gain = Math.round(mv.gain * adv * fm * (crit ? 2.2 : 1));
          if (i >= 2 || crit) {
            var actual = stage.gain(gain, crit ? '급소!!' : (i === 3 ? '필살기 적중!!' : '도박수 적중!'),
              crit ? 'crit' : (i === 3 ? 'ultra_hit' : 'risky_hit'));
            stage.shake(i === 3 ? 10 : 6); stage.flash(i === 3 ? .25 : .15);
            if (i === 3) sfxBig(); else sfxHit();
            stage.emit(crit ? 'crit' : (i === 3 ? 'ultra_hit' : 'risky_hit'),
              { mv: name, dmg: dmg, gain: actual.toLocaleString() });
          } else {
            // 안전한 딜은 조용한 소액 — 티커로만. 이벤트 인자도 없다(중립 배분):
            // 안정타는 채널의 색을 바꿀 만한 사건이 아니라는 뜻이다 (ADR-002)
            stage.gain(gain, null);
            sfxHit();
            stage.ticker(name + ' 적중 — ' + dmg + ' 피해', false);
          }
          if (st.enemy.hp <= 0) { koEnemy(); return; }
        } else {
          stage.lose(40); // 빗나감 — 조용히 (규약 2)
          sfxMiss();
          floater(660, 170, 'MISS', '#8a8478');
          stage.ticker(name + ' 빗나감 −40', true);
          stage.emit('miss', { mv: name });
        }
        after(0.55, enemyTurn);
      });
      buildPanel();
    }

    function koEnemy() {
      st.kos++; st.wins++;
      var nearDeath = me().hp / me().max < 0.2;
      var base = nearDeath ? 1200 : 350;
      var gain = Math.round(base * st.streak);
      var actual = stage.gain(gain, nearDeath ? '빈사 역전 KO!!!' : 'KO! ' + st.wins + '연승',
        nearDeath ? 'comeback' : 'enemy_ko');
      if (nearDeath) { st.comebacks++; stage.stamp('빈사 역전'); stage.flash(.4); }
      st.streak = Math.min(3, st.streak + .5);
      st.maxStreak = Math.max(st.maxStreak, st.streak);
      sfxKO();
      stage.emit(nearDeath ? 'comeback' : 'enemy_ko',
        nearDeath ? { hp: me().hp, gain: actual.toLocaleString() }
                  : { name: st.enemy.n, streak: st.wins, gain: actual.toLocaleString() });
      st.anim = { who: 'foeDown', t: 0 };
      after(1.3, function () { newEnemy(); st.phase = 'player'; buildPanel(); });
      renderHUD();
    }

    // ---------- 적 턴 ----------
    function enemyTurn() {
      if (!stage.live) return;
      var r = Math.random(), ei = r < .55 ? 0 : r < .83 ? 1 : 2;
      var mv = MOVES[ei], adv = typeMult(st.enemy.t, me().t);
      st.anim = { who: 'foe', t: 0 };
      after(0.32, function () {
        if (Math.random() < mv.acc) {
          var dmg = Math.round(mv.pow * st.enemy.pow * adv * (0.9 + Math.random() * 0.2));
          var m = me();
          m.hp = Math.max(0, m.hp - dmg);
          st.hitFlash.me = .3; stage.shake(4);
          floater(310, 300, '-' + dmg, '#ff9a8a');
          sfxHit();
          if (Math.random() < .5) stage.emit('player_hit', { dmg: dmg });
          if (m.hp > 0 && m.hp / m.max < 0.2 && !st.warnedND) {
            st.warnedND = true;
            stage.emit('near_death'); // 관객은 안다 — 여기가 지르는 타이밍이라는 걸
          }
          if (m.hp <= 0) { faint(); return; }
        } else {
          stage.ticker('상대의 공격이 빗나갔다', true);
        }
        st.phase = 'player'; buildPanel();
      });
    }

    function faint() {
      st.faints++; st.streak = 1;
      var m = me();
      sfxFaint();
      stage.lose(Math.max(20, stage.viewers * 0.06)); // 기절 — 조용히 6% (규약 2)
      stage.ticker(m.n + ' 기절…', true);
      stage.emit('faint', { name: m.n });
      st.anim = { who: 'meDown', t: 0 };
      var next = st.bench.findIndex(function (b) { return b.hp > 0; });
      if (next < 0) { // 전멸 — 회복 타임. 파손 화구와 같은 원리: 방치 구간은 샌다
        st.phase = 'heal'; st.healT = 8;
        stage.emit('wipe');
        buildPanel();
        return;
      }
      after(1.1, function () {
        st.active = next; st.warnedND = false;
        sfxSwap();
        st.phase = 'player'; buildPanel();
      });
      renderHUD();
    }

    function playerSwitch(i) {
      st.phase = 'busy'; st.idleT = 0;
      st.active = i; st.warnedND = false;
      sfxSwap();
      var adv = typeMult(me().t, st.enemy.t);
      if (adv > 1) {
        var actual = stage.gain(120, '영리한 교체!', 'advantage');
        stage.emit('advantage', { name: me().n });
      } else {
        stage.ticker(me().n + ' 교체', false);
      }
      buildPanel();
      after(0.7, enemyTurn); // 교체도 한 턴 — 공짜면 상성이 퍼즐이 아니라 버튼이 된다
    }

    function ambient() {
      if (st.mileIdx < MILES.length && stage.viewers >= MILES[st.mileIdx]) {
        stage.emit('milestone', { v: MILES[st.mileIdx++].toLocaleString() });
        return;
      }
      stage.emit('idle');
    }

    newEnemy();
    st.phase = 'player';
    buildPanel();
    stage.ticker('방송 시작! 기술을 골라라 — 지를수록 커진다', false);

    // ---------- 인스턴스 ----------
    return {
      st: st,

      step: function (dt) {
        var e = document.getElementById('pkTime');
        if (e) e.textContent = U.fmtTime(stage.timeLeft);

        // 게임 내 타이머 — setTimeout 대신 step 구동 (시뮬 테스트 가능·방송 종료 시 자동 중단)
        for (var i = st.timers.length - 1; i >= 0; i--) {
          st.timers[i].t -= dt;
          if (st.timers[i].t <= 0) { var fn = st.timers[i].fn; st.timers.splice(i, 1); fn(); }
        }

        if (st.phase === 'heal') {
          st.healT -= dt;
          stage.lose(Math.max(1, stage.viewers * 0.007) * dt); // 회복 타임 — 조용히 샌다
          var h = document.getElementById('pkHeal');
          if (h) h.textContent = Math.max(0, st.healT).toFixed(1);
          else panel.querySelector('.pkbar') && (panel.innerHTML =
            '<div class="pkbar"><div class="pkheal">🏥 괴수센터 회복 중 — <b><span id="pkHeal">' +
            st.healT.toFixed(1) + '</span>초</b><br><span>회복하는 동안 시청자가 조용히 빠져나간다</span></div></div>');
          if (st.healT <= 0) {
            st.bench.forEach(function (b) { b.hp = b.max; });
            st.active = 0; st.phase = 'player'; st.warnedND = false;
            stage.emit('revive');
            stage.ticker('전원 회복! 다시 달리자', false);
            buildPanel();
          }
        }

        if (st.phase === 'player') {
          st.idleT += dt;
          if (st.idleT > 4) stage.lose(Math.max(1, stage.viewers * 0.006) * dt); // 장고 — 조용히
        }

        st.donT -= dt;
        if (st.donT <= 0) {
          st.donT = 9 + Math.random() * 7;
          if (Math.random() < .45) {
            var d = Math.max(10, Math.round(stage.viewers * (0.01 + Math.random() * 0.02)));
            var a = stage.gain(d, '익명의 도네', 'donation');
            stage.emit('donation', { d: a.toLocaleString() });
          }
        }
        st.chatT -= dt;
        if (st.chatT <= 0) {
          st.chatT = clamp(4 - Math.log10(stage.viewers + 10) * .55, 1.3, 4) + Math.random() * 1.5;
          ambient();
        }

        if (st.anim) { st.anim.t += dt; if (st.anim.t > 1.4) st.anim = null; }
        st.hitFlash.me *= .9; st.hitFlash.foe *= .9;
        st.floaters = st.floaters.filter(function (f) { f.t += dt; return f.t < 1; });
      },

      key: function (e) {
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= 4 && st.phase === 'player') playerMove(n - 1);
      },

      summary: function () {
        return [
          ['연승 / KO', st.wins + '연승 / ' + st.kos + '회'],
          ['최고 배수 / 급소', '×' + st.maxStreak.toFixed(1) + ' / ' + st.crits],
          ['빈사 역전 / 기절', st.comebacks + ' / ' + st.faints],
        ];
      },

      dispose: function () { panel.removeEventListener('click', onPanelClick); },

      draw: function (ctx) {
        var t = stage.now;
        drawArena(ctx, t);
        if (st.enemy) drawMon(ctx, t, st.enemy.t, 660, 230, 44, true,
          st.enemy.hp / st.enemy.max, st.enemy.n, st.hitFlash.foe,
          st.anim && st.anim.who === 'foe' ? st.anim.t : -1,
          st.anim && st.anim.who === 'foeDown' ? st.anim.t : -1);
        var m = me();
        drawMon(ctx, t, m.t, 310, 330, 58, false,
          m.hp / m.max, m.n, st.hitFlash.me,
          st.anim && st.anim.who === 'me' ? st.anim.t : -1,
          st.anim && st.anim.who === 'meDown' ? st.anim.t : -1);
        // 데미지 플로터
        st.floaters.forEach(function (f) {
          ctx.globalAlpha = 1 - f.t;
          ctx.fillStyle = f.c; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(f.txt, f.x, f.y - f.t * 40);
          ctx.globalAlpha = 1;
        });
      },
    };

    // ---------- 렌더 ----------
    function drawArena(ctx, t) {
      var g = ctx.createLinearGradient(0, 0, 0, 430);
      g.addColorStop(0, '#141a2a'); g.addColorStop(.55, '#1b2438'); g.addColorStop(1, '#0e1219');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 430);
      // 관중석 — 점의 밀도가 시청자 규모를 은근히 반영한다 (연출 전용, C3)
      var crowd = clamp(Math.log10(stage.viewers + 10) * 22, 12, 90);
      for (var i = 0; i < crowd; i++) {
        var cx = (i * 137 + 61) % 960, cy = 18 + (i * 53 % 70);
        ctx.fillStyle = 'rgba(255,220,170,' + (0.08 + 0.1 * Math.abs(Math.sin(t * 1.4 + i))) + ')';
        ctx.fillRect(cx, cy, 3, 3);
      }
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(0, 96, 960, 6);
      // 스포트라이트
      for (var s = 0; s < 2; s++) {
        var lx = s ? 660 : 310;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var cone = ctx.createRadialGradient(lx, 40, 10, lx, 320, 300);
        cone.addColorStop(0, 'rgba(255,230,180,.08)'); cone.addColorStop(1, 'rgba(255,230,180,0)');
        ctx.fillStyle = cone; ctx.fillRect(lx - 280, 30, 560, 400);
        ctx.restore();
      }
      // 배틀 플랫폼
      [[660, 270, 120, 26], [310, 385, 160, 32]].forEach(function (p) {
        var pg = ctx.createRadialGradient(p[0], p[1], 8, p[0], p[1], p[2]);
        pg.addColorStop(0, '#2c3448'); pg.addColorStop(1, '#1a2030');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.ellipse(p[0], p[1], p[2], p[3], 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(120,150,200,.25)'; ctx.lineWidth = 2; ctx.stroke();
      });
    }

    function drawMon(ctx, t, type, x, y, r, isFoe, hpFrac, name, flash, atkT, downT) {
      var T = TYPES[type];
      var bob = Math.sin(t * 2.2 + (isFoe ? 1.7 : 0)) * 4;
      var dx = 0, dy = 0, alpha = 1, squash = 1;
      if (atkT >= 0 && atkT < .35) { // 돌진
        var p = Math.sin(atkT / .35 * Math.PI);
        dx = (isFoe ? -1 : 1) * p * 70; dy = -p * 24;
      }
      if (downT >= 0) { alpha = Math.max(0, 1 - downT); dy = downT * 46; squash = 1 - downT * .4; }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + dx, y + bob + dy);
      ctx.scale(1, squash);
      // 그림자
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse(0, r * .78, r * .95, r * .26, 0, 0, TAU); ctx.fill();
      // 몸통
      var bg = ctx.createRadialGradient(-r * .3, -r * .4, r * .15, 0, 0, r * 1.1);
      bg.addColorStop(0, T.c2); bg.addColorStop(.55, T.c); bg.addColorStop(1, '#00000055');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * .88, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2.5; ctx.stroke();
      // 타입별 실루엣 — 불: 가시 / 물: 지느러미 / 풀: 잎
      ctx.fillStyle = T.c;
      if (type === 0) for (var k = 0; k < 5; k++) {
        var a = -Math.PI * .8 + k * .3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * .9, Math.sin(a) * r * .8);
        ctx.lineTo(Math.cos(a) * r * 1.28, Math.sin(a) * r * 1.16);
        ctx.lineTo(Math.cos(a + .16) * r * .86, Math.sin(a + .16) * r * .76);
        ctx.closePath(); ctx.fill();
      } else if (type === 1) {
        ctx.beginPath(); ctx.moveTo(0, -r * .84); ctx.quadraticCurveTo(r * .3, -r * 1.34, r * .06, -r * .8); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-r * .95, 0, r * .3, r * .14, -.5, 0, TAU); ctx.fill();
      } else {
        ctx.save(); ctx.translate(0, -r * .86); ctx.rotate(Math.sin(t * 3) * .15);
        ctx.beginPath(); ctx.ellipse(0, -r * .18, r * .14, r * .3, .3, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, -r * .18, r * .14, r * .3, -.3, 0, TAU); ctx.fill();
        ctx.restore();
      }
      // 얼굴 (적만 정면 — 플레이어는 등)
      if (isFoe) {
        ctx.fillStyle = '#14161a';
        ctx.beginPath(); ctx.arc(-r * .3, -r * .12, r * .09, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(r * .3, -r * .12, r * .09, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#14161a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, r * .16, r * .18, .2, Math.PI - .2); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, -r * .1, r * .5, -.4, .4); ctx.stroke();
      }
      if (flash > .02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,255,255,' + flash + ')';
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * .88, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
      // HP 바
      var bw = 110, bx = x - bw / 2, by = y - r - 34;
      ctx.fillStyle = 'rgba(10,10,14,.75)'; ctx.fillRect(bx - 4, by - 15, bw + 8, 26);
      ctx.font = '10.5px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ece7dd';
      ctx.fillText(name + (isFoe ? ' (야생)' : ''), bx, by - 4);
      ctx.fillStyle = '#000'; ctx.fillRect(bx, by, bw, 6);
      ctx.fillStyle = hpFrac > .5 ? '#6fd98f' : hpFrac > .25 ? '#ffb447' : '#ff5a4a';
      ctx.fillRect(bx, by, bw * clamp(hpFrac, 0, 1), 6);
    }
  }

  Shell.register({
    id: 'pocket',
    title: '주머니 괴수',
    tagline: '3마리로 뛰는 끝없는 연승전. 안정타는 시시하고, 명중 38% 필살기와 빈사 역전이 방송을 만든다.',
    duration: SHOW_TIME,
    startViewers: START_VIEWERS,
    usesChain: true,
    chat: window.POCKET_CHAT,
    tuning: { MOVES: MOVES, FRESH: FRESH, CRIT: CRIT, TYPES: 3 },
    foot: '<kbd>1</kbd>~<kbd>4</kbd> 또는 버튼으로 기술 — <b>명중이 낮을수록 시청자가 크게 반응한다.</b> 벤치 클릭으로 교체(한 턴 소모, 유리 상성 교체는 보상)<br>' +
          '같은 기술만 쓰면 물린다(기술 신선도) · 빈사 상태에서의 역전 KO가 최대 수익 · 기절·전멸·장고는 조용히 시청자를 잃는다',
    thumb: function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1b2438'); g.addColorStop(1, '#0e1219');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff6a3d'; ctx.beginPath(); ctx.ellipse(w * .3, h * .68, 26, 22, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6fd98f'; ctx.beginPath(); ctx.ellipse(w * .72, h * .38, 20, 17, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd27a'; ctx.font = 'bold 20px Georgia, serif'; ctx.textAlign = 'center';
      ctx.fillText('VS', w * .51, h * .52);
    },
    start: start,
  });
})();
