/* validate — data/·게임 어휘가 contract.md 계약(5절)을 지키는지 검사한다. 의존성 0, Node 18+.
 *
 * 로컬:  node tools/validate.mjs
 * CI:    .github/workflows/validate.yml — PR마다 자동 실행. 통과하면 data/ 변경은
 *        셀프 머지 가능 (CONTRIBUTING 규칙 2).
 *
 * games/shell/selftest.html의 어휘 규약 검사(슬롯 정합·flavor 6개·톤 6종·start/end)를
 * 브라우저 밖으로 옮긴 것 — selftest는 셸·게임 로직 검사로 남고, 데이터 계약은 여기가 진실.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TONES = ['hype', 'worry', 'info', 'mock', 'cheer', 'question'];
const fails = [];
const bad = (file, msg) => fails.push(`${file}: ${msg}`);

// ---- 1. 페르소나 캐스트 — JSON 리터럴 .js 캐리어 (ADR-002) ----
const castByNick = new Map(); // 3절(티키타카)이 참조 무결성 검사에 재사용
{
  const file = 'data/personas/cast.js';
  const src = readFileSync(join(ROOT, file), 'utf8');
  const m = src.match(/window\.JONG_CAST\s*=\s*(\[[\s\S]*\]);/);
  if (!m) bad(file, 'window.JONG_CAST = [...]; 대입문이 없다');
  else {
    let cast = null;
    try { cast = JSON.parse(m[1]); }
    catch (e) { bad(file, `우변이 엄격한 JSON이 아니다 (쌍따옴표·후행 콤마 확인) — ${e.message}`); }
    if (cast) {
      if (!cast.length) bad(file, '캐스트가 비어 있다');
      const seen = new Set();
      cast.forEach((p, i) => {
        const who = p.nick || `#${i}`;
        if (!p.nick || typeof p.nick !== 'string') bad(file, `#${i}: nick이 없다`);
        if (seen.has(p.nick)) bad(file, `${who}: nick 중복`);
        seen.add(p.nick);
        if (!/^#[0-9a-fA-F]{6}$/.test(p.color || '')) bad(file, `${who}: color가 #rrggbb 형식이 아니다`);
        if (!Array.isArray(p.tones) || !p.tones.length) bad(file, `${who}: tones가 비어 있다 — 침묵하는 페르소나`);
        else p.tones.forEach(t => { if (!TONES.includes(t)) bad(file, `${who}: 미공인 톤 '${t}' (contract.md 3절)`); });
        castByNick.set(p.nick, p);
      });
    }
  }
}

// ---- 2. 티키타카·관계 변수 — data/tikitaka.js (contract.md 6절, ADR-003) ----
{
  const file = 'data/tikitaka.js';
  const src = readFileSync(join(ROOT, file), 'utf8');
  const m = src.match(/window\.JONG_TIKITAKA\s*=\s*(\{[\s\S]*\});/);
  let tk = null;
  if (!m) bad(file, 'window.JONG_TIKITAKA = {...}; 대입문이 없다');
  else try { tk = JSON.parse(m[1]); }
  catch (e) { bad(file, `우변이 엄격한 JSON이 아니다 (쌍따옴표·후행 콤마 확인) — ${e.message}`); }
  if (tk) {
    const tonesOf = nick => castByNick.has(nick) ? castByNick.get(nick).tones : null;
    (tk.pairs || []).forEach((r, i) => {
      const tag = `pairs[${i}] ${r.from}→${r.to}`;
      if (!tonesOf(r.from)) bad(file, `${tag}: from이 캐스트에 없다`);
      if (!tonesOf(r.to)) bad(file, `${tag}: to가 캐스트에 없다`);
      if (r.from === r.to) bad(file, `${tag}: 자문자답 (from === to)`);
      if (r.chance != null && !(r.chance > 0 && r.chance <= 1)) bad(file, `${tag}: chance ${r.chance} — (0,1] 밖`);
      if ((r.lines || []).length < 6) bad(file, `${tag}: lines ${(r.lines || []).length}개 — 6개 미만이면 비반복 게이트가 응답을 폐기한다`);
      (r.lines || []).forEach(l => {
        const t = tonesOf(r.to);
        if (t && !t.includes(l[0])) bad(file, `${tag}: 응답 톤 '${l[0]}' — ${r.to}의 톤(${t.join(',')}) 밖 (성격 붕괴)`);
      });
    });
    const seen = new Set();
    (tk.moments || []).forEach((mo, i) => {
      const tag = `moments[${i}] ${mo.nick}`;
      const t = tonesOf(mo.nick);
      if (!t) bad(file, `${tag}: 캐스트에 없다`);
      if (!(mo.trust > 0)) bad(file, `${tag}: trust 임계가 양수가 아니다`);
      if (t && !t.includes((mo.line || [])[0])) bad(file, `${tag}: 발화 톤 '${(mo.line || [])[0]}' — 본인 톤 밖`);
      const key = mo.nick + '@' + mo.trust;
      if (seen.has(key)) bad(file, `${tag}: 같은 임계 중복 (${key})`);
      seen.add(key);
    });
  }
}

// ---- 3. 게임 이벤트 어휘 — data/events/<게임>.js (contract.md 1절) ----
const slotSet = t => [...new Set((t.match(/\{(\w+)\}/g) || []).map(s => s.slice(1, -1)))].sort().join(',');
const allEvents = new Set(); // 4절(도감)의 칸 도달 가능성 검사에 재사용
const eventFiles = readdirSync(join(ROOT, 'data/events')).filter(f => f.endsWith('.js'));
if (!eventFiles.length) bad('data/events', '어휘 파일이 하나도 없다 — 스캔 경로가 틀렸는지 확인');
for (const name of eventFiles) {
  const file = `data/events/${name}`;
  const w = {};
  try { new Function('window', readFileSync(join(ROOT, file), 'utf8'))(w); }
  catch (e) { bad(file, `실행 실패 — ${e.message}`); continue; }
  if (!Object.keys(w).length) { bad(file, '전역을 하나도 만들지 않는다'); continue; }
  // 어휘 파일만 검사한다 — data/events/에는 tagmap.js 같은 다른 종류의 데이터도 산다
  const chatKey = Object.keys(w).filter(k => /_CHAT$/.test(k))[0];
  if (!chatKey) continue;
  const data = w[chatKey];
  if (!data || !data.T) { bad(file, `${chatKey} = { T, BURST } 형태가 아니다`); continue; }
  const T = data.T;
  for (const req of ['start', 'end']) if (!T[req]) bad(file, `필수 이벤트 '${req}'가 없다`);
  for (const [ev, t] of Object.entries(T)) {
    allEvents.add(ev);
    if (!/^[a-z][a-z0-9_]*$/.test(ev)) bad(file, `${ev}: 이벤트 이름이 소문자 스네이크 케이스가 아니다`);
    if ((t.flavor || []).length < 6) bad(file, `${ev}: flavor ${(t.flavor || []).length}개 — 6개 미만이면 비반복 게이트가 발화를 폐기한다`);
    (t.flavor || []).forEach(f => { if (!TONES.includes(f[0])) bad(file, `${ev}: 미공인 톤 '${f[0]}'`); });
    const sets = (t.facts || []).map(slotSet);
    if (sets.length > 1 && sets.some(s => s !== sets[0]))
      bad(file, `${ev}: 사실 템플릿 슬롯 집합 불일치 (${sets.join(' vs ')}) — 사실 줄이 확률적으로 폐기된다`);
  }
  for (const [ev, n] of Object.entries(data.BURST || {})) {
    if (!T[ev]) bad(file, `BURST의 '${ev}'가 T에 없다`);
    if (!(n >= 1 && n <= 4)) bad(file, `${ev}: BURST ${n} — 1..4 범위 밖`);
  }
}

// ---- 3.5 태그 매핑 — data/events/tagmap.js (시뮬 레이어 v0.2 §6.2, 태그 승격의 다리) ----
// 판정층이 도달할 수 있는 태그 우주 = tagmap이 발행하는 태그의 합집합.
// 태그 어휘의 정본은 100종 JSON(소윤) — 매핑이 어휘 밖 태그를 쓰면 오타다.
const reachTags = new Set();
{
  const file = 'data/events/tagmap.js';
  const src = readFileSync(join(ROOT, file), 'utf8');
  const m = src.match(/window\.JONG_TAGMAP\s*=\s*(\{[\s\S]*\});/);
  let map = null;
  if (!m) bad(file, 'window.JONG_TAGMAP = {...}; 대입문이 없다');
  else try { map = JSON.parse(m[1]); }
  catch (e) { bad(file, `우변이 엄격한 JSON이 아니다 — ${e.message}`); }
  const vocab = new Set();
  try {
    const pj = JSON.parse(readFileSync(join(ROOT, 'data/personas/viewer_personas_100_v02.json'), 'utf8'));
    pj.personas.forEach(p => { (p.triggers || []).forEach(t => vocab.add(t)); (p.repellents || []).forEach(t => vocab.add(t)); });
  } catch (e) { bad('data/personas/viewer_personas_100_v02.json', `읽기 실패 — ${e.message}`); }
  if (map) for (const [gid, evs] of Object.entries(map)) {
    for (const [ev, tags] of Object.entries(evs)) {
      if (!allEvents.has(ev)) bad(file, `${gid}.${ev}: 어느 게임 어휘에도 없는 이벤트`);
      tags.forEach(t => {
        if (vocab.size && !vocab.has(t)) bad(file, `${gid}.${ev}: '${t}'는 36태그 어휘에 없다 (오타)`);
        reachTags.add(t);
      });
    }
  }
  // 스트리머 표현축 v1 (§6.4) — 게임이 아니라 셸이 직접 발행하는 태그.
  // 발행부: games/shell/shell.js express(리액션 버튼 4종)·dex.js newShow(저텐션 fatigue)
  ['streamer_scream', 'streamer_joy', 'streamer_selfmock', 'streamer_silence', 'streamer_fatigue']
    .forEach(t => reachTags.add(t));
  // 불멸 관측단(판정층 상시 캐스트, dex 로스터 합류) — 개체당 최소 1개 trigger 도달 가능 (§11.3).
  // 전 태그 도달을 요구하지 않는 이유: 표현축(§6.4) 등 미착지 태그가 원본 데이터에 이미 있다 —
  // "전부 도달 불가 = 영원히 침묵"만이 결함이다.
  try {
    const pj = JSON.parse(readFileSync(join(ROOT, 'data/personas/viewer_personas_100_v02.json'), 'utf8'));
    const byId = new Map(pj.personas.map(p => [p.id, p]));
    (pj.immortal_observers || []).forEach(id => {
      const p = byId.get(id);
      if (!p) return bad('data/personas/viewer_personas_100_v02.json', `불멸 관측자 '${id}'가 personas에 없다`);
      if (!(p.triggers || []).some(t => reachTags.has(t)))
        bad('data/dex.js', `관측단 ${id}(${p.name}): 도달 가능한 trigger가 0개 — 영원히 침묵한다`);
    });
  } catch (e) { /* 위에서 이미 bad 처리 */ }
}

// ---- 4. 반응 도감·캐스트 해금 — data/dex.js (contract.md 7절, ADR-006) ----
{
  const file = 'data/dex.js';
  const src = readFileSync(join(ROOT, file), 'utf8');
  const m = src.match(/window\.JONG_DEX\s*=\s*(\{[\s\S]*\});/);
  let dex = null;
  if (!m) bad(file, 'window.JONG_DEX = {...}; 대입문이 없다');
  else try { dex = JSON.parse(m[1]); }
  catch (e) { bad(file, `우변이 엄격한 JSON이 아니다 (쌍따옴표·후행 콤마 확인) — ${e.message}`); }
  if (dex) {
    const ARCHES = ['thrill', 'fan', 'expert', 'casual'];
    // 칸 도달 가능성 (v0.2 §11.3) — 태그 승격 후 칸 = (개체, 태그). tagmap이 발행하지 않는
    // 태그를 트리거로 쓰면 영원히 침묵하는 칸이다 (스트리머 표현축 태그는 착지 시 합류)
    const reachable = (who, evs) => evs.forEach(ev => {
      if (!reachTags.has(ev)) bad(file, `${who}: '${ev}'는 tagmap이 발행하지 않는 태그 — 도달 불가 칸`);
    });
    for (const [nick, evs] of Object.entries(dex.base_triggers || {})) {
      if (!castByNick.has(nick)) bad(file, `base_triggers '${nick}': 캐스트에 없다`);
      if (!Array.isArray(evs) || !evs.length) bad(file, `base_triggers '${nick}': 칸이 비어 있다`);
      else reachable(`base_triggers ${nick}`, evs);
    }
    castByNick.forEach((_, nick) => {
      if (!(dex.base_triggers || {})[nick]) bad(file, `기본 캐스트 '${nick}'의 도감 칸이 없다 — 도감에서 투명 인간이 된다`);
    });
    const seen = new Set();
    (dex.unlocks || []).forEach((u, i) => {
      const who = `unlocks[${i}] ${u.nick || '?'}`;
      if (!u.nick) bad(file, `${who}: nick이 없다`);
      if (castByNick.has(u.nick)) bad(file, `${who}: 기본 캐스트와 닉 충돌`);
      if (seen.has(u.nick)) bad(file, `${who}: 해금 목록 내 닉 중복`);
      seen.add(u.nick);
      if (!/^#[0-9a-fA-F]{6}$/.test(u.color || '')) bad(file, `${who}: color 형식 오류`);
      if (!Array.isArray(u.tones) || !u.tones.length) bad(file, `${who}: tones가 비어 있다`);
      else u.tones.forEach(t => { if (!TONES.includes(t)) bad(file, `${who}: 미공인 톤 '${t}'`); });
      if (!ARCHES.includes(u.arch)) bad(file, `${who}: arch '${u.arch}' — 공인 원형(${ARCHES.join('/')}) 밖`);
      const cost = u.cost || {};
      if (!((cost.subs || 0) > 0 || (cost.coins || 0) > 0)) bad(file, `${who}: cost가 없다 — 공짜 해금은 해금이 아니다`);
      const evs = (u.triggers || []).concat(u.repellents || []);
      if (!evs.length) bad(file, `${who}: trigger/repellent가 없다 — 영원히 침묵하는 캐스트`);
      else reachable(who, evs);
    });
  }
}

if (fails.length) {
  console.error(`VALIDATE FAIL ${fails.length}건\n` + fails.map(f => '  ' + f).join('\n'));
  process.exit(1);
}
console.log('VALIDATE PASS — 캐스트 + 티키타카 + 게임 어휘 + 반응 도감 전부 계약(contract.md 1·2·3·5·6·7절) 준수');
