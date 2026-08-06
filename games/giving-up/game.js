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
 * ⚠ 밸런스 주의: 화력쇼와 달리 이 게임은 아직 전략 스윕 검증을 거치지 않았다.
 *   상수는 데모용 1차 조율값이다 — 05-hwaryeok-spec.md급 검증 기록이 없다는 점을 감안할 것.
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
  var LEDGES = [
    { x: 0, y: GROUND_Y, w: 960, h: 80 },
    { x: 120, y: 1440, w: 200, h: 24 }, { x: 420, y: 1380, w: 160, h: 24 },
    { x: 680, y: 1320, w: 200, h: 24 }, { x: 380, y: 1250, w: 150, h: 24 },
    { x: 110, y: 1190, w: 180, h: 24 }, { x: 500, y: 1130, w: 130, h: 24 },
    { x: 760, y: 1075, w: 170, h: 24 }, { x: 430, y: 1010, w: 140, h: 24 },
    { x: 150, y: 950,  w: 160, h: 24 }, { x: 620, y: 900,  w: 150, h: 24 },
    { x: 330, y: 840,  w: 130, h: 24 }, { x: 30,  y: 780,  w: 150, h: 24 },
    { x: 520, y: 730,  w: 140, h: 24 }, { x: 790, y: 675,  w: 150, h: 24 },
    { x: 400, y: 615,  w: 120, h: 24 }, { x: 120, y: 560,  w: 150, h: 24 },
    { x: 600, y: 505,  w: 130, h: 24 }, { x: 330, y: 450,  w: 120, h: 24 },
    { x: 700, y: 395,  w: 140, h: 24 }, { x: 140, y: 340,  w: 140, h: 24 },
    { x: 470, y: 290,  w: 130, h: 24 }, { x: 760, y: 240,  w: 150, h: 24 },
    { x: 350, y: SUMMIT_Y, w: 200, h: 30 },
    // 보이지 않는 양옆 벽 — 화면 밖으로 빠지지 않게
    { x: -60, y: 0, w: 60, h: WORLD_H, hidden: true },
    { x: 960, y: 0, w: 60, h: WORLD_H, hidden: true },
  ];

  // ---------- 물리 ----------
  var PR = 16;              // 항아리 반지름
  var HAMMER_LEN = 112;
  var GRAV = 1500;
  var MAX_V = 1500;
  var MAX_STEP = 26;        // 망치가 박혀 있을 때 한 프레임에 밀 수 있는 거리 (텔레포트 방지)

  // 규약 4 — 추락 신선도: 같은 짓만 반복하면 물린다. 신기록 높이 갱신으로만 회복된다.
  var FALL_FRESH = [1, .7, .45, .25, .1];

  var sfxHit   = function () { if (!sfx.gate('gu_h')) return; sfx.tone(180, .05, 'square', .04); };
  var sfxSlide = function () { if (!sfx.gate('gu_s')) return; sfx.noise(.12, .05, 400); };
  var sfxFall  = function () { if (!sfx.gate('gu_f')) return; sfx.noise(.35, .16, 180); sfx.tone(70, .3, 'sine', .12); };
  var sfxUp    = function () { if (!sfx.gate('gu_u')) return; sfx.tone(740, .08, 'triangle', .06); sfx.tone(988, .1, 'triangle', .05, .06); };
  var sfxTop   = function () { if (!sfx.gate('gu_t')) return; [523, 659, 784, 1047].forEach(function (f, i) { sfx.tone(f, .18, 'triangle', .1, i * .1); }); };

  function pointInSolid(x, y) {
    for (var i = 0; i < LEDGES.length; i++) {
      var r = LEDGES[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }
  // 지형 안에 박힌 점을 가장 가까운 표면으로 밀어낸다
  function pushOut(x, y, r) {
    var l = x - r.x, rr = r.x + r.w - x, t = y - r.y, b = r.y + r.h - y;
    var m = Math.min(l, rr, t, b);
    if (m === t) return { x: x, y: r.y - .5 };
    if (m === b) return { x: x, y: r.y + r.h + .5 };
    if (m === l) return { x: r.x - .5, y: y };
    return { x: r.x + r.w + .5, y: y };
  }

  function start(stage) {
    var st = {
      px: 480, py: GROUND_Y - PR, vx: 0, vy: 0,
      tipX: 560, tipY: GROUND_Y - 90,
      mx: 560, my: GROUND_Y - 90,   // 월드 좌표
      planted: false, camY: 0,
      best: 0, paidM: 0, peak: 0,   // 높이(m)
      fallFresh: 0, recoverAcc: 0,
      falls: 0, maxDrop: 0, cleared: false,
      restT: 0, stillT: 0, lastH: 0, nagT: 0,
      donT: 9 + Math.random() * 7, chatT: 3, mileIdx: 0,
      dust: [],
    };
    var MILES = [1000, 5000, 15000, 60000, 150000];
    var panel = stage.panel;

    var heightM = function () { return Math.max(0, (GROUND_Y - PR - st.py) / PX_PER_M); };

    stage.hud('⏱ 방송 <b id="guTime">3:00</b> · 최고 <b id="guBest">0.0</b>m · 추락 <b id="guFalls">0</b>회');
    panel.innerHTML =
      '<div class="climbbar">' +
        '<div class="cell"><div class="lab">현재 높이</div><div class="val" id="guH">0.0m</div></div>' +
        '<div class="cell"><div class="lab">최고 높이</div><div class="val" id="guB">0.0m</div></div>' +
        '<div class="cell"><div class="lab">추락 신선도</div><div class="val" id="guF">100%</div></div>' +
        '<div class="hint">마우스로 <b>망치</b>를 움직인다. 망치 끝을 바위에 걸고 밀어서 올라가라.<br>' +
        '조금씩 오르면 조금 번다. <b>크게 떨어지면 왕창 번다</b> — 그게 이 게임이 방송되는 이유다.</div>' +
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

    // ---------- 물리 스텝 ----------
    function resolveBody() {
      var hit = false;
      for (var pass = 0; pass < 3; pass++) {
        for (var i = 0; i < LEDGES.length; i++) {
          var r = LEDGES[i];
          var cx = clamp(st.px, r.x, r.x + r.w), cy = clamp(st.py, r.y, r.y + r.h);
          var dx = st.px - cx, dy = st.py - cy, d2 = dx * dx + dy * dy;
          if (d2 >= PR * PR) continue;
          hit = true;
          var d = Math.sqrt(d2), nx, ny;
          if (d > .0001) { nx = dx / d; ny = dy / d; }
          else { // 중심이 완전히 박힘 — 최소 관통축으로
            var o = pushOut(st.px, st.py, r);
            nx = Math.sign(o.x - st.px) || 0; ny = Math.sign(o.y - st.py) || -1;
            d = 0;
          }
          st.px += nx * (PR - d); st.py += ny * (PR - d);
          // 법선 성분 제거 + 접선 마찰 (튕기지 않는다 — 원작도 거의 안 튄다)
          var vn = st.vx * nx + st.vy * ny;
          if (vn < 0) { st.vx -= vn * nx; st.vy -= vn * ny; }
          st.vx *= .86; st.vy *= .96;
        }
      }
      return hit;
    }

    function physics(dt) {
      var prevX = st.px, prevY = st.py;

      // 마우스 방향으로 망치를 뻗는다 (길이 고정)
      var dx = st.mx - st.px, dy = st.my - st.py;
      var len = Math.hypot(dx, dy) || 1;
      var dirX = dx / len, dirY = dy / len;
      var wantX = st.px + dirX * HAMMER_LEN, wantY = st.py + dirY * HAMMER_LEN;

      var rect = pointInSolid(wantX, wantY);
      if (rect) {
        // 망치 끝이 바위 안 → 끝은 표면에 머물고, 대신 몸이 밀린다 (장대높이뛰기)
        var surf = pushOut(wantX, wantY, rect);
        var tX = surf.x - dirX * HAMMER_LEN, tY = surf.y - dirY * HAMMER_LEN;
        var mdx = tX - st.px, mdy = tY - st.py, m = Math.hypot(mdx, mdy);
        if (m > MAX_STEP) { mdx = mdx / m * MAX_STEP; mdy = mdy / m * MAX_STEP; }
        st.px += mdx; st.py += mdy;
        st.tipX = surf.x; st.tipY = surf.y;
        st.planted = true;
        if (m > 3) sfxSlide();
      } else {
        st.tipX = wantX; st.tipY = wantY;
        st.planted = false;
        st.vy += GRAV * dt;
        st.px += st.vx * dt; st.py += st.vy * dt;
      }

      if (resolveBody() && !st.planted && Math.abs(st.vy) > 250) sfxHit();
      st.px = clamp(st.px, PR, W - PR);
      st.py = Math.min(st.py, GROUND_Y - PR + 40);

      if (st.planted) {
        // 밀린 만큼이 곧 속도 — 손을 떼는 순간 이 속도로 날아간다 (플릭)
        var k = .55;
        st.vx = st.vx * (1 - k) + (st.px - prevX) / dt * k;
        st.vy = st.vy * (1 - k) + (st.py - prevY) / dt * k;
      }
      st.vx = clamp(st.vx, -MAX_V, MAX_V); st.vy = clamp(st.vy, -MAX_V, MAX_V);
    }

    // ---------- 시청자 경제 ----------
    function payClimb() {
      // 신기록 높이는 1m 단위로 정산. 위로 갈수록 1m의 값이 오른다.
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

    stage.ticker('방송 시작! 망치로 절벽을 올라라', false);
    renderPanel();

    return {
      step: function (dt) {
        var e = document.getElementById('guTime');
        if (e) e.textContent = U.fmtTime(stage.timeLeft);

        physics(dt);
        var h = heightM();
        st.camY = clamp(st.py - 250, 0, WORLD_H - VH);

        // 정상
        if (!st.cleared && st.py < SUMMIT_Y + 6 && st.px > 350 && st.px < 550) {
          st.cleared = true;
          var g = stage.gain(60000, '정상 등반!!!');
          stage.stamp('정상 등반'); stage.flash(.5); sfxTop();
          stage.emit('summit', { gain: g.toLocaleString() });
          setTimeout(function () { stage.end('clear'); }, 1400);
          return;
        }

        // 신기록 높이
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

        // 추락 판정 — "떨어지는 중"이 아니라 "떨어져서 멈췄을 때" 한 번만 친다
        var speed = Math.hypot(st.vx, st.vy);
        st.restT = speed < 45 ? st.restT + dt : 0;
        if (st.restT > .18 && st.peak - h >= 2) {
          onFall(st.peak - h);
          st.peak = h;
        }

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

        // 양념 (규약 5)
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
      },

      pointer: function (p) { st.mx = p.x; st.my = p.y + st.camY; },

      summary: function () {
        return [
          ['최고 높이', st.best.toFixed(1) + 'm' + (st.cleared ? ' (정상!)' : '')],
          ['추락 횟수', st.falls + '회'],
          ['최대 낙차', st.maxDrop.toFixed(1) + 'm'],
        ];
      },

      dispose: function () {},

      draw: function (ctx, dt) {
        var cam = st.camY;
        ctx.save();
        ctx.translate(0, -cam);
        drawCliff(ctx, cam);
        drawLedges(ctx, cam);
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
      // 배경 암벽 결 — 고정 패턴이라 스크롤이 눈에 보인다
      ctx.strokeStyle = 'rgba(120,140,170,.07)'; ctx.lineWidth = 2;
      for (var y = Math.floor(cam / 70) * 70; y < cam + VH + 70; y += 70) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (var x = 0; x <= W; x += 120) ctx.lineTo(x, y + Math.sin(x * .013 + y * .05) * 16);
        ctx.stroke();
      }
      // 정상 근처는 하늘빛이 든다
      if (cam < 420) {
        var s = ctx.createLinearGradient(0, 120, 0, 520);
        s.addColorStop(0, 'rgba(120,170,220,.20)'); s.addColorStop(1, 'rgba(120,170,220,0)');
        ctx.fillStyle = s; ctx.fillRect(0, 120, W, 400);
      }
    }

    function drawLedges(ctx, cam) {
      LEDGES.forEach(function (r) {
        if (r.hidden) return;
        if (r.y > cam + VH || r.y + r.h < cam) return;
        var g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, '#6b6155'); g.addColorStop(.3, '#4a423a'); g.addColorStop(1, '#2b2621');
        ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = 'rgba(220,210,190,.22)'; ctx.fillRect(r.x, r.y, r.w, 3);
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(r.x, r.y + r.h - 3, r.w, 3);
      });
      // 정상 깃발
      ctx.strokeStyle = '#cfc7b8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(450, SUMMIT_Y); ctx.lineTo(450, SUMMIT_Y - 46); ctx.stroke();
      ctx.fillStyle = '#ffb447';
      ctx.beginPath(); ctx.moveTo(450, SUMMIT_Y - 46); ctx.lineTo(492, SUMMIT_Y - 36); ctx.lineTo(450, SUMMIT_Y - 26); ctx.closePath(); ctx.fill();
    }

    function drawClimber(ctx) {
      var x = st.px, y = st.py;
      // 망치 자루
      ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y - 16); ctx.lineTo(st.tipX, st.tipY); ctx.stroke();
      // 망치 머리
      var a = Math.atan2(st.tipY - (y - 16), st.tipX - x);
      ctx.save(); ctx.translate(st.tipX, st.tipY); ctx.rotate(a);
      ctx.fillStyle = st.planted ? '#ffd27a' : '#9aa0a8';
      ctx.fillRect(-6, -9, 18, 18);
      ctx.strokeStyle = '#14161a'; ctx.lineWidth = 2; ctx.strokeRect(-6, -9, 18, 18);
      ctx.restore();
      // 상체
      ctx.fillStyle = '#d8c6a8';
      ctx.beginPath(); ctx.arc(x, y - 26, 8, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#d8c6a8'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 8); ctx.stroke();
      // 팔 — 망치를 향해
      ctx.beginPath(); ctx.moveTo(x, y - 16);
      ctx.lineTo(x + Math.cos(a) * 26, y - 16 + Math.sin(a) * 26); ctx.stroke();
      // 항아리
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

    function drawRuler(ctx) {
      // 높이 눈금 — 스크롤 중 지금 어디인지 알 수 있게 (화면 고정)
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
      // 최고 기록선
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
    foot: '<b>마우스</b>로 망치를 움직인다 — 망치 끝을 바위에 걸고 밀어내면 몸이 딸려 올라간다. 키보드는 쓰지 않는다.<br>' +
          '큰 추락일수록 시청자가 폭증하지만 <b>반복하면 물린다</b>(추락 신선도) — 회복하려면 더 높이 올라가야 한다 · 멈춰 있으면 조용히 시청자를 잃는다',
    start: start,
  });
})();
