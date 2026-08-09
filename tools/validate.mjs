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
      });
    }
  }
}

// ---- 2. 게임 이벤트 어휘 — data/events/<게임>.js (contract.md 1절) ----
const slotSet = t => [...new Set((t.match(/\{(\w+)\}/g) || []).map(s => s.slice(1, -1)))].sort().join(',');
const eventFiles = readdirSync(join(ROOT, 'data/events')).filter(f => f.endsWith('.js'));
if (!eventFiles.length) bad('data/events', '어휘 파일이 하나도 없다 — 스캔 경로가 틀렸는지 확인');
for (const name of eventFiles) {
  const file = `data/events/${name}`;
  const w = {};
  try { new Function('window', readFileSync(join(ROOT, file), 'utf8'))(w); }
  catch (e) { bad(file, `실행 실패 — ${e.message}`); continue; }
  if (!Object.keys(w).length) { bad(file, 'window.*_CHAT 전역을 만들지 않는다'); continue; }
  const data = w[Object.keys(w)[0]];
  if (!data || !data.T) { bad(file, 'window.*_CHAT = { T, BURST } 형태가 아니다'); continue; }
  const T = data.T;
  for (const req of ['start', 'end']) if (!T[req]) bad(file, `필수 이벤트 '${req}'가 없다`);
  for (const [ev, t] of Object.entries(T)) {
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

if (fails.length) {
  console.error(`VALIDATE FAIL ${fails.length}건\n` + fails.map(f => '  ' + f).join('\n'));
  process.exit(1);
}
console.log('VALIDATE PASS — 캐스트 + 게임 어휘 전부 계약(contract.md 1·2·3·5절) 준수');
