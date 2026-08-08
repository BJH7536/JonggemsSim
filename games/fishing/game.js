/* 심연낚시 — 측면 수중 단면 뷰 낚시 방송. 위에 배, 아래로 수심 3구간.
 *
 * 네 번째 게임의 역할은 "기다림 장르" 증명이다. 화력쇼(초 단위 반사)·pocket(훈수)과 달리
 * 낚시는 리스크가 기다림 그 자체다 — 심해는 입질까지 7~12초, 그동안 시청자가 샌다.
 * 대신 걸리는 게 대형·전설이고, 못 버티면 줄과 함께 방송이 터진다(그것도 콘텐츠).
 *
 * 공통 명제 유지 — **안전한 캐스팅이 최악의 전략이다.**
 *   얕은물 잡어 +15~30  ≪  중층 중형 +200  ≪  심해 대형 +650  ≪  전설 +1,800
 *   줄 끊김(대형·전설)도 구경값 +400~900 — 다만 수리 8초 동안 조용히 샌다.
 *
 * 릴 감기: 누르면 텐션↑+끌어옴, 떼면 텐션↓. 텐션 90%+ 구간이 제일 빨리 끌려온다
 * (리스크=효율). 100% 초과 = 줄 끊김, 슬랙 방치 = 도망.
 * ⚠ 밸런스는 데모용 1차 조율값 — 스윕 검증 전이다.
 */
(function () {
  'use strict';

  var U = Shell.util, clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  var sfx = Shell.sfx;

  var SHOW_TIME = 180;
  var START_VIEWERS = 300;
  var SURFACE = 70;          // 수면 y
  var LURE_X = 540;          // 루어 기본 x

  // ---------- 데이터 ----------
  // 수심 3구간 — 깊을수록 입질이 늦고(리스크=기다림), 대기 누수가 크고, 어종이 크다
  var ZONES = [
    { n: '얕은물', top: 100, bot: 185, bite: [2, 4],  drain: 0.002, tiers: [.55, .35, .10, 0,   0  ] },
    { n: '중층',   top: 195, bot: 300, bite: [4, 7],  drain: 0.004, tiers: [.20, .35, .35, .09, .01] },
    { n: '심해',   top: 310, bot: 420, bite: [7, 12], drain: 0.007, tiers: [.05, .10, .30, .45, .10] },
  ];
  // 어종 티어 — reel: 초당 끌어올림, surgeP: 저항 시 텐션 상승/초, pull: 저항 시 되끌림/초
  var TIERS = [
    { n: '잡어', names: ['잿빛피라미', '흙탕주둥이', '거품송사리'], gain: [15, 30],     reel: 80, surgeP: 0,   surgeIv: 99,  pull: 0,  r: 9,  c: '#8a8478' },
    { n: '소형', names: ['은비늘잉어', '달빛정어리', '유리멸치'],   gain: [60, 60],     reel: 52, surgeP: 35,  surgeIv: 2.2, pull: 8,  r: 13, c: '#9ec8e0' },
    { n: '중형', names: ['먹구름메기', '청동가물치', '칼지느러미'], gain: [200, 200],   reel: 36, surgeP: 55,  surgeIv: 1.7, pull: 14, r: 19, c: '#6fa0c0' },
    { n: '대형', names: ['심해왕눈이', '가시등롱어', '강철아가미'], gain: [650, 650],   reel: 25, surgeP: 85,  surgeIv: 1.3, pull: 22, r: 28, c: '#c08a4a' },
    { n: '전설', names: ['나락의군주', '심연의어미'],               gain: [1800, 1800], reel: 17, surgeP: 110, surgeIv: 1.0, pull: 30, r: 40, c: '#ff6a3d' },
  ];
  var SNAP_AT = 100, EDGE_AT = 90;   // 줄 끊김 / 클러치 임계 (텐션 %)
  var SNAP_GAIN = [400, 900];        // 대형·전설 줄 끊김 구경값
  var REPAIR_TIME = 8;               // 줄 끊김 후 낚싯대 수리(초)
  var MILES = [1000, 5000, 15000, 60000, 150000];

  // ---------- SFX (합성음 — 외부 에셋 0) ----------
  var sfxCast = function () { if (!sfx.gate('fs_c')) return; sfx.noise(.18, .06, 700); sfx.tone(320, .12, 'sine', .05); };
  var sfxNib  = function () { if (!sfx.gate('fs_n')) return; sfx.tone(660, .05, 'sine', .04); };
  var sfxBite = function () { if (!sfx.gate('fs_b')) return; sfx.tone(880, .08, 'square', .08); sfx.tone(880, .08, 'square', .08, .12); };
  var sfxHook = function () { if (!sfx.gate('fs_h')) return; sfx.tone(523, .08, 'triangle', .1); sfx.tone(784, .12, 'triangle', .1, .07); };
  var sfxSnap = function () { if (!sfx.gate('fs_s')) return; sfx.noise(.3, .2, 300); sfx.tone(70, .3, 'sine', .15); };
  var sfxLand = function () { if (!sfx.gate('fs_l')) return; sfx.tone(523, .1, 'triangle', .1); sfx.tone(659, .1, 'triangle', .1, .08); sfx.tone(1047, .2, 'triangle', .1, .16); };
  var sfxEsc  = function () { if (!sfx.gate('fs_e')) return; sfx.tone(300, .12, 'sine', .05); sfx.tone(200, .18, 'sine', .05, .1); };

  // ---------- AetherAI 생성 아트 (tools/aether-assets.json) ----------
  // 바다 배경 플레이트·배·어종 5티어·물보라 VFX 시트. 없거나 로드 전이면 기존 벡터로 폴백.
  // 물결·수심 라벨·낚싯대·낚싯줄·기포는 살아있는 연출이라 계속 절차적으로 그린다.
  // 파싱 시점이 아니라 방송 준비(카운트다운) 때 내려받는다 — 첫 화면 payload 절약. 재호출 no-op.
  var IMG = {};
  function loadArt() {
    if (IMG['sea-bg']) return;
    [['sea-bg', 'jpg'], ['boat', 'png'],
     ['fish-0', 'png'], ['fish-1', 'png'], ['fish-2', 'png'], ['fish-3', 'png'], ['fish-4', 'png'],
     ['vfx-splash', 'jpg'],
    ].forEach(function (e) {
      var im = new Image();
      im.src = 'games/fishing/img/' + e[0] + '.' + e[1];
      IMG[e[0]] = im;
    });
  }
  function imgReady(n) { var im = IMG[n]; return im && im.complete && im.naturalWidth > 0; }
  var VFX_DUR = 0.6, VFX_GRID = 4;

  function start(stage) {
    loadArt(); // 셸이 preload를 안 불렀어도 (구버전 셸) 여기서라도 건다
    var st = {
      phase: 'pick',           // pick | cast | wait | reel | repair
      zone: -1,                // 선택된 수심 구간
      lureY: SURFACE, targetY: 0,
      waitT: 0, biteAt: 0,     // 대기 경과 / 진입질 예정 시각
      biteT: 0,                // 챔질 창 잔여(>0이면 진입질 중)
      nibAt: 0, nibT: 0,       // 다음 잔입질 시각 / 잔입질 잔여
      fish: null,              // { tier, name, prog }
      hold: false, tension: 0, slackT: 0, edgeT: 0, edgeDone: false,
      surgeT: 0, surging: 0,   // 다음 저항까지 / 저항 잔여
      repairT: 0, idleT: 0, nagT: 8,
      lands: 0, snaps: 0, escapes: 0, casts: 0, maxT: 0,
      best: -1, bestName: '—',
      donT: 9 + Math.random() * 7, chatT: 3, mileIdx: 0,
      bubbles: [], vfx: [],
      // 배경 물고기 실루엣 — 연출 전용 (C3)
      amb: [],
    };
    for (var i = 0; i < 11; i++) st.amb.push({
      x: Math.random() * 960, y: 110 + Math.random() * 300,
      v: (Math.random() < .5 ? -1 : 1) * (12 + Math.random() * 22), s: 5 + Math.random() * 9,
    });
    var panel = stage.panel;

    function zone() { return ZONES[st.zone]; }
    function biteRoll() { var b = zone().bite; return b[0] + Math.random() * (b[1] - b[0]); }
    // 랜딩·줄끊김 물보라 — 수면에서 터진다 (연출 전용, 시트 없으면 조용히 생략)
    function spawnSplash(scale) {
      if (imgReady('vfx-splash')) st.vfx.push({ x: LURE_X, y: SURFACE + 6, s: scale || 1, born: stage.now });
    }

    // ---------- HUD·패널 ----------
    stage.hud('⏱ 방송 <b id="fsTime">3:00</b> · 랜딩 <b id="fsLand">0</b> · 줄끊김 <b id="fsSnap">0</b> · 최고텐션 <b id="fsMaxT">0%</b>');
    function renderHUD() {
      var e;
      if ((e = document.getElementById('fsLand'))) e.textContent = st.lands;
      if ((e = document.getElementById('fsSnap'))) e.textContent = st.snaps;
      if ((e = document.getElementById('fsMaxT'))) e.textContent = Math.round(st.maxT) + '%';
    }
    // 게임 전용 CSS를 shell.css에 얹지 않으려고 인라인 스타일 — 두 파일로 완결
    var BTN = 'flex:1;padding:9px 10px;border-radius:8px;cursor:pointer;text-align:left;' +
              'background:#0f1620;border:1px solid #2a3a4c;color:#cfe2ee;font:inherit;';
    var BTN_ON = 'background:#1a2836;border:1px solid #ffb447;';
    function buildPanel() {
      if (st.phase === 'pick') {
        panel.innerHTML = '<div style="display:flex;gap:8px;align-items:stretch">' +
          ZONES.map(function (z, i) {
            return '<button data-z="' + i + '" style="' + BTN + (st.zone === i ? BTN_ON : '') + '">' +
              '<b style="color:#ffd27a">' + (i + 1) + '. ' + z.n + '</b><br>' +
              '<span style="font-size:10.5px;color:#8a9aa8">입질 ' + z.bite[0] + '~' + z.bite[1] + '초 · ' +
              (i === 0 ? '잡어·소형 위주' : i === 1 ? '중형 중심' : '대형·전설 서식') + '</span></button>';
          }).join('') +
          '<button data-cast="1" ' + (st.zone < 0 ? 'disabled' : '') + ' style="' + BTN +
            'flex:0 0 130px;text-align:center;' + (st.zone >= 0 ? 'border-color:#6fd98f;' : 'opacity:.4;') + '">' +
            '<b style="color:#6fd98f">캐스팅</b><br><span style="font-size:10.5px;color:#8a9aa8">화면 클릭도 됨</span></button></div>';
      } else if (st.phase === 'cast' || st.phase === 'wait') {
        panel.innerHTML = '<div style="padding:10px 4px;color:#8a9aa8;font-size:12.5px">' +
          zone().n + '에서 입질 대기 중 — <b style="color:#ffd27a">"!!" 순간에 화면 클릭 = 챔질</b> · 잔입질에 속으면 도망간다</div>';
      } else if (st.phase === 'reel') {
        panel.innerHTML = '<div style="padding:10px 4px;color:#8a9aa8;font-size:12.5px">' +
          '<b style="color:#ff8d5a">화면을 누르고 있으면 당긴다</b> — 텐션 100%를 넘기면 줄이 끊긴다 · 90%대에서 버티면 제일 빨리 올라온다</div>';
      } else if (st.phase === 'repair') {
        panel.innerHTML = '<div style="padding:10px 4px;color:#9a9184;font-size:12.5px">🔧 낚싯대 수리 중 — ' +
          '<b><span id="fsRep">' + st.repairT.toFixed(1) + '</span>초</b> · 수리하는 동안 시청자가 조용히 빠져나간다</div>';
      }
      renderHUD();
    }
    function onPanelClick(e) {
      var t = e.target.closest('[data-z],[data-cast]');
      if (!t || !stage.live || st.phase !== 'pick') return;
      if (t.dataset.z != null) { st.zone = +t.dataset.z; st.idleT = 0; buildPanel(); }
      else if (st.zone >= 0) cast();
    }
    panel.addEventListener('click', onPanelClick);

    // ---------- 캐스팅 → 대기 ----------
    function cast() {
      st.phase = 'cast'; st.casts++; st.idleT = 0; st.nagT = 8;
      var z = zone();
      st.targetY = z.top + Math.random() * (z.bot - z.top);
      sfxCast();
      stage.emit('cast', { zone: z.n });
      stage.ticker(z.n + ' 캐스팅 — 입질 ' + z.bite[0] + '~' + z.bite[1] + '초', false);
      buildPanel();
    }
    function beginWait() {
      st.phase = 'wait'; st.waitT = 0; st.biteT = 0; st.nibT = 0;
      st.biteAt = biteRoll();
      st.nibAt = 1 + Math.random() * 1.8;
    }

    // ---------- 챔질 ----------
    function strike() {
      if (st.biteT > 0) { hookFish(); return; }
      // 잔입질(또는 허공)에 챔질 — 물고기 도망, 다시 던져야 한다
      stage.lose(15);
      sfxEsc();
      stage.emit('strike_miss');
      stage.ticker('헛챔질… 물고기가 도망갔다', true);
      st.phase = 'pick'; st.lureY = SURFACE;
      buildPanel();
    }
    function hookFish() {
      var roll = Math.random(), acc = 0, tier = 0, tp = zone().tiers;
      for (var i = 0; i < tp.length; i++) { acc += tp[i]; if (roll < acc) { tier = i; break; } }
      var T = TIERS[tier];
      st.fish = { tier: tier, name: T.names[rnd(0, T.names.length - 1)], prog: 0 };
      st.phase = 'reel'; st.biteT = 0;
      st.tension = 35; st.slackT = 0; st.edgeT = 0; st.edgeDone = false;
      st.surging = 0; st.surgeT = .8 + Math.random();
      st.hold = true; // 챔질 클릭이 그대로 홀드로 이어진다
      sfxHook(); stage.shake(4);
      stage.emit('hook');
      buildPanel();
    }

    // ---------- 파이트 종결 ----------
    function landFish() {
      var f = st.fish, T = TIERS[f.tier];
      st.lands++;
      if (f.tier > st.best) { st.best = f.tier; st.bestName = f.name; }
      var g = rnd(T.gain[0], T.gain[1]);
      sfxLand();
      spawnSplash(f.tier >= 3 ? 1.7 : f.tier >= 2 ? 1.2 : .8);
      if (f.tier === 0) {
        stage.gain(g, null, 'trash'); // 잡어 — 조용한 소액, 채팅이 놀린다
        stage.emit('trash', { name: f.name });
        stage.ticker(f.name + ' 랜딩… 잡어다', false);
      } else {
        var label = f.tier === 4 ? '전설 랜딩!!!' : f.tier === 3 ? '대형 랜딩!!' : T.n + ' 랜딩!';
        var actual = stage.gain(g, label, 'land_' + ['small', 'small', 'mid', 'big', 'legend'][f.tier]);
        if (f.tier >= 3) { stage.shake(f.tier === 4 ? 10 : 6); stage.flash(f.tier === 4 ? .4 : .2); }
        if (f.tier === 4) stage.stamp('전설 어종');
        stage.emit(['land_small', 'land_small', 'land_mid', 'land_big', 'land_legend'][f.tier],
          { name: f.name, gain: actual.toLocaleString() });
      }
      st.fish = null; st.phase = 'pick'; st.lureY = SURFACE;
      buildPanel();
    }
    function snapLine() {
      var big = st.fish.tier >= 3;
      st.snaps++;
      sfxSnap(); stage.shake(9); stage.flash(.3);
      spawnSplash(big ? 1.5 : 1);
      // 대참사 콘텐츠 — 대형·전설 줄 끊김은 구경값이 크다. 대신 수리 8초 동안 샌다
      var g = big ? rnd(SNAP_GAIN[0], SNAP_GAIN[1]) : rnd(40, 80);
      var actual = stage.gain(g, big ? '줄 끊김 대참사!!' : null, 'line_snap');
      stage.emit('line_snap', { gain: actual.toLocaleString() });
      st.fish = null; st.phase = 'repair'; st.repairT = REPAIR_TIME; st.lureY = SURFACE;
      buildPanel();
    }
    function escapeFish() {
      st.escapes++;
      sfxEsc();
      stage.lose(25);
      stage.emit('escape');
      stage.ticker('슬랙… 바늘이 빠졌다', true);
      st.fish = null; st.phase = 'pick'; st.lureY = SURFACE;
      buildPanel();
    }

    function ambient() {
      if (st.mileIdx < MILES.length && stage.viewers >= MILES[st.mileIdx]) {
        stage.emit('milestone', { v: MILES[st.mileIdx++].toLocaleString() });
        return;
      }
      stage.emit('idle');
    }

    buildPanel();
    stage.ticker('방송 시작! 수심을 골라 던져라 — 깊을수록 크다', false);

    // ---------- 인스턴스 ----------
    return {
      st: st,

      step: function (dt) {
        var e = document.getElementById('fsTime');
        if (e) e.textContent = U.fmtTime(stage.timeLeft);

        if (st.phase === 'pick') {
          st.idleT += dt;
          if (st.idleT > 5) stage.lose(Math.max(.5, stage.viewers * 0.004) * dt); // 캐스팅 안 함 — 조용히
          st.nagT -= dt;
          if (st.nagT <= 0) { st.nagT = 9; if (st.idleT > 5) stage.emit('nag'); }
        }

        if (st.phase === 'cast') {
          st.lureY += 190 * dt; // 루어 하강 연출
          if (st.lureY >= st.targetY) { st.lureY = st.targetY; beginWait(); }
        }

        if (st.phase === 'wait') {
          st.waitT += dt;
          // 기다림 관리 — 깊을수록 크게 샌다 (리스크=기다림 그 자체)
          stage.lose(Math.max(.5, stage.viewers * zone().drain) * dt);
          if (st.nibT > 0) st.nibT -= dt;
          if (st.biteT > 0) {
            st.biteT -= dt;
            if (st.biteT <= 0) { // 진입질 창을 놓쳤다 — 조용히, 재입질 대기
              stage.ticker('입질이 지나갔다…', true);
              st.biteAt = st.waitT + biteRoll() * .6;
            }
          } else if (st.waitT >= st.biteAt) {
            st.biteT = .5 + Math.random() * .4; // 챔질 창 0.5~0.9초
            sfxBite(); stage.flash(.15);
            stage.emit('bite');
          } else if (st.waitT >= st.nibAt) {
            st.nibT = .6; // 잔입질 — 페이크. 긴장 유지 담당
            st.nibAt = st.waitT + 1.5 + Math.random() * 2.2;
            sfxNib();
            if (Math.random() < .5) stage.emit('nibble');
          }
        }

        if (st.phase === 'reel' && st.fish) {
          var f = TIERS[st.fish.tier];
          // 물고기 저항 — 무작위 텐션 급등 + 되끌림
          if (st.surging > 0) st.surging -= dt;
          else { st.surgeT -= dt; if (st.surgeT <= 0) { st.surging = .35 + Math.random() * .35; st.surgeT = f.surgeIv * (.7 + Math.random() * .6); } }
          var rate = (st.hold ? 60 : -80) + (st.surging > 0 ? f.surgeP : 0);
          st.tension = clamp(st.tension + rate * dt, 0, 130);
          if (st.tension > SNAP_AT) { snapLine(); return; }
          st.maxT = Math.max(st.maxT, st.tension); // 끊기기 전까지의 값만 남는다 = 생존 최고 텐션
          if (st.tension >= EDGE_AT) {
            st.edgeT += dt;
            if (!st.edgeDone && st.edgeT > .5) {
              st.edgeDone = true;
              stage.gain(120, '클러치!', 'tension_edge');
              stage.emit('tension_edge', { t: Math.round(st.tension) });
            }
          } else st.edgeT = 0;
          // 끌어올림 — 90%대 위험 구간이 제일 빠르다 (리스크=효율)
          if (st.hold && st.tension > 20)
            st.fish.prog += f.reel * dt * (st.tension >= EDGE_AT ? 1.35 : 1);
          if (st.surging > 0) st.fish.prog -= f.pull * dt;
          // 슬랙 방치 = 도망
          if (st.tension < 12) { st.slackT += dt; if (st.slackT > 2.2) { escapeFish(); return; } }
          else st.slackT = 0;
          if (st.fish.prog < -25) { escapeFish(); return; }
          if (st.fish.prog >= 100) { landFish(); return; }
          renderHUD();
        }

        if (st.phase === 'repair') {
          st.repairT -= dt;
          stage.lose(Math.max(1, stage.viewers * 0.006) * dt); // 수리 다운타임 — 조용히 샌다
          var r = document.getElementById('fsRep');
          if (r) r.textContent = Math.max(0, st.repairT).toFixed(1);
          if (st.repairT <= 0) {
            st.phase = 'pick'; st.idleT = 0;
            stage.ticker('수리 완료! 다시 던지자', false);
            buildPanel();
          }
        }

        // 배경 물고기·기포 (연출 전용)
        st.amb.forEach(function (a) {
          a.x += a.v * dt;
          if (a.x < -30) a.x = 990; if (a.x > 990) a.x = -30;
        });
        if (Math.random() < dt * 2 && st.lureY > SURFACE + 10)
          st.bubbles.push({ x: LURE_X + (Math.random() - .5) * 14, y: st.lureY, r: 1 + Math.random() * 2 });
        for (var i = st.bubbles.length - 1; i >= 0; i--) {
          st.bubbles[i].y -= 35 * dt;
          if (st.bubbles[i].y < SURFACE) st.bubbles.splice(i, 1);
        }

        st.donT -= dt;
        if (st.donT <= 0) {
          st.donT = 9 + Math.random() * 7;
          if (Math.random() < .45) {
            var d = Math.max(10, Math.round(stage.viewers * (0.01 + Math.random() * 0.02)));
            var a2 = stage.gain(d, '익명의 도네', 'donation');
            stage.emit('donation', { d: a2.toLocaleString() });
          }
        }
        st.chatT -= dt;
        if (st.chatT <= 0) {
          st.chatT = clamp(4 - Math.log10(stage.viewers + 10) * .55, 1.3, 4) + Math.random() * 1.5;
          ambient();
        }
      },

      pointer: function (p, type) {
        if (!stage.live) return;
        if (type === 'down') {
          if (st.phase === 'pick' && st.zone >= 0) cast();
          else if (st.phase === 'wait') strike();
          else if (st.phase === 'reel') st.hold = true;
        } else if (type === 'up') {
          st.hold = false;
        }
      },

      key: function (e) {
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= 3 && st.phase === 'pick') { st.zone = n - 1; st.idleT = 0; buildPanel(); }
      },

      // 튜닝 계측용 상태 노출 — ?guoidebug 를 붙였을 때만 (GUOI와 같은 규약)
      debug: (typeof location !== 'undefined' && /guoidebug/.test(location.search))
        ? function () { return st; } : null,

      summary: function () {
        return [
          ['최대 어종', st.bestName],
          ['랜딩 / 도망', st.lands + '마리 / ' + st.escapes + '회'],
          ['줄 끊김', st.snaps + '회'],
          ['최고 텐션 생존', Math.round(st.maxT) + '%'],
        ];
      },

      dispose: function () { panel.removeEventListener('click', onPanelClick); },

      draw: function (ctx) {
        var t = stage.now;
        // 배경 정물은 AetherAI 플레이트 — 별·물결·라벨·실루엣은 계속 위에 얹는다
        if (imgReady('sea-bg')) {
          // 생성물의 수면선은 상단 31.4% 지점(밝은 낮 판 실측 y=180/574)인데 게임 SURFACE는 70/430이다.
          // 위(하늘)/아래(물)를 나눠 그려 이미지 수면선이 정확히 SURFACE에 오게 맞춘다 —
          // 안 맞추면 수면선이 두 줄로 보인다 (물결은 SURFACE에 그려진다). 배경 재생성 시 재실측할 것.
          var sb = IMG['sea-bg'], sbw = sb.naturalWidth, sbh = sb.naturalHeight, sbl = sbh * .3136;
          ctx.drawImage(sb, 0, 0, sbw, sbl, 0, 0, 960, SURFACE);
          ctx.drawImage(sb, 0, sbl, sbw, sbh - sbl, 0, SURFACE, 960, 430 - SURFACE);
        } else {
          // 하늘·해·물 — 이미지 로드 전 폴백 (밝은 낮)
          var sky = ctx.createLinearGradient(0, 0, 0, SURFACE);
          sky.addColorStop(0, '#6db8ec'); sky.addColorStop(1, '#a8dcf5');
          ctx.fillStyle = sky; ctx.fillRect(0, 0, 960, SURFACE);
          ctx.fillStyle = '#ffd94a';
          ctx.beginPath(); ctx.arc(850, 28, 14, 0, TAU); ctx.fill();
          var w = ctx.createLinearGradient(0, SURFACE, 0, 430);
          w.addColorStop(0, '#4fc4e0'); w.addColorStop(.45, '#2a7fb8'); w.addColorStop(1, '#155a96');
          ctx.fillStyle = w; ctx.fillRect(0, SURFACE, 960, 430 - SURFACE);
        }
        for (var s = 0; s < 20; s++) {
          ctx.fillStyle = 'rgba(255,255,255,' + (.15 + .2 * Math.abs(Math.sin(t + s))) + ')';
          ctx.fillRect((s * 149 + 40) % 960, 6 + (s * 37) % 40, 2, 2);
        }
        // 수면 물결
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (var x = 0; x <= 960; x += 8) {
          var wy = SURFACE + Math.sin(x * .04 + t * 2) * 2.5;
          x === 0 ? ctx.moveTo(x, wy) : ctx.lineTo(x, wy);
        }
        ctx.stroke();
        // 수심 구간 경계·라벨
        ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
        ZONES.forEach(function (z, i) {
          ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.setLineDash([6, 8]);
          ctx.beginPath(); ctx.moveTo(0, z.top - 6); ctx.lineTo(960, z.top - 6); ctx.stroke();
          ctx.setLineDash([]);
          var on = st.zone === i;
          ctx.fillStyle = on ? '#ffe98a' : 'rgba(12,50,80,.5)';
          ctx.fillText(z.n + (on ? ' ◀' : ''), 12, z.top + 10);
        });
        // 배경 물고기 실루엣
        st.amb.forEach(function (a) {
          ctx.fillStyle = 'rgba(18,70,110,.45)';
          ctx.save(); ctx.translate(a.x, a.y + Math.sin(t * 1.5 + a.x) * 3);
          ctx.scale(a.v > 0 ? 1 : -1, 1);
          ctx.beginPath(); ctx.ellipse(0, 0, a.s, a.s * .4, 0, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-a.s, 0); ctx.lineTo(-a.s * 1.6, -a.s * .4); ctx.lineTo(-a.s * 1.6, a.s * .4); ctx.closePath(); ctx.fill();
          ctx.restore();
        });
        // 기포
        st.bubbles.forEach(function (b) {
          ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(b.x + Math.sin(b.y * .1) * 3, b.y, b.r, 0, TAU); ctx.stroke();
        });
        // 배
        var bob = Math.sin(t * 1.6) * 2.5;
        ctx.save(); ctx.translate(0, bob);
        if (imgReady('boat')) {
          // 스프라이트 — 캐릭터가 배 오른쪽에 앉아 있어 낚싯대 기점(x≈404)과 이어진다.
          // 높이는 50px 고정: 상단 ON AIR 바가 캔버스 y<43을 덮으므로 (벡터 배도 y44부터
          // 그리도록 설계돼 있었다) 그 아래 띠에 배 전체가 들어가야 한다. 선체가 수면 아래 살짝 잠기는 건 연출.
          var bi = IMG['boat'], bh = 50, bw = bh * bi.naturalWidth / bi.naturalHeight;
          ctx.drawImage(bi, 402 - bw, SURFACE + 22 - bh, bw, bh);
        } else {
          ctx.fillStyle = '#b9855a';
          ctx.beginPath();
          ctx.moveTo(280, SURFACE - 6); ctx.lineTo(440, SURFACE - 6);
          ctx.lineTo(420, SURFACE + 14); ctx.lineTo(300, SURFACE + 14); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#d8a878'; ctx.fillRect(300, SURFACE - 20, 60, 14);
          // 스트리머 실루엣 — 코럴 후디
          ctx.fillStyle = '#e8654a';
          ctx.beginPath(); ctx.arc(400, SURFACE - 26, 7, 0, TAU); ctx.fill();
          ctx.fillRect(394, SURFACE - 20, 12, 15);
        }
        // 낚싯대 — 릴 감는 중엔 텐션만큼 휜다
        var bend = st.phase === 'reel' ? st.tension / 100 : 0;
        var tipX = 470 + bend * 18, tipY = SURFACE - 34 + bend * 26;
        ctx.strokeStyle = '#c8b090'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(404, SURFACE - 18);
        ctx.quadraticCurveTo(450, SURFACE - 44 + bend * 10, tipX, tipY); ctx.stroke();
        ctx.restore();
        // 낚싯줄 + 루어
        if (st.phase !== 'repair') {
          var lx = LURE_X + Math.sin(t * 3) * 2, ly = st.lureY;
          if (st.nibT > 0) { lx += Math.sin(t * 30) * 3; ly += Math.sin(t * 26) * 3; }   // 잔입질 — 잔떨림
          if (st.biteT > 0) { lx += Math.sin(t * 40) * 7; ly += Math.sin(t * 34) * 8; }  // 진입질 — 요동
          // 파이트 중엔 진행도만큼 떠오른다 (prog 0 = 걸린 수심, 100 = 수면 근처)
          if (st.phase === 'reel' && st.fish)
            ly = st.lureY = SURFACE + 30 + Math.max(0, st.targetY - SURFACE - 30) * clamp(1 - st.fish.prog / 100, 0, 1.3) +
                            (st.surging > 0 ? Math.sin(t * 28) * 5 : 0);
          ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(tipX, tipY + bob);
          ctx.quadraticCurveTo(tipX + 30, (tipY + ly) / 2, lx, ly); ctx.stroke();
          // 진입질 알림 — 수면 위 "!!"
          if (st.biteT > 0) {
            ctx.fillStyle = '#ff5a4a'; ctx.font = 'bold 30px system-ui, sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('!!', lx, SURFACE - 16 - Math.abs(Math.sin(t * 10)) * 6);
          }
          // 파이트 중 물고기
          if (st.phase === 'reel' && st.fish) {
            var F = TIERS[st.fish.tier], fr = F.r;
            ctx.save(); ctx.translate(lx, ly + fr * .6);
            ctx.rotate(Math.sin(t * (st.surging > 0 ? 22 : 6)) * (st.surging > 0 ? .5 : .18));
            if (imgReady('fish-' + st.fish.tier)) {
              // 스프라이트도 벡터처럼 왼쪽을 본다 — 회전(몸부림)은 그대로 태운다
              var fim = IMG['fish-' + st.fish.tier], fw2 = fr * 3.8, fh2 = fw2 * fim.naturalHeight / fim.naturalWidth;
              ctx.drawImage(fim, -fw2 / 2, -fh2 / 2, fw2, fh2);
            } else {
              ctx.fillStyle = F.c;
              ctx.beginPath(); ctx.ellipse(0, 0, fr * 1.5, fr * .8, 0, 0, TAU); ctx.fill();
              ctx.beginPath(); ctx.moveTo(fr * 1.4, 0); ctx.lineTo(fr * 2.2, -fr * .7); ctx.lineTo(fr * 2.2, fr * .7); ctx.closePath(); ctx.fill();
              ctx.fillStyle = '#0c1016';
              ctx.beginPath(); ctx.arc(-fr * .8, -fr * .2, Math.max(2, fr * .16), 0, TAU); ctx.fill();
            }
            ctx.restore();
            if (st.surging > 0) {
              ctx.fillStyle = '#ff8d5a'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'center';
              ctx.fillText('저항!!', lx, ly - fr - 14);
            }
          } else {
            // 루어
            ctx.fillStyle = '#ffd27a';
            ctx.beginPath(); ctx.arc(lx, ly, 4, 0, TAU); ctx.fill();
            ctx.strokeStyle = 'rgba(255,210,122,.35)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(lx, ly, 8 + Math.sin(t * 4) * 2, 0, TAU); ctx.stroke();
          }
        } else {
          // 수리 중 — 부러진 낚싯대
          ctx.fillStyle = '#2e4658'; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('🔧 낚싯대 수리 중… ' + Math.max(0, st.repairT).toFixed(1) + 's', 480, 220);
        }
        // 릴 감기 게이지 — 텐션(위험) + 끌어올림(진행)
        if (st.phase === 'reel' && st.fish) {
          var gx = 660, gw = 270;
          ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(gx - 8, 12, gw + 16, 64);
          ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#23445c';
          ctx.fillText('텐션', gx, 26);
          ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(gx, 30, gw, 10);
          var tc = st.tension >= EDGE_AT ? '#ff5a4a' : st.tension > 65 ? '#ffb447' : '#6fd98f';
          ctx.fillStyle = tc; ctx.fillRect(gx, 30, gw * clamp(st.tension / 100, 0, 1), 10);
          ctx.fillStyle = 'rgba(255,90,74,.9)'; ctx.fillRect(gx + gw * EDGE_AT / 100, 28, 2, 14);
          ctx.fillStyle = '#23445c';
          ctx.fillText('끌어올림 — ' + TIERS[st.fish.tier].n, gx, 54);
          ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(gx, 58, gw, 10);
          ctx.fillStyle = '#4aa0ff'; ctx.fillRect(gx, 58, gw * clamp(st.fish.prog / 100, 0, 1), 10);
        }
        // 물보라 VFX — 4x4 시트를 'screen' 블렌드로 얹는다 (포켓과 같은 파이프라인)
        st.vfx = st.vfx.filter(function (f) {
          var p = (t - f.born) / VFX_DUR;
          if (p >= 1) return false;
          if (p < 0) return true;
          var im = IMG['vfx-splash'];
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
      },
    };
  }

  Shell.register({
    id: 'fishing',
    title: '심연낚시',
    tagline: '얕은 물은 시시하다. 심해의 괴물은 낚싯대와 방송을 같이 부순다 — 여기서도 안전한 캐스팅이 최악이다.',
    duration: SHOW_TIME,
    startViewers: START_VIEWERS,
    usesChain: false,
    chat: window.FISHING_CHAT,
    preload: loadArt,
    tuning: { ZONES: ZONES, TIERS: TIERS, SNAP_AT: SNAP_AT, EDGE_AT: EDGE_AT, SNAP_GAIN: SNAP_GAIN, REPAIR_TIME: REPAIR_TIME },
    foot: '<kbd>1</kbd>~<kbd>3</kbd> 또는 버튼으로 수심 선택 후 화면 클릭 = 캐스팅 — <b>깊을수록 크게 문다. 대신 기다림이 리스크다.</b><br>' +
          '"!!" 순간 클릭 = 챔질(잔입질은 페이크) · 릴: 누르면 텐션↑ 당김, 떼면 텐션↓ — 100% 초과 = 줄 끊김(그것도 콘텐츠), 슬랙 방치 = 도망',
    thumb: function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#a8dcf5'); g.addColorStop(.25, '#4fc4e0'); g.addColorStop(1, '#155a96');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,255,255,.65)';
      c.beginPath(); c.moveTo(0, h * .22); c.lineTo(w, h * .22); c.stroke();
      c.fillStyle = '#b9855a';
      c.beginPath(); c.moveTo(w * .3, h * .2); c.lineTo(w * .55, h * .2); c.lineTo(w * .5, h * .3); c.lineTo(w * .35, h * .3); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(220,230,240,.5)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(w * .52, h * .2); c.lineTo(w * .6, h * .85); c.stroke();
      c.fillStyle = '#ff6a3d';
      c.beginPath(); c.ellipse(w * .63, h * .85, 16, 8, .2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ffd27a'; c.font = 'bold 13px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText('!!', w * .6, h * .62);
    },
    start: start,
  });
})();
