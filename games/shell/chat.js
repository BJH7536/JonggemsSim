/* AI 시청자 채팅 엔진 — prototypes/05-hwaryeok-show.html의 `Chat`을 게임 비의존으로 일반화.
 *
 * ⚠ 임시 거처. 이 파일은 정훈(관객)의 `engine/` 추출이 착지하면 그쪽으로 이관된다 (ADR-001).
 *   무대가 의존하는 안정 표면은 `Stage.emit(ev, facts)` 하나뿐이므로, 이관 시 셸은
 *   `Chat.load/reset/react/sys`의 호출부만 바꾸면 된다. 페르소나·템플릿은 이관 후
 *   `data/`(소윤)에서 로드된다 — 지금은 게임이 자기 chat-data.js로 들고 있다.
 *
 * C3 원칙: 채팅은 룰 수치(시청자·보상·사고)에 일절 관여하지 않는다 — 관측하고 "말"만 한다.
 * 게이트: 사실 슬롯 포함 검증 / 비반복(직전 3회 유사도 <0.72) / 재실패 시 폐기(어색한 반복보다 침묵).
 */
(function (global) {
  'use strict';

  var rnd = function (a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; };
  // 사실 슬롯 값은 게임 상태에서 오고 발화는 innerHTML로 들어간다. 지금은 전부 내부 상수·숫자라
  // 안전하지만, 로드맵의 "유저 제작 게임"이 착지하면 여기가 곧장 XSS 경계가 된다 — 미리 막는다.
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  // 페르소나 8종 — prototypes/05-hwaryeok-personas.md 시트 기반. 게임과 무관한 공용 캐스트.
  var PERSONAS = [
    { nick: '불멍장인',     color: '#ff8d5a', tones: ['hype', 'mock'] },
    { nick: '안전제일',     color: '#7fd4ff', tones: ['worry', 'question'] },
    { nick: '10년차주방장', color: '#ffd27a', tones: ['info', 'mock'] },
    { nick: '오늘첫방문',   color: '#b8f5c4', tones: ['question', 'cheer'] },
    { nick: 'ㅋㅋ자판기',   color: '#f0a8ff', tones: ['hype', 'mock'] },
    { nick: '냉정한미식가', color: '#c9c4ba', tones: ['mock', 'info'] },
    { nick: '응원봉',       color: '#ffb0c8', tones: ['cheer', 'hype'] },
    { nick: '길가던행인',   color: '#a8c8f0', tones: ['question', 'worry', 'cheer'] },
  ];

  var Chat = {
    T: {}, BURST: {}, personas: PERSONAS,
    // N = 비반복 게이트가 되돌아보는 발화 수. 원본은 3이었으나 게임이 늘면서 이벤트 종류가
    // 적은 게임(Giving Up On It의 idle/stuck 편중)에서 같은 줄이 4줄 만에 돌아왔다. 5로 넓힌다 —
    // C3에 따라 채팅은 룰 수치에 관여하지 않으므로 화력쇼의 승인된 밸런스에는 영향이 없다.
    history: [], N: 5, SIM_MAX: 0.72,
    epoch: 0,     // 방송이 바뀌면 증가 — 예약된 발화를 폐기하는 토큰
    feed: null,
    big: false,   // 대형 방송이면 버스트 +1줄
    // 채팅 열기 0~1 — 셸이 시청자 규모(로그 스케일)로 갱신한다. 클수록 버스트가 두껍고
    // 빨라져 "지금 터졌다"가 스크롤 속도로 체감된다. 연출 전용 — C3(수치 무관여) 유지,
    // 발화는 여전히 전부 아래 게이트(슬롯·비반복)를 통과해야 화면에 나온다.
    heat: 0,

    init: function (feedEl) { this.feed = feedEl; },

    // 게임별 이벤트 어휘 적재. 게임이 바뀔 때마다 호출된다 (소윤 접점: 이 T가 곧 기획 산출물)
    load: function (T, BURST) { this.T = T || {}; this.BURST = BURST || {}; },

    reset: function () {
      if (this.feed) this.feed.innerHTML = '';
      this.history.length = 0;
      this.epoch++;
      this.big = false;
      this.heat = 0;
    },

    sys: function (text) { this.append('<div class="cline csys">' + text + '</div>'); },

    push: function (p, text, cls) {
      this.append('<div class="cline' + (cls ? ' ' + cls : '') + '"><b style="color:' +
        p.color + '">' + p.nick + '</b>' + text + '</div>');
    },

    append: function (html) {
      var f = this.feed; if (!f) return;
      f.insertAdjacentHTML('beforeend', html);
      while (f.children.length > 70) f.firstChild.remove();
      f.scrollTop = f.scrollHeight;
    },

    // [LLM-INTEGRATION-POINT] compose()가 실제 서비스에서는 LLM 호출(페르소나 프로필 + 사실 슬롯
    // + 게임 상황)로 교체된다. 교체해도 아래 verify() 게이트는 바깥에 그대로 남는다.
    compose: function (persona, ev, facts, wantFact) {
      var T = this.T[ev];
      if (!T) return null;
      // 풀 전체를 셔플해 한 번씩 검증한다. 이전의 "무작위 2회 재시도"는 슬롯 조합이 안 맞는
      // 템플릿만 연속으로 뽑히면 사실 줄이 통째로 폐기됐다 (pocket risky_hit 등 — 관객 리뷰 발견).
      var pool;
      if (wantFact) {
        pool = T.facts.slice();
      } else {
        pool = T.flavor.filter(function (f) { return persona.tones.indexOf(f[0]) >= 0; });
        pool = (pool.length ? pool : T.flavor).slice();
      }
      for (var i = pool.length - 1; i > 0; i--) {
        var j = rnd(0, i), tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      for (var k = 0; k < pool.length; k++) {
        var text = wantFact
          ? pool[k].replace(/\{(\w+)\}/g, function (_, key) {
              return String(facts[key] != null ? facts[key] : '');
            })
          : pool[k][1];
        if (this.verify(text, wantFact ? facts : {})) {
          this.history.push(text);
          if (this.history.length > 10) this.history.shift();
          return text;
        }
      }
      return null; // 전 템플릿 검증 실패 — 발화 폐기 (어색한 반복보다 침묵)
    },

    verify: function (text, facts) {
      for (var k in facts) {
        if (Object.prototype.hasOwnProperty.call(facts, k) && text.indexOf(String(facts[k])) < 0) return false;
      }
      var sim = function (a, b) {
        var A = a.split(/\s+/), B = new Set(b.split(/\s+/)), uniqA = new Set(A), i = 0;
        uniqA.forEach(function (w) { if (B.has(w)) i++; });
        return i / Math.max(uniqA.size, B.size);
      };
      return this.history.slice(-this.N).every(function (h) { return sim(text, h) < this.SIM_MAX; }, this);
    },

    react: function (ev, facts, opts) {
      opts = opts || {};
      // 사실 슬롯은 여기서 한 번만 이스케이프한다 — 이후 치환·검증이 전부 같은 문자열을 보므로
      // "슬롯 값이 발화에 그대로 포함되어야 통과"라는 계약(contract.md)이 깨지지 않는다.
      var raw = facts || {}, f2 = {};
      for (var fk in raw) if (Object.prototype.hasOwnProperty.call(raw, fk)) f2[fk] = esc(raw[fk]);
      facts = f2;
      var T = this.T[ev];
      if (!T) return; // 게임이 어휘에 없는 이벤트를 쏘면 조용히 무시 (셸이 죽지 않게)
      var self = this, token = this.epoch;
      var n = this.BURST[ev] || 1;
      if (n > 1 && this.big) n = Math.min(4, n + 1);       // 대형 방송은 채팅도 두껍다
      if (n > 1 && this.heat > .55) n = Math.min(5, n + 1); // 열기 높으면 한 줄 더 (도배감)
      var used = {}, usedCount = 0;
      // 첫 반응은 빠르게 (실시간 게임 — 스펙 기본보다 짧다). 열기가 높을수록 더 빨라진다
      var hasten = 1 - this.heat * .5;
      var delay = (120 + Math.random() * 180) * hasten;
      for (var i = 0; i < n; i++) {
        var p;
        do {
          p = PERSONAS[rnd(0, PERSONAS.length - 1)];
        } while (used[p.nick] && usedCount < PERSONAS.length);
        if (!used[p.nick]) { used[p.nick] = 1; usedCount++; }
        var wantFact = i === 0 && T.facts.length > 0;
        (function (p, wantFact) {
          setTimeout(function () {
            if (self.epoch !== token) return; // 방송이 바뀌었으면 폐기
            var localPush = function () {
              var text = self.compose(p, ev, facts, wantFact);
              if (text) self.push(p, text, ev === 'donation' ? 'cdon' : '');
            };
            // [LLM-INTEGRATION-POINT] LLM 경로 — 대형 이벤트(버스트 무게 ≥2)의 flavor 줄만.
            // 사실 슬롯 줄(wantFact)은 정확성이 생명이라 항상 로컬 템플릿이다.
            // LLM 발화도 아래에서 같은 verify() 게이트를 통과해야 화면에 나온다 —
            // 게이트는 LLM을 갈아끼워도 밖에 유지한다 (CLAUDE.md · proxy/README.md 2절).
            if (!wantFact && (self.BURST[ev] || 1) >= 2 &&
                global.JongLLM && global.JongLLM.ready()) {
              global.JongLLM.compose(p, ev, facts, {
                game: global.Shell && global.Shell.game ? global.Shell.game.title : '',
                viewers: global.Shell ? Math.round(global.Shell.viewers) : 0,
                recent: self.history.slice(-3),
              }).then(function (text) {
                if (self.epoch !== token) return; // 응답이 늦게 왔는데 방송이 바뀐 경우
                if (text && self.verify(text, {})) {
                  self.history.push(text);
                  if (self.history.length > 10) self.history.shift();
                  self.push(p, esc(text), ev === 'donation' ? 'cdon' : '');
                } else {
                  localPush(); // 게이트 탈락 — 로컬 템플릿이 대신 말한다
                }
              }).catch(function () {
                if (self.epoch === token) localPush(); // 타임아웃·오류 — 조용한 폴백
              });
            } else {
              localPush();
            }
          }, delay);
        })(p, wantFact);
        delay += (90 + Math.random() * 220) * hasten;
      }
    },
  };

  global.Chat = Chat;
})(window);
