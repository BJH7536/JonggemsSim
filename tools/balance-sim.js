/* 밸런스 스윕 — Giving Up On It · 주머니 괴수 (헤드리스, 의존성 0)
 *
 * 왜: 화력쇼만 몬테카를로 4차 검증을 거쳤고 나머지 두 게임은 "데모 조율값"으로 남아 있었다
 * (games/README.md "미검증"). 두 게임이 공통 명제 — **안전한 플레이가 최악의 전략** — 을
 * 실제로 지키는지, 그리고 지배 전략(한 수만 반복하면 이기는 길)이 없는지를 수치로 본다.
 *
 * 실행: node tools/balance-sim.js
 * 소유: 분석 산출물. 게임 상수의 소유는 무대(현재)이고 이 스크립트는 판단 근거만 만든다.
 */
'use strict';

const N = 20000;            // 전략당 시행 수
const rnd = (a, b) => Math.random() * (b - a) + a;
const fmt = (n) => Math.round(n).toLocaleString();
const pct = (n) => (n * 100).toFixed(1) + '%';

// ────────────────────────────────────────────────────────────────────────────
// 주머니 괴수 — 기술 선택 전략
// 상수 출처: games/pocket/game.js (MOVES·CRIT·FRESH·typeMult·연승 배수)
// ────────────────────────────────────────────────────────────────────────────
const MOVES = [
  { n: '안정타', acc: 1.0,  pow: 13, gain: 25 },
  { n: '강타',   acc: 0.8,  pow: 22, gain: 80 },
  { n: '도박수', acc: 0.55, pow: 40, gain: 260 },
  { n: '필살기', acc: 0.38, pow: 68, gain: 700 },
];
const CRIT = 0.12;
const FRESH = [1, .7, .45, .25, .1];

// 한 턴의 기대 유입 — 명중·급소·신선도·상성 배수를 반영한다.
// 안정타/강타(i<2)는 급소가 아니면 FX 없는 소액이고, 도박수 이상은 매번 gain을 준다.
function turnGain(i, freshStep, adv) {
  const mv = MOVES[i], fm = FRESH[freshStep];
  const hit = mv.acc;
  const critPart = CRIT * 2.2, normPart = (1 - CRIT);
  return hit * mv.gain * adv * fm * (normPart + critPart);
}

function pocketStrategy(label, pick) {
  let total = 0;
  for (let run = 0; run < N; run++) {
    const fresh = [0, 0, 0, 0], rec = [0, 0, 0, 0];
    let g = 0;
    for (let turn = 0; turn < 24; turn++) {           // 3분 ≈ 24턴
      const i = pick(turn);
      const adv = [1, 1.5, 0.67][Math.floor(Math.random() * 3)]; // 상성은 대체로 순환
      g += turnGain(i, fresh[i], adv);
      // 신선도 회전 (game.js useFresh와 동일)
      fresh[i] = Math.min(4, fresh[i] + 1); rec[i] = 0;
      for (let k = 0; k < 4; k++) if (k !== i && ++rec[k] >= 2) { rec[k] = 0; fresh[k] = Math.max(0, fresh[k] - 1); }
    }
    total += g;
  }
  return { label, avg: total / N };
}

const pocketRows = [
  pocketStrategy('안정타만',      () => 0),
  pocketStrategy('강타만',        () => 1),
  pocketStrategy('도박수만',      () => 2),
  pocketStrategy('필살기만',      () => 3),
  pocketStrategy('도박수·필살기 교대', (t) => 2 + (t % 2)),
  pocketStrategy('고위험 3종 순환', (t) => 1 + (t % 3)),   // 강타·도박수·필살기
  pocketStrategy('4종 순환',      (t) => t % 4),
  pocketStrategy('무작위',        () => Math.floor(Math.random() * 4)),
];

// ────────────────────────────────────────────────────────────────────────────
// Giving Up On It — 등반 vs 추락 파밍
// 상수 출처: games/giving-up/game.js (payClimb·onFall·FALL_FRESH)
// ────────────────────────────────────────────────────────────────────────────
const FALL_FRESH = [1, .7, .45, .25, .1];
const climbPay = (m) => Math.round(45 * (1 + m / 30));            // m번째 미터
const fallPay = (drop, fm) => Math.round(90 * Math.pow(drop, 1.6) * fm);

// 전략: "높이 H까지 올라갔다가 그대로 떨어지기"를 3분 동안 반복한다.
// 올라가는 데 드는 시간은 높이에 비례한다고 두고(등반 속도 일정), 추락은 즉시로 본다.
function guoiFarm(H, secPerMeter = 2.2, showTime = 180) {
  let t = 0, paidM = 0, fresh = 0, recover = 0, total = 0, cycles = 0;
  while (t < showTime) {
    // 올라가기 — 신기록 구간만 등반 보상이 나온다 (payClimb는 best 갱신분만 지급)
    for (let m = 1; m <= H; m++) {
      if (m > paidM) {
        paidM = m;
        total += climbPay(m);
        if (++recover >= 3 && fresh > 0) { recover = 0; fresh--; }  // 신기록 3m마다 회복
      }
      t += secPerMeter;
      if (t >= showTime) return { H, total, cycles, paidM };
    }
    // 떨어지기
    total += fallPay(H, FALL_FRESH[fresh]);
    fresh = Math.min(FALL_FRESH.length - 1, fresh + 1);
    recover = 0;
    cycles++;
    t += 3; // 추락·복귀 오버헤드
  }
  return { H, total, cycles, paidM };
}

// 전략: 떨어지지 않고 계속 오르기만 한다 (= "안전한 플레이")
function guoiSafe(secPerMeter = 2.6, showTime = 180) {
  let t = 0, total = 0, m = 0;
  while (t < showTime) { m++; total += climbPay(m); t += secPerMeter; }
  return { H: '—', total, cycles: 0, paidM: m };
}

// ────────────────────────────────────────────────────────────────────────────
// 풍선쇼 — "얼마나 익혀서 터뜨릴 것인가" 전략
// 상수 출처: games/balloon/game.js (SPAWN_BASE·RATE·LIFE·PAY_*·BURST_LOSS·콤보)
//
// 모델: 0.05초 스텝으로 180초를 돌린다. 플레이어는 목표 익음도 T를 넘긴 풍선 중 가장
// 익은 것을 누른다. 사람 손이라 초당 CLICK_RATE회가 상한이고, 이 상한 때문에 T가 높을수록
// 처리 대기열이 길어져 만료(자연 파열)가 난다 — 게임이 의도한 "처리량과 단가의 교환"이다.
// ────────────────────────────────────────────────────────────────────────────
const BL = {
  SPAWN_BASE: 0.9, RATE: [1, 1.3, 1.6, 2.0, 2.4, 2.9],
  LIFE: 2.6, PAY_BASE: 30, PAY_SPAN: 3, BURST_LOSS: 140,
  SCORE_BASE: 100, COMBO_STEP: 0.05, COMBO_CAP: 20,
  ROUND_TIME: 30, SHOW: 180, START: 300, CLICK_RATE: 3.2, AIM_SD: 0.07,
};
// 박스-뮬러 — 의존성 0 유지
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function balloonRun(T) {
  const dt = 0.05;
  let viewers = BL.START, score = 0, combo = 0, pops = 0, bursts = 0, ripeSum = 0;
  let alive = [], spawnAcc = 0, clickCd = 0;
  for (let t = 0; t < BL.SHOW; t += dt) {
    const round = Math.min(5, Math.floor(t / BL.ROUND_TIME));
    spawnAcc += BL.SPAWN_BASE * BL.RATE[round] * dt;
    while (spawnAcc >= 1) { spawnAcc -= 1; alive.push(t); }

    // 만료 — 자연 파열. 손실은 채널 규모의 1/4 상한 (초반 즉사 방지분 반영)
    for (let i = alive.length - 1; i >= 0; i--) {
      if (t - alive[i] >= BL.LIFE) {
        viewers = Math.max(0, viewers - Math.min(BL.BURST_LOSS, Math.max(30, viewers * 0.25)));
        bursts++; combo = 0; alive.splice(i, 1);
      }
    }
    // 클릭 — 목표 익음도를 넘긴 것 중 가장 익은 것부터.
    // AIM_SD: 사람 손의 오차. 눈으로 보고 마우스를 옮겨 누르기까지의 편차를 익음도 단위로
    // 환산한 값이다(0.07 ≈ 180ms). 이게 없으면 목표를 0.97로 잡아도 100% 정확히 눌러
    // 파열이 0건이 되고 "무조건 미루면 이긴다"는 지배 전략이 생긴다 — 실측 아닌 모델 결함.
    clickCd -= dt;
    if (clickCd <= 0) {
      let best = -1, bestR = -1;
      for (let i = 0; i < alive.length; i++) {
        const r = (t - alive[i]) / BL.LIFE + gauss() * BL.AIM_SD;
        if (r >= T && r > bestR) { bestR = r; best = i; }
      }
      if (best >= 0) {
        bestR = Math.min(bestR, 1);
        const mul = 1 + BL.PAY_SPAN * bestR;
        viewers += Math.round(BL.PAY_BASE * mul);
        combo++;
        score += Math.round(BL.SCORE_BASE * mul * (1 + BL.COMBO_STEP * Math.min(combo, BL.COMBO_CAP)));
        pops++; ripeSum += bestR;
        alive.splice(best, 1);
        clickCd = 1 / BL.CLICK_RATE;
      }
    }
    if (viewers <= 0) return { dead: true, at: t, viewers: 0, score, pops, bursts, avgRipe: pops ? ripeSum / pops : 0 };
  }
  return { dead: false, viewers, score, pops, bursts, avgRipe: pops ? ripeSum / pops : 0 };
}

function balloonStrategy(label, T, runs = 400) {
  let v = 0, s = 0, b = 0, p = 0, dead = 0, ripe = 0;
  for (let i = 0; i < runs; i++) {
    const r = balloonRun(T);
    v += r.viewers; s += r.score; b += r.bursts; p += r.pops; ripe += r.avgRipe;
    if (r.dead) dead++;
  }
  return { label, T, viewers: v / runs, score: s / runs, bursts: b / runs,
           pops: p / runs, deadRate: dead / runs, avgRipe: ripe / runs };
}

const balloonRows = [
  balloonStrategy('보이는 족족 (0.05)', 0.05),
  balloonStrategy('살짝 익혀 (0.35)', 0.35),
  balloonStrategy('중간 (0.55)', 0.55),
  balloonStrategy('많이 익혀 (0.75)', 0.75),
  balloonStrategy('만개 노림 (0.90)', 0.90),
  balloonStrategy('한계까지 (0.97)', 0.97),
];

// ────────────────────────────────────────────────────────────────────────────
// 출력
// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== 주머니 괴수 — 3분(24턴) 기대 유입 ===');
const pBase = pocketRows[0].avg;
pocketRows
  .slice()
  .sort((a, b) => b.avg - a.avg)
  .forEach((r) => console.log(`  ${r.label.padEnd(20)} ${fmt(r.avg).padStart(9)}   (안정타 대비 ×${(r.avg / pBase).toFixed(2)})`));

console.log('\n=== Giving Up On It — 3분 기대 유입 ===');
const safe = guoiSafe();
console.log(`  ${'추락 없이 등반만'.padEnd(20)} ${fmt(safe.total).padStart(9)}   (${safe.paidM}m 도달)`);
[5, 8, 12, 18, 25, 35, 50].forEach((H) => {
  const r = guoiFarm(H);
  console.log(`  ${('높이 ' + H + 'm 반복 추락').padEnd(20)} ${fmt(r.total).padStart(9)}   (${r.cycles}회, 최고 ${r.paidM}m, 등반만 대비 ×${(r.total / safe.total).toFixed(2)})`);
});

console.log('\n=== 풍선쇼 — 3분 결과 (목표 익음도별, 400회 평균) ===');
console.log(`  ${'전략'.padEnd(20)} ${'최종 시청자'.padStart(11)} ${'전용 점수'.padStart(10)} ${'터뜨림'.padStart(7)} ${'파열'.padStart(6)} ${'전멸률'.padStart(7)}`);
balloonRows.forEach((r) => console.log(
  `  ${r.label.padEnd(20)} ${fmt(r.viewers).padStart(11)} ${fmt(r.score).padStart(10)} ` +
  `${fmt(r.pops).padStart(7)} ${fmt(r.bursts).padStart(6)} ${pct(r.deadRate).padStart(7)}`));

console.log('\n=== 판정 ===');
const bSafe = balloonRows[0];
const bTop = balloonRows.slice().sort((a, b) => b.viewers - a.viewers)[0];
const bTopScore = balloonRows.slice().sort((a, b) => b.score - a.score)[0];
console.log(`  풍선쇼: 시청자 최고 = ${bTop.label} (족족 대비 ×${(bTop.viewers / Math.max(1, bSafe.viewers)).toFixed(2)})`);
console.log(`    → 안전한 플레이(족족)가 최악인가: ${bSafe.viewers === Math.min(...balloonRows.map((r) => r.viewers)) ? '예' : '아니오 ⚠'}`);
console.log(`    → 점수 최고 = ${bTopScore.label} (족족 대비 ×${(bTopScore.score / Math.max(1, bSafe.score)).toFixed(2)})`);
const greedy = balloonRows[balloonRows.length - 1];
console.log(`    → 한계까지 미루는 것이 처벌되는가: ${greedy.viewers < bTop.viewers ? `예 (전멸률 ${pct(greedy.deadRate)})` : '아니오 ⚠ (무조건 미루면 이긴다)'}`);
console.log(`    → 초반 즉사 위험: 족족 전략 전멸률 ${pct(bSafe.deadRate)}`);
const pTop = pocketRows.slice().sort((a, b) => b.avg - a.avg)[0];
const pSafe = pocketRows[0];
console.log(`  주머니 괴수: 최고 전략 = ${pTop.label} (안정타 대비 ×${(pTop.avg / pSafe.avg).toFixed(2)})`);
console.log(`    → 안전한 플레이가 최악인가: ${pTop.label !== '안정타만' && pSafe.avg === Math.min(...pocketRows.map((r) => r.avg)) ? '예' : '아니오 ⚠'}`);
// map(guoiFarm)로 넘기면 인덱스가 secPerMeter로 들어간다 — 화살표로 감싸 인자를 고정
const guoiRows = [5, 8, 12, 18, 25, 35, 50].map((H) => guoiFarm(H));
const gTop = guoiRows.slice().sort((a, b) => b.total - a.total)[0];
console.log(`  GUOI: 최고 전략 = 높이 ${gTop.H}m 반복 (등반만 대비 ×${(gTop.total / safe.total).toFixed(2)})`);
console.log(`    → 안전한 플레이가 최악인가: ${gTop.total > safe.total ? '예' : '아니오 ⚠'}`);
console.log(`    → 낮은 높이 파밍이 지배 전략인가: ${guoiRows[0].total >= gTop.total ? '예 ⚠ (5m 반복이 최고)' : '아니오 (높이 올라가야 큰 낙차가 나온다)'}`);
console.log(`    → 5m 반복은 등반만보다: ${guoiRows[0].total > safe.total ? '이득 ⚠' : '손해 (저위험 파밍이 처벌된다)'}`);
console.log('');
