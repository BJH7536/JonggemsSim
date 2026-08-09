/* 해체쇼 — 작업대 위 폭탄을 연속 해체하는 3분 방송. 폭탄 하나 = 의뢰 하나.
 *
 * 공통 명제 유지 — **안전한 플레이가 최악의 전략이다.**
 *   전부 판독하고 해체 +25~40  ≪  감컷 성공 +80~500×연쇄  ≪  폭발(대참사) +500~1,200
 * 판독(3초·지루·시청자 소량 이탈)은 정보를 주는 대신 배당을 죽인다.
 * 감컷은 미판독 와이어가 많고 남은 시간이 많을수록 크다 — 정보가 없을수록 방송이 된다.
 * 시간 초과 폭발은 gain 0: 아무것도 안 한 폭발은 볼거리가 아니다 (idle 방치의 벌).
 *
 * 규약 5: 뼈대 = 연쇄 배수(연속 해체·셸 미터 재사용). 양념 = 도네.
 * ⚠ 밸런스는 데모용 1차 조율값 — 스윕 검증 전이다.
 */
(function () {
  'use strict';

  var U = Shell.util, clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  var sfx = Shell.sfx;

  var SHOW_TIME = 180;
  var START_VIEWERS = 300;

  // 와이어 색 팔레트 — 폭탄마다 섞어 뽑는다 (색은 연출 전용, 함정과 무상관)
  var COLORS = [
    { n: '빨강', c: '#ff5a4a' }, { n: '파랑', c: '#4aa0ff' }, { n: '노랑', c: '#ffd24a' },
    { n: '초록', c: '#6fd98f' }, { n: '보라', c: '#c58aff' }, { n: '주황', c: '#ff9a4a' },
  ];

  // ---------- 밸런스 상수 ----------
  var SCAN_TIME = 3;                              // 판독 소요(초) — 폭탄 시계는 그동안에도 돈다
  var DOWN_TIME = 10;                             // 폭발 후 작업대 파손(초)
  var CUT_BASE = 34;                              // 감컷 배당 = BASE × 미판독 수 × 시간계수 × 연쇄
  var CUT_MIN = 80, CUT_MAX = 500;
  var BOOM_MIN = 500, BOOM_MAX = 1200;            // 폭발 구경값 (라운드 가산)
  var SCAN_DEFUSE_MIN = 25, SCAN_DEFUSE_MAX = 40; // 전부 판독하고 해체 = 겨우 소액
  var GUT_DEFUSE_BASE = 80, GUT_DEFUSE_PER = 50;  // 감컷 섞인 해체 보너스 (×연쇄)
  var CLUTCH_SEC = 2, CLUTCH_BONUS = 300;         // 잔여 2초 미만 해체 = 클러치
  var MILES = [1000, 5000, 15000, 60000, 150000];

  // ---------- SFX (절차 합성 — 외부 에셋 0) ----------
  var sfxSnip   = function () { if (!sfx.gate('bb_s')) return; sfx.noise(.06, .07, 1400); sfx.tone(900, .05, 'square', .04); };
  var sfxScan   = function () { if (!sfx.gate('bb_sc')) return; sfx.tone(1200, .06, 'sine', .035); };
  var sfxSafe   = function () { if (!sfx.gate('bb_ok')) return; sfx.tone(660, .08, 'sine', .05); sfx.tone(880, .1, 'sine', .05, .06); };
  var sfxTrap   = function () { if (!sfx.gate('bb_tr')) return; sfx.tone(220, .16, 'sawtooth', .06); sfx.tone(160, .2, 'sawtooth', .05, .1); };
  var sfxBoom   = function () { if (!sfx.gate('bb_bm')) return; sfx.noise(.5, .25, 180); sfx.tone(50, .4, 'sine', .2); };
  var sfxDefuse = function () { if (!sfx.gate('bb_df')) return; sfx.tone(523, .09, 'triangle', .1); sfx.tone(659, .1, 'triangle', .1, .07); sfx.tone(784, .16, 'triangle', .1, .14); };
  var sfxTick   = function () { if (!sfx.gate('bb_tk')) return; sfx.tone(1568, .05, 'square', .03); };

  // ---------- AetherAI 생성 아트 (tools/aether-assets.json) ----------
  // 작업실 배경 플레이트·폭탄 몸통·폭발 VFX 시트. 없거나 로드 전이면 기존 벡터로 폴백.
  // 와이어·타이머·판독 게이지·스파크는 인터랙션 그 자체라 계속 절차적으로 그린다.
  // 파싱 시점이 아니라 방송 준비(카운트다운) 때 내려받는다 — 첫 화면 payload 절약. 재호출 no-op.
  var IMG = {};
  function loadArt() {
    if (IMG['bench-bg']) return;
    [['bench-bg', 'jpg'], ['bomb-body', 'png'], ['vfx-boom', 'jpg']].forEach(function (e) {
      var im = new Image();
      im.src = 'games/bomb/img/' + e[0] + '.' + e[1];
      IMG[e[0]] = im;
    });
  }
  function imgReady(n) { var im = IMG[n]; return im && im.complete && im.naturalWidth > 0; }
  var VFX_DUR = 0.7, VFX_GRID = 4;

  function start(stage) {
    loadArt(); // 셸이 preload를 안 불렀어도 (구버전 셸) 여기서라도 건다
    var st = {
      round: 0, chain: 1, maxChain: 1,
      defused: 0, booms: 0, clutches: 0, maxPay: 0,
      bomb: null, scan: null, downT: 0,
      idleT: 0, nagged: false, tickT: 0,
      timers: [], chatT: 3, mileIdx: 0,
      sparks: [], floaters: [], vfx: [],
    };
    var panel = stage.panel;

    function after(sec, fn) { st.timers.push({ t: sec, fn: fn }); }
    function floater(x, y, txt, color) { st.floaters.push({ x: x, y: y, txt: txt, t: 0, c: color || '#ffd27a' }); }
    function spawnSparks(x, y, n, c) {
      for (var i = 0; i < n; i++) st.sparks.push({
        x: x, y: y, vx: (Math.random() - .5) * 260, vy: -Math.random() * 220, t: 0, c: c,
      });
    }
    function wireY(i) {
      var n = st.bomb.wires.length;
      return 236 - (n - 1) * 19 + i * 38;
    }

    // ---------- 폭탄 생성 (라운드제 — 폭탄 하나 = 의뢰 하나) ----------
    function newBomb() {
      st.round++;
      var n = clamp(4 + Math.floor((st.round - 1) / 2), 4, 6);    // 4 → 5 → 6가닥
      var traps = st.round >= 4 ? 2 : 1;                          // 라운드 오르면 함정 2개
      var limit = clamp(35 - (st.round - 1) * 2, 20, 35);         // 제한시간은 짧아진다
      // 색 셔플 후 n개 · 함정 인덱스 무작위 배치
      var pool = COLORS.slice();
      for (var i = pool.length - 1; i > 0; i--) {
        var j = rnd(0, i), tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      var trapIdx = {};
      while (Object.keys(trapIdx).length < traps) trapIdx[rnd(0, n - 1)] = true;
      st.bomb = {
        limit: limit, t: limit, gutCuts: 0,
        wires: pool.slice(0, n).map(function (col, k) {
          return { color: col, trap: !!trapIdx[k], cut: false, revealed: false };
        }),
      };
      st.scan = null; st.idleT = 0; st.nagged = false;
      stage.emit('new_bomb', { wires: n, limit: limit });
      stage.ticker('의뢰 #' + st.round + ' — 와이어 ' + n + '가닥 / ' + limit + '초', false);
      buildPanel();
    }

    // ---------- HUD ----------
    stage.hud('⏱ 방송 <b id="bbTime">3:00</b> · 해체 <b id="bbDef">0</b> · 폭발 <b id="bbBoom">0</b> · 의뢰 <b id="bbRnd">0</b>');
    function renderHUD() {
      var e;
      if ((e = document.getElementById('bbDef'))) e.textContent = st.defused;
      if ((e = document.getElementById('bbBoom'))) e.textContent = st.booms;
      if ((e = document.getElementById('bbRnd'))) e.textContent = st.round;
      stage.setChain(st.chain);
    }

    // ---------- 패널 ----------
    var BTN = 'margin:3px 2px 0;padding:4px 9px;font-size:11px;background:#241c30;color:#ece7dd;' +
              'border:1px solid #3a3344;border-radius:6px;cursor:pointer';
    function buildPanel() {
      if (st.downT > 0) {
        panel.innerHTML = '<div style="width:100%;text-align:center;padding:18px;font-size:15px;color:#ece7dd">' +
          '💥 작업대 파손 — 수리 <b style="color:#ffd27a"><span id="bbDown">' + st.downT.toFixed(1) + '</span>초</b>' +
          '<br><span style="font-size:11.5px;color:#8a8478">수리하는 동안 시청자가 조용히 빠져나간다</span></div>';
        return;
      }
      if (!st.bomb) { panel.innerHTML = ''; return; }
      var rows = st.bomb.wires.map(function (w, i) {
        var tag = w.cut ? '절단됨' : (w.revealed ? (w.trap ? '⚠ 함정' : '✓ 안전') : '미판독');
        var scanning = st.scan && st.scan.wi === i;
        return '<div style="flex:1 1 128px;background:#171221;border:1px solid ' +
          (w.revealed && w.trap && !w.cut ? '#a03a2e' : '#3a3344') + ';border-radius:8px;padding:7px 8px;text-align:center">' +
          '<b style="color:' + w.color.c + ';font-size:12px">' + (i + 1) + '. ' + w.color.n + '</b> ' +
          '<span style="font-size:9.5px;color:#8a8478">' + tag + '</span><br>' +
          '<button data-cut="' + i + '" style="' + BTN + '"' + (w.cut ? ' disabled' : '') + '>✂ 감컷</button>' +
          '<button data-scan="' + i + '" style="' + BTN + '"' +
          (w.cut || w.revealed || st.scan ? ' disabled' : '') + '>' + (scanning ? '판독중…' : '🔍 3초') + '</button>' +
          '</div>';
      }).join('');
      panel.innerHTML = '<div style="display:flex;gap:7px;flex-wrap:wrap">' + rows + '</div>';
      renderHUD();
    }
    function onPanelClick(e) {
      var t = e.target.closest('[data-cut],[data-scan]');
      if (!t || t.disabled || !stage.live || !st.bomb || st.downT > 0) return;
      if (t.dataset.cut != null) cutWire(+t.dataset.cut);
      else scanWire(+t.dataset.scan);
    }
    panel.addEventListener('click', onPanelClick);

    // ---------- 판독 (안전한 길 — 3초·지루·배당 죽음) ----------
    function scanWire(i) {
      var w = st.bomb.wires[i];
      if (!w || w.cut || w.revealed || st.scan) return;
      st.idleT = 0;
      st.scan = { wi: i, t: SCAN_TIME };
      sfxScan();
      buildPanel();
    }

    // ---------- 감컷 (도박 — 배당 아니면 폭발) ----------
    function cutWire(i) {
      var w = st.bomb ? st.bomb.wires[i] : null;
      if (!w || w.cut) return;
      st.idleT = 0;
      if (st.scan && st.scan.wi === i) st.scan = null; // 판독 중이던 선을 잘라버리면 판독 취소
      if (w.trap) { w.cut = true; boom(true); return; }
      w.cut = true;
      sfxSnip();
      spawnSparks(480, wireY(i), 8, w.color.c);
      if (w.revealed) {
        // 판독된 안전선 — 배당 없음. 조용한 소액조차 아니다: 그냥 작업이다
        stage.emit('cut_safe');
        stage.ticker(w.color.n + ' 절단 — 판독된 선은 배당이 없다', false);
      } else {
        // 미판독 감컷 성공 = 배당. 미판독이 많고 시간이 많을수록 크다
        var unscanned = st.bomb.wires.filter(function (x) { return !x.cut && !x.revealed; }).length + 1;
        var base = CUT_BASE * unscanned * (0.55 + 0.85 * st.bomb.t / st.bomb.limit);
        var g = clamp(Math.round(base * st.chain), CUT_MIN, CUT_MAX);
        st.bomb.gutCuts++;
        var actual = stage.gain(g, '감컷 적중!', 'cut_paid');
        st.maxPay = Math.max(st.maxPay, actual);
        stage.shake(5); stage.flash(.12);
        floater(480, wireY(i) - 18, '+' + actual.toLocaleString(), '#ffd27a');
        stage.emit('cut_paid', { gain: actual.toLocaleString() });
      }
      checkDefused();
    }

    // ---------- 해체 완료 ----------
    function checkDefused() {
      if (!st.bomb.wires.every(function (w) { return w.trap || w.cut; })) { buildPanel(); return; }
      st.defused++;
      var clutch = st.bomb.t < CLUTCH_SEC;
      var gut = st.bomb.gutCuts;
      var actual;
      if (gut === 0 && !clutch) {
        // 전부 판독하고 해체 — 배당 없이 겨우 소액. 안전은 지루하다
        actual = stage.gain(rnd(SCAN_DEFUSE_MIN, SCAN_DEFUSE_MAX), null, 'defused');
        stage.ticker('겨우 해체 — 판독으로 다 쓴 방송 +' + actual, false);
        stage.emit('defused', { gain: actual.toLocaleString() });
      } else {
        var base = GUT_DEFUSE_BASE + GUT_DEFUSE_PER * gut + (clutch ? CLUTCH_BONUS : 0);
        actual = stage.gain(Math.round(base * st.chain),
          clutch ? '클러치 해체!!!' : '해체 완료!', clutch ? 'defused_clutch' : 'defused');
        if (clutch) {
          st.clutches++;
          stage.stamp('클러치'); stage.flash(.35);
          stage.emit('defused_clutch', { sec: st.bomb.t.toFixed(1), gain: actual.toLocaleString() });
        } else {
          stage.emit('defused', { gain: actual.toLocaleString() });
        }
      }
      st.maxPay = Math.max(st.maxPay, actual);
      sfxDefuse();
      // 연쇄 배수 — 연속 해체마다 ×0.5, 최대 ×3
      if (st.chain < 3) {
        st.chain = Math.min(3, st.chain + .5);
        st.maxChain = Math.max(st.maxChain, st.chain);
        stage.setChain(st.chain);
        stage.emit('chain_up', { x: st.chain.toFixed(1) });
      }
      st.bomb = null; st.scan = null;
      renderHUD();
      after(1.2, newBomb);
    }

    // ---------- 폭발 (함정 컷 = 대참사 콘텐츠 / 시간초과 = 조용한 벌) ----------
    function boom(paid) {
      st.booms++;
      st.chain = 1; stage.setChain(1);
      sfxBoom();
      stage.shake(14); stage.flash(paid ? .5 : .3);
      spawnSparks(480, 230, 40, '#ffb447');
      // 폭발 VFX — 시트 없으면 스파크만으로 폴백 (연출 전용)
      if (imgReady('vfx-boom')) st.vfx.push({ x: 480, y: 235, s: paid ? 2.4 : 1.8, born: stage.now });
      if (paid) {
        var g = clamp(rnd(BOOM_MIN, 900) + (st.round - 1) * 40, BOOM_MIN, BOOM_MAX);
        var actual = stage.gain(g, '폭발!! 대참사', 'boom');
        stage.stamp('폭발');
        stage.emit('boom', { gain: actual.toLocaleString() });
      } else {
        // 아무것도 안 한 폭발은 볼거리가 아니다 — 조용히, gain 없음
        stage.ticker('시간 초과 — 폭탄이 그냥 터졌다', true);
        stage.emit('timeout_boom');
      }
      st.bomb = null; st.scan = null;
      st.downT = DOWN_TIME; // 작업대 파손 — 연쇄 리셋에 더해 10초 다운타임
      renderHUD();
      buildPanel();
    }

    // ---------- 주변 채팅 ----------
    function ambient() {
      if (st.mileIdx < MILES.length && stage.viewers >= MILES[st.mileIdx]) {
        stage.emit('milestone', { v: MILES[st.mileIdx++].toLocaleString() });
        return;
      }
      stage.emit('idle');
    }

    newBomb();
    stage.ticker('방송 시작! 판독은 안전하고 지루하다 — 감으로 잘라라', false);

    // ---------- 인스턴스 ----------
    return {
      st: st,

      step: function (dt) {
        var e = document.getElementById('bbTime');
        if (e) e.textContent = U.fmtTime(stage.timeLeft);

        for (var i = st.timers.length - 1; i >= 0; i--) {
          st.timers[i].t -= dt;
          if (st.timers[i].t <= 0) { var fn = st.timers[i].fn; st.timers.splice(i, 1); fn(); }
        }

        // 작업대 파손 — 조용히 샌다
        if (st.downT > 0) {
          st.downT -= dt;
          stage.lose(Math.max(1, stage.viewers * 0.006) * dt);
          var d = document.getElementById('bbDown');
          if (d) d.textContent = Math.max(0, st.downT).toFixed(1);
          if (st.downT <= 0) { st.downT = 0; newBomb(); }
        }

        if (st.bomb) {
          // 폭탄 시계 — 판독 중에도 돈다
          st.bomb.t -= dt;
          if (st.bomb.t <= 5) {
            st.tickT += dt;
            if (st.tickT >= 1) { st.tickT = 0; sfxTick(); }
          }
          if (st.bomb.t <= 0) { boom(false); }
          else {
            // 판독 진행 — 지루: 시청자 소량 이탈 (규약 2 — 조용히)
            if (st.scan) {
              st.scan.t -= dt;
              stage.lose(Math.max(1, stage.viewers * 0.01) * dt);
              if (st.scan.t <= 0) {
                var w = st.bomb.wires[st.scan.wi];
                w.revealed = true;
                if (w.trap) sfxTrap(); else sfxSafe();
                stage.emit('scan_reveal', { result: w.trap ? '함정' : '안전' });
                st.scan = null;
                buildPanel();
              }
            } else {
              // 방치 — 조용한 이탈 + 잔소리
              st.idleT += dt;
              if (st.idleT > 4) stage.lose(Math.max(1, stage.viewers * 0.006) * dt);
              if (st.idleT > 6 && !st.nagged) { st.nagged = true; stage.emit('nag'); }
            }
          }
        }

        // 도네 주기·확률·금액은 셸 소유 (contract 4.2, ADR-008) — 방송 장비가 빈도를 조절한다
        stage.donRoll(dt, 9, .45);
        st.chatT -= dt;
        if (st.chatT <= 0) {
          st.chatT = clamp(4 - Math.log10(stage.viewers + 10) * .55, 1.3, 4) + Math.random() * 1.5;
          ambient();
        }

        st.sparks = st.sparks.filter(function (s) {
          s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 500 * dt;
          return s.t < .6;
        });
        st.floaters = st.floaters.filter(function (f) { f.t += dt; return f.t < 1; });
      },

      key: function (e) {
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= 4 && st.bomb && st.downT === 0) cutWire(n - 1); // 빠른 손 = 감컷
      },

      pointer: function (p, type) {
        if (type !== 'down' || !st.bomb || st.downT > 0) return;
        for (var i = 0; i < st.bomb.wires.length; i++) {
          if (p.x > 280 && p.x < 680 && Math.abs(p.y - wireY(i)) < 16 && !st.bomb.wires[i].cut) {
            cutWire(i); return;
          }
        }
      },

      // 튜닝 계측용 상태 노출 — ?guoidebug 를 붙였을 때만 (GUOI와 같은 규약)
      debug: (typeof location !== 'undefined' && /guoidebug/.test(location.search))
        ? function () { return st; } : null,

      summary: function () {
        return [
          ['해체 / 폭발', st.defused + ' / ' + st.booms],
          ['최고 연쇄 / 클러치', '×' + st.maxChain.toFixed(1) + ' / ' + st.clutches],
          ['최대 단일 배당', st.maxPay.toLocaleString() + '명'],
        ];
      },

      dispose: function () { panel.removeEventListener('click', onPanelClick); },

      draw: function (ctx) {
        var t = stage.now;
        drawBench(ctx, t);
        if (st.bomb) drawBomb(ctx, t);
        else if (st.downT > 0) drawWreck(ctx, t);
        // 스파크
        st.sparks.forEach(function (s) {
          ctx.globalAlpha = 1 - s.t / .6;
          ctx.fillStyle = s.c;
          ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
        });
        ctx.globalAlpha = 1;
        // 폭발 VFX — 4x4 시트를 'screen' 블렌드로 얹는다 (포켓과 같은 파이프라인)
        st.vfx = st.vfx.filter(function (f) {
          var p = (t - f.born) / VFX_DUR;
          if (p >= 1) return false;
          if (p < 0) return true;
          var im = IMG['vfx-boom'];
          var n = VFX_GRID * VFX_GRID, idx = Math.min(n - 1, (p * n) | 0);
          var fw = im.naturalWidth / VFX_GRID, fh = im.naturalHeight / VFX_GRID;
          var size = 170 * f.s;
          // 생성 시트의 셀 경계 격자선 방지 — 소스 사각형을 4% 안쪽으로 판다
          var inx = fw * .04, iny = fh * .04;
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = p > .8 ? (1 - p) * 5 : 1;
          ctx.drawImage(im,
                        (idx % VFX_GRID) * fw + inx, ((idx / VFX_GRID) | 0) * fh + iny,
                        fw - inx * 2, fh - iny * 2,
                        f.x - size / 2, f.y - size / 2, size, size);
          ctx.restore();
          return true;
        });
        // 플로터
        st.floaters.forEach(function (f) {
          ctx.globalAlpha = 1 - f.t;
          ctx.fillStyle = f.c; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(f.txt, f.x, f.y - f.t * 40);
          ctx.globalAlpha = 1;
        });
      },
    };

    // ---------- 렌더 ----------
    function drawBench(ctx, t) {
      // 배경 정물은 AetherAI 플레이트 — 작업등 콘은 살아있는 층이라 계속 위에 얹는다
      if (imgReady('bench-bg')) {
        ctx.drawImage(IMG['bench-bg'], 0, 0, 960, 430);
      } else {
        var g = ctx.createLinearGradient(0, 0, 0, 430);
        g.addColorStop(0, '#12141c'); g.addColorStop(.6, '#181a24'); g.addColorStop(1, '#0c0d12');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 430);
        // 작업대 상판 — 이미지에선 하단 1/3이 상판이라 폴백에서만 그린다
        ctx.fillStyle = '#2a2620'; ctx.fillRect(120, 386, 720, 44);
        ctx.fillStyle = '#3a352c'; ctx.fillRect(120, 380, 720, 8);
      }
      // 작업등 콘
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var cone = ctx.createRadialGradient(480, 20, 20, 480, 260, 340);
      cone.addColorStop(0, 'rgba(255,235,190,.1)'); cone.addColorStop(1, 'rgba(255,235,190,0)');
      ctx.fillStyle = cone; ctx.fillRect(140, 10, 680, 420);
      ctx.restore();
    }

    function drawBomb(ctx, t) {
      var b = st.bomb;
      // 타이머 LED — 몸통 위
      var warn = b.t < 5;
      ctx.fillStyle = '#0a0a0e'; ctx.fillRect(400, 56, 160, 36);
      ctx.strokeStyle = '#3a3344'; ctx.lineWidth = 2; ctx.strokeRect(400, 56, 160, 36);
      ctx.fillStyle = warn && Math.floor(t * 4) % 2 ? '#ff8d7a' : '#ff4a3d';
      ctx.font = 'bold 28px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.fillText(Math.max(0, b.t).toFixed(1), 480, 84);
      // 폭탄 몸통 — 스프라이트가 있으면 케이스만 이미지로, 와이어·표기는 그대로 위에
      if (imgReady('bomb-body')) {
        ctx.drawImage(IMG['bomb-body'], 260, 100, 440, 278);
      } else {
        var bg = ctx.createLinearGradient(0, 100, 0, 380);
        bg.addColorStop(0, '#3c4150'); bg.addColorStop(.5, '#2b2f3a'); bg.addColorStop(1, '#1c1f28');
        ctx.fillStyle = bg;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(260, 100, 440, 278, 16); else ctx.rect(260, 100, 440, 278);
        ctx.fill();
        ctx.strokeStyle = '#4a5060'; ctx.lineWidth = 2.5; ctx.stroke();
        // 볼트
        [[276, 116], [684, 116], [276, 362], [684, 362]].forEach(function (p) {
          ctx.fillStyle = '#151820';
          ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, TAU); ctx.fill();
        });
      }
      // 와이어
      b.wires.forEach(function (w, i) {
        var y = wireY(i);
        ctx.lineWidth = 5; ctx.strokeStyle = w.color.c;
        ctx.lineCap = 'round';
        if (w.cut) {
          // 절단 — 양끝 늘어진 토막, 그을린 단면
          ctx.globalAlpha = .8;
          ctx.beginPath(); ctx.moveTo(300, y); ctx.quadraticCurveTo(380, y + 8, 430, y + 14); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(660, y); ctx.quadraticCurveTo(580, y + 8, 530, y + 14); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#111';
          ctx.beginPath(); ctx.arc(430, y + 14, 4, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.arc(530, y + 14, 4, 0, TAU); ctx.fill();
        } else {
          var sag = Math.sin(t * 1.6 + i * 2.1) * 2;
          ctx.beginPath(); ctx.moveTo(300, y);
          ctx.quadraticCurveTo(480, y + 10 + sag, 660, y); ctx.stroke();
          // 판독 결과 표기
          if (w.revealed) {
            ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'left';
            ctx.fillStyle = w.trap ? '#ff5a4a' : '#6fd98f';
            ctx.fillText(w.trap ? '✕ 함정' : '✓ 안전', 672, y + 4);
          }
          // 판독 진행 게이지
          if (st.scan && st.scan.wi === i) {
            var p = 1 - st.scan.t / SCAN_TIME;
            ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(480, y - 2, 13, -Math.PI / 2, -Math.PI / 2 + p * TAU); ctx.stroke();
            ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
            ctx.fillStyle = '#ffd27a'; ctx.fillText('🔍', 480, y + 2);
          }
        }
        // 번호
        ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'right';
        ctx.fillStyle = '#8a8478'; ctx.fillText(String(i + 1), 292, y + 4);
      });
    }

    function drawWreck(ctx, t) {
      // 폭발 잔해 — 그을음 + 연기
      ctx.fillStyle = 'rgba(10,8,6,.8)';
      ctx.beginPath(); ctx.ellipse(480, 300, 240, 70, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a1510';
      ctx.beginPath(); ctx.ellipse(480, 290, 170, 46, 0, 0, TAU); ctx.fill();
      for (var i = 0; i < 6; i++) {
        var ph = (t * .5 + i * .37) % 1;
        ctx.fillStyle = 'rgba(120,115,105,' + (0.16 * (1 - ph)) + ')';
        ctx.beginPath();
        ctx.arc(430 + i * 22 + Math.sin(t + i) * 12, 280 - ph * 170, 14 + ph * 26, 0, TAU);
        ctx.fill();
      }
      ctx.font = 'bold 17px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#9a9184';
      ctx.fillText('작업대 수리 중… ' + Math.max(0, st.downT).toFixed(1) + '초', 480, 180);
    }
  }

  Shell.register({
    id: 'bomb',
    title: '해체쇼',
    tagline: '매뉴얼대로 판독하면 안전하고 지루하다. 감으로 자르면 배당 아니면 폭발 — 실수 없는 해체가 최악의 방송이다.',
    duration: SHOW_TIME,
    startViewers: START_VIEWERS,
    usesChain: true,
    chat: window.BOMB_CHAT,
    preload: loadArt,
    tuning: {
      SCAN_TIME: SCAN_TIME, DOWN_TIME: DOWN_TIME,
      CUT_BASE: CUT_BASE, CUT_MIN: CUT_MIN, CUT_MAX: CUT_MAX,
      BOOM_MIN: BOOM_MIN, BOOM_MAX: BOOM_MAX,
      SCAN_DEFUSE: [SCAN_DEFUSE_MIN, SCAN_DEFUSE_MAX],
      GUT_DEFUSE_BASE: GUT_DEFUSE_BASE, GUT_DEFUSE_PER: GUT_DEFUSE_PER,
      CLUTCH_SEC: CLUTCH_SEC, CLUTCH_BONUS: CLUTCH_BONUS,
    },
    foot: '<kbd>1</kbd>~<kbd>4</kbd> 또는 와이어 클릭 = <b>감컷</b>(미판독일수록·시간 많을수록 배당 큼) · 🔍 버튼 = 판독 3초(안전하지만 지루·배당 죽음)<br>' +
          '함정 컷 = 폭발(+구경값, 작업대 10초 파손, 연쇄 리셋) · 잔여 2초 미만 해체 = 클러치 · 시간 초과 폭발은 아무것도 못 받는다',
    thumb: function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#181a24'); g.addColorStop(1, '#0c0d12');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = '#2b2f3a';
      c.fillRect(w * .2, h * .28, w * .6, h * .5);
      c.strokeStyle = '#4a5060'; c.lineWidth = 1.5; c.strokeRect(w * .2, h * .28, w * .6, h * .5);
      ['#ff5a4a', '#4aa0ff', '#ffd24a', '#6fd98f'].forEach(function (col, i) {
        c.strokeStyle = col; c.lineWidth = 3; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(w * .24, h * (.38 + i * .1));
        c.quadraticCurveTo(w * .5, h * (.42 + i * .1), w * .76, h * (.38 + i * .1));
        c.stroke();
      });
      c.fillStyle = '#0a0a0e'; c.fillRect(w * .38, h * .1, w * .24, h * .14);
      c.fillStyle = '#ff4a3d'; c.font = 'bold 11px "Courier New", monospace'; c.textAlign = 'center';
      c.fillText('19.9', w * .5, h * .21);
    },
    start: start,
  });
})();
