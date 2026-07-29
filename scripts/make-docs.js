// 넘겨줄 문서를 만든다 — 사용설명서(스크린샷 포함) + 연동가이드
//
//   node scripts/make-docs.js            # HTML 두 개를 docs/ 에 만든다
//   node scripts/make-docs.js --pdf      # PDF까지 함께 만든다
//
// 스크린샷의 붉은 강조 상자는 좌표를 적어두지 않고 '요소를 실제로 재서' 만든다.
// 화면이 바뀌어도 이 스크립트만 다시 돌리면 설명서가 따라 갱신된다.
process.env.TZ = process.env.TZ || 'Asia/Seoul'; // 서버와 같은 시간대여야 '오늘'이 어긋나지 않는다

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const PORT = Number(process.env.DOC_PORT) || 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const SITE = process.env.SITE_URL || 'https://pointlounge.onrender.com';
const WANT_PDF = process.argv.includes('--pdf');

// playwright는 설명서를 만들 때만 쓰는 도구라 프로젝트 의존성에 넣지 않았다.
// 이 컴퓨터에 설치돼 있으면 그걸 쓰고, 없으면 안내만 남기고 끝낸다.
function loadChromium() {
  const tries = ['playwright-core', 'playwright'];
  for (const name of tries) {
    try { return require(name).chromium; } catch {}
  }
  for (const dir of [process.env.PLAYWRIGHT_HOME, '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
    if (!dir) continue;
    try {
      const req = require('module').createRequire(path.join(dir, 'index.js'));
      return req('playwright-core').chromium;
    } catch {}
  }
  console.error('playwright를 찾지 못했어요. `npm i -g playwright` 후 다시 실행해주세요.');
  process.exit(1);
}
const chromium = loadChromium();
const EXE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

// ---- 문서 공통 스타일 --------------------------------------------------------
const CSS = `
:root{
  --bg:#f4f7f6; --surface:#fff; --ink:#16231f; --text:#26352f; --muted:#63706b;
  --line:#e4eae8; --teal:#0b8177; --teal-d:#0a6f66; --coral:#d8452f; --amber:#b87d12;
  --code:#f2f5f4;
  --shadow:0 1px 3px rgba(22,35,31,.05),0 8px 24px rgba(22,35,31,.06);
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);
  font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',system-ui,sans-serif;
  line-height:1.75;letter-spacing:-.01em;-webkit-font-smoothing:antialiased}
.page{max-width:880px;margin:0 auto;padding:44px 22px 72px}
strong{color:var(--ink);font-weight:700}
a{color:var(--teal-d)}
code{background:var(--code);border-radius:5px;padding:1px 6px;font-size:.9em;
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ink)}
pre{background:var(--ink);color:#e8f0ee;border-radius:12px;padding:16px 18px;overflow-x:auto;
  font-size:12.5px;line-height:1.65;margin:14px 0}
pre code{background:none;color:inherit;padding:0;font-size:inherit}

.hero{border-bottom:2px solid var(--line);padding-bottom:26px;margin-bottom:30px}
.brand{display:flex;align-items:center;gap:9px;font-weight:800;color:var(--teal-d);font-size:15px;letter-spacing:-.02em}
.logo{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--teal),#14b8a6);
  color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
h1{font-size:clamp(28px,5vw,40px);color:var(--ink);letter-spacing:-.03em;margin:13px 0 10px;font-weight:800;line-height:1.25}
.lede{font-size:16.5px;max-width:64ch}
.meta{color:var(--muted);font-size:13px;margin-top:14px}

.box{background:var(--surface);border:1px solid var(--line);border-radius:15px;padding:20px 22px;box-shadow:var(--shadow);margin-bottom:22px}
.box h3{font-size:15.5px;color:var(--ink);margin-bottom:12px}
.url{font-size:17px;font-weight:800;word-break:break-all}
.note{color:var(--muted);font-size:13px;margin-top:10px}

table{width:100%;border-collapse:collapse;font-size:13.5px;margin:12px 0}
th{text-align:left;color:var(--muted);font-weight:700;font-size:12.5px;padding:7px 10px;border-bottom:1px solid var(--line)}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;font-size:11.5px;font-weight:800;border-radius:6px;padding:2px 9px;white-space:nowrap}
.tag.admin{background:#fbe6e2;color:var(--coral)}
.tag.user{background:#e2f2ef;color:var(--teal-d)}

.chapter{margin-top:38px;break-inside:avoid}
.chp-head{display:flex;gap:13px;align-items:flex-start;margin-bottom:13px}
.chp-num{flex-shrink:0;width:32px;height:32px;border-radius:10px;background:var(--teal);color:#fff;
  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
.chapter h2{font-size:20px;color:var(--ink);letter-spacing:-.02em;font-weight:800;line-height:1.35}
.whatis{color:var(--muted);font-size:14px;margin-top:3px;max-width:62ch}
.shot-wrap{position:relative;border:1px solid var(--line);border-radius:13px;overflow:hidden;box-shadow:var(--shadow);background:var(--surface);line-height:0}
.shot-wrap img{width:100%;display:block}
.hl{position:absolute;border:2.5px solid var(--coral);border-radius:7px;box-shadow:0 0 0 3px rgba(216,69,47,.16)}
.hl-n{position:absolute;left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;background:var(--coral);
  color:#fff;font-size:12.5px;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1}
.legend{list-style:none;margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:7px 18px}
.legend li{display:flex;gap:8px;align-items:flex-start;font-size:13.5px;line-height:1.5}
.ln{flex-shrink:0;width:19px;height:19px;border-radius:50%;background:var(--coral);color:#fff;
  font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-top:2px}

h2.sec{font-size:21px;color:var(--ink);font-weight:800;margin:34px 0 10px;letter-spacing:-.02em;
  padding-top:14px;border-top:1px solid var(--line);break-after:avoid}
h3.sub{font-size:16px;color:var(--ink);font-weight:700;margin:22px 0 8px;break-after:avoid}
p{margin:9px 0}
ul,ol{margin:9px 0 9px 20px}
li{margin:4px 0}
blockquote{border-left:3px solid var(--teal);background:#eef5f4;border-radius:0 10px 10px 0;
  padding:11px 16px;margin:13px 0;color:var(--text);font-size:14px}
.foot{margin-top:52px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;text-align:center}
@media print{
  body{background:#fff}
  .page{padding:0;max-width:none}
  .box,.shot-wrap{box-shadow:none}
  .chapter,figure,pre,table{break-inside:avoid}
}
`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const doc = (title, body) =>
  `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;

// ---- 설명서 각 장(章) --------------------------------------------------------
// url        : 찍을 화면
// as         : 로그인할 계정 (없으면 로그아웃 상태)
// prep       : 찍기 전에 할 동작
// keepPopup  : 출석 팝업을 닫지 않음
// marks      : [선택자, 설명] — 좌표는 실행 중에 잰다
const CHAPTERS = [
  {
    title: '로그인 · 회원가입', url: '/login',
    whatis: '커뮤니티의 시작 화면. 아래 데모 계정으로 바로 로그인하거나, 새로 가입하면 1,000P를 받고 시작해요.',
    marks: [
      ['input[name=username]', '아이디 입력 (admin / gold 등)'],
      ['input[name=password]', '비밀번호 (admin1234 / test1234)'],
      ['.topbar-user a.btn-primary', '새 회원가입 (가입 시 1,000P 지급)'],
    ],
  },
  {
    title: '커뮤니티 게시판', url: '/board', as: 'gold',
    whatis: '글을 읽고 쓰는 메인 화면이에요. 말머리 탭으로 분류하고, 정렬은 선택 상자로 바꿔요. 글을 쓰면 포인트가 쌓여요.',
    marks: [
      ['.board-head .btn-primary', '글쓰기 (+300P, 하루 3개까지)'],
      ['.search', '제목·내용 검색'],
      ['.trending', '지금 뜨는 글 (최근 7일 추천순)'],
      ['.cat-tabs', '말머리로 걸러보기'],
      ['.seg', '전체글 / 인기글'],
      ['.sort-form', '정렬 (최신 · 추천 · 조회)'],
    ],
  },
  {
    title: '게시글 보기', url: '/board/4', as: 'gold', scrollTo: '.comment-form',
    whatis: '글 본문과 댓글을 보는 화면. 자주 쓰는 목록·스크랩·추천만 밖에 두고, 수정·삭제·신고와 운영자 기능은 오른쪽 위 점 3개 안에 모았어요.',
    marks: [
      ['.post-detail .btn-like', '추천 (작성자에게 +10P)'],
      ['.post-actions form[action$="/bookmark"]', '스크랩(저장)'],
      ['.post-detail-head .menu-btn', '점 3개 — 수정·삭제·신고·운영자 기능'],
      ['.comment-form', '댓글 쓰기 (+100P, 하루 10개까지)'],
    ],
  },
  {
    title: '점 3개 메뉴', url: '/board/4', as: 'admin',
    whatis: '글쓴이에게는 수정·삭제가, 다른 사람에게는 신고가, 운영자에게는 숨김 처리·운영자 추천이 보여요. 볼 수 있는 사람에게 할 수 있는 것만 나옵니다.',
    prep: async (pg) => { await pg.click('.post-detail-head .menu-btn'); await pg.waitForTimeout(250); },
    marks: [
      ['.post-detail-head .menu-pop', '내가 할 수 있는 일만 모아서'],
      ['.post-detail-head .menu-sep', '운영자에게만 보이는 구분선'],
    ],
  },
  {
    title: '글쓰기 (서식 에디터)', url: '/board/new', as: 'gold',
    whatis: '네이버 블로그처럼 글을 꾸밀 수 있어요. 제목·소제목 크기, 굵게, 밑줄, 목록, 인용을 쓸 수 있고, 무엇보다 사진이 커서를 둔 자리에 그대로 들어가서 "사진 → 설명 → 사진" 식으로 배치할 수 있어요.',
    marks: [
      ['input[name=title]', '제목 (50자까지)'],
      ['.tb-btn', '글씨 크기 · 굵게 · 밑줄 · 목록 · 인용'],
      ['.tb-photo, .tb-right', '사진을 커서 위치에 바로 삽입'],
      ['.editor', '내용 (여기에 바로 쓰고 꾸며요)'],
    ],
  },
  {
    title: '출석부 (그날 첫 접속)', url: '/board', as: 'street', keepPopup: true, freshAttendance: 'street',
    whatis: '로그인하고 그날 처음 들어오면 묻지 않고 바로 출석 처리되면서 출석부가 뜹니다. 오늘 칸에 도장이 찍히고 연속 일수와 포인트가 올라가요. 3·7·30일 연속을 채우면 보너스와 함께 카드가 반짝입니다.',
    marks: [
      ['.att-streak', '지금 며칠째 연속인지'],
      ['.att-sheet', '최근 7일 출석부 — 오늘 칸에 도장이 찍혀요'],
      ['.att-reward', '자동으로 적립된 포인트 (+100P)'],
    ],
  },
  {
    title: '포인트', url: '/points', as: 'gold', scrollTo: 'table',
    whatis: '내 포인트와 적립 내역을 보는 화면. 무슨 활동으로 얼마를 받는지, 다음 아바타 해금까지 얼마 남았는지 보여줘요.',
    marks: [
      ['.point-summary', '내 포인트 · 오늘 적립'],
      ['.next-unlock', '다음 아바타 해금까지 진행률'],
      ['table', '포인트 적립 기준표'],
    ],
  },
  {
    title: '마이페이지', url: '/profile', as: 'gold',
    whatis: '내 레벨·활동·배지를 모아보는 곳. 포인트가 쌓이면 레벨과 아바타가 성장해요.',
    marks: [
      ['.lv-chip', '레벨 / 등급 (포인트로 상승)'],
      ['.ptab-bar', '내 정보 · 출석 · 아바타 꾸미기'],
      ['.profile-stats', '내 활동 통계'],
    ],
  },
  {
    title: '출석 기록', url: '/profile#attendance', as: 'gold',
    whatis: '출석 달력과 연속 출석 현황은 마이페이지 안에서 봐요. 하루 한 번 출석하면 100P, 연속으로 출석하면 3·7·30일마다 보너스가 커져요.',
    prep: async (pg) => { await pg.click('.ptab[data-target=attendance]'); await pg.waitForTimeout(250); },
    marks: [
      ['.cal, .calendar, #panel-attendance .card', '출석 달력'],
    ],
  },
  {
    title: '아바타 꾸미기', url: '/profile', as: 'gold',
    whatis: '포인트로 해금한 아바타와 테두리를 골라 장착해요. 아직 못 연 것은 잠금 표시와 함께 얼마가 더 필요한지 보여줍니다.',
    prep: async (pg) => { await pg.click('.ptab[data-target=avatar]'); await pg.waitForTimeout(250); },
    marks: [
      ['#panel-avatar .tier-card', '단계별 아바타 (무료 → 헤어 → 의상 → 테두리)'],
    ],
  },
  {
    title: '랭킹', url: '/ranking', as: 'gold',
    whatis: '포인트가 많은 회원 20명을 보여줘요. 닉네임을 누르면 그 사람의 공개 프로필로 갑니다.',
    marks: [['.rank-row, .card', '포인트 순위 TOP 20']],
  },
  {
    title: '공개 프로필', url: '/users/3', as: 'gold',
    whatis: '다른 회원의 프로필이에요. 레벨·포인트·순위·활동 통계·배지와 작성한 글을 볼 수 있어요. 익명으로 쓴 글은 표시되지 않아 작성자가 드러나지 않습니다.',
    marks: [['.profile-stats', '그 사람의 활동 통계']],
  },
  {
    title: '회원 관리 (운영자 전용)', url: '/members', as: 'admin',
    whatis: 'admin 계정으로 로그인하면 보이는 화면. 회원 목록·활동을 보고 부적절한 회원을 제재할 수 있어요.',
    marks: [['.member-row, .card', '회원 목록 · 활동 · 포인트']],
  },
  {
    title: '신고 관리 (운영자 전용)', url: '/reports', as: 'admin',
    whatis: '신고된 글·댓글을 확인하고 반려·숨김·삭제로 처리해요.',
    marks: [['.card', '신고 접수 목록과 처리 버튼']],
  },
];

// ---- 아주 작은 마크다운 변환기 (연동가이드용) --------------------------------
// 문서에서 쓰는 문법만 지원한다: 제목·표·목록·인용·코드블록·굵게·링크·구분선
function mdToHtml(md) {
  const out = [];
  const lines = md.split('\n');
  let i = 0;
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {                       // 코드 블록
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) { i++; continue; } // 구분선은 제목 스타일로 대신
    if (/^#{1,4} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const text = inline(line.replace(/^#+\s*/, ''));
      out.push(level <= 2 ? `<h2 class="sec">${text}</h2>` : `<h3 class="sub">${text}</h3>`);
      i++; continue;
    }
    if (/^\|/.test(line)) {                        // 표
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
        + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }
    if (/^> /.test(line)) {
      const buf = [];
      while (i < lines.length && /^> /.test(lines[i])) buf.push(lines[i++].replace(/^> /, ''));
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*] /.test(line)) {                  // 목록 (체크박스 포함)
      const buf = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i])) {
        buf.push(lines[i++].replace(/^\s*[-*] /, '').replace(/^\[[ x]\]\s*/, '☐ '));
      }
      out.push('<ul>' + buf.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>');
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const buf = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) buf.push(lines[i++].replace(/^\d+\.\s*/, ''));
      out.push('<ol>' + buf.map((t) => `<li>${inline(t)}</li>`).join('') + '</ol>');
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    // 문단. 앞 규칙에 걸리지 않은 줄은 무조건 한 줄은 먹고 넘어가야 한다
    // (그러지 않으면 `코드`로 시작하는 줄에서 제자리걸음을 한다)
    const stops = /^(\||>|#{1,4} |```|\s*[-*] |\d+\. )/;
    const buf = [lines[i++]];
    while (i < lines.length && lines[i].trim() !== '' && !stops.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ---- 서버 띄우기 -------------------------------------------------------------
function startServer(dbPath) {
  const env = { ...process.env, DB_PATH: dbPath, PORT: String(PORT), TZ: 'Asia/Seoul', NODE_ENV: 'development', AUTH_MODE: 'standalone' };
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: 'ignore' });
  return child;
}
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/board')).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('문서용 서버가 뜨지 않았어요');
}

// ---- 실행 -------------------------------------------------------------------
(async () => {
  // 데모 DB를 복사해 쓴다 (설명서를 만든다고 실제 데이터가 바뀌면 안 된다)
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pl-docs-'));
  const dbPath = path.join(tmp, 'docs.db');
  const src = path.join(ROOT, 'data', 'board.db');
  if (!fs.existsSync(src)) throw new Error('data/board.db 가 없어요. 먼저 npm start 로 한 번 띄워 주세요.');
  fs.copyFileSync(src, dbPath);

  // 출석부 화면을 찍으려면 오늘 아직 출석하지 않은 사람이 있어야 한다
  const sqlite = require('better-sqlite3')(dbPath);
  for (const c of CHAPTERS) {
    if (!c.freshAttendance) continue;
    const u = sqlite.prepare('SELECT id FROM users WHERE username = ?').get(c.freshAttendance);
    if (u) sqlite.prepare("DELETE FROM attendance WHERE user_id = ? AND day = date('now','localtime')").run(u.id);
  }
  sqlite.close();

  const server = startServer(dbPath);
  const stop = () => { try { server.kill(); } catch {} };
  process.on('exit', stop);

  try {
    await waitUp();
    const browser = await chromium.launch({ executablePath: EXE });
    const shots = [];

    for (const ch of CHAPTERS) {
      const ctx = await browser.newContext({ viewport: { width: 1120, height: 1180 }, deviceScaleFactor: 1.6, colorScheme: 'light' });
      const pg = await ctx.newPage();

      if (ch.as) {
        // 출석부 장은 로그인 리다이렉트가 곧바로 목적지에 닿아야 한다.
        // 로그인 후 한 번 더 이동하면 그 사이 페이지에서 출석이 끝나 팝업이 사라진다.
        await pg.goto(BASE + '/login?next=' + encodeURIComponent(ch.url));
        await pg.fill('input[name=username]', ch.as);
        await pg.fill('input[name=password]', ch.as === 'admin' ? 'admin1234' : 'test1234');
        await pg.click('form[action^="/login"] button[type=submit]');
        await pg.waitForLoadState('load');
      }
      if (!ch.as || !ch.keepPopup) {
        await pg.goto(BASE + ch.url);
        await pg.waitForLoadState('load');
      }
      await pg.waitForTimeout(500);

      if (!ch.keepPopup) {
        const x = await pg.$('#attPopClose');
        if (x) { await x.click(); await pg.waitForTimeout(300); }
      } else {
        await pg.waitForTimeout(1600); // 출석 연출이 끝난 뒤를 찍는다
      }
      if (ch.prep) await ch.prep(pg);

      // 강조할 요소가 화면 밖이면 보이는 데까지 내려서 찍는다
      if (ch.scrollTo) {
        await pg.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ block: 'end' });
        }, ch.scrollTo);
        await pg.waitForTimeout(300);
      }

      // 강조 상자: 좌표를 적어두지 않고 실제 요소를 재서 만든다.
      // 화면이 짧으면 아래가 텅 빈 채로 찍히므로, 내용이 끝나는 데까지만 잘라낸다.
      const shot = await pg.evaluate((sels) => {
        const W = window.innerWidth, H = window.innerHeight;
        const boxes = [];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (!el) { boxes.push(null); continue; }
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > H) { boxes.push(null); continue; }
          boxes.push({ left: Math.max(r.left, 0), top: Math.max(r.top, 0),
            right: Math.min(r.right, W), bottom: Math.min(r.bottom, H) });
        }
        const main = document.querySelector('main.container') || document.body;
        let bottom = main.getBoundingClientRect().bottom;
        for (const b of boxes) if (b) bottom = Math.max(bottom, b.bottom);
        const clipH = Math.min(H, Math.max(340, Math.ceil(bottom) + 26));
        return {
          clipH, W,
          marks: boxes.map((b) => b && {
            left: (b.left / W * 100).toFixed(2),
            top: (b.top / clipH * 100).toFixed(2),
            width: ((b.right - b.left) / W * 100).toFixed(2),
            height: ((b.bottom - b.top) / clipH * 100).toFixed(2),
          }),
        };
      }, ch.marks.map((m) => m[0]));
      const marks = shot.marks;

      const png = await pg.screenshot({ type: 'png', clip: { x: 0, y: 0, width: shot.W, height: shot.clipH } });
      shots.push({ ch, png, marks });
      await ctx.close();
      console.log(`  ✓ ${ch.title}${marks.filter(Boolean).length}/${marks.length} 강조)`);
    }
    await browser.close();

    // ---- 사용설명서 ---------------------------------------------------------
    const chapters = shots.map(({ ch, png, marks }, idx) => {
      const hls = marks.map((m, i) => m
        ? `<div class="hl" style="left:${m.left}%;top:${m.top}%;width:${m.width}%;height:${m.height}%"><span class="hl-n">${i + 1}</span></div>`
        : '').join('');
      const legend = ch.marks.map(([, label], i) => marks[i]
        ? `<li><span class="ln">${i + 1}</span><span>${esc(label)}</span></li>` : '').join('');
      return `
  <section class="chapter">
    <div class="chp-head"><span class="chp-num">${idx + 1}</span><div><h2>${esc(ch.title)}</h2>
      <p class="whatis">${esc(ch.whatis)}</p></div></div>
    <figure>
      <div class="shot-wrap"><img src="data:image/png;base64,${png.toString('base64')}" alt="${esc(ch.title)} 화면">${hls}</div>
      <ol class="legend">${legend}</ol>
    </figure>
  </section>`;
    }).join('\n');

    const today = new Date().toISOString().slice(0, 10);
    const manual = doc('포인트라운지 사용설명서', `<div class="page">
  <header class="hero">
    <div class="brand"><span class="logo">P</span> 포인트라운지</div>
    <h1>사용설명서</h1>
    <p class="lede">활동할수록 <strong>포인트</strong>가 쌓이고, 포인트로 <strong>아바타가 성장</strong>하는
      커뮤니티 게시판이에요. 기존 알바채용 사이트에 <strong>커뮤니티 기능으로 삽입</strong>하는 것을 전제로 만들었습니다.</p>
    <p class="meta">작성일 ${today}</p>
  </header>

  <section class="box">
    <h3>접속 주소</h3>
    <p class="url"><a href="${SITE}">${SITE}</a></p>
    <p class="note">위 주소로 누구나 바로 접속해 확인할 수 있어요.
      (무료 서버라 한동안 접속이 없으면 잠들었다가, 첫 접속 시 깨어나는 데 30초쯤 걸릴 수 있어요 — 정상입니다.)</p>
  </section>

  <section class="box">
    <h3>데모 계정으로 로그인하세요</h3>
    <table>
      <tr><th>구분</th><th>아이디</th><th>비밀번호</th><th>확인할 수 있는 것</th></tr>
      <tr><td><span class="tag admin">운영자</span></td><td><code>admin</code></td><td><code>admin1234</code></td>
        <td>공지 등록 · 회원 제재 · 신고 관리 · 글 숨김 등 운영 기능</td></tr>
      <tr><td><span class="tag user">일반</span></td><td><code>gold</code></td><td><code>test1234</code></td>
        <td>포인트가 많은 계정 — 프리미엄 아바타까지 해금된 상태</td></tr>
      <tr><td><span class="tag user">일반</span></td><td><code>mint</code> <code>cherry</code> <code>street</code></td><td><code>test1234</code></td>
        <td>포인트가 서로 다른 회원들 (해금 단계 비교용)</td></tr>
    </table>
    <p class="note">공지·샘플 글이 이미 들어가 있어 바로 둘러볼 수 있어요.
      <strong>실제 삽입 시에는 이 로그인 화면이 사라지고 A사이트 계정을 그대로 씁니다</strong> — 자세한 내용은 연동가이드를 봐주세요.</p>
  </section>

  <p style="color:var(--muted);font-size:14px;margin:26px 2px 6px">
    아래 순서대로 화면을 따라가 보세요. 스크린샷의 <strong style="color:var(--coral)">붉은 숫자</strong>가 그 화면에서 눌러볼 기능이에요.</p>
${chapters}

  <h2 class="sec">기획서 대비 구현 현황</h2>
  <table>
    <tr><th>기획서 항목</th><th>구현</th></tr>
    <tr><td>포인트 6종 (가입 1,000 · 출석 100 · 일반글 300 · 익명글 100 · 댓글 100 · 추천받기 10)</td><td>완료</td></tr>
    <tr><td>하루 지급 한도 (글 3개 · 댓글 10개 · 출석 1회)</td><td>완료</td></tr>
    <tr><td>추가 보상 (인기글 1,000 · 운영자 추천 1,500 · 연속출석 3일 500 / 7일 1,000 / 30일 3,000)</td><td>완료</td></tr>
    <tr><td>익명글 규칙 (100P · 추천 버튼 비활성 · 추천 포인트 적립 불가)</td><td>완료</td></tr>
    <tr><td>아바타 무료 12종 → 스페셜 헤어 5,000P → 프리미엄 의상 10,000P → 움직이는 테두리 20,000P</td><td>완료</td></tr>
    <tr><td>이벤트 한정 아바타 (봄 · 크리스마스 · 할로윈)</td><td>완료 (해당 시즌에만 노출)</td></tr>
    <tr><td>게시글 내 점 3개 메뉴 (신고 / 수정·삭제 / 운영자 기능)</td><td>완료</td></tr>
    <tr><td>캐릭터는 예시와 다른 오리지널로</td><td>완료 (직접 제작)</td></tr>
    <tr><td>기존 사이트 계정으로 이용 (커뮤니티 별도 가입 없음)</td><td>완료 — 연동가이드 참고</td></tr>
  </table>

  <footer class="foot">포인트라운지 · 활동할수록 포인트가 쌓이고 아바타가 성장하는 커뮤니티</footer>
</div>`);

    fs.writeFileSync(path.join(DOCS, 'manual.html'), manual);
    console.log('  → docs/manual.html');

    // ---- 연동가이드 ---------------------------------------------------------
    const md = fs.readFileSync(path.join(DOCS, '연동가이드.md'), 'utf8');
    const firstBreak = md.indexOf('\n');
    const guide = doc('A사이트 연동 가이드', `<div class="page">
  <header class="hero">
    <div class="brand"><span class="logo">P</span> 포인트라운지</div>
    <h1>A사이트 연동 가이드</h1>
    <p class="lede">기존 알바채용 사이트에 이 커뮤니티를 붙일 때, <strong>회원이 다시 가입하지 않도록</strong>
      계정을 잇는 방법입니다. 개발 담당자분께 전달해 주세요.</p>
    <p class="meta">작성일 ${today}</p>
  </header>
${mdToHtml(md.slice(firstBreak))}
  <footer class="foot">문의 · 연동 방식이 달라도 <code>src/identity.js</code> 한 파일만 고치면 됩니다</footer>
</div>`);
    fs.writeFileSync(path.join(DOCS, '연동가이드.html'), guide);
    console.log('  → docs/연동가이드.html');

    // ---- PDF ----------------------------------------------------------------
    if (WANT_PDF) {
      const b = await chromium.launch({ executablePath: EXE });
      const ctx = await b.newContext();
      for (const [file, out] of [['manual.html', '포인트라운지_사용설명서.pdf'], ['연동가이드.html', '포인트라운지_연동가이드.pdf']]) {
        const pg = await ctx.newPage();
        await pg.goto('file://' + path.join(DOCS, file), { waitUntil: 'load' });
        await pg.emulateMedia({ media: 'print' });
        await pg.pdf({
          path: path.join(DOCS, out), format: 'A4', printBackground: true,
          margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
          displayHeaderFooter: true, headerTemplate: '<div></div>',
          footerTemplate: '<div style="width:100%;font-size:8px;color:#888;text-align:center;padding-top:4px">'
            + '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        });
        console.log(`  → docs/${out}`);
        await pg.close();
      }
      await b.close();
    }
  } finally {
    stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
