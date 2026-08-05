#!/usr/bin/env node
// 테두리가 캐릭터에 딱 붙는지 — 화면에 그려진 픽셀로 확인
//
//   node scripts/check-ring.js        # 확인만
//   node scripts/check-ring.js --scan # 얼굴 크기를 바꿔가며 딱 맞는 값 찾기
//
// 왜 따로 있냐면:
// test/avatar-ring.test.js 는 테두리 PNG 의 알파값을 재서 계산으로 맞춘다.
// 그런데 고리 안쪽 가장자리는 부드럽게 흐려져서, 알파가 남아 있어도 눈에는 안 보인다.
// 그래서 계산상 딱 맞는 값(FACE 0.70)을 넣었는데 화면에는 흰 띠가 남았고,
// 확대한 사진을 받고서야 알았다. 계산이 아니라 **그려진 것**을 재야 했다.
//
// 재는 방법: 배경을 마젠타로 깔고 얼굴과 고리를 따로 그려 각각 찍은 뒤,
// 가운데에서 바깥으로 훑어 '마젠타에서 얼마나 벗어났는지' 로 경계를 찾는다.
// 고정 문턱값 대신 그 방향 최댓값의 비율을 쓴다 — 실버·핑크처럼 옅은 고리도 잡히게.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3386;
const BASE = `http://127.0.0.1:${PORT}`;
const SIZE = 240;          // 크게 그려야 픽셀로 정확히 잰다
const SCAN = process.argv.includes('--scan');

const req = require('module').createRequire('/opt/node22/lib/node_modules/playwright/index.js');
const { chromium } = req('playwright-core');
const sharp = require(path.join(ROOT, 'node_modules', 'sharp'));
const avatars = require(path.join(ROOT, 'src', 'avatars'));

// 틈이 이보다 크면 흰 띠가 보이고, 이보다 작으면(음수) 고리가 얼굴을 문다
const TOLERANCE = 0.02;

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/board')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('서버가 뜨지 않았어요');
}

// 한 방향으로 훑으며 그 방향 최댓값의 frac 배를 넘는 첫(inner) / 마지막(outer) 지점
async function radius(pg, file, mode, frac) {
  await pg.locator('#probe').screenshot({ path: file });
  const { data, info } = await sharp(file)
    .flatten({ background: '#ff00ff' }).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(cx, cy);
  const dev = (x, y) => {
    const i = ((y | 0) * W + (x | 0)) * C;
    return Math.abs(data[i] - 255) + data[i + 1] + Math.abs(data[i + 2] - 255);
  };
  const out = [];
  for (let k = 0; k < 72; k++) {
    const t = (k * Math.PI) / 36;
    const prof = [];
    for (let r = 1; r < R; r += 0.25) prof.push([r, dev(cx + Math.cos(t) * r, cy + Math.sin(t) * r)]);
    const peak = Math.max(...prof.map((v) => v[1]));
    if (peak < 30) continue;              // 이 방향엔 아무것도 안 그려졌다
    const cut = peak * frac;
    let hit = null;
    if (mode === 'outer') { for (const [r, v] of prof) if (v > cut) hit = r; }
    else { for (const [r, v] of prof) if (v > cut) { hit = r; break; } }
    if (hit) out.push(hit / R);
  }
  if (!out.length) return null;
  out.sort((a, b) => a - b);
  return out[Math.floor(out.length / 2)];
}

async function setup(pg) {
  await pg.goto(BASE + '/board', { waitUntil: 'load' });
  await pg.evaluate((size) => {
    document.body.innerHTML = '';
    document.body.style.background = '#ff00ff';
    const box = document.createElement('span');
    box.id = 'probe';
    box.style.cssText = `position:relative;display:inline-block;width:${size}px;height:${size}px`;
    const face = document.createElement('img');
    face.id = 'f';
    face.style.cssText = 'display:block;border-radius:50%';
    const ring = document.createElement('img');
    ring.id = 'r';
    ring.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)';
    box.append(face, ring);
    document.body.append(box);
  }, SIZE);
}

async function ringInner(pg, tmp, code, RING) {
  await pg.evaluate(({ code, RING }) => {
    document.getElementById('f').style.visibility = 'hidden';
    const r = document.getElementById('r');
    r.style.visibility = 'visible';
    r.style.width = `${RING * 100}%`;
    r.style.height = `${RING * 100}%`;
    r.src = `/avatars/${code}.png`;
  }, { code, RING });
  await pg.waitForFunction(() => document.getElementById('r').complete, null, { timeout: 5000 });
  await pg.waitForTimeout(120);
  return radius(pg, path.join(tmp, 'i.png'), 'inner', 0.45);
}

async function faceOuter(pg, tmp, char, FACE) {
  await pg.evaluate(({ char, FACE }) => {
    document.getElementById('r').style.visibility = 'hidden';
    const f = document.getElementById('f');
    f.style.visibility = 'visible';
    f.src = `/avatars/${char}`;
    f.style.width = `${FACE * 100}%`;
    f.style.height = `${FACE * 100}%`;
    f.style.margin = `${((1 - FACE) / 2) * 100}%`;
  }, { char, FACE });
  await pg.waitForFunction(() => document.getElementById('f').complete, null, { timeout: 5000 });
  await pg.waitForTimeout(120);
  return radius(pg, path.join(tmp, 'f.png'), 'outer', 0.15);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-'));
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, 'b.db'), NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  await waitUp();

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 4 });
  const pg = await ctx.newPage();
  await setup(pg);

  const { RING, FACE } = avatars;
  const codes = avatars.borders().map((b) => b.code);
  const char = (avatars.characters('female')[0] || avatars.characters()[0]).file;

  const inner = {};
  for (const code of codes) inner[code] = await ringInner(pg, tmp, code, RING);
  const vals = Object.values(inner).filter(Boolean);
  const 평균 = vals.reduce((a, b) => a + b, 0) / vals.length;

  console.log(`\n테두리와 캐릭터가 딱 붙는지 (칸 반지름 대비 · 화면에 그려진 픽셀로 잰 값)\n`);
  console.log(`  고리 안쪽  최소 ${Math.min(...vals).toFixed(3)} · 평균 ${평균.toFixed(3)}`
    + ` · 최대 ${Math.max(...vals).toFixed(3)}   (RING ${RING})`);

  if (SCAN) {
    console.log('\n  얼굴 크기별 틈');
    for (const f of [0.68, 0.70, 0.72, 0.74, 0.76]) {
      const r = await faceOuter(pg, tmp, char, f);
      const gap = 평균 - r;
      console.log(`    FACE ${f.toFixed(2)} → 얼굴 ${r.toFixed(3)} · 틈 ${(gap * 100).toFixed(1)}%`
        + (Math.abs(gap) <= TOLERANCE ? '   ← 딱 맞음' : gap < 0 ? '  (고리가 얼굴을 문다)' : '  (흰 띠가 보인다)'));
    }
  }

  const 얼굴 = await faceOuter(pg, tmp, char, FACE);
  const 틈 = 평균 - 얼굴;
  await browser.close();
  srv.kill();

  console.log(`  얼굴 바깥  ${얼굴.toFixed(3)}   (FACE ${FACE})`);
  console.log(`\n  → 틈 ${(틈 * 100).toFixed(1)}%  (기준 ±${TOLERANCE * 100}%)\n`);

  if (Math.abs(틈) > TOLERANCE) {
    console.error(틈 > 0
      ? `✗ 캐릭터와 고리 사이가 벌어져 흰 띠가 보입니다. FACE 를 ${(FACE + 틈).toFixed(2)} 쯤으로 키우세요.`
      : `✗ 고리가 캐릭터를 뭅니다. FACE 를 ${(FACE + 틈).toFixed(2)} 쯤으로 줄이세요.`);
    console.error('  (--scan 을 붙이면 얼굴 크기별로 훑어 봅니다)');
    process.exit(1);
  }
  console.log('✓ 시안처럼 딱 붙습니다.\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
