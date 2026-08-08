// 드리는 PHP 가 지금 프로그램과 같은 규칙으로 도는지
//
// 포인트 금액이나 한도를 고칠 때 src/points.js 만 고치고 이식용/lib/cm_config.php 를
// 안 고치면, 두 쪽이 조용히 달라진다. 오류도 안 나고 화면도 멀쩡해서 아무도 모른다.
// 선배님이 붙이신 뒤에 "포인트가 기획서랑 다른데요" 소리를 듣게 된다.
//
// 그래서 PHP 파일을 글자로 읽어서 값만 뽑아 견준다.
// PHP 를 실행하지 않고도 되고, PHP 가 안 깔린 곳에서도 돌아간다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { RULES, MILESTONES } = require('../src/points');
const avatars = require('../src/avatars');

const CONFIG = fs.readFileSync(
  path.join(__dirname, '..', '이식용', 'lib', 'cm_config.php'), 'utf8');
const AVATAR_PHP = fs.readFileSync(
  path.join(__dirname, '..', '이식용', 'lib', 'cm_avatar.php'), 'utf8');

// $CM['rules'] 에서 사유별 금액·한도를 뽑는다
function phpRules() {
  const out = {};
  const block = CONFIG.match(/\$CM\['rules'\]\s*=\s*array\(([\s\S]*?)\n\);/);
  assert.ok(block, "cm_config.php 에서 $CM['rules'] 를 못 찾았어요");
  for (const line of block[1].split('\n')) {
    const m = line.match(
      /'(\w+)'\s*=>\s*array\(\s*'amount'\s*=>\s*(-?\d+).*?'limit'\s*=>\s*(\d+)/);
    if (m) out[m[1]] = { amount: Number(m[2]), limit: Number(m[3]) };
  }
  return out;
}

test('포인트 금액과 하루 한도가 양쪽에서 같다', () => {
  const P = phpRules();
  for (const [reason, r] of Object.entries(RULES)) {
    assert.ok(P[reason], `PHP 쪽에 '${reason}' 규칙이 없어요`);
    assert.strictEqual(P[reason].amount, r.amount,
      `'${reason}' 금액이 다릅니다 — 지금 프로그램 ${r.amount}P, PHP ${P[reason].amount}P`);
    assert.strictEqual(P[reason].limit, r.dailyLimit || 0,
      `'${reason}' 하루 한도가 다릅니다 — 지금 ${r.dailyLimit || 0}회, PHP ${P[reason].limit}회`);
  }
  for (const reason of Object.keys(P)) {
    assert.ok(RULES[reason], `PHP 에만 있는 규칙이 있어요: '${reason}'`);
  }
});

test('연속 출석 보너스 날짜가 양쪽에서 같다', () => {
  const m = CONFIG.match(/\$CM\['streak_days'\]\s*=\s*array\(([\s\S]*?)\);/);
  assert.ok(m, "cm_config.php 에서 $CM['streak_days'] 를 못 찾았어요");
  const phpDays = [...m[1].matchAll(/(\d+)\s*=>/g)].map((x) => Number(x[1]));
  const nodeDays = MILESTONES.map((x) => x.days);
  assert.deepStrictEqual(phpDays, nodeDays,
    `보너스 주는 날이 다릅니다 — 지금 ${nodeDays}, PHP ${phpDays}`);
});

test('캐릭터·테두리 값이 양쪽에서 같다', () => {
  const num = (key) => {
    const m = CONFIG.match(new RegExp(`\\$CM\\['${key}'\\]\\s*=\\s*(\\d+)`));
    assert.ok(m, `cm_config.php 에서 ${key} 를 못 찾았어요`);
    return Number(m[1]);
  };
  assert.strictEqual(num('price_character'), avatars.CHARACTER_PRICE, '캐릭터 값이 다릅니다');
  assert.strictEqual(num('price_border'), avatars.BORDER_PRICE, '테두리 값이 다릅니다');
});

test('고리와 얼굴 크기가 양쪽에서 같다', () => {
  // 이게 어긋나서 실제로 문제가 됐다. Node 를 1.34 로 고치고 PHP 를 120 으로 두면
  // 선배님 사이트에서만 캐릭터가 고리 밖으로 삐져나온다.
  const ring = Number((AVATAR_PHP.match(/define\('CM_RING',\s*(\d+)\)/) || [])[1]);
  const face = Number((AVATAR_PHP.match(/define\('CM_FACE',\s*(\d+)\)/) || [])[1]);
  assert.strictEqual(ring, Math.round(avatars.RING * 100),
    `고리 크기가 다릅니다 — 지금 ${Math.round(avatars.RING * 100)}%, PHP ${ring}%`);
  assert.strictEqual(face, Math.round(avatars.FACE * 100),
    `얼굴 크기가 다릅니다 — 지금 ${Math.round(avatars.FACE * 100)}%, PHP ${face}%`);
});

// 숫자가 코드에 하나, 문서에 또 하나 적혀 있으면 한쪽만 고쳤을 때 문서가 거짓말을 한다.
// 선배님은 코드가 아니라 문서를 보고 옮기시므로, 틀린 쪽이 그대로 이식된다.
// 실제로 한 쪽 글 수를 10 에서 15 로 바꿀 때 문서를 같이 고쳐야 했다.
const BOARD = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'board.js'), 'utf8');
const USER = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'user.js'), 'utf8');
const 읽기 = (src, name) => {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`));
  assert.ok(m, `코드에서 ${name} 를 못 찾았어요`);
  return Number(m[1]);
};
const 문서 = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('한 쪽 글 수가 코드와 문서에서 같다', () => {
  const n = 읽기(BOARD, 'PAGE_SIZE');
  assert.match(문서('docs/DESIGN.md'), new RegExp(`한 쪽 ${n}개`),
    `DESIGN.md 가 '한 쪽 ${n}개' 라고 안 적혀 있어요 (코드는 ${n})`);
});

test('베스트댓글 기준이 코드와 문서에서 같다', () => {
  const likes = 읽기(BOARD, 'BEST_COMMENT_LIKES');
  const max = 읽기(BOARD, 'BEST_COMMENT_MAX');
  assert.match(문서('README.md'),
    new RegExp(`좋아요 ${likes}개 이상\\*\\*인 댓글 중 \\*\\*딱 ${max}개`),
    `README 의 베스트댓글 기준이 코드와 달라요 (코드는 ${likes}개 이상 · ${max}개)`);
  assert.match(문서('docs/DESIGN.md'), new RegExp(`좋아요 ${likes}↑ 중 상위 ${max}개`),
    `DESIGN.md 의 베스트댓글 기준이 코드와 달라요 (코드는 ${likes}개 이상 · 상위 ${max}개)`);
});

test('랭킹 인원이 코드·화면·문서에서 같다', () => {
  const n = 읽기(USER, 'RANK_LIMIT');
  // 화면 안내문은 값을 박아 두지 말고 코드에서 받아 써야 한다
  const view = 문서('views/ranking.ejs');
  assert.match(view, /TOP <%= rankLimit %>/,
    '랭킹 화면 안내문에 숫자가 박혀 있어요 — rankLimit 을 받아 쓰게 해주세요');
  for (const f of ['README.md', 'docs/DESIGN.md']) {
    assert.match(문서(f), new RegExp(`TOP ${n}`), `${f} 의 랭킹 인원이 코드와 달라요 (코드는 ${n})`);
  }
});

test('캐릭터 목록이 양쪽에서 같다', () => {
  // 캐릭터목록.php 는 자동으로 만들지만, 이미지를 늘리고 다시 안 만들면 어긋난다.
  const list = fs.readFileSync(
    path.join(__dirname, '..', '이식용', '캐릭터목록.php'), 'utf8');
  const phpCodes = [...list.matchAll(/'code'\s*=>\s*'([^']+)'/g)].map((m) => m[1]);
  const nodeCodes = avatars.items().map((i) => i.code);
  assert.strictEqual(phpCodes.length, nodeCodes.length,
    `개수가 다릅니다 — 지금 ${nodeCodes.length}개, PHP ${phpCodes.length}개`);
  const missing = nodeCodes.filter((c) => !phpCodes.includes(c));
  assert.deepStrictEqual(missing, [], `PHP 목록에 빠진 캐릭터: ${missing.slice(0, 5)}`);
});
