/* 반응 도감·파장·캐스트 해금 — 시뮬 레이어 v0.2 §5·§8의 최소 실장 (ADR-006). 소유: 무대.
 *
 * 루프: 방송 중 이벤트 → 결정론 판정(trigger/repellent)이 칸을 연다 → 신규 칸 수 = 파장 →
 * 정산에서 구독자 전환에 곱해진다 → 구독자·코인을 소비해 캐스트를 영입한다 → 도감이 넓어진다.
 *
 * 경계 (ADR-006):
 *   - 판정은 이벤트 관측만 본다. 발화 성공 여부와 무관 (C3b — LLM 산출물의 경제 유입 금지)
 *   - 파장은 메타 통화(구독자)에만 닿는다. 방송 중 시청자 수 무관여
 *   - 해금은 선택지 개방만 — 능력 강화 상품 금지 목록은 data/dex.js 헤더 참조
 */
(function () {
  'use strict';

  var DATA = window.JONG_DEX || { unlocks: [], base_triggers: {} };
  var WAVE_RATE = 0.15; // §8.3 구독자 전환 가산 — 미검증 초기값
  var WAVE_CAP = 8;     // 파장 상한. 축당 파라미터 2개 동결 (튜닝 표면 방지 — 주요⑥)
  var KEY = 'jgs-dex-v1';

  var Dex = {
    st: null,
    waveNew: 0, // 이번 방송에서 처음 열린 칸 수 — "미개봉 → 들음" 전이만 센다 (§5.4)

    load: function () {
      if (this.st) return this.st;
      try { this.st = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* file://·시크릿 */ }
      if (!this.st || typeof this.st !== 'object' || !this.st.cells) this.st = { hired: [], cells: {} };
      return this.st;
    },
    save: function () { try { localStorage.setItem(KEY, JSON.stringify(this.st)); } catch (e) {} },

    // 활성 로스터 — 기본 캐스트 8종 + 영입분. [{ p: 페르소나, evs: 반응 이벤트 목록 }]
    roster: function () {
      var st = this.load(), out = [];
      (window.JONG_CAST || []).forEach(function (p) {
        out.push({ p: p, evs: DATA.base_triggers[p.nick] || [] });
      });
      DATA.unlocks.forEach(function (u) {
        if (st.hired.indexOf(u.nick) >= 0)
          out.push({ p: u, evs: (u.triggers || []).concat(u.repellents || []) });
      });
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

    newShow: function () { this.waveNew = 0; },

    // 결정론 판정 — stage.emit 관측 지점에서 호출된다. 반환: 반응한 닉 목록 (연출용)
    judge: function (ev) {
      var st = this.load(), self = this, hit = [];
      this.roster().forEach(function (r) {
        if (r.evs.indexOf(ev) < 0) return;
        var key = r.p.nick + '@' + ev;
        if (!st.cells[key]) { st.cells[key] = 0; self.waveNew++; }
        st.cells[key]++;
        hit.push(r.p.nick);
      });
      if (hit.length) this.save();
      return hit;
    },

    waveMult: function () { return 1 + WAVE_RATE * Math.min(WAVE_CAP, this.waveNew); },

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
          '<span class="dexTr">반응: ' + (u.triggers || []).join(' · ') + '</span>' +
          '<button class="siBuy" data-hire="' + u.nick + '">' + cost + '로 영입</button></div>';
      }).join('');
      $('overlay').innerHTML = '<div class="panel dexWin">' +
        '<h2>캐스트 영입 — 반응 도감</h2>' +
        '<p class="fine">시청자(구독자)와 도네(코인)가 캐스트를 데려온다. 새 캐스트는 새 반응 칸이다 — ' +
        '처음 들은 반응(파장)만큼 정산 구독자가 늘어난다. 방송이 세지지는 않는다 (선택지 개방만).</p>' +
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
