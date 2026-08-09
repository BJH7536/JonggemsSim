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
  // 이모지 대체 미니 아이콘 (AetherAI — "시각 요소 전부 생성물" 방침)
  var STAR = '<img class="uiIco star" src="games/shell/img/ui-star.png" alt="★">';
  var LOCK = '<img class="uiIco lock" src="games/shell/img/ui-lock.png" alt="잠금">';
  var COIN = '<img class="uiIco" src="games/shell/img/ui-coin.png" alt="코인">';

  var W = 960, H = 430;
  var STORE_KEY = 'jonggems-channel-v1';

  // 규약 4 (게임 단위 확장): 같은 게임을 연속으로 방송하면 시청자가 물린다.
  // 회복은 "다른 게임 1회 방송당 1단계" — 게임이 2종뿐이라 회복 조건을 더 빡세게 잡으면
  // 감쇠가 편도가 되어 종겜 플레이를 오히려 벌준다. 번갈아 방송하면 100%가 유지되는 게 의도다.
  var FRESH_MULT = [1, .7, .45, .25, .1];

  // 방송 제목 풀 — 순수 연출. 실제 종겜 스트리머의 "오늘의 각오" 제목 감성.
  // 게임 id 로 찾고, 없으면 태그라인을 쓴다 (새 게임이 등록돼도 깨지지 않는다).
  // 툴팁 대표컷 — 게임의 실제 배경 아트 (AetherAI, 각 게임이 인게임에서 쓰는 그 컷).
  // 화력쇼는 배경 아트가 없어 벡터 thumb 폴백. 새 게임이 목록에 없어도 깨지지 않는다.
  var TIP_ART = {
    'giving-up': 'games/giving-up/img/sky-bg.jpg',
    pocket: 'games/pocket/img/arena-bg.jpg',
    fishing: 'games/fishing/img/sea-bg.jpg',
    bomb: 'games/bomb/img/bench-bg.jpg',
  };

  var SHOW_TITLES = {
    hwaryeok: ['불 좀 끄고 올게요', '오늘 대참사 0회 도전', '4구 풀가동 각입니다'],
    'giving-up': ['오늘 정상 못 가면 삭발', '항아리 유산소 하는 날', '떨어질수록 커집니다'],
    pocket: ['빈사 역전만 노립니다', '연승 끊기면 바로 자야죠', '명중 38%를 믿습니다'],
    fishing: ['오늘 나락의군주 잡습니다', '심해만 팝니다 얕은물 금지', '줄 끊기면 낚싯대 삽니다'],
    bomb: ['판독 없이 갑니다', '오늘 폭발 0회 도전(안 지킴)', '감으로 자르는 남자'],
  };

  // ---------- 공명 판정층 (ADR-004) ----------
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
    _tutT: [],                      // 튜토리얼 예약 타이머 — 허브로 돌아가면 전부 취소한다
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
        coins: d.coins || 0,        // 도네 코인 잔액 — 방송 정산 때 적립, 상점에서 소비
        gear: d.gear || {},         // 보유 방송용품 itemId -> true (전부 순수 장식 — 능력 강화 금지)
        day: d.day || 1,            // 시즌 N일차 — 방송 한 판·휴방 한 번이 각각 하루 (Shell.CAMPAIGN)
        plays: d.plays || {},       // gameId -> 방송 횟수 — 다음 게임 해금의 재료
        rig: d.rig || {},           // 방송 장비 레벨 {feed, stage, don} 각 0~3 (ADR-008)
        parts: d.parts || 0,        // 장비 부품 — 미션 보상에서만 나온다 (코인으로 못 산다)
        donHist: d.donHist || [],   // 직전 3회 도네 수입 — 장비 유지비의 기준
        tier: d.tier || 0,          // 파트너 등급 0~4 (브론즈~다이아) — 내려가지 않는다
        tierPts: d.tierPts || 0,    // 등급 게이지 — C/D가 조용히 깎는 유일한 수치 (규약 2)
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
      var tc = $('tbCoins'); if (tc) tc.textContent = this.ch.coins.toLocaleString();
      var tt = $('tbTier');
      if (tt) {
        var T = Shell.TIERS[this.ch.tier || 0];
        tt.textContent = T.n + ' 파트너';
        tt.style.color = T.c;
      }
      var live = this.phase === 'live';
      $('tbLive').textContent = live ? '● LIVE' : 'OFFLINE';
      $('tbLive').className = live ? 'on' : 'off';
      this.renderDay();
    },

    // 시즌 종료 — 목표 달성이든 기간 만료든 여기서 끝난다. 데스크탑 위를 덮는다
    // (허브에서는 JGS 창이 최소화라 #overlay가 안 보인다).
    showSeasonEnd: function (c) {
      var el = $('seasonEnd');
      if (!el) return;
      var clear = c.state === 'clear';
      el.innerHTML = '<div class="isPanel' + (clear ? ' win' : '') + '">' +
        '<b class="isLogo">JGS<span>.tv</span></b>' +
        '<h1>' + (clear ? '재계약' : '계약 종료') + '</h1>' +
        '<p>' + c.days + '일 계약, ' + Math.min(c.day, c.days) + '일차 · 최고 시청자 <b>' +
          c.best.toLocaleString() + '명</b> / 목표 ' + c.goal.toLocaleString() + '명</p>' +
        '<p>' + (clear
          ? '김 피디가 새 계약서를 내밀었다. <b>뜬 것이다.</b>'
          : '목표까지 <b>' + (c.goal - c.best).toLocaleString() + '명</b> 모자랐다. 김 피디는 아무 말도 하지 않았다.') +
        '</p>' +
        '<p class="isSub">새 시즌을 시작하면 채널 기록·해금·도감이 전부 초기화된다.</p>' +
        '<button id="seasonAgain" type="button" class="slab primary">새 시즌 시작</button>' +
        '</div>';
      el.classList.remove('hidden');
      $('seasonAgain').onclick = function () {
        // 채널과 도감을 함께 지운다 — 한쪽만 남으면 1일차인데 캐스트가 만렙인 채널이 된다
        try { localStorage.removeItem(STORE_KEY); localStorage.removeItem('jgs-dex-v1'); } catch (e) {}
        location.reload();
      };
    },

    // 시즌 표시 — 화면 상단 중앙에 항상 떠 있다 (허브에서도, 방송 중에도).
    // 남은 날이 곧 압박이라 숨기면 30일 제한이 존재하지 않는 것과 같다.
    renderDay: function () {
      var el = $('dayChip');
      if (!el) return;
      var c = Shell.campaign(this.ch);
      // c.left는 오늘을 포함한 남은 일수 — 마감 당일이 D-DAY다 (D-Day 관용)
      var dd = c.left - 1;
      el.className = c.left <= 3 ? 'last' : '';
      el.innerHTML =
        '<div class="dcTop"><b class="dcDday">' + (dd > 0 ? 'D-' + dd : 'D-DAY') + '</b>' +
        '<span class="dcOf">시즌 ' + Math.min(c.day, c.days) + '일차 / ' + c.days + '일 계약</span></div>' +
        '<i class="dcBar"><i style="width:' + c.pct.toFixed(1) + '%"></i></i>' +
        '<span class="dcGoal">최고 <b>' + c.best.toLocaleString() + '</b> / 목표 ' +
          c.goal.toLocaleString() + '명</span>';
      // 미션 쪽지 바로 아래에 붙인다 — 쪽지 높이는 미션 수에 따라 변해서 실측이 맞다
      var pd = document.querySelector('.pdNote');
      el.style.top = pd ? Math.round(pd.getBoundingClientRect().bottom + 14) + 'px' : '';
    },
    saveChannel: function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.ch)); } catch (e) {}
    },
    freshStep: function (id) { return this.ch.fresh[id] || 0; },
    freshMult: function (id) { return FRESH_MULT[this.freshStep(id)]; },

    // ---------- 공명 배분 (ADR-004 결정 2) ----------
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
    // 유입을 원형별로 나눠 담는다. Σ배분 = total 불변식 (최대잔여법으로 구조적으로 보장)
    compAdd: function (total, ev) {
      var w = this.archWeights(ev), sw = 0, i;
      for (i = 0; i < w.length; i++) sw += w[i];
      if (!(sw > 0)) { for (i = 0; i < w.length; i++) w[i] = 1; sw = w.length; }
      // 최대잔여법 — floor로 깔고 남은 몫을 잔여가 큰 순서로 1씩 나눠준다.
      // Σ배분 = total이 구조적으로 보장되므로 clamp가 필요 없다.
      // (이전 구현은 반올림 잔차를 최대 가중 원형에 몰아주고 max(0,…)로 잘랐는데, 잔차가
      //  음수이고 그 몫이 더 작으면 clamp가 삼킨 만큼 합이 늘었다 — total=2·균등 가중치에서
      //  합 3. 실제 게임에서는 도달 불가한 잠복 결함이었고 현재의 PR #4 리뷰가 잡았다.)
      var part = [], rem = [], used = 0;
      for (i = 0; i < w.length; i++) {
        var exact = total * w[i] / sw;
        part[i] = Math.floor(exact);
        rem[i] = exact - part[i];
        used += part[i];
      }
      var left = total - used, b;
      while (left >= 1) {
        b = 0;
        for (i = 1; i < rem.length; i++) if (rem[i] > rem[b]) b = i;
        part[b]++; rem[b] -= 1; left -= 1;
      }
      if (left > 1e-9) { // total이 정수가 아닐 때의 잔차 — 지금 호출부는 정수지만 방어
        b = 0;
        for (i = 1; i < rem.length; i++) if (rem[i] > rem[b]) b = i;
        part[b] += left;
      }

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
      this._donQ = []; this._donBusy = false;      // 도네 배너 큐 (규약 3 — 간격 방출)
      this._marks = []; this._shownV = 0; this._lastGainAt = 0;
      if (window.JongLLM) JongLLM.init($('chatBadge'));
      if (Shell.Crowd) Shell.Crowd.init(); // 시청자 100종 중 88명을 발화층에 합류 (관측단 제외)
      if (Shell.Dex) Shell.Dex.init(); // 영입된 캐스트를 채팅에 복원 (ADR-006)
      if (Shell.Clips) Shell.Clips.init(); // 보관된 클립 개수 (아이콘 배지용)
      this.applyGear(); // 보유 방송용품(장식)을 화면에 반영
      var self2 = this;
      $('followBtn').addEventListener('click', function () {
        self2.showTicker('본인 채널은 팔로우할 수 없습니다', true);
      });
      // 도네 읽어주기 — 배너가 떠 있는 3.4초 동안만 클릭이 통한다 (CSS pointer-events)
      $('donBanner').addEventListener('click', function () { self2.readDonation(); });
      // 인트로 4컷 — 열 때마다 보여준다 (사용자 요청: 1회용 아님). 스토리가 곧 목표 안내다.
      // 한 지면에 4컷. 클릭할 때마다 다음 컷이 왼쪽에서 들어와 쌓이고(이전 컷은 남는다),
      // 4컷이 다 차면 만화가 완성되면서 서명 버튼이 열린다 (사용자 요청).
      var splash = $('introSplash'), cuts = splash.querySelectorAll('.comic figure'), ci = -1;
      function nextCut() {
        cuts[++ci].classList.add('on');
        $('cutNo').textContent = (ci + 1) + ' / ' + cuts.length;
        if (ci === cuts.length - 1) splash.classList.add('done'); // 마지막 컷 = 계약서
      }
      splash.classList.remove('hidden');
      nextCut();
      splash.addEventListener('click', function (e) { // 클릭 = 다음 컷
        if (splash.classList.contains('done') || e.target.id === 'introGo') return;
        nextCut();
      });
      $('introGo').addEventListener('click', function () {
        splash.classList.add('hidden');
      });
      addEventListener('resize', function () { self2.fitHud(); });
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
              'line_snap', 'boom', 'streamer_scream'],
      aha: ['rescue', 'rescue_big', 'clutch', 'crit', 'comeback', 'summit', 'unlock',
            'enemy_ko', 'ultra_hit', 'risky_hit', 'advantage', 'revive', 'donation', 'done',
            'land_big', 'land_legend', 'tension_edge', 'cut_paid', 'defused', 'defused_clutch', 'chain_up',
            'streamer_joy'],
      confusion: ['fail', 'miss', 'faint', 'disadvantage', 'safe_spam',
                  'strike_miss', 'escape', 'trash', 'timeout_boom', 'streamer_selfmock'],
      thinking: ['nag', 'stuck', 'idle', 'scan_reveal'],
      silence: ['streamer_silence'],
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
          if (e.key === 'Escape' && self.phase === 'hub') {
            // 상점 등 데스크탑 위 오버레이가 열려 있으면 먼저 닫는다
            if (!$('overlay').classList.contains('hidden')) self.showHub();
            else self.hideTip();
          }
          return;
        }
        if (e.key === 'Escape') { self.endShow('quit'); return; }
        if (self.inst && self.inst.key) self.inst.key(e);
      });
      var toScene = function (e) {
        // 전체화면(fullshow)에선 캔버스가 object-fit: contain으로 레터박스된다 —
        // 요소 박스가 아니라 실제 그림 영역 기준으로 좌표를 환산해야 조준이 맞는다.
        // 일반 모드에선 박스 비율 = 960:430이라 같은 식으로 수렴한다.
        var r = cv.getBoundingClientRect();
        var sc = Math.min(r.width / W, r.height / H);
        var ox = (r.width - W * sc) / 2, oy = (r.height - H * sc) / 2;
        return { x: (e.clientX - r.left - ox) / sc, y: (e.clientY - r.top - oy) / sc };
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
      document.body.classList.remove('fullshow');
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
      if (Shell.Clips) Shell.Clips.closeUrls(); // 보관함을 닫고 나왔다면 객체 URL 회수 (Esc 경로 포함)
      $('tallyUp').textContent = '';
      $('infoTitle').textContent = '방송 준비 중…';
      $('infoCat').textContent = '대기 화면';
      $('infoDot').className = 'off';
      $('infoUptime').textContent = '';
      $('infoViewers').textContent = '0';
      clearTimeout(this._startTimer);
      this._tutT.forEach(clearTimeout); this._tutT.length = 0;
      this.tutTip('');
      this.updateTopbar();

      var self = this;
      // 바탕화면 아이콘 — 스트리머의 PC라는 은유. 카드 그리드보다 "방송 전"이라는 상태가 읽힌다.
      // 아이콘 아트는 AetherAI 생성물(tools/aether-assets.json)이고, 파일이 없으면
      // 아래 bindHub()가 .noimg 로 떨어뜨려 CSS 타일로 그린다 — 이미지 없이도 기능은 온전하다.
      var icons = this.games.map(function (g) {
        var pct = Math.round(FRESH_MULT[self.freshStep(g.id)] * 100);
        var u = Shell.unlockState(self.ch, g.id);
        // 잠긴 방송도 목록에 남긴다 — 다음에 뭐가 열리는지 보여야 관문이 목표가 된다
        if (!u.open) {
          // disabled를 쓰지 않는다 — 비활성 버튼은 마우스 이벤트를 내지 않아 툴팁(해금 조건)이
          // 안 뜬다. 실제 걸쇠는 start()에 있다
          return '<button class="dIcon locked" data-game="' + g.id + '">' +
            '<span class="dIconArt"><img src="games/shell/img/icon-' + g.id + '.png" alt="">' +
            '<img class="dLock" src="games/shell/img/ui-lock.png" alt="잠김"></span>' +
            '<span class="dIconName">' + g.title + '</span>' +
            // 아이콘 폭(96px)에 들어가야 한다 — 어느 게임에서 따는지는 툴팁이 말한다
            '<span class="dIconNeed">방송 ' + u.have + '/' + u.need + '</span>' +
            '</button>';
        }
        return '<button class="dIcon" data-game="' + g.id + '">' +
          '<span class="dIconArt"><img src="games/shell/img/icon-' + g.id + '.png" alt=""></span>' +
          '<span class="dIconName">' + g.title + '</span>' +
          '<span class="dIconFresh' + (pct < 100 ? ' warn' : '') + '">' + pct + '%</span>' +
          '</button>';
      }).join('');
      // 상점 — 게임이 아니라 데스크탑 앱이다 (더블클릭 = 실행 은유 공유)
      icons += '<button class="dIcon" data-app="shop">' +
        '<span class="dIconArt"><img src="games/shell/img/icon-shop.png" alt=""></span>' +
        '<span class="dIconName">방송용품 상점</span>' +
        '<span class="dIconFresh">' + this.ch.coins.toLocaleString() + '💰</span>' +
        '</button>';
      // 캐스트 영입 (반응 도감) — 구독자·코인을 소비해 채팅 캐스트를 늘린다 (ADR-006)
      if (Shell.Dex) icons += Shell.Dex.deskIcon();
      // 빈 슬롯 — 다음 방송 콘텐츠 자리. 아직 기능이 아니라 방향이라 물음표로 둔다
      icons += '<button class="dIcon" data-app="lab">' +
        '<span class="dIconArt qmark">?</span>' +
        '<span class="dIconName">새 방송 콘텐츠</span>' +
        '<span class="dIconFresh soon">준비 중</span>' +
        '</button>';
      // 클립 보관함 — 지난 방송에서 딴 영상을 다시 본다 (기록 전용)
      if (Shell.Clips) icons += Shell.Clips.deskIcon();

      var recent = this.ch.log.length
        ? '<div class="recent"><div class="rlab">최근 방송</div>' + this.ch.log.map(function (r) {
            return '<div class="rrow"><span>' +
              (r.c ? '<img class="rclip" src="' + r.c + '" alt="" title="클립 — ' + (r.cm || '') + '">' : '') +
              r.g + '</span><span><b>' + r.v.toLocaleString() + '</b>명' +
              (r.r ? '<span class="rec">' + STAR + ' 신기록</span>' : '') + '</span></div>';
          }).join('') + '</div>'
        : '';

      // 창을 최소화하고 바탕화면을 드러낸다 — 방송 전의 스트리머는 데스크탑에 있다
      $('jgsWin').classList.add('minimized');
      $('appJgs').classList.remove('on');
      $('obsDot').classList.remove('live');
      $('overlay').classList.add('hidden');
      $('overlay').innerHTML = '';
      // 김 피디의 미션 쪽지 — 다음 방송의 명시적 목표 (유지 장치). makeMissions는 결정론이라
      // 여기 표시와 _launch 시점 평가가 항상 같은 값을 본다.
      var mis = Shell.makeMissions(this.ch);
      var pdNote = '<div class="pdNote">' +
        '<img src="games/shell/img/kim-pd.png" alt="" onerror="this.style.display=\'none\'">' +
        '<div><div class="rlab">김 피디의 오늘 미션 — <span style="color:' +
        Shell.TIERS[this.ch.tier || 0].c + '">' + Shell.TIERS[this.ch.tier || 0].n + ' 파트너</span></div>' +
        mis.map(function (m) {
          return '<div class="pdnRow">' + m.label + ' <b>' + m.target.toLocaleString() + '</b> · 보상 ' +
            m.reward.toLocaleString() + '코인</div>';
        }).join('') + '</div></div>';

      $('desktop').innerHTML =
        '<div class="deskIcons">' + icons + '</div>' +
        '<div id="dTip"></div>' +
        '<div class="deskBL">' +
        '<div class="deskStat">구독자 <b>' + this.ch.subs.toLocaleString() + '</b> · 방송 <b>' +
          this.ch.shows + '</b>회 · 더블클릭 = 바로 방송</div>' +
        // 채널 색깔 (공명 판정층) — 게임을 고르기 전에 보여야 선택이 전략이 된다
        (typeof this.mixBar === 'function'
          ? '<div class="deskStat chanmix"><span>채널 색깔</span>' + this.mixBar(this.ch.mix) +
            '<b style="color:' + this.mixTop().c + '">' + this.mixTop().n + ' 채널</b></div>'
          : '') +
        // 텐션 (§7) — 게임을 고르기 전에 보여야 "쉴까 방송할까"가 전략이 된다. 회복은 휴방뿐
        (Shell.Dex
          ? '<div class="deskStat simTension' + (Shell.Dex.tension() <= 30 ? ' low' : '') + '">텐션 <b>' +
            Math.round(Shell.Dex.tension()) + '%</b><span class="tenNote">' +
            (Shell.Dex.tension() <= 30 ? '지쳤다 — 새 반응(파장)이 잘 나오지 않는다' : '파장 대역폭 ×' +
              Shell.Dex.tensionMult().toFixed(2)) + '</span>' +
            (Shell.Dex.tension() < 100 ? '<button id="restBtn" type="button">휴방 (+25)</button>' : '') +
            '</div>'
          : '') +
        '</div>' + recent + pdNote;

      this.bindHub();
      this.renderDay(); // 쪽지가 새로 그려졌으니 D-Day 위젯도 그 아래로 다시 맞춘다
      // 시즌 판정은 허브 복귀 시점 한 곳에서만 — 방송 종료도 휴방도 결국 여기로 온다
      var camp = Shell.campaign(this.ch);
      if (camp.state !== 'run') this.showSeasonEnd(camp);
      // 아직 한 번도 방송한 적 없으면 첫 게임 아이콘에 코치마크 — 진입까지 헤매지 않게
      if (!this.ch.shows) {
        var first = $('desktop').querySelector('.dIcon');
        if (first) {
          first.classList.add('coach');
          first.insertAdjacentHTML('beforeend', '<span class="coachTip">더블클릭 = 방송 시작</span>');
        }
      }
    },

    // 아이콘 아트가 없으면(아직 생성 전) CSS 타일로 대체한다 — 이미지 유무가 기능을 막지 않는다
    bindHub: function () {
      var self = this, root = $('desktop');
      root.querySelectorAll('.dIcon img').forEach(function (im) {
        im.addEventListener('error', function () { im.closest('.dIcon').classList.add('noimg'); });
        if (im.complete && im.naturalWidth === 0) im.closest('.dIcon').classList.add('noimg');
      });
      var icons = root.querySelector('.deskIcons');
      icons.addEventListener('click', function (e) {
        var btn = e.target.closest('.dIcon');
        if (!btn) return;
        root.querySelectorAll('.dIcon').forEach(function (b) { b.classList.toggle('on', b === btn); });
        if (btn.hasAttribute('data-game')) self.showTip(btn); // 터치 환경 대비 — 클릭으로도 뜬다
      });
      // 설명은 창이 아니라 호버 툴팁이다 — 아이콘에 올리면 옆에 뜨고, 벗어나면 사라진다.
      // 창처럼 화면을 덮지 않으므로 다른 아이콘 클릭을 막지 않는다 (사용자 피드백).
      icons.addEventListener('mouseover', function (e) {
        var btn = e.target.closest('[data-game]');
        if (btn) self.showTip(btn);
      });
      icons.addEventListener('mouseout', function (e) {
        var btn = e.target.closest('[data-game]');
        if (btn && !(e.relatedTarget && btn.contains(e.relatedTarget))) self.hideTip();
      });
      // 실제 데스크탑처럼 더블클릭은 곧장 실행이다 — 카운트다운을 거쳐 방송이 켜진다
      icons.addEventListener('dblclick', function (e) {
        var btn = e.target.closest('.dIcon');
        if (!btn) return;
        if (btn.hasAttribute('data-game')) self.start(btn.getAttribute('data-game'));
        else if (btn.getAttribute('data-app') === 'shop') self.openShop();
        else if (btn.getAttribute('data-app') === 'cast' && Shell.Dex) Shell.Dex.openPanel();
        else if (btn.getAttribute('data-app') === 'clips' && Shell.Clips) Shell.Clips.openPanel();
        else if (btn.getAttribute('data-app') === 'lab') self.openLab();
      });
      // 휴방 (§7) — 하루를 쉬고 텐션을 회복한다. 시청자 수에는 아무 일도 일어나지 않는다
      var rest = $('restBtn');
      if (rest) rest.addEventListener('click', function () {
        Shell.Dex.rest();
        Shell.advanceDay(self.ch);  // 쉬는 것도 하루를 쓴다 — 공짜면 텐션 관리가 선택이 아니다
        self.saveChannel();
        self.showHub(); // 텐션·시즌 표시 갱신
        self.showTicker('휴방했다 — 컨디션이 돌아온다 (텐션 ' + Math.round(Shell.Dex.tension()) + '%)');
      });
    },

    // 게임 설명 툴팁 — 창이 아니라 아이콘 옆 팝업이다 (사용자 피드백: 창은 다른 아이콘을
    // 가린다). 호버로 열리고 벗어나면 닫힌다. pointer-events가 없어 클릭을 막지 않는다.
    // 기존 카드가 보여주던 정보(썸네일·태그라인·신선도·최고 기록)를 그대로 옮겼다.
    showTip: function (btn) {
      var gameId = btn.getAttribute('data-game');
      var g = this.games.filter(function (x) { return x.id === gameId; })[0];
      if (!g) return;
      var step = this.freshStep(g.id), fm = FRESH_MULT[step], pct = Math.round(fm * 100);
      var best = this.ch.best[g.id] || 0;

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

      // 해금 조건 — 아이콘에는 짧게(등급 n/N), 여기서 어느 게임에서 따는지까지 말한다
      var lk = Shell.unlockState(this.ch, g.id), lkFrom = '';
      if (!lk.open) {
        var src = this.games.filter(function (x) { return x.id === lk.from; })[0];
        lkFrom = src ? src.title : lk.from;
      }

      var tip = $('dTip');
      var art = TIP_ART[g.id]; // 실제 게임 아트 컷 — 없으면(화력쇼) 벡터 thumb 폴백
      tip.innerHTML =
        (art
          ? '<img class="gthumb" data-tipimg src="' + art + '" alt="">'
          : '<canvas class="gthumb" data-thumb width="280" height="126"></canvas>') +
        '<div class="dwInfo">' +
          '<b class="tipTitle">' + g.title + '</b>' +
          '<p class="gd">' + g.tagline + '</p>' +
          '<div class="gf' + (fm < 1 ? ' warn' : '') + '"><span>시청자 신선도</span><b>' + pct + '%</b></div>' +
          '<div class="freshbar"><i class="' + (fm < 1 ? 'warn' : '') + '" style="width:' + pct + '%"></i></div>' +
          '<div class="gf"><span>' + (fm < 1 ? '물렸다 — 다른 게임이 회복시킨다' : '지금이 방송 적기') + '</span>' +
            (best ? '<b>최고 ' + best.toLocaleString() + '</b>' : '') + '</div>' +
          profHtml +
        '</div>' +
        (lk.open
          ? '<div class="dwHint">▶ <b>더블클릭</b>하면 방송이 시작됩니다</div>'
          : '<div class="dwHint locked">🔒 <b>' + lkFrom + '</b>을 <b>' + lk.need + '회</b> 방송하면 ' +
            '열립니다 (현재 ' + lk.have + '회 — 등급은 상관없다)</div>');

      // 벡터 썸네일 — 아트가 없는 게임은 게임이 직접 그린다 (thumb 없으면 타이틀 카드)
      var drawVec = function (cv) {
        var c = cv.getContext('2d');
        if (g.thumb) g.thumb(c, cv.width, cv.height);
        else {
          c.fillStyle = '#1e2023'; c.fillRect(0, 0, cv.width, cv.height);
          c.fillStyle = '#ffd27a'; c.font = 'bold 18px Georgia, serif'; c.textAlign = 'center';
          c.fillText(g.title, cv.width / 2, cv.height / 2 + 6);
        }
      };
      var cv0 = tip.querySelector('[data-thumb]');
      if (cv0) drawVec(cv0);
      // 아트 미배포 환경(파일 누락) — 조용히 벡터 썸네일로 강등, 툴팁은 항상 그림을 가진다
      var im = tip.querySelector('[data-tipimg]');
      if (im) im.addEventListener('error', function () {
        var c2 = document.createElement('canvas');
        c2.className = 'gthumb'; c2.width = 280; c2.height = 126;
        im.replaceWith(c2); drawVec(c2);
      });
      // 위치 — 아이콘 오른쪽. 렌더된 실제 높이로 화면 아래 잘림을 보정한다
      var r = btn.getBoundingClientRect();
      tip.style.left = (r.right + 14) + 'px';
      tip.style.top = Math.max(10, Math.min(r.top, innerHeight - 54 - tip.offsetHeight)) + 'px';
    },
    hideTip: function () { var t = $('dTip'); if (t) t.innerHTML = ''; },

    // ---------- 방송 시작 ----------
    // 실제 스트리머의 진입 흐름: 게임을 켠다고 바로 화면이 바뀌지 않는다 —
    // "잠시 후 시작합니다" 대기 화면 → 카운트다운 → 장면 전환(스팅어) → 게임.
    // 경제·게임 로직은 _launch 그대로다. 이 함수는 연출만 얹는다.
    start: function (gameId) {
      var g = this.games.filter(function (x) { return x.id === gameId; })[0];
      if (!g) return;
      if (this.phase === 'starting') return; // 카운트다운 중 재진입 방지
      // 해금 사슬 — 아이콘이 disabled라 보통은 여기 오지 않지만, 키보드 'r'(다시 방송)과
      // 콘솔 호출도 같은 문을 지나야 한다 (걸쇠는 한 곳에)
      var lock = Shell.unlockState(this.ch, gameId);
      if (!lock.open) return;
      if (Shell.campaign(this.ch).state !== 'run') return; // 시즌이 끝났으면 더 방송하지 않는다
      var self = this;
      this.phase = 'starting';
      $('jgsWin').classList.remove('minimized');   // 창이 열리며 방송 준비 화면이 뜬다
      $('appJgs').classList.add('on');
      document.body.classList.add('fullshow');     // 카운트다운부터 전체화면
      var pool = SHOW_TITLES[g.id];
      this._showTitle = pool ? pool[Math.floor(Math.random() * pool.length)] : g.tagline;
      // 게임별 아트는 여기서부터 내려받는다 (지연 로드) — 카운트다운 ~2.4초가 로드를 가리고,
      // 그래도 늦은 이미지는 각 게임의 imgReady 벡터 폴백이 받는다. 첫 화면 payload 절약.
      if (g.preload) { try { g.preload(); } catch (e) {} }

      // 브리핑 — 목표·조작·미션을 방송 전에 정중앙에서 한 번에 읽힌다. 미션을 정산 리포트에서만
      // 보여주면 플레이어는 뭘 해야 하는지 모른 채 3분을 보낸다. makeMissions는 결정론이라
      // 여기서 미리 만들어 보여줘도 _launch가 만드는 값과 같다.
      this._missions = Shell.makeMissions(this.ch);
      var camp = Shell.campaign(this.ch);   // 브리핑에도 시즌 압박을 같이 띄운다
      var misHtml = this._missions.map(function (m) {
        return '<b>' + m.label + ' ' + m.target.toLocaleString() + '</b> 이상 <em>+' + m.reward + '코인</em>';
      }).join(' · ');

      $('overlay').classList.remove('hidden');
      $('overlay').innerHTML = '<div class="startSoon">' +
        '<div class="ssTop">BROADCAST BRIEFING</div>' +
        '<h2>' + this._showTitle + '</h2>' +
        '<div class="ssGame"><span class="cat">' + g.title + '</span> 오늘의 방송</div>' +
        '<div class="brBox">' +
          '<div class="brRow"><i>목표</i><span>' + Math.round(g.duration / 60) +
            '분 동안 시청자를 최대한 모은다 — <b>0명이 되면 방송이 강제 종료된다</b><br>' +
            '<em>시즌 ' + camp.day + '일차 · 남은 ' + camp.left + '일 · 최고 ' +
            camp.best.toLocaleString() + ' / ' + camp.goal.toLocaleString() + '명</em></span></div>' +
          '<div class="brRow"><i>조작</i><span>' + (g.foot || '조작 안내 없음') + '</span></div>' +
          '<div class="brRow"><i>미션</i><span>' + misHtml + '</span></div>' +
        '</div>' +
        '<button id="brGo" type="button" class="slab primary">방송 시작 →</button>' +
        '<div class="ssHint">김 피디가 미션 달성을 지켜본다 — 보상 코인은 방송용품 상점에서 쓴다</div>' +
        '</div><div id="stinger"></div>';
      Chat.reset();
      Chat.sys('— 방송 대기 화면 —');
      $('tallyR').textContent = '브리핑';

      var go = $('brGo');
      go.onclick = function () { self._countdown(g); };
      go.focus(); // 포커스만 주면 엔터·스페이스는 버튼 기본 동작이 받는다
    },

    // 브리핑을 읽고 누른 뒤에야 3·2·1이 돈다
    _countdown: function (g) {
      var self = this;
      var so = $('overlay').querySelector('.startSoon');
      if (!so) return;
      so.innerHTML = '<div class="ssTop">STARTING SOON</div>' +
        '<h2>잠시 후 방송이 시작됩니다</h2>' +
        '<div class="ssGame"><span class="cat">' + g.title + '</span> ' + this._showTitle + '</div>' +
        '<div class="ssCount" id="ssCount">3</div>' +
        '<div class="ssHint">방송 준비 중 — 마이크·송출 확인</div>';
      $('tallyR').textContent = '준비 중';

      var n = 3;
      var tick = function () {
        if (n <= 0) {
          // OBS 장면 전환 — 보라 와이프가 화면을 훑고 지나가며 게임이 드러난다
          var st = $('stinger');
          if (st) { st.classList.add('go'); }
          setTimeout(function () { self._launch(g.id); }, 340);
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
      // 시작 시청자 = 게임 기본값 + 구독자 기여분, 관객 구성은 채널의 색을 물려받는다.
      // 이월이 없으면 10번째 방송이 1번째와 똑같아진다 — 채널이 성장하지 않는다
      // 송출기(ADR-008)가 여기서 바닥을 올린다. start0은 endShow의 등급 계산에도 그대로
      // 넘어가야 한다 — 분모가 고정이면 출발선 상승이 순수 무상 파워가 된다 (ADR-008 §2)
      var start0 = g.startViewers + this.subBonus() + Shell.rigFloor(this.ch);
      this._start0 = start0;
      this.viewers = start0;
      this._donT = 6 + Math.random() * 4;  // 도네 타이머는 셸 소유 (contract 4.2)
      this.comp = this.ch.mix.map(function (r) { return start0 * r; });
      this.compStart = this.comp.slice();
      this.fickle = [0, 0, 0, 0];
      this._fickleBorn = 0;
      this.timeLeft = g.duration;
      this._fxQueue.length = 0;
      this._shake = 0; this._flash = 0;

      $('overlay').classList.add('hidden');
      $('overlay').innerHTML = '';
      document.body.classList.add('fullshow'); // 방송 = 전체화면 (진짜 게임처럼)
      var self0 = this;
      requestAnimationFrame(function () { self0.fitHud(); }); // 레이아웃 확정 후 HUD 정렬
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
      if (Shell.Dex) Shell.Dex.newShow(g.id); // 반응 도감 — 파장 리셋 + 저텐션 fatigue 발행 (ADR-006·§7.2)
      Chat.sys('— 생방송 시작 · ' + g.title + ' —');
      // file:// 직접 실행 안내 — 브라우저가 로컬 이미지를 교차 출처로 취급해 캔버스 녹화가
      // 막힌다 (클립 영상·리플레이 비활성). 한 번만, 조용히.
      if (location.protocol === 'file:' && !this._fileWarned) {
        this._fileWarned = true;
        Chat.sys('[안내] 파일로 직접 열면 클립 영상·리플레이가 꺼집니다 — 방송-실행.bat 또는 배포 링크로 여세요');
      }

      // 플랫폼 정보줄 — 제목·카테고리·라이브 점등
      $('infoTitle').textContent = this._showTitle || g.tagline;
      $('infoCat').textContent = g.title;
      $('infoDot').className = 'on';
      $('obsDot').classList.add('live');

      this._marks.length = 0; this._shownV = 0;
      this._recordStamped = false; this._paceTagged = false; this._lastGainAt = this.now;
      $('liveBar').classList.remove('cold');
      $('paceChip').classList.add('hidden');
      $('donBanner').classList.remove('show');
      this._donQ.length = 0; this._donBusy = false;
      // 클립 — 흥미도 기반 자동 캡처 상태 (방송 단위 리셋). 지난 방송 영상 URL은
      // 아카이브(하이라이트 다시보기)에 남은 것만 빼고 회수한다
      var arch0 = Shell._clipArchive || [];
      (this._clips || []).forEach(function (c) { if (c.vid && arch0.indexOf(c) < 0) URL.revokeObjectURL(c.vid); });
      this._clips = []; this._evSeen = {}; this._surgeAcc = 0; this._lastClipAt = -99;
      this._lastReplayAt = 0; this._replayBusy = false;
      this._showCoins = 0; // 이번 방송의 도네 코인 누계
      this._showFresh = Math.round(this.freshMult(g.id) * 100); // 평가용 — 회전 전 신선도
      this._missions = Shell.makeMissions(this.ch);             // 김 피디의 오늘 미션 (결정론)
      this.startClipRec();

      this.tutorial(g);

      // 단골 인사 — 채널 기록(지난 방송·최고 기록)을 시청자가 기억하고 언급한다 (연출 전용 C3).
      // 시작 버스트가 지나간 뒤 최대 2줄, 순차 방출 (규약 3 — 자극 간격). 데이터: data/regulars.js
      var last = this.ch.log[0], mem = [];
      if (!this.ch.shows) mem.push(['first', {}]);
      else {
        if (last && last.g === g.title) mem.push(['same_again', { game: g.title }]);
        else if (last && last.d) mem.push(['after_dead', {}]);
        if (this.ch.best[g.id]) mem.push(['best', { best: this.ch.best[g.id].toLocaleString() }]);
        if (!mem.length && this.ch.shows >= 3) mem.push(['regular', { shows: String(this.ch.shows + 1) }]);
      }
      mem.slice(0, 2).forEach(function (m2, i) { Chat.memory(m2[0], m2[1], null, 2600 + i * 3200); });

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
        // ev는 총량이 아니라 배분에만 쓰인다 (ADR-004 결정 2 — 총량 산식 무변경).
        // 생략하면 중립 배분이라 기존 호출은 그대로 동작한다 (contract 4.2)
        gain: function (n, label, ev) {
          if (!(n > 0) || self.phase !== 'live') return 0;
          // 조명·무대(ADR-008)는 여기서 증폭한다. 도네는 제외 — 도네 알림 계열과 이중 계상된다.
          // 대가는 이미 hold(final/peak)에 있다: 크게 터뜨릴수록 유지가 어려워진다
          var rigM = (ev === 'donation') ? 1 : Shell.rigGain(self.ch);
          var actual = Math.max(1, Math.round(n * self.freshMult(self.game.id) * rigM));
          self.viewers += actual;
          self._surgeAcc += actual;                          // 흥미도의 급증 신호 (클립)
          self._lastGainAt = self.now;                       // 카운터 '식음' 판정용
          if (actual >= 150) self._marks.push(self._upT);    // 전폭 그래프의 스파이크 마커
          self.compAdd(actual, ev);                          // 공명 판정층 — 원형별 배분 (ADR-004)
          self.renderViewers();
          // 획득은 과하게 (규약 2). 단 도네는 전용 배너가 연출을 전담한다 — 중앙 팝업까지
          // 겹치면 큰 자극 두 개가 서로를 잡아먹는다 (규약 3)
          if (label && label.indexOf('도네') === -1) self._fxQueue.push('+' + actual.toLocaleString() + ' · ' + label);
          if (self.viewers >= 30000) Chat.big = true;
          return actual;
        },
        lose: function (n) { self.loseViewers(n); },        // 조용히 (규약 2)
        // C3 — 채팅·캠은 관측만 한다. emit은 단방향이고 반환값이 없다.
        // 도네만 셸이 옆에서 훔쳐본다 — 화면 배너 연출(수치 무관, 순수 연출)용이다
        emit: function (ev, facts) {
          if (ev === 'donation') self.showDonation(facts);
          self.camReact(ev); Chat.react(ev, facts);
          self.maybeClip(ev); // 관측 전용 — 흥미도 판정·클립 캡처 (수치 무관여, C3)
          if (Shell.Dex) Shell.Dex.judge(self.game.id, ev); // 반응 도감 — 결정론 칸 판정 (메타 통화만, ADR-006)
        },
        hud: function (html) { $('plaque').innerHTML = html; },
        stamp: function (text) { self.showStamp(text); },
        // 도네 주기 — 셸 소유 (contract 4.2, ADR-008 §6.4). 게임 5종이 같은 타이머를 복붙하고
        // 있었고, 장비가 빈도를 조절하려면 한 곳이어야 한다 (새 게임도 공짜로 따라온다).
        // base·prob는 게임이 정한다 (기존 밸런스 보존). 반환: 터졌으면 실제 반영량, 아니면 0
        donRoll: function (dt, base, prob) {
          if (self.phase !== 'live') return 0;
          self._donT -= dt;
          if (self._donT > 0) return 0;
          var r = Shell.rigDon(self.ch);
          self._donT = ((base || 9) + Math.random() * 7) * r.gap;
          if (Math.random() >= (prob == null ? .45 : prob) + r.prob) return 0;
          // 양념 (규약 5): 랜덤 도네는 드물게, 규모 비례 1~3% 최소 10명 (critic L5).
          // 게임 5종에서 이관된 밸런스 근거 — 값을 바꾸면 양념이 뼈대를 넘본다
          var d = Math.max(10, Math.round(self.viewers * (0.01 + Math.random() * 0.02)));
          var a = this.gain(d, '익명의 도네', 'donation');
          this.emit('donation', { d: a.toLocaleString() });
          return a;
        },
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
      var v = Math.ceil(this.viewers);
      var el = $('viewerCount'); // 검사 하네스에는 DOM이 없다 — 전부 널 가드
      if (el) el.textContent = v.toLocaleString();
      var iv = $('infoViewers');
      if (iv) iv.textContent = v.toLocaleString();
      // 심박 — 숫자가 움직일 때마다 살짝 튄다. 시청자 수가 곧 체력바(규약 1)라는 걸
      // 눈이 아니라 몸이 알게 하는 장치다
      if (el && v !== this._shownV) {
        var cls = v > this._shownV ? 'up' : 'down';
        el.classList.remove('up', 'down'); void el.offsetWidth; el.classList.add(cls);
        this._shownV = v;
      }
      // 채팅 열기 — 시청자 규모를 0~1로 눌러 관객 엔진에 넘긴다 (연출 전용, C3 무관)
      Chat.heat = Math.max(0, Math.min(1, Math.log10(Math.max(v, 1) / 150) / 2.3));
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
      $('bigStampText').innerHTML = String(text).replace(/★/g, STAR); // 내부 상수만 들어온다
      var st = $('bigStamp');
      st.classList.remove('show'); void st.offsetWidth; st.classList.add('show');
      clearTimeout(this._stampTimer); // 연속 스탬프의 조기 소멸 방지 (L-2)
      this._stampTimer = setTimeout(function () { st.classList.remove('show'); }, 1600);
    },
    // ---------- 도네 배너 (연출 전용) ----------
    // 수치는 게임이 이미 gain으로 반영했다 — 여기는 화면 위 배너만 맡는다 (규약 5: 도네는
    // 양념이니 연출은 화려하게, 수치 관여는 없음). 배너끼리는 큐로 3.4초 간격 방출 (규약 3).
    // 닉네임은 채팅 페르소나를 빌려 쓴다 — 후원자가 관객석에 실재하는 인물로 읽히게.
    DON_MSG: ['오늘 방송 개꿀잼', '이건 봐야지', '무리하지 마세요', '한 판 더 가자',
              '방금 그거 미쳤다', '밥은 먹고 방송해요', '첫 도네입니다', '사고 한 번만 더 부탁',
              '아니 이걸 이렇게 한다고? ㅋㅋ', '방금 장면 클립 각이던데', '구독 박고 갑니다'],
    // 후원자 — 대부분 채팅 페르소나(관객석에 실재하는 인물로 읽히게), 가끔 익명 (치지직 문법)
    pickSponsor: function () {
      return Math.random() < .3
        ? { nick: '익명의 후원자', color: '#b8c4cc' }
        : Chat.personas[Math.floor(Math.random() * Chat.personas.length)];
    },
    showDonation: function (facts) {
      // 코인 적립 — 이번 방송 누계로 모았다가 정산(endShow) 때 잔액에 더한다.
      // 시청자 수치는 게임이 이미 gain으로 반영했다 — 코인은 별도 통화라 규약 1과 무관.
      var amt = parseInt(String((facts && facts.d) || '0').replace(/,/g, ''), 10);
      if (amt > 0) this._showCoins += amt;
      this._donQ.push({
        amt: (facts && facts.d) ? String(facts.d) : '1,000',
        who: this.pickSponsor(),
        msg: this.DON_MSG[Math.floor(Math.random() * this.DON_MSG.length)],
      });
      this.drainDon();
    },
    drainDon: function () {
      if (this._donBusy || !this._donQ.length) return;
      var self = this, d = this._donQ.shift();
      this._donBusy = true;
      var el = $('donBanner');
      // 금액 단위는 '코인'(플랫폼 화폐) — 게임이 넘기는 값이 시청자 환산 수치라
      // '원'을 붙이면 13원 같은 어색한 소액이 된다 (치지직의 치즈, 트위치의 비트 문법).
      // 형식은 치지직 후원 배너: "{이름}님이 {n}코인 후원!" 머리줄 + 아래 도네 내용 줄.
      el.innerHTML = '<div class="dhead"><img class="uiIco" src="games/shell/img/ui-coin.png" alt="">' +
        '<b style="color:' + d.who.color + '">' + d.who.nick + '</b>님이 <b class="amt">' +
        d.amt + '코인</b> 후원!</div>' +
        '<div class="dmsg">' + d.msg + '</div>' +
        '<div class="dhint">클릭해서 읽어주기</div>';
      d.read = false; this._donShown = d; // 읽어주기 대상 — 배너가 사라지면 기회도 사라진다
      el.classList.remove('show', 'read'); void el.offsetWidth; el.classList.add('show');
      // 도네 알림음은 기본 — 코인 딸랑 두 음. 팡파레(상점 용품)는 그 위에 얹는다 (순수 장식)
      Shell.sfx.tone(1175, .07, 'triangle', .06); Shell.sfx.tone(1568, .1, 'triangle', .05, .07);
      if (this.ch.gear.fanfare) {
        Shell.sfx.tone(1047, .09, 'triangle', .07); Shell.sfx.tone(1319, .1, 'triangle', .06, .08);
        Shell.sfx.tone(1568, .18, 'triangle', .06, .16);
      }
      setTimeout(function () {
        self._donBusy = false; self._donShown = null;
        $('donBanner').classList.remove('show', 'read'); // 애니메이션 종료 시점 — 시각적 무변화
        self.drainDon();
      }, 3400);
    },

    // ---------- 도네 읽어주기 (응답 루프 — 연출 전용) ----------
    // 실제 스트리머의 핵심 기술은 "플레이하면서 채팅을 상대하는 것" — 배너를 클릭하는 손이
    // 잠깐 게임에서 떨어지는 것 자체가 비용이자 몰입 장치다. 읽어주면 후원자가 반갑게
    // 반응하고(don_read, 화자 = 후원자 본인) trust(방송 간 관계 변수, ADR-003)가 쌓인다.
    // ponytail: 경제 무관여 — 시청자·코인 이득 없음. 유입을 붙이려면 공명 모델 게이트(§5) 뒤에.
    readDonation: function () {
      var d = this._donShown;
      if (!d || d.read || this.phase !== 'live') return;
      d.read = true;
      var el = $('donBanner');
      el.classList.add('read');
      var h = el.querySelector('.dhint'); if (h) h.textContent = '읽어줬다 — 후원자가 답한다';
      this.camReact('donation'); // aha 표정 — 도네를 보고 웃는 얼굴
      this.showTicker('"' + d.msg + '" — ' + d.who.nick + '님 감사합니다!');
      Chat.memory('don_read', {}, d.who, 700 + Math.random() * 500); // 사람이 읽고 답하는 템포
      Chat.bumpTrust(); // 소통도 큰 사건이다 — 방송 간 관계에 쌓인다
      Shell.sfx.tone(880, .08, 'triangle', .07); Shell.sfx.tone(1319, .12, 'triangle', .06, .09);
    },

    // ---------- 상점 (방송용품) ----------
    // 재원 = 도네 코인 (양념 수입, 규약 5). 상품은 전부 순수 장식 — 시작 시청자·보상 배율·
    // 언락 임계·실패 벌칙에 관여하는 상품은 금지다 (능력 강화 = 업그레이드 포화 = 게임 종료).
    // 아이콘은 AetherAI 생성 (tools/aether-assets.json의 icon-shop·shop-* 항목).
    SHOP_ITEMS: [
      { id: 'camgold',   n: '골드 캠 프레임',   d: '스트리머 캠에 금테를 두른다', price: 500 },
      { id: 'holobadge', n: '홀로그램 채팅 배지', d: '채팅창 배지가 홀로그램으로 빛난다', price: 1500 },
      { id: 'fanfare',   n: '도네 팡파레',      d: '도네 배너에 반짝임 + 팡파레 효과음', price: 3000 },
      { id: 'neonsign',  n: '스튜디오 네온 간판', d: '방송 화면 테두리에 민트 네온', price: 6000 },
      { id: 'tallyplat', n: '플래티넘 ON AIR',  d: 'ON AIR 바가 플래티넘으로 바뀐다', price: 12000 },
      // 등급 한정 — 파트너 계약 ③의 칭호 외 보상. minTier 미달이면 구매 잠금 (장식일 뿐)
      { id: 'diaaura',   n: '다이아 오라',      d: '방송 화면에 다이아 오라 — 다이아 파트너 한정', price: 20000, minTier: 4 },
    ],
    applyGear: function () {
      var ch = this.ch;
      this.SHOP_ITEMS.forEach(function (it) {
        document.body.classList.toggle('g-' + it.id, !!ch.gear[it.id]);
      });
    },
    openShop: function () {
      var self = this;
      // #overlay는 방송 창(#jgsWin) 안에 있다 — 허브에선 창이 최소화 상태라 먼저 연다
      $('jgsWin').classList.remove('minimized');
      $('appJgs').classList.add('on');
      $('overlay').classList.remove('hidden');
      $('overlay').innerHTML = '<div class="panel shopWin">' +
        '<h2><img class="shopH" src="games/shell/img/icon-shop.png" alt="">방송용품 상점</h2>' +
        '<p class="shopBal">보유 코인 <b id="shopCoins">' + this.ch.coins.toLocaleString() + '</b>' +
        ' · 부품 <b>' + (this.ch.parts || 0) + '</b>' +
        ' <span class="fine">— 부품은 미션 달성으로만 나온다</span></p>' +
        // 장비(성능·유지비 있음)와 용품(장식)을 한 창에 두되 절대 섞지 않는다.
        // 둘의 차이가 이 게임의 규약이라 구역 제목이 그걸 설명한다
        '<h3 class="shopSec">방송 장비 <span class="fine">— 성능이 오른다. 대신 방송마다 유지비를 낸다' +
          (Shell.rigUpkeep(this.ch) > 0 ? ' (현재 ' + Shell.rigUpkeep(this.ch).toLocaleString() + ' 코인)' : '') +
          '</span></h3>' +
        '<div class="rigGrid">' + Shell.RIG_LINES.map(function (k) {
          var R = Shell.RIG[k], lv = Shell.rigLv(self.ch, k), nx = Shell.RIG_COST[lv + 1];
          var eff = k === 'feed' ? '+' + R.floor[lv].toLocaleString() + '명'
                  : k === 'stage' ? '×' + R.mult[lv].toFixed(2)
                  : lv ? '간격 ×' + R.gap[lv].toFixed(2) + ' · 확률 +' + Math.round(R.prob[lv] * 100) + '%p' : '기본';
          return '<div class="rigItem' + (lv >= 3 ? ' max' : '') + '">' +
            '<div class="riTop"><b>' + R.n + '</b><span class="riLv">Lv' + lv + '</span></div>' +
            '<div class="riDesc">' + R.d + ' — 현재 <b>' + eff + '</b></div>' +
            (lv >= 3
              ? '<div class="siOwned">최대 레벨 — 이제 유지가 목표다</div>'
              : '<button class="siBuy" data-rig="' + k + '">Lv' + (lv + 1) + ' · ' +
                nx.coins.toLocaleString() + ' 코인 · 부품 ' + nx.parts +
                (nx.tier > 0 ? ' · ' + Shell.TIERS[nx.tier].n + ' 이상' : '') + '</button>') +
            '</div>';
        }).join('') + '</div>' +
        '<h3 class="shopSec">방송용품 <span class="fine">— 전부 장식이다 (방송이 세지진 않는다)</span></h3>' +
        '<div class="shopGrid">' + this.SHOP_ITEMS.map(function (it) {
          var owned = !!self.ch.gear[it.id];
          var locked = (it.minTier || 0) > (self.ch.tier || 0);
          return '<div class="shopItem' + (owned ? ' owned' : '') + (locked ? ' locked' : '') + '">' +
            '<img src="games/shell/img/shop-' + it.id + '.png" alt="" onerror="this.style.visibility=\'hidden\'">' +
            '<div class="siName">' + it.n + '</div><div class="siDesc">' + it.d + '</div>' +
            (owned
              ? '<div class="siOwned">보유 중 — 적용됨</div>'
              : locked
                ? '<div class="siLock">🔒 ' + Shell.TIERS[it.minTier].n + ' 파트너 해금</div>'
                : '<button class="siBuy" data-buy="' + it.id + '">' + it.price.toLocaleString() + ' 코인</button>') +
            '</div>';
        }).join('') + '</div>' +
        '<div class="btnrow"><button class="slab" id="shopClose">데스크탑으로 (Esc)</button></div></div>';
      $('shopClose').onclick = function () { self.showHub(); };
      $('overlay').querySelectorAll('[data-rig]').forEach(function (b) {
        b.onclick = function () {
          var line = b.getAttribute('data-rig');
          var r = Shell.rigUp(self.ch, line);
          if (r !== 'ok') {
            var msg = { poor: '코인 부족', parts: '부품 부족', locked: '등급 부족' }[r] || '불가';
            var was = b.textContent;
            b.textContent = msg;
            setTimeout(function () { b.textContent = was; }, 900);
            return;
          }
          self.saveChannel(); self.updateTopbar();
          Shell.sfx.tone(392, .1, 'sawtooth', .09); Shell.sfx.tone(587, .16, 'sawtooth', .09, .1);
          self.openShop(); // 레벨·잔액·유지비 반영해 다시 그린다
        };
      });
      $('overlay').querySelectorAll('[data-buy]').forEach(function (b) {
        b.onclick = function () {
          var it = self.SHOP_ITEMS.filter(function (x) { return x.id === b.getAttribute('data-buy'); })[0];
          var r = Shell.shopBuy(self.ch, it);
          if (r === 'poor') { b.textContent = '코인 부족'; setTimeout(function () { b.textContent = it.price.toLocaleString() + ' 코인'; }, 900); return; }
          if (r !== 'ok') return;
          self.saveChannel(); self.applyGear(); self.updateTopbar();
          Shell.sfx.tone(523, .09, 'triangle', .1); Shell.sfx.tone(784, .14, 'triangle', .1, .09);
          self.openShop(); // 잔액·보유 상태 반영해 다시 그린다
        };
      });
    },

    // 새 방송 콘텐츠 (물음표 슬롯) — 아직 기능이 아니라 방향이다.
    // 여기서 뭔가 생성하는 척하지 않는다. 채널이 이미 들고 있는 값(색깔·최다 반응 태그)을
    // 씨앗으로 보여주고, 다음 게임은 그걸 읽고 만들어진다는 것까지만 말한다.
    openLab: function () {
      var self = this;
      $('jgsWin').classList.remove('minimized');
      $('appJgs').classList.add('on');
      $('overlay').classList.remove('hidden');
      var top = this.mixTop();
      // 씨앗 = 도감에서 가장 많이 열린 반응 태그. 새 API를 만들지 않고 이미 쌓인 칸을 센다
      var seeds = [];
      if (Shell.Dex) {
        var cells = Shell.Dex.load().cells || {}, tally = {};
        for (var key in cells) {
          var ev = key.split('@')[1];
          if (ev) tally[ev] = (tally[ev] || 0) + 1;
        }
        seeds = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; }).slice(0, 3);
      }
      $('overlay').innerHTML = '<div class="panel labWin">' +
        '<h2><span class="labQ">?</span>새 방송 콘텐츠</h2>' +
        '<p class="labLead">종겜은 게임이 떨어지면 끝난다. 다음 콘텐츠는 <b>채널이 무엇에 반응했는지</b>를 ' +
          '읽어서 만들어진다 — 남의 게임을 가져오는 게 아니라, 이 채널의 취향을 재료로 쓴다.</p>' +
        '<div class="labSeed"><div class="rlab">지금 채널이 넘긴 재료</div>' +
          '<div class="labRow"><span>채널 색깔</span><b style="color:' + top.c + '">' + top.n + '</b></div>' +
          '<div class="labRow"><span>가장 많이 나온 반응</span><b>' +
            (seeds.length ? seeds.join(' · ') : '아직 방송 기록이 부족하다') + '</b></div>' +
          '<div class="labRow"><span>방송 수</span><b>' + this.ch.shows + '회</b></div>' +
        '</div>' +
        '<p class="labSoon">준비 중 — 이 슬롯은 아직 비어 있다.</p>' +
        '<div class="btnrow"><button class="slab" id="labClose">데스크탑으로 (Esc)</button></div></div>';
      $('labClose').onclick = function () { self.showHub(); };
    },

    // ---------- 클립 — 흥미도 기반 자동 캡처 (관측 전용, C3) ----------
    // "어느 포인트가 흥미를 유발했는가"를 셸이 판정해 그 순간을 딴다. 새 저작 테이블 없이
    // 이미 있는 신호 3개를 합성한다 — 자세한 식은 Shell.interestScore (파일 하단, selftest 검증).
    //   ① 버스트 무게: 기획이 저작한 "이 순간의 크기" (chat-data BURST)
    //   ② 방송 내 반복 감쇠: 같은 이벤트는 물린다 (규약 4의 순간판, FRESH_MULT 재사용)
    //   ③ 시청자 급증: 직전 ~1.4초의 실제 반응 (gain 누적, 지수 감쇠)
    // v0.2 설계안(§9)의 "spawn 높은 개체가 반응한 순간 = 클립"의 최소 결정론 판 — 100종
    // 페르소나가 이관되면 ①이 개체 반응으로 승격된다.
    MOOD_KO: { surprise: '돌발', panic: '위기', aha: '결정적 장면', confusion: '방송사고',
               thinking: '정적', question: '전환점' },

    // ---------- 김 피디 대사 (연출 전용 — 등급은 Shell.gradeShow가 결정론으로 산정) ----------
    PD_LINES: {
      S: ['이게 방송이지. 클립 정리해서 메인에 올릴게요.', '오늘 지표, 회의에서 자랑하겠습니다.', '편성 앞자리로 옮기자는 얘기가 나왔어요.'],
      A: ['좋아요. 이 흐름이면 다음 등급 갑니다.', '오늘 유입 곡선 예뻤습니다.', '시청자가 남는 방송이었어요.'],
      B: ['나쁘지 않은데, 한 방이 없었죠.', '중간은 갔습니다. 내일 더 세게 갑시다.', '유지는 됐는데 화제가 안 남았어요.'],
      C: ['오늘 좀 심심했다는 반응이에요.', '지표가 미지근합니다. 그림을 만들어야 해요.', '이대로면 편성 밀립니다.'],
      D: ['피디로서 할 말이… 다음 방송 준비합시다.', '오늘 건 없던 걸로 하죠.', '지표 보고는 제가 어떻게든 막았습니다.'],
    },
    PD_TIPS: {
      growth: '시청자를 더 불려야 합니다 — 큰 그림 한 방이 필요해요',
      hold: '터뜨린 뒤에 다 빠져나갔어요 — 끝까지 잡아두세요',
      clips: '클립 감이 없었습니다 — 사고든 역전이든 장면을 만드세요',
      don: '도네 반응이 약해요 — 시청자가 지갑을 열 순간을 주세요',
      vari: '같은 게임만 파면 물립니다 — 종겜 돌리세요',
    },
    maybeClip: function (ev) {
      if (this.phase !== 'live') return;
      var seen = this._evSeen[ev] || 0;
      this._evSeen[ev] = seen + 1; // 캡처 여부와 무관하게 감쇠는 진행 — 반복은 흥미가 아니다
      if (ev === 'donation') return; // 규약 5 — 양념(랜덤 도네)은 클립의 뼈대가 될 수 없다
      var burst = (Chat.BURST && Chat.BURST[ev]) || 1;
      var surge = clamp(this._surgeAcc / (this.viewers * .12 + 40), 0, 1);
      var s = Shell.interestScore(burst, seen, surge);
      if (s < Shell.CLIP.THRESH) return;
      if (this._upT - this._lastClipAt < Shell.CLIP.GAP) return; // 클립끼리도 간격 (규약 3의 정신)
      if (this._clips.length >= Shell.CLIP.RAW_MAX) return;
      this._lastClipAt = this._upT;
      var why = [];
      if (burst >= 4) why.push('대형 이벤트');
      if (seen === 0) why.push('첫 등장');
      if (surge > .35) why.push('+' + Math.round(this._surgeAcc).toLocaleString() + ' 급증');
      var mood = '순간';
      for (var m in this.CAM_MOOD) {
        if (this.CAM_MOOD[m].indexOf(ev) >= 0) { mood = this.MOOD_KO[m] || '순간'; break; }
      }
      // 이벤트의 0.45초 뒤를 캡처 — VFX·플래시·스탬프가 화면에 핀 순간이 클립이 된다
      var self = this, tAt = this._upT, game = this.game;
      setTimeout(function () {
        if (self.phase !== 'live' || self.game !== game) return;
        var img;
        try {
          // 스틸도 합성 캔버스(게임+채팅)에서 딴다 — 없으면(녹화 미지원) 게임 화면만
          var srcCv = self._recCanvas || self.ctx.canvas;
          var iw2 = 300, ih2 = Math.round(iw2 * srcCv.height / srcCv.width);
          var cv = document.createElement('canvas'); cv.width = iw2; cv.height = ih2;
          cv.getContext('2d').drawImage(srcCv, 0, 0, iw2, ih2);
          img = cv.toDataURL('image/jpeg', .55);
        } catch (e) {
          // file:// 실행 — 브라우저가 로컬 이미지를 교차 출처로 취급해 캔버스 판독을 막는다.
          // 화면 대신 카드형 썸네일로 클립 기록 자체는 남긴다 (Pages·로컬 서버에선 실화면).
          try { img = self.clipCard(mood, tAt); } catch (e2) { img = 0; }
        }
        if (img) {
          var clip = { t: tAt, ev: ev, s: s, mood: mood, why: why, game: self.game.title,
            v: Math.round(self.viewers), img: img, vid: null };
          self._clips.push(clip);
          // 리플레이 창은 영상이 굳은 뒤에 띄운다 — 좌상단에서 실제로 재생돼야 한다
          // (사용자 피드백). 녹화 미지원·조립 실패 땐 스틸로라도 반드시 띄운다.
          if (self._rec) {
            self._recHold = true; // 조립이 끝날 때까지 세그먼트를 자르지 않는다
            setTimeout(function () {
              var r = self._rec;
              if (!r || r.state === 'inactive') { self._recHold = false; self.showReplay(clip, 'INSTANT REPLAY'); return; }
              try { r.requestData(); } catch (e) { self._recHold = false; self.showReplay(clip, 'INSTANT REPLAY'); return; }
              setTimeout(function () {
                self._recHold = false;
                if (r._chunks.length) {
                  // Blob도 들고 있는다 — 보관함(IndexedDB)이 방송 끝에 이걸 그대로 담는다.
                  // 객체 URL은 새로고침까지만 살지만 Blob은 저장소로 넘어간다.
                  clip.blob = new Blob(r._chunks.slice(), { type: 'video/webm' });
                  clip.vid = URL.createObjectURL(clip.blob);
                }
                self.showReplay(clip, 'INSTANT REPLAY');
              }, 150);
            }, 2500);
          } else {
            self.showReplay(clip, 'INSTANT REPLAY');
          }
        }
      }, 450);
    },
    clipCard: function (mood, t) {
      var cv = document.createElement('canvas'); cv.width = 240; cv.height = 108;
      var c = cv.getContext('2d');
      var g = c.createLinearGradient(0, 0, 0, 108);
      g.addColorStop(0, '#241a38'); g.addColorStop(1, '#141020');
      c.fillStyle = g; c.fillRect(0, 0, 240, 108);
      c.strokeStyle = 'rgba(0,255,163,.5)'; c.lineWidth = 2; c.strokeRect(3, 3, 234, 102);
      c.fillStyle = '#ff5a4a'; c.beginPath(); c.arc(22, 22, 5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#7dffd0'; c.font = 'bold 11px system-ui, sans-serif'; c.textAlign = 'left';
      c.fillText('REC ' + Shell.util.fmtTime(t), 34, 26);
      c.fillStyle = '#ece7dd'; c.font = 'bold 22px system-ui, sans-serif'; c.textAlign = 'center';
      c.fillText(mood, 120, 68);
      return cv.toDataURL('image/png');
    },
    // 리플레이 창 — 진짜 스트리머의 OBS 리플레이 소스처럼, 게임 위 좌상단에서 클립이
    // 실제로 재생된다. 방금 딴 클립(INSTANT REPLAY)과 조용한 구간의 과거 하이라이트
    // (아카이브 다시보기) 둘 다 이 창을 쓴다. 연출 전용 — 수치 무관 (C3).
    showReplay: function (clip, label) {
      var el = $('replayWin'); if (!el) return;
      this._lastReplayAt = this._upT;
      this._replayBusy = true;
      var self = this;
      clearTimeout(this._replayTimer);
      this._replayTimer = setTimeout(function () { self._replayBusy = false; }, 6800);
      var media = clip.vid
        ? '<video src="' + clip.vid + '" autoplay muted playsinline></video>'
        : '<img src="' + clip.img + '" alt="">';
      // 클립 후원 (치지직 문법) — 터진 장면에 시청자가 지갑을 연다. 영상 밑에
      // "{이름}님이 {n}코인 후원!" 한 줄. 연출 전용 — 코인 적립 없음 (클립은 수치
      // 무관여, contract 4.6 — 연출이 경제를 만드는 경로를 열지 않는다).
      var don = '';
      if (label === 'INSTANT REPLAY') {
        var spon = this.pickSponsor();
        var damt = [500, 1000, 1000, 2000, 3000, 5000, 10000][Math.floor(Math.random() * 7)];
        // 코인 아이콘 없이 글자만 — 클립 창의 주인공은 영상이다 (사용자 피드백)
        don = '<div class="rwDon"><b style="color:' + spon.color + '">' + spon.nick +
          '</b>님이 <b class="amt">' + damt.toLocaleString() + '코인</b> 후원!</div>';
        // 클립 캡처 효과음 — 도네 딸랑과 겹치지 않는 낮은 촬칵+윙
        Shell.sfx.tone(660, .05, 'square', .04); Shell.sfx.tone(990, .09, 'triangle', .05, .05);
      }
      el.innerHTML = '<div class="rwHead"><i class="recDot"></i>' + label +
        '<span class="rwSave">클립 저장됨</span></div>' + media +
        '<div class="rwCap"><b>' + (clip.game ? clip.game + ' · ' : '') + Shell.util.fmtTime(clip.t) +
        '</b> ' + clip.mood + ' · 흥미도 ' + Math.round(clip.s * 100) + '%' +
        (!clip.vid && location.protocol === 'file:' ? ' <span class="rwNote">영상은 배포판·로컬 서버에서</span>' : '') +
        '</div>' + don;
      if (label !== 'INSTANT REPLAY') el.querySelector('.rwSave').style.display = 'none';
      // 하이라이트 지점 직전부터 재생 — 프리롤(세그먼트 앞부분)을 건너뛴다.
      // MediaRecorder WebM은 duration이 Infinity로 나오는 경우가 있어(크롬) 그땐 처음부터.
      var v = el.querySelector('video');
      if (v) v.onloadedmetadata = function () {
        try { if (isFinite(v.duration) && v.duration > 5.8) v.currentTime = v.duration - 5.6; } catch (e) {}
      };
      el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    },

    // 전체화면 HUD 정렬 — 캔버스는 object-fit: contain이라 그림이 레터박스된다.
    // 조작 패널·설명은 게임 '그림'의 좌우 폭·바닥에 붙어야 한다 (버튼도 게임 안의 내용).
    fitHud: function () {
      if (!document.body.classList.contains('fullshow')) return;
      var r = this.ctx.canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var sc = Math.min(r.width / W, r.height / H);
      var gw = W * sc, gh = H * sc;
      var gx = r.left + (r.width - gw) / 2;
      var gbot = window.innerHeight - (r.top + (r.height - gh) / 2 + gh);
      var st = document.body.style;
      st.setProperty('--gx', Math.round(gx) + 'px');
      st.setProperty('--gw', Math.round(gw) + 'px');
      st.setProperty('--gbot', Math.max(44, Math.round(gbot)) + 'px');
    },

    // ---------- 클립 영상 — 리플레이 버퍼 (연출·기록 전용) ----------
    // 캔버스를 상시 녹화하되 6초마다 세그먼트를 재시작한다. WebM 헤더는 늘 세그먼트의
    // 첫 청크에 있으므로 "세그먼트 시작~지금"을 이어붙이면 어느 순간이든 재생 가능한
    // 파일이 된다. 프리롤이 0~6초로 변동하는 건 감수 — 진짜 편집기는 범위 밖이다.
    startClipRec: function () {
      this.stopClipRec();
      var cv = this.ctx.canvas;
      if (typeof MediaRecorder === 'undefined' || !cv.captureStream) return; // 미지원 → 스틸만
      var self = this;
      try {
        // 합성 캔버스 — 게임(960) + 채팅 미러(300) 가로, 세로는 게임(430) + 시청자 그래프(34)
        // + 하단 HUD(136). 클립이 실제 플레이 화면과 같아 보이게 DOM HUD까지 굽는다 (사용자 피드백)
        this._recCanvas = document.createElement('canvas');
        this._recCanvas.width = this.REC_W; this._recCanvas.height = this.REC_H;
        this._recCtx = this._recCanvas.getContext('2d');
        this._recCtx.fillStyle = '#0b0908'; this._recCtx.fillRect(0, 0, this.REC_W, this.REC_H);
        this._recStream = this._recCanvas.captureStream(24);
        var mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
        var mk = function () {
          var chunks = [];
          var r = new MediaRecorder(self._recStream, { mimeType: mime, videoBitsPerSecond: 2200000 });
          r._chunks = chunks; // stop 후 늦게 흘러드는 마지막 청크가 다음 세그먼트에 섞이지 않게 녹화기별 소유
          r.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          r.start(500);
          return r;
        };
        this._rec = mk();
        this._recTimer = setInterval(function () {
          if (self._recHold) return;
          try { self._rec.stop(); } catch (e) {}
          self._rec = mk();
        }, 6000);
      } catch (e) { this.stopClipRec(); } // 녹화가 안 되는 환경이 방송을 막으면 안 된다
    },
    stopClipRec: function () {
      clearInterval(this._recTimer); this._recTimer = 0; this._recHold = false;
      try { if (this._rec && this._rec.state !== 'inactive') this._rec.stop(); } catch (e) {}
      if (this._recStream) this._recStream.getTracks().forEach(function (t) { t.stop(); });
      this._rec = null; this._recStream = null; this._recCanvas = null; this._recCtx = null;
    },
    // 녹화 합성 — 매 프레임 게임 화면 + 화면 위 HUD + 하단 조작부 + 채팅 미러를 합성 캔버스에 그린다.
    // 캔버스(#scene)만 녹화하면 시청자 수·조작 버튼처럼 DOM으로 그린 것이 클립에서 통째로 빠진다.
    // 외부 의존성(html2canvas류) 0건 방침이라 DOM 텍스트를 읽어 캔버스로 다시 그린다 — 연출 전용, C3 무관.
    REC_W: 1260, REC_H: 660,  // 게임 960×430 + 시청자 그래프 34 + 하단 HUD 196 / 오른쪽 채팅 300
    compositeRec: function () {
      if (!this._recCtx || this.phase !== 'live') return;
      var c = this._recCtx;
      c.drawImage(this.ctx.canvas, 0, 0);
      // 스트리머 캠 — 우하단 축소판(132px). 화면은 264px지만 클립에선 그만큼이 액션을 가린다.
      // 표정은 CAM_MOOD가 이미 골라 둔 것을 그대로 — 연출 전용이라 수치와 무관 (C3).
      var face = this._camFaces && this._camFaces[this._camMood];
      if (face && face.complete && face.naturalWidth) {
        var S = 132, bw = S + 12, bh = S + 28, bx = 960 - 12 - bw, by = 430 - 12 - bh;
        c.fillStyle = 'rgba(12,10,16,.78)'; c.fillRect(bx, by, bw, bh);
        c.strokeStyle = '#00ffa3'; c.lineWidth = 1; c.strokeRect(bx + .5, by + .5, bw - 1, bh - 1);
        c.drawImage(face, bx + 6, by + 6, S, S);
        c.fillStyle = '#7dffd0'; c.font = 'bold 10px system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText('LIVE CAM', bx + bw / 2, by + bh - 8);
      }
      this._recHud(c);     // 화면 위 오버레이 — 탈리·시청자 카운터·게임 HUD·연쇄 배수
      this._recBottom(c);  // 화면 아래 — 시청자 그래프·방송 정보줄·조작 패널·키 안내
      var feed = Chat.feed;
      c.textAlign = 'left';
      c.fillStyle = 'rgba(16,18,20,.94)'; c.fillRect(960, 0, 300, this.REC_H);
      c.fillStyle = 'rgba(0,255,163,.45)'; c.fillRect(960, 0, 1, this.REC_H);
      c.font = 'bold 10px system-ui, sans-serif';
      c.fillStyle = '#7dffd0'; c.fillText('실시간 채팅', 972, 18);
      if (!feed) return;
      var key = feed.childElementCount + '|' + (feed.lastElementChild ? feed.lastElementChild.textContent : '');
      if (key !== this._chatKey) {
        this._chatKey = key;
        var out = [], kids = feed.children;
        for (var i = Math.max(0, kids.length - 36); i < kids.length; i++) {
          var el = kids[i], b = el.querySelector('b');
          out.push({
            sys: el.classList.contains('csys'), don: el.classList.contains('cdon'),
            nick: b ? b.textContent : '', color: (b && b.style.color) || '#efeff1',
            text: b ? el.textContent.slice(b.textContent.length) : el.textContent,
          });
        }
        this._chatLines = out;
      }
      var y = this.REC_H - 10, lines = this._chatLines || [];
      for (var j = lines.length - 1; j >= 0 && y > 32; j--) {
        var L = lines[j];
        c.font = '11px system-ui, sans-serif';
        if (L.sys) { c.fillStyle = '#9d9ea3'; c.fillText(this._recTrunc(c, L.text, 276), 972, y); y -= 16; continue; }
        c.font = 'bold 11px system-ui, sans-serif';
        var nickW = c.measureText(L.nick).width + 5;
        c.fillStyle = L.color; c.fillText(L.nick, 972, y);
        c.font = '11px system-ui, sans-serif';
        c.fillStyle = L.don ? '#ffdf9e' : '#d5cdbd';
        c.fillText(this._recTrunc(c, L.text, 276 - nickW), 972 + nickW, y);
        y -= 16;
      }
    },
    _recTrunc: function (c, s, w) {
      s = String(s || '');
      if (c.measureText(s).width <= w) return s;
      while (s.length && c.measureText(s + '…').width > w) s = s.slice(0, -1);
      return s + '…';
    },
    // 숨은 요소는 빈 문자열 — textContent만 쓴다 (innerText는 매 프레임 레이아웃을 강제한다)
    _recTxt: function (id) {
      var e = $(id);
      if (!e || e.classList.contains('hidden')) return '';
      return (e.textContent || '').replace(/\s+/g, ' ').trim();
    },
    _recPlate: function (c, x, y, w, h, bd) {
      c.fillStyle = 'rgba(18,14,9,.86)'; c.fillRect(x, y, w, h);
      c.strokeStyle = bd || '#4a4232'; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, w - 1, h - 1);
    },
    // 화면 위 오버레이 미러 — 위치·색은 shell.css의 실제 배치를 따라간다
    _recHud: function (c) {
      var live = !$('tally').classList.contains('off');
      c.fillStyle = live ? 'rgba(178,44,36,.94)' : 'rgba(58,51,42,.94)';
      c.fillRect(0, 0, 960, 24);
      c.font = 'bold 11px system-ui, sans-serif'; c.fillStyle = live ? '#fff' : '#9a9184';
      c.textAlign = 'left';
      c.fillText('● ON AIR  ' + this._recTxt('tallyUp'), 12, 16);
      c.textAlign = 'right'; c.fillText(this._recTxt('tallyR'), 948, 16);

      // 시청자 카운터 — 체력바이자 점수(규약 1). 클립에서 이게 빠지면 아무것도 안 남는다
      var n = this._recTxt('viewerCount'), cold = $('liveBar').classList.contains('cold');
      c.font = 'bold 24px system-ui, sans-serif';
      var nw = c.measureText(n).width, pw = nw + 92, px = 480 - pw / 2;
      this._recPlate(c, px, 32, pw, 34, cold ? '#3a3f46' : '#4a4232');
      c.textAlign = 'left'; c.fillStyle = cold ? '#9aa0a8' : '#ffdf9e';
      c.fillText(n, px + 40, 57);
      c.font = '13px system-ui, sans-serif'; c.fillStyle = '#d5cdbd';
      c.fillText('명', px + 46 + nw, 57);
      c.font = 'bold 13px system-ui, sans-serif'; c.fillStyle = '#7dffd0';
      c.fillText('👁', px + 14, 55);

      var pace = this._recTxt('paceChip');
      if (pace) {
        c.font = '11.5px system-ui, sans-serif';
        var pcw = c.measureText(pace).width + 24;
        this._recPlate(c, 480 - pcw / 2, 74, pcw, 22);
        c.fillStyle = '#ffdf9e'; c.textAlign = 'center'; c.fillText(pace, 480, 89);
      }
      var pl = this._recTxt('plaque');   // 게임 HUD (stage.hud) — 방송 시간·진행 수치
      if (pl) {
        c.font = '12px system-ui, sans-serif';
        var plw = c.measureText(pl).width + 24;
        this._recPlate(c, 10, 34, plw, 26);
        c.fillStyle = '#c9cdd2'; c.textAlign = 'left'; c.fillText(pl, 22, 51);
      }
      if (!$('chainMeter').classList.contains('hidden')) {
        var cv2 = this._recTxt('chainVal'), hot = $('chainMeter').classList.contains('hot');
        this._recPlate(c, 860, 34, 90, 46, hot ? '#ffb447' : '#4a4232');
        c.textAlign = 'center'; c.font = '10px system-ui, sans-serif'; c.fillStyle = '#6b6455';
        c.fillText('연쇄 배수', 905, 50);
        c.font = 'bold 22px system-ui, sans-serif'; c.fillStyle = hot ? '#ffdf9e' : '#ffb447';
        c.fillText(cv2, 905, 72);
      }
    },
    // 화면 아래 — 시청자 그래프(캔버스라 그대로 복사) + 방송 정보줄 + 게임 조작 패널 + 키 안내.
    // 패널은 매 프레임 갱신돼서 0.2초 캐시로 읽는다 (DOM 순회를 60fps로 돌릴 이유가 없다).
    _recBottom: function (c) {
      var g = $('liveGraph');
      if (g) c.drawImage(g, 0, 430, 960, 34);
      c.fillStyle = '#141517'; c.fillRect(0, 464, 960, this.REC_H - 464);
      c.fillStyle = '#2e3138'; c.fillRect(0, 464, 960, 1);

      c.textAlign = 'left';
      c.font = 'bold 14px system-ui, sans-serif'; c.fillStyle = '#ece7dd';
      var title = this._recTxt('infoTitle');
      c.fillText(this._recTrunc(c, title, 640), 12, 486);
      c.font = '11.5px system-ui, sans-serif'; c.fillStyle = '#6b6455';
      c.fillText(this._recTxt('infoCat') + ' · ' + this._recTxt('infoUptime'), 12, 502);
      c.textAlign = 'right'; c.font = 'bold 14px system-ui, sans-serif'; c.fillStyle = '#ffb447';
      c.fillText('👁 ' + this._recTxt('infoViewers'), 948, 486);

      var foot = this._recTxt('foot');
      if (foot) {
        c.textAlign = 'center'; c.font = '11px system-ui, sans-serif'; c.fillStyle = '#6b6455';
        c.fillText(this._recTrunc(c, foot, 940), 480, this.REC_H - 7);
      }

      // 구조(어떤 칸에 어떤 줄이 있나)만 0.2초마다 다시 훑고, 값(게이지 폭·버튼 라벨)은
      // 매 프레임 요소에서 직접 읽는다 — 게이지가 차오르는 게 클립에서도 실시간으로 보여야 한다.
      // style.width·textContent는 레이아웃을 강제하지 않아 매 프레임 읽어도 공짜다.
      if (this.now - (this._recPanelAt || -9) > .2) {
        this._recPanelAt = this.now;
        var host = $('panel');
        var els = host.querySelectorAll('.bcol');
        if (!els.length) els = host.querySelectorAll('button');
        if (!els.length) els = host.children;
        this._recChips = Array.prototype.map.call(els, function (el) {
          return { el: el, parts: el.children.length ? Array.prototype.slice.call(el.children) : [el] };
        });
      }
      var chips = this._recChips || [], top = 512, h = this.REC_H - top - 22;
      if (!chips.length) return;
      var gap = 8, w = (960 - 20 - gap * (chips.length - 1)) / chips.length;
      for (var i2 = 0; i2 < chips.length; i2++) {
        var ch = chips[i2], cls = ch.el.className || '', x = 10 + i2 * (w + gap);
        var hot = /\bhot\b/.test(cls), lock = /\blocked\b/.test(cls);
        c.fillStyle = lock ? '#131417' : '#1d1810'; c.fillRect(x, top, w, h);
        c.strokeStyle = hot ? '#ffb447' : lock ? '#2c3036' : '#3a332a';
        c.lineWidth = 1; c.strokeRect(x + .5, top + .5, w - 1, h - 1);
        var yy = top + 17, head = true;
        for (var k = 0; k < ch.parts.length; k++) {
          var p = ch.parts[k], pc = p.className || '', kid = p.firstElementChild;
          var fw = kid && kid.style && kid.style.width;
          if (fw && fw.slice(-1) === '%') {   // 게이지 — .prog>i(조리 진행) / .win>i(수습 제한시간)
            var isWin = /\bwin\b/.test(pc), bh2 = isWin ? 7 : 5;
            c.fillStyle = isWin ? '#3a1418' : '#000';
            c.fillRect(x + 8, yy - 4, w - 16, bh2);
            c.fillStyle = isWin ? '#b8332a' : '#4dd8e6';
            c.fillRect(x + 8, yy - 4, (w - 16) * Math.max(0, Math.min(1, parseFloat(fw) / 100)), bh2);
            yy += bh2 + 9; continue;
          }
          var t = (p.textContent || '').replace(/\s+/g, ' ').trim();
          if (!t) continue;
          c.textAlign = 'center';
          if (p.tagName === 'BUTTON') {       // 수습 버튼 — 화면처럼 눈에 띄어야 한다
            c.fillStyle = '#b8332a'; c.fillRect(x + 8, yy - 11, w - 16, 20);
            c.fillStyle = '#fff'; c.font = 'bold 12px system-ui, sans-serif';
            c.fillText(this._recTrunc(c, t, w - 20), x + w / 2, yy + 3);
            yy += 26; continue;
          }
          c.font = (head ? 'bold 12.5px' : '11px') + ' system-ui, sans-serif';
          c.fillStyle = head ? (hot ? '#ffdf9e' : '#ece7dd')
            : /\baccname\b/.test(pc) ? '#ff8d7a' : lock ? '#6b6455' : '#c9cdd2';
          c.fillText(this._recTrunc(c, t, w - 12), x + w / 2, yy);
          yy += head ? 18 : 15; head = false;
        }
      }
    },

    // ---------- 페이스 압박 (연출 전용 — 수치 무관) ----------
    // "남은 시간 3분"과 숫자를 잇는 긴장 장치. 신기록 추격 > 마일스톤 임박 순으로 하나만.
    MILESTONES: [1000, 5000, 15000, 60000, 150000, 500000],
    updatePace: function () {
      var chip = $('paceChip'), v = Math.ceil(this.viewers);
      var best = this.ch.best[this.game.id] || 0;
      var txt = '', hot = false;
      if (best > 0 && v > best) {
        txt = '★ 신기록 갱신 중'; hot = true;
        if (!this._recordStamped) {
          this._recordStamped = true; this.showStamp('★ 신기록');
          // 단골이 종전 기록을 기억하고 있다 — 스탬프(큰 자극)와 겹치지 않게 한 박자 뒤 (규약 3)
          Chat.memory('record_live', { best: best.toLocaleString() }, null, 900);
        }
        this.paceTag();
      } else if (best > 0 && v > best * 0.8) {
        txt = '신기록 페이스 — 기록 ' + best.toLocaleString();
        this.paceTag();
      } else {
        for (var i = 0; i < this.MILESTONES.length; i++) {
          var m = this.MILESTONES[i];
          if (v < m && v >= m * 0.85) { txt = m.toLocaleString() + '명까지 -' + (m - v).toLocaleString(); break; }
          if (v < m) break;
        }
      }
      chip.innerHTML = txt.replace(/★/g, STAR); // 내부 상수만 들어온다
      chip.classList.toggle('hidden', !txt);
      chip.classList.toggle('hot', hot);
    },

    // 신기록 페이스 = 셸만 아는 판 상태 — 방송당 1회 record_pace 태그 발행 (도감 §6.2 ⚠ 처방).
    // 관측단 스프레드시트파·통계인용러의 칸이 여기서 열린다. 메타 통화만 — 시청자 수 무관여
    paceTag: function () {
      if (this._paceTagged || !Shell.Dex || !this.game) return;
      this._paceTagged = true;
      Shell.Dex.judge(this.game.id, 'record_pace');
    },

    // ---------- 튜토리얼 ----------
    // 채팅으로 흘리면 시작 버스트에 묻힌다 — 화면에 남겨 두고 다음 단계가 덮는다.
    // 게임별 조작은 그 게임을 처음 켤 때, 공통 규칙은 첫 방송에 한 번.
    tutorial: function (g) {
      var self = this, steps = [];
      this._tutT.forEach(clearTimeout); this._tutT.length = 0;
      var gk = 'JGS_TUT_' + g.id;
      if (!localStorage.getItem(gk)) {
        localStorage.setItem(gk, '1');
        // foot(화면 아래 조작 안내)의 첫 줄을 그대로 쓴다 — 따로 적으면 조작이 바뀔 때 여기만 낡는다
        var ctl = String(g.foot || '').split('<br>')[0].replace(/<[^>]+>/g, '').trim();
        if (ctl) steps.push([2, '조작 — ' + ctl]);
      }
      if (!localStorage.getItem('JGS_TUT')) {
        localStorage.setItem('JGS_TUT', '1');
        steps.push([13, '잘한 플레이도, 아슬아슬한 사고도 전부 시청자를 부른다 — 시청자가 0명이 되면 방송이 끝난다']);
        steps.push([25, '같은 게임만 파면 시청자가 물린다(신선도) — 방송을 바꿔가며 도는 게 종겜이다']);
      }
      if (!steps.length) return;
      steps.forEach(function (s, i) {
        self._tutT.push(setTimeout(function () {
          if (self.phase !== 'live' || self.game !== g) return; // 지난 방송의 예약분은 버린다
          self.tutTip(s[1]);
          // 마지막 단계는 덮어 줄 다음 단계가 없으니 스스로 물러난다
          if (i === steps.length - 1) self._tutT.push(setTimeout(function () { self.tutTip(''); }, 8000));
        }, s[0] * 1000));
      });
    },

    tutTip: function (text) {
      var el = $('tutTip');
      if (!el) return;
      if (!text) { el.classList.remove('show'); return; }
      el.innerHTML = '<i>TIP</i><span>' + text + '</span>';
      el.classList.add('show');
      el.onclick = function () { el.classList.remove('show'); }; // 읽었으면 치울 수 있어야 한다
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
      this._tutT.forEach(clearTimeout); this._tutT.length = 0;
      this.tutTip(''); // 리포트 위에 팁이 남으면 안 된다
      this.stopClipRec(); // 종료 직전 클립(2.5초 여운 대기 중)은 스틸로만 남는다 — 감수
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

      // 클립 정산 — 흥미도 상위 KEEP개만 남기고, 표시는 시간순 (방송의 서사 순서)
      var clips = (this._clips || []).slice().sort(function (a, b) { return b.s - a.s; })
        .slice(0, Shell.CLIP.KEEP).sort(function (a, b) { return a.t - b.t; });
      this._repClips = clips;
      // 세션 하이라이트 아카이브 — 영상 있는 클립을 방송을 넘어 보관 (흥미도 상위 8,
      // blob URL이라 새로고침까지만 산다). 다음 방송의 조용한 구간에 '다시보기'로 재생.
      var arch = Shell._clipArchive = Shell._clipArchive || [];
      (this._clips || []).forEach(function (c) { if (c.vid) arch.push(c); });
      // 보관함 — 세션 아카이브는 새로고침에 날아간다. 흥미도 상위 KEEP개는 디스크(IndexedDB)로 넘긴다
      if (Shell.Clips) Shell.Clips.save(clips);
      arch.sort(function (a, b) { return b.s - a.s; });
      while (arch.length > 8) {
        var old = arch.pop();
        if (old.vid && clips.indexOf(old) < 0) URL.revokeObjectURL(old.vid);
      }
      var bestClip = null;
      for (var bc = 0; bc < clips.length; bc++) if (!bestClip || clips[bc].s > bestClip.s) bestClip = clips[bc];

      // 방송이 채널의 색을 물들인다 — 이월의 핵심. 저장 전에 반영한다
      var mixBefore = this.ch.mix.slice();
      this.absorbMix();

      // 탐색 보너스 — 관객이 골고루 모인 방송일수록 구독자가 더 남는다.
      // 방송 중 시청자 수에는 손대지 않고 메타 통화에만 얹으므로 승인 밸런스와 충돌하지
      // 않으면서, "채널 색을 관리할 이유"가 처음으로 생긴다 (ADR-004 결정 7)
      var div = this.diversity(), divMult = 1 + DIV_BONUS * div;
      // 파장 — 이번 방송에 처음 들은 반응 칸 수 (ADR-006). 다양성과 같은 원리로 메타 통화에만.
      // 텐션(§7)은 파장 배율 안에서 대역폭으로 곱해진다 — 감쇠(settleShow)는 배율을 읽은 뒤
      var waveNew = Shell.Dex ? Shell.Dex.waveNew : 0;
      var waveMult = Shell.Dex ? Shell.Dex.waveMult() : 1;
      var tensionAfter = 0;
      if (Shell.Dex) { Shell.Dex.settleShow(g.id); tensionAfter = Math.round(Shell.Dex.tension()); }
      var newSubs = Math.floor(final / 100 * divMult * waveMult); // 최종 시청자의 1% × 다양성 × 파장
      this.ch.subs += newSubs;
      this.ch.shows++;
      Shell.advanceDay(this.ch); // 방송 한 판 = 하루 (시즌 판정은 허브 복귀 때)
      var earned = this._showCoins || 0;
      this.ch.coins += earned; // 도네 코인 정산 — 상점(방송용품)의 재원

      // ---------- 파트너 평가 (김 피디) + 미션 정산 — 전부 관측 산물만 읽는다 (C3) ----------
      var peak = final;
      for (var gi = 0; gi < this._graph.length; gi++) peak = Math.max(peak, this._graph[gi].v);
      var isDead = reason === 'dead' || reason === 'crash';
      // start는 실제 출발선(구독자 보너스·송출기 포함). ADR-008 §2 — 여기가 g.startViewers면
      // 강화가 등급을 무상으로 밀어 올린다. rig는 잔여 인플레를 걷는 세금(§4)
      var evGrade = Shell.gradeShow({ final: final, start: this._start0 || g.startViewers, peak: peak,
        rig: Shell.rigTotal(this.ch),
        clips: (this._clips || []).length, coins: earned, freshPct: this._showFresh, dead: isDead });
      var got = { peak: Math.round(peak), coins: earned, clips: (this._clips || []).length };
      var mBonus = 0, mParts = 0;
      var missions = (this._missions || []).map(function (m) {
        var hit = got[m.k] >= m.target;
        if (hit) { mBonus += m.reward; mParts += 1; }
        return { m: m, hit: hit, got: got[m.k] };
      });
      this.ch.coins += mBonus;
      // 부품은 미션에서만 나온다 (ADR-008 §6.2). 코인으로 살 수 있게 하면 도네(랜덤 파생)가
      // 강화 속도를 정하게 되어 양념이 뼈대를 밀어낸다 (규약 5)
      this.ch.parts = (this.ch.parts || 0) + mParts;
      // 장비 유지비 — 이번 방송 수입을 이력에 넣기 전에 걷는다 (이번 수입이 이번 청구서에
      // 섞이면 안 된다). 못 내면 조용히 한 단계 강등 (규약 2 — 손실 무연출)
      var upkeep = Shell.rigSettle(this.ch, earned);
      // 이 방송이 다음 게임의 열쇠가 된다 (해금 사슬) — 등급과 무관하게 횟수만 센다
      Shell.recordPlay(this.ch, g.id);
      var chNow = this.ch;
      var opened = this.games.filter(function (x) {
        var u = Shell.unlockState(chNow, x.id);
        return u.open && u.from === g.id && u.have === u.need;   // 이번 방송으로 관문이 막 찬 게임
      }).map(function (x) { return x.title; });
      opened.forEach(function (t) { Chat.sys('— 새 방송 콘텐츠 해금: ' + t + ' —'); });

      // 파트너 등급 게이지 — 승급은 과하게, 하락(게이지 감소)은 숫자만 조용히 (규약 2)
      var ts = Shell.tierStep(this.ch.tier || 0, this.ch.tierPts || 0, evGrade.grade);
      this.ch.tier = ts.tier; this.ch.tierPts = ts.pts;
      if (ts.promoted) this.showStamp('★ ' + Shell.TIERS[ts.tier].n + ' 파트너 승급!');
      else if (opened.length) this.showStamp('★ ' + opened[0] + ' 해금!');
      else if (!isDead && (evGrade.grade === 'S' || evGrade.grade === 'A')) this.showStamp('파트너 평가 ' + evGrade.grade);
      // 최고 흥미도 클립 1장이 채널 기록에 남는다 (240x108 JPEG ≈ 8KB — localStorage 부담 미미)
      this.ch.log.unshift({ g: g.title, v: final, r: isRecord,
        d: isDead ? 1 : 0, // 강제 종료 여부 — 다음 방송의 단골 인사(after_dead)가 읽는다
        c: bestClip ? bestClip.img : 0,
        cm: bestClip ? bestClip.mood + ' · ' + Shell.util.fmtTime(bestClip.t) : '' });
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
      // 사고 난 게임은 summary도 못 믿는다 — 실패하면 통계 없이 정산한다
      var stats = [];
      try { if (this.inst && this.inst.summary) stats = this.inst.summary() || []; } catch (e2) {}
      var rows = stats.map(function (r) { return '<span>' + r[0] + '</span><b>' + r[1] + '</b>'; }).join('');
      var clipHtml = clips.length
        ? '<div class="clipLab">오늘의 클립 — 흥미 포인트 자동 캡처</div><div class="clipRow">' +
          clips.map(function (c) {
            return '<figure class="clipCard">' +
              (c.vid
                ? '<video src="' + c.vid + '" autoplay muted loop playsinline></video>'
                : '<img src="' + c.img + '" alt="">') +
              '<figcaption><b>' + Shell.util.fmtTime(c.t) + '</b> ' + c.mood + ' · 흥미도 ' +
              Math.round(c.s * 100) + '%' +
              (c.why.length ? '<span class="cwhy">' + c.why.join(' · ') + '</span>' : '') +
              '</figcaption></figure>';
          }).join('') + '</div>'
        : '';

      // 김 피디 카드 — 등급·한줄평·최약 항목 지적·미션 결과
      var pdPool = this.PD_LINES[evGrade.grade];
      var pdLine = pdPool[Math.floor(Math.random() * pdPool.length)];
      var tip = '';
      if (evGrade.grade === 'B' || evGrade.grade === 'C' || evGrade.grade === 'D') {
        var norm = [['growth', 40], ['hold', 20], ['clips', 18], ['don', 12], ['vari', 10]];
        var worst = null, wv = 2;
        norm.forEach(function (n) { var r2 = evGrade.parts[n[0]] / n[1]; if (r2 < wv) { wv = r2; worst = n[0]; } });
        if (worst) tip = '<div class="pdTip">' + this.PD_TIPS[worst] + '</div>';
      }
      var mHtml = missions.length
        ? '<div class="pdMis">' + missions.map(function (r3) {
            return '<span class="' + (r3.hit ? 'hit' : 'miss') + '">' + (r3.hit ? '✓' : '—') + ' ' +
              r3.m.label + ' ' + r3.m.target.toLocaleString() +
              (r3.hit ? ' <b>+' + r3.m.reward.toLocaleString() + '코인</b>'
                      : ' (기록 ' + r3.got.toLocaleString() + ')') + '</span>';
          }).join('') + '</div>'
        : '';
      var pdHtml = '<div class="pdCard">' +
        '<img src="games/shell/img/kim-pd.png" alt="" onerror="this.style.display=\'none\'">' +
        '<div class="pdBody"><div class="pdTop"><span class="pdWho">담당 김 피디</span>' +
        '<span class="pdGrade g' + evGrade.grade + '">' + evGrade.grade + '</span>' +
        '<span class="pdScore">' + evGrade.score + '점 · 성장 ' + evGrade.parts.growth + ' · 유지 ' + evGrade.parts.hold +
        ' · 클립 ' + evGrade.parts.clips + ' · 도네 ' + evGrade.parts.don + ' · 종겜 ' + evGrade.parts.vari + '</span></div>' +
        '<div class="pdLine">"' + pdLine + '"</div>' + tip + mHtml +
        (function () { // 등급 게이지 — 다음 등급까지의 진행. 승급은 크게, 감소는 숫자만
          var T = Shell.TIERS[ts.tier], need = Shell.TIER_NEED[ts.tier];
          var bar = need
            ? '<div class="tbar"><i style="width:' + Math.round(ts.pts / need * 100) + '%;background:' + T.c + '"></i></div>' +
              '<span class="tpts">' + ts.pts + '/' + need +
              (ts.delta ? ' (' + (ts.delta > 0 ? '+' : '') + ts.delta + ')' : '') + '</span>'
            : '<span class="tpts">최고 등급</span>';
          return '<div class="pdTier' + (ts.promoted ? ' up' : '') + '">' +
            '<span class="tname" style="color:' + T.c + '">' + (ts.promoted ? STAR + ' ' : '') + T.n + ' 파트너</span>' +
            bar + '</div>';
        })() +
        '</div></div>';

      var head = reason === 'dead' ? '송출 끊김' : reason === 'crash' ? '게임 튕김' : '방송 리포트';
      var lead = reason === 'dead' ? '시청자가 전부 떠났다. 검은 화면만 남았다.'
        : reason === 'crash' ? '게임이 뻗었다. 급하게 정산하고 방송을 접었다 — 이것도 방송사고다.'
        : reason === 'clear' ? '오늘 방송, 잘 뽑혔다.'
        : g.title + ' 방송이 끝났다. 오늘의 그래프:';

      $('overlay').classList.remove('hidden');
      $('overlay').innerHTML = '<div class="panel">' +
        '<h2>' + head + '</h2><p>' + lead + '</p>' +
        pdHtml +
        '<canvas id="repGraph" width="620" height="150"></canvas>' +
        clipHtml +
        '<div class="statgrid">' +
          '<span>최종 시청자</span><b>' + final.toLocaleString() + '명 ' +
            (isRecord ? '<span class="rec">' + STAR + ' 신기록</span>' : '(기록 ' + Math.max(prevBest, final).toLocaleString() + ')') + '</b>' +
          rows +
          '<span>채널 구독자</span><b>+' + newSubs.toLocaleString() + ' → ' + this.ch.subs.toLocaleString() + '명' +
            ' <span class="' + (divMult >= 1.3 ? 'rec' : 'fine') + '">다양성 ×' + divMult.toFixed(2) + '</span></b>' +
          '<span>도네 수익</span><b>+' + earned.toLocaleString() + ' 코인 → 잔액 ' + this.ch.coins.toLocaleString() + '</b>' +
          (mParts > 0 ? '<span>장비 부품</span><b>+' + mParts + '개 <span class="fine">— 미션 달성분. 보유 ' +
            this.ch.parts + '개</span></b>' : '') +
          // 유지비·강등은 숫자만 조용히 (규약 2 — 손실 무연출). 강조도 색도 붙이지 않는다
          (upkeep.due > 0 ? '<span>장비 유지비</span><b>−' + upkeep.paid.toLocaleString() + ' 코인' +
            (upkeep.demoted ? ' <span class="fine">— 미납. ' + Shell.RIG[upkeep.demoted].n +
              ' Lv' + Shell.rigLv(this.ch, upkeep.demoted) + '로 내려갔다</span>' : '') + '</b>' : '') +
          (waveNew > 0 ? '<span>반응 도감</span><b>처음 들은 반응 ' + waveNew + '칸 <span class="rec">파장 ×' +
            waveMult.toFixed(2) + '</span></b>' : '') +
          (Shell.Dex ? '<span>컨디션</span><b>텐션 ' + tensionAfter + '%' +
            (tensionAfter <= 30 ? ' <span class="fine">— 지쳤다. 휴방이 새 반응을 되살린다</span>' : '') + '</b>' : '') +
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
          // 카운터 식음 — 2.5초 넘게 획득이 없으면 잿빛으로 식는다. 손실 무연출 원칙(규약 2)을
          // 지키면서 "새고 있다"는 압박만 온도로 전달한다
          $('liveBar').classList.toggle('cold', this.now - this._lastGainAt > 2.5);
          this.updatePace();
          this.fitHud(); // 창 크기 변화 대비 — 1초 주기면 충분
        }
        if (this.phase === 'starting') {
          this.fitHud();
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
      if (this.phase === 'live') this.drainFickle(dt); // 뜨내기는 스스로 빠져나간다
      if (this.phase === 'live') {
        // 시청자 그래프 표본 (1초 간격) + 업타임 + 스파크라인
        this._graphT += dt; this._upT += dt;
        this._surgeAcc *= Math.exp(-dt / 1.4); // 급증 신호는 ~1.4초 반감 — '방금'만 급증이다
        // 조용한 구간의 하이라이트 다시보기 — 진짜 스트리머처럼 과거 명장면이 좌상단에 돈다.
        // 최근 45초 안에 리플레이가 없었을 때만 (규약 3 — 큰 자극과 겹치지 않게)
        if (this._upT > 25 && this._upT - this._lastReplayAt > 45 && !this._replayBusy &&
            Shell._clipArchive && Shell._clipArchive.length) {
          var arc = Shell._clipArchive;
          this.showReplay(arc[Math.floor(Math.random() * arc.length)], '하이라이트 다시보기');
        }
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
      this.compositeRec(); // 클립 녹화용 게임+채팅 합성 (녹화 중일 때만 동작)
      requestAnimationFrame(this.loop.bind(this));
    },

    // 방송 화면 전폭의 실시간 그래프 — "플레이하면서 그래프가 보여야 압박이 온다"(피드백).
    // 시청자 추이 + 큰 획득의 스파이크 마커. 반투명이라 게임 화면을 가리지 않는다.
    drawSpark: function () {
      var cv = $('liveGraph'); if (!cv) return;
      var c = cv.getContext('2d'), W2 = cv.width, H2 = cv.height;
      c.clearRect(0, 0, W2, H2);
      var g = this._graph; if (g.length < 2) return;
      var vmax = 1; for (var i = 0; i < g.length; i++) vmax = Math.max(vmax, g[i].v);
      var X = function (k) { return k / (g.length - 1) * W2; };
      var Y = function (v) { return H2 - 2 - (v / vmax) * (H2 - 7); };
      var fill = c.createLinearGradient(0, 0, 0, H2);
      fill.addColorStop(0, 'rgba(255,180,71,.26)'); fill.addColorStop(1, 'rgba(255,180,71,0)');
      c.beginPath(); c.moveTo(0, H2);
      for (var k = 0; k < g.length; k++) c.lineTo(X(k), Y(g[k].v));
      c.lineTo(X(g.length - 1), H2); c.closePath();
      c.fillStyle = fill; c.fill();
      c.strokeStyle = 'rgba(255,210,122,.85)'; c.lineWidth = 1.5; c.beginPath();
      for (var j = 0; j < g.length; j++) j ? c.lineTo(X(j), Y(g[j].v)) : c.moveTo(X(j), Y(g[j].v));
      c.stroke();
      // 스파이크 마커 — 큰 획득(+150 이상)의 순간이 점으로 남는다
      c.fillStyle = '#ffd27a';
      var tMax = g[g.length - 1].t || 1;
      for (var m = 0; m < this._marks.length; m++) {
        var xt = this._marks[m] / tMax; if (xt > 1) continue;
        var idx = Math.min(g.length - 1, Math.round(xt * (g.length - 1)));
        c.beginPath(); c.arc(X(idx), Y(g[idx].v), 2.5, 0, Math.PI * 2); c.fill();
      }
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
      // 클립 마커 (민트) — "어느 포인트가 흥미를 유발했는가"가 그래프 위에 남는다
      var clips = this._repClips || [], tMax2 = g[g.length - 1].t || 1;
      for (var q = 0; q < clips.length; q++) {
        var ci = Math.min(g.length - 1, Math.round(clips[q].t / tMax2 * (g.length - 1)));
        c.strokeStyle = 'rgba(0,255,163,.3)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(X(ci), Y(g[ci].v) + 4); c.lineTo(X(ci), H2 - 14); c.stroke();
        c.fillStyle = '#00ffa3';
        c.beginPath(); c.arc(X(ci), Y(g[ci].v), 3, 0, Math.PI * 2); c.fill();
      }
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

  // 클립 흥미도 — 순수 함수로 떼어 둔 이유: 임계·감쇠가 조용히 틀리면 클립이 도배되거나
  // 영영 안 잡힌다. 검증: games/shell/selftest.html
  //   base    = (버스트 무게-1)/3 → 무게 2(도네급 양념)는 급증 만점에도 임계 미달 (규약 5)
  //   novelty = FRESH_MULT[방송 내 발생 횟수] → 3회째부터는 무엇이어도 클립 불가 (규약 4)
  //   surge   = 직전 시청자 급증 0~1 → 무게 4의 설계 피크만 급증 없이도 통과
  // ---------- 파트너 등급 — "JGS.tv 파트너 계약"의 상설 압박 (기획안 ③) ----------
  // 평가 등급이 게이지를 채우고, C/D는 게이지만 조용히 깎는다 (규약 2 — 벌은 성장 속도에만).
  // 등급 자체는 내려가지 않고, 구독자·코인·시청자도 절대 깎지 않는다. 검증: selftest.
  Shell.TIERS = [
    { n: '브론즈',   c: '#c08a52' }, { n: '실버', c: '#c8d0d8' }, { n: '골드', c: '#ffd24a' },
    { n: '플래티넘', c: '#9ec8e0' }, { n: '다이아', c: '#7de8ff' },
  ];
  Shell.TIER_NEED = [6, 10, 14, 18];            // i등급 → i+1등급에 필요한 게이지
  Shell.TIER_PTS = { S: 3, A: 2, B: 1, C: -1, D: -2 };
  Shell.tierStep = function (tier, pts, grade) {
    var d = Shell.TIER_PTS[grade] || 0;
    pts = Math.max(0, pts + d);                  // 바닥 0 — 게이지가 음수로 빚지지 않는다
    var promoted = false;
    while (tier < Shell.TIER_NEED.length && pts >= Shell.TIER_NEED[tier]) {
      pts -= Shell.TIER_NEED[tier]; tier++; promoted = true;
    }
    return { tier: tier, pts: pts, promoted: promoted, delta: d };
  };

  // ---------- 파트너 평가 (김 피디) — "JGS.tv 파트너 계약" 스토리의 평가 장치 ----------
  // 결정론 공식 · 관측 산물(시청자·클립·코인)만 읽는다 (C3). 검증: selftest.
  //   성장(40) 최종/시작 로그 스케일 · 유지(20) 최종/피크 · 클립(18) · 도네(12) · 종겜(10)
  //   송출 끊김·튕김은 ×0.6 — 방송사고로는 S/A가 나오지 않는다.
  Shell.gradeShow = function (m) {
    var growth = clamp(Math.log10(Math.max(1, m.final / Math.max(1, m.start))) * 25, 0, 40);
    var hold = m.peak > 0 ? clamp(m.final / m.peak, 0, 1) * 20 : 0;
    var clips = Math.min(3, m.clips || 0) * 6;
    var don = clamp(Math.log10((m.coins || 0) + 1) * 4, 0, 12);
    var vari = m.freshPct >= 100 ? 10 : m.freshPct >= 70 ? 5 : 0;
    var score = growth + hold + clips + don + vari;
    // 기대치 세금 (ADR-008 §4) — 장비가 좋으면 같은 결과의 값어치가 떨어진다.
    // "장비가 그 정돈데, 이 정도면…" — 재화는 강화로 늘고 명성은 실력으로만 늘게 하는 마지막 고리
    score -= Shell.RIG_TAX * (m.rig || 0);
    if (m.dead) score *= .6;
    score = Math.round(score);
    var g = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D';
    return { score: score, grade: g,
      parts: { growth: Math.round(growth), hold: Math.round(hold), clips: clips, don: Math.round(don), vari: vari } };
  };

  // ---------- 30일 시즌 (캠페인) ----------
  // 계약 기간이 있어야 "오늘 뭘 방송할까"가 선택이 된다. 기간이 없으면 신선도도 해금도
  // 그냥 기다리면 풀리는 것이 되어 전략이 사라진다.
  // 목표를 최고 동시 시청자로 잡은 이유: 이 게임의 "시청자를 모은다"는 방송 한 판의
  // 시청자 수를 뜻한다 (규약 1 — 시청자 수가 곧 점수·체력). 누적 구독자는 이월 보너스
  // 쪽 수치라 목표로 쓰면 규약 1과 어긋난다.
  // GOAL은 밸런스 손잡이다 — 게임 안 최고 기준선(주머니 괴수 4번 슬롯 350,000) 바로 아래.
  Shell.CAMPAIGN = { DAYS: 30, GOAL: 300000 };

  Shell.bestAll = function (ch) {
    var m = 0;
    for (var k in (ch.best || {})) m = Math.max(m, ch.best[k] || 0);
    return m;
  };

  // 하루 소비 — 방송 한 판도, 휴방도 똑같이 하루다 (쉬는 것도 선택이어야 하므로 공짜가 아니다)
  Shell.advanceDay = function (ch) { ch.day = (ch.day || 1) + 1; return ch.day; };

  // 시즌 판정 — 순수 함수. 조용히 틀리면 시즌이 안 끝나거나 멀쩡한 채널이 죽는다.
  // 검증: games/shell/selftest.html
  Shell.campaign = function (ch) {
    var C = Shell.CAMPAIGN, best = Shell.bestAll(ch), day = ch.day || 1;
    var left = C.DAYS - day + 1;                       // 오늘 포함 남은 일수
    var st = best >= C.GOAL ? 'clear' : (day > C.DAYS ? 'over' : 'run');
    return { state: st, day: day, days: C.DAYS, left: Math.max(0, left),
             best: best, goal: C.GOAL, pct: Math.min(100, best / C.GOAL * 100) };
  };

  // ---------- 방송 해금 사슬 ----------
  // 다음 게임은 "직전 게임을 몇 번 방송했나"로 열린다. 등급 관문(B·A 몇 회)이었을 때는
  // 실력이 모자라면 사슬 자체가 멈춰서, 30일 안에 마지막 게임을 만져보지도 못하고 시즌이
  // 끝났다 — 종겜(여러 게임을 도는 것)이라는 컨셉이 잠겨 버린다.
  // 방송 횟수로 바꾸면 해금은 반드시 진행되고, 실력은 등급·미션·시즌 목표에서 겨룬다.
  Shell.UNLOCK = [
    { id: 'hwaryeok' },                              // 첫 방송 — 항상 열려 있다
    { id: 'giving-up', from: 'hwaryeok',  times: 2 },
    { id: 'pocket',    from: 'giving-up', times: 2 },
    { id: 'bomb',      from: 'pocket',    times: 3 },
    { id: 'fishing',   from: 'bomb',      times: 3 },
  ];

  // 정산이 부르는 기록기 — 등급과 무관하게 "방송했다"는 사실만 센다
  Shell.recordPlay = function (ch, gameId) {
    if (!ch.plays) ch.plays = {};
    ch.plays[gameId] = (ch.plays[gameId] || 0) + 1;
    return ch.plays[gameId];
  };

  // 해금 상태 — 순수 함수로 떼어 둔 이유는 shopBuy와 같다. 조용히 틀리면 게임이
  // 영영 안 열리거나 전부 열린다. 검증: games/shell/selftest.html
  Shell.unlockState = function (ch, gameId) {
    var u = null;
    for (var i = 0; i < Shell.UNLOCK.length; i++) if (Shell.UNLOCK[i].id === gameId) u = Shell.UNLOCK[i];
    if (!u || !u.from) return { open: true };   // 사슬에 없는 게임은 잠그지 않는다
    var have = (ch.plays || {})[u.from] || 0;
    return { open: have >= u.times, from: u.from, need: u.times, have: have };
  };

  // 오늘의 미션 — 결정론 (shows 회차로 회전, 목표는 채널 기록에 비례). 보상은 코인(장식 재원)뿐.
  Shell.makeMissions = function (ch) {
    var bestAll = 0;
    for (var k in ch.best) bestAll = Math.max(bestAll, ch.best[k] || 0);
    // 목표는 자기 최고 기록의 35%다 (전 60%). 최고 기록은 잘 풀린 날의 수치라 그 60%를
    // 매 방송 요구하면 평범한 날은 무조건 실패한다 — 미션이 보상이 아니라 벌점이 된다.
    var pool = [
      { k: 'peak',  label: '피크 시청자', target: Math.max(600, Math.round(bestAll * .35 / 100) * 100), reward: 600 },
      { k: 'coins', label: '도네 코인',   target: Math.min(1500, 150 + ch.shows * 50), reward: 600 },
      { k: 'clips', label: '클립',        target: 1, reward: 600 },
    ];
    var i = ch.shows % 3;
    return [pool[i], pool[(i + 1) % 3]];
  };

  // ---------- 방송 장비 (ADR-008) ----------
  // 불변식: 강화는 재화(시청자·코인)만 늘리고 명성(등급)은 늘리지 못한다.
  // 세 계열 모두 gradeShow에 상쇄 항이 이미 있고(송출기→growth 분모, 조명→hold, 도네→log 포화),
  // 남는 인플레는 RIG_TAX가 흡수한다. 포화("다 사면 끝")는 유지비가 구조적으로 막는다.
  Shell.RIG = {
    feed:  { n: '송출기',   d: '기본 시청자 보장',  floor: [0, 250, 600, 1200] },
    stage: { n: '조명·무대', d: '획득 배율',        mult:  [1, 1.10, 1.20, 1.32] },
    don:   { n: '도네 알림', d: '도네 빈도',
             gap: [1, .85, .72, .60], prob: [0, .08, .15, .22] },
  };
  Shell.RIG_LINES = ['feed', 'stage', 'don'];
  // 부품은 미션 보상에서만 나온다 — 코인으로 사면 도네(랜덤)가 강화 속도를 정하게 된다
  Shell.RIG_COST = [null,
    { coins: 1500,  parts: 2, tier: 0 },
    { coins: 6000,  parts: 5, tier: 1 },
    { coins: 20000, parts: 9, tier: 2 }];
  Shell.RIG_TAX = 1.5;      // 레벨당 등급 점수 차감 (만렙 9레벨 = −13.5점)
  Shell.RIG_UPKEEP = 0.06;  // 레벨당 유지율 — 만렙 54%. 도네 수입에 비례하므로 절대값 튜닝 불요

  Shell.rigLv = function (ch, line) { return ((ch.rig || {})[line] || 0); };
  Shell.rigTotal = function (ch) {
    return Shell.RIG_LINES.reduce(function (n, k) { return n + Shell.rigLv(ch, k); }, 0);
  };
  Shell.rigFloor = function (ch) { return Shell.RIG.feed.floor[Shell.rigLv(ch, 'feed')]; };
  Shell.rigGain = function (ch) { return Shell.RIG.stage.mult[Shell.rigLv(ch, 'stage')]; };
  Shell.rigDon = function (ch) {
    var l = Shell.rigLv(ch, 'don');
    return { gap: Shell.RIG.don.gap[l], prob: Shell.RIG.don.prob[l] };
  };

  // 업그레이드 — 순수 함수로 떼어 둔 이유는 shopBuy와 같다. 조용히 틀리면 재화가 증발하거나
  // 무한 강화가 된다. 검증: games/shell/selftest.html
  Shell.rigUp = function (ch, line) {
    if (!Shell.RIG[line]) return 'bad';
    var lv = Shell.rigLv(ch, line);
    if (lv >= 3) return 'max';
    var c = Shell.RIG_COST[lv + 1];
    if ((ch.tier || 0) < c.tier) return 'locked';   // 명성이 장비의 상한을 정한다
    if ((ch.parts || 0) < c.parts) return 'parts';
    if ((ch.coins || 0) < c.coins) return 'poor';
    ch.coins -= c.coins; ch.parts -= c.parts;
    if (!ch.rig) ch.rig = {};
    ch.rig[line] = lv + 1;
    return 'ok';
  };

  // 방송당 유지비 = 직전 3회 평균 도네 수입 × (총레벨 × 6%). 채널 규모를 자동 추종한다.
  // 만렙이어도 54%라 수입을 넘지 않는다 — 강등 나선에 빠지지 않는 이유
  Shell.rigUpkeep = function (ch) {
    var h = ch.donHist || [];
    if (!h.length) return 0;
    var avg = h.reduce(function (a, b) { return a + b; }, 0) / h.length;
    return Math.round(avg * Shell.rigTotal(ch) * Shell.RIG_UPKEEP);
  };

  // 정산 — 유지비를 걷고, 못 걷으면 가장 높은 계열을 한 단계 강등한다 (조용히, 규약 2).
  // 이력은 유지비를 계산한 뒤에 갱신한다 (이번 방송 수입이 이번 청구서에 섞이면 안 된다)
  Shell.rigSettle = function (ch, earned) {
    var due = Shell.rigUpkeep(ch);
    var paid = Math.min(ch.coins || 0, due);
    ch.coins = (ch.coins || 0) - paid;
    var demoted = null;
    if (paid < due) {
      var top = null;
      Shell.RIG_LINES.forEach(function (k) {
        if (Shell.rigLv(ch, k) > 0 && (!top || Shell.rigLv(ch, k) > Shell.rigLv(ch, top))) top = k;
      });
      if (top) { ch.rig[top] -= 1; demoted = top; }
    }
    ch.donHist = [earned].concat(ch.donHist || []).slice(0, 3);
    return { due: due, paid: paid, demoted: demoted };
  };

  // 상점 구매 — 순수 함수로 떼어 둔 이유: 차감·중복·잔액 검사가 조용히 틀리면
  // 코인이 증발하거나 무한 구매가 된다. 검증: games/shell/selftest.html
  Shell.shopBuy = function (ch, item) {
    if (!item) return 'bad';
    if (ch.gear[item.id]) return 'owned';
    if ((item.minTier || 0) > (ch.tier || 0)) return 'locked'; // 등급 한정 (파트너 계약 ③)
    if (ch.coins < item.price) return 'poor';
    ch.coins -= item.price;
    ch.gear[item.id] = true;
    return 'ok';
  };

  Shell.CLIP = { THRESH: .5, GAP: 8, KEEP: 4, RAW_MAX: 10 };
  Shell.interestScore = function (burst, seen, surge) {
    var base = (clamp(burst || 1, 1, 4) - 1) / 3;
    var novelty = FRESH_MULT[Math.min(FRESH_MULT.length - 1, seen)];
    return base * novelty * (.55 + .45 * clamp(surge, 0, 1));
  };

  Shell.FRESH_MULT = FRESH_MULT;
  Shell.ARCH = ARCH;               // 채팅 캐스팅·selftest·샌드박스가 읽는다 (읽기 전용)
  Shell.ARCH_START = ARCH_START;
  Shell.SIM = SIM;
  // 샌드박스에서 흥미도 벡터를 슬라이더로 만지면 근접도도 따라 바뀌어야 한다
  Shell.recomputeSim = function () { SIM = computeSim(); Shell.SIM = SIM; };
  // 판정층 상수 — 무대 소유(ADR-004 결정 4). 도구·검사가 읽는다
  Shell.TUNE = {
    T_ECON: T_ECON, BETA: BETA, MIX_INHERIT: MIX_INHERIT,
    SUB_BONUS: SUB_BONUS, SUB_BONUS_CAP: SUB_BONUS_CAP,
    FICKLE_DECAY: FICKLE_DECAY, FICKLE_MAX: FICKLE_MAX, MUT_RATE: MUT_RATE, DIV_BONUS: DIV_BONUS,
  };
  global.Shell = Shell;
})(window);
