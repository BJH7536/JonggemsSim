/* Giving Up On It — Getting Over It 패러디. 항아리에 든 사람이 망치 하나로 절벽을 오른다.
 *
 * 화력쇼와 정반대 리듬을 담당하는 2번째 게임. 화력쇼가 "초 단위 반응"이라면 이쪽은
 * "느린 긴장 → 한 방의 대추락"이다. 같은 AI 시청자 8종이 완전히 다른 어휘로 반응하는 게
 * 종겜스의 관전 포인트라, 게임의 존재 이유가 "장르 대비"에 있다.
 *
 * 공통 명제는 화력쇼와 같다 — **안전한 플레이가 최악의 전략이다.**
 *   등반 1m = +45~150   ≪   추락 10m = +3,600   ≪   추락 40m = +33,000
 * 다만 큰 낙차는 높이 올라가야만 생기므로, "올라가라 → 떨어져라 → 물리면 더 올라가라"가
 * 하나의 루프로 닫힌다 (규약 4를 추락 신선도로 구현 — 아래 FALL_FRESH).
 *
 * ── 조작감 2차 (2026-08-07) ────────────────────────────────────────────────
 * 1차 구현의 결함 3가지를 고쳤다:
 *   (a) 망치 길이가 고정이라 커서가 가까이 있어도 항상 최대로 뻗었다 → 커서까지만 뻗는다.
 *       원작의 "가까운 턱에 살짝 걸치기"가 이걸로 비로소 가능해진다. 가장 큰 차이.
 *   (b) 망치 끝점만 충돌시켜서 빠른 마우스 이동이 얇은 발판을 통과했다 → 자루를 몸통에서
 *       바깥으로 훑어 처음 닿는 지점을 접점으로 삼는다. 막대로 취급하니 턱에 걸쳐지기도 한다.
 *   (c) 지형이 직사각형뿐이라 미끄러짐이 없었다 → 바위(원)를 섞었다. 원작의 재미는 곡면에서
 *       주르륵 미끄러지는 데 있고, 사각형만으로는 그 질감이 안 나온다.
 * 그 외: 카메라 감속 추종, 사거리 링, 접점 하이라이트, 먼지, 'clutch'(살렸다) 이벤트 배선.
 *
 * ⚠ 밸런스 주의: 화력쇼와 달리 이 게임은 전략 스윕 검증을 거치지 않았다.
 *   상수는 데모용 조율값이다 — 05-hwaryeok-spec.md급 검증 기록이 없다는 점을 감안할 것.
 */
(function () {
  'use strict';

  var U = Shell.util, clamp = U.clamp, TAU = U.TAU;
  var sfx = Shell.sfx;

  var SHOW_TIME = 180;
  var START_VIEWERS = 300;

  // ---------- 월드 ----------
  var W = 960, VH = 430, WORLD_H = 1600;
  var GROUND_Y = 1520;        // 높이 0m 기준선
  var PX_PER_M = 20;
  var SUMMIT_Y = 195;         // 정상 발판 상단 → 약 66m

  // 고정 지형. 매 방송 같은 산이어야 최고 기록이 의미를 가진다 (절차 생성 금지).
  // 발판(rect)과 바위(circle)를 섞는다 — 발판만 있으면 실수가 "못 올라감"으로만 끝나지만,
  // 바위가 섞이면 실수가 "미끄러져 떨어짐"이 된다. 이 게임의 수익원은 후자다.
  function R(x, y, w, h) { return { t: 'r', x: x, y: y, w: w, h: h }; }
  function C(x, y, r) { return { t: 'c', x: x, y: y, r: r }; }
  // 3차 개편 (2026-08-07, 플레이 피드백): 1차 배치는 발판·바위가 뒤섞여 "다음 홀드가
  // 어디인가"를 읽을 수 없었고 바위가 주 루트를 막았다. 등반 게임의 지형은 문제이지
  // 미로가 아니다 — 주 루트는 좌우 지그재그 사다리(수직 40~70px, 망치 사거리 118의
  // 절반 수준)로 항상 읽히게 하고, 바위는 루트 밖 가장자리로 빼서 "미끄러지면 만나는
  // 위험"으로만 쓴다. ROUTE는 selftest가 기하로 등반 가능성을 검증한다.
  var ROUTE = [
    R(360, 1450, 240, 22), R(150, 1385, 190, 22), R(420, 1322, 200, 22), R(660, 1262, 190, 22),
    R(430, 1205, 170, 22), R(180, 1150, 180, 22), R(420, 1096, 170, 22), R(670, 1042, 180, 22),
    R(430, 990, 160, 22),  R(170, 938, 180, 22),  R(420, 886, 160, 22),  R(650, 836, 170, 22),
    R(400, 786, 160, 22),  R(150, 736, 170, 22),  R(400, 688, 150, 22),  R(640, 640, 160, 22),
    R(380, 592, 150, 22),  R(130, 546, 160, 22),  R(380, 500, 150, 22),  R(560, 456, 170, 22),
    R(360, 412, 140, 22),  R(120, 368, 150, 22),  R(370, 326, 140, 22),  R(610, 284, 150, 22),
    R(360, 244, 140, 22),
  ];
  var TERRAIN = [R(0, GROUND_Y, 960, 80)].concat(ROUTE, [
    R(340, SUMMIT_Y, 220, 28),
    // 바위 — 루트 밖 가장자리. 주 루트를 막지 않고, 미끄러진 몸이 굴러떨어지는 경로에 있다
    C(120, 1470, 40), C(700, 1390, 44), C(80, 1240, 40), C(885, 1150, 38),
    C(90, 1000, 38),  C(860, 900, 42),  C(80, 700, 36),  C(870, 560, 40),
    C(80, 420, 34),   C(870, 300, 38),
    // 보이지 않는 양옆 벽 — 화면 밖으로 빠지지 않게
    { t: 'r', x: -60, y: -400, w: 60, h: WORLD_H + 400, hidden: true },
    { t: 'r', x: 960, y: -400, w: 60, h: WORLD_H + 400, hidden: true },
  ]);

  // ---------- 물리 ----------
  var PR = 16;              // 항아리 반지름
  var HAMMER_MAX = 118;     // 사거리. 실제 길이는 커서까지의 거리로 정해진다
  var HAMMER_MIN = 22;      // 몸통 안으로 말려들지 않게
  var SHAFT_STEPS = 9;      // 자루를 훑는 표본 수 (막대 충돌)
  var GRAV = 1500;
  var MAX_V = 1600;
  var MAX_STEP = 30;        // 박힌 망치가 한 프레임에 몸을 밀 수 있는 거리 (텔레포트 방지)

  // 규약 4 — 추락 신선도: 같은 짓만 반복하면 물린다. 신기록 높이 갱신으로만 회복된다.
  var FALL_FRESH = [1, .7, .45, .25, .1];

  // clutch 판정 상수. 물리와 얽혀 있어서 값만 보고는 성립 여부를 알 수 없다 —
  // 실제로 초판에서 "속도 700 이상 + 높이 손실 3m 미만"이라는 서로를 배제하는 조건을 썼고
  // 이벤트가 영원히 안 터졌다. 아래 tuning으로 노출해 selftest가 도달 가능성을 검사한다.
  var CLUTCH_V = 550;      // 이 속도 이상으로 떨어지던 중이어야
  var CLUTCH_MIN_H = 3;    // 이 높이 위에서 붙잡아야 (바닥에 처박힌 건 clutch가 아니다)

  // ---------- AetherAI 생성 아트 (tools/aether-assets.json) ----------
  // 항아리·망치 헤드. 없거나 로드 전이면 기존 벡터로 폴백 — 아트는 얹는 층이다.
  // 지형·먼지·사거리 링은 계속 절차적으로: 접점 하이라이트가 곧 조작 피드백이라서다.
  var IMG = {};
  ['pot', 'hammer'].forEach(function (n) {
    var im = new Image();
    im.src = 'games/giving-up/img/' + n + '.png';
    IMG[n] = im;
  });
  function imgReady(n) { var im = IMG[n]; return im && im.complete && im.naturalWidth > 0; }

  var sfxTick  = function () { if (!sfx.gate('gu_k')) return; sfx.tone(210, .04, 'square', .035); };
  var sfxHit   = function () { if (!sfx.gate('gu_h')) return; sfx.noise(.09, .06, 260); };
  var sfxSlide = function () { if (!sfx.gate('gu_s')) return; sfx.noise(.1, .035, 520); };
  var sfxFall  = function () { if (!sfx.gate('gu_f')) return; sfx.noise(.35, .16, 180); sfx.tone(70, .3, 'sine', .12); };
  var sfxUp    = function () { if (!sfx.gate('gu_u')) return; sfx.tone(740, .08, 'triangle', .06); sfx.tone(988, .1, 'triangle', .05, .06); };
  var sfxSave  = function () { if (!sfx.gate('gu_v')) return; sfx.tone(880, .07, 'triangle', .08); sfx.tone(1320, .12, 'triangle', .07, .06); };
  var sfxTop   = function () { if (!sfx.gate('gu_t')) return; [523, 659, 784, 1047].forEach(function (f, i) { sfx.tone(f, .18, 'triangle', .1, i * .1); }); };

  // ---------- 지형 질의 ----------
  function shapeAt(x, y) {
    for (var i = 0; i < TERRAIN.length; i++) {
      var s = TERRAIN[i];
      if (s.t === 'r') {
        if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s;
      } else {
        var dx = x - s.x, dy = y - s.y;
        if (dx * dx + dy * dy <= s.r * s.r) return s;
      }
    }
    return null;
  }
  // 도형 안에 박힌 점을 가장 가까운 표면으로
  function surfaceOf(s, x, y) {
    if (s.t === 'c') {
      var dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy) || 1;
      return { x: s.x + dx / d * (s.r + .5), y: s.y + dy / d * (s.r + .5) };
    }
    var l = x - s.x, r = s.x + s.w - x, t = y - s.y, b = s.y + s.h - y;
    var m = Math.min(l, r, t, b);
    if (m === t) return { x: x, y: s.y - .5 };
    if (m === b) return { x: x, y: s.y + s.h + .5 };
    if (m === l) return { x: s.x - .5, y: y };
    return { x: s.x + s.w + .5, y: y };
  }
  // 몸통을 도형 밖으로 밀어내고 법선을 돌려준다
  function separate(s, px, py, rad) {
    var cx, cy;
    if (s.t === 'c') { cx = s.x; cy = s.y; }
    else { cx = clamp(px, s.x, s.x + s.w); cy = clamp(py, s.y, s.y + s.h); }
    var dx = px - cx, dy = py - cy, d2 = dx * dx + dy * dy;
    var reach = s.t === 'c' ? rad + s.r : rad;
    if (d2 >= reach * reach) return null;
    var d = Math.sqrt(d2), nx, ny;
    if (d > .0001) { nx = dx / d; ny = dy / d; }
    else {
      var o = surfaceOf(s, px, py);
      var ox = o.x - px, oy = o.y - py, od = Math.hypot(ox, oy) || 1;
      nx = ox / od; ny = oy / od; d = 0;
    }
    return { nx: nx, ny: ny, push: reach - d };
  }

  function start(stage) {
    var st = {
      px: 480, py: GROUND_Y - PR, vx: 0, vy: 0,
      len: HAMMER_MAX, tipX: 560, tipY: GROUND_Y - 90,
      mx: 590, my: GROUND_Y - 60,   // 월드 좌표
      planted: false, contact: null, camY: 0,
      best: 0, paidM: 0, peak: 0,
      fallFresh: 0, recoverAcc: 0,
      falls: 0, maxDrop: 0, saves: 0, cleared: false,
      restT: 0, stillT: 0, lastH: 0, nagT: 0, airVy: 0, touched: false, wasContact: false, unplantT: 1,
      donT: 9 + Math.random() * 7, chatT: 3, mileIdx: 0,
      dust: [],
    };
    var MILES = [1000, 5000, 15000, 60000, 150000];
    var panel = stage.panel;
    st.camY = clamp(st.py - 250, 0, WORLD_H - VH);

    var heightM = function () { return Math.max(0, (GROUND_Y - PR - st.py) / PX_PER_M); };

    stage.hud('⏱ 방송 <b id="guTime">3:00</b> · 최고 <b id="guBest">0.0</b>m · 추락 <b id="guFalls">0</b>회');
    panel.innerHTML =
      '<div class="climbbar">' +
        '<div class="cell"><div class="lab">현재 높이</div><div class="val" id="guH">0.0m</div></div>' +
        '<div class="cell"><div class="lab">최고 높이</div><div class="val" id="guB">0.0m</div></div>' +
        '<div class="cell"><div class="lab">추락 신선도</div><div class="val" id="guF">100%</div></div>' +
        '<div class="hint"><b>마우스를 움직이면 망치가 그쪽으로 뻗는다</b> — 커서까지만 뻗으니 가까운 턱에 살짝 걸칠 수도 있다.<br>' +
        '바위에 걸고 <b>반대로 밀어내면</b> 몸이 딸려 올라간다. 크게 떨어질수록 시청자가 폭증한다.</div>' +
      '</div>';

    function renderPanel() {
      var e;
      if ((e = document.getElementById('guH'))) e.textContent = heightM().toFixed(1) + 'm';
      if ((e = document.getElementById('guB'))) e.textContent = st.best.toFixed(1) + 'm';
      if ((e = document.getElementById('guF'))) {
        var pct = Math.round(FALL_FRESH[st.fallFresh] * 100);
        e.textContent = pct + '%';
        e.className = 'val' + (pct < 100 ? ' warn' : '');
      }
      if ((e = document.getElementById('guBest'))) e.textContent = st.best.toFixed(1);
      if ((e = document.getElementById('guFalls'))) e.textContent = st.falls;
    }

    function puff(x, y, n) {
      for (var i = 0; i < n; i++) {
        st.dust.push({ x: x, y: y, vx: (Math.random() - .5) * 60, vy: -Math.random() * 40,
                       a: .5, r: 2 + Math.random() * 3 });
      }
      if (st.dust.length > 90) st.dust.splice(0, st.dust.length - 90);
    }

    // ---------- 물리 ----------
    function resolveBody() {
      var hit = null;
      for (var pass = 0; pass < 3; pass++) {
        for (var i = 0; i < TERRAIN.length; i++) {
          var sep = separate(TERRAIN[i], st.px, st.py, PR);
          if (!sep) continue;
          hit = TERRAIN[i];
          st.px += sep.nx * sep.push; st.py += sep.ny * sep.push;
          var vn = st.vx * sep.nx + st.vy * sep.ny;
          if (vn < 0) { st.vx -= vn * sep.nx; st.vy -= vn * sep.ny; }
          // 곡면은 잘 미끄러지고 평면은 붙잡힌다 — 원작의 질감이 여기서 나온다
          var fric = TERRAIN[i].t === 'c' ? .965 : .88;
          st.vx *= fric; st.vy *= .975;
        }
      }
      return hit;
    }

    function physics(dt) {
      var prevX = st.px, prevY = st.py, wasPlanted = st.planted;

      // 망치는 커서 방향으로, 커서까지의 거리만큼만 뻗는다 (사거리 상한 HAMMER_MAX)
      var dx = st.mx - st.px, dy = st.my - st.py;
      var dist = Math.hypot(dx, dy) || 1;
      var dirX = dx / dist, dirY = dy / dist;
      st.len = clamp(dist, HAMMER_MIN, HAMMER_MAX);

      // 자루를 몸통 바깥으로 훑어 처음 닿는 지점을 접점으로 — 끝점만 보면 얇은 발판을 통과한다
      var hitS = null, hitT = 0;
      for (var k = 1; k <= SHAFT_STEPS; k++) {
        var f = PR / st.len + (1 - PR / st.len) * (k / SHAFT_STEPS);
        if (f > 1) break;
        var s = shapeAt(st.px + dirX * st.len * f, st.py + dirY * st.len * f);
        if (s) { hitS = s; hitT = f; break; }
      }

      if (hitS) {
        // 접점은 표면에 머물고, 대신 몸이 밀린다 (장대높이뛰기)
        var cxp = st.px + dirX * st.len * hitT, cyp = st.py + dirY * st.len * hitT;
        var surf = surfaceOf(hitS, cxp, cyp);
        var reach = st.len * hitT;
        var tX = surf.x - dirX * reach, tY = surf.y - dirY * reach;
        var mdx = tX - st.px, mdy = tY - st.py, m = Math.hypot(mdx, mdy);
        if (m > MAX_STEP) { mdx = mdx / m * MAX_STEP; mdy = mdy / m * MAX_STEP; }
        st.px += mdx; st.py += mdy;
        st.tipX = surf.x; st.tipY = surf.y;
        st.planted = true; st.contact = hitS;
        // 경계에서 접점이 프레임마다 붙었다 떨어졌다 하면 틱음이 연발된다 —
        // 0.15초 이상 떨어져 있다 다시 박혔을 때만 "박힘" 소리를 낸다
        if (!wasPlanted && st.unplantT > 0.15) { sfxTick(); puff(surf.x, surf.y, 4); }
        st.unplantT = 0;
        if (wasPlanted && m > 6) { sfxSlide(); if (Math.random() < .25) puff(surf.x, surf.y, 1); }
      } else {
        st.tipX = st.px + dirX * st.len; st.tipY = st.py + dirY * st.len;
        st.planted = false; st.contact = null;
        st.unplantT += dt;
        st.vy += GRAV * dt;
        st.px += st.vx * dt; st.py += st.vy * dt;
      }

      var contactDist = st.planted ? Math.hypot(st.tipX - st.px, st.tipY - st.py) : st.len;
      var touching = resolveBody();
      // 착지음은 "공중 → 접촉" 전이에서 한 번만. 서 있는 동안 매 프레임 접촉이 일어나는데
      // airVy가 리셋되지 않아 착지음이 100ms 게이트 주기로 계속 재발화했다 (플레이 피드백:
      // "서 있을 때 계속 부딪히는 소리"). 접촉 중에는 airVy를 0으로 유지한다.
      if (touching && !st.wasContact && !st.planted && st.airVy > 260) { sfxHit(); puff(st.px, st.py + PR, 5); }
      if (touching) {
        st.touched = true; // 몸이 지형에 닿았다 = 자력으로 붙잡은 게 아니다 (clutch 판정용)
        st.airVy = 0;
      }
      st.wasContact = !!touching;
      st.px = clamp(st.px, PR, W - PR);
      st.py = Math.min(st.py, GROUND_Y - PR + 40);

      // 몸이 밀린 뒤 망치 끝을 다시 잡는다. 접점을 몸이 움직이기 전 좌표로 그려두면
      // 망치가 커서를 안 가리키는 프레임이 생기고, 그게 "조준이 안 먹는다"는 감각이 된다.
      var fdx = st.mx - st.px, fdy = st.my - st.py, fd = Math.hypot(fdx, fdy) || 1;
      st.tipX = st.px + fdx / fd * contactDist;
      st.tipY = st.py + fdy / fd * contactDist;

      if (st.planted) {
        // 밀린 만큼이 곧 속도 — 손을 떼는 순간 이 속도로 날아간다 (플릭)
        var kk = .7;
        st.vx = st.vx * (1 - kk) + (st.px - prevX) / dt * kk;
        st.vy = st.vy * (1 - kk) + (st.py - prevY) / dt * kk;
      }
      st.vx = clamp(st.vx, -MAX_V, MAX_V); st.vy = clamp(st.vy, -MAX_V, MAX_V);

      // clutch(살렸다) — "빠르게 떨어지던 중, 바닥에 처박히기 전에 망치로 붙잡았는가".
      // 처음엔 "높이를 3m 미만으로만 잃었을 때"로 썼는데 이건 성립 불가능한 조건이었다:
      // 낙하속도 700에 닿으려면 최소 8.2m를 떨어져야 하므로 두 조건이 서로를 배제한다.
      // 실제로 관객이 환호하는 순간은 "덜 잃었을 때"가 아니라 "바닥까지 안 갔을 때"다.
      if (!st.planted && st.vy > 0) st.airVy = Math.max(st.airVy, st.vy);
      if (st.planted && Math.hypot(st.vx, st.vy) < 140) {
        if (st.airVy > CLUTCH_V && !st.touched && heightM() > CLUTCH_MIN_H) {
          st.saves++;
          stage.gain(Math.round(st.airVy * .8), '살렸다!');
          stage.emit('clutch'); sfxSave(); stage.flash(.12);
        }
        st.airVy = 0; st.touched = false;
      }
    }

    // ---------- 시청자 경제 ----------
    function payClimb() {
      while (st.best >= st.paidM + 1) {
        st.paidM++;
        stage.gain(Math.round(45 * (1 + st.paidM / 30)), null);
        st.recoverAcc++;
        if (st.recoverAcc >= 3 && st.fallFresh > 0) { // 규약 4 회복 — 새 높이를 뚫어야 풀린다
          st.recoverAcc = 0; st.fallFresh--;
        }
      }
    }

    function onFall(drop) {
      st.falls++;
      st.maxDrop = Math.max(st.maxDrop, drop);
      var fm = FALL_FRESH[st.fallFresh];
      st.fallFresh = Math.min(FALL_FRESH.length - 1, st.fallFresh + 1);
      st.recoverAcc = 0;
      var raw = Math.round(90 * Math.pow(drop, 1.6) * fm);
      var ev = drop >= 25 ? 'fall_legend' : (drop >= 9 ? 'fall_big' : 'fall');
      var actual = stage.gain(raw, drop >= 9 ? '대추락 ' + drop.toFixed(0) + 'm!!' : '추락 ' + drop.toFixed(0) + 'm');
      if (drop >= 9) { stage.shake(Math.min(18, drop * .5)); stage.flash(.18); sfxFall(); }
      if (drop >= 25) stage.stamp(drop.toFixed(0) + 'm 대추락');
      stage.ticker('추락 ' + drop.toFixed(1) + 'm — 시청자 +' + actual.toLocaleString(), false);
      stage.emit(ev, { d: drop.toFixed(0), gain: actual.toLocaleString() });
      renderPanel();
    }

    function ambient() {
      if (st.mileIdx < MILES.length && stage.viewers >= MILES[st.mileIdx]) {
        stage.emit('milestone', { v: MILES[st.mileIdx++].toLocaleString() });
        return;
      }
      stage.emit('idle');
    }

    stage.ticker('방송 시작! 마우스로 망치를 걸어 올라가라', false);
    renderPanel();

    return {
      st: st, // 검증용 노출 — 물리는 눈으로만 봐서는 확인이 안 되는 경로(고공 낙하 후 clutch 등)가 있다

      step: function (dt) {
        var e = document.getElementById('guTime');
        if (e) e.textContent = U.fmtTime(stage.timeLeft);

        physics(dt);
        var h = heightM();
        // 카메라는 감속 추종 — 즉시 따라붙으면 추락이 안 무섭다
        var want = clamp(st.py - 250, 0, WORLD_H - VH);
        st.camY += (want - st.camY) * Math.min(1, dt * 7);

        if (!st.cleared && st.py < SUMMIT_Y + 4 && st.px > 340 && st.px < 550) {
          st.cleared = true;
          st.clearT = 1.4; // step 구동 — setTimeout은 인스턴스보다 오래 살아, 정상 직후 Escape→재시작하면
                           // 다음 방송을 'clear'로 끝내버린다 (리뷰 발견). pocket의 step 타이머와 같은 원리
          var g = stage.gain(60000, '정상 등반!!!');
          stage.stamp('정상 등반'); stage.flash(.5); sfxTop();
          stage.emit('summit', { gain: g.toLocaleString() });
          return;
        }
        if (st.cleared) {
          st.clearT -= dt;
          if (st.clearT <= 0) stage.end('clear');
          return;
        }

        if (h > st.best) {
          var was = Math.floor(st.best);
          st.best = h;
          payClimb();
          if (Math.floor(st.best) > was && Math.floor(st.best) % 5 === 0) {
            stage.emit('climb', { h: Math.floor(st.best) });
            sfxUp();
          }
          renderPanel();
        }
        if (h > st.peak) st.peak = h;

        // 추락 판정 — "떨어지는 중"이 아니라 "떨어져서 멈췄을 때" 한 번만
        var speed = Math.hypot(st.vx, st.vy);
        st.restT = speed < 45 ? st.restT + dt : 0;
        if (st.restT > .18 && st.peak - h >= 2) { onFall(st.peak - h); st.peak = h; }

        // 정체 — 조용히 샌다 (규약 2). 화력쇼의 빈 화구와 같은 원리
        if (Math.abs(h - st.lastH) > .4) { st.lastH = h; st.stillT = 0; }
        else {
          st.stillT += dt;
          if (st.stillT > 2.5) {
            stage.lose(Math.max(1, stage.viewers * 0.007) * dt);
            st.nagT += dt;
            if (st.nagT > 6) { st.nagT = 0; stage.emit('stuck'); }
          }
        }

        st.donT -= dt;
        if (st.donT <= 0) {
          st.donT = 9 + Math.random() * 7;
          if (Math.random() < .45) {
            var d = Math.max(10, Math.round(stage.viewers * (0.01 + Math.random() * 0.02)));
            var a = stage.gain(d, '익명의 도네');
            stage.emit('donation', { d: a.toLocaleString() });
          }
        }

        st.chatT -= dt;
        if (st.chatT <= 0) {
          st.chatT = clamp(4.2 - Math.log10(stage.viewers + 10) * .55, 1.4, 4.2) + Math.random() * 1.6;
          ambient();
        }

        st.dust = st.dust.filter(function (p) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt; p.a -= 1.1 * dt;
          return p.a > 0;
        });
      },

      pointer: function (p) { st.mx = p.x; st.my = p.y + st.camY; },

      summary: function () {
        return [
          ['최고 높이', st.best.toFixed(1) + 'm' + (st.cleared ? ' (정상!)' : '')],
          ['추락 / 최대 낙차', st.falls + '회 / ' + st.maxDrop.toFixed(1) + 'm'],
          ['위기 모면', st.saves + '회'],
        ];
      },

      dispose: function () {},

      draw: function (ctx, dt) {
        ctx.save();
        ctx.translate(0, -st.camY);
        drawCliff(ctx, st.camY);
        drawTerrain(ctx, st.camY);
        drawDust(ctx);
        drawClimber(ctx);
        ctx.restore();
        drawRuler(ctx);
      },
    };

    // ---------- 렌더 ----------
    function drawCliff(ctx, cam) {
      var g = ctx.createLinearGradient(0, cam, 0, cam + VH);
      g.addColorStop(0, '#1a2230'); g.addColorStop(1, '#0e1219');
      ctx.fillStyle = g; ctx.fillRect(0, cam, W, VH);
      ctx.strokeStyle = 'rgba(120,140,170,.07)'; ctx.lineWidth = 2;
      for (var y = Math.floor(cam / 70) * 70; y < cam + VH + 70; y += 70) {
        ctx.beginPath(); ctx.moveTo(0, y);
        for (var x = 0; x <= W; x += 120) ctx.lineTo(x, y + Math.sin(x * .013 + y * .05) * 16);
        ctx.stroke();
      }
      if (cam < 420) {
        var s = ctx.createLinearGradient(0, 120, 0, 520);
        s.addColorStop(0, 'rgba(120,170,220,.20)'); s.addColorStop(1, 'rgba(120,170,220,0)');
        ctx.fillStyle = s; ctx.fillRect(0, 120, W, 400);
      }
    }

    function drawTerrain(ctx, cam) {
      TERRAIN.forEach(function (s) {
        if (s.hidden) return;
        var top = s.t === 'c' ? s.y - s.r : s.y;
        var bot = s.t === 'c' ? s.y + s.r : s.y + s.h;
        if (top > cam + VH || bot < cam) return;
        var lit = s === st.contact;
        if (s.t === 'c') {
          var rg = ctx.createRadialGradient(s.x - s.r * .35, s.y - s.r * .4, s.r * .15, s.x, s.y, s.r);
          rg.addColorStop(0, lit ? '#8b7f6d' : '#6b6155'); rg.addColorStop(1, '#2b2621');
          ctx.fillStyle = rg;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
          ctx.strokeStyle = lit ? 'rgba(255,180,71,.75)' : 'rgba(0,0,0,.45)';
          ctx.lineWidth = lit ? 2.5 : 2; ctx.stroke();
        } else {
          var g = ctx.createLinearGradient(0, s.y, 0, s.y + s.h);
          g.addColorStop(0, lit ? '#8b7f6d' : '#6b6155'); g.addColorStop(.3, '#4a423a'); g.addColorStop(1, '#2b2621');
          ctx.fillStyle = g; ctx.fillRect(s.x, s.y, s.w, s.h);
          ctx.fillStyle = lit ? 'rgba(255,200,120,.5)' : 'rgba(220,210,190,.22)';
          ctx.fillRect(s.x, s.y, s.w, 3);
          ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(s.x, s.y + s.h - 3, s.w, 3);
        }
      });
      ctx.strokeStyle = '#cfc7b8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(445, SUMMIT_Y); ctx.lineTo(445, SUMMIT_Y - 46); ctx.stroke();
      ctx.fillStyle = '#ffb447';
      ctx.beginPath(); ctx.moveTo(445, SUMMIT_Y - 46); ctx.lineTo(487, SUMMIT_Y - 36); ctx.lineTo(445, SUMMIT_Y - 26); ctx.closePath(); ctx.fill();
    }

    function drawDust(ctx) {
      st.dust.forEach(function (p) {
        ctx.fillStyle = 'rgba(190,178,158,' + Math.max(0, p.a) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      });
    }

    function drawClimber(ctx) {
      var x = st.px, y = st.py;
      // 사거리 링 — 망치가 어디까지 닿는지 안 보이면 조작이 추측이 된다
      if (!st.planted) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,180,71,.13)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 7]);
        ctx.beginPath(); ctx.arc(x, y - 16, HAMMER_MAX, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y - 16); ctx.lineTo(st.tipX, st.tipY); ctx.stroke();
      var a = Math.atan2(st.tipY - (y - 16), st.tipX - x);
      ctx.save(); ctx.translate(st.tipX, st.tipY); ctx.rotate(a);
      if (imgReady('hammer')) {
        // 헤드가 팁 '뒤'에 오게 그린다. 팁은 물리 접점이라 그 앞으로 스프라이트가
        // 길게 나가면 발판 속에 파묻힌 것처럼 보인다(플레이 피드백). 타격면만 8px 남긴다.
        var hi = IMG['hammer'], hw = 30, hh = hw * hi.naturalHeight / hi.naturalWidth;
        ctx.drawImage(hi, -hw * .72, -hh / 2, hw, hh);
        if (st.planted) { // 박힘 표시 — 벡터 시절의 색 변화를 글로우로 대체
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(255,210,122,.4)';
          ctx.beginPath(); ctx.arc(4, 0, 14, 0, TAU); ctx.fill();
        }
      } else {
      ctx.fillStyle = st.planted ? '#ffd27a' : '#9aa0a8';
      ctx.fillRect(-6, -9, 18, 18);
      ctx.strokeStyle = '#14161a'; ctx.lineWidth = 2; ctx.strokeRect(-6, -9, 18, 18);
      }
      ctx.restore();
      ctx.fillStyle = '#d8c6a8';
      ctx.beginPath(); ctx.arc(x, y - 26, 8, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#d8c6a8'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 16);
      ctx.lineTo(x + Math.cos(a) * 26, y - 16 + Math.sin(a) * 26); ctx.stroke();
      if (imgReady('pot')) {
        var poi = IMG['pot'], pow2 = 46, poh = pow2 * poi.naturalHeight / poi.naturalWidth;
        // 항아리 입이 벡터 시절의 림(y-14)과 같은 높이에 오도록 바닥을 y+18에 앵커
        ctx.drawImage(poi, x - pow2 / 2, y + 18 - poh, pow2, poh);
      } else {
      var pg = ctx.createLinearGradient(x - PR, y - PR, x + PR, y + PR);
      pg.addColorStop(0, '#8a5a3a'); pg.addColorStop(1, '#4a2e1c');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.moveTo(x - 15, y - 14); ctx.lineTo(x + 15, y - 14);
      ctx.quadraticCurveTo(x + 20, y + 6, x + 9, y + 16);
      ctx.lineTo(x - 9, y + 16);
      ctx.quadraticCurveTo(x - 20, y + 6, x - 15, y - 14);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2a180e'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,180,.18)';
      ctx.beginPath(); ctx.ellipse(x - 5, y - 2, 4, 9, -.3, 0, TAU); ctx.fill();
      }
    }

    function drawRuler(ctx) {
      ctx.save();
      ctx.fillStyle = 'rgba(11,9,8,.62)'; ctx.fillRect(0, 24, 52, VH - 24);
      ctx.textAlign = 'right'; ctx.font = '10px system-ui, sans-serif';
      for (var m = 0; m <= 70; m += 5) {
        var wy = GROUND_Y - PR - m * PX_PER_M - st.camY;
        if (wy < 30 || wy > VH) continue;
        ctx.strokeStyle = 'rgba(200,190,170,.28)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(36, wy); ctx.lineTo(50, wy); ctx.stroke();
        ctx.fillStyle = '#8a8478'; ctx.fillText(m + 'm', 33, wy + 3.5);
      }
      var by = GROUND_Y - PR - st.best * PX_PER_M - st.camY;
      if (by > 26 && by < VH) {
        ctx.strokeStyle = 'rgba(255,180,71,.65)'; ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(W, by); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffb447'; ctx.textAlign = 'left';
        ctx.fillText('최고 ' + st.best.toFixed(1) + 'm', 56, by - 4);
      }
      ctx.restore();
    }
  }

  Shell.register({
    id: 'giving-up',
    title: 'Giving Up On It',
    tagline: '망치 하나로 절벽을 오른다. 조금씩 오르면 조금 벌고, 크게 떨어지면 왕창 번다 — 여기서도 안전한 플레이가 최악이다.',
    duration: SHOW_TIME,
    startViewers: START_VIEWERS,
    usesChain: false,
    chat: window.GIVINGUP_CHAT,
    // selftest가 물리 상수끼리 모순되지 않는지 검사한다 (games/shell/selftest.html)
    tuning: {
      GRAV: GRAV, PX_PER_M: PX_PER_M, GROUND_Y: GROUND_Y, SUMMIT_Y: SUMMIT_Y,
      CLUTCH_V: CLUTCH_V, CLUTCH_MIN_H: CLUTCH_MIN_H,
      HAMMER_MAX: HAMMER_MAX, HAMMER_MIN: HAMMER_MIN, FALL_FRESH: FALL_FRESH,
      ROUTE: ROUTE, TERRAIN: TERRAIN,
    },
    foot: '<b>마우스</b>로 망치를 움직인다 — 망치는 <b>커서까지만</b> 뻗는다. 바위에 걸고 반대로 밀어내면 몸이 딸려 올라간다. 키보드는 쓰지 않는다.<br>' +
          '둥근 바위는 미끄럽고 평평한 발판은 붙잡힌다 · 큰 추락일수록 시청자가 폭증하지만 <b>반복하면 물린다</b>(추락 신선도) — 회복하려면 더 높이 올라가야 한다',
    thumb: function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1a2230'); g.addColorStop(1, '#0e1219');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = '#4a423a';
      [[10, h * .82, 70], [90, h * .58, 60], [30, h * .34, 55], [130, h * .16, 60]].forEach(function (p) {
        c.fillRect(p[0], p[1], p[2], 8);
      });
      c.fillStyle = '#6b6155';
      c.beginPath(); c.arc(w * .78, h * .62, 24, 0, Math.PI * 2); c.fill();
      // 항아리 + 망치
      c.fillStyle = '#6a3f26';
      c.beginPath(); c.ellipse(w * .5, h * .5, 11, 13, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#d8c6a8'; c.beginPath(); c.arc(w * .5, h * .5 - 17, 6, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#8a6a3a'; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(w * .5, h * .5 - 10); c.lineTo(w * .5 + 34, h * .5 - 34); c.stroke();
      c.fillStyle = '#9aa0a8'; c.fillRect(w * .5 + 28, h * .5 - 42, 13, 13);
    },
    start: start,
  });
})();
