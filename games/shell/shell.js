/* 방송 셸 (무대) — 게임 선택 허브 · 시청자 경제 · 게임 단위 신선도 · 방송 루프 · 정산.
 *
 * 소유: 현재(무대). 게임↔셸 계약의 규범 문서는 docs/contract.md 4절 — 이 파일이 그 구현이다.
 * 둘이 어긋나면 contract.md가 맞다.
 *
 * 공통 설계 규약 (영구 준수):
 *   1. 시청자 수는 체력바·점수·언락 통화를 겸한다      → viewers 단일 수치, 0이면 방송 종료
 *   2. 손실은 연출하지 않는다. 획득은 과하게            → lose()는 무음·무연출 / gain()은 FX 큐
 *   3. 큰 자극은 0.4초 간격 큐로만 방출                 → drainFx()
 *   4. 신선도 감쇠 — 종겜스에서는 "게임 단위"로 확장    → freshness{} · 아래 FRESH_MULT
 *   5. 뼈대 vs 양념                                     → 게임 각자의 책임
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  var W = 960, H = 430;
  var STORE_KEY = 'jonggems-channel-v1';

  // 규약 4 (게임 단위 확장): 같은 게임을 연속으로 방송하면 시청자가 물린다.
  // 회복은 "다른 게임 1회 방송당 1단계" — 게임이 2종뿐이라 회복 조건을 더 빡세게 잡으면
  // 감쇠가 편도가 되어 종겜 플레이를 오히려 벌준다. 번갈아 방송하면 100%가 유지되는 게 의도다.
  var FRESH_MULT = [1, .7, .45, .25, .1];

  var Shell = {
    games: [],
    game: null,     // 현재 방송 중인 게임 정의
    inst: null,     // 게임 인스턴스
    stage: null,
    phase: 'hub',   // hub | live | result
    viewers: 0,
    timeLeft: 0,
    ch: null,       // 채널 영속 상태 (localStorage)
    ctx: null,
    now: 0,
    _shake: 0, _flash: 0, _prevFrame: 0,
    _fxQueue: [], _lastFxAt: 0,
    _stampTimer: 0,

    register: function (game) { this.games.push(game); },

    // ---------- 채널 영속 상태 ----------
    loadChannel: function () {
      var d = null;
      try { d = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) {}
      if (!d || typeof d !== 'object') d = {};
      this.ch = {
        subs: d.subs || 0,          // 누적 구독자 — 방송 최종 시청자의 이월분
        shows: d.shows || 0,
        fresh: d.fresh || {},       // gameId -> 0..4 (감쇠 단계)
        best: d.best || {},         // gameId -> 최고 시청자
      };
    },
    saveChannel: function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.ch)); } catch (e) {}
    },
    freshStep: function (id) { return this.ch.fresh[id] || 0; },
    freshMult: function (id) { return FRESH_MULT[this.freshStep(id)]; },

    // ---------- 부팅 ----------
    boot: function () {
      this.ctx = $('scene').getContext('2d');
      Chat.init($('chatFeed'));
      this.loadChannel();
      this.bindInput();
      this.showHub();
      requestAnimationFrame(this.loop.bind(this));
    },

    bindInput: function () {
      var self = this, cv = $('scene');
      addEventListener('keydown', function (e) {
        if (e.repeat) return; // 키 홀드 자동입력 방지 — 반응 속도가 화력쇼의 측정 대상 (L-3)
        if (self.phase !== 'live') {
          if ((e.key === 'r' || e.key === 'R') && self.phase === 'result' && self.game) self.start(self.game.id);
          if (e.key === 'Escape' && self.phase === 'result') self.showHub();
          return;
        }
        if (e.key === 'Escape') { self.endShow('quit'); return; }
        if (self.inst && self.inst.key) self.inst.key(e);
      });
      var toScene = function (e) {
        var r = cv.getBoundingClientRect();
        return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
      };
      cv.addEventListener('pointermove', function (e) {
        if (self.phase === 'live' && self.inst && self.inst.pointer) self.inst.pointer(toScene(e), 'move', e);
      });
      cv.addEventListener('pointerdown', function (e) {
        if (self.phase === 'live' && self.inst && self.inst.pointer) self.inst.pointer(toScene(e), 'down', e);
      });
      cv.addEventListener('pointerup', function (e) {
        if (self.phase === 'live' && self.inst && self.inst.pointer) self.inst.pointer(toScene(e), 'up', e);
      });
      cv.addEventListener('contextmenu', function (e) { if (self.phase === 'live') e.preventDefault(); });
    },

    // ---------- 게임 선택 허브 ----------
    showHub: function () {
      this.phase = 'hub';
      this.game = null;
      if (this.inst && this.inst.dispose) this.inst.dispose();
      this.inst = null;
      this.viewers = 0;
      $('panel').innerHTML = '';
      $('foot').innerHTML = '';
      $('plaque').innerHTML = '';
      $('tally').classList.add('off');
      $('tallyR').textContent = '오프라인';
      $('chainMeter').classList.add('hidden');
      $('viewerCount').textContent = '0';
      Chat.reset();
      Chat.sys('— 방송 대기 중 —');

      var self = this;
      var cards = this.games.map(function (g) {
        var step = self.freshStep(g.id), fm = FRESH_MULT[step], pct = Math.round(fm * 100);
        var best = self.ch.best[g.id] || 0;
        return '<button class="gcard" data-game="' + g.id + '">' +
          '<div class="gt">' + g.title + '</div>' +
          '<div class="gd">' + g.tagline + '</div>' +
          '<div class="gf' + (fm < 1 ? ' warn' : '') + '">신선도 <b>' + pct + '%</b>' +
            (fm < 1 ? ' — 물렸다. 다른 게임을 방송하면 회복' : '') + '</div>' +
          '<div class="freshbar"><i class="' + (fm < 1 ? 'warn' : '') + '" style="width:' + pct + '%"></i></div>' +
          (best ? '<div class="gf">최고 <b>' + best.toLocaleString() + '</b>명</div>' : '') +
          '</button>';
      }).join('');

      $('overlay').classList.remove('hidden');
      $('overlay').innerHTML = '<div class="panel">' +
        '<h2>오늘 뭐 방송하지?</h2>' +
        '<p>당신은 종합게임 스트리머다. 게임을 고르면 <b>AI 시청자</b>가 당신의 플레이를 실시간으로 ' +
        '관측하고 채팅으로 반응한다 — 칭찬하고, 야유하고, 훈수를 둔다.</p>' +
        '<p class="fine">시청자 수가 곧 체력이자 점수다. 0명이 되면 방송은 그대로 끝난다. ' +
        '그리고 <b>같은 게임만 파면 물린다</b> — 그래서 종겜을 하는 것이다.</p>' +
        '<div id="hubGrid">' + cards + '</div>' +
        '<div class="chanline">채널 누적 구독자 <b>' + this.ch.subs.toLocaleString() + '</b>명 · ' +
          '방송 <b>' + this.ch.shows + '</b>회</div>' +
        '</div>';
      $('overlay').querySelector('#hubGrid').addEventListener('click', function (e) {
        var btn = e.target.closest('[data-game]');
        if (btn) self.start(btn.getAttribute('data-game'));
      });
    },

    // ---------- 방송 시작 ----------
    start: function (gameId) {
      var g = this.games.filter(function (x) { return x.id === gameId; })[0];
      if (!g) return;
      if (this.inst && this.inst.dispose) this.inst.dispose();

      this.game = g;
      this.phase = 'live';
      this.viewers = g.startViewers;
      this.timeLeft = g.duration;
      this._fxQueue.length = 0;
      this._shake = 0; this._flash = 0;

      $('overlay').classList.add('hidden');
      $('overlay').innerHTML = '';
      $('tally').classList.remove('off');
      $('tallyR').textContent = g.title;
      $('chainMeter').classList.toggle('hidden', !g.usesChain);
      $('chainVal').textContent = '×1.0';
      $('chainMeter').classList.remove('hot');
      $('foot').innerHTML = g.foot || '';
      $('panel').innerHTML = '';

      Chat.reset();
      Chat.load(g.chat.T, g.chat.BURST);
      Chat.sys('— 생방송 시작 · ' + g.title + ' —');

      this.stage = this.makeStage();
      this.inst = g.start(this.stage);
      this.renderViewers();
      this.stage.emit('start');
    },

    // ---------- 게임에 건네는 무대 표면 (docs/contract.md 4절) ----------
    makeStage: function () {
      var self = this;
      return {
        W: W, H: H, ctx: this.ctx, panel: $('panel'),
        get viewers() { return self.viewers; },
        get timeLeft() { return self.timeLeft; },
        get now() { return self.now; },
        get live() { return self.phase === 'live'; },
        // 신선도가 적용된 뒤의 실제 반영량. 게임은 "얼마를 벌 만한 플레이였나"만 말하고,
        // 시청자 수를 실제로 얼마나 움직일지는 셸이 정한다 (규약 1·4는 무대 소유).
        // label이 없으면 FX 팝업을 띄우지 않는다 — 소액 획득까지 큐를 먹으면 큰 자극이 밀린다.
        gain: function (n, label) {
          if (!(n > 0) || self.phase !== 'live') return 0;
          var actual = Math.max(1, Math.round(n * self.freshMult(self.game.id)));
          self.viewers += actual;
          self.renderViewers();
          if (label) self._fxQueue.push('+' + actual.toLocaleString() + ' · ' + label); // 획득은 과하게 (규약 2)
          if (self.viewers >= 30000) Chat.big = true;
          return actual;
        },
        lose: function (n) { self.loseViewers(n); },        // 조용히 (규약 2)
        emit: function (ev, facts) { Chat.react(ev, facts); }, // C3 — 채팅은 관측만
        hud: function (html) { $('plaque').innerHTML = html; },
        stamp: function (text) { self.showStamp(text); },
        ticker: function (text, muted) { self.showTicker(text, muted); },
        setChain: function (v) {
          $('chainVal').textContent = '×' + v.toFixed(1);
          $('chainMeter').classList.toggle('hot', v >= 2);
        },
        shake: function (v) { self._shake = Math.max(self._shake, v); },
        flash: function (v) { self._flash = Math.max(self._flash, v); },
        end: function (reason) { self.endShow(reason || 'clear'); },
      };
    },

    // ---------- 시청자 (규약 1·2) ----------
    renderViewers: function () {
      // 0.x명일 때 조기 '0명' 표시 방지 (L-8)
      $('viewerCount').textContent = Math.ceil(this.viewers).toLocaleString();
    },
    loseViewers: function (n) {
      if (this.phase !== 'live' || !(n > 0)) return;
      this.viewers = Math.max(0, this.viewers - n);
      this.renderViewers();
      if (this.viewers <= 0) this.endShow('dead');
    },
    drainFx: function () {
      if (this.phase !== 'live') return; // 결과 화면에서 팝업 방출 금지 (M-4)
      if (!this._fxQueue.length || this.now - this._lastFxAt < .4) return; // 규약 3
      this._lastFxAt = this.now;
      var el = $('vpopup');
      el.textContent = this._fxQueue.shift();
      el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    },
    showStamp: function (text) {
      $('bigStampText').textContent = text;
      var st = $('bigStamp');
      st.classList.remove('show'); void st.offsetWidth; st.classList.add('show');
      clearTimeout(this._stampTimer); // 연속 스탬프의 조기 소멸 방지 (L-2)
      this._stampTimer = setTimeout(function () { st.classList.remove('show'); }, 1600);
    },
    showTicker: function (text, muted) {
      var t = $('ticker');
      t.textContent = text;
      t.className = muted ? 'muted' : '';
      t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    },

    // ---------- 방송 종료·정산 ----------
    endShow: function (reason) {
      if (this.phase !== 'live') return; // 이중 종료 방지 (H-2)
      this.phase = 'result';
      var g = this.game, final = Math.round(this.viewers);

      Chat.sys(reason === 'dead' ? '— 방송 강제 종료 —' : '— 방송 종료 —');
      Chat.react('end');

      var prevBest = this.ch.best[g.id] || 0;
      var isRecord = final > prevBest;
      if (isRecord) this.ch.best[g.id] = final;

      // 규약 4 — 방송한 게임은 한 단계 물리고, 나머지 게임은 한 단계 회복한다
      var self = this;
      this.ch.fresh = Shell.rotateFresh(this.ch.fresh, g.id, this.games.map(function (o) { return o.id; }));

      var newSubs = Math.floor(final / 100); // 최종 시청자의 1%가 채널에 남는다
      this.ch.subs += newSubs;
      this.ch.shows++;
      this.saveChannel();

      var nextPct = Math.round(FRESH_MULT[this.ch.fresh[g.id]] * 100);
      var other = this.games.filter(function (o) { return o.id !== g.id; })[0];
      var stats = (this.inst && this.inst.summary) ? this.inst.summary() : [];
      var rows = stats.map(function (r) { return '<span>' + r[0] + '</span><b>' + r[1] + '</b>'; }).join('');

      var head = reason === 'dead' ? '방송 강제 종료' : (reason === 'quit' ? '방송 중단' : '방송 종료');
      var lead = reason === 'dead' ? '시청자가 전부 떠났다. 검은 화면만 남았다.'
        : reason === 'clear' ? '오늘 방송, 잘 뽑혔다.'
        : g.title + ' 방송이 끝났다.';

      $('overlay').classList.remove('hidden');
      $('overlay').innerHTML = '<div class="panel">' +
        '<h2>' + head + '</h2><p>' + lead + '</p>' +
        '<div class="statgrid">' +
          '<span>최종 시청자</span><b>' + final.toLocaleString() + '명 ' +
            (isRecord ? '<span class="rec">★ 신기록</span>' : '(기록 ' + Math.max(prevBest, final).toLocaleString() + ')') + '</b>' +
          rows +
          '<span>채널 구독자</span><b>+' + newSubs.toLocaleString() + ' → ' + this.ch.subs.toLocaleString() + '명</b>' +
        '</div>' +
        '<p class="fine">다음 <b>' + g.title + '</b> 방송의 신선도는 <b>' + nextPct + '%</b>' +
          (nextPct < 100 && other ? ' — <b>' + other.title + '</b>을(를) 한 번 방송하면 회복된다. 이게 종겜을 하는 이유다.' : '.') +
        '</p>' +
        '<div class="btnrow">' +
          '<button class="slab primary" id="btnAgain">다시 방송 (R)</button>' +
          '<button class="slab" id="btnHub">게임 고르러 가기 (Esc)</button>' +
        '</div></div>';
      $('btnAgain').onclick = function () { self.start(g.id); };
      $('btnHub').onclick = function () { self.showHub(); };
    },

    // ---------- 루프 ----------
    loop: function (ms) {
      var t = ms / 1000;
      var dt = Math.min(.05, t - this._prevFrame || .016);
      this._prevFrame = t; this.now = t;
      this._shake *= .88; this._flash *= .88;

      if (this.phase === 'live') {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.endShow('time'); }
      }
      if (this.phase === 'live' && this.inst) this.inst.step(dt);
      this.drainFx();
      this.draw(dt);
      requestAnimationFrame(this.loop.bind(this));
    },

    draw: function (dt) {
      var ctx = this.ctx;
      ctx.fillStyle = '#0b0908'; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate((Math.random() - .5) * this._shake, (Math.random() - .5) * this._shake);
      if (this.inst) this.inst.draw(ctx, dt);
      ctx.restore();
      // 방송 화면 공통 룩 — 비네트 + 화이트 플래시
      var g = ctx.createRadialGradient(480, 210, 190, 480, 210, 580);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (this._flash > .01) { ctx.fillStyle = 'rgba(255,245,220,' + this._flash + ')'; ctx.fillRect(0, 0, W, H); }
    },
  };

  // 게임이 공유하는 소도구 — 매 게임 재작성할 이유가 없는 것만.
  Shell.util = {
    clamp: clamp,
    rnd: function (a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; },
    TAU: Math.PI * 2,
    fmtTime: function (s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); },
  };

  // 합성음 SFX — 외부 에셋 0건 유지 (라이선스 기재 부담도 0)
  var actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  var sfxLast = {};
  Shell.sfx = {
    // 같은 효과음의 동시 다발 재생은 100ms 안에서 1회로 병합 — 큰 자극 겹침 방지 (규약 3, critic M2)
    gate: function (key) {
      var t = performance.now();
      if (sfxLast[key] && t - sfxLast[key] < 100) return false;
      sfxLast[key] = t; return true;
    },
    tone: function (freq, dur, type, vol, delay) {
      var a = audio(); if (!a) return;
      type = type || 'sine'; vol = vol == null ? .1 : vol; delay = delay || 0;
      var o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, a.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + delay + dur);
      o.connect(g); g.connect(a.destination);
      o.start(a.currentTime + delay); o.stop(a.currentTime + delay + dur + .03);
    },
    noise: function (dur, vol, freq) {
      var a = audio(); if (!a) return;
      var n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = a.createBufferSource(); s.buffer = buf;
      var f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
      var g = a.createGain(); g.gain.value = vol;
      s.connect(f); f.connect(g); g.connect(a.destination); s.start();
    },
  };
  document.addEventListener('pointerdown', function () { audio(); }, { once: true });

  // 규약 4의 전부 — 방송 1회가 신선도 지도를 어떻게 바꾸는가. 순수 함수로 떼어 둔 이유는
  // 이게 조용히 틀리면(감쇠만 되고 회복이 안 되는 등) 종겜 플레이가 손해로 뒤집히기 때문.
  // 검증: games/shell/selftest.html
  Shell.rotateFresh = function (fresh, playedId, allIds) {
    var out = {}, i;
    for (i = 0; i < allIds.length; i++) out[allIds[i]] = fresh[allIds[i]] || 0;
    out[playedId] = Math.min(FRESH_MULT.length - 1, (fresh[playedId] || 0) + 1);
    for (i = 0; i < allIds.length; i++) {
      if (allIds[i] !== playedId) out[allIds[i]] = Math.max(0, out[allIds[i]] - 1);
    }
    return out;
  };

  Shell.FRESH_MULT = FRESH_MULT;
  global.Shell = Shell;
})(window);
