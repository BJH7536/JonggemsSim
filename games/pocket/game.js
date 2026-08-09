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

  // 전멸 복귀 2지선다 (ADR-010) — 8초 락아웃은 연출도 없고 시청자만 새던 순손실 구간이었다.
  // 대기를 벌칙에서 도박으로 바꾼다: 짧게 나가면 약한 채로 뛴다. 40%는 빈사(20%) 구간에
  // 금방 닿아 comeback(최대 수익) 사정권이므로, "지르는 쪽"이 공통 명제와 같은 방향이다.
  var REVIVE = { fastT: 1.0, fastHp: .40, fullT: 5.0, fullHp: 1 };
  // 연출 정지 — meDown/foeDown 애니는 st.anim.t 1.4초까지 살아 있어 다음 턴과 겹쳐 흘려도
  // 시각적으로 끊기지 않는다. 남는 시간은 전부 플레이어의 입력 기회로 돌린다 (ADR-010)
  var KO_PAUSE = 0.9, FAINT_PAUSE = 0.8;

  // ---------- AetherAI 생성 아트 (tools/aether-assets.json) ----------
  // 몬스터 6종(타입별 아군 뒤태/적 정면)과 스킬 VFX 시트 7종. 파일이 없거나 아직
  // 로드 전이면 기존 캔버스 벡터로 그대로 폴백한다 — 아트는 얹는 층이지 의존성이 아니다.
  // VFX는 4x4 스프라이트 시트(generate/effect/v2, frame=16)를 'screen' 블렌드로 얹는다.
  // 검은 배경 시트에서 검정이 사라지므로 알파 없는 JPEG로 배포해도 깨지지 않는다 (용량 절약).
  var TKEY = ['fire', 'water', 'grass'];
  // 파싱 시점이 아니라 방송 준비(카운트다운) 때 내려받는다 — 첫 화면 payload 절약.
  // 그래도 늦은 프레임은 imgReady 폴백(벡터)이 그대로 받는다. 재호출은 no-op.
  var IMG = {};
  function loadArt() {
    if (IMG['arena-bg']) return;
    [['arena-bg', 'jpg'],
     ['me-fire', 'png'], ['me-water', 'png'], ['me-grass', 'png'],
     ['foe-fire', 'png'], ['foe-water', 'png'], ['foe-grass', 'png'],
     ['vfx-tackle', 'jpg'], ['vfx-fire', 'jpg'], ['vfx-water', 'jpg'], ['vfx-grass', 'jpg'],
     ['vfx-ult-fire', 'jpg'], ['vfx-ult-water', 'jpg'], ['vfx-ult-grass', 'jpg'],
    ].forEach(function (e) {
      var im = new Image();
      im.src = 'games/pocket/img/' + e[0] + '.' + e[1];
      IMG[e[0]] = im;
    });
  }
  function imgReady(n) { var im = IMG[n]; return im && im.complete && im.naturalWidth > 0; }
  var VFX_DUR = 0.5, VFX_GRID = 4;

  var sfxHit   = function () { if (!sfx.gate('pk_h')) return; sfx.noise(.1, .09, 300); sfx.tone(160, .08, 'square', .05); };
  var sfxBig   = function () { if (!sfx.gate('pk_b')) return; sfx.noise(.2, .14, 220); sfx.tone(90, .2, 'sine', .12); };
  var sfxMiss  = function () { if (!sfx.gate('pk_m')) return; sfx.tone(300, .12, 'sine', .04, 0); sfx.tone(220, .14, 'sine', .04, .1); };
  var sfxKO    = function () { if (!sfx.gate('pk_k')) return; sfx.tone(523, .1, 'triangle', .1); sfx.tone(784, .12, 'triangle', .1, .09); sfx.tone(1047, .2, 'triangle', .1, .18); };
  var sfxFaint = function () { if (!sfx.gate('pk_f')) return; sfx.tone(200, .2, 'sawtooth', .06); sfx.tone(120, .3, 'sawtooth', .05, .15); };
  var sfxSwap  = function () { if (!sfx.gate('pk_s')) return; sfx.noise(.12, .06, 700); };

  function start(stage) {
    loadArt(); // 셸이 preload를 안 불렀어도 (구버전 셸) 여기서라도 건다
    var st = {
      bench: MONS.map(function (m) { return { n: m.n, t: m.t, hp: 100, max: 100 }; }),
      active: 0,
      enemy: null, wins: 0, streak: 1, maxStreak: 1,
      mfresh: [0, 0, 0, 0], mrec: [0, 0, 0, 0],
      lastMoves: [], safeSpamAt: -1,
      phase: 'player',           // player | busy | choice | heal
      timers: [], healT: 0, idleT: 0, warnedND: false,
      buf: null, reviveHp: 1,    // 선입력 1칸 · 이번 복귀로 회복할 비율 (ADR-010)
      kos: 0, faints: 0, crits: 0, comebacks: 0, wipes: 0, fastRevives: 0,
      anim: null, hitFlash: { me: 0, foe: 0 }, floaters: [], vfx: [],
      chatT: 3, mileIdx: 0,
    };
    var panel = stage.panel;

    function me() { return st.bench[st.active]; }
    function alive() { return st.bench.filter(function (m) { return m.hp > 0; }); }
    function after(sec, fn) { st.timers.push({ t: sec, fn: fn }); }
    function floater(x, y, txt, color) { st.floaters.push({ x: x, y: y, txt: txt, t: 0, c: color || '#e8891a' }); }
    // 스킬 VFX — 명중 지점에 시트 애니메이션. "모든 기술이 몸통박치기로 보인다" 피드백의 해법:
    // 돌진(anim)은 그대로 두고, 무엇으로 때렸는지는 명중 프레임의 이펙트가 말한다.
    function spawnVfx(key, x, y, scale) {
      if (imgReady(key)) st.vfx.push({ k: key, x: x, y: y, s: scale || 1, born: stage.now });
    }

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
      // 복귀 중에는 쓰러진 개체가 아니라 **복귀 후 조작하게 될 개체**(항상 0번)의 기술명을
      // 보여준다. 미리 눌러두라고 해놓고 다른 개체의 기술명을 띄우면 그건 거짓말이다
      var m = st.phase === 'heal' ? st.bench[0] : me(), names = MOVE_NAMES[m.t];
      // 선입력 (ADR-010): 연출 중에도 버튼은 살아 있다. 지금 누르면 큐에 들어가고
      // 연출이 끝나는 프레임에 소비된다 — 연출 길이를 하나도 줄이지 않고 체감 대기만 없앤다.
      // 복귀 선택 중에는 받지 않는다: 그건 대기가 아니라 결정이라 앞질러 눌러선 안 된다.
      var takesMv = st.phase === 'player' || st.phase === 'busy' || st.phase === 'heal';
      var takesSw = st.phase === 'player' || st.phase === 'busy';
      // 큐에 든 입력은 테두리로 표시한다 — 눌렀는데 아무 일도 안 일어나면 버그로 읽힌다
      var bufMark = ' style="border-color:var(--amber);box-shadow:inset 0 0 0 1px var(--amber)"';
      var moves = MOVES.map(function (mv, i) {
        var fm = FRESH[st.mfresh[i]];
        return '<button class="pkmove" data-mv="' + i + '"' + (takesMv ? '' : ' disabled') +
          (st.buf && st.buf.mv === i ? bufMark : '') + '>' +
          '<b>' + (i + 1) + '. ' + names[i] + '</b>' +
          '<span>명중 ' + Math.round(mv.acc * 100) + '% · 위력 ' + mv.pow + '</span>' +
          '<span class="' + (fm < 1 ? 'warn' : '') + '">신선도 ' + Math.round(fm * 100) + '%</span></button>';
      }).join('');
      var bench = st.bench.map(function (b, i) {
        var pct = Math.round(b.hp / b.max * 100);
        return '<button class="pkmon' + (i === st.active ? ' on' : '') + (b.hp <= 0 ? ' dead' : '') + '"' +
          ' data-sw="' + i + '"' + (!takesSw || i === st.active || b.hp <= 0 ? ' disabled' : '') +
          (st.buf && st.buf.sw === i ? bufMark : '') + '>' +
          '<b style="color:' + TYPES[b.t].c + '">' + b.n + '</b><span>' + TYPES[b.t].n + '</span>' +
          '<div class="pkhp"><i style="width:' + pct + '%;background:' + (pct > 50 ? '#6fd98f' : pct > 25 ? '#ffb447' : '#ff5a4a') + '"></i></div></button>';
      }).join('');
      var foe = st.enemy ? '<div class="pkfoe">상대 <b style="color:' + TYPES[st.enemy.t].c + '">' + st.enemy.n + '</b> · ' +
        TYPES[st.enemy.t].n + ' · 유리 배수 ×' + typeMult(me().t, st.enemy.t).toFixed(2) + '</div>' : '';
      // 복귀 중에는 오른쪽(상대·벤치)만 카운트다운으로 바뀐다. 기술 버튼은 그대로 남겨야
      // 미리 눌러둘 수 있다 — 선입력이 되는 대기와 안 되는 대기는 체감이 완전히 다르다
      var side = st.phase === 'heal'
        ? '<div class="pkheal">🏥 복귀 중 — <b><span id="pkHeal">' + Math.max(0, st.healT).toFixed(1) +
          '</span>초</b><br><span>기술을 미리 눌러두면 복귀하는 순간 바로 나간다</span></div>'
        : foe + '<div class="pkbench">' + bench + '</div>';
      panel.innerHTML = '<div class="pkbar"><div class="pkmoves">' + moves + '</div>' +
        '<div class="pkside">' + side + '</div></div>';
      renderHUD();
    }
    function onPanelClick(e) {
      var t = e.target.closest('[data-mv],[data-sw],[data-rv]');
      if (!t || t.disabled || !stage.live) return;
      if (t.dataset.rv != null) chooseRevive(+t.dataset.rv);
      else if (t.dataset.mv != null) input({ mv: +t.dataset.mv });
      else input({ sw: +t.dataset.sw });
    }
    panel.addEventListener('click', onPanelClick);

    // 입력 한 곳 — 내 턴이면 즉시, 연출 중이면 큐에 1칸. 마지막 입력이 이긴다
    // (격겜의 선입력과 같은 규약: 헷갈려서 두 번 누른 사람이 원한 건 나중 것이다)
    function input(cmd) {
      if (st.phase === 'player') {
        if (cmd.mv != null) playerMove(cmd.mv);
        else if (cmd.sw !== st.active && st.bench[cmd.sw].hp > 0) playerSwitch(cmd.sw);
        return;
      }
      if (st.phase === 'busy' || (st.phase === 'heal' && cmd.mv != null)) {
        st.buf = cmd;
        buildPanel();
      }
    }

    // 연출이 끝나 조작권이 돌아오는 유일한 통로 — 큐가 있으면 여기서 소비한다.
    // 소비 시점에 다시 검사하는 이유: 큐에 넣은 뒤 기절·교체로 판이 바뀌었을 수 있다
    function toPlayer() {
      st.phase = 'player';
      var b = st.buf; st.buf = null;
      buildPanel();
      if (!b) return;
      if (b.mv != null) playerMove(b.mv);
      else if (b.sw !== st.active && st.bench[b.sw].hp > 0) playerSwitch(b.sw);
    }

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
          // 기술 격에 맞는 이펙트 — 안정타는 타격 별, 강타·도박수는 속성, 필살기는 속성 대기술
          spawnVfx(i === 0 ? 'vfx-tackle' : (i === 3 ? 'vfx-ult-' + TKEY[m.t] : 'vfx-' + TKEY[m.t]),
                   660, 230, i === 3 ? 1.6 : (i >= 1 ? 1.15 : .9));
          floater(660, 170, '-' + dmg, crit ? '#e0342a' : '#2f3a46');
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
            // 안정타는 채널의 색을 바꿀 만한 사건이 아니라는 뜻이다 (ADR-004)
            stage.gain(gain, null);
            sfxHit();
            stage.ticker(name + ' 적중 — ' + dmg + ' 피해', false);
          }
          if (st.enemy.hp <= 0) { koEnemy(); return; }
        } else {
          stage.lose(40); // 빗나감 — 조용히 (규약 2)
          sfxMiss();
          floater(660, 170, 'MISS', '#5f6a76');
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
      after(KO_PAUSE, function () { newEnemy(); toPlayer(); });
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
          spawnVfx(ei === 0 ? 'vfx-tackle' : 'vfx-' + TKEY[st.enemy.t], 310, 330, ei === 2 ? 1.2 : 1);
          floater(310, 300, '-' + dmg, '#d84a3a');
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
        toPlayer();
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
      if (next < 0) { // 전멸 — 복귀 방식을 고른다 (ADR-010). 고르는 동안에도 샌다
        st.wipes++;
        // 예약된 연출 타이머를 끊는다. step()은 phase와 무관하게 큐를 소진하므로,
        // 남은 enemyTurn 하나가 복귀 대기 중에 깨어나면 전멸한 팀을 또 때린다.
        // 정상 흐름에선 비어 있지만, 비어 있음에 기대는 것과 보장하는 것은 다르다
        st.timers.length = 0;
        st.phase = 'choice'; st.buf = null;
        stage.emit('wipe');
        buildChoice();
        renderHUD();
        return;
      }
      after(FAINT_PAUSE, function () {
        st.active = next; st.warnedND = false;
        sfxSwap();
        toPlayer();
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

    // ---------- 전멸 복귀 (ADR-010) ----------
    // 8초를 그냥 태우던 자리에 선택을 놓는다. 둘 다 손해지만 손해의 종류가 다르다:
    // 시간을 잃을 것인가, 체력을 잃을 것인가. 규모가 클수록 4초가 비싸진다
    function buildChoice() {
      panel.innerHTML = '<div class="pkbar"><div class="pkheal">💀 <b>전원 전멸</b> — 어떻게 복귀할까?' +
        '<span>고르는 동안에도 시청자는 조용히 빠져나간다</span>' +
        '<div class="pkmoves" style="grid-template-columns:repeat(2,1fr);max-width:540px;margin:12px auto 0">' +
        '<button class="pkmove" data-rv="0"><b>1. 즉시 복귀</b>' +
        '<span>' + REVIVE.fastT.toFixed(1) + '초 · 체력 ' + Math.round(REVIVE.fastHp * 100) + '%</span>' +
        '<span class="warn">약한 채로 바로 뛴다</span></button>' +
        '<button class="pkmove" data-rv="1"><b>2. 완전 회복</b>' +
        '<span>' + REVIVE.fullT.toFixed(1) + '초 · 체력 ' + Math.round(REVIVE.fullHp * 100) + '%</span>' +
        '<span>대신 ' + (REVIVE.fullT - REVIVE.fastT).toFixed(1) + '초를 더 잃는다</span></button>' +
        '</div></div></div>';
    }
    function chooseRevive(kind) {
      if (st.phase !== 'choice') return;
      var fast = kind === 0;
      if (fast) st.fastRevives++;
      st.reviveHp = fast ? REVIVE.fastHp : REVIVE.fullHp;
      st.healT = fast ? REVIVE.fastT : REVIVE.fullT;
      st.phase = 'heal';
      sfxSwap();
      stage.ticker(fast ? '즉시 복귀 — 체력 ' + Math.round(REVIVE.fastHp * 100) + '%로 바로 뛴다'
                        : '괴수센터로 — 완전 회복까지 ' + REVIVE.fullT.toFixed(1) + '초', !fast);
      buildPanel();
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
          // 콜백이 큐 자체를 비울 수 있다 (전멸 처리가 그렇게 한다). 역순 순회 중에 뒤가
          // 통째로 사라지면 남은 인덱스는 undefined가 되므로 매번 다시 집는다
          var tm = st.timers[i];
          if (!tm) continue;
          tm.t -= dt;
          if (tm.t <= 0) { st.timers.splice(i, 1); tm.fn(); }
        }

        // 복귀 선택 중에도 샌다 (규약 2 — 조용히). 고민이 공짜면 2지선다가 아니라
        // 무료 일시정지가 된다: 지금 어느 쪽이 싼지는 시청자 규모가 정한다
        if (st.phase === 'choice') stage.lose(Math.max(1, stage.viewers * 0.007) * dt);

        if (st.phase === 'heal') {
          st.healT -= dt;
          stage.lose(Math.max(1, stage.viewers * 0.007) * dt); // 회복 타임 — 조용히 샌다
          var h = document.getElementById('pkHeal');
          if (h) h.textContent = Math.max(0, st.healT).toFixed(1);
          if (st.healT <= 0) {
            var frac = st.reviveHp;
            st.bench.forEach(function (b) { b.hp = Math.max(1, Math.round(b.max * frac)); });
            st.active = 0; st.warnedND = false;
            stage.emit('revive');
            stage.ticker(frac >= 1 ? '전원 회복! 다시 달리자'
                                   : '체력 ' + Math.round(frac * 100) + '%로 복귀 — 한 대도 못 맞는다', false);
            toPlayer(); // 미리 눌러둔 기술이 있으면 여기서 바로 나간다
          }
        }

        if (st.phase === 'player') {
          st.idleT += dt;
          if (st.idleT > 4) stage.lose(Math.max(1, stage.viewers * 0.006) * dt); // 장고 — 조용히
        }

        // 도네 주기·확률·금액은 셸 소유 (contract 4.2, ADR-008) — 방송 장비가 빈도를 조절한다
        stage.donRoll(dt, 9, .45);
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
        if (!(n >= 1 && n <= 4)) return;
        if (st.phase === 'choice') { if (n <= 2) chooseRevive(n - 1); return; }
        input({ mv: n - 1 }); // 내 턴이면 즉시, 연출·복귀 중이면 큐로
      },

      // 튜닝 계측용 상태 노출 — ?guoidebug 를 붙였을 때만 (GUOI와 같은 규약).
      debug: (typeof location !== 'undefined' && /guoidebug/.test(location.search))
        ? function () { return st; } : null,

      summary: function () {
        return [
          ['연승 / KO', st.wins + '연승 / ' + st.kos + '회'],
          ['최고 배수 / 급소', '×' + st.maxStreak.toFixed(1) + ' / ' + st.crits],
          ['빈사 역전 / 기절', st.comebacks + ' / ' + st.faints],
          ['전멸 / 즉시 복귀', st.wipes + '회 / ' + st.fastRevives + '회'],
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
        // 스킬 VFX — 4x4 시트를 'screen' 블렌드로 얹는다. 검은 배경 시트에서 검정은
        // 화면에 아무것도 더하지 않으므로 알파 없이도 이펙트만 떠오른다.
        st.vfx = st.vfx.filter(function (f) {
          var p = (t - f.born) / VFX_DUR;
          if (p >= 1) return false;
          if (p < 0) return true;
          var im = IMG[f.k];
          var n = VFX_GRID * VFX_GRID, idx = Math.min(n - 1, (p * n) | 0);
          var fw = im.naturalWidth / VFX_GRID, fh = im.naturalHeight / VFX_GRID;
          var size = 170 * f.s;
          // 생성 시트에 셀 경계 격자선이 그려져 온다(실측). 소스 사각형을 4% 안쪽으로
          // 파서 선을 잘라낸다 — 이펙트는 셀 중앙에 있어 4% 손실은 보이지 않는다.
          var inx = fw * .04, iny = fh * .04;
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = p > .8 ? (1 - p) * 5 : 1;   // 마지막 20%는 페이드아웃
          ctx.drawImage(im,
                        (idx % VFX_GRID) * fw + inx, ((idx / VFX_GRID) | 0) * fh + iny,
                        fw - inx * 2, fh - iny * 2,
                        f.x - size / 2, f.y - size / 2, size, size);
          ctx.restore();
          return true;
        });
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
      // 배경 정물은 AetherAI 플레이트 — 군중 점·스포트라이트·플랫폼은 계속 위에 얹는다
      // (군중 밀도가 시청자 규모를 반영하는 연출이라 정지 이미지로 대체하면 죽는다).
      if (imgReady('arena-bg')) {
        var bi = IMG['arena-bg'];
        var sc = Math.max(960 / bi.naturalWidth, 430 / bi.naturalHeight);
        var dw = bi.naturalWidth * sc, dh = bi.naturalHeight * sc;
        ctx.drawImage(bi, (960 - dw) / 2, (430 - dh) / 2, dw, dh);
      } else {
      var g = ctx.createLinearGradient(0, 0, 0, 430);
      g.addColorStop(0, '#7ec8f5'); g.addColorStop(.55, '#bfe8a0'); g.addColorStop(1, '#5cb04a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 430);
      }
      // 하늘의 꽃잎 반짝임 — 점의 밀도가 시청자 규모를 은근히 반영한다 (연출 전용, C3)
      var crowd = clamp(Math.log10(stage.viewers + 10) * 22, 12, 90);
      for (var i = 0; i < crowd; i++) {
        var cx = (i * 137 + 61) % 960, cy = 18 + (i * 53 % 70);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + 0.25 * Math.abs(Math.sin(t * 1.4 + i))) + ')';
        ctx.fillRect(cx, cy, 3, 3);
      }
      // 배틀 플랫폼 — 밝은 초원의 풀 둔덕
      [[660, 270, 120, 26], [310, 385, 160, 32]].forEach(function (p) {
        var pg = ctx.createRadialGradient(p[0], p[1], 8, p[0], p[1], p[2]);
        pg.addColorStop(0, '#a8de7a'); pg.addColorStop(1, '#69b054');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.ellipse(p[0], p[1], p[2], p[3], 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(58,110,46,.45)'; ctx.lineWidth = 2; ctx.stroke();
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
      ctx.fillStyle = 'rgba(30,60,25,.25)';
      ctx.beginPath(); ctx.ellipse(0, r * .78, r * .95, r * .26, 0, 0, TAU); ctx.fill();
      // AetherAI 스프라이트가 있으면 그걸 그린다. 그림자·돌진·기절·플래시·HP바는
      // 공통 경로라 그대로 탄다 — 아트만 갈아끼우는 층이다. 없으면 기존 벡터 폴백.
      var skey = (isFoe ? 'foe-' : 'me-') + TKEY[type];
      if (imgReady(skey)) {
        var im = IMG[skey], iw = r * 2.3, ih = iw * im.naturalHeight / im.naturalWidth;
        ctx.drawImage(im, -iw / 2, r * .8 - ih, iw, ih); // 발끝을 그림자 선에 맞춘다
      } else {
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
      }
      if (flash > .02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(255,255,255,' + flash + ')';
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * .88, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
      // HP 바 — 클래식 몬스터 RPG풍 흰 정보 박스
      var bw = 110, bx = x - bw / 2, by = y - r - 34;
      ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.fillRect(bx - 4, by - 15, bw + 8, 26);
      ctx.strokeStyle = 'rgba(58,80,58,.5)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(bx - 4, by - 15, bw + 8, 26);
      ctx.font = '10.5px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#2c3440';
      ctx.fillText(name + (isFoe ? ' (야생)' : ''), bx, by - 4);
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(bx, by, bw, 6);
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
    preload: loadArt,
    tuning: { MOVES: MOVES, FRESH: FRESH, CRIT: CRIT, TYPES: 3, REVIVE: REVIVE, KO_PAUSE: KO_PAUSE, FAINT_PAUSE: FAINT_PAUSE },
    foot: '<kbd>1</kbd>~<kbd>4</kbd> 또는 버튼으로 기술 — <b>명중이 낮을수록 시청자가 크게 반응한다.</b> 벤치 클릭으로 교체(한 턴 소모, 유리 상성 교체는 보상)<br>' +
          '연출 중에도 미리 눌러두면 큐에 들어간다 · 전멸하면 <b>즉시 복귀(체력 40%)</b>와 <b>완전 회복(5초)</b> 중 고른다<br>' +
          '같은 기술만 쓰면 물린다(기술 신선도) · 빈사 상태에서의 역전 KO가 최대 수익 · 기절·전멸·장고는 조용히 시청자를 잃는다',
    thumb: function (ctx, w, h) {
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#7ec8f5'); g.addColorStop(1, '#5cb04a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ff6a3d'; ctx.beginPath(); ctx.ellipse(w * .3, h * .68, 26, 22, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2e9e58'; ctx.beginPath(); ctx.ellipse(w * .72, h * .38, 20, 17, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Georgia, serif'; ctx.textAlign = 'center';
      ctx.fillText('VS', w * .51, h * .52);
    },
    start: start,
  });
})();
