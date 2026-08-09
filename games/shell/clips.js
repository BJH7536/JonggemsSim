/* 클립 보관함 — 방송에서 자동으로 딴 클립 영상을 브라우저에 남겨 다시 본다.
 *
 * 왜 IndexedDB인가: 채널 세이브가 쓰는 localStorage는 오리진당 ~5MB에 문자열만 담긴다.
 * 영상을 넣으려면 base64(+33%)로 부풀려야 해서 클립 두세 개면 세이브까지 같이 터진다.
 * IndexedDB는 Blob을 그대로 담고 용량이 디스크 몫이라 여기만 가능하다.
 * 채널 저장과 완전히 분리 — 클립이 몇 개 쌓이든 세이브는 안 무거워진다.
 *
 * C3: 보관은 관측·기록일 뿐 수치에 관여하지 않는다 (클립은 코인도 시청자도 만들지 않는다).
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var DB = 'jgs-clips', STORE = 'clips', VER = 1;

  Shell.Clips = {
    MAX: 24,          // 클립 1개 ≈ 0.7~2.3MB → 24개 ≈ 35MB 상한. 넘치면 오래된 것부터 버린다
    _n: 0, _bytes: 0, // 데스크탑 아이콘이 동기로 읽는 캐시 (실값은 refresh가 채운다)
    _urls: [],

    open: function () {
      if (this._db) return Promise.resolve(this._db);
      var self = this;
      return new Promise(function (ok, no) {
        if (!window.indexedDB) return no(new Error('no-idb'));
        var rq = indexedDB.open(DB, VER);
        rq.onupgradeneeded = function () {
          if (!rq.result.objectStoreNames.contains(STORE))
            rq.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        };
        rq.onsuccess = function () { self._db = rq.result; ok(rq.result); };
        rq.onerror = function () { no(rq.error); };
      });
    },
    _tx: function (mode, fn) {
      return this.open().then(function (db) {
        return new Promise(function (ok, no) {
          var tx = db.transaction(STORE, mode), out = fn(tx.objectStore(STORE));
          tx.oncomplete = function () { ok(out && out.result !== undefined ? out.result : out); };
          tx.onerror = function () { no(tx.error); };
        });
      });
    },

    init: function () { this.refresh(); },
    // 개수·용량 캐시 갱신 — 허브에 아이콘이 떠 있으면 그 자리에서 숫자만 고친다
    refresh: function () {
      var self = this;
      return this.all().then(function (list) {
        self._n = list.length;
        self._bytes = list.reduce(function (a, c) { return a + (c.size || 0); }, 0);
        var lab = document.querySelector('.dIcon[data-app="clips"] .dIconFresh');
        if (lab) lab.textContent = self._n + '개';
        return list;
      }).catch(function () { return []; });
    },
    all: function () {
      return this._tx('readonly', function (st) { return st.getAll(); })
        .then(function (l) { return (l || []).sort(function (a, b) { return b.at - a.at; }); })
        .catch(function () { return []; });
    },

    // 방송 종료 시 호출 — 영상이 붙은 클립만 남긴다 (스틸만 있는 건 리포트에서 이미 보여준다)
    save: function (clips) {
      var self = this;
      var keep = (clips || []).filter(function (c) { return c.blob; });
      if (!keep.length) return Promise.resolve(0);
      return this._tx('readwrite', function (st) {
        keep.forEach(function (c) {
          st.add({ at: Date.now() + Math.round(c.t * 1000), game: c.game, mood: c.mood,
            t: c.t, s: c.s, v: c.v, why: c.why || [], img: c.img,
            blob: c.blob, size: c.blob.size });
        });
      }).then(function () { return self.trim(); })
        .then(function () { return self.refresh(); })
        .then(function () { return keep.length; })
        .catch(function () { return 0; }); // 저장 실패(용량 거절·비공개 모드)가 방송을 막지 않는다
    },
    // 오래된 것부터 버린다 — id는 autoIncrement라 정렬이 곧 입력 순서다
    trim: function () {
      var self = this;
      return this._tx('readonly', function (st) { return st.getAllKeys(); }).then(function (keys) {
        keys = (keys || []).sort(function (a, b) { return a - b; });
        var over = keys.slice(0, Math.max(0, keys.length - self.MAX));
        if (!over.length) return;
        return self._tx('readwrite', function (st) { over.forEach(function (k) { st.delete(k); }); });
      });
    },
    del: function (id) {
      var self = this;
      return this._tx('readwrite', function (st) { st.delete(id); }).then(function () { return self.refresh(); });
    },
    clear: function () {
      var self = this;
      return this._tx('readwrite', function (st) { st.clear(); }).then(function () { return self.refresh(); });
    },

    // ---------- UI ----------
    fmtMB: function (b) {
      return b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
    },
    deskIcon: function () {
      return '<button class="dIcon" data-app="clips">' +
        '<span class="dIconArt"><img src="games/shell/img/icon-clips.png" alt=""></span>' +
        '<span class="dIconName">클립 보관함</span>' +
        '<span class="dIconFresh">' + this._n + '개</span>' +
        '</button>';
    },
    closeUrls: function () {
      this._urls.forEach(function (u) { URL.revokeObjectURL(u); });
      this._urls = [];
    },
    openPanel: function () {
      var self = this;
      $('jgsWin').classList.remove('minimized');
      $('appJgs').classList.add('on');
      $('overlay').classList.remove('hidden');
      $('overlay').innerHTML = '<div class="panel clipWin"><h2>클립 보관함</h2>' +
        '<p class="fine">불러오는 중…</p></div>';
      this.all().then(function (list) { self.render(list); });
    },
    render: function (list) {
      var self = this;
      this.closeUrls();
      this._bytes = list.reduce(function (a, c) { return a + (c.size || 0); }, 0);
      var cards = list.map(function (c) {
        var url = URL.createObjectURL(c.blob);
        self._urls.push(url);
        var when = new Date(c.at);
        var stamp = (when.getMonth() + 1) + '/' + when.getDate() + ' ' +
          ('0' + when.getHours()).slice(-2) + ':' + ('0' + when.getMinutes()).slice(-2);
        return '<figure class="clipSave">' +
          '<video src="' + url + '" controls preload="metadata" playsinline' +
            (c.img ? ' poster="' + c.img + '"' : '') + '></video>' +
          '<figcaption><b>' + (c.game || '') + '</b> · ' + c.mood +
            ' · 흥미도 ' + Math.round((c.s || 0) * 100) + '%' +
            '<span class="csMeta">' + stamp + ' · ' + self.fmtMB(c.size || 0) + '</span>' +
            '<a class="csBtn" href="' + url + '" download="jgs-clip-' + c.id + '.webm">저장</a>' +
            '<button class="csBtn del" data-del="' + c.id + '">삭제</button>' +
          '</figcaption></figure>';
      }).join('');
      $('overlay').innerHTML = '<div class="panel clipWin">' +
        '<h2>클립 보관함</h2>' +
        '<p class="fine">방송 중 흥미도가 튄 순간을 셸이 알아서 딴 영상이다. ' +
        '브라우저(IndexedDB)에 남으니 새로고침해도 살아 있다 — 최근 ' + this.MAX + '개까지 보관하고 오래된 것부터 지워진다. ' +
        '클립은 기록일 뿐 방송 수치에는 관여하지 않는다.</p>' +
        '<p class="shopBal">보관 <b>' + list.length + '</b>개 · <b>' + this.fmtMB(this._bytes) + '</b>' +
          (list.length ? ' <button class="csBtn del" id="clipClear">전체 삭제</button>' : '') + '</p>' +
        (list.length
          ? '<div class="clipSaveGrid">' + cards + '</div>'
          : '<p class="fine">아직 없다. 방송을 켜고 한 방 터뜨리면 여기 쌓인다' +
            (location.protocol === 'file:' ? ' — 지금은 파일로 직접 연 상태라 영상 녹화가 꺼져 있다 (방송-실행.bat 또는 배포 링크로 열 것)' : '') +
            '.</p>') +
        '<div class="btnrow"><button class="slab" id="clipClose">데스크탑으로 (Esc)</button></div></div>';
      $('clipClose').onclick = function () { Shell.showHub(); }; // URL 회수는 showHub이 한다
      var clr = $('clipClear');
      if (clr) clr.onclick = function () {
        if (clr.dataset.sure) { self.clear().then(function () { self.openPanel(); }); return; }
        clr.dataset.sure = '1'; clr.textContent = '정말 지운다 — 한 번 더';
      };
      $('overlay').querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          self.del(+b.getAttribute('data-del')).then(function () { self.openPanel(); });
        };
      });
    },
  };
})();
