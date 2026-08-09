/* 해체쇼 v2 — 작업대 위 폭탄을 연속 해체하는 3분 방송. 폭탄 하나 = 의뢰 하나.
 *
 * v2의 명제: **매 순간 플레이어가 고르고 있어야 한다.**
 *   v1은 지배 전략(고의 폭발)이 3분 중 169초를 무입력 대기로 만들었다 (실측).
 *   원인은 파손 시간이 아니라 "끊을 수 있는 선택지가 없다"는 것 — 자르거나, 안 자르거나뿐이었다.
 *
 * 공통 명제 유지 — **안전한 플레이가 최악의 전략이다.**
 *   포트는 위험할수록 크게 쌓인다: 배당 = BASE × (0.55 + 2.0 × 함정확률).
 *   1가닥 자르고 끊기를 반복하면 위험이 낮아 포트가 작고 연쇄도 안 오른다.
 *
 * 매 컷 뒤에 열리는 선택 (이것이 이 게임의 전부):
 *   ① 한 가닥 더 — 남은 와이어가 줄수록 함정 확률이 올라 배당도 커진다
 *   ② 지금 끊기 — 쌓은 포트를 확정하고 즉시 다음 의뢰로. 단 연쇄는 오르지 않는다
 *   ③ 판독 (폭탄당 2~3회, 즉시) — 정보를 사되 그 선의 배당은 30% 죽는다.
 *      함정을 전부 찾아내면 남은 선은 확정 안전 → 완주가 열린다 (설계가 노리는 숙련 플레이)
 *   ④ 완주 — 안전선을 전부 자르면 완주 보너스 + 연쇄 상승(연쇄는 완주로만 오른다)
 * 폭발은 포트를 날린다. 구경값 = 포트 × 0.7 — **크게 쌓아놓고 터져야 볼거리다.**
 * 첫 컷에 터뜨리면 포트가 0이라 수익도 0: v1의 고의 폭발 파밍이 구조적으로 닫힌다.
 *
 * 규약 5: 뼈대 = 포트·연쇄(실력 연동). 양념 = 도네.
 * ⚠ 밸런스는 헤드리스 스윕 1차 조율값 (tools 하네스 검증).
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
  var SCANS_BASE = 2;            // 폭탄당 판독 횟수 = 2 + (와이어−4)/2 — 즉시 판정이라 대가는 '배당'과 '횟수'뿐
  var SCAN_PAY_MULT = 0.7;       // 판독한 선을 자를 때의 포트 기여율 (정보는 배당을 죽이되, 죽이기만 하면
                                 // 아무도 안 사서 전원이 눈감고 자른다 → 폭발만 남는다. 0.4에서 상향)
  var CUT_BASE = 90;             // 포트 적립 = BASE × (0.55 + 2.0 × 함정확률)
  var RISK_GAIN = 2.0;
  var CLEAR_BASE = 180, CLEAR_PER_ROUND = 50;   // 완주 보너스
  var BOOM_POT_MULT = 0.7;       // 폭발 구경값 = 포트 × 이 값 × 반복 감쇠
  var BOOM_DECAY = [1, .8, .65, .5, .4];        // 폭발도 반복하면 물린다 (규약 4)
  var CUT_TIME = 0.8;            // 절단 소요(초) — 니퍼가 물리는 순간. 폭탄 시계는 그동안에도 돈다.
                                 // 이 시간이 없으면 방송이 초당 2회 클릭의 연타가 된다 (v2 1차 스윕 실측)
  var DOWN_TIME = 3;             // 파손(초) — 이 3초에도 복구 선택이 있다
  var DOWN_FAST = 1.2;           // '빠른 복구'를 고르면 여기까지 줄어든다
  var NEXT_GAP = 0.8;            // 의뢰 사이 간막
  var CHAIN_MAX = 4;
  var CHAIN_CLEAR = 0.5;         // 완주 시 연쇄 상승
  var MILES = [1000, 5000, 15000, 60000, 150000];

  // 의뢰 조건 — 폭탄마다 하나씩 붙어서 "이번 판은 무엇을 노릴까"를 매번 바꾼다.
  // 조건이 없으면 최적해가 하나로 굳고, 굳으면 선택이 사라진다.
  var CONDS = [
    { id: 'none', n: '조건 없음', m: 1, ok: function () { return true; } },
    { id: 'noscan', n: '무판독 완주 ×2', m: 2, ok: function (b, cleared) { return cleared && b.scansUsed === 0; } },
    { id: 'deep', n: '4가닥 이상 절단 ×1.6', m: 1.6, ok: function (b) { return b.cuts >= 4; } },
    { id: 'fast', n: '시간 절반 남기고 마감 ×1.5', m: 1.5, ok: function (b) { return b.t > b.limit * 0.5; } },
    { id: 'risky', n: '함정확률 50%↑ 컷 성공 ×1.8', m: 1.8, ok: function (b) { return b.hotCuts > 0; } },
  ];

  // ---------- SFX (절차 합성 — 외부 에셋 0) ----------
  var sfxSnip   = function () { if (!sfx.gate('bb_s')) return; sfx.noise(.06, .07, 1400); sfx.tone(900, .05, 'square', .04); };
  var sfxScan   = function () { if (!sfx.gate('bb_sc')) return; sfx.tone(1200, .06, 'sine', .035); };
  var sfxSafe   = function () { if (!sfx.gate('bb_ok')) return; sfx.tone(660, .08, 'sine', .05); sfx.tone(880, .1, 'sine', .05, .06); };
  var sfxTrap   = function () { if (!sfx.gate('bb_tr')) return; sfx.tone(220, .16, 'sawtooth', .06); sfx.tone(160, .2, 'sawtooth', .05, .1); };
  var sfxBoom   = function () { if (!sfx.gate('bb_bm')) return; sfx.noise(.5, .25, 180); sfx.tone(50, .4, 'sine', .2); };
  var sfxCash   = function () { if (!sfx.gate('bb_cs')) return; sfx.tone(784, .07, 'triangle', .08); sfx.tone(1046, .12, 'triangle', .08, .06); };
  var sfxClear  = function () { if (!sfx.gate('bb_df')) return; sfx.tone(523, .09, 'triangle', .1); sfx.tone(659, .1, 'triangle', .1, .07); sfx.tone(784, .16, 'triangle', .1, .14); };
  var sfxTick   = function () { if (!sfx.gate('bb_tk')) return; sfx.tone(1568, .05, 'square', .03); };

  // ---------- AetherAI 생성 아트 (tools/aether-assets.json) ----------
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
    loadArt();
    var st = {
      round: 0, chain: 1, maxChain: 1,
      cleared: 0, cashed: 0, booms: 0, hotCuts: 0, maxPay: 0, totalCuts: 0,
      bomb: null, downT: 0, downChoice: false, scanBonus: 0,
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

    // ---------- 위험도 ----------
    // 남은 '모르는' 와이어 중 함정 비율. 판독으로 함정을 찾아내면 분자에서 빠지므로
    // 안전해지는 대신 배당도 같이 떨어진다 — 정보와 배당의 저울이 이 한 줄에 있다.
    function riskOf(b) {
      var unknown = 0, knownTraps = 0;
      b.wires.forEach(function (w) {
        if (w.cut) return;
        if (w.revealed) { if (w.trap) knownTraps++; }
        else unknown++;
      });
      if (unknown <= 0) return 0;
      return clamp((b.traps - knownTraps) / unknown, 0, 1);
    }

    // ---------- 폭탄 생성 ----------
    function newBomb() {
      st.round++;
      var n = clamp(4 + Math.floor((st.round - 1) / 2), 4, 6);
      var traps = st.round >= 6 ? 2 : 1;   // 함정 2개는 6의뢰부터 — 그 전에 넣으면 첫 컷부터 40%다
      var limit = clamp(30 - (st.round - 1) * 1.5, 18, 30);
      var pool = COLORS.slice();
      for (var i = pool.length - 1; i > 0; i--) {
        var j = rnd(0, i), tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      var trapIdx = {};
      while (Object.keys(trapIdx).length < traps) trapIdx[rnd(0, n - 1)] = true;
      // 1~2 의뢰는 조건 없이 — 조작을 익히기 전에 목표가 늘면 선택이 아니라 혼란이 된다
      var cond = st.round <= 2 ? CONDS[0] : CONDS[rnd(0, CONDS.length - 1)];
      st.bomb = {
        limit: limit, t: limit, traps: traps, cond: cond,
        pot: 0, cuts: 0, hotCuts: 0, scansUsed: 0, cutting: null,
        scansLeft: SCANS_BASE + Math.floor((n - 4) / 2) + st.scanBonus,
        wires: pool.slice(0, n).map(function (col, k) {
          return { color: col, trap: !!trapIdx[k], cut: false, revealed: false };
        }),
      };
      st.scanBonus = 0;
      st.idleT = 0; st.nagged = false;
      stage.emit('new_bomb', { wires: n, limit: Math.round(limit) });
      stage.ticker('의뢰 #' + st.round + ' — 와이어 ' + n + '가닥 / ' + Math.round(limit) + '초 · ' + cond.n, false);
      buildPanel();
    }

    // ---------- HUD ----------
    stage.hud('⏱ 방송 <b id="bbTime">3:00</b> · 완주 <b id="bbClr">0</b> · 끊기 <b id="bbCash">0</b> · 폭발 <b id="bbBoom">0</b> · 의뢰 <b id="bbRnd">0</b>');
    function renderHUD() {
      var e;
      if ((e = document.getElementById('bbClr'))) e.textContent = st.cleared;
      if ((e = document.getElementById('bbCash'))) e.textContent = st.cashed;
      if ((e = document.getElementById('bbBoom'))) e.textContent = st.booms;
      if ((e = document.getElementById('bbRnd'))) e.textContent = st.round;
      stage.setChain(st.chain);
    }

    // ---------- 패널 ----------
    var BTN = 'margin:3px 2px 0;padding:4px 9px;font-size:11px;background:#241c30;color:#ece7dd;' +
              'border:1px solid #3a3344;border-radius:6px;cursor:pointer';
    var BIG = 'margin:0 0 0 10px;padding:10px 16px;font-size:14px;font-weight:700;background:#2f2a1a;' +
              'color:#ffd27a;border:1px solid #7a6636;border-radius:9px;cursor:pointer';
    function buildPanel() {
      if (st.downT > 0) {
        // 파손 3초도 선택이다 — 시간을 살까, 정보를 살까
        panel.innerHTML = '<div style="width:100%;text-align:center;padding:10px;font-size:14px;color:#ece7dd">' +
          '💥 작업대 파손 — <b style="color:#ffd27a"><span id="bbDown">' + st.downT.toFixed(1) + '</span>초</b>' +
          '<div style="margin-top:7px">' +
          '<button data-rep="fast" style="' + BTN + '">⚡ 빠른 복구 — 즉시 재개</button>' +
          '<button data-rep="solid" style="' + BTN + '">🔧 보강 수리 — 다음 의뢰 판독 +1</button>' +
          '</div><span style="font-size:11px;color:#8a8478">고르지 않으면 그냥 3초가 흐른다</span></div>';
        return;
      }
      if (!st.bomb) { panel.innerHTML = ''; return; }
      var b = st.bomb, risk = riskOf(b);
      var rows = b.wires.map(function (w, i) {
        var tag = w.cut ? '절단됨' : (w.revealed ? (w.trap ? '⚠ 함정' : '✓ 안전') : '미판독');
        var pay = w.cut ? 0 : cutValue(b, w);
        return '<div style="flex:1 1 120px;background:#171221;border:1px solid ' +
          (w.revealed && w.trap && !w.cut ? '#a03a2e' : '#3a3344') + ';border-radius:8px;padding:6px 7px;text-align:center">' +
          '<b style="color:' + w.color.c + ';font-size:12px">' + (i + 1) + '. ' + w.color.n + '</b> ' +
          '<span style="font-size:9.5px;color:#8a8478">' + tag + '</span><br>' +
          '<button data-cut="' + i + '" style="' + BTN + '"' + (w.cut || b.cutting ? ' disabled' : '') + '>' +
            (b.cutting && b.cutting.i === i ? '✂ 자르는 중…' : '✂ +' + pay) + '</button>' +
          '<button data-scan="' + i + '" style="' + BTN + '"' +
          (w.cut || w.revealed || b.scansLeft <= 0 || b.cutting ? ' disabled' : '') + '>🔍</button>' +
          '</div>';
      }).join('');
      panel.innerHTML =
        '<div style="width:100%;display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:12px">' +
          '<span style="color:#8a8478">의뢰 조건 <b style="color:#c9c1b4">' + b.cond.n + '</b>' +
          ' · 판독 <b style="color:#c9c1b4">' + b.scansLeft + '</b>회 남음' +
          ' · 다음 컷 함정확률 <b style="color:' + (risk >= .5 ? '#ff8d7a' : '#c9c1b4') + '">' + Math.round(risk * 100) + '%</b></span>' +
          '<button data-cash="1" style="' + BIG + '"' + (b.pot <= 0 || b.cutting ? ' disabled' : '') + '>💰 지금 끊기 +' +
            Math.round(b.pot * st.chain).toLocaleString() + '</button>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' + rows + '</div>';
      renderHUD();
    }
    function onPanelClick(e) {
      var t = e.target.closest('[data-cut],[data-scan],[data-cash],[data-rep]');
      if (!t || t.disabled || !stage.live) return;
      if (t.dataset.rep != null) { repair(t.dataset.rep); return; }
      if (st.downT > 0 || !st.bomb) return;
      if (t.dataset.cash != null) cashOut();
      else if (t.dataset.cut != null) cutWire(+t.dataset.cut);
      else scanWire(+t.dataset.scan);
    }
    panel.addEventListener('click', onPanelClick);

    // ---------- 포트 적립액 ----------
    // 위험할수록 크다. 판독된 선은 60% 깎인다 — 확정 정보는 배당을 죽인다는 명제의 수치판.
    function cutValue(b, w) {
      var risk = riskOf(b);
      var v = CUT_BASE * (0.55 + RISK_GAIN * risk);
      if (w.revealed) v *= SCAN_PAY_MULT;
      return Math.round(v);
    }

    // ---------- 판독 (즉시 · 폭탄당 2회) ----------
    function scanWire(i) {
      var b = st.bomb, w = b && b.wires[i];
      if (!w || w.cut || w.revealed || b.scansLeft <= 0 || b.cutting) return;
      st.idleT = 0;
      b.scansLeft--; b.scansUsed++;
      sfxScan();
      w.revealed = true;
      if (w.trap) sfxTrap(); else sfxSafe();
      stage.emit('scan_reveal', { result: w.trap ? '함정' : '안전' });
      buildPanel();
    }

    // ---------- 감컷 ----------
    // 니퍼가 물리는 0.6초가 이 게임의 '숨 참는 순간'이다. 결과는 그 뒤에 나온다.
    function cutWire(i) {
      var b = st.bomb, w = b && b.wires[i];
      if (!w || w.cut || b.cutting) return;
      st.idleT = 0;
      b.cutting = { i: i, t: CUT_TIME, risk: riskOf(b), pay: cutValue(b, w) };
      buildPanel();
    }
    function resolveCut(i, risk, pay) {
      var b = st.bomb, w = b && b.wires[i];
      if (!w) return;
      b.cutting = null;
      w.cut = true;
      if (w.trap) { boom(true); return; }
      b.pot += pay; b.cuts++; st.totalCuts++;
      if (risk >= .5) { b.hotCuts++; st.hotCuts++; }
      sfxSnip();
      spawnSparks(480, wireY(i), 8, w.color.c);
      floater(480, wireY(i) - 18, '+' + pay, '#ffd27a');
      // 위험한 컷을 살린 순간은 그 자체로 사건이다 (어휘 없으면 조용히 무시됨 — contract 4.2)
      if (risk >= .5) stage.emit('hot_cut', { risk: Math.round(risk * 100), pot: b.pot.toLocaleString() });
      else stage.emit('cut_paid', { gain: pay.toLocaleString() });
      checkCleared();
    }

    // ---------- 끊기 (선택의 심장) ----------
    function cashOut() {
      var b = st.bomb;
      if (!b || b.pot <= 0 || b.cutting) return;
      st.idleT = 0;
      var mult = b.cond.ok(b, false) ? b.cond.m : 1;
      var actual = stage.gain(Math.round(b.pot * st.chain * mult), '끊었다!', 'cash_out');
      st.maxPay = Math.max(st.maxPay, actual);
      st.cashed++;
      sfxCash();
      if (mult > 1) stage.emit('condition_met', { cond: b.cond.n, gain: actual.toLocaleString() });
      stage.emit('cash_out', { gain: actual.toLocaleString(), cuts: String(b.cuts) });
      // 끊기는 연쇄를 '지키기만' 한다 — 올리지는 않는다.
      // 폭발만이 연쇄를 끊으므로 "지금 끊기"는 연쇄를 보존하는 수단이고,
      // 연쇄를 키우려면 언젠가는 완주를 노려야 한다. 이 비대칭이 선택을 만든다
      stage.ticker('의뢰 #' + st.round + ' 중단 송출 — 포트 확정', false);
      st.bomb = null;
      renderHUD();
      after(NEXT_GAP, newBomb);
    }

    // ---------- 완주 ----------
    function checkCleared() {
      var b = st.bomb;
      if (!b.wires.every(function (w) { return w.trap || w.cut; })) { buildPanel(); return; }
      st.cleared++;
      var bonus = CLEAR_BASE + CLEAR_PER_ROUND * (st.round - 1);
      var mult = b.cond.ok(b, true) ? b.cond.m : 1;
      var actual = stage.gain(Math.round((b.pot + bonus) * st.chain * mult), '완주 해체!', 'defused');
      st.maxPay = Math.max(st.maxPay, actual);
      sfxClear();
      if (mult > 1) { stage.stamp(b.cond.n); stage.flash(.3); stage.emit('condition_met', { cond: b.cond.n, gain: actual.toLocaleString() }); }
      stage.emit('defused', { gain: actual.toLocaleString() });
      // 완주가 연쇄를 가장 크게 올린다 — 끊기가 항상 정답이 되지 않게 하는 장치
      if (st.chain < CHAIN_MAX) {
        st.chain = Math.min(CHAIN_MAX, st.chain + CHAIN_CLEAR);
        st.maxChain = Math.max(st.maxChain, st.chain);
        stage.setChain(st.chain);
        stage.emit('chain_up', { x: st.chain.toFixed(1) });
      }
      st.bomb = null;
      renderHUD();
      after(NEXT_GAP, newBomb);
    }

    // ---------- 폭발 ----------
    // 구경값 = 포트 × 0.7. 첫 컷에 터뜨리면 포트가 0이라 수익도 0 —
    // v1의 "일부러 터뜨리고 10초 기다리기" 파밍이 여기서 구조적으로 닫힌다.
    function boom(paid) {
      var b = st.bomb;
      st.booms++;
      // 연쇄를 깎는 것은 폭발뿐이다. 리셋이 아니라 반토막 — 도박 게임에서 폭발은 흔하고,
      // 매번 0으로 돌리면 연쇄가 영영 쌓이지 않아 뼈대가 죽는다 (v2 스윕에서 ×1.09로 실측)
      st.chain = Math.max(1, st.chain * 0.5); stage.setChain(st.chain);
      sfxBoom();
      stage.shake(14); stage.flash(paid ? .5 : .3);
      spawnSparks(480, 230, 40, '#ffb447');
      if (imgReady('vfx-boom')) st.vfx.push({ x: 480, y: 235, s: paid ? 2.4 : 1.8, born: stage.now });
      var pot = b ? b.pot : 0;
      if (paid && pot > 0) {
        var g = Math.round(pot * BOOM_POT_MULT * BOOM_DECAY[Math.min(BOOM_DECAY.length - 1, st.booms - 1)]);
        var actual = stage.gain(g, '폭발!! 포트 날아감', 'boom');
        stage.stamp('폭발');
        stage.emit('boom', { gain: actual.toLocaleString() });
      } else {
        stage.ticker(paid ? '첫 컷에 폭발 — 쌓은 게 없으면 볼거리도 없다' : '시간 초과 — 폭탄이 그냥 터졌다', true);
        stage.emit('timeout_boom');
      }
      st.bomb = null;
      st.downT = DOWN_TIME; st.downChoice = false;
      renderHUD();
      buildPanel();
    }

    // ---------- 파손 복구 (대기 중의 선택) ----------
    function repair(kind) {
      if (st.downT <= 0 || st.downChoice) return;
      st.downChoice = true;
      if (kind === 'fast') { st.downT = Math.min(st.downT, DOWN_FAST); stage.emit('repair_fast'); }
      else { st.scanBonus = 1; stage.emit('repair_solid'); }
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
    stage.ticker('방송 시작! 한 가닥 더 자를까, 지금 끊을까 — 그것만 고르면 된다', false);

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

        if (st.downT > 0) {
          st.downT -= dt;
          stage.lose(Math.max(1, stage.viewers * 0.006) * dt);
          var d = document.getElementById('bbDown');
          if (d) d.textContent = Math.max(0, st.downT).toFixed(1);
          if (st.downT <= 0) { st.downT = 0; newBomb(); }
        }

        if (st.bomb) {
          st.bomb.t -= dt;
          // 절단 판정은 폭탄을 없앨 수 있다(함정=폭발). 판정 뒤에는 반드시 재확인한다
          if (st.bomb.cutting) {
            st.bomb.cutting.t -= dt;
            if (st.bomb.cutting.t <= 0) {
              var c = st.bomb.cutting;
              resolveCut(c.i, c.risk, c.pay);
            }
          }
          if (st.bomb) {
            if (st.bomb.t <= 5) {
              st.tickT += dt;
              if (st.tickT >= 1) { st.tickT = 0; sfxTick(); }
            }
            if (st.bomb.t <= 0) { boom(false); }
            else if (!st.bomb.cutting) {
              // 방치 — 조용한 이탈 + 잔소리 (규약 2). 절단 중은 방치가 아니다
              st.idleT += dt;
              if (st.idleT > 3) stage.lose(Math.max(1, stage.viewers * 0.008) * dt);
              if (st.idleT > 5 && !st.nagged) { st.nagged = true; stage.emit('nag'); }
            }
          }
        }

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
        if (st.downT > 0) {
          if (e.key === 'f' || e.key === 'F') repair('fast');
          if (e.key === 'g' || e.key === 'G') repair('solid');
          return;
        }
        if (!st.bomb) return;
        if (e.key === ' ' || e.key === 'Enter') { cashOut(); return; }   // 끊기 = 스페이스
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= 6) cutWire(n - 1);
      },

      pointer: function (p, type) {
        if (type !== 'down' || !st.bomb || st.downT > 0) return;
        for (var i = 0; i < st.bomb.wires.length; i++) {
          if (p.x > 280 && p.x < 680 && Math.abs(p.y - wireY(i)) < 16 && !st.bomb.wires[i].cut) {
            cutWire(i); return;
          }
        }
      },

      debug: (typeof location !== 'undefined' && /guoidebug/.test(location.search))
        ? function () { return st; } : null,

      summary: function () {
        return [
          ['완주 / 끊기 / 폭발', st.cleared + ' / ' + st.cashed + ' / ' + st.booms],
          ['최고 연쇄 / 고위험 컷', '×' + st.maxChain.toFixed(1) + ' / ' + st.hotCuts],
          ['최대 단일 배당', st.maxPay.toLocaleString() + '명'],
        ];
      },

      dispose: function () { panel.removeEventListener('click', onPanelClick); },

      draw: function (ctx) {
        var t = stage.now;
        drawBench(ctx, t);
        if (st.bomb) drawBomb(ctx, t);
        else if (st.downT > 0) drawWreck(ctx, t);
        st.sparks.forEach(function (s) {
          ctx.globalAlpha = 1 - s.t / .6;
          ctx.fillStyle = s.c;
          ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
        });
        ctx.globalAlpha = 1;
        st.vfx = st.vfx.filter(function (f) {
          var p = (t - f.born) / VFX_DUR;
          if (p >= 1) return false;
          if (p < 0) return true;
          var im = IMG['vfx-boom'];
          var n = VFX_GRID * VFX_GRID, idx = Math.min(n - 1, (p * n) | 0);
          var fw = im.naturalWidth / VFX_GRID, fh = im.naturalHeight / VFX_GRID;
          var size = 170 * f.s;
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
      if (imgReady('bench-bg')) {
        ctx.drawImage(IMG['bench-bg'], 0, 0, 960, 430);
      } else {
        var g = ctx.createLinearGradient(0, 0, 0, 430);
        g.addColorStop(0, '#12141c'); g.addColorStop(.6, '#181a24'); g.addColorStop(1, '#0c0d12');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 430);
        ctx.fillStyle = '#2a2620'; ctx.fillRect(120, 386, 720, 44);
        ctx.fillStyle = '#3a352c'; ctx.fillRect(120, 380, 720, 8);
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var cone = ctx.createRadialGradient(480, 20, 20, 480, 260, 340);
      cone.addColorStop(0, 'rgba(255,235,190,.1)'); cone.addColorStop(1, 'rgba(255,235,190,0)');
      ctx.fillStyle = cone; ctx.fillRect(140, 10, 680, 420);
      ctx.restore();
    }

    function drawBomb(ctx, t) {
      var b = st.bomb;
      var warn = b.t < 5;
      ctx.fillStyle = '#0a0a0e'; ctx.fillRect(400, 56, 160, 36);
      ctx.strokeStyle = '#3a3344'; ctx.lineWidth = 2; ctx.strokeRect(400, 56, 160, 36);
      ctx.fillStyle = warn && Math.floor(t * 4) % 2 ? '#ff8d7a' : '#ff4a3d';
      ctx.font = 'bold 28px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.fillText(Math.max(0, b.t).toFixed(1), 480, 84);

      // 포트 — 화면의 주인공. "지금 끊으면 이만큼"이 눈에 박혀야 매 컷이 선택이 된다
      var potTxt = Math.round(b.pot * st.chain).toLocaleString();
      ctx.font = 'bold 34px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = b.pot > 0 ? '#ffd27a' : '#4a4550';
      ctx.fillText(potTxt, 190, 200);
      ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#8a8478';
      ctx.fillText('지금 끊으면', 190, 172);
      ctx.fillText('연쇄 ×' + st.chain.toFixed(1) + ' 적용', 190, 222);

      // 위험도 게이지 — 다음 컷이 얼마나 위험한지
      var risk = riskOf(b);
      ctx.fillStyle = '#8a8478'; ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('다음 컷 함정확률', 770, 172);
      ctx.fillStyle = '#241c30'; ctx.fillRect(710, 184, 120, 12);
      ctx.fillStyle = risk >= .5 ? '#ff5a4a' : '#6fd98f';
      ctx.fillRect(710, 184, 120 * risk, 12);
      ctx.fillStyle = '#ece7dd'; ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText(Math.round(risk * 100) + '%', 770, 220);

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
        [[276, 116], [684, 116], [276, 362], [684, 362]].forEach(function (p) {
          ctx.fillStyle = '#151820';
          ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, TAU); ctx.fill();
        });
      }
      b.wires.forEach(function (w, i) {
        var y = wireY(i);
        ctx.lineWidth = 5; ctx.strokeStyle = w.color.c;
        ctx.lineCap = 'round';
        if (w.cut) {
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
          if (w.revealed) {
            ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'left';
            ctx.fillStyle = w.trap ? '#ff5a4a' : '#6fd98f';
            ctx.fillText(w.trap ? '✕ 함정' : '✓ 안전', 672, y + 4);
          }
        }
        ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'right';
        ctx.fillStyle = '#8a8478'; ctx.fillText(String(i + 1), 292, y + 4);
      });
      ctx.textAlign = 'center';
    }

    function drawWreck(ctx, t) {
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
      ctx.fillText('복구 방식을 고르세요 — ' + Math.max(0, st.downT).toFixed(1) + '초', 480, 180);
    }
  }

  Shell.register({
    id: 'bomb',
    title: '해체쇼',
    tagline: '한 가닥 더 자를까, 지금 끊을까. 자를수록 함정 확률이 오르고 배당도 오른다 — 멈출 곳을 고르는 것이 실력이다.',
    duration: SHOW_TIME,
    startViewers: START_VIEWERS,
    usesChain: true,
    chat: window.BOMB_CHAT,
    preload: loadArt,
    tuning: {
      SCANS_BASE: SCANS_BASE, SCAN_PAY_MULT: SCAN_PAY_MULT,
      CUT_BASE: CUT_BASE, RISK_GAIN: RISK_GAIN,
      CLEAR_BASE: CLEAR_BASE, CLEAR_PER_ROUND: CLEAR_PER_ROUND,
      BOOM_POT_MULT: BOOM_POT_MULT, CUT_TIME: CUT_TIME, DOWN_TIME: DOWN_TIME,
      DOWN_FAST: DOWN_FAST, NEXT_GAP: NEXT_GAP, CHAIN_MAX: CHAIN_MAX,
      CHAIN_CLEAR: CHAIN_CLEAR,
    },
    foot: '<kbd>1</kbd>~<kbd>6</kbd> 또는 와이어 클릭 = <b>감컷</b>(포트 적립·함정확률이 높을수록 큼) · <kbd>Space</kbd> = <b>지금 끊기</b>(포트 확정, 연쇄는 안 오름) · 🔍 = 즉시 판독(폭탄당 2~3회, 그 선의 배당 −60%)<br>' +
          '안전선을 전부 자르면 <b>완주</b> — 완주 보너스 + 연쇄 ×0.5 상승(최대 ×4) · 함정 컷 = 폭발(포트 소멸, 구경값 = 포트×0.7) · 절단은 0.6초 걸린다 — 그 사이엔 되돌릴 수 없다 · 파손 3초 중에도 <kbd>F</kbd>/<kbd>G</kbd>로 복구 방식 선택',
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
      c.fillStyle = '#ffd27a'; c.font = 'bold 11px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('+1,240', w * .5, h * .21);
    },
    start: start,
  });
})();
