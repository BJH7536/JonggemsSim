/* 화력쇼 — 수습 윈도우. prototypes/05-hwaryeok-show.html의 이식본.
 *
 * ⚠ 밸런스는 critic 4차 승인본이다 (05-hwaryeok-spec.md). 상수·산식은 손대지 않는다.
 *   셸 이식으로 달라진 것은 소유권뿐:
 *     - 시청자 수·FX 큐·스탬프·티커·연쇄 미터·방송 시계 → 셸 (stage.*)
 *     - 게임 단위 신선도 배수는 셸이 stage.gain() 안에서 곱한다. 첫 방송은 ×1.0이라
 *       승인된 밸런스와 수치가 완전히 동일하다. 물린 방송이 느려지는 건 규약 4의 의도.
 *     - 사고 유형별 신선도(아래 fresh[])는 화력쇼 내부 메커닉이라 그대로 게임이 소유한다.
 *   원본에 있던 addViewers()의 언락 검사는 step()의 매 프레임 검사로 대체했다 —
 *   획득 경로가 늘어도 누락될 수 없다 (원본 H-1 수정의 상위호환).
 */
(function () {
  'use strict';

  var U = Shell.util, clamp = U.clamp, rnd = U.rnd, TAU = U.TAU;
  var sfx = Shell.sfx;

  // ================= 상수 (p02 원본 코어 유지) =================
  var SHOW_TIME = 180;
  var START_VIEWERS = 300;

  // 모드 선택 UI는 없다 — 화구에 팬을 올리면 자동으로 현재 등급이 붙는다.
  // '정석'(×1.0)은 제외: 사고를 피하는 선택지는 이 게임의 반대말이다.
  var MODES = [
    { n: '속성', rate: 0.25, mul: 1.8 },
    { n: '무모', rate: 0.60, mul: 3.2 }, // 90,000명 언락 후 자동 승격
  ];
  var ACC = [
    { n: '팬 과열',    win: 2.5, ok: 180, fail: '요리 손실' },
    { n: '소금 과다',  win: 4.0, ok: 240, fail: '맛 등급 하락' },
    { n: '기름 화재',  win: 1.2, ok: 900, fail: '대참사', catastrophic: true },
    { n: '칼 미끄러짐', win: 0.8, ok: 350, fail: '재료 손실' },
  ];
  var DISHES = [
    { n: '볶음밥', c: '#d8a24a' }, { n: '스테이크', c: '#7a3b2e' }, { n: '파스타', c: '#e0c060' },
    { n: '튀김', c: '#c98a3a' }, { n: '수프', c: '#c96a4a' }, { n: '전골', c: '#a05a3a' },
  ];
  // 규약 4 — 사고 유형별 신선도 감쇠: 같은 사고 반복 수습은 물린다
  var FRESH_MULT = [1, .7, .45, .25, .1];
  // 규약 1 — 시청자가 언락 통화 (critic 최종 룰셋 순차 이진 탐색치)
  var UNLOCKS = [
    { at: 30000,  key: 'b3',    label: '화구 3 개방!' },
    { at: 90000,  key: 'mode3', label: "'무모' 모드 해금!" },
    { at: 350000, key: 'b4',    label: '화구 4 개방!' },
  ];
  var CHAT_MILES = [1000, 5000, 15000, 60000, 150000, 500000]; // 언락 임계와 겹치지 않게

  var BX = [150, 370, 590, 810];
  var COUNTER_Y = 285;

  // ---------- AetherAI 생성 아트 (tools/aether-assets.json) ----------
  // 배경 벽 플레이트·팬·클로슈. 없거나 로드 전이면 기존 벡터로 폴백 — 아트는 얹는 층이다.
  // 조명 콘·가스 불꽃·김·사고 연출은 계속 절차적으로 그린다: 깜빡임이 곧 방송의 생동감이라
  // 정지 이미지로 바꾸면 죽는다. 이미지가 맡는 건 "정물"뿐이다.
  // 파싱 시점이 아니라 방송 준비(카운트다운) 때 내려받는다 — 첫 화면 payload 절약.
  // 그래도 늦은 프레임은 imgReady 폴백(벡터)이 그대로 받는다. 재호출은 no-op.
  var IMG = {};
  function loadArt() {
    if (IMG.pan) return;
    [['studio-bg', 'jpg'], ['pan', 'png'], ['cloche', 'png']].forEach(function (e) {
      var im = new Image();
      im.src = 'games/hwaryeok/img/' + e[0] + '.' + e[1];
      IMG[e[0]] = im;
    });
    // 이모지 대체 미니 아이콘 — 셸 공용 AetherAI 생성물 재사용
    ['ui-lock', 'ui-wrench'].forEach(function (n) {
      var im = new Image(); im.src = 'games/shell/img/' + n + '.png'; IMG[n] = im;
    });
  }
  function imgReady(n) { var im = IMG[n]; return im && im.complete && im.naturalWidth > 0; }
  // 팬 스프라이트에서 팬 몸통(볼)의 중심이 가로 어디쯤인가 — 손잡이가 오른쪽이라 중심이
  // 왼쪽으로 치우친다. 내용물 타원은 몸통 중심(x)에 그려지므로 이 값으로 정렬한다.
  var PAN_BOWL_CX = 0.38;

  // ================= SFX =================
  var sfxIgnite = function () { if (!sfx.gate('ig')) return; sfx.noise(.18, .08, 900); sfx.tone(140, .15, 'sine', .06); };
  var sfxAlarm  = function () { if (!sfx.gate('al')) return; sfx.tone(880, .09, 'square', .07); sfx.tone(880, .09, 'square', .07, .14); };
  var sfxFix    = function () { if (!sfx.gate('fx')) return; sfx.tone(523, .09, 'triangle', .1); sfx.tone(659, .1, 'triangle', .1, .07); sfx.tone(784, .16, 'triangle', .1, .14); };
  var sfxBoom   = function () { if (!sfx.gate('bm')) return; sfx.noise(.4, .22, 220); sfx.tone(60, .35, 'sine', .18); };
  var sfxDone   = function () { if (!sfx.gate('dn')) return; sfx.tone(660, .1, 'sine', .06); sfx.tone(880, .14, 'sine', .05, .08); };
  var sfxDon    = function () { if (!sfx.gate('do')) return; sfx.tone(1180, .08, 'sine', .07); sfx.tone(1567, .1, 'sine', .055, .05); };
  var sfxUnlock = function () { if (!sfx.gate('ul')) return; sfx.tone(523, .1, 'triangle', .1); sfx.tone(659, .1, 'triangle', .1, .09); sfx.tone(784, .1, 'triangle', .1, .18); sfx.tone(1047, .22, 'triangle', .11, .27); };

  function start(stage) {
    loadArt(); // 셸이 preload를 안 불렀어도 (구버전 셸) 여기서라도 건다
    var st = {
      chain: 1, chainT: 0, maxChain: 1,
      recOK: 0, recTry: 0, done: 0, disaster: 0,
      fresh: [0, 0, 0, 0], freshRec: [0, 0, 0, 0], lastAccType: -1,
      unlocked: { b3: false, mode3: false, b4: false },
      donT: 8 + Math.random() * 7, chatT: 2.5, mileIdx: 0,
      burners: [0, 1, 2, 3].map(function (i) {
        return { i: i, on: i < 2, broken: 0, dish: null, mode: null, p: 0, acc: null };
      }),
    };
    var scene = { steam: [], bursts: [], soot: [] };
    var panel = stage.panel;

    function spawnBurst(type, x, y) { scene.bursts.push({ type: type, x: x, y: y, born: stage.now }); }

    // ---------- HUD ----------
    stage.hud('⏱ 방송 <b id="hwTime">3:00</b> · 수습 <b id="hwRec">0/0</b> · ' +
              '완성 <b id="hwDone">0</b> · 참사 <b id="hwDis">0</b>');
    function renderHUD() {
      var e;
      if ((e = document.getElementById('hwRec'))) e.textContent = st.recOK + '/' + st.recTry;
      if ((e = document.getElementById('hwDone'))) e.textContent = st.done;
      if ((e = document.getElementById('hwDis'))) e.textContent = st.disaster;
      stage.setChain(st.chain);
    }

    // ---------- 화구 조작 스트립 ----------
    function buildStrip() {
      panel.innerHTML = '<div class="strip4">' + st.burners.map(function (b) {
        return '<div class="bcol" id="hwcol' + b.i + '" data-act="press" data-b="' + b.i + '"></div>';
      }).join('') + '</div>';
      st.burners.forEach(function (b) { buildCol(b.i); });
    }
    function buildCol(i) {
      var b = st.burners[i], el = document.getElementById('hwcol' + i);
      if (!el) return;
      el.className = 'bcol' + (b.acc ? ' hot' : '') + (!b.on ? ' locked' : '');
      if (!b.on) {
        var need = i === 2 ? 30000 : 350000;
        el.innerHTML = '<div class="bnum">화구 ' + (i + 1) + '</div>' +
          '<div class="bhint" style="margin-top:22px"><img class="uiIco lock" src="games/shell/img/ui-lock.png" alt=""> 시청자 <b>' + need.toLocaleString() + '명</b> 달성 시 개방</div>';
        return;
      }
      if (b.broken > 0) {
        el.innerHTML = '<div class="bnum">화구 ' + (i + 1) + '</div>' +
          '<div class="bdish" style="color:#9a9184"><img class="uiIco lock" src="games/shell/img/ui-wrench.png" alt=""> 수리 중</div>' +
          '<div class="bhint">대참사 여파 — <b><span id="hwrep' + i + '">' + b.broken.toFixed(1) + '</span>초</b> 후 복구</div>';
        return;
      }
      if (!b.dish) {
        var m = curMode();
        el.innerHTML = '<div class="bnum">화구 ' + (i + 1) + '</div>' +
          '<div class="bdish" style="color:#ffb447">' + (i + 1) + ' — 팬 올리기</div>' +
          '<div class="bhint">' + m.n + ' · 수입 ×' + m.mul + ' · 사고율 ' + Math.round(m.rate * 100) + '%' +
          '<br>빈 화구는 시청자가 샌다</div>';
        return;
      }
      var accHtml = '';
      if (b.acc) {
        var a = ACC[b.acc.ti], fm = FRESH_MULT[st.fresh[b.acc.ti]];
        accHtml = '<div class="accname">⚠ ' + a.n + ' <span class="accfresh">신선도 ' + Math.round(fm * 100) + '%</span></div>' +
          '<div class="win"><i id="hwwin' + i + '" style="width:100%"></i></div>' +
          '<button class="fixbtn" id="hwfix' + i + '">' + (i + 1) + ' — 수습! ×1.0</button>';
      }
      el.innerHTML = '<div class="bnum">화구 ' + (i + 1) + '</div>' +
        '<div class="bdish">' + b.dish.n + '</div>' +
        '<div class="bmode">' + b.mode.n + ' · 수입 ×' + b.mode.mul + '</div>' +
        '<div class="prog"><i id="hwprog' + i + '" style="width:' + Math.round(b.p * 100) + '%"></i></div>' +
        (accHtml || '<div class="bhint" style="margin-top:10px">조리 중… <b>' + (i + 1) + '</b> 누르면 팬을 내린다</div>');
    }
    function onPanelClick(e) {
      var t = e.target.closest('[data-act="press"]');
      if (!t || !stage.live) return;
      press(+t.dataset.b);
    }
    panel.addEventListener('click', onPanelClick);

    // ---------- 언락 (규약 1) ----------
    function checkUnlocks() {
      var fired = [];
      UNLOCKS.forEach(function (u) {
        if (!st.unlocked[u.key] && stage.viewers >= u.at) {
          st.unlocked[u.key] = true;
          if (u.key === 'b3') st.burners[2].on = true;
          if (u.key === 'b4') st.burners[3].on = true;
          fired.push(u.label);
        }
      });
      if (fired.length) { // 동시 발동 시 스탬프·SFX·재구성은 1회로 합침 (M-3)
        stage.stamp(fired.join(' · '));
        sfxUnlock();
        stage.flash(.3);
        buildStrip();
        stage.emit('unlock', { label: fired.join(' · ') });
      }
    }

    // ---------- 조리 ----------
    function curMode() { return st.unlocked.mode3 ? MODES[1] : MODES[0]; }

    // 번호 키 = 화구 하나의 유일한 조작. 상태가 무엇을 할지 정한다:
    // 사고 중이면 수습, 조리 중이면 팬 내림(오조작 페널티), 비었으면 팬 올림.
    function press(i) {
      var b = st.burners[i];
      if (!b || !b.on || b.broken > 0 || !stage.live) return;
      if (b.acc) fix(i);
      else if (b.dish) pullPan(b);
      else startDish(i);
    }
    function startDish(i) {
      var b = st.burners[i];
      b.dish = DISHES[rnd(0, DISHES.length - 1)];
      b.mode = curMode(); b.p = 0; b.acc = null;
      sfxIgnite();
      buildCol(i);
    }
    function pullPan(b) { // 규약 2 — 손실은 연출하지 않는다. 조용히 사라진다
      stage.ticker('화구 ' + (b.i + 1) + ' — 팬을 내렸다 (' + b.dish.n + ' 폐기)', true);
      b.dish = null; b.mode = null; b.p = 0;
      buildCol(b.i);
    }
    function completeDish(b) {
      var gain = Math.round(40 * b.mode.mul);
      // 소액 — FX 큐는 쓰지 않고 접시 연출 + 티커로만 (사고 없는 완성은 시시하다)
      var actual = stage.gain(gain, null, 'done'); // 신선도 적용 후 실제 반영량으로 표시
      st.done++;
      spawnBurst('plate', BX[b.i], 268);
      sfxDone();
      stage.ticker(b.dish.n + ' 완성 +' + actual + ' (사고 없음)', false);
      if (Math.random() < .6) stage.emit('done', { dish: b.dish.n }); // 무사고 완성엔 채팅도 미지근하다
      b.dish = null; b.mode = null; b.p = 0;
      renderHUD(); buildCol(b.i);
    }

    // ---------- 사고·수습·대참사 (코어) ----------
    function spawnAccident(b) {
      // 사고는 반복되는 경향 (critic H3): 직전 유형 2.2배 가중 — 같은 사고의 연속이 실제로
      // 생겨야 신선도 감쇠가 막을 "파밍"이 존재한다
      var w = [1, 1, 1, 1];
      if (st.lastAccType >= 0) w[st.lastAccType] = 2.2;
      var totalW = w[0] + w[1] + w[2] + w[3];
      var r = Math.random() * totalW, ti = 0;
      while (r >= w[ti]) { r -= w[ti]; ti++; }
      st.lastAccType = ti;
      b.acc = { ti: ti, at: ACC[ti].win, win: ACC[ti].win };
      sfxAlarm();
      stage.ticker('화구 ' + (b.i + 1) + ' — ' + ACC[ti].n + ' 발생!', false);
      // oilfire는 acc가 항상 '기름 화재'라 슬롯에서 뺀다 — 어휘의 oilfire 템플릿은 {b}만 쓰므로
      // acc까지 넘기면 검증 게이트(모든 슬롯 포함)가 사실 줄을 확률적으로 폐기한다 (관객 리뷰)
      stage.emit(ACC[ti].catastrophic ? 'oilfire' : 'accident',
        ACC[ti].catastrophic ? { b: b.i + 1 } : { b: b.i + 1, acc: ACC[ti].n });
      buildCol(b.i);
    }
    function fix(i) {
      if (!stage.live) return;
      var b = st.burners[i];
      if (!b || !b.acc) return;
      var a = ACC[b.acc.ti];
      st.recTry++; st.recOK++;
      // 유형 배율 (critic 4차 확정): 실사용 구간(윈도우−0.4초) 기준 정규화 — 배율은 사고 유형이
      // 정한다. 짧은 창(칼 0.8s)은 즉시 수습만으로 ×2.3, 긴 창(소금 4.0s)은 대기해야 오르지만
      // 대기는 처리량 손실로 항상 손해(전략 스윕 −45%) — "빠른 반응이 정답"이 의도된 구조.
      var usable = Math.max(0.2, b.acc.win - 0.4);
      var close = 1 + 1.5 * clamp((b.acc.win - b.acc.at) / usable, 0, 1);
      // 신선도 (규약 4): 회복은 타 유형 "2회 수습당" 1단계 — 매회 회복하면 감쇠가 0으로
      // 수렴해 규약이 형해화된다 (critic H1: 평균 감쇠 0.866 → 0.611)
      var fm = FRESH_MULT[st.fresh[b.acc.ti]];
      st.fresh[b.acc.ti] = Math.min(4, st.fresh[b.acc.ti] + 1);
      st.freshRec[b.acc.ti] = 0;
      for (var k = 0; k < 4; k++) if (k !== b.acc.ti) {
        if (++st.freshRec[k] >= 2) { st.freshRec[k] = 0; st.fresh[k] = Math.max(0, st.fresh[k] - 1); }
      }
      var gain = Math.max(1, Math.round(a.ok * st.chain * b.mode.mul * close * fm));
      var prevChain = st.chain;
      st.chain = Math.min(3, st.chain + .5); st.chainT = 5;
      st.maxChain = Math.max(st.maxChain, st.chain);
      var actual = stage.gain(gain, close >= 1.9 ? '고배율 수습 ×' + close.toFixed(1) : '수습 성공',
        close >= 1.9 ? 'rescue_big' : 'rescue');
      stage.emit(close >= 1.9 ? 'rescue_big' : 'rescue', { gain: actual.toLocaleString() });
      if (st.chain >= 3 && prevChain < 3) stage.emit('chain3');
      spawnBurst('fixflash', BX[i], 270);
      stage.flash(.22); stage.shake(5);
      sfxFix();
      b.acc = null;
      renderHUD(); buildCol(i);
    }
    function accidentExpire(b) {
      var a = ACC[b.acc.ti];
      st.recTry++;
      if (a.catastrophic) { // 대참사 — 시청자는 폭등(과연출), 화구는 12초 파손(기회비용)
        var g = Math.round(1400 * st.chain);
        st.disaster++;
        spawnBurst('boom', BX[b.i], 270);
        if (scene.soot.indexOf(b.i) < 0) scene.soot.push(b.i); // 그을음 중복 누적 방지 (L-1)
        stage.shake(16); stage.flash(.5);
        sfxBoom();
        var actual = stage.gain(g, '대참사!!', 'disaster');
        b.broken = 12;
        stage.ticker('대참사 — ' + a.n + '! 화구 ' + (b.i + 1) + ' 파손', false);
        stage.emit('disaster', { gain: actual.toLocaleString() });
      } else { // 일반 실패 — 숫자만 조용히 (규약 2: 무연출·무효과음, 채팅도 마른 1줄만)
        stage.lose(120);
        stage.ticker(a.n + ' 실패 — ' + a.fail + ' −120', true);
        stage.emit('fail', { acc: a.n });
      }
      // (M6 연쇄 리셋은 4차 검증에서 롤백 — 원본 p02에도 실패 리셋은 없다)
      b.dish = null; b.mode = null; b.acc = null; b.p = 0;
      renderHUD(); buildCol(b.i);
    }

    // ---------- 잡담 ----------
    function ambientChat(emptyCount) { // 소재: 마일스톤 > 빈 화구 잔소리 > 일반
      if (st.mileIdx < CHAT_MILES.length && stage.viewers >= CHAT_MILES[st.mileIdx]) {
        stage.emit('milestone', { v: CHAT_MILES[st.mileIdx++].toLocaleString() });
        return;
      }
      if (emptyCount > 0 && Math.random() < .45) {
        var b = st.burners.filter(function (b) { return b.on && !b.dish && b.broken <= 0; })[0];
        if (b) { stage.emit('nag', { b: b.i + 1 }); return; }
      }
      stage.emit('idle');
    }

    buildStrip();
    renderHUD();
    stage.ticker('방송 시작! 1~4 키로 화구에 팬을 올려라', false);

    // ================= 인스턴스 =================
    return {
      step: function (dt) {
        var e = document.getElementById('hwTime');
        if (e) e.textContent = U.fmtTime(stage.timeLeft);

        if (st.chainT > 0) { st.chainT -= dt; if (st.chainT <= 0) { st.chain = 1; renderHUD(); } }

        // 양념 (규약 5): 랜덤 도네는 드물게, 규모 비례 1~3% 최소 10명 (critic L5)
        st.donT -= dt;
        if (st.donT <= 0) {
          st.donT = 8 + Math.random() * 7;
          if (Math.random() < .5) {
            var d = Math.max(10, Math.round(stage.viewers * (0.01 + Math.random() * 0.02)));
            var actual = stage.gain(d, '익명의 도네', 'donation'); sfxDon();
            stage.emit('donation', { d: actual.toLocaleString() });
          }
        }

        var emptyCount = 0;
        for (var bi = 0; bi < st.burners.length; bi++) {
          var b = st.burners[bi];
          if (!b.on) continue;
          if (b.broken > 0) {
            emptyCount++; // 파손 화구도 방치다 — 이탈 면제 없음 (critic L2)
            b.broken -= dt;
            var rep = document.getElementById('hwrep' + b.i);
            if (rep) rep.textContent = Math.max(0, b.broken).toFixed(1);
            if (b.broken <= 0) { b.broken = 0; buildCol(b.i); }
            continue;
          }
          if (!b.dish) { emptyCount++; continue; }

          if (b.acc) {
            b.acc.at -= dt;
            var w = document.getElementById('hwwin' + b.i);
            if (w) w.style.width = Math.max(0, b.acc.at / b.acc.win * 100) + '%';
            var fb = document.getElementById('hwfix' + b.i); // 유형 배율 실시간 표시 (critic L3)
            if (fb) {
              var usable = Math.max(0.2, b.acc.win - 0.4);
              var cl = 1 + 1.5 * clamp((b.acc.win - Math.max(0, b.acc.at)) / usable, 0, 1);
              fb.textContent = (b.i + 1) + ' — 수습! ×' + cl.toFixed(1);
            }
            if (b.acc.at <= 0) {
              accidentExpire(b);
              if (!stage.live) return; // 수습 실패 −120으로 방송이 끝났으면 루프 중단 (H-2)
            }
            continue;
          }

          b.p += dt / 12;
          var pr = document.getElementById('hwprog' + b.i);
          if (pr) pr.style.width = Math.round(clamp(b.p, 0, 1) * 100) + '%';
          if (Math.random() < b.mode.rate * dt * 0.9) { spawnAccident(b); continue; }
          if (b.p >= 1) completeDish(b);
        }

        checkUnlocks(); // 획득 경로와 무관하게 매 프레임 — 누락 불가 (원본 H-1)

        // AI 시청자 잡담 — 빈도는 시청자 규모에 비례해 빨라진다. 연출 전용, 수치는 읽기만 (C3)
        st.chatT -= dt;
        if (st.chatT <= 0) {
          st.chatT = clamp(3.6 - Math.log10(stage.viewers + 10) * .55, 1.1, 3.6) + Math.random() * 1.4;
          ambientChat(emptyCount);
        }
        // 정체는 가장 빠르게 잃는다 — 빈·파손 화구당 초당 0.5%(최소 1명), 조용히
        // (규약 2, critic M7: 정액 −1/s는 후반 규모에서 무의미해 체력 역할이 형해화된다)
        if (emptyCount > 0) stage.lose(emptyCount * Math.max(1, stage.viewers * 0.005) * dt);
      },

      key: function (e) {
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= 4) press(n - 1);
      },

      summary: function () {
        var rate = st.recTry ? Math.round(st.recOK / st.recTry * 100) : 0;
        return [
          ['수습 성공률', st.recOK + ' / ' + st.recTry + ' (' + rate + '%)'],
          ['최고 연쇄', '×' + st.maxChain.toFixed(1)],
          ['완성 / 대참사', st.done + ' / ' + st.disaster],
        ];
      },

      dispose: function () { panel.removeEventListener('click', onPanelClick); },

      // ================= 캔버스 씬 =================
      draw: function (ctx, dt) {
        var t = stage.now;
        drawStudio(ctx, t);
        for (var i = 0; i < st.burners.length; i++) drawBurner(ctx, st.burners[i], t);
        drawSteam(ctx, dt, t);
        drawBursts(ctx, t);
      },
    };

    function drawStudio(ctx, t) {
      // 벽+선반 정물은 AetherAI 플레이트로. 없으면 기존 그라디언트+실루엣 폴백.
      if (imgReady('studio-bg')) {
        var bi = IMG['studio-bg'];
        // cover — 세로를 COUNTER_Y에 맞추고 가로 중앙 크롭
        var sc = Math.max(960 / bi.naturalWidth, COUNTER_Y / bi.naturalHeight);
        var dw = bi.naturalWidth * sc, dh = bi.naturalHeight * sc;
        ctx.drawImage(bi, (960 - dw) / 2, (COUNTER_Y - dh) / 2, dw, dh);
      } else {
      var bg = ctx.createLinearGradient(0, 0, 0, COUNTER_Y);
      bg.addColorStop(0, '#f2e8d5'); bg.addColorStop(1, '#e8d8b8');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, 960, COUNTER_Y);
      ctx.fillStyle = '#d8c8a8'; ctx.fillRect(0, 96, 960, 7);
      ctx.fillStyle = '#c8b494';
      [[120, 70], [250, 62], [700, 66], [830, 74]].forEach(function (p) { ctx.fillRect(p[0], 96 - p[1], 34, p[1]); });
      }
      [300, 660].forEach(function (lx) {
        ctx.fillStyle = '#5a4a3a';
        ctx.beginPath(); ctx.moveTo(lx - 26, 30); ctx.lineTo(lx + 26, 30); ctx.lineTo(lx + 16, 52); ctx.lineTo(lx - 16, 52); ctx.closePath(); ctx.fill();
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var fl = 1 + .05 * Math.sin(t * 9 + lx);
        var g = ctx.createRadialGradient(lx, 54, 4, lx, 54, 40 * fl);
        g.addColorStop(0, 'rgba(255,220,150,.8)'); g.addColorStop(1, 'rgba(255,200,100,0)');
        ctx.fillStyle = g; ctx.fillRect(lx - 44, 14, 88, 88);
        var cone = ctx.createRadialGradient(lx, 60, 20, lx, 300, 340);
        cone.addColorStop(0, 'rgba(255,210,140,.13)'); cone.addColorStop(1, 'rgba(255,210,140,0)');
        ctx.fillStyle = cone; ctx.fillRect(lx - 340, 40, 680, 380);
        ctx.restore();
      });
      var stg = ctx.createLinearGradient(0, COUNTER_Y - 20, 0, COUNTER_Y + 42);
      stg.addColorStop(0, '#eef1f4'); stg.addColorStop(.25, '#c4ccd4'); stg.addColorStop(1, '#98a2ac');
      ctx.fillStyle = stg; ctx.fillRect(0, COUNTER_Y - 20, 960, 62);
      ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(0, COUNTER_Y - 20, 960, 3);
      var fr = ctx.createLinearGradient(0, COUNTER_Y + 42, 0, 430);
      fr.addColorStop(0, '#c89860'); fr.addColorStop(1, '#a87840');
      ctx.fillStyle = fr; ctx.fillRect(0, COUNTER_Y + 42, 960, 430 - COUNTER_Y - 42);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0, COUNTER_Y + 42, 960, 4);
      scene.soot.forEach(function (i) {
        ctx.fillStyle = 'rgba(40,32,24,.3)';
        ctx.beginPath(); ctx.ellipse(BX[i], COUNTER_Y + 6, 58, 13, 0, 0, TAU); ctx.fill();
      });
    }

    function drawBurner(ctx, b, t) {
      var x = BX[b.i];
      ctx.fillStyle = '#1a1d22';
      ctx.beginPath(); ctx.ellipse(x, COUNTER_Y + 2, 46, 15, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#0d0f12'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#101318';
      ctx.beginPath(); ctx.ellipse(x, COUNTER_Y + 1, 34, 10, 0, 0, TAU); ctx.fill();

      if (!b.on) { // 잠금: 클로슈 덮개
        if (imgReady('cloche')) {
          var ci = IMG['cloche'], cw = 92, ch = cw * ci.naturalHeight / ci.naturalWidth;
          ctx.drawImage(ci, x - cw / 2, COUNTER_Y + 4 - ch, cw, ch);
        } else {
        ctx.fillStyle = '#3a3f46';
        ctx.beginPath(); ctx.ellipse(x, COUNTER_Y - 16, 40, 26, 0, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = '#14161a'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#565c64'; ctx.beginPath(); ctx.arc(x, COUNTER_Y - 42, 5, 0, TAU); ctx.fill();
        }
        if (imgReady('ui-lock')) ctx.drawImage(IMG['ui-lock'], x - 8, COUNTER_Y - 66, 16, 16);
        else { ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🔒', x, COUNTER_Y - 52); }
        return;
      }
      if (b.broken > 0) { // 파손: 연기 + 수리 아크
        if (Math.random() < .3) scene.steam.push({ x: x + rnd(-20, 20), y: COUNTER_Y - 8, vy: -(14 + Math.random() * 12), a: .35, r: 5 + Math.random() * 6, smoke: true });
        ctx.strokeStyle = 'rgba(255,180,71,.7)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(x, COUNTER_Y - 14, 26, -Math.PI / 2, -Math.PI / 2 + (1 - b.broken / 12) * TAU); ctx.stroke();
        if (imgReady('ui-wrench')) ctx.drawImage(IMG['ui-wrench'], x - 8, COUNTER_Y - 22, 16, 16);
        else { ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🔧', x, COUNTER_Y - 8); }
        return;
      }
      if (!b.dish) return;

      // 가스 불꽃 (모드별 색·세기)
      var mi = MODES.indexOf(b.mode);
      var cols = [['#ff9040', '#ffd27a'], ['#ff4a2d', '#ffb447']][mi] || ['#ff9040', '#ffd27a'];
      var power = [12, 17][mi] || 12;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (var k = 0; k < 8; k++) {
        var ang = k / 8 * TAU;
        var fx = x + Math.cos(ang) * 26, fy = COUNTER_Y - 2 + Math.sin(ang) * 7;
        var fh = power * (0.75 + .4 * Math.sin(t * 13 + k * 2.1));
        ctx.fillStyle = cols[0];
        ctx.beginPath(); ctx.moveTo(fx - 3, fy); ctx.quadraticCurveTo(fx, fy - fh, fx + 3, fy); ctx.closePath(); ctx.fill();
        ctx.fillStyle = cols[1];
        ctx.beginPath(); ctx.moveTo(fx - 1.4, fy); ctx.quadraticCurveTo(fx, fy - fh * .55, fx + 1.4, fy); ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      // 팬 + 내용물 — 팬 몸통은 스프라이트로, 내용물·기포·김은 계속 절차적으로.
      // 내용물 타원이 팬 몸통 중심(x)에 그려지므로 스프라이트를 PAN_BOWL_CX 로 정렬한다.
      if (imgReady('pan')) {
        var pi = IMG['pan'], pw = 118, ph = pw * pi.naturalHeight / pi.naturalWidth;
        ctx.drawImage(pi, x - pw * PAN_BOWL_CX, COUNTER_Y - 2 - ph * .62, pw, ph);
      } else {
      ctx.fillStyle = '#2c3138';
      ctx.beginPath(); ctx.ellipse(x, COUNTER_Y - 14, 38, 12, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#14161a'; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#23272d'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x + 36, COUNTER_Y - 16); ctx.lineTo(x + 62, COUNTER_Y - 24); ctx.stroke();
      }
      var doneT = clamp(b.p, 0, 1);
      ctx.fillStyle = b.dish.c;
      ctx.globalAlpha = .55 + .45 * doneT;
      ctx.beginPath(); ctx.ellipse(x, COUNTER_Y - 15, 30, 8.5, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      for (var q = 0; q < 3; q++) { // 기포
        var bxx = x + Math.sin(t * 3 + q * 2.6) * 18;
        ctx.fillStyle = 'rgba(255,240,210,.5)';
        ctx.beginPath(); ctx.arc(bxx, COUNTER_Y - 15 - Math.abs(Math.sin(t * 5 + q)) * 2, 1.6, 0, TAU); ctx.fill();
      }
      // 김
      if (Math.random() < .22 + doneT * .2) scene.steam.push({ x: x + rnd(-18, 18), y: COUNTER_Y - 22, vy: -(18 + Math.random() * 14), a: .3, r: 4 + Math.random() * 5 });

      if (b.acc) drawAccident(ctx, b, x, t);
    }

    function drawAccident(ctx, b, x, t) {
      var frac = clamp(b.acc.at / b.acc.win, 0, 1);
      // 수습 윈도우 링 (수축)
      ctx.save();
      ctx.strokeStyle = frac < .3 && Math.sin(t * 22) > 0 ? '#fff' : 'rgb(255,' + Math.round(45 + 130 * frac) + ',45)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, COUNTER_Y - 14, 50, -Math.PI / 2, -Math.PI / 2 + frac * TAU); ctx.stroke();
      ctx.restore();
      if (b.acc.ti === 0) { // 팬 과열
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var g = ctx.createRadialGradient(x, COUNTER_Y - 14, 4, x, COUNTER_Y - 14, 44);
        g.addColorStop(0, 'rgba(255,60,30,' + (.4 + .2 * Math.sin(t * 14)) + ')'); g.addColorStop(1, 'rgba(255,60,30,0)');
        ctx.fillStyle = g; ctx.fillRect(x - 48, COUNTER_Y - 62, 96, 96);
        ctx.restore();
        if (Math.random() < .5) scene.steam.push({ x: x + rnd(-16, 16), y: COUNTER_Y - 24, vy: -30, a: .4, r: 6, smoke: true });
      } else if (b.acc.ti === 1) { // 소금 과다
        for (var k = 0; k < 4; k++) {
          ctx.fillStyle = 'rgba(255,255,255,.8)';
          ctx.beginPath(); ctx.arc(x + Math.sin(t * 9 + k * 1.7) * 22, COUNTER_Y - 34 - (t * 30 + k * 9) % 26, 1.4, 0, TAU); ctx.fill();
        }
      } else if (b.acc.ti === 2) { // 기름 화재 — 큰 불기둥
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        for (var j = 0; j < 5; j++) {
          var fx = x + (j - 2) * 11 + Math.sin(t * 17 + j * 3) * 4;
          var fh = 34 + 22 * Math.abs(Math.sin(t * 11 + j * 1.9)) + (1 - frac) * 22;
          ctx.fillStyle = 'rgba(255,90,30,.85)';
          ctx.beginPath(); ctx.moveTo(fx - 6, COUNTER_Y - 18); ctx.quadraticCurveTo(fx, COUNTER_Y - 18 - fh, fx + 6, COUNTER_Y - 18); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,200,80,.9)';
          ctx.beginPath(); ctx.moveTo(fx - 2.6, COUNTER_Y - 18); ctx.quadraticCurveTo(fx, COUNTER_Y - 18 - fh * .55, fx + 2.6, COUNTER_Y - 18); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        if (Math.random() < .6) scene.steam.push({ x: x + rnd(-14, 14), y: COUNTER_Y - 50, vy: -36, a: .45, r: 7, smoke: true });
      } else { // 칼 미끄러짐 — 회전 섬광
        ctx.save();
        ctx.translate(x, COUNTER_Y - 34); ctx.rotate(t * 9);
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(14, 0); ctx.stroke();
        ctx.strokeStyle = 'rgba(200,220,255,.5)'; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.stroke();
        ctx.restore();
      }
    }

    function drawSteam(ctx, dt, t) {
      scene.steam = scene.steam.filter(function (p) {
        p.y += p.vy * dt; p.a -= .28 * dt; p.x += Math.sin(t * 2 + p.y * .06) * 12 * dt;
        if (p.a <= 0) return false;
        ctx.fillStyle = p.smoke ? 'rgba(70,66,60,' + p.a + ')' : 'rgba(230,225,215,' + (p.a * .6) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
        return true;
      });
      if (scene.steam.length > 120) scene.steam.splice(0, scene.steam.length - 120);
    }

    function drawBursts(ctx, t) {
      scene.bursts = scene.bursts.filter(function (f) {
        var age = t - f.born, p, g;
        if (f.type === 'boom') {
          if (age > .6) return false;
          p = age / .6;
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, 90 * p + 16);
          g.addColorStop(0, 'rgba(255,230,170,' + (1 - p) + ')');
          g.addColorStop(.5, 'rgba(255,120,40,' + ((1 - p) * .8) + ')');
          g.addColorStop(1, 'rgba(255,80,30,0)');
          ctx.fillStyle = g; ctx.fillRect(f.x - 110, f.y - 110, 220, 220);
          ctx.restore();
          return true;
        }
        if (f.type === 'fixflash') {
          if (age > .35) return false;
          p = age / .35;
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, 55 * p + 10);
          g.addColorStop(0, 'rgba(180,255,200,' + ((1 - p) * .9) + ')'); g.addColorStop(1, 'rgba(120,255,160,0)');
          ctx.fillStyle = g; ctx.fillRect(f.x - 70, f.y - 70, 140, 140);
          ctx.restore();
          return true;
        }
        if (f.type === 'plate') {
          if (age > .8) return false;
          p = age / .8;
          ctx.globalAlpha = 1 - p;
          ctx.fillStyle = '#f0ede6';
          ctx.beginPath(); ctx.ellipse(f.x, f.y - p * 34, 26, 8, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#c9c4ba'; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = '#ffdf9e';
          for (var k = 0; k < 3; k++) {
            var a = p * 5 + k * 2.1;
            ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * 32, f.y - p * 34 + Math.sin(a) * 10, 1.8, 0, TAU); ctx.fill();
          }
          ctx.globalAlpha = 1;
          return true;
        }
        return false;
      });
    }
  }

  Shell.register({
    id: 'hwaryeok',
    title: '화력쇼',
    tagline: '3분 요리 생방송. 완벽한 요리는 +40, 수습은 수백, 대참사는 +1,400 — 실수 없는 방송이 최악의 전략이다.',
    duration: SHOW_TIME,
    startViewers: START_VIEWERS,
    usesChain: true,
    chat: window.HWARYEOK_CHAT,
    preload: loadArt,
    foot: '화구 번호 <kbd>1</kbd>~<kbd>4</kbd> 하나로 전부 조작한다 — 빈 화구면 <b>팬을 올리고</b>, 사고 중이면 <b>수습</b>. ' +
          '조리 중에 누르면 팬이 내려가니 <b>수습할 때만 눌러라.</b><br>' +
          '수습은 <b>빨리 반응하라</b> — 배율은 사고 유형이 정한다(창이 짧을수록 높다, 최대 ×2.5)<br>' +
          '같은 사고만 반복 수습하면 시청자가 물린다(신선도 감쇠) · 기름 화재를 놓치면 대참사(+시청자 폭등, 화구 12초 파손) · 빈 화구는 조용히 시청자를 잃는다',
    thumb: function (c, w, h) {
      var g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f2e8d5'); g.addColorStop(1, '#e8d8b8');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = '#c4ccd4'; c.fillRect(0, h * .72, w, h * .28);
      [w * .3, w * .7].forEach(function (x) {
        c.fillStyle = '#1a1d22';
        c.beginPath(); c.ellipse(x, h * .72, 30, 9, 0, 0, Math.PI * 2); c.fill();
        c.save(); c.globalCompositeOperation = 'lighter';
        for (var k = 0; k < 5; k++) {
          c.fillStyle = k % 2 ? '#ffb447' : '#ff4a2d';
          c.beginPath();
          c.moveTo(x - 12 + k * 6, h * .7);
          c.quadraticCurveTo(x - 9 + k * 6, h * .7 - 20 - (k % 3) * 7, x - 6 + k * 6, h * .7);
          c.closePath(); c.fill();
        }
        c.restore();
      });
    },
    start: start,
  });
})();
