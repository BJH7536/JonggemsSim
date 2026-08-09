/* 반응 도감·파장·캐스트 해금 — 시뮬 레이어 v0.2 §5·§8의 최소 실장 (ADR-006). 소유: 무대.
 *
 * 루프: 방송 중 이벤트 → 결정론 판정(trigger/repellent)이 칸을 연다 → 신규 칸 수 = 파장 →
 * 정산에서 구독자 전환에 곱해진다 → 구독자·코인을 소비해 캐스트를 영입한다 → 도감이 넓어진다.
 *
 * 칸 = (개체, 태그) — 2026-08-09 태그 승격 (ADR-006 예고분). 판정은 이벤트를
 * data/events/tagmap.js로 태그로 번역한 뒤 개체의 trigger/repellent와 대조한다 (v0.2 §5.3).
 * 개체 = 발화 캐스트(8종 + 영입분, data/dex.js) + 불멸 관측단 12종 — 관측단은 100종
 * 판정층(viewers.js, 소윤)의 최외곽 개체로, 말하지 않고 도감 칸만 연다 (발화층/판정층 분리).
 *
 * 경계 (ADR-006):
 *   - 판정은 이벤트 관측만 본다. 발화 성공 여부와 무관 (C3b — LLM 산출물의 경제 유입 금지)
 *   - 파장은 메타 통화(구독자)에만 닿는다. 방송 중 시청자 수 무관여
 *   - 해금은 선택지 개방만 — 능력 강화 상품 금지 목록은 data/dex.js 헤더 참조
 */
(function () {
  'use strict';

  var DATA = window.JONG_DEX || { unlocks: [], base_triggers: {} };
  // 사분면 색 — ARCH(공명 판정층)와 같은 시각 언어. Q1 팬덤 핑크 / Q2 분석가 앰버 /
  // Q3 불구경 오렌지 / Q4 뜨내기 블루 (100종 2축이 4원형과 정확히 일치하지는 않지만 근사)
  var QCOLOR = { "Q1": "#ffb0c8", "Q2": "#ffd27a", "Q3": "#ff8d5a", "Q4": "#a8c8f0" };
  // 36태그의 화면 표기 — 태그 아이디(catastrophic_fail)가 그대로 플레이어에게 노출되고
  // 있었다 (사용자 지적). 어휘의 정본은 data/personas/viewer_personas_100_v02.json(소윤)이고
  // 여기는 표기만 가진다 — 없는 태그는 아이디를 그대로 보여준다(조용히 비우지 않는다).
  var TAG_KO = {
    absurd_outcome: '어이없는 결과',   bug_glitch: '버그·글리치',      build_shown: '세팅 공개',
    catastrophic_fail: '대참사',       clean_execution: '깔끔한 처리',  efficient_resource: '효율 운영',
    explanation_absent: '설명 없는 플레이', greed_punished: '욕심의 대가', idle: '늘어지는 순간',
    improbable_survival: '기적의 생존', longplan_paid: '장기 계획 결실', menu_long: '메뉴만 오래',
    meta_choice: '선택의 갈림길',      misclick: '손 미끄러짐',        no_hit: '무피격',
    no_stakes: '위험 없는 진행',       numbers_revealed: '숫자 공개',   optimal_line: '최적 루트',
    record_pace: '신기록 페이스',      repeat_content: '반복되는 내용', retry_success: '재도전 성공',
    rng_disaster: '운 없는 사고',      rng_jackpot: '운의 대박',        skill_comeback: '실력의 역전',
    state_flip: '판세 뒤집기',         sudden_death: '즉사',            synergy_found: '시너지 발견',
    total_wipe: '전멸',
    streamer_fatigue: '지친 스트리머', streamer_joy: '환호',            streamer_promise: '공약 선언',
    streamer_scream: '비명',           streamer_selfmock: '자조',       streamer_silence: '침묵',
    streamer_story: '잡담·썰',         streamer_tilt: '멘탈 흔들림',
  };
  function tagKo(t) { return TAG_KO[t] || t; }
  var WAVE_RATE = 0.15; // §8.3 구독자 전환 가산 — 미검증 초기값
  var WAVE_CAP = 8;     // 파장 상한. 축당 파라미터 2개 동결 (튜닝 표면 방지 — 주요⑥)
  var KEY = 'jgs-dex-v1';
  // 텐션 (§7) — 시청자 수를 절대 깎지 않는다. 파장 대역폭만 좁힌다 (§7.1).
  // 수치는 전부 v0.2 §7.2의 미검증 초기값 — 표에 있는 값만 쓰고 새 파라미터를 만들지 않는다
  var TEN = { SHOW: 12, SAME: 18, REST: 25, NEWGAME: 8, FATIGUE: 30 };

  var Dex = {
    st: null,
    waveNew: 0, // 이번 방송에서 처음 열린 칸 수 — "미개봉 → 들음" 전이만 센다 (§5.4)

    load: function () {
      if (this.st) return this.st;
      try { this.st = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* file://·시크릿 */ }
      if (!this.st || typeof this.st !== 'object' || !this.st.cells) this.st = { hired: [], cells: {} };
      // 텐션 필드 — 구 저장분 이월 (스키마 마이그레이션)
      if (typeof this.st.tension !== 'number') this.st.tension = 100;
      if (!this.st.played) this.st.played = {};
      return this.st;
    },
    save: function () { try { localStorage.setItem(KEY, JSON.stringify(this.st)); } catch (e) {} },

    // 활성 로스터 — 기본 캐스트 8종 + 영입분 + 불멸 관측단 12종.
    // [{ p: 페르소나, evs: 반응 태그 목록, obs: 판정층 전용 여부 }]
    roster: function () {
      var st = this.load(), out = [];
      (window.JONG_CAST || []).forEach(function (p) {
        // 군중(crowd.js가 합류시킨 100종 발화 개체)은 판정층이 아니다 — 도감 칸을 열지 않는다.
        // 발화층/판정층 분리(§) 유지: 파장이 발화 성공 여부에 물들면 C3b가 깨진다
        if (p.crowd) return;
        out.push({ p: p, evs: DATA.base_triggers[p.nick] || [] });
      });
      DATA.unlocks.forEach(function (u) {
        if (st.hired.indexOf(u.nick) >= 0)
          out.push({ p: u, evs: (u.triggers || []).concat(u.repellents || []) });
      });
      // 불멸 관측단 — 판정층 전용 (발화하지 않는다). 값의 정본은 100종 JSON(소윤) —
      // 여기서는 참조만. repellent 칸도 수집 대상이다 ("싫어하는 걸 보여줘서 반응", §5.1)
      var V = window.JONG_VIEWERS;
      if (V && V.personas) {
        var imm = V.immortal_observers || [];
        V.personas.forEach(function (p) {
          if (imm.indexOf(p.id) < 0) return;
          out.push({ p: { nick: p.name, color: QCOLOR[p.q] || '#8a9bb8' },
                     evs: (p.triggers || []).concat(p.repellents || []), obs: true });
        });
      }
      return out;
    },

    // 부팅 — 영입분을 채팅 캐스트에 합류시킨다 (엔진 배열 제자리 push — 참조 공유)
    init: function () {
      var st = this.load();
      if (!window.Chat) return;
      DATA.unlocks.forEach(function (u) {
        if (st.hired.indexOf(u.nick) < 0) return;
        var dup = Chat.personas.some(function (p) { return p.nick === u.nick; });
        if (!dup) Chat.personas.push({ nick: u.nick, color: u.color, tones: u.tones, arch: u.arch });
      });
    },

    newShow: function (gameId) {
      this.waveNew = 0;
      // §7.2 효과② — 저텐션이면 방송 시작에 streamer_fatigue가 자동 발행된다.
      // 번아웃도 콘텐츠다 (§7.3) — 이 태그를 trigger로 가진 개체(전원 Q1)의 칸이 열린다.
      // 현 로스터에는 보유 개체가 없어 무해하게 0칸 — 100종 영입 확장 시 살아난다
      if (gameId && this.load().tension <= TEN.FATIGUE) this.judge(gameId, 'streamer_fatigue');
    },

    // ---- 텐션 (§7) — 스트리머 컨디션. 파장 대역폭만 좁힌다 (시청자 수 무관여, §7.1) ----
    tension: function () { return this.load().tension; },
    tensionMult: function () { return 0.4 + 0.6 * this.load().tension / 100; }, // §7.2 효과①
    // 정산 훅 — 감쇠는 파장 배율을 읽은 "뒤"에 호출된다 (이번 방송은 방송 전 텐션으로 정산)
    settleShow: function (gameId) {
      var st = this.load();
      var drop = st.lastGame === gameId ? TEN.SAME : TEN.SHOW;
      var recover = st.played[gameId] ? 0 : TEN.NEWGAME; // 안 하던 게임 첫 방송 +8
      st.tension = Math.max(0, Math.min(100, st.tension - drop + recover));
      st.played[gameId] = 1;
      st.lastGame = gameId;
      this.save();
    },
    rest: function () { // 휴방 — 허브에서 하루를 넘긴다. 유일한 능동 회복 수단
      var st = this.load();
      st.tension = Math.min(100, st.tension + TEN.REST);
      this.save();
    },

    // 결정론 판정 — stage.emit 관측 지점에서 호출된다. 반환: 반응한 닉 목록 (연출용).
    // 이벤트 → 태그 번역은 tagmap(초안, §11.2-2), streamer_* 접두는 태그 직접 발행
    // (스트리머 표현 축 §6.4 — 플레이어 입력이므로 C3 위반이 아니다)
    // DIRECT = 셸이 판 상태를 직접 관측해 발행하는 태그 (게임 이벤트가 아니라 번역 불필요).
    // record_pace: 신기록 페이스는 게임이 모르고 셸(채널 기록 소유자)만 안다 — §6.2 ⚠ 처방
    DIRECT: ['record_pace'],
    judge: function (gameId, ev) {
      var tags = ev.lastIndexOf('streamer_', 0) === 0 || this.DIRECT.indexOf(ev) >= 0
        ? [ev]
        : ((window.JONG_TAGMAP || {})[gameId] || {})[ev] || [];
      if (!tags.length) return [];
      var st = this.load(), self = this, hit = [];
      this.roster().forEach(function (r) {
        for (var i = 0; i < tags.length; i++) {
          if (r.evs.indexOf(tags[i]) < 0) continue;
          var key = r.p.nick + '@' + tags[i];
          if (!st.cells[key]) { st.cells[key] = 0; self.waveNew++; }
          st.cells[key]++;
          if (hit.indexOf(r.p.nick) < 0) hit.push(r.p.nick);
        }
      });
      if (hit.length) this.save();
      return hit;
    },

    // 파장 배율 — 텐션이 대역폭을 좁힌다 (×0.4~×1.0, §7.2 효과①). 상한은 텐션 전에 적용
    waveMult: function () { return 1 + WAVE_RATE * Math.min(WAVE_CAP, this.waveNew) * this.tensionMult(); },

    // 개체의 도감 진행 — [열린 칸, 전체 칸]
    progress: function (entry) {
      var st = this.load(), open = 0;
      entry.evs.forEach(function (ev) { if (st.cells[entry.p.nick + '@' + ev]) open++; });
      return [open, entry.evs.length];
    },

    hire: function (nick) {
      var st = this.load(), ch = Shell.ch;
      var u = DATA.unlocks.filter(function (x) { return x.nick === nick; })[0];
      if (!u || st.hired.indexOf(nick) >= 0) return 'owned';
      var cs = (u.cost && u.cost.subs) || 0, cc = (u.cost && u.cost.coins) || 0;
      if (ch.subs < cs || ch.coins < cc) return 'poor';
      ch.subs -= cs; ch.coins -= cc;
      st.hired.push(nick);
      this.save();
      if (window.Chat) {
        var dup = Chat.personas.some(function (p) { return p.nick === u.nick; });
        if (!dup) Chat.personas.push({ nick: u.nick, color: u.color, tones: u.tones, arch: u.arch });
        Chat.sys('— <b style="color:' + u.color + '">' + u.nick + '</b> 님이 채팅에 합류했다 —');
      }
      Shell.saveChannel(); Shell.updateTopbar();
      return 'ok';
    },

    // ---------- UI ----------
    deskIcon: function () {
      var st = this.load();
      return '<button class="dIcon" data-app="cast">' +
        '<span class="dIconArt"><img src="games/shell/img/icon-cast.png" alt=""></span>' +
        '<span class="dIconName">캐스트 영입</span>' +
        '<span class="dIconFresh">' + (8 + st.hired.length) + '명</span>' +
        '</button>';
    },
    openPanel: function () {
      var self = this, st = this.load();
      $('jgsWin').classList.remove('minimized');
      $('appJgs').classList.add('on');
      $('overlay').classList.remove('hidden');
      var active = this.roster().map(function (r) {
        var pr = self.progress(r);
        return '<div class="dexRow"><b style="color:' + r.p.color + '">' + r.p.nick + '</b>' +
          (r.obs ? '<i class="dexObs">관측단</i>' : '') +
          '<span class="dexBar"><i style="width:' + (pr[1] ? Math.round(pr[0] / pr[1] * 100) : 0) + '%"></i></span>' +
          '<span class="dexN">반응 ' + pr[0] + '/' + pr[1] + '칸</span></div>';
      }).join('');
      var cards = DATA.unlocks.map(function (u) {
        if (st.hired.indexOf(u.nick) >= 0) return '';
        var cost = u.cost.coins
          ? u.cost.coins.toLocaleString() + ' 코인'
          : u.cost.subs.toLocaleString() + ' 구독자';
        return '<div class="dexCard"><b style="color:' + u.color + '">' + u.nick + '</b>' +
          '<span class="dexDesc">' + u.desc + '</span>' +
          '<span class="dexTr">반응: ' + (u.triggers || []).map(tagKo).join(' · ') + '</span>' +
          '<button class="siBuy" data-hire="' + u.nick + '">' + cost + '로 영입</button></div>';
      }).join('');
      $('overlay').innerHTML = '<div class="panel dexWin">' +
        '<h2>캐스트 영입 — 반응 도감</h2>' +
        '<p class="fine">시청자(구독자)와 도네(코인)가 캐스트를 데려온다. 새 캐스트는 새 반응 칸이다 — ' +
        '처음 들은 반응(파장)만큼 정산 구독자가 늘어난다. 방송이 세지지는 않는다 (선택지 개방만). ' +
        '관측단은 말이 없는 판정 전용 개체다 — 싫어하는 반응 칸도 수집 대상이다.</p>' +
        '<p class="shopBal">구독자 <b>' + Shell.ch.subs.toLocaleString() + '</b> · 코인 <b>' +
          Shell.ch.coins.toLocaleString() + '</b></p>' +
        '<div class="dexList">' + active + '</div>' +
        (cards ? '<div class="rlab" style="margin-top:12px">영입 대기</div><div class="dexGrid">' + cards + '</div>'
               : '<p class="fine">전원 영입 완료 — 다음 캐스트는 다음 업데이트에서.</p>') +
        '<div class="btnrow"><button class="slab" id="dexClose">데스크탑으로 (Esc)</button></div></div>';
      $('dexClose').onclick = function () { Shell.showHub(); };
      $('overlay').querySelectorAll('[data-hire]').forEach(function (b) {
        b.onclick = function () {
          var r = self.hire(b.getAttribute('data-hire'));
          if (r === 'poor') {
            b.textContent = '재화 부족';
            setTimeout(function () { self.openPanel(); }, 900);
            return;
          }
          if (r === 'ok') {
            Shell.sfx.tone(523, .09, 'triangle', .1); Shell.sfx.tone(784, .14, 'triangle', .1, .09);
            self.openPanel(); // 잔액·로스터 반영해 다시 그린다
          }
        };
      });
    },
  };

  function $(id) { return document.getElementById(id); }

  window.Shell && (Shell.Dex = Dex);
})();
