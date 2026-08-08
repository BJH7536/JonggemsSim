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

  // 방송 제목 풀 — 순수 연출. 실제 종겜 스트리머의 "오늘의 각오" 제목 감성.
  // 게임 id 로 찾고, 없으면 태그라인을 쓴다 (새 게임이 등록돼도 깨지지 않는다).
  var SHOW_TITLES = {
    hwaryeok: ['불 좀 끄고 올게요', '오늘 대참사 0회 도전', '4구 풀가동 각입니다'],
    'giving-up': ['오늘 정상 못 가면 삭발', '항아리 유산소 하는 날', '떨어질수록 커집니다'],
    pocket: ['빈사 역전만 노립니다', '연승 끊기면 바로 자야죠', '명중 38%를 믿습니다'],
    fishing: ['오늘 나락의군주 잡습니다', '심해만 팝니다 얕은물 금지', '줄 끊기면 낚싯대 삽니다'],
    bomb: ['판독 없이 갑니다', '오늘 폭발 0회 도전(안 지킴)', '감으로 자르는 남자'],
  };

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
        log: d.log || [],           // 최근 방송 기록 [{g, v, r}] 최신순 4개
      };
    },
    updateTopbar: function () {
      $('tbSubs').textContent = this.ch.subs.toLocaleString();
      $('tbShows').textContent = this.ch.shows;
      var live = this.phase === 'live';
      $('tbLive').textContent = live ? '● LIVE' : 'OFFLINE';
      $('tbLive').className = live ? 'on' : 'off';
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
      // 스트리머 캠 얼굴 프리로드 — 없으면 첫 리액션 순간에 깜빡인다
      var self = this;
      this._camFaces = {};
      ['silence', 'surprise', 'panic', 'aha', 'confusion', 'thinking', 'question'].forEach(function (m) {
        var img = new Image();
        img.src = 'games/shell/faces/adventurer_' + m + '.png';
        self._camFaces[m] = img;
      });
      this._camMood = 'silence'; this._camAt = 0;
      this._graph = []; this._graphT = 0; this._upT = 0;
      if (window.JongLLM) JongLLM.init($('chatBadge'));
      var self2 = this;
      $('followBtn').addEventListener('click', function () {
        self2.showTicker('본인 채널은 팔로우할 수 없습니다', true);
      });
      this.showHub();
      requestAnimationFrame(this.loop.bind(this));
    },

    // ---------- 스트리머 캠 (연출 전용 — C3: 게임 수치와 무관) ----------
    // 게임이 emit하는 이벤트 이름을 표정으로 번역한다. 새 게임이 기존 이름을 재사용하면
    // 캠은 공짜로 따라온다 — 목록에 없는 이벤트는 무표정 유지 (contract 4.2 참고).
    CAM_MOOD: {
      surprise: ['accident', 'oilfire', 'player_hit', 'new_foe', 'fall',
                 'bite', 'hook', 'new_bomb'],
      panic: ['disaster', 'fall_legend', 'fall_big', 'wipe', 'near_death',
              'line_snap', 'boom'],
      aha: ['rescue', 'rescue_big', 'clutch', 'crit', 'comeback', 'summit', 'unlock',
            'enemy_ko', 'ultra_hit', 'risky_hit', 'advantage', 'revive', 'donation', 'done',
            'land_big', 'land_legend', 'tension_edge', 'cut_paid', 'defused', 'defused_clutch', 'chain_up'],
      confusion: ['fail', 'miss', 'faint', 'disadvantage', 'safe_spam',
                  'strike_miss', 'escape', 'trash', 'timeout_boom'],
      thinking: ['nag', 'stuck', 'idle', 'scan_reveal'],
      question: ['milestone'],
    },
    camReact: function (ev) {
      for (var mood in this.CAM_MOOD) {
        if (this.CAM_MOOD[mood].indexOf(ev) >= 0) {
          if (mood === 'thinking' && this._camMood !== 'silence') return; // 잡담은 큰 표정을 덮지 않는다
          this._camMood = mood; this._camAt = this.now;
          var f = this._camFaces[mood];
          if (f && f.complete && f.naturalWidth) $('camImg').src = f.src;
          return;
        }
      }
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

      $('camBox').classList.add('hidden');
      $('tallyUp').textContent = '';
      $('infoTitle').textContent = '방송 준비 중…';
      $('infoCat').textContent = '대기 화면';
      $('infoDot').className = 'off';
      $('infoUptime').textContent = '';
      $('infoViewers').textContent = '0';
      clearTimeout(this._startTimer);
      this.updateTopbar();

      var self = this;
      // 바탕화면 아이콘 — 스트리머의 PC라는 은유. 카드 그리드보다 "방송 전"이라는 상태가 읽힌다.
      // 아이콘 아트는 AetherAI 생성물(tools/aether-assets.json)이고, 파일이 없으면
      // 아래 bindHub()가 .noimg 로 떨어뜨려 CSS 타일로 그린다 — 이미지 없이도 기능은 온전하다.
      var icons = this.games.map(function (g) {
        var pct = Math.round(FRESH_MULT[self.freshStep(g.id)] * 100);
        return '<button class="dIcon" data-game="' + g.id + '">' +
          '<span class="dIconArt"><img src="games/shell/img/icon-' + g.id + '.png" alt=""></span>' +
          '<span class="dIconName">' + g.title + '</span>' +
          '<span class="dIconFresh' + (pct < 100 ? ' warn' : '') + '">' + pct + '%</span>' +
          '</button>';
      }).join('');

      var recent = this.ch.log.length
        ? '<div class="recent"><div class="rlab">최근 방송</div>' + this.ch.log.map(function (r) {
            return '<div class="rrow"><span>' + r.g + '</span><span><b>' + r.v.toLocaleString() + '</b>명' +
              (r.r ? '<span class="rec">★ 신기록</span>' : '') + '</span></div>';
          }).join('') + '</div>'
        : '';

      // 창을 최소화하고 바탕화면을 드러낸다 — 방송 전의 스트리머는 데스크탑에 있다
      $('jgsWin').classList.add('minimized');
      $('appJgs').classList.remove('on');
      $('obsDot').classList.remove('live');
      $('overlay').classList.add('hidden');
      $('overlay').innerHTML = '';
      $('desktop').innerHTML =
        '<div class="deskIcons">' + icons + '</div>' +
        '<div class="deskWin" id="deskWin"></div>' +
        '<div class="deskStat">구독자 <b>' + this.ch.subs.toLocaleString() + '</b> · 방송 <b>' +
          this.ch.shows + '</b>회 · 더블클릭 = 바로 방송</div>' +
        recent;

      this.bindHub();
      // 첫 진입에도 창이 비어 보이지 않게 첫 게임을 열어 둔다
      if (this.games.length) this.openLauncher(this.games[0].id);
    },

    // 아이콘 아트가 없으면(아직 생성 전) CSS 타일로 대체한다 — 이미지 유무가 기능을 막지 않는다
    bindHub: function () {
      var self = this, root = $('desktop');
      root.querySelectorAll('.dIcon img').forEach(function (im) {
        im.addEventListener('error', function () { im.closest('.dIcon').classList.add('noimg'); });
        if (im.complete && im.naturalWidth === 0) im.closest('.dIcon').classList.add('noimg');
      });
      root.querySelector('.deskIcons').addEventListener('click', function (e) {
        var btn = e.target.closest('[data-game]');
        if (btn) self.openLauncher(btn.getAttribute('data-game'));
      });
      // 실제 데스크탑처럼 더블클릭은 곧장 실행이다 — 카운트다운을 거쳐 방송이 켜진다
      root.querySelector('.deskIcons').addEventListener('dblclick', function (e) {
        var btn = e.target.closest('[data-game]');
        if (btn) self.start(btn.getAttribute('data-game'));
      });
    },

    // 런처 창 — 아이콘을 한 번 클릭하면 열리는 게임 정보 창.
    // 기존 카드가 보여주던 정보(썸네일·태그라인·신선도·최고 기록)를 그대로 옮겼다.
    // 방송 시작 버튼은 없다 — 진입은 실제 데스크탑처럼 더블클릭(아이콘 또는 이 창)이다.
    openLauncher: function (gameId) {
      var self = this;
      var g = this.games.filter(function (x) { return x.id === gameId; })[0];
      if (!g) return;
      var step = this.freshStep(g.id), fm = FRESH_MULT[step], pct = Math.round(fm * 100);
      var best = this.ch.best[g.id] || 0;

      $('desktop').querySelectorAll('.dIcon').forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-game') === gameId);
      });

      // 관객 프로필 — 공명 모델(PR #4)이 머지되면 자동으로 붙는다. 아직 없으면 조용히 빈칸이다.
      // 두 브랜치가 같은 파일을 건드리지 않도록 존재 여부만 보고 분기한다.
      var profHtml = '';
      if (typeof this.archProfile === 'function' && this.ARCH) {
        var prof = this.archProfile(g);
        if (prof) {
          profHtml = '<div class="gaud"><span>관객 프로필</span><i class="gaudbar">' +
            this.ARCH.map(function (a, i) {
              return '<i style="flex-grow:' + Math.max(0.01, prof.rel[i]) + ';background:' + a.c +
                '" title="' + a.n + ' ×' + prof.rel[i].toFixed(2) + '"></i>';
            }).join('') + '</i><b style="color:' + prof.top.c + '">' + prof.top.n + '</b></div>';
        }
      }

      $('deskWin').innerHTML =
        '<div class="dwBar"><span class="dwDots"><i></i><i></i><i></i></span>' +
          '<span class="dwTitle">' + g.title + '</span></div>' +
        '<div class="dwBody">' +
          '<canvas class="gthumb" data-thumb="' + g.id + '" width="960" height="430"></canvas>' +
          '<div class="dwInfo">' +
            '<p class="gd">' + g.tagline + '</p>' +
            '<div class="gf' + (fm < 1 ? ' warn' : '') + '"><span>시청자 신선도</span><b>' + pct + '%</b></div>' +
            '<div class="freshbar"><i class="' + (fm < 1 ? 'warn' : '') + '" style="width:' + pct + '%"></i></div>' +
            '<div class="gf"><span>' + (fm < 1 ? '물렸다 — 다른 게임이 회복시킨다' : '지금이 방송 적기') + '</span>' +
              (best ? '<b>최고 ' + best.toLocaleString() + '</b>' : '') + '</div>' +
            profHtml +
          '</div>' +
        '</div>' +
        '<div class="dwHint">▶ 아이콘 또는 이 창을 <b>더블클릭</b>하면 방송이 시작됩니다</div>';

      // 썸네일은 게임이 직접 그린다 (thumb 없으면 타이틀 카드)
      var cv = $('deskWin').querySelector('[data-thumb]');
      var c = cv.getContext('2d');
      if (g.thumb) g.thumb(c, cv.width, cv.height);
      else {
        c.fillStyle = '#1d1728'; c.fillRect(0, 0, cv.width, cv.height);
        c.fillStyle = '#ffd27a'; c.font = 'bold 24px Georgia, serif'; c.textAlign = 'center';
        c.fillText(g.title, cv.width / 2, cv.height / 2 + 8);
      }
      // 창 어디를 더블클릭해도 방송 시작 — ondblclick 대입이라 게임을 바꿔 열어도 안 쌓인다
      $('deskWin').ondblclick = function () { self.start(gameId); };
    },

    // ---------- 방송 시작 ----------
    // 실제 스트리머의 진입 흐름: 게임을 켠다고 바로 화면이 바뀌지 않는다 —
    // "잠시 후 시작합니다" 대기 화면 → 카운트다운 → 장면 전환(스팅어) → 게임.
    // 경제·게임 로직은 _launch 그대로다. 이 함수는 연출만 얹는다.
    start: function (gameId) {
      var g = this.games.filter(function (x) { return x.id === gameId; })[0];
      if (!g) return;
      if (this.phase === 'starting') return; // 카운트다운 중 재진입 방지
      var self = this;
      this.phase = 'starting';
      $('jgsWin').classList.remove('minimized');   // 창이 열리며 방송 준비 화면이 뜬다
      $('appJgs').classList.add('on');
      var pool = SHOW_TITLES[g.id];
      this._showTitle = pool ? pool[Math.floor(Math.random() * pool.length)] : g.tagline;
      // 게임별 아트는 여기서부터 내려받는다 (지연 로드) — 카운트다운 ~2.4초가 로드를 가리고,
      // 그래도 늦은 이미지는 각 게임의 imgReady 벡터 폴백이 받는다. 첫 화면 payload 절약.
      if (g.preload) { try { g.preload(); } catch (e) {} }

      $('overlay').classList.remove('hidden');
      $('overlay').innerHTML = '<div class="startSoon">' +
        '<div class="ssTop">STARTING SOON</div>' +
        '<h2>잠시 후 방송이 시작됩니다</h2>' +
        '<div class="ssGame"><span class="cat">' + g.title + '</span> ' + this._showTitle + '</div>' +
        '<div class="ssCount" id="ssCount">3</div>' +
        '<div class="ssHint">방송 준비 중 — 마이크·송출 확인</div>' +
        '</div><div id="stinger"></div>';
      Chat.reset();
      Chat.sys('— 방송 대기 화면 —');
      $('tallyR').textContent = '준비 중';

      var n = 3;
      var tick = function () {
        if (n <= 0) {
          // OBS 장면 전환 — 보라 와이프가 화면을 훑고 지나가며 게임이 드러난다
          var st = $('stinger');
          if (st) { st.classList.add('go'); }
          setTimeout(function () { self._launch(gameId); }, 340);
          return;
        }
        var el = $('ssCount');
        if (el) { el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
        n--;
        self._startTimer = setTimeout(tick, 700);
      };
      tick();
    },

    _launch: function (gameId) {
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
      $('camBox').classList.remove('hidden');
      this._camMood = 'silence'; $('camImg').src = 'games/shell/faces/adventurer_silence.png';
      this._graph = [{ t: 0, v: g.startViewers }]; this._graphT = 0; this._upT = 0;
      this.updateTopbar();

      Chat.reset();
      Chat.load(g.chat.T, g.chat.BURST);
      if (window.JongLLM) JongLLM.newShow(); // LLM 호출 예산은 방송 단위로 리셋
      Chat.sys('— 생방송 시작 · ' + g.title + ' —');

      // 플랫폼 정보줄 — 제목·카테고리·라이브 점등
      $('infoTitle').textContent = this._showTitle || g.tagline;
      $('infoCat').textContent = g.title;
      $('infoDot').className = 'on';
      $('obsDot').classList.add('live');

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
        // C3 — 채팅·캠은 관측만 한다. emit은 단방향이고 반환값이 없다
        emit: function (ev, facts) { self.camReact(ev); Chat.react(ev, facts); },
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
      var v = Math.ceil(this.viewers).toLocaleString();
      $('viewerCount').textContent = v;
      $('infoViewers').textContent = v;
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

    // ---------- 방송 사고 ----------
    // 게임 한 판의 예외가 rAF 루프(=방송 전체)를 죽이면 안 된다. step/draw에서 잡아
    // 여기로 보낸다 — 정산까지 마친 뒤 죽은 게임은 버린다 (더 밟지도, 그리지도 않는다).
    _crash: function (e) {
      console.error('[shell] 게임 예외 — 방송사고로 정산:', e);
      if (this.phase === 'live') this.endShow('crash');
      this.inst = null;
    },

    // ---------- 방송 종료·정산 ----------
    endShow: function (reason) {
      if (this.phase !== 'live') return; // 이중 종료 방지 (H-2)
      this.phase = 'result';
      var g = this.game, final = Math.round(this.viewers);

      Chat.sys(reason === 'dead' ? '— 방송 강제 종료 —'
        : reason === 'crash' ? '— 게임이 응답하지 않아 방송을 종료합니다 —' : '— 방송 종료 —');
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
      this.ch.log.unshift({ g: g.title, v: final, r: isRecord });
      if (this.ch.log.length > 4) this.ch.log.length = 4;
      this.saveChannel();
      this.updateTopbar();

      var nextPct = Math.round(FRESH_MULT[this.ch.fresh[g.id]] * 100);
      var other = this.games.filter(function (o) { return o.id !== g.id; })[0];
      // 사고 난 게임은 summary도 못 믿는다 — 실패하면 통계 없이 정산한다
      var stats = [];
      try { if (this.inst && this.inst.summary) stats = this.inst.summary() || []; } catch (e2) {}
      var rows = stats.map(function (r) { return '<span>' + r[0] + '</span><b>' + r[1] + '</b>'; }).join('');

      var head = reason === 'dead' ? '송출 끊김' : reason === 'crash' ? '게임 튕김' : '방송 리포트';
      var lead = reason === 'dead' ? '시청자가 전부 떠났다. 검은 화면만 남았다.'
        : reason === 'crash' ? '게임이 뻗었다. 급하게 정산하고 방송을 접었다 — 이것도 방송사고다.'
        : reason === 'clear' ? '오늘 방송, 잘 뽑혔다.'
        : g.title + ' 방송이 끝났다. 오늘의 그래프:';

      $('overlay').classList.remove('hidden');
      $('overlay').innerHTML = '<div class="panel">' +
        '<h2>' + head + '</h2><p>' + lead + '</p>' +
        '<canvas id="repGraph" width="620" height="150"></canvas>' +
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
          '<button class="slab" id="btnHub">데스크탑으로 (Esc)</button>' +
        '</div></div>';
      $('btnAgain').onclick = function () { self.start(g.id); };
      $('btnHub').onclick = function () { self.showHub(); };
      this.drawReport($('repGraph'));
      $('camBox').classList.add('hidden');
    },

    // ---------- 루프 ----------
    loop: function (ms) {
      var t = ms / 1000;
      var dt = Math.min(.05, t - this._prevFrame || .016);
      this._prevFrame = t; this.now = t;
      // 데스크탑 시계·정보줄 업타임 — 1초에 한 번이면 충분하다
      if (!this._clockT || t - this._clockT > 1) {
        this._clockT = t;
        var ck = $('dClock');
        if (ck) { var d = new Date(); ck.textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
        if (this.phase === 'live' && this.game) {
          var up = Math.max(0, this.game.duration - this.timeLeft) | 0;
          $('infoUptime').textContent = '업타임 ' + ('0' + ((up / 60) | 0)).slice(-2) + ':' + ('0' + (up % 60)).slice(-2);
        }
      }
      this._shake *= .88; this._flash *= .88;

      if (this.phase === 'live') {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.endShow('time'); }
      }
      if (this.phase === 'live' && this.inst) {
        try { this.inst.step(dt); } catch (e) { this._crash(e); }
      }
      if (this.phase === 'live') {
        // 시청자 그래프 표본 (1초 간격) + 업타임 + 스파크라인
        this._graphT += dt; this._upT += dt;
        if (this._graphT >= 1) {
          this._graphT = 0;
          this._graph.push({ t: this._upT, v: this.viewers });
          if (this._graph.length > 240) this._graph.shift();
          this.drawSpark();
        }
        var up = $('tallyUp');
        if (up) up.textContent = Shell.util.fmtTime(this._upT);
        // 캠 표정은 2.6초 뒤 무표정으로 돌아온다
        if (this._camMood !== 'silence' && this.now - this._camAt > 2.6) {
          this._camMood = 'silence';
          var f = this._camFaces.silence;
          if (f && f.complete) $('camImg').src = f.src;
        }
      }
      this.drainFx();
      this.draw(dt);
      requestAnimationFrame(this.loop.bind(this));
    },

    drawSpark: function () {
      var cv = $('sparkCv'); if (!cv) return;
      var c = cv.getContext('2d'), W2 = cv.width, H2 = cv.height;
      c.clearRect(0, 0, W2, H2);
      var g = this._graph; if (g.length < 2) return;
      var vmax = 1; for (var i = 0; i < g.length; i++) vmax = Math.max(vmax, g[i].v);
      c.strokeStyle = '#ffd27a'; c.lineWidth = 1.5; c.beginPath();
      for (var k = 0; k < g.length; k++) {
        var x = k / (g.length - 1) * (W2 - 2) + 1;
        var y = H2 - 2 - (g[k].v / vmax) * (H2 - 5);
        k ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
    },

    // 방송 리포트의 시청자 추이 그래프 — "숫자가 아니라 방송의 서사"를 보여준다
    drawReport: function (cv) {
      var c = cv.getContext('2d'), W2 = cv.width, H2 = cv.height, g = this._graph;
      c.fillStyle = '#0e0b14'; c.fillRect(0, 0, W2, H2);
      if (g.length < 2) return;
      var vmax = 1, vmaxAt = 0;
      for (var i = 0; i < g.length; i++) if (g[i].v > vmax) { vmax = g[i].v; vmaxAt = i; }
      var X = function (k) { return 8 + k / (g.length - 1) * (W2 - 16); };
      var Y = function (v) { return H2 - 14 - (v / vmax) * (H2 - 34); };
      var fill = c.createLinearGradient(0, 0, 0, H2);
      fill.addColorStop(0, 'rgba(255,180,71,.35)'); fill.addColorStop(1, 'rgba(255,180,71,0)');
      c.beginPath(); c.moveTo(X(0), H2 - 14);
      for (var k = 0; k < g.length; k++) c.lineTo(X(k), Y(g[k].v));
      c.lineTo(X(g.length - 1), H2 - 14); c.closePath();
      c.fillStyle = fill; c.fill();
      c.strokeStyle = '#ffb447'; c.lineWidth = 2; c.beginPath();
      for (var j = 0; j < g.length; j++) j ? c.lineTo(X(j), Y(g[j].v)) : c.moveTo(X(j), Y(g[j].v));
      c.stroke();
      // 피크 마커
      c.fillStyle = '#ffd27a';
      c.beginPath(); c.arc(X(vmaxAt), Y(vmax), 3.5, 0, Math.PI * 2); c.fill();
      c.font = '10px system-ui, sans-serif'; c.textAlign = vmaxAt > g.length * .7 ? 'right' : 'left';
      c.fillText('피크 ' + Math.round(vmax).toLocaleString() + '명', X(vmaxAt) + (vmaxAt > g.length * .7 ? -8 : 8), Y(vmax) - 6);
      c.fillStyle = '#8a8478'; c.textAlign = 'left';
      c.fillText('0:00', 8, H2 - 3);
      c.textAlign = 'right';
      c.fillText(Shell.util.fmtTime(g[g.length - 1].t), W2 - 8, H2 - 3);
    },

    draw: function (dt) {
      var ctx = this.ctx;
      ctx.fillStyle = '#0b0908'; ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate((Math.random() - .5) * this._shake, (Math.random() - .5) * this._shake);
      if (this.inst) {
        try { this.inst.draw(ctx, dt); } catch (e) { this._crash(e); }
      }
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
