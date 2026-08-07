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
function startServer(dbPath, extraEnv = {}, port = PORT) {
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, NODE_ENV: 'test', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stderr.on('data', (d) => {
    const s = String(d);
    if (/Error|error:/.test(s)) console.log('   [서버 오류] ' + s.trim().split('\n')[0]);
  });
  return p;
}
async function waitUp(base = BASE) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(base + '/board')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`테스트 서버가 뜨지 않았어요 (${base})`);
}

// ---- 브라우저 도우미 -----------------------------------------------------------
// 화면에 보이는 그림이 다 뜰 때까지 기다린다.
// 이걸 안 하면 스크린샷에 아바타 자리가 빈 동그라미로 찍힌다 — 증거로 남기는 사진인데
// 정작 봐야 할 것이 안 찍혀 있으면 나중에 아무도 잘못을 알아볼 수 없다.
// (화면 밖의 lazy 이미지는 영영 안 뜨므로 기다리지 않는다)
async function settle(pg, timeout = 3000) {
  await pg.waitForFunction(() => [...document.images]
    .filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 0 && r.top < innerHeight * 1.2 && r.bottom > -innerHeight * 0.2;
    })
    .every((i) => i.complete), null, { timeout }).catch(() => {});
}

async function shot(pg, name) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await settle(pg);
  const file = `${current.id}-${name}.png`;
  await pg.screenshot({ path: path.join(SHOT_DIR, file) });
  await checkClipped(pg, name);
  return file;
}

// 그림이 잘려 나가는 곳 찾기
//
// 테두리(고리) 그림이 아바타보다 커서 바깥쪽이 통째로 잘려 나가고, 안쪽 줄만 얼굴 위에
// 남아 있던 적이 있다. 화면은 오류 없이 잘 그려지고 요소도 제자리에 있어서
// 흐름 검사·대비 검사로는 전혀 걸리지 않았다. 눈으로 봐야만 보이는 결함이었다.
// 그래서 '자르는 상자(overflow:hidden) 밖으로 삐져나간 그림'을 직접 재서 찾는다.
const clipSeen = new Set();
async function checkClipped(pg, where) {
  const cut = await pg.evaluate(() => {
    const out = [];
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      for (let el = img.parentElement; el; el = el.parentElement) {
        const st = getComputedStyle(el);
        // 스크롤로 볼 수 있는 상자는 잘린 게 아니다 — 아예 잘라 버리는 것만 본다
        if (!/^(hidden|clip)$/.test(st.overflowX) && !/^(hidden|clip)$/.test(st.overflowY)) {
          if (st.position === 'fixed') break;
          continue;
        }
        const b = el.getBoundingClientRect();
        const over = Math.max(b.left - r.left, r.right - b.right, b.top - r.top, r.bottom - b.bottom);
        // 반올림 오차 한 픽셀과, 일부러 조금 넘겨 깔끔하게 맞추는 경우는 넘어간다
        if (over > 2 && over / Math.max(r.width, r.height) > 0.06) {
          out.push({
            what: (img.className || img.alt || img.src.split('/').pop()).slice(0, 40),
            box: (el.className || el.tagName).toString().slice(0, 40),
            pct: Math.round((over / Math.max(r.width, r.height)) * 100),
          });
        }
        break; // 가장 가까운 자르는 상자 하나만 본다
      }
    }
    return out;
  }).catch(() => []);

  for (const c of cut) {
    const key = `${c.what}|${c.box}`;
    if (clipSeen.has(key)) continue; // 같은 것을 화면마다 다시 적지 않는다
    clipSeen.add(key);
    note('BUG', '그림이 잘려 나간다', `${where}: "${c.what}" 이(가) "${c.box}" 밖으로 ${c.pct}% 잘림`);
  }
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
persona('P3', '루노 사장 (45) · 업소회원', '데스크톱 1440×900', async (browser, db) => {
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

  // 이벤트 말머리는 운영자만 쓸 수 있다 (선배님 확인 사항).
  // 예전에는 업소회원도 쓸 수 있어서 여기서 이벤트 글을 썼다. 규칙이 바뀌었으니
  // 이제는 '안 보이는지' 와 '몰래 보내도 안 먹히는지' 를 본다.
  await pg.goto(BASE + '/board/new');
  const cats = await pg.$$eval('select[name=category] option', (o) => o.map((e) => e.value));
  want(!cats.includes('이벤트'), 'BUG', '업소회원에게 이벤트 말머리가 보인다', cats.join(', '));

  // 목록에 없다고 못 보내는 게 아니다. 주소로 바로 찔러 본다.
  const tk = await pg.evaluate(() => document.querySelector('meta[name=csrf-token]')?.content || '');
  await pg.evaluate(async ([url, t]) => {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': t },
      body: 'category=' + encodeURIComponent('이벤트')
          + '&title=' + encodeURIComponent('몰래 쓴 이벤트 글')
          + '&content=' + encodeURIComponent('내용입니다'),
      redirect: 'manual',
    });
  }, [BASE + '/board', tk]);
  const sneak = db.prepare("SELECT id, category FROM posts WHERE title='몰래 쓴 이벤트 글'").get();
  // 글 자체가 안 만들어졌으면 '이벤트가 아니다' 는 저절로 참이 된다.
  // 그건 확인한 게 아니라 확인을 못 한 것이므로, 만들어졌는지부터 본다.
  want(sneak, 'BUG', '몰래 보낸 글이 아예 안 만들어져서 말머리를 확인 못 했다');
  want(!sneak || sneak.category !== '이벤트',
    'BLOCK', '운영자가 아닌데 이벤트 글이 올라갔다', sneak && sneak.category);

  // 30초에 한 번 규칙. 방금 썼으니 바로 또 쓰면 막혀야 한다.
  await pg.goto(BASE + '/board/new');
  await pg.selectOption('select[name=category]', '자유');
  await pg.fill('input[name=title]', '연달아 쓰는 글');
  await pg.click('.editor');
  await pg.keyboard.type('내용입니다.');
  await pg.click('form[action="/board"] button[type=submit]');
  await pg.waitForLoadState('load');
  want(/초에 한 번씩/.test(await pg.textContent('body')),
    'BUG', '연달아 써도 안 막힌다 (도배 방지가 안 듣는다)');
  want(!db.prepare("SELECT 1 FROM posts WHERE title='연달아 쓰는 글'").get(),
    'BUG', '막혔다고 해 놓고 글은 올라갔다');

  // 30초를 기다리는 대신, 마지막 글을 뒤로 돌려서 시간이 지난 것처럼 만든다
  const lunoId = db.prepare("SELECT id FROM users WHERE username='luno'").get().id;
  const 시간흘리기 = () => db.prepare(
    `UPDATE posts SET created_at = datetime(created_at, '-5 minutes')
      WHERE user_id = ? ORDER BY id DESC LIMIT 1`).run(lunoId);
  시간흘리기();

  // 내 글 점3개 메뉴 (아까 몰래 보낸 그 글이 루노 글이다)
  const postUrl = `${BASE}/board/${sneak.id}`;
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

  // 하루 3개 제한을 넘겨 써 보기 (포인트만 안 주고 글은 올라가야 한다).
  // 30초 규칙에 걸리면 이 검사가 통째로 헛돌기 때문에 매번 시간을 흘려 준다.
  for (let i = 2; i <= 4; i++) {
    await pg.goto(BASE + '/board/new');
    await pg.selectOption('select[name=category]', '자유').catch(() => {});
    await pg.fill('input[name=title]', `업소 안내 ${i}번째 글`);
    await pg.click('.editor');
    await pg.keyboard.type('내용입니다.');
    await pg.click('form[action="/board"] button[type=submit]');
    await pg.waitForLoadState('load');
    시간흘리기();
  }
  const 쓴글 = db.prepare(
    "SELECT COUNT(*) c FROM posts WHERE user_id = ? AND title LIKE '업소 안내%'").get(lunoId).c;
  want(쓴글 === 3, 'BUG', '하루 한도를 넘겼다고 글이 안 올라갔다',
    `${쓴글}개만 올라감 — 한도는 포인트에만 걸려야 한다`);
  await ctx.close();
});

// P4 — 운영자 일
persona('P4', '운영자', '데스크톱 1280×800', async (browser, db) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  await login(pg, 'admin', 'admin1234');

  // 이벤트 말머리는 운영자만 쓴다 — 막는 쪽만 확인하면 '아무도 못 쓰는' 것도 통과한다.
  // 그래서 쓸 수 있어야 하는 사람 쪽도 같이 본다.
  await pg.goto(BASE + '/board/new');
  const adminCats = await pg.$$eval('select[name=category] option', (o) => o.map((e) => e.value));
  want(adminCats.includes('이벤트'), 'BUG', '운영자인데 이벤트 말머리가 없다', adminCats.join(', '));
  await pg.selectOption('select[name=category]', '이벤트');
  await pg.fill('input[name=title]', '이번 주 이벤트 안내');
  await pg.click('.editor');
  await pg.keyboard.type('운영자가 올리는 이벤트 안내입니다.');
  await pg.click('form[action="/board"] button[type=submit]');
  await pg.waitForLoadState('load');
  const madeEvent = db.prepare("SELECT category FROM posts WHERE title='이번 주 이벤트 안내'").get();
  want(madeEvent && madeEvent.category === '이벤트',
    'BUG', '운영자가 쓴 이벤트 글이 이벤트로 안 들어갔다', madeEvent && madeEvent.category);

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

  // 연달아 올리면 작성 간격에 걸려야 한다 (도배 막기)
  const write = async (title) => {
    await pg.goto(BASE + '/board/new');
    await pg.selectOption('select[name=category]', '자유').catch(() => {});
    await pg.fill('input[name=title]', title);
    await pg.click('.editor');
    await pg.keyboard.type('오늘도 열심히 포인트를 모아봅니다.');
    await pg.click('form[action="/board"] button[type=submit]');
    await pg.waitForLoadState('load');
  };
  await write('하은이의 1번째 글입니다');
  await write('연달아 바로 올려보는 글');
  want(!db.prepare("SELECT 1 FROM posts WHERE title='연달아 바로 올려보는 글'").get(),
    'BUG', '작성 간격 제한이 안 걸린다 (도배 가능)');
  want(/초에 한 번|초 뒤에/.test(await pg.textContent('body')),
    'NIT', '간격에 걸렸는데 언제 다시 되는지 안 알려준다');

  // 하루 상한(포인트 3개까지)은 간격과 다른 규칙이라, 시간을 되돌려 따로 본다
  const backdate = () => db.prepare(
    "UPDATE posts SET created_at = datetime(created_at, '-5 minutes') WHERE user_id = ?").run(uid);
  for (let i = 2; i <= 4; i++) { backdate(); await write(`하은이의 ${i}번째 글입니다`); }
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


// ---- 2회차: 1회차에서 안 밟은 축들 -------------------------------------------
// Interfaces(연동) · Data(경계값) · Time/Operations(동시성·되돌아가기) ·
// 실시간 알림 · Structure(없는 주소)

// P9 — A사이트에 얹혔을 때 (연동 모드)
persona('P9', 'A사이트에서 넘어온 회원', 'AUTH_MODE=host · 서명 토큰', async (browser, db, extra) => {
  const HOST = extra.hostBase;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();

  // 연동 모드에서는 자체 가입·로그인 창구가 닫혀 있어야 한다
  step('자체 가입 막혔나');
  await pg.goto(HOST + '/signup');
  want(!/\/signup/.test(pg.url()), 'BUG', '연동 모드인데 자체 회원가입 화면이 열린다', pg.url());

  // 제대로 서명된 토큰으로 들어오기
  step('서명 토큰으로 입장');
  const token = extra.signToken({ uid: 'A-77001', nick: '에이사이트회원', iat: Math.floor(Date.now() / 1000) });
  await pg.goto(`${HOST}/board?sso=${encodeURIComponent(token)}`);
  const body = await pg.textContent('body');
  want(/에이사이트회원/.test(body), 'BLOCK', 'A사이트 회원번호로 들어왔는데 로그인이 안 된다');
  want(!/sso=/.test(pg.url()), 'BUG', '주소에 토큰이 그대로 남아 있다', pg.url());
  const made = db.prepare("SELECT nickname, member_type FROM users WHERE external_id = 'A-77001'").get();
  want(made, 'BLOCK', 'A사이트 회원이 우리 표에 안 만들어졌다');
  await shot(pg, '1-연동입장');

  // 글도 쓸 수 있어야 한다
  step('연동 회원이 글쓰기');
  await pg.goto(HOST + '/board/new');
  want(!/\/login/.test(pg.url()), 'BLOCK', '연동으로 들어온 회원이 글쓰기에서 튕긴다', pg.url());

  // 서명이 틀린 토큰은 안 통해야 한다
  step('위조 토큰');
  const ctx2 = await browser.newContext();
  const pg2 = await ctx2.newPage();
  const forged = token.slice(0, token.indexOf('.')) + '.' + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  await pg2.goto(`${HOST}/board?sso=${encodeURIComponent(forged)}`);
  want(!/에이사이트회원/.test(await pg2.textContent('body')),
    'BLOCK', '서명이 틀린 토큰으로 남의 계정에 들어가진다');

  // 다른 회원번호를 적어 넣어도, 서명이 없으면 안 통해야 한다
  const rawBody = Buffer.from(JSON.stringify({ uid: 'A-99999', nick: '침입자', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  await pg2.goto(`${HOST}/board?sso=${encodeURIComponent(rawBody + '.x')}`);
  want(!db.prepare("SELECT 1 FROM users WHERE external_id='A-99999'").get(),
    'BLOCK', '서명 없이 아무 회원번호로나 계정이 만들어진다');

  // 오래된 토큰
  step('오래된 토큰');
  const old = extra.signToken({ uid: 'A-77002', nick: '옛날토큰', iat: Math.floor(Date.now() / 1000) - 60 * 60 });
  await pg2.goto(`${HOST}/board?sso=${encodeURIComponent(old)}`);
  want(!/옛날토큰/.test(await pg2.textContent('body')), 'BUG', '시간이 지난 토큰이 아직 통한다');
  await ctx2.close();
  await ctx.close();
});

// P10 — 경계까지 밀어 보는 사람
persona('P10', '개복치 · 경계값을 밟는 사람', '데스크톱 · 긴 글과 이상한 글자', async (browser, db) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();

  step('닉네임 경계');
  await pg.goto(BASE + '/signup');
  await pg.fill('input[name=username]', 'edge01');
  await pg.fill('input[name=nickname]', '가'.repeat(11));      // 10자 넘김
  await pg.fill('input[name=password]', 'edgeedge12');
  await pg.click('form[action="/signup"] button[type=submit]');
  await pg.waitForLoadState('load');
  want(!db.prepare("SELECT 1 FROM users WHERE username='edge01'").get(),
    'BUG', '닉네임 11자로 가입이 됐다 (2~10자여야 함)');

  await pg.goto(BASE + '/signup');
  await pg.fill('input[name=username]', 'edge02');
  await pg.fill('input[name=nickname]', '이모지🌙별⭐');
  await pg.fill('input[name=password]', 'short');              // 8자 미만
  await pg.click('form[action="/signup"] button[type=submit]');
  await pg.waitForLoadState('load');
  want(!db.prepare("SELECT 1 FROM users WHERE username='edge02'").get(),
    'BUG', '비밀번호 5자로 가입이 됐다 (8자 이상이어야 함)');

  await pg.goto(BASE + '/signup');
  await pg.fill('input[name=username]', 'edge03');
  await pg.fill('input[name=nickname]', '이모지🌙별');
  await pg.fill('input[name=password]', 'edgeedge12');
  await pg.click('form[action="/signup"] button[type=submit]');
  await pg.waitForLoadState('load');
  const emo = db.prepare("SELECT nickname FROM users WHERE username='edge03'").get();
  want(emo, 'BUG', '이모지가 든 닉네임으로 가입이 안 된다');
  if (emo) want(emo.nickname === '이모지🌙별', 'BUG', '이모지 닉네임이 깨져 저장됐다', emo.nickname);

  step('제목·본문 경계');
  const write = async (title, content) => {
    await pg.goto(BASE + '/board/new');
    await pg.selectOption('select[name=category]', '자유').catch(() => {});
    await pg.fill('input[name=title]', title);
    await pg.click('.editor');
    await pg.keyboard.insertText(content);
    await pg.click('form[action="/board"] button[type=submit]');
    await pg.waitForLoadState('load');
  };

  // 제목 50자 딱 / 51자
  await write('제'.repeat(50), '딱 50자 제목');
  want(db.prepare("SELECT 1 FROM posts WHERE title = ?").get('제'.repeat(50)),
    'BUG', '제목 50자가 안 올라간다');
  await write('넘'.repeat(60), '51자 넘는 제목');
  const over = db.prepare("SELECT title FROM posts WHERE title LIKE '넘넘%'").get();
  want(!over || over.title.length <= 50, 'BUG', '제목이 50자를 넘겨 저장됐다', over ? `${over.title.length}자` : '');

  // 본문 5,000자 넘게
  await write('아주 긴 본문 시험', '길'.repeat(5200));
  const long = db.prepare("SELECT content FROM posts WHERE title='아주 긴 본문 시험'").get();
  if (long) {
    const plain = long.content.replace(/<[^>]*>/g, '');
    want(plain.length <= 5200, 'NIT', '본문 길이 제한이 서버에서는 안 걸린다', `${plain.length}자`);
  }

  // 빈 제목
  await pg.goto(BASE + '/board/new');
  await pg.selectOption('select[name=category]', '자유').catch(() => {});
  await pg.click('.editor');
  await pg.keyboard.insertText('제목 없이 보내기');
  await pg.click('form[action="/board"] button[type=submit]');
  await pg.waitForTimeout(400);
  want(/\/board\/new/.test(pg.url()), 'BUG', '제목 없이도 글이 올라간다', pg.url());

  // 제목만 공백
  await write('   ', '공백 제목');
  want(!db.prepare("SELECT 1 FROM posts WHERE title='   '").get(), 'BUG', '공백만 있는 제목이 올라간다');

  step('검색 경계');
  for (const q of ['%', '_', "' OR 1=1 --", '<script>', '가'.repeat(200)]) {
    const r = await pg.goto(BASE + '/board?q=' + encodeURIComponent(q));
    want(r.status() === 200, 'BUG', '이상한 검색어에 오류가 난다', `"${q.slice(0, 12)}" → ${r.status()}`);
  }
  await shot(pg, '1-경계값');
  await ctx.close();
});

// P11 — 두 번 누르고, 뒤로 갔다가, 두 탭을 켜 두는 사람
persona('P11', '산만한 사람 · 동시성', '탭 두 개 · 뒤로가기 · 더블클릭', async (browser, db) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  await pg.goto(BASE + '/signup');
  await pg.fill('input[name=username]', 'busy01');
  await pg.fill('input[name=nickname]', '산만이');
  await pg.fill('input[name=password]', 'busybusy12');
  await pg.click('form[action="/signup"] button[type=submit]');
  await pg.waitForLoadState('load');
  const uid = db.prepare("SELECT id FROM users WHERE username='busy01'").get().id;

  step('출석을 두 탭에서 동시에');
  const pg2 = await ctx.newPage();
  await pg.goto(BASE + '/attendance');
  await pg2.goto(BASE + '/attendance');
  await Promise.all([
    pg.click('button:has-text("출석체크 하기")').catch(() => {}),
    pg2.click('button:has-text("출석체크 하기")').catch(() => {}),
  ]);
  await pg.waitForTimeout(600);
  const attLogs = db.prepare("SELECT COUNT(*) c FROM point_logs WHERE user_id=? AND reason='attendance'").get(uid).c;
  want(attLogs === 1, 'BUG', '동시에 눌러 출석 포인트가 두 번 붙었다', `${attLogs}건`);
  const attRows = db.prepare('SELECT COUNT(*) c FROM attendance WHERE user_id=?').get(uid).c;
  want(attRows === 1, 'BUG', '출석 기록이 두 줄 생겼다', `${attRows}줄`);
  await pg2.close();

  step('추천을 연달아 두 번');
  await pg.goto(BASE + '/board/4');
  const like = await pg.$('form[action*="/like"] button');
  if (like) {
    await like.click(); await pg.waitForLoadState('load');
    const l2 = await pg.$('form[action*="/like"] button');
    if (l2) { await l2.click(); await pg.waitForLoadState('load'); }
    const n = db.prepare('SELECT COUNT(*) c FROM likes WHERE post_id=4 AND user_id=?').get(uid).c;
    want(n <= 1, 'BUG', '같은 사람이 같은 글을 두 번 추천했다', `${n}건`);
  }

  step('글 올린 뒤 뒤로가기 → 다시 보내기');
  await pg.goto(BASE + '/board/new');
  await pg.selectOption('select[name=category]', '자유').catch(() => {});
  await pg.fill('input[name=title]', '뒤로가기 시험용 글');
  await pg.click('.editor');
  await pg.keyboard.insertText('본문');
  await pg.click('form[action="/board"] button[type=submit]');
  await pg.waitForLoadState('load');
  await pg.goBack();
  await pg.waitForTimeout(400);
  await pg.goForward().catch(() => {});
  await pg.waitForTimeout(400);
  const dup = db.prepare("SELECT COUNT(*) c FROM posts WHERE title='뒤로가기 시험용 글'").get().c;
  want(dup === 1, 'BUG', '뒤로/앞으로 하다 같은 글이 두 번 올라갔다', `${dup}개`);

  step('로그아웃한 뒤 옛 화면에서 보내기');
  const stale = await ctx.newPage();
  await stale.goto(BASE + '/board/new');                    // 폼을 열어 둔 채
  await pg.goto(BASE + '/board');
  await pg.click('form[action="/logout"] button').catch(() => {});
  await pg.waitForLoadState('load');
  await stale.fill('input[name=title]', '로그아웃 뒤에 보낸 글');
  await stale.click('.editor');
  await stale.keyboard.insertText('본문');
  await stale.click('form[action="/board"] button[type=submit]').catch(() => {});
  await stale.waitForTimeout(600);
  want(!db.prepare("SELECT 1 FROM posts WHERE title='로그아웃 뒤에 보낸 글'").get(),
    'BUG', '로그아웃했는데 열어둔 폼으로 글이 써졌다');
  const url = stale.url();
  want(/\/login/.test(url) || await isErrorPage(stale), 'NIT',
    '세션이 끊긴 뒤 보내면 어디로 가는지 안내가 없다', url);
  await shot(stale, '1-세션끊김');
  await ctx.close();
});

// P12 — 알림이 실시간으로 오는가
persona('P12', '알림 기다리는 사람', '두 사람이 동시 접속 · SSE', async (browser, db) => {
  const a = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const b = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const pgA = await a.newPage();
  const pgB = await b.newPage();

  await pgA.goto(BASE + '/signup');
  await pgA.fill('input[name=username]', 'noti01');
  await pgA.fill('input[name=nickname]', '글쓴이');
  await pgA.fill('input[name=password]', 'notinoti12');
  await pgA.click('form[action="/signup"] button[type=submit]');
  await pgA.waitForLoadState('load');

  step('A가 글을 쓴다');
  await pgA.goto(BASE + '/board/new');
  await pgA.selectOption('select[name=category]', '자유').catch(() => {});
  await pgA.fill('input[name=title]', '알림 시험용 글입니다');
  await pgA.click('.editor');
  await pgA.keyboard.insertText('댓글 달아 주세요');
  await pgA.click('form[action="/board"] button[type=submit]');
  await pgA.waitForLoadState('load');
  const postUrl = pgA.url();

  // A는 게시판을 보며 기다린다 (여기서 SSE 가 붙는다)
  await pgA.goto(BASE + '/board');
  const before = await pgA.textContent('.bell').catch(() => '');
  await pgA.waitForTimeout(1200);

  step('B가 댓글을 단다');
  await pgB.goto(BASE + '/signup');
  await pgB.fill('input[name=username]', 'noti02');
  await pgB.fill('input[name=nickname]', '댓글러');
  await pgB.fill('input[name=password]', 'notinoti12');
  await pgB.click('form[action="/signup"] button[type=submit]');
  await pgB.waitForLoadState('load');
  await pgB.goto(postUrl);
  await pgB.fill('.comment-form input[name=content]', '좋은 글이네요!');
  await pgB.click('.comment-form button[type=submit]');
  await pgB.waitForLoadState('load');

  step('A 화면이 저절로 바뀌나');
  let live = false;
  for (let i = 0; i < 20 && !live; i++) {           // 최대 6초 기다린다
    await pgA.waitForTimeout(300);
    const now = await pgA.textContent('.bell').catch(() => '');
    if (now !== before && /[1-9]/.test(now || '')) live = true;
  }
  want(live, 'BUG', '댓글이 달렸는데 종 숫자가 저절로 안 바뀐다 (실시간 알림)',
    '새로고침해야 보이면 SSE 가 안 붙은 것');
  await shot(pgA, '1-실시간알림');

  // 새로고침하면 어쨌든 보여야 한다
  await pgA.goto(BASE + '/notifications');
  want(/좋은 글이네요|댓글/.test(await pgA.textContent('body')),
    'BLOCK', '알림 목록에 댓글 알림이 없다');

  // 내가 내 글에 댓글 달면 알림이 오면 안 된다
  const aid = db.prepare("SELECT id FROM users WHERE username='noti01'").get().id;
  await pgA.goto(postUrl);
  await pgA.fill('.comment-form input[name=content]', '제가 다는 댓글');
  await pgA.click('.comment-form button[type=submit]');
  await pgA.waitForLoadState('load');
  const selfNoti = db.prepare(
    "SELECT COUNT(*) c FROM notifications WHERE user_id=? AND message LIKE '%글쓴이%'").get(aid).c;
  want(selfNoti === 0, 'NIT', '내가 내 글에 단 댓글로 나에게 알림이 온다', `${selfNoti}건`);
  await a.close(); await b.close();
});

// P13 — 없는 주소, 지워진 글, 이상한 값
persona('P13', '길 잃은 사람', '없는 주소 · 지워진 글 · 이상한 값', async (browser, db) => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const pg = await ctx.newPage();
  await login(pg, 'gold', 'test1234');

  step('없는 주소들');
  const cases = [
    ['/board/999999', '없는 글'],
    ['/users/999999', '없는 회원'],
    ['/board/abc', '숫자가 아닌 글 번호'],
    ['/없는페이지', '없는 주소'],
    ['/board?page=99999', '없는 쪽'],
    ['/board?page=-5', '음수 쪽'],
    ['/board?sort=이상한값', '없는 정렬'],
    ['/board?category=없는말머리', '없는 말머리'],
    ['/profile?tab=avatar&theme=없는테마', '없는 캐릭터 테마'],
    ['/profile?tab=avatar&theme=redqueen&f=이상한필터', '없는 거르기'],
  ];
  for (const [url, what] of cases) {
    const r = await pg.goto(BASE + url).catch(() => null);
    const code = r ? r.status() : 0;
    const broken = await pg.evaluate(() => /Cannot read|undefined is not|TypeError|ReferenceError/.test(document.body.innerText));
    want(code === 200 || code === 404 || code === 302, 'BUG', `${what}에서 이상한 응답`, `${url} → ${code}`);
    want(!broken, 'BUG', `${what}에서 오류 내용이 화면에 그대로 나온다`, url);
  }
  await shot(pg, '1-없는글');

  step('지워진 글에 댓글 달기');
  await pg.goto(BASE + '/board/new');
  await pg.selectOption('select[name=category]', '자유').catch(() => {});
  await pg.fill('input[name=title]', '곧 지울 글');
  await pg.click('.editor');
  await pg.keyboard.insertText('본문');
  await pg.click('form[action="/board"] button[type=submit]');
  await pg.waitForLoadState('load');
  const pid = Number(pg.url().split('/').pop().split('?')[0]);
  const token = await pg.evaluate(() => document.querySelector('meta[name=csrf-token]')?.content || '');
  db.prepare('DELETE FROM posts WHERE id = ?').run(pid);      // 다른 사람이 지운 셈
  const status = await pg.evaluate(async ([url, t]) => {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': t },
      body: 'content=지워진 글에 다는 댓글', redirect: 'manual',
    });
    return r.status;
  }, [`${BASE}/board/${pid}/comments`, token]);
  want(status !== 500, 'BUG', '지워진 글에 댓글을 달면 서버 오류가 난다', `HTTP ${status}`);
  const orphan = db.prepare('SELECT COUNT(*) c FROM comments WHERE post_id=?').get(pid).c;
  want(orphan === 0, 'BUG', '없는 글에 댓글이 달렸다', `${orphan}건`);

  step('숨긴 글은 남에게 안 보여야 한다');
  // 예전에는 4번 글을 숨겨 놓고 '강남 쪽 카페' 가 사라졌는지 봤다.
  // 그런데 데모 글이 늘면서 4번은 다른 글이 됐고, '강남 쪽 카페' 는 숨기지도 않은 채
  // 목록에 그대로 남아 검사가 틀린 곳을 가리켰다.
  //
  // 고칠 때도 한 번 헛짚었다. 아무 글이나 골라 숨기면, 그 글이 2쪽에 있는 글이면
  // 숨기든 말든 1쪽 목록에는 원래 없다. 그래서 '안 보인다' 가 그냥 참이 된다.
  // 숨기는 기능을 통째로 망가뜨려 놓고 재 봤더니 정말 안 걸렸다.
  // 그러니 먼저 목록에 보이는 글을 고르고, 숨긴 뒤 사라지는지를 본다.
  const ctx2 = await browser.newContext();
  const pg2 = await ctx2.newPage();
  await pg2.goto(BASE + '/board');
  const 보이는글 = await pg2.$$eval('a[href^="/board/"]', (as) => as
    .map((a) => (a.getAttribute('href').match(/^\/board\/(\d+)/) || [])[1])
    .filter(Boolean).map(Number));
  const 숨길글 = db.prepare(
    `SELECT id, title FROM posts
      WHERE is_notice = 0 AND is_hidden = 0 AND id IN (${보이는글.join(',') || 0})
      ORDER BY id DESC LIMIT 1`).get();
  want(숨길글, 'BUG', '목록에 보이는 글을 못 찾아서 숨김 검사를 못 했다');
  if (!숨길글) { await ctx2.close(); await ctx.close(); return; }
  want((await pg2.content()).includes(숨길글.title),
    'BUG', '숨기기 전인데 목록에 없다 (검사가 헛돈다)', 숨길글.title);
  db.prepare('UPDATE posts SET is_hidden = 1 WHERE id = ?').run(숨길글.id);
  const r2 = await pg2.goto(`${BASE}/board/${숨길글.id}`);
  want(r2.status() === 404 || /삭제|숨김|찾을 수 없/.test(await pg2.textContent('body')),
    'BUG', '숨긴 글이 비회원에게 그대로 보인다', `HTTP ${r2.status()}`);
  const list = await (await pg2.goto(BASE + '/board')).text();
  want(!list.includes(숨길글.title), 'BUG', '숨긴 글이 목록에 남아 있다', 숨길글.title);
  db.prepare('UPDATE posts SET is_hidden = 0 WHERE id = ?').run(숨길글.id);
  await ctx2.close();
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

  // 연동 모드는 환경변수가 달라 같은 서버로 못 본다. 필요할 때만 하나 더 띄운다.
  const HOST_PORT = PORT + 1;
  const HOST_SECRET = 'persona-test-secret-0123456789';
  const needHost = list.some((p) => p.id === 'P9');
  const hostServer = needHost ? startServer(dbPath, {
    AUTH_MODE: 'host', HOST_SSO_SECRET: HOST_SECRET, HOST_SSO_TTL_SEC: '300',
  }, HOST_PORT) : null;
  const extra = {
    hostBase: `http://127.0.0.1:${HOST_PORT}`,
    // A사이트가 하는 일과 똑같이 서명한다 (src/identity.js 의 sign 과 같은 방식)
    signToken: (payload) => {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const mac = require('crypto').createHmac('sha256', HOST_SECRET).update(body).digest('base64url');
      return `${body}.${mac}`;
    },
  };

  const stop = () => {
    try { server.kill(); } catch {}
    try { if (hostServer) hostServer.kill(); } catch {}
  };
  process.on('exit', stop);

  const started = Date.now();
  try {
    await waitUp();
    if (hostServer) await waitUp(extra.hostBase);
    const browser = await chromium.launch({ executablePath: EXE });
    for (const p of list) {
      current = p;
      console.log(`\n▶ ${p.id} ${p.name} — ${p.who}`);
      const t = Date.now();
      try {
        await p.run(browser, db, extra);
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
