#!/usr/bin/env node
// 전 화면 훑기 (sweep)
//
// 페르소나 검사는 '사람이 하려는 일'을 따라가고, 이 도구는 그 반대다.
// 링크를 타고 닿을 수 있는 화면을 빠짐없이 열어, 한 화면에서 확인할 수 있는 것을
// 기계가 볼 수 있는 형태로 전부 잰다. 사람 눈으로 훑다 보니
//   "이 화면은 봤나?" 를 매번 헷갈렸고, 실제로 회원가입·운영자 화면처럼
//   한 번도 안 열어 본 곳이 남아 있었다. 그래서 목록을 기계가 만들게 했다.
//
//   node scripts/sweep.js            # 전부 (비로그인·여성·남성·업소·운영자)
//   node scripts/sweep.js 320        # 좁은 화면 폭으로
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3388;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, 'docs', 'sweep');

const req = require('module').createRequire('/opt/node22/lib/node_modules/playwright/index.js');
const { chromium } = req('playwright-core');
const EXE = '/opt/pw-browsers/chromium';

const WIDTH = Number(process.argv[2]) || 412;
const findings = [];
const add = (where, what, detail) => findings.push({ where, what, detail: detail || '' });

// ---- 서버 -----------------------------------------------------------------
function startServer(dbPath) {
  return spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/board')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('서버가 뜨지 않았어요');
}

// ---- 한 화면에서 재는 것 -------------------------------------------------------
// 전부 '한 화면만 보고도 답이 나오는' 것들이다. 나란히 놓고 봐야 아는 것은
// 여기서 못 잡는다 (그건 사람이 본다 — docs/테스트계획.md 4회차).
async function inspect(pg) {
  return pg.evaluate(() => {
    const out = {};
    const doc = document.documentElement;

    // 1) 가로 스크롤 — 모바일에서 제일 흔하고 제일 티 나는 결함
    out.overflowX = Math.max(0, doc.scrollWidth - doc.clientWidth);
    out.wide = [...document.querySelectorAll('body *')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (getComputedStyle(e).position === 'fixed') return false;
        return r.right > doc.clientWidth + 2 || r.left < -2;
      })
      .filter((e) => !e.closest('[style*="overflow"], .no-scrollbar, .editor-toolbar, .shop-chips, .cat-tabs'))
      .slice(0, 4)
      .map((e) => (e.className || e.tagName).toString().slice(0, 34));

    // 2) 깨진 그림 — 파일이 없거나 이름이 틀린 것
    out.brokenImg = [...document.images]
      .filter((i) => i.complete && i.naturalWidth === 0)
      .map((i) => i.getAttribute('src')).slice(0, 4);

    // 3) 같은 id 가 둘 — 라벨·앵커가 엉뚱한 곳을 가리키게 된다
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    out.dupId = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))].slice(0, 4);

    // 4) 손가락으로 누르기엔 작은 것
    //    글 속에 섞인 글자 링크(작성자 이름, "로그인하고 댓글을…" 의 로그인)는 빼고 본다.
    //    문장 안의 링크는 접근성 기준(WCAG 2.5.8)에서도 크기 예외다 — 넓히면 오히려 문장이 깨진다.
    //    남는 것은 아이콘만 있는 버튼처럼 '누르라고 만든 자리' 뿐이다.
    const INLINE = '.post-title, .tr-title, .log-list, p, .empty, .author-link, .comment-name,'
      + ' .post-meta, .mini-list, .noti-body, .muted';
    out.tiny = [...document.querySelectorAll('a[href],button,[role=button],input[type=submit]')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (e.matches(INLINE) || e.closest(INLINE)) return false;
        // 기준은 24px — 접근성 기준(WCAG 2.5.8 AA)이 요구하는 최소 크기다.
        // 44px 는 권장(AAA)이라, 그걸 기준으로 잡으면 이 화면처럼 촘촘한 모바일 UI 에서는
        // 멀쩡한 버튼까지 다 걸려서 정작 진짜가 묻힌다.
        return r.height < 24 || r.width < 24;
      })
      .slice(0, 4)
      .map((e) => ((e.textContent || '').replace(/\s+/g, ' ').trim() || e.className || e.tagName).slice(0, 24));

    // 5) 칸 밖으로 넘쳐 잘린 글자 (말줄임 처리도 없이)
    out.clippedText = [...document.querySelectorAll('h1,h2,h3,button,.btn,label,td,th,.badge,.chip')]
      .filter((e) => {
        // 화면에 안 그리고 읽어 주기만 하는 글(.sr-only)은 폭이 1px 이라 늘 '잘림'으로 잡힌다
        if (e.classList.contains('sr-only') || e.closest('.sr-only')) return false;
        if (e.scrollWidth <= e.clientWidth + 1) return false;
        const st = getComputedStyle(e);
        return st.textOverflow !== 'ellipsis' && st.overflowX !== 'auto' && st.overflowX !== 'scroll';
      })
      .slice(0, 4)
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26));

    // 6) 입력칸 안내문이 칸보다 길어 잘리는 것 (댓글창에서 실제로 겪었다)
    out.cutPlaceholder = [...document.querySelectorAll('input[placeholder],textarea[placeholder]')]
      .filter((i) => {
        const r = i.getBoundingClientRect();
        if (r.width === 0) return false;
        const cv = document.createElement('canvas').getContext('2d');
        const st = getComputedStyle(i);
        cv.font = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
        const pad = parseFloat(st.paddingLeft) + parseFloat(st.paddingRight);
        return cv.measureText(i.placeholder).width > r.width - pad - 2;
      })
      .slice(0, 3)
      .map((i) => i.placeholder.slice(0, 34));

    // 7) 짧은 글자가 세로로 쌓인 버튼 ('등록' 이 '등/록' 으로 접힌 것)
    //    글자는 다 있고 칸도 안 넘쳐서 다른 검사에는 안 걸린다.
    //    높이로 재면 '높이를 고정한 버튼'까지 걸리므로, 글자가 실제로 몇 줄에 그려졌는지 센다.
    out.stacked = [...document.querySelectorAll('button, .btn, a.btn')]
      .filter((e) => {
        if (e.children.length) return false;                  // 그림·뱃지가 든 칸은 원래 여러 줄이다
        const t = (e.textContent || '').replace(/\s+/g, '').trim();
        if (!t || t.length > 6) return false;                 // 원래 긴 글은 접히는 게 맞다
        if (!e.getBoundingClientRect().height) return false;
        const range = document.createRange();
        range.selectNodeContents(e);
        return range.getClientRects().length > 1;             // 두 줄 이상으로 그려졌다
      })
      .slice(0, 3)
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16));

    // 8) 링크·버튼에 이름이 없는 것 (읽어 줄 말이 없다)
    out.nameless = [...document.querySelectorAll('a[href],button')]
      .filter((e) => e.offsetParent !== null
        && !(e.textContent || '').trim()
        && !e.getAttribute('aria-label') && !e.getAttribute('title'))
      .slice(0, 3)
      .map((e) => (e.className || e.tagName).toString().slice(0, 30));

    // 9) '따로 떼어 놓은 칸' 인데 눈에 보이는 경계가 없는 것
    //    베스트댓글은 복사본을 위에 하나 더 그리지 않고 원래 자리에서 옮겨 온다.
    //    그래서 테두리가 없으면 "얘는 왜 순서를 어기고 위에 있지?" 가 설명이 안 된다.
    //    CSS 는 규칙이 다른 규칙에 우선순위로 져도 오류를 내지 않고 조용히 무시된다.
    //    (전에 캐릭터 테두리가 딱 이렇게 통째로 무시된 적이 있다.)
    //    그러니 파일에 그렇게 적혀 있는지가 아니라, 실제로 그려진 값을 잰다.
    const seenEdge = (e) => {
      const s = getComputedStyle(e);
      const sides = ['Top', 'Right', 'Bottom', 'Left'];
      return sides.every((k) => parseFloat(s['border' + k + 'Width']) > 0
        && s['border' + k + 'Style'] !== 'none'
        && s['border' + k + 'Color'] !== s.backgroundColor         // 배경과 같은 색이면 안 보인다
        && !/,\s*0\)$/.test(s['border' + k + 'Color']));           // 투명해도 안 보인다
    };
    out.noEdge = [...document.querySelectorAll('.comment.best')]
      .filter((e) => !seenEdge(e))
      .slice(0, 3)
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20));

    return out;
  });
}

// ---- 훑기 ------------------------------------------------------------------
const SKIP = /^(mailto:|tel:|javascript:|#)/;
async function crawl(ctx, who, seeds) {
  const pg = await ctx.newPage();
  const consoleErrs = [];
  const badReqs = [];
  pg.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 120)); });
  pg.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/notifications/stream')) {
      badReqs.push(`${r.status()} ${r.url().replace(BASE, '')}`);
    }
  });

  const seen = new Set();
  const queue = [...seeds];
  const visited = [];

  while (queue.length && visited.length < 60) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);

    let res;
    try { res = await pg.goto(BASE + url, { waitUntil: 'load', timeout: 15000 }); }
    catch (e) { add(`${who} ${url}`, '화면이 열리지 않는다', e.message.split('\n')[0]); continue; }

    const status = res ? res.status() : 0;
    if (status >= 400) { add(`${who} ${url}`, `${status} 오류 화면`); continue; }
    visited.push(url);

    // 그림이 다 뜬 뒤에 잰다 (안 그러면 '깨진 그림'이 거짓으로 잡힌다)
    await pg.waitForFunction(() => [...document.images]
      .filter((i) => { const r = i.getBoundingClientRect(); return r.width > 0 && r.top < innerHeight * 1.2; })
      .every((i) => i.complete), null, { timeout: 4000 }).catch(() => {});

    const r = await inspect(pg);
    const w = `${who} ${url}`;
    if (r.overflowX > 2) add(w, '화면이 가로로 넘친다', `${r.overflowX}px · ${r.wide.join(', ')}`);
    if (r.brokenImg.length) add(w, '그림이 깨졌다', r.brokenImg.join(', '));
    if (r.dupId.length) add(w, '같은 id 가 둘 이상 있다', r.dupId.join(', '));
    if (r.tiny.length) add(w, '누르기엔 작은 버튼이 있다', r.tiny.join(', '));
    if (r.clippedText.length) add(w, '글자가 칸 밖으로 잘린다', r.clippedText.join(' / '));
    if (r.cutPlaceholder.length) add(w, '입력칸 안내문이 잘린다', r.cutPlaceholder.join(' / '));
    if (r.stacked.length) add(w, '버튼 글자가 세로로 쌓였다', r.stacked.join(', '));
    if (r.nameless.length) add(w, '이름 없는 링크·버튼이 있다', r.nameless.join(', '));
    if (r.noEdge.length) add(w, '베스트댓글에 테두리가 안 그려졌다', r.noEdge.join(' / '));

    // 같은 사이트 안의 링크만 따라간다
    const links = await pg.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    for (const href of links) {
      if (!href || SKIP.test(href)) continue;
      if (/^https?:/.test(href) && !href.startsWith(BASE)) continue;
      const u = href.startsWith('http') ? href.replace(BASE, '') : href;
      if (!u.startsWith('/')) continue;
      if (u.startsWith('/logout')) continue;          // 훑는 중에 로그아웃되면 곤란하다
      if (!seen.has(u)) queue.push(u);
    }
  }

  if (consoleErrs.length) {
    add(who, '브라우저 콘솔에 오류가 찍힌다', [...new Set(consoleErrs)].slice(0, 3).join(' | '));
  }
  if (badReqs.length) {
    add(who, '가져오지 못한 파일이 있다', [...new Set(badReqs)].slice(0, 4).join(' | '));
  }
  await pg.close();
  return visited;
}

async function login(ctx, username, password) {
  const pg = await ctx.newPage();
  await pg.goto(BASE + '/login');
  await pg.fill('input[name=username]', username);
  await pg.fill('input[name=password]', password);
  await pg.click('form[action^="/login"] button[type=submit]');
  await pg.waitForLoadState('load');
  await pg.close();
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'));
  const srv = startServer(path.join(tmp, 'b.db'));
  await waitUp();
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: EXE });
  const mk = () => browser.newContext({
    viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });

  const SEEDS = ['/board', '/ranking', '/login', '/signup'];
  const IN = ['/board', '/attendance', '/points', '/notifications', '/profile',
    '/profile?tab=avatar', '/profile?tab=attendance', '/board/new', '/ranking'];

  const who = [
    ['비로그인', null, SEEDS],
    ['여성회원', ['mint', 'test1234'], IN],
    ['남성회원', ['nightcat', 'test1234'], IN],
    ['업소회원', ['luno', 'test1234'], IN],
    ['운영자', ['admin', 'admin1234'], [...IN, '/reports', '/admin/members']],
  ];

  console.log(`\n전 화면 훑기 — 가로 ${WIDTH}px\n`);
  let total = 0;
  for (const [name, cred, seeds] of who) {
    const ctx = await mk();
    if (cred) await login(ctx, cred[0], cred[1]);
    const before = findings.length;
    const pages = await crawl(ctx, name, seeds);
    total += pages.length;
    console.log(`▶ ${name} — ${pages.length}개 화면 · 발견 ${findings.length - before}건`);
    await ctx.close();
  }

  await browser.close();
  srv.kill();

  console.log(`\n화면 ${total}개 · 발견 ${findings.length}건`);
  for (const f of findings) console.log(`   ! [${f.where}] ${f.what}${f.detail ? ' — ' + f.detail : ''}`);

  const md = `# 전 화면 훑기 결과\n\n돌린 때: ${new Date().toLocaleString('ko-KR')}\n`
    + `가로 ${WIDTH}px · 화면 ${total}개 · 발견 ${findings.length}건\n\n`
    + (findings.length
      ? findings.map((f) => `- **[${f.where}]** ${f.what}${f.detail ? ` — ${f.detail}` : ''}`).join('\n')
      : '걸린 것 없음.')
    + '\n';
  fs.writeFileSync(path.join(ROOT, 'docs', '전화면훑기.md'), md);
  console.log('→ docs/전화면훑기.md');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
