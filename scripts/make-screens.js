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
const SCREENS = [
  ['목록', '/board', 'gold'],
  ['글보기', '/board/1', 'gold'],
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

    for (const [name, url, who] of SCREENS) {
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
