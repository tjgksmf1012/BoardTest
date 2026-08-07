#!/usr/bin/env node
// 이식용/화면HTML/ 을 다시 만든다 — 선배님이 마크업 참고하실 화면 13개
//
//   node scripts/make-screens.js
//   node scripts/make-screens.js --check   다시 만들지 않고 낡았는지만 본다
//
// 왜 만들었나
//   이 폴더를 처음에는 손으로 뽑았다. 그래서 코드를 고쳐도 여기는 안 따라와서
//   조용히 낡는다. 실제로 고리 크기를 1.20 에서 1.34 로 고쳤을 때
//   여기 26군데가 옛 값(120%)으로 남아 있었다. 선배님이 여기서 마크업을 복사하시면
//   방금 고친 것이 도로 들어간다.
//
//   손으로 만든 것은 반드시 낡는다. 그래서 스크립트로 바꾸고, 낡았는지 보는 방법도 붙였다.
//
// 하는 일
//   1. 서버를 임시 DB 로 띄운다 (실제 데이터는 안 건드린다)
//   2. 화면 13개를 받아 온다 (필요한 화면은 로그인해서)
//   3. 링크는 눌러도 안 움직이게 #, 그림·CSS 는 이 폴더 기준 경로로 바꾼다
//   4. 파일로 저장한다
//   5. css/style.css 도 같이 복사한다
//
// 5번을 뒤늦게 붙인 이유
//   HTML 만 스크립트로 만들고 CSS 는 손으로 한 번 복사해 두고 잊고 있었다.
//   그래서 베스트댓글 모양을 넣었는데 이 사본에는 안 들어갔고,
//   이 사본을 받아 쓰는 cm.css(선배님이 실제로 쓰시는 것)에도 당연히 안 들어갔다.
//   화면은 우리 쪽에서만 멀쩡했다. 손으로 만든 것은 반드시 낡는다 — 또 겪었다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const req = require('module').createRequire('/opt/node22/lib/node_modules/playwright/index.js');
const { chromium } = req('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '이식용/화면HTML');
const PORT = 3390;
const BASE = `http://127.0.0.1:${PORT}`;
const CHECK = process.argv.includes('--check');

// 뽑을 화면. [파일이름, 주소, 로그인할 계정]
// '글보기' 주소는 아래에서 댓글이 제일 많은 글로 바꿔 끼운다 (@글보기 자리)
const SCREENS = [
  ['목록', '/board', 'gold'],
  ['글보기', '@글보기', 'gold'],
  ['글쓰기', '/board/new', 'gold'],
  ['출석체크', '/attendance', 'gold'],
  ['마이페이지', '/profile', 'admin'],
  ['캐릭터상점', '/profile?tab=avatar', 'admin'],
  ['이벤트·포인트', '/points', 'gold'],
  ['랭킹', '/ranking', 'gold'],
  ['알림', '/notifications', 'gold'],
  ['신고관리', '/reports', 'admin'],
  ['회원관리', '/admin/members', 'admin'],
  ['로그인', '/login', null],
  ['회원가입', '/signup', null],
];
const PW = { gold: 'test1234', admin: 'admin1234' };

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

// 댓글이 제일 많은 글을 찾는다.
// 전에는 '/board/1' 로 박아 뒀는데, 1번 글에는 댓글이 하나도 없다.
// 그래서 선배님이 받아 보시는 '글보기' 본보기에 댓글도 답글도 베스트댓글도 없었다.
// 정작 마크업을 제일 옮기기 어려운 부분이 그 셋인데 본보기에 없었던 것이다.
function busiestPost(dbPath) {
  const db = require(path.join(ROOT, 'node_modules', 'better-sqlite3'))(dbPath, { readonly: true });
  const row = db.prepare(`SELECT p.id FROM posts p
      JOIN comments c ON c.post_id = p.id
     WHERE p.is_hidden = 0
     GROUP BY p.id ORDER BY COUNT(c.id) DESC, p.id LIMIT 1`).get();
  db.close();
  if (!row) throw new Error('댓글이 달린 글이 하나도 없어요 — 본보기를 못 만듭니다');
  return '/board/' + row.id;
}

// 받아 온 HTML 을 '폴더째 열어 보는 용도' 로 바꾼다
function rewrite(html) {
  return html
    // CSS 는 이 폴더의 것으로
    .replace(/href="\/css\/style\.css[^"]*"/g, 'href="css/style.css"')
    // 그림은 이식용/img/avatars 로 (화면HTML 에서 한 단계 위)
    .replace(/src="\/avatars\//g, 'src="../img/avatars/')
    .replace(/src="\/uploads\//g, 'src="../img/uploads/')
    // 자바스크립트도 이 폴더의 것으로
    .replace(/src="\/js\//g, 'src="js/')
    // 나머지 우리 사이트 링크는 눌러도 안 움직이게 (마크업 참고용이라서)
    .replace(/href="\/([^"]*)"/g, 'href="#$1"')
    .replace(/action="\/([^"]*)"/g, 'action="#$1"');
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-'));
  const dbPath = path.join(tmp, 'db.sqlite');
  const srv = startServer(dbPath);
  let browser;
  const stale = [];
  try {
    await waitUp();
    browser = await chromium.launch();

    const ctxs = {};
    async function ctxFor(who) {
      const key = who || '_';
      if (ctxs[key]) return ctxs[key];
      const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
      if (who) {
        const pg = await ctx.newPage();
        await pg.goto(BASE + '/login');
        await pg.fill('input[name=username]', who);
        await pg.fill('input[name=password]', PW[who]);
        await pg.click('form[action^="/login"] button[type=submit]');
        await pg.waitForLoadState('load');
        await pg.close();
      }
      ctxs[key] = ctx;
      return ctx;
    }

    const 글보기 = busiestPost(dbPath);

    for (const [name, rawUrl, who] of SCREENS) {
      const url = rawUrl === '@글보기' ? 글보기 : rawUrl;
      const ctx = await ctxFor(who);
      const pg = await ctx.newPage();
      // networkidle 은 못 쓴다. 알림 실시간 연결(SSE)이 계속 열려 있어서 영영 안 끝난다.
      await pg.goto(BASE + url, { waitUntil: 'load' });
      await pg.waitForFunction(() => [...document.images].every((i) => i.complete), null,
        { timeout: 15000 }).catch(() => {});
      const html = rewrite(await pg.content());
      await pg.close();

      const file = path.join(OUT, name + '.html');
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (CHECK) {
        // 통째로 비교하면 토큰·시각 때문에 매번 다르다. 모양을 정하는 것만 본다.
        const key = (s) => (s.match(/style="width:\d+%[^"]*"/g) || []).join('|');
        if (key(old) !== key(html)) stale.push(name);
      } else {
        fs.writeFileSync(file, html);
      }
    }

    // CSS 사본. 이건 서버에서 받을 것도 없이 그냥 지금 파일을 그대로 둔다.
    // 여기가 낡으면 cm.css 까지 같이 낡는다 (cm.css 를 이 파일에서 만들기 때문).
    const cssFrom = path.join(ROOT, 'public/css/style.css');
    const cssTo = path.join(OUT, 'css/style.css');
    if (CHECK) {
      const same = fs.existsSync(cssTo)
        && fs.readFileSync(cssFrom).equals(fs.readFileSync(cssTo));
      if (!same) stale.push('css/style.css');
    } else {
      fs.mkdirSync(path.dirname(cssTo), { recursive: true });
      fs.copyFileSync(cssFrom, cssTo);
    }
  } finally {
    if (browser) await browser.close();
    srv.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (CHECK) {
    if (stale.length) {
      console.error(`화면HTML 이 지금 코드와 다릅니다 (${stale.length}개): ${stale.join(', ')}`);
      console.error('node scripts/make-screens.js 로 다시 만들어 주세요.');
      process.exit(1);
    }
    console.log(`화면 ${SCREENS.length}개 · 지금 코드와 같습니다`);
  } else {
    console.log(`화면 ${SCREENS.length}개를 다시 만들었어요 → 이식용/화면HTML/`);
  }
})();
