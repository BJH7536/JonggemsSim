#!/usr/bin/env node
/* AetherAI 이미지 생성 — 빌드 타임 전용.
 *
 * 왜 런타임이 아니라 빌드 타임인가:
 *   ① 브라우저에서 부르면 API 키가 배포본에 박힌다. 공개 저장소이므로 즉시 유출이다.
 *   ② 심사자가 링크를 여는 순간 외부 API에 의존하게 된다. AetherAI가 느리거나 죽으면
 *      제출물 ①("링크 클릭만으로 바로 플레이")이 같이 죽는다.
 * 그래서 여기서 한 번 생성해 PNG만 커밋하고, 게임은 로컬 파일만 읽는다.
 *
 * 사용:
 *   AETHER_API_KEY=... node tools/aether-gen.js            # 없는 것만 생성
 *   AETHER_API_KEY=... node tools/aether-gen.js --force    # 전부 다시 생성
 *   node tools/aether-gen.js --list                        # 키 없이 목록만 확인
 *
 * 키는 절대 커밋하지 않는다. 셸 히스토리에 남기기 싫으면 .env.local 에 두고
 * `set -a; . ./.env.local; set +a` 로 불러온 뒤 실행할 것 (.gitignore 처리됨).
 *
 * API: https://api.aetherforgeai.com/  (비동기 잡 — 생성 요청 후 폴링)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.aetherforgeai.com/public/v1';
const MANIFEST = path.join(__dirname, 'aether-assets.json');
const ROOT = path.join(__dirname, '..');

// 문서 권장값: 최초 1초, 이후 2~5초, 최대 1분
const FIRST_DELAY = 1000;
const POLL_DELAY = 3000;
const MAX_WAIT = 90000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function headers(key) {
  return { Authorization: `Bearer ${key}` };
}

/* 본문은 multipart/form-data 다 — JSON이 아니다.
 * 이 API의 생성 엔드포인트들은 file 필드를 받으므로 스칼라 필드도 폼으로 온다.
 * JSON을 보내면 422 {"loc":["body","prompt"],"msg":"Field required","input":null} 가 뜬다.
 * (Getting Started의 cURL 예시는 JSON으로 적혀 있지만 실제와 다르다 — Endpoints 표가 규범.)
 * Content-Type은 직접 넣지 않는다. fetch가 boundary까지 붙여 만들어야 한다.
 *
 * 엔드포인트 2종을 지원한다 (manifest 의 endpoint 필드, 기본 'image'):
 *   image   POST /generate/image     { prompt, ai_model }            → 정지 이미지 1장
 *   effect2 POST /generate/effect/v2 { description, quality, frame } → frame(4|9|16)칸
 *           스프라이트 시트. 스킬 VFX 용 — 프레임 격자는 4→2x2, 9→3x3, 16→4x4 */
async function createJob(key, item) {
  const form = new FormData();
  let path;
  if (item.endpoint === 'effect2') {
    path = 'generate/effect/v2';
    form.append('description', item.prompt);
    form.append('quality', item.quality || 'standard');
    form.append('frame', String(item.frame || 16));
  } else {
    path = 'generate/image';
    form.append('prompt', item.prompt);
    form.append('ai_model', item.ai_model);
  }
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: headers(key),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`생성 요청 실패 ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  if (!body.job_id) throw new Error(`job_id 없음: ${text.slice(0, 200)}`);
  return body.job_id;
}

async function waitJob(key, jobId) {
  await sleep(FIRST_DELAY);
  const deadline = Date.now() + MAX_WAIT;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/job/${jobId}`, { headers: headers(key) });
    const text = await res.text();
    if (!res.ok) throw new Error(`상태 조회 실패 ${res.status}: ${text.slice(0, 200)}`);
    const body = JSON.parse(text);
    if (body.status === 'Succeed') {
      if (!body.image_urls || !body.image_urls.length) throw new Error('Succeed인데 image_urls가 비었다');
      return body.image_urls;
    }
    if (body.status === 'Failed') throw new Error('생성 실패 (status: Failed)');
    await sleep(POLL_DELAY);
  }
  throw new Error(`${MAX_WAIT / 1000}초 안에 끝나지 않았다`);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`다운로드 실패 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const listOnly = args.includes('--list');
  const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  // "_" 만 있는 항목은 구분용 주석이다 — id/out 이 있는 실제 항목만 처리
  let items = manifest.assets.filter((i) => i.id && i.out);
  if (only) items = items.filter((i) => i.id === only);
  if (!items.length) return console.error('대상 없음 — --only 값을 확인할 것');

  // optimize-images.ps1 이 배포용으로 png→jpg 로 바꾸는 항목이 있다.
  // jpg 가 있으면 "이미 생성됨"이다 — 아니면 재실행 때마다 지갑에서 다시 뽑는다.
  const exists = (out) => {
    const p = path.join(ROOT, out);
    return fs.existsSync(p) || fs.existsSync(p.replace(/\.png$/i, '.jpg'));
  };

  if (listOnly) {
    items.forEach((i) => {
      console.log(`${exists(i.out) ? '있음' : '없음'}  ${i.id.padEnd(18)} → ${i.out}`);
    });
    return;
  }

  const key = process.env.AETHER_API_KEY;
  if (!key) {
    console.error('AETHER_API_KEY 환경변수가 없다. 키를 인자로 넘기지 말 것 — 셸 히스토리에 남는다.');
    process.exit(1);
  }

  let made = 0, skipped = 0;
  for (const item of items) {
    const dest = path.join(ROOT, item.out);
    if (!force && exists(item.out)) {
      console.log(`건너뜀  ${item.id}  (이미 있음 — 다시 만들려면 --force)`);
      skipped++;
      continue;
    }
    process.stdout.write(`생성중  ${item.id} … `);
    try {
      const jobId = await createJob(key, item);
      const urls = await waitJob(key, jobId);
      // png를 우선한다 — 문서 예시가 png와 gif를 함께 돌려준다
      const url = urls.find((u) => /\.png($|\?)/i.test(u)) || urls[0];
      const bytes = await download(url, dest);
      console.log(`완료 (${Math.round(bytes / 1024)}KB) → ${item.out}`);
      made++;
    } catch (e) {
      console.log(`실패 — ${e.message}`);
    }
  }
  console.log(`\n생성 ${made}건 · 건너뜀 ${skipped}건`);
  if (made) console.log('배포 용량 가드가 있으므로 games/shell/selftest.html 의 payload 예산을 확인할 것.');
}

main().catch((e) => { console.error(e); process.exit(1); });
