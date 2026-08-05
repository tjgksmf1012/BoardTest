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

// 가이드에서는 고리가 캐릭터 원의 테두리 **위에** 얹혀 있다.
// 그러니 캐릭터 테두리는 고리 몸통이 걸쳐 있는 구간(안쪽~바깥) 안에 있어야 한다.
//   너무 안쪽 → 캐릭터가 작아지고 사이에 흰 띠가 보인다
//   너무 바깥 → 고리가 캐릭터 뒤로 숨어 테두리가 안 보인다
// 그 구간의 몇 % 지점에 둘지는 취향이라, 넉넉한 범위만 지키고 값은 사람이 고른다.
const 몸통_최소 = 0.25;   // 몸통 구간의 25% 지점보다는 바깥
const 몸통_최대 = 0.90;   // 90% 지점보다는 안쪽

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
  const 안쪽 = vals.reduce((a, b) => a + b, 0) / vals.length;
  // 고리 바깥은 칸에 맞춰 놨으므로 1.00. 캐릭터 테두리는 안쪽~1.00 사이에 있어야 한다.
  const 폭 = 1 - 안쪽;
  const 하한 = 안쪽 + 폭 * 몸통_최소;
  const 상한 = 안쪽 + 폭 * 몸통_최대;
  const 자리 = (r) => (r - 안쪽) / 폭;

  console.log('\n테두리가 캐릭터 테두리에 얹히는지 (칸 반지름 대비 · 화면에 그려진 픽셀)\n');
  console.log(`  고리 몸통  안쪽 ${안쪽.toFixed(3)} ~ 바깥 1.000   (RING ${RING})`);
  console.log(`  캐릭터 테두리가 앉아도 되는 곳 = ${하한.toFixed(3)} ~ ${상한.toFixed(3)}`
    + ` (몸통의 ${몸통_최소 * 100}~${몸통_최대 * 100}% 지점)`);

  if (SCAN) {
    console.log('\n  얼굴 크기별 틈');
    for (const f of [0.76, 0.80, 0.86, 0.92, 0.96, 1.00]) {
      const r = await faceOuter(pg, tmp, char, f);
      const at = 자리(r);
      console.log(`    FACE ${f.toFixed(2)} → 얼굴 ${r.toFixed(3)} · 몸통의 ${(at * 100).toFixed(0)}% 지점`
        + (at < 몸통_최소 ? '  (사이가 벌어져 흰 띠가 보인다)'
          : at > 몸통_최대 ? '  (고리가 캐릭터 뒤로 숨는다)' : '   ← 괜찮음'));
    }
  }

  const 얼굴 = await faceOuter(pg, tmp, char, FACE);
  const at = 자리(얼굴);
  await browser.close();
  srv.kill();

  console.log(`  실제 캐릭터 테두리 ${얼굴.toFixed(3)} — 몸통의 ${(at * 100).toFixed(0)}% 지점   (FACE ${FACE})\n`);

  if (at < 몸통_최소 || at > 몸통_최대) {
    console.error(at < 몸통_최소
      ? '✗ 고리가 캐릭터에서 떨어져 흰 띠가 보입니다. FACE 를 키우세요.'
      : '✗ 캐릭터가 너무 커서 고리가 뒤로 숨습니다. FACE 를 줄이세요.');
    console.error('  (--scan 을 붙이면 얼굴 크기별로 훑어 봅니다)');
    process.exit(1);
  }
  console.log('✓ 가이드처럼 고리가 캐릭터 테두리 위에 얹힙니다.\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
