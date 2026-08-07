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

  // ---------- 공명 판정층 (ADR-002) ----------
  // 시청자 수는 단일 숫자가 아니라 "누가 보고 있는가"의 분포다. 총량은 게임이 정한 상수
  // 그대로이고(무변경 — critic 4차 승인 보존), 이 층은 그 유입이 어느 원형으로 갈지 배분만
  // 정한다. 결정론 데이터 + 상한이라 C3b(비결정 생성물의 경제 유입 금지) 밖이다.
  // 자극 축: [danger 위험, chaos 파괴, skill 숙련, fun 유머] — resonance-model.md §7.1
  // v = 흥미도(주목 강도, 0~1) / val = 호오(평가 방향, -1~1).
  // 둘을 나누는 것이 이 모델의 뿌리다 — 안전제일은 위험에 "강하게 주목하며 부정적으로"
  // 반응한다(비명도 트래픽이다). 하나로 뭉개면 이 사람은 위험 이벤트에 무반응이어야 한다.
  // 프로레슬링의 heat(관심량) vs face/heel(정렬) 분리와 동형.
  var ARCH = [
    { id: 'thrill', n: '불구경파', c: '#ff8d5a', v: [.9, 1, .2, .6], val: [ .8,  1,  .2,  .6] },
    { id: 'fan',    n: '팬덤',     c: '#ffb0c8', v: [.6, .4, .5, .5], val: [-.5, -.7,  .8,  .5] },
    { id: 'expert', n: '분석가',   c: '#ffd27a', v: [.3, .2, 1, .2],  val: [-.2, -.4,  1,   0 ] },
    { id: 'casual', n: '뜨내기',   c: '#a8c8f0', v: [.5, .5, .4, .8], val: [ .2,  .3,  .2,  .8] },
  ];
  var ARCH_START = [.20, .25, .15, .40]; // 새 채널의 구성 — 아직 색이 없어서 뜨내기가 최다
  var T_ECON = 0.35;  // 경제 기여 임계 — 이만큼 공명해야 유입에 기여한다 (무대 상수)
  var BETA = 0.15;    // 혼합 바닥 — 어떤 원형도 배분 0이 되지 않는다 (단일문화 방지)

  // ---------- 채널 계층 ----------
  // 방송 1회가 끝나도 채널은 남는다. 관객 구성이 이월되지 않으면 10번째 방송이 1번째와
  // 똑같아지고, "채널을 키운다"는 이 게임의 판타지가 성립하지 않는다.
  var MIX_INHERIT = 0.45; // 방송 결과가 채널 색에 반영되는 비율. 1이면 마지막 방송이 색을
                          // 통째로 갈아엎어 "정체성"이 아니라 "최신 방송 표시"가 된다.
                          // 0.45면 같은 장르 2~3회에 확실히 물들고, 한 번으로는 안 뒤집힌다.
  var SUB_BONUS = 0.4;    // 구독자 1명당 시작 시청자 기여
  var SUB_BONUS_CAP = 700; // 상한 — 시작 시청자가 무한정 오르면 언락 페이싱이 무너진다

  // 호오가 정하는 것은 "유입의 질"이다. 부정 공명으로 온 관객은 미워하며 잠깐 보다 떠난다
  // (프로레슬링의 heel heat) — 야유·논란이 트래픽을 부르되 남지는 않는 실제 방송 생리.
  var FICKLE_DECAY = 0.015; // 뜨내기 유입의 초당 이탈률 (반감기 ≈ 46초)
  var FICKLE_MAX = 0.55;    // 한 유입에서 뜨내기가 차지할 수 있는 최대 비율 — 안전판

  // 변이 — 원형에서 태어난 시청자가 전부 똑같으면 단조롭다(소윤 원안). 집계 모델에서는
  // "배분된 몫의 일부가 성향이 가까운 이웃 원형으로 태어난다"로 근사한다.
  // 덤으로 구성비 0인 원형이 영구 사멸하는 흡수 상태도 사라진다.
  var MUT_RATE = 0.12;

  // 탐색 보너스 — 관객이 골고루 모인 방송일수록 구독자가 더 남는다. 방송 중 시청자 수에는
  // 손대지 않고(밸런스 안전) 메타 통화에만 얹는다. 이게 있어야 "포트폴리오 관리"가
  // 관찰이 아니라 전략이 된다 — 없으면 채널 색을 바꿀 이유가 없다.
  var DIV_BONUS = 0.6;

  // 원형 간 성향 근접도 (흥미도 벡터 코사인) — 변이가 아무 데로나 흩어지지 않고
  // "가까운 이웃"으로 흐르게 한다. ARCH가 바뀌면 로드 시 함께 다시 계산된다.
  function computeSim() {
    var m = [], norm = ARCH.map(function (a) {
      return Math.sqrt(a.v[0] * a.v[0] + a.v[1] * a.v[1] + a.v[2] * a.v[2] + a.v[3] * a.v[3]) || 1;
    });
    for (var i = 0; i < ARCH.length; i++) {
      m[i] = [];
      for (var j = 0; j < ARCH.length; j++) {
        if (i === j) { m[i][j] = 0; continue; }
        var d = 0;
        for (var k = 0; k < 4; k++) d += ARCH[i].v[k] * ARCH[j].v[k];
        m[i][j] = Math.max(0, d / (norm[i] * norm[j]));
      }
    }
    return m;
  }
  var SIM = computeSim();

  var Shell = {
    games: [],
    game: null,     // 현재 방송 중인 게임 정의
    inst: null,     // 게임 인스턴스
    stage: null,
    phase: 'hub',   // hub | live | result
    viewers: 0,
    comp: [0, 0, 0, 0],       // 원형별 시청자 — 합이 viewers와 같아야 한다 (불변식)
    compStart: [0, 0, 0, 0],  // 방송 시작 스냅샷 — 리포트의 원형별 순증감용
    fickle: [0, 0, 0, 0],     // 그중 뜨내기 — 부정 공명으로 온 몫. comp[i] 이하가 불변식
    _fickleBorn: 0,           // 이번 방송에 발생한 뜨내기 유입 누계 (리포트 표시용)
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
        // 채널의 색 — 원형별 구성 비율(합 1). 방송이 끝날 때마다 물든다.
        // 구 저장분에는 없으므로 기본값으로 이월 (스키마 마이그레이션)
        mix: (d.mix && d.mix.length === ARCH.length) ? d.mix.slice() : ARCH_START.slice(),
      };
    },
    // 구독자가 데려오는 시작 시청자. 채널이 커질수록 출발선이 높아진다 —
    // 상한이 있는 이유는 이것이 총량에 닿는 유일한 조각이기 때문 (언락 페이싱 보호)
    subBonus: function () {
      return clamp(Math.round(this.ch.subs * SUB_BONUS), 0, SUB_BONUS_CAP);
    },
    // 방송 결과를 채널 색에 반영. 합 1 불변식을 유지한다
    absorbMix: function () {
      var t = this.compTotal(), i, s = 0;
      if (!(t > 0)) return;
      for (i = 0; i < ARCH.length; i++) {
        this.ch.mix[i] = this.ch.mix[i] * (1 - MIX_INHERIT) + (this.comp[i] / t) * MIX_INHERIT;
        s += this.ch.mix[i];
      }
      for (i = 0; i < ARCH.length; i++) this.ch.mix[i] /= s; // 부동소수 드리프트 보정
    },
    mixTop: function () {
      var best = 0;
      for (var i = 1; i < ARCH.length; i++) if (this.ch.mix[i] > this.ch.mix[best]) best = i;
      return ARCH[best];
    },
    // 4색 비율 막대 — 라이브 게이지와 같은 시각 언어로 채널의 색을 보여준다
    mixBar: function (mix) {
      return '<i class="mixbar">' + ARCH.map(function (a, i) {
        return '<i style="flex-grow:' + Math.max(0.01, mix[i]) + ';background:' + a.c +
          '" title="' + a.n + ' ' + Math.round(mix[i] * 100) + '%"></i>';
      }).join('') + '</i>';
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

    // ---------- 공명 배분 (ADR-002 결정 2) ----------
    compTotal: function () { return this.comp[0] + this.comp[1] + this.comp[2] + this.comp[3]; },
    // 채팅 캐스팅이 읽는 유일한 창구. 단방향이다 — 채팅이 되돌려 쓰는 경로는 없다 (C3)
    archShare: function (id) {
      var t = this.compTotal();
      if (!(t > 0)) return 1 / ARCH.length;
      for (var i = 0; i < ARCH.length; i++) if (ARCH[i].id === id) return this.comp[i] / t;
      return 0;
    },
    // 배분 가중치 = 공명이 경제 임계를 넘은 만큼 + 혼합 바닥.
    // 현재 구성비를 곱하지 않는다 — 곱하면 복제자 동역학이 되어 몇 방송 만에 한 원형이
    // 전체를 먹고 되돌릴 수 없게 된다 (검증 실증: 8방송 95%). resonance-model.md §3
    stimWeights: function (stim) {
      var w = [];
      for (var i = 0; i < ARCH.length; i++) {
        var a = ARCH[i].v;
        var res = stim[0] * a[0] + stim[1] * a[1] + stim[2] * a[2] + stim[3] * a[3];
        w[i] = Math.max(0, res - T_ECON) + BETA;
      }
      return w;
    },
    archWeights: function (ev) {
      var stim = (this.game && this.game.chat && this.game.chat.STIM) ? this.game.chat.STIM[ev] : null;
      if (stim) return this.stimWeights(stim);
      // 중립(도네·미태깅) — 현재 구성비대로. 채널의 색을 바꾸지 않는 유입이다
      var w = [], t = this.compTotal();
      for (var i = 0; i < ARCH.length; i++) w[i] = t > 0 ? this.comp[i] / t : 1;
      return w;
    },
    // 변이 — 배분된 몫의 일부가 성향이 가까운 이웃 원형으로 태어난다. 총량은 보존된다.
    // 소윤 원안("한 원형에서 나온 시청자가 전부 같으면 단조롭다")의 집계 근사이자,
    // 구성비 0인 원형이 영원히 되살아나지 못하는 흡수 상태를 없애는 장치이기도 하다.
    mutate: function (part) {
      var out = part.slice(), i, j;
      for (i = 0; i < ARCH.length; i++) {
        var move = part[i] * MUT_RATE;
        if (!(move > 0)) continue;
        var sw = 0;
        for (j = 0; j < ARCH.length; j++) sw += SIM[i][j];
        if (!(sw > 0)) continue;
        out[i] -= move;
        for (j = 0; j < ARCH.length; j++) out[j] += move * SIM[i][j] / sw;
      }
      return out;
    },
    // 유입을 원형별로 나눠 담는다. Σ배분 = total 불변식 (반올림 오차는 최대 가중 원형이 흡수)
    compAdd: function (total, ev) {
      var w = this.archWeights(ev), sw = 0, maxI = 0, i;
      for (i = 0; i < w.length; i++) { sw += w[i]; if (w[i] > w[maxI]) maxI = i; }
      if (!(sw > 0)) { for (i = 0; i < w.length; i++) w[i] = 1; sw = w.length; maxI = 0; }
      var part = [], used = 0;
      for (i = 0; i < w.length; i++) { part[i] = Math.round(total * w[i] / sw); used += part[i]; }
      part[maxI] = Math.max(0, part[maxI] + (total - used));

      // 변이는 "자극에 이끌려 새로 온 사람"에게만 적용한다. 중립 유입(도네·미태깅)은
      // 현재 구성을 그대로 비추는 것이므로 변이를 걸면 신호 없이 구성이 서서히 드리프트한다.
      var stim = (this.game && this.game.chat && this.game.chat.STIM) ? this.game.chat.STIM[ev] : null;
      if (stim) part = this.mutate(part);

      // 호오 — 같은 사건이라도 원형마다 감정의 방향이 다르다. 부정 공명으로 온 몫은
      // "미워하며 잠깐 보는" 뜨내기다 (heel heat). 대참사가 팬덤·분석가를 잠깐 불러 모으되
      // 남기지는 못하는 이유가 여기서 나온다.
      for (i = 0; i < ARCH.length; i++) {
        this.comp[i] += part[i];
        if (!(part[i] > 0) || !stim) continue;
        var vv = ARCH[i].val;
        var vres = stim[0] * vv[0] + stim[1] * vv[1] + stim[2] * vv[2] + stim[3] * vv[3];
        if (vres < 0) {
          var born = part[i] * Math.min(FICKLE_MAX, -vres / 2);
          this.fickle[i] += born;
          this._fickleBorn += born; // 리포트용 — 이번 방송에 "미워하며 본" 관객이 얼마였나
        }
      }
    },
    // 이탈은 중립 — 구성비대로 비례 차감. 손실이 채널의 색까지 바꾸지는 않는다 (규약 2).
    // 뜨내기도 같은 비율로 줄어든다 (fickle ≤ comp 불변식)
    compSub: function (n) {
      var t = this.compTotal();
      if (!(t > 0)) return;
      for (var i = 0; i < ARCH.length; i++) {
        var before = this.comp[i];
        if (!(before > 0)) { this.fickle[i] = 0; continue; }
        var after = Math.max(0, before - n * (before / t));
        this.comp[i] = after;
        this.fickle[i] = Math.min(after, this.fickle[i] * (after / before));
      }
    },
    // 뜨내기는 스스로 빠져나간다 — 조용히 (규약 2). "버즈는 오지만 남지 않는다"
    drainFickle: function (dt) {
      if (this.phase !== 'live') return;
      var out = 0, i;
      for (i = 0; i < ARCH.length; i++) {
        if (!(this.fickle[i] > 0)) continue;
        var d = Math.min(this.fickle[i], this.comp[i], this.fickle[i] * FICKLE_DECAY * dt);
        this.fickle[i] -= d;
        this.comp[i] -= d;
        out += d;
      }
      if (!(out > 0)) return;
      this.viewers = Math.max(0, this.viewers - out);
      this.renderViewers();
      if (this.viewers <= 0) this.endShow('dead');
    },
    fickleTotal: function () { return this.fickle[0] + this.fickle[1] + this.fickle[2] + this.fickle[3]; },
    // 관객이 얼마나 골고루 모였는가 — 정규화 엔트로피 (0 = 한 원형 쏠림, 1 = 완전 균등)
    diversity: function () {
      var t = this.compTotal(), h = 0;
      if (!(t > 0)) return 0;
      for (var i = 0; i < ARCH.length; i++) {
        var p = this.comp[i] / t;
        if (p > 0) h -= p * Math.log(p);
      }
      return h / Math.log(ARCH.length);
    },
    // 허브 카드의 관객 프로필 — 이 게임을 방송하면 누가 특히 모이는가.
    // 자극 평균의 내적으로 구하면 벡터 크기가 큰 원형(불구경파)이 모든 게임에서 이겨
    // 변별이 사라진다(실측). 그래서 ① 실제 배분 산식을 이벤트마다 돌려 버스트 무게로
    // 가중하고 ② 시작 구성비 대비 상대 강세로 본다 — "평소보다 더 오는 사람"이 답이다.
    // 반환: { rel: 원형별 상대 강세(1 = 평범), top: 최다 원형 }
    // ⚠ 현재 3게임은 프로필이 서로 비슷하다(전부 "위험→큰 보상" 구조). 그래서 라벨 하나로
    //   단정하지 않고 막대로 그대로 보여준다 — 갈라지면 갈라진 대로 보이는 게 정직하다.
    //   STIM 태깅으로 게임 색을 더 벌리는 것은 기획(소윤) 튜닝 과제다.
    archProfile: function (g) {
      var S = (g.chat && g.chat.STIM) || {}, B = (g.chat && g.chat.BURST) || {};
      var keys = Object.keys(S), acc = [0, 0, 0, 0], i, k;
      if (!keys.length) return null;
      for (k = 0; k < keys.length; k++) {
        var w = this.stimWeights(S[keys[k]]), sw = 0;
        for (i = 0; i < ARCH.length; i++) sw += w[i];
        var mult = B[keys[k]] || 1; // 큰 사건일수록 방송의 색을 더 많이 정한다
        for (i = 0; i < ARCH.length; i++) acc[i] += mult * w[i] / sw;
      }
      var tot = 0, rel = [], best = null;
      for (i = 0; i < ARCH.length; i++) tot += acc[i];
      for (i = 0; i < ARCH.length; i++) {
        rel[i] = (acc[i] / tot) / ARCH_START[i];
        if (!best || rel[i] > best.s) best = { a: ARCH[i], s: rel[i] };
      }
      return { rel: rel, top: best.a };
    },

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
      this.showHub();
      requestAnimationFrame(this.loop.bind(this));
    },

    // ---------- 스트리머 캠 (연출 전용 — C3: 게임 수치와 무관) ----------
    // 게임이 emit하는 이벤트 이름을 표정으로 번역한다. 새 게임이 기존 이름을 재사용하면
    // 캠은 공짜로 따라온다 — 목록에 없는 이벤트는 무표정 유지 (contract 4.2 참고).
    CAM_MOOD: {
      surprise: ['accident', 'oilfire', 'player_hit', 'new_foe', 'fall'],
      panic: ['disaster', 'fall_legend', 'fall_big', 'wipe', 'near_death'],
      aha: ['rescue', 'rescue_big', 'clutch', 'crit', 'comeback', 'summit', 'unlock',
            'enemy_ko', 'ultra_hit', 'risky_hit', 'advantage', 'revive', 'donation', 'done'],
      confusion: ['fail', 'miss', 'faint', 'disadvantage', 'safe_spam'],
      thinking: ['nag', 'stuck', 'idle'],
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
      this.comp = [0, 0, 0, 0];
      this.fickle = [0, 0, 0, 0];
      this.renderComp();
      Chat.reset();
      Chat.sys('— 방송 대기 중 —');

      $('camBox').classList.add('hidden');
      $('tallyUp').textContent = '';
      this.updateTopbar();

      var self = this;
      var cards = this.games.map(function (g) {
        var step = self.freshStep(g.id), fm = FRESH_MULT[step], pct = Math.round(fm * 100);
        var best = self.ch.best[g.id] || 0;
        // 이 게임이 어떤 관객을 부르는가 — 고르기 전에 알 수 있어야 포트폴리오가 전략이 된다
        var prof = self.archProfile(g);
        var profHtml = prof ? '<div class="gaud"><span>관객 프로필</span>' +
          '<i class="gaudbar">' + ARCH.map(function (a, i) {
            return '<i style="flex-grow:' + Math.max(0.01, prof.rel[i]) + ';background:' + a.c +
              '" title="' + a.n + ' ×' + prof.rel[i].toFixed(2) + '"></i>';
          }).join('') + '</i>' +
          '<b style="color:' + prof.top.c + '">' + prof.top.n + '</b></div>' : '';
        return '<button class="gcard" data-game="' + g.id + '">' +
          '<div class="gthumbWrap"><canvas class="gthumb" data-thumb="' + g.id + '" width="228" height="104"></canvas>' +
            '<span class="golive">● 방송 시작</span></div>' +
          '<div class="gt">' + g.title + '</div>' +
          '<div class="gd">' + g.tagline + '</div>' +
          profHtml +
          '<div class="gf' + (fm < 1 ? ' warn' : '') + '"><span>시청자 신선도</span><b>' + pct + '%</b></div>' +
          '<div class="freshbar"><i class="' + (fm < 1 ? 'warn' : '') + '" style="width:' + pct + '%"></i></div>' +
          '<div class="gf"><span>' + (fm < 1 ? '물렸다 — 다른 게임이 회복시킨다' : '지금이 방송 적기') + '</span>' +
            (best ? '<b>최고 ' + best.toLocaleString() + '</b>' : '') + '</div>' +
          '</button>';
      }).join('');

      var recent = this.ch.log.length
        ? '<div class="recent"><div class="rlab">최근 방송</div>' + this.ch.log.map(function (r) {
            return '<div class="rrow"><span>' + r.g + '</span><span><b>' + r.v.toLocaleString() + '</b>명' +
              (r.r ? '<span class="rec">★ 신기록</span>' : '') + '</span></div>';
          }).join('') + '</div>'
        : '';

      // 채널이 지금 어떤 색이고 출발선이 어디인가 — 게임을 고르기 전에 보여야 선택이 전략이 된다
      var hubTop = this.mixTop(), hubBonus = this.subBonus();

      $('overlay').classList.remove('hidden');
      $('overlay').innerHTML = '<div class="panel hub">' +
        '<div class="hubTop">' +
          '<img class="hubCam" src="games/shell/faces/adventurer_silence.png" alt="스트리머">' +
          '<div><h2>방송 준비</h2>' +
          '<p>당신은 종합게임 스트리머다. 카테고리를 고르면 송출이 시작되고, <b>AI 시청자</b>가 ' +
          '플레이를 실시간으로 관측하며 떠든다 — 칭찬, 야유, 훈수.</p>' +
          '<div class="chanline">📺 <b>종겜러</b> 채널 · 구독자 <b>' + this.ch.subs.toLocaleString() + '</b>명 · ' +
            '방송 <b>' + this.ch.shows + '</b>회' +
            (hubBonus > 0 ? ' · 구독자가 데려오는 시작 관객 <b>+' + hubBonus.toLocaleString() + '</b>명' : '') + '</div>' +
          '<div class="chanmix"><span>채널 색깔</span>' + this.mixBar(this.ch.mix) +
            '<b style="color:' + hubTop.c + '">' + hubTop.n + ' 채널</b></div></div>' +
        '</div>' +
        '<div id="hubGrid">' + cards + '</div>' +
        '<p class="fine">시청자 수가 곧 체력이자 점수다 — 0명이 되면 송출이 끊긴다. ' +
        '그리고 <b>같은 게임만 파면 물린다</b>. 그래서 종겜을 하는 것이다.</p>' +
        recent + '</div>';

      // 카드 썸네일 — 게임이 자기 미리보기를 그린다 (thumb 없으면 타이틀 카드)
      this.games.forEach(function (g) {
        var cv = $('overlay').querySelector('[data-thumb="' + g.id + '"]');
        if (!cv) return;
        var c = cv.getContext('2d');
        if (g.thumb) g.thumb(c, cv.width, cv.height);
        else {
          c.fillStyle = '#1d1728'; c.fillRect(0, 0, cv.width, cv.height);
          c.fillStyle = '#ffd27a'; c.font = 'bold 18px Georgia, serif'; c.textAlign = 'center';
          c.fillText(g.title, cv.width / 2, cv.height / 2 + 6);
        }
      });
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
      // 시작 시청자 = 게임 기본값 + 구독자 기여분, 관객 구성은 채널의 색을 물려받는다.
      // 이월이 없으면 10번째 방송이 1번째와 똑같아진다 — 채널이 성장하지 않는다
      var start0 = g.startViewers + this.subBonus();
      this.viewers = start0;
      this.comp = this.ch.mix.map(function (r) { return start0 * r; });
      this.compStart = this.comp.slice();
      this.fickle = [0, 0, 0, 0];
      this._fickleBorn = 0;
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
      this._graph = [{ t: 0, v: start0 }]; this._graphT = 0; this._upT = 0;
      this.updateTopbar();

      Chat.reset();
      Chat.load(g.chat.T, g.chat.BURST);
      if (window.JongLLM) JongLLM.newShow(); // LLM 호출 예산은 방송 단위로 리셋
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
        // ev는 총량이 아니라 배분에만 쓰인다 (ADR-002 결정 2 — 총량 산식 무변경).
        // 생략하면 중립 배분이라 기존 호출은 그대로 동작한다 (contract 4.2)
        gain: function (n, label, ev) {
          if (!(n > 0) || self.phase !== 'live') return 0;
          var actual = Math.max(1, Math.round(n * self.freshMult(self.game.id)));
          self.viewers += actual;
          self.compAdd(actual, ev);
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
      var el = $('viewerCount');
      if (el) el.textContent = Math.ceil(this.viewers).toLocaleString(); // 검사 하네스에는 DOM이 없다
      this.renderComp();
    },
    // 관객 구성 게이지 — "지금 누가 보고 있는가"를 색으로. 콘텐츠 선택이 관객을 바꾼다는 게
    // 숫자가 아니라 눈으로 읽혀야 포트폴리오 관리가 전략이 된다
    renderComp: function () {
      var el = $('compBar');
      if (!el) return;
      var t = this.compTotal();
      if (!(t > 0)) { el.innerHTML = ''; return; }
      var html = '';
      for (var i = 0; i < ARCH.length; i++) {
        html += '<i style="flex-grow:' + Math.max(0.0001, this.comp[i]) + ';background:' + ARCH[i].c +
          '" title="' + ARCH[i].n + ' ' + Math.round(this.comp[i] / t * 100) + '%"></i>';
      }
      el.innerHTML = html;
    },
    loseViewers: function (n) {
      if (this.phase !== 'live' || !(n > 0)) return;
      this.viewers = Math.max(0, this.viewers - n);
      this.compSub(n);
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

      // 방송이 채널의 색을 물들인다 — 이월의 핵심. 저장 전에 반영한다
      var mixBefore = this.ch.mix.slice();
      this.absorbMix();

      // 탐색 보너스 — 관객이 골고루 모인 방송일수록 구독자가 더 남는다.
      // 방송 중 시청자 수에는 손대지 않고 메타 통화에만 얹으므로 승인 밸런스와 충돌하지
      // 않으면서, "채널 색을 관리할 이유"가 처음으로 생긴다 (ADR-002 결정 7)
      var div = this.diversity(), divMult = 1 + DIV_BONUS * div;
      var newSubs = Math.floor(final / 100 * divMult); // 최종 시청자의 1% × 다양성
      this.ch.subs += newSubs;
      this.ch.shows++;
      this.ch.log.unshift({ g: g.title, v: final, r: isRecord });
      if (this.ch.log.length > 4) this.ch.log.length = 4;
      this.saveChannel();
      this.updateTopbar();

      // 원형별 순증감 — "오늘 방송이 어떤 사람들을 데려왔나"가 리포트의 새 축이다
      var archRows = ARCH.map(function (a, i) {
        var d = Math.round(self.comp[i] - self.compStart[i]);
        return '<span style="color:' + a.c + '">' + a.n + '</span> <b>' +
          (d >= 0 ? '+' : '') + d.toLocaleString() + '</b>';
      }).join(' · ');

      // 채널이 어느 쪽으로 물들었나 + 다음 출발선 — "방송이 채널에 남는다"를 보여주는 두 줄
      var mixTop = this.mixTop();
      var movedI = 0, mixD = this.ch.mix.map(function (v, i) { return v - mixBefore[i]; });
      for (var mi = 1; mi < ARCH.length; mi++) if (mixD[mi] > mixD[movedI]) movedI = mi;
      var moved = ARCH[movedI], movedD = mixD[movedI];
      var bonus = this.subBonus();
      var nextStart = g.startViewers + bonus;
      var fickleBorn = Math.round(this._fickleBorn);

      var nextPct = Math.round(FRESH_MULT[this.ch.fresh[g.id]] * 100);
      var other = this.games.filter(function (o) { return o.id !== g.id; })[0];
      var stats = (this.inst && this.inst.summary) ? this.inst.summary() : [];
      var rows = stats.map(function (r) { return '<span>' + r[0] + '</span><b>' + r[1] + '</b>'; }).join('');

      var head = reason === 'dead' ? '송출 끊김' : '방송 리포트';
      var lead = reason === 'dead' ? '시청자가 전부 떠났다. 검은 화면만 남았다.'
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
          '<span>채널 구독자</span><b>+' + newSubs.toLocaleString() + ' → ' + this.ch.subs.toLocaleString() + '명' +
            ' <span class="' + (divMult >= 1.3 ? 'rec' : 'fine') + '">다양성 ×' + divMult.toFixed(2) + '</span></b>' +
        '</div>' +
        '<div class="archline">오늘 모인 사람들 — ' + archRows +
          (fickleBorn >= 10 ? '<br><span class="fine">이 중 <b>' + fickleBorn.toLocaleString() +
            '명</b>은 야유하러 온 뜨내기였다 — 버즈는 오지만 남지 않는다</span>' : '') + '</div>' +
        '<div class="chanmix"><span>채널 색깔</span>' + this.mixBar(this.ch.mix) +
          '<b style="color:' + mixTop.c + '">' + mixTop.n + ' 채널</b></div>' +
        '<p class="fine">이번 방송으로 <b style="color:' + moved.c + '">' + moved.n + '</b> 비중이 ' +
          (movedD >= 0.005 ? '늘었다' : '거의 그대로다') + ' · 다음 방송은 <b>' +
          nextStart.toLocaleString() + '명</b>에서 시작한다' +
          (bonus > 0 ? ' (구독자 기여 +' + bonus.toLocaleString() + ')' : '') + '</p>' +
        '<p class="fine">다음 <b>' + g.title + '</b> 방송의 신선도는 <b>' + nextPct + '%</b>' +
          (nextPct < 100 && other ? ' — <b>' + other.title + '</b>을(를) 한 번 방송하면 회복된다. 이게 종겜을 하는 이유다.' : '.') +
        '</p>' +
        '<div class="btnrow">' +
          '<button class="slab primary" id="btnAgain">다시 방송 (R)</button>' +
          '<button class="slab" id="btnHub">게임 고르러 가기 (Esc)</button>' +
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
      this._shake *= .88; this._flash *= .88;

      if (this.phase === 'live') {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.endShow('time'); }
      }
      if (this.phase === 'live' && this.inst) this.inst.step(dt);
      if (this.phase === 'live') this.drainFickle(dt); // 뜨내기는 스스로 빠져나간다
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
  Shell.ARCH = ARCH;               // 채팅 캐스팅·selftest·샌드박스가 읽는다 (읽기 전용)
  Shell.ARCH_START = ARCH_START;
  Shell.SIM = SIM;
  // 샌드박스에서 흥미도 벡터를 슬라이더로 만지면 근접도도 따라 바뀌어야 한다
  Shell.recomputeSim = function () { SIM = computeSim(); Shell.SIM = SIM; };
  // 판정층 상수 — 무대 소유(ADR-002 결정 4). 도구·검사가 읽는다
  Shell.TUNE = {
    T_ECON: T_ECON, BETA: BETA, MIX_INHERIT: MIX_INHERIT,
    SUB_BONUS: SUB_BONUS, SUB_BONUS_CAP: SUB_BONUS_CAP,
    FICKLE_DECAY: FICKLE_DECAY, FICKLE_MAX: FICKLE_MAX, MUT_RATE: MUT_RATE, DIV_BONUS: DIV_BONUS,
  };
  global.Shell = Shell;
})(window);
