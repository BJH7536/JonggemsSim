/* LLM 어댑터 — 프록시(proxy/)를 통해 AI 시청자 발화를 실제 LLM으로 생성한다.
 *
 * ⚠ 임시 거처 (chat.js와 동일). engine/ 추출 시 정훈(관객) 소유로 이관된다.
 *
 * 경계가 셋이다 (proxy/README.md 2절):
 *   1. 이 파일은 "생성"만 담당한다. 검증 게이트(슬롯 포함·비반복)는 chat.js에 그대로 있다 —
 *      LLM 발화도 로컬 템플릿과 똑같이 게이트를 통과해야 화면에 나온다.
 *   2. 실패는 전부 조용한 폴백이다. 타임아웃(1.1초)·429·502·오프라인 — 어느 경우든
 *      로컬 템플릿이 대신 말한다. 시청자는 차이를 "말의 다양성"으로만 느낀다.
 *   3. 예산: 방송당 최대 40회, 동시 2회. 대형 이벤트(버스트 무게 2 이상)의 flavor 줄만
 *      LLM을 쓴다 — 사실 슬롯 줄은 정확성이 생명이라 항상 로컬 템플릿이다.
 */
(function (global) {
  'use strict';

  var CFG = global.JONGGEMS_CONFIG || {};

  var JongLLM = {
    url: String(CFG.PROXY_URL || '').replace(/\/+$/, ''),
    live: false,
    calls: 0, inflight: 0,
    MAX_CALLS: 40,     // 방송당 상한 — 비용은 예측 가능해야 한다
    MAX_INFLIGHT: 2,   // 동시 상한 — 버스트가 커도 프록시를 두들기지 않는다
    TIMEOUT: 1100,     // 채팅은 리듬이다. 늦은 발화는 폐기가 맞다

    badge: null,

    init: function (badgeEl) {
      this.badge = badgeEl;
      if (!this.url) return; // 설정 없음 — 오프라인 규칙 기반 모드 (정상)
      var self = this;
      var ctl = new AbortController();
      var t = setTimeout(function () { ctl.abort(); }, 2500);
      fetch(this.url + '/api/chat', { signal: ctl.signal })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.live) {
            self.live = true;
            if (self.badge) {
              self.badge.textContent = 'AI 시청자 — LLM 라이브';
              self.badge.classList.add('llm');
            }
          }
        })
        .catch(function () { /* 프록시 없음 — 조용히 규칙 기반 유지 */ })
        .finally(function () { clearTimeout(t); });
    },

    newShow: function () { this.calls = 0; },

    ready: function () {
      return this.live && this.calls < this.MAX_CALLS && this.inflight < this.MAX_INFLIGHT;
    },

    // 관측 데이터만 보낸다 — 프롬프트는 서버가 소유한다 (키와 마찬가지로 조작 표면을 줄인다)
    compose: function (persona, ev, facts, ctx) {
      var self = this;
      this.calls++; this.inflight++;
      var ctl = new AbortController();
      var t = setTimeout(function () { ctl.abort(); }, this.TIMEOUT);
      return fetch(this.url + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctl.signal,
        body: JSON.stringify({
          persona: { nick: persona.nick, tones: persona.tones },
          ev: ev,
          facts: facts || {},
          game: ctx.game || '',
          viewers: ctx.viewers || 0,
          recent: ctx.recent || [],
        }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function (d) { return String(d.text || '').slice(0, 60); })
        .finally(function () { clearTimeout(t); self.inflight--; });
    },
  };

  global.JongLLM = JongLLM;
})(window);
