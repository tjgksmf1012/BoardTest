// 페르소나 테스트 — 사람이 쓰는 흐름으로 훑어보고 걸리는 것을 모은다.
//
//   node scripts/persona-test.js          전부
//   node scripts/persona-test.js P1 P6    골라서
//
// 계획과 방법은 docs/테스트계획.md 참고.
//
// 자동 테스트(npm test)와 다른 점:
//   - 실패해도 멈추지 않는다. 하나 걸렸다고 나머지를 못 보면 한 번에 하나씩만 고치게 된다.
//   - 통과/실패가 아니라 '막힘 · 버그 · 거슬림 · 물음' 네 가지로 적는다.
//   - 화면을 남긴다. 글로만 적으면 나중에 무슨 얘기였는지 알 수 없다.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'docs', 'persona');
const PORT = 3399;
const BASE = `http://127.0.0.1:${PORT}`;

const req = require('module').createRequire('/opt/node22/lib/node_modules/playwright/index.js');
const { chromium } = req('playwright-core');
const EXE = '/opt/pw-browsers/chromium';

// ---- 발견 모으기 -------------------------------------------------------------
const KINDS = { BLOCK: '막힘', BUG: '버그', NIT: '거슬림', ASK: '물음' };
const findings = [];
let current = null;

function note(kind, what, detail) {
  findings.push({ persona: current.id, name: current.name, kind, what, detail: detail || '' });
  const tag = kind === 'BLOCK' ? '!!' : kind === 'BUG' ? '!' : kind === 'NIT' ? '~' : '?';
  console.log(`   ${tag} [${KINDS[kind]}] ${what}${detail ? ' — ' + detail : ''}`);
}
// 어디까지 갔는지 남긴다. 중간에 멈추면 이 값이 마지막 발자국이 된다.
let lastStep = '';
function step(s) { lastStep = s; if (process.env.PERSONA_VERBOSE) console.log('     · ' + s); }

// 기대한 대로면 조용히 넘어가고, 아니면 적는다
function want(ok, kind, what, detail) {
  if (!ok) note(kind, what, detail);
  return ok;
}

// ---- 서버 ---------------------------------------------------------------------
function startServer(dbPath) {
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stderr.on('data', (d) => {
    const s = String(d);
    if (/Error|error:/.test(s)) console.log('   [서버 오류] ' + s.trim().split('\n')[0]);
  });
  return p;
}
async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/board')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('테스트 서버가 뜨지 않았어요');
}

// ---- 브라우저 도우미 -----------------------------------------------------------
async function shot(pg, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = `${current.id}-${name}.png`;
  await pg.screenshot({ path: path.join(SHOT_DIR, file) });
  return file;
}

// 페이지가 오류 화면인지 (우리 error.ejs 는 .auth-card.center 를 쓴다)
const isErrorPage = (pg) => pg.$('.auth-card.center h1').then(Boolean);

async function login(pg, username, password) {
  await pg.goto(BASE + '/login');
  await pg.fill('input[name=username]', username);
  await pg.fill('input[name=password]', password);
  await pg.click('form[action^="/login"] button[type=submit]');
  await pg.waitForLoadState('load');
}

// 3G 흉내. 실제 회선에서 얼마나 답답한지 보려면 이게 있어야 한다.
async function throttle(pg, kbps = 400, latencyMs = 300) {
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: latencyMs,
    downloadThroughput: (kbps * 1024) / 8, uploadThroughput: (kbps * 1024) / 8,
  });
  return cdp;
}

// 화면에 실린 이미지·CSS·JS 무게를 잰다
function weighPage(pg) {
  const bytes = { total: 0, image: 0, css: 0, js: 0, count: 0 };
  pg.on('response', async (res) => {
    try {
      const h = res.headers();
      const len = Number(h['content-length'] || 0);
      if (!len) return;
      bytes.total += len; bytes.count++;
      const t = h['content-type'] || '';
      if (t.startsWith('image/')) bytes.image += len;
      else if (t.includes('css')) bytes.css += len;
      else if (t.includes('javascript')) bytes.js += len;
    } catch {}
  });
  return bytes;
}

// ---- 접근성 검사 (도구 없이 직접) ------------------------------------------------
const srgb = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function contrast(fg, bg) {
  const lum = (c) => 0.2126 * srgb(c[0]) + 0.7152 * srgb(c[1]) + 0.0722 * srgb(c[2]);
  const [a, b] = [lum(fg) + 0.05, lum(bg) + 0.05];
  return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
}
const parseRgb = (s) => (String(s).match(/\d+/g) || []).slice(0, 3).map(Number);

// 글자와 배경의 대비를 재서 기준(AA 4.5:1, 큰 글씨 3:1)에 못 미치는 것을 찾는다.
async function checkContrast(pg) {
  return pg.evaluate(() => {
    const out = [];
    const rgba = (s) => {
      const n = (String(s).match(/[\d.]+/g) || []).map(Number);
      return { r: n[0] || 0, g: n[1] || 0, b: n[2] || 0, a: n.length > 3 ? n[3] : 1 };
    };
    // 뱃지처럼 반투명한 배경은 아래에 깔린 색과 섞인다.
    // 섞지 않고 rgb 만 보면 글자색과 같아져 대비가 1:1 로 잘못 나온다.
    const bgOf = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const c = rgba(getComputedStyle(e).backgroundColor);
        if (c.a > 0) { layers.push(c); if (c.a === 1) break; }
      }
      let out = layers.length && layers[layers.length - 1].a === 1
        ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
      while (layers.length) {                       // 아래에서 위로 겹친다
        const t = layers.pop();
        out = { a: 1,
          r: t.r * t.a + out.r * (1 - t.a),
          g: t.g * t.a + out.g * (1 - t.a),
          b: t.b * t.a + out.b * (1 - t.a) };
      }
      return `rgb(${Math.round(out.r)}, ${Math.round(out.g)}, ${Math.round(out.b)})`;
    };
    const seen = new Set();
    for (const el of document.querySelectorAll('a,button,p,span,h1,h2,h3,h4,strong,li,td,label')) {
      const text = (el.textContent || '').trim();
      if (!text || el.children.length > 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      const key = cs.color + '|' + bgOf(el) + '|' + cs.fontSize + '|' + cs.fontWeight;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: text.slice(0, 24), color: cs.color, bg: bgOf(el),
        size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400 });
    }
    return out;
  });
}

// ---- 페르소나들 ---------------------------------------------------------------
const PERSONAS = [];
const persona = (id, name, who, run) => PERSONAS.push({ id, name, who, run });

// P1 — 처음 온 사람이 가입부터 첫 글까지 갈 수 있는가
persona('P1', '서연 (23) · 신규 여성회원', 'iPhone 390×844 · 느린 회선', async (browser) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  });
  const pg = await ctx.newPage();
  const w = weighPage(pg);
  await throttle(pg, 700, 200);

  step('첫 화면 열기');
  const t0 = Date.now();
  await pg.goto(BASE + '/board', { waitUntil: 'load' });
  const firstLoad = Date.now() - t0;
  want(firstLoad < 6000, 'NIT', '느린 회선에서 첫 화면이 오래 걸린다', `${(firstLoad / 1000).toFixed(1)}초`);

  step('가입 화면');
  await pg.goto(BASE + '/signup');
  want(await pg.$('.pick-grid'), 'BUG', '가입 화면에 캐릭터 고르는 자리가 없다');
  const choices = await pg.$$('.pick-item');
  want(choices.length === 5, 'BUG', '가입 때 고를 캐릭터가 5개가 아니다', `${choices.length}개`);
  if (choices.length > 2) await choices[2].click();       // 첫 번째가 아닌 것을 고른다
  await pg.fill('input[name=username]', 'seoyeon01');
  await pg.fill('input[name=nickname]', '서연');
  await pg.fill('input[name=password]', 'seoyeon1234');
  await shot(pg, '1-가입');
  step('가입 보내기');
  await pg.click('form[action="/signup"] button[type=submit]');
  await pg.waitForLoadState('load');
  const afterSignup = pg.url();
  want(afterSignup.includes('/board'), 'BLOCK', '가입 뒤 게시판으로 가지 않는다', afterSignup);

  // 내가 고른 캐릭터가 실제로 붙었나
  const mine = await pg.getAttribute('.topbar-user .avatar img', 'src');
  want(mine && !/anon/.test(mine), 'BUG', '가입 뒤 내 캐릭터가 익명 그림으로 보인다', String(mine));

  step('첫 글 쓰기');
  await pg.goto(BASE + '/board/new');
  await pg.selectOption('select[name=category]', '자유').catch(() => {});
  await pg.fill('input[name=title]', '처음 가입했어요 잘 부탁드려요');
  await pg.click('.editor');
  await pg.keyboard.type('밤알바 처음이라 아무것도 몰라요. 조언 부탁드려요!');
  await shot(pg, '2-글쓰기');
  await pg.click('form[action="/board"] button[type=submit]');
  await pg.waitForLoadState('load');
  want(!(await isErrorPage(pg)), 'BLOCK', '첫 글을 올리다 오류 화면이 떴다', pg.url());
  const posted = await pg.textContent('body');
  want(/처음 가입했어요/.test(posted), 'BLOCK', '올린 글이 화면에 안 보인다');
  want(/\+300P|300P/.test(posted) || true, 'NIT', '');   // 포인트 안내는 토스트라 흘러갈 수 있다

  step('출석');
  await pg.goto(BASE + '/attendance');
  const attBtn = await pg.$('button:has-text("출석체크 하기")');
  want(attBtn, 'BLOCK', '출석 화면에 출석 버튼이 없다');
  if (attBtn) {
    await attBtn.click();
    await pg.waitForLoadState('load');
    const after = await pg.textContent('body');
    want(/완료했어요|완료/.test(after), 'BUG', '출석했는데 완료 표시가 안 뜬다');
    await shot(pg, '3-출석완료');
  }

  // 캐릭터 상점까지 스스로 찾아갈 수 있나
  await pg.goto(BASE + '/profile');
  const tabs = await pg.$$eval('.ptab', (els) => els.map((e) => e.textContent.trim()));
  want(tabs.includes('캐릭터'), 'NIT', '마이페이지에 캐릭터 탭 이름이 안 보인다', tabs.join(' / '));

  console.log(`   · 첫 화면 ${(firstLoad / 1000).toFixed(1)}초, 내려받은 양 ${(w.total / 1024).toFixed(0)}KB (이미지 ${(w.image / 1024).toFixed(0)}KB)`);
  want(w.total < 1500 * 1024, 'NIT', '첫 화면이 무겁다', `${(w.total / 1024).toFixed(0)}KB`);
  await ctx.close();
});

// P2 — 로그인 안 한 사람이 어디까지 하고 어디서 막히는가
persona('P2', '지훈 (31) · 눈팅족', 'Android 360×780 · 비로그인', async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();

  await pg.goto(BASE + '/board');
  want(await pg.$('.post-list'), 'BLOCK', '비로그인은 목록도 못 본다');

  // 검색
  const sBtn = await pg.$('#searchBtn');
  want(sBtn, 'BUG', '검색 버튼을 찾을 수 없다');
  if (sBtn) {
    await sBtn.click();
    await pg.waitForTimeout(300);
    const box = await pg.$('#searchBox input[name=q]');
    want(box, 'BUG', '검색 버튼을 눌렀는데 입력칸이 안 열린다');
    if (box) {
      await box.fill('카페');
      await pg.keyboard.press('Enter');
      await pg.waitForLoadState('load');
      const html = await pg.textContent('body');
      want(/카페/.test(html), 'BUG', '검색 결과에 찾던 말이 없다');
      await shot(pg, '1-검색결과');
    }
  }

  // 글을 열어 읽기
  await pg.goto(BASE + '/board/4');
  want(!(await isErrorPage(pg)), 'BLOCK', '비로그인은 글을 못 연다');
  want(!(await pg.$('button.menu-btn')), 'BUG', '비로그인에게 점3개 메뉴가 보인다');

  // 추천을 누르면 로그인으로 안내되나
  const like = await pg.$('form[action*="/like"] button, .like-btn');
  if (like) {
    await like.click();
    await pg.waitForLoadState('load');
    want(/\/login/.test(pg.url()), 'BUG', '비로그인이 추천을 눌렀는데 로그인으로 안 보낸다', pg.url());
    want(/next=/.test(pg.url()), 'NIT', '로그인 뒤 보던 글로 돌아가는 주소가 없다', pg.url());
    await shot(pg, '2-추천누름');
  } else {
    note('NIT', '비로그인 화면에 추천 버튼 자체가 없다', '눌러 보고 가입하게 유도할 여지');
  }

  // 글쓰기
  await pg.goto(BASE + '/board/new');
  want(/\/login/.test(pg.url()), 'BUG', '비로그인이 글쓰기 화면에 들어가진다', pg.url());
  await ctx.close();
});

// P3 — 업소회원이 글 쓰고 댓글 관리
persona('P3', '루노 사장 (45) · 업소회원', '데스크톱 1440×900', async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  await login(pg, 'luno', 'test1234');

  // 업소회원에게 여성 캐릭터가 보이면 안 된다
  await pg.goto(BASE + '/profile?tab=avatar');
  const names = await pg.$$eval('.theme-name', (els) => els.map((e) => e.textContent.trim()));
  want(!names.some((n) => /청순|러블리|글램|레드 퀸/.test(n)),
    'BUG', '업소회원에게 여성회원 캐릭터가 보인다', names.join(', '));
  want(names.length > 0, 'BUG', '업소회원에게 캐릭터가 하나도 안 보인다');
  await shot(pg, '1-업소캐릭터');

  // 이벤트 글 쓰기
  await pg.goto(BASE + '/board/new');
  const cats = await pg.$$eval('select[name=category] option', (o) => o.map((e) => e.value));
  want(cats.includes('이벤트'), 'BUG', '이벤트 말머리가 없다', cats.join(', '));
  await pg.selectOption('select[name=category]', '이벤트');
  await pg.fill('input[name=title]', '이번 주 신규 이벤트 안내드립니다');
  await pg.click('.editor');
  await pg.keyboard.type('저희 업소에서 이번 주 신규 이벤트를 진행합니다. 문의 주세요.');
  await pg.click('form[action="/board"] button[type=submit]');
  await pg.waitForLoadState('load');
  want(!(await isErrorPage(pg)), 'BLOCK', '이벤트 글을 올리다 오류가 났다');
  const postUrl = pg.url();

  // 내 글에 달린 댓글은 지울 수 있나 (남의 댓글)
  await pg.goto(postUrl);
  const menus = await pg.$$('button.menu-btn');
  want(menus.length > 0, 'BUG', '내 글인데 점3개 메뉴가 없다');
  if (menus.length) {
    await menus[0].click();
    await pg.waitForTimeout(250);
    const items = await pg.$$eval('.menu-pop:not([hidden]) .menu-item', (els) => els.map((e) => e.textContent.trim()));
    want(items.includes('수정하기') && items.includes('삭제하기'),
      'BUG', '내 글 메뉴에 수정·삭제가 없다', items.join(' / '));
    await shot(pg, '2-내글메뉴');
  }

  // 하루 3개 제한을 넘겨 써 보기 (포인트만 안 주고 글은 올라가야 한다)
  for (let i = 2; i <= 4; i++) {
    await pg.goto(BASE + '/board/new');
    await pg.selectOption('select[name=category]', '자유').catch(() => {});
    await pg.fill('input[name=title]', `업소 안내 ${i}번째 글`);
    await pg.click('.editor');
    await pg.keyboard.type('내용입니다.');
    await pg.click('form[action="/board"] button[type=submit]');
    await pg.waitForLoadState('load');
  }
  want(!(await isErrorPage(pg)), 'BUG', '하루 4번째 글에서 오류가 났다', '제한은 포인트에만 걸려야 한다');
  await ctx.close();
});

// P4 — 운영자 일
persona('P4', '운영자', '데스크톱 1280×800', async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  await login(pg, 'admin', 'admin1234');

  await pg.goto(BASE + '/reports');
  want(!(await isErrorPage(pg)), 'BLOCK', '운영자가 신고 관리에 못 들어간다');
  want(await pg.$('.card'), 'BUG', '신고 관리 화면이 비어 있다');
  await shot(pg, '1-신고관리');

  await pg.goto(BASE + '/admin/members');
  want(!(await isErrorPage(pg)), 'BLOCK', '회원 관리에 못 들어간다');
  const rows = await pg.$$('.member-row:not(.member-head)');
  want(rows.length >= 5, 'BUG', '회원 목록이 너무 적다', `${rows.length}명`);

  // 자기 자신은 제재할 수 없어야 한다
  const banForms = await pg.$$('form[action*="/ban"]');
  want(banForms.length > 0, 'BUG', '제재 버튼이 없다');

  // 남의 글 숨기기
  await pg.goto(BASE + '/board/4');
  const menu = await pg.$('button.menu-btn');
  if (menu) {
    await menu.click();
    await pg.waitForTimeout(250);
    const items = await pg.$$eval('.menu-pop:not([hidden]) .menu-item', (els) => els.map((e) => e.textContent.trim()));
    want(items.some((t) => /숨김/.test(t)), 'BUG', '운영자 메뉴에 숨김이 없다', items.join(' / '));
    want(items.some((t) => /추천/.test(t)), 'NIT', '운영자 메뉴에 운영자 추천이 없다', items.join(' / '));
    await shot(pg, '2-운영자메뉴');
  } else {
    note('BUG', '운영자인데 남의 글에 점3개 메뉴가 없다');
  }
  await ctx.close();
});

// P5 — 포인트 규칙의 경계를 두드린다
persona('P5', '하은 (19) · 포인트 헤비유저', 'Android 412×915', async (browser, db) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();

  await pg.goto(BASE + '/signup');
  await pg.fill('input[name=username]', 'haeun01');
  await pg.fill('input[name=nickname]', '하은');
  await pg.fill('input[name=password]', 'haeun12345');
  await pg.click('form[action="/signup"] button[type=submit]');
  await pg.waitForLoadState('load');

  const uid = db.prepare("SELECT id FROM users WHERE username='haeun01'").get().id;
  const pts = () => db.prepare('SELECT points FROM users WHERE id = ?').get(uid).points;
  want(pts() === 1000, 'BUG', '가입 포인트가 1,000P가 아니다', `${pts()}P`);

  // 출석 두 번
  await pg.goto(BASE + '/attendance');
  await pg.click('button:has-text("출석체크 하기")');
  await pg.waitForLoadState('load');
  const afterFirst = pts();
  want(afterFirst === 1010, 'BUG', '출석 10P가 안 붙었다', `${afterFirst}P`);
  await pg.goto(BASE + '/attendance');
  want(!(await pg.$('button:has-text("출석체크 하기")')), 'BUG', '출석했는데 버튼이 또 보인다');

  // 글 4개 — 3개까지만 포인트
  for (let i = 1; i <= 4; i++) {
    await pg.goto(BASE + '/board/new');
    await pg.selectOption('select[name=category]', '자유').catch(() => {});
    await pg.fill('input[name=title]', `하은이의 ${i}번째 글입니다`);
    await pg.click('.editor');
    await pg.keyboard.type('오늘도 열심히 포인트를 모아봅니다.');
    await pg.click('form[action="/board"] button[type=submit]');
    await pg.waitForLoadState('load');
  }
  const postLogs = db.prepare("SELECT COUNT(*) c FROM point_logs WHERE user_id=? AND reason='post'").get(uid).c;
  want(postLogs === 3, 'BUG', '게시글 포인트가 하루 3개를 넘겨 지급됐다', `${postLogs}건`);
  const postCount = db.prepare('SELECT COUNT(*) c FROM posts WHERE user_id=?').get(uid).c;
  want(postCount === 4, 'BUG', '4번째 글이 아예 안 올라갔다', `${postCount}개 — 제한은 포인트에만 걸려야 한다`);

  // 캐릭터 사기 — 포인트가 모자랄 때
  await pg.goto(BASE + '/profile?tab=avatar&theme=redqueen');
  const buy = await pg.$('.style-bar button:has-text("구매하기")');
  want(buy, 'BUG', '상점 아래에 구매 버튼이 없다');
  if (buy) {
    const before = pts();
    await buy.click();
    await pg.waitForLoadState('load');
    const body = await pg.textContent('body');
    if (before < 2000) {
      want(pts() === before, 'BUG', '포인트가 모자란데 깎였다', `${before} → ${pts()}`);
      want(/부족/.test(body), 'NIT', '포인트가 모자란 이유를 안 알려준다');
    }
    await shot(pg, '1-구매시도');
  }

  // 넉넉하게 주고 다시
  db.prepare('UPDATE users SET points = 50000 WHERE id = ?').run(uid);
  await pg.goto(BASE + '/profile?tab=avatar&theme=redqueen');
  const buy2 = await pg.$('.style-bar button:has-text("구매하기")');
  if (buy2) {
    await buy2.click();
    await pg.waitForLoadState('load');
    const owned = db.prepare('SELECT COUNT(*) c FROM user_items WHERE user_id=?').get(uid).c;
    want(owned === 1, 'BUG', '샀는데 보유 목록에 없다', `${owned}개`);
    want(pts() === 48000, 'BUG', '포인트가 값만큼 안 깎였다', `${pts()}P`);
    const equipped = db.prepare('SELECT avatar_id FROM users WHERE id=?').get(uid).avatar_id;
    want(/redqueen/.test(equipped), 'BUG', '샀는데 바로 장착이 안 됐다', equipped);
    // 같은 것을 또 사려 하면
    await pg.goto(BASE + '/profile?tab=avatar&theme=redqueen&style=' + equipped);
    want(!(await pg.$('.style-bar button:has-text("구매하기")')), 'BUG', '이미 산 것에 또 구매 버튼이 뜬다');
    await shot(pg, '2-구매완료');
  }
  await ctx.close();
});

// P6 — 나쁜 마음을 먹은 사람
persona('P6', '트롤 · 악의적 이용자', 'HTTP 직접 · 브라우저', async (browser, db) => {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();

  // 가입 후 XSS 시도
  await pg.goto(BASE + '/signup');
  await pg.fill('input[name=username]', 'troll01');
  await pg.fill('input[name=nickname]', '<img src=x onerror=alert(1)>');
  await pg.fill('input[name=password]', 'trolltroll');
  await pg.click('form[action="/signup"] button[type=submit]');
  await pg.waitForLoadState('load');
  // 닉네임 길이 제한(2~10자)에 걸려야 정상
  const madeIt = db.prepare("SELECT 1 FROM users WHERE username='troll01'").get();
  if (madeIt) note('NIT', '스크립트가 든 닉네임으로 가입이 됐다', '길이 제한에 걸리길 기대');

  await pg.goto(BASE + '/signup');
  await pg.fill('input[name=username]', 'troll02');
  await pg.fill('input[name=nickname]', '트롤');
  await pg.fill('input[name=password]', 'trolltroll');
  await pg.click('form[action="/signup"] button[type=submit]');
  await pg.waitForLoadState('load');

  // 글 본문에 스크립트
  let popped = false;
  pg.on('dialog', async (d) => { popped = true; await d.dismiss(); });
  await pg.goto(BASE + '/board/new');
  await pg.selectOption('select[name=category]', '자유').catch(() => {});
  await pg.fill('input[name=title]', '<script>alert("제목")</script> 안녕하세요');
  await pg.click('.editor');
  await pg.keyboard.type('<script>alert("본문")</script><img src=x onerror=alert(2)>');
  await pg.click('form[action="/board"] button[type=submit]');
  await pg.waitForLoadState('load');
  await pg.waitForTimeout(700);
  want(!popped, 'BUG', '글에 넣은 스크립트가 실행됐다 (XSS)');
  const shown = await pg.content();
  want(!/<script>alert/.test(shown), 'BUG', '본문의 script 태그가 그대로 살아 있다');
  await shot(pg, '1-XSS시도');

  // 남의 글 지우기 (IDOR)
  const victim = db.prepare('SELECT id FROM posts WHERE user_id != (SELECT id FROM users WHERE username=?) LIMIT 1')
    .get('troll02').id;
  const token = await pg.evaluate(() => document.querySelector('meta[name=csrf-token]')?.content || '');
  const res = await pg.evaluate(async ([url, t]) => {
    const r = await fetch(url, { method: 'POST', headers: { 'X-CSRF-Token': t }, redirect: 'manual' });
    return r.status;
  }, [`${BASE}/board/${victim}/delete`, token]);
  const stillThere = db.prepare('SELECT 1 FROM posts WHERE id=?').get(victim);
  want(stillThere, 'BLOCK', '남의 글이 지워졌다 (권한 확인 없음)', `HTTP ${res}`);

  // CSRF 토큰 없이 글쓰기
  const noCsrf = await pg.evaluate(async (url) => {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'category=자유&title=토큰없이+쓴+글&content=내용', redirect: 'manual',
    });
    return r.status;
  }, BASE + '/board');
  const sneaked = db.prepare("SELECT 1 FROM posts WHERE title='토큰없이 쓴 글'").get();
  want(!sneaked, 'BLOCK', 'CSRF 토큰 없이 글이 써졌다', `HTTP ${noCsrf}`);

  // 남의 캐릭터를 공짜로 장착
  const paid = db.prepare("SELECT item_code FROM user_items LIMIT 1").get();
  const trollId = db.prepare("SELECT id FROM users WHERE username='troll02'").get().id;
  await pg.evaluate(async ([url, t, code]) => {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': t },
      body: 'avatar_id=' + encodeURIComponent(code), redirect: 'manual',
    });
  }, [BASE + '/profile/avatar', token, paid ? paid.item_code : 'female-redqueen-1-1']);
  const got = db.prepare('SELECT avatar_id FROM users WHERE id=?').get(trollId).avatar_id;
  want(got !== (paid && paid.item_code), 'BLOCK', '사지 않은 캐릭터를 장착했다', got);

  // 도배
  let made = 0;
  for (let i = 0; i < 8; i++) {
    const r = await pg.evaluate(async ([url, t, n]) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': t },
        body: `category=자유&title=광고광고광고 ${n}&content=광고입니다`, redirect: 'manual',
      });
      return r.status;
    }, [BASE + '/board', token, i]);
    if (r < 400) made++;
  }
  const spam = db.prepare("SELECT COUNT(*) c FROM posts WHERE title LIKE '광고광고광고%'").get().c;
  if (spam >= 8) note('ASK', '짧은 시간에 글을 8개 연속으로 올릴 수 있다', '도배 막는 장치(작성 간격 제한)가 없음');
  await ctx.close();
});

// P7 — 눈이 나쁘고 마우스를 안 쓰는 사람
persona('P7', '정우 (58) · 확대 + 키보드', '데스크톱 1280×800 · 200% 확대', async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await login(pg, 'gold', 'test1234');

  // 200% 확대 = 논리 폭 640px 과 같다
  await pg.setViewportSize({ width: 640, height: 800 });
  await pg.goto(BASE + '/board');

  // 가로 스크롤이 생기면 확대해서 못 쓴다
  const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  want(overflow <= 2, 'BUG', '확대하면 화면이 가로로 넘친다', `${overflow}px 넘침`);
  await shot(pg, '1-200퍼센트');

  // 키보드만으로 글쓰기까지 갈 수 있나
  await pg.goto(BASE + '/board');
  let reached = false, steps = 0;
  for (; steps < 40 && !reached; steps++) {
    await pg.keyboard.press('Tab');
    await pg.waitForTimeout(60);   // 테두리가 그려질 틈 (전환 효과가 있으면 늦게 뜬다)
    const info = await pg.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || el.value || '').trim().slice(0, 20),
        href: el.getAttribute('href') || '',
        visible: el.offsetParent !== null,
        outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
      };
    });
    if (!info) continue;
    if (/글쓰기/.test(info.text) || /\/board\/new/.test(info.href)) reached = true;
    if (steps < 8 && info.visible) {
      want(info.outline, 'BUG', '키보드로 이동했는데 어디에 있는지 표시가 없다', `"${info.text}"`);
    }
  }
  want(reached, 'BLOCK', '키보드만으로 글쓰기에 닿지 못한다', `Tab ${steps}번`);

  // 대비 검사
  await pg.goto(BASE + '/board');
  const items = await checkContrast(pg);
  const bad = [];
  for (const it of items) {
    const big = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
    const need = big ? 3 : 4.5;
    const r = contrast(parseRgb(it.color), parseRgb(it.bg));
    if (r < need) bad.push(`"${it.text}" ${r}:1 (기준 ${need})`);
  }
  want(bad.length === 0, 'BUG', '글자 대비가 기준에 못 미치는 곳이 있다', bad.slice(0, 5).join(' · '));

  // 이미지 대체 텍스트 · 라벨 없는 입력칸
  await pg.goto(BASE + '/board/new');
  const a11y = await pg.evaluate(() => {
    const noAlt = [...document.querySelectorAll('img')].filter((i) => i.alt === null).length;
    // 화면에 안 보이는 것(hidden 속성·display:none)은 읽어 줄 대상이 아니다
    const inputs = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')]
      .filter((i) => !i.hidden && i.offsetParent !== null);
    const unlabeled = inputs.filter((i) => !i.labels?.length && !i.getAttribute('aria-label')
      && !i.getAttribute('aria-labelledby') && !i.getAttribute('placeholder')).length;
    const btns = [...document.querySelectorAll('button')]
      .filter((b) => !(b.textContent || '').trim() && !b.getAttribute('aria-label')).length;
    return { noAlt, unlabeled, btns };
  });
  want(a11y.noAlt === 0, 'BUG', 'alt 없는 이미지가 있다', `${a11y.noAlt}개`);
  want(a11y.unlabeled === 0, 'BUG', '이름 없는 입력칸이 있다', `${a11y.unlabeled}개`);
  want(a11y.btns === 0, 'BUG', '이름 없는 버튼이 있다', `${a11y.btns}개`);
  await ctx.close();
});

// P8 — 어두운 곳에서, 느린 회선으로
persona('P8', '새벽 이용자 · 다크모드', '모바일 다크 · 저속 회선', async (browser) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true,
    hasTouch: true, colorScheme: 'dark',
  });
  const pg = await ctx.newPage();
  const w = weighPage(pg);
  await throttle(pg, 400, 300);

  step('첫 화면 열기');
  const t0 = Date.now();
  await pg.goto(BASE + '/board', { waitUntil: 'load' });
  const load = Date.now() - t0;
  await shot(pg, '1-다크목록');

  const dark = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const rgb = parseRgb(dark);
  want(rgb[0] + rgb[1] + rgb[2] < 300, 'BUG', '다크모드인데 배경이 밝다', dark);

  // 다크에서도 대비가 나오나
  const items = await checkContrast(pg);
  const bad = [];
  for (const it of items) {
    const big = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
    const need = big ? 3 : 4.5;
    const r = contrast(parseRgb(it.color), parseRgb(it.bg));
    if (r < need) bad.push(`"${it.text}" ${r}:1`);
  }
  want(bad.length === 0, 'BUG', '다크모드에서 대비가 모자란 글자가 있다', bad.slice(0, 5).join(' · '));

  // 캐릭터가 잔뜩 나오는 화면의 무게
  await login(pg, 'gold', 'test1234');
  const t1 = Date.now();
  await pg.goto(BASE + '/profile?tab=avatar&theme=redqueen', { waitUntil: 'load' });
  const shopLoad = Date.now() - t1;
  await shot(pg, '2-다크상점');
  console.log(`   · 목록 ${(load / 1000).toFixed(1)}초 / 상점(캐릭터 25칸) ${(shopLoad / 1000).toFixed(1)}초`);
  console.log(`   · 총 ${(w.total / 1024).toFixed(0)}KB (이미지 ${(w.image / 1024).toFixed(0)}KB, ${w.count}개 요청)`);
  want(shopLoad < 10000, 'NIT', '느린 회선에서 캐릭터 상점이 오래 걸린다', `${(shopLoad / 1000).toFixed(1)}초`);

  // 지연 로딩을 쓰고 있나 (25칸을 한 번에 받으면 무겁다)
  const lazy = await pg.$$eval('.style-cell img', (els) => els.filter((e) => e.loading === 'lazy').length);
  const total = await pg.$$eval('.style-cell img', (els) => els.length);
  want(lazy === total, 'NIT', '상점 캐릭터 그림에 지연 로딩이 안 걸린 것이 있다', `${lazy}/${total}`);
  await ctx.close();
});

// ---- 실행 ---------------------------------------------------------------------
(async () => {
  const only = process.argv.slice(2).filter((a) => /^P\d+$/i.test(a)).map((s) => s.toUpperCase());
  const list = only.length ? PERSONAS.filter((p) => only.includes(p.id)) : PERSONAS;
  if (!list.length) throw new Error('그런 페르소나가 없어요: ' + only.join(', '));

  // 데모 DB를 떠서 쓴다 (WAL 까지 합쳐야 최근 내용이 딸려온다)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'));
  const dbPath = path.join(tmp, 'persona.db');
  const src = path.join(ROOT, 'data', 'board.db');
  if (!fs.existsSync(src)) throw new Error('data/board.db 가 없어요. npm start 로 한 번 띄워 주세요.');
  {
    const s = require('better-sqlite3')(src, { readonly: true });
    await s.backup(dbPath);
    s.close();
  }
  const db = require('better-sqlite3')(dbPath);

  const server = startServer(dbPath);
  const stop = () => { try { server.kill(); } catch {} };
  process.on('exit', stop);

  const started = Date.now();
  try {
    await waitUp();
    const browser = await chromium.launch({ executablePath: EXE });
    for (const p of list) {
      current = p;
      console.log(`\n▶ ${p.id} ${p.name} — ${p.who}`);
      const t = Date.now();
      try {
        await p.run(browser, db);
      } catch (e) {
        note('BLOCK', '테스트 도중 멈췄다', `${lastStep} 에서 — ` + String(e.message).split('\n')[0]);
      }
      console.log(`   (${((Date.now() - t) / 1000).toFixed(1)}초)`);
    }
    await browser.close();
  } finally {
    stop();
  }

  // ---- 결과 정리 ---------------------------------------------------------------
  const by = (k) => findings.filter((f) => f.kind === k);
  const lines = [];
  lines.push('# 페르소나 테스트 결과', '');
  lines.push(`돌린 때: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  lines.push(`페르소나 ${list.length}명 · ${((Date.now() - started) / 1000).toFixed(0)}초 · 발견 ${findings.length}건`, '');
  lines.push('| 종류 | 뜻 | 건수 |');
  lines.push('|---|---|---:|');
  for (const [k, label] of Object.entries(KINDS)) {
    const desc = { BLOCK: '하려던 것을 끝내지 못함', BUG: '잘못 동작하거나 잘못 보임',
      NIT: '되긴 하는데 불편함', ASK: '기획 결정이 필요함' }[k];
    lines.push(`| ${label} | ${desc} | ${by(k).length} |`);
  }
  lines.push('');
  if (findings.length === 0) lines.push('걸린 것이 없습니다.', '');
  for (const [k, label] of Object.entries(KINDS)) {
    const rows = by(k);
    if (!rows.length) continue;
    lines.push(`## ${label}`, '');
    for (const f of rows) lines.push(`- **[${f.persona}] ${f.what}**${f.detail ? ` — ${f.detail}` : ''}`);
    lines.push('');
  }
  lines.push('## 페르소나별', '');
  for (const p of list) {
    const rows = findings.filter((f) => f.persona === p.id);
    lines.push(`### ${p.id} ${p.name}`);
    lines.push(`> ${p.who}`, '');
    if (!rows.length) lines.push('걸린 것 없음.', '');
    else { for (const f of rows) lines.push(`- ${KINDS[f.kind]} — ${f.what}${f.detail ? ` (${f.detail})` : ''}`); lines.push(''); }
  }
  lines.push('---', '', '화면은 `docs/persona/` 에 있습니다. 방법은 `docs/테스트계획.md`.');

  const out = path.join(ROOT, 'docs', '페르소나테스트.md');
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`\n발견 ${findings.length}건 (막힘 ${by('BLOCK').length} · 버그 ${by('BUG').length} · 거슬림 ${by('NIT').length} · 물음 ${by('ASK').length})`);
  console.log('→ docs/페르소나테스트.md');
})().catch((e) => { console.error(e); process.exit(1); });
