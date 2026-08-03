// 캐릭터(아바타)·테두리 카탈로그 테스트
//
// 이미지는 코드가 아니라 public/avatars/manifest.json 에서 온다.
// 회원 유형별로 쓸 수 있는 것이 갈리므로 그 경계를 확인한다.
const test = require('node:test');
const assert = require('node:assert');
const avatars = require('../src/avatars');

const chars = avatars.characters();
const borders = avatars.borders();

test('받은 이미지가 카탈로그로 들어와 있다', () => {
  assert.ok(chars.length > 0, '캐릭터가 하나도 없다');
  assert.ok(borders.length > 0, '테두리가 하나도 없다');
  for (const it of avatars.items()) {
    assert.ok(it.code && it.file && it.thumb, `항목이 덜 찼다: ${JSON.stringify(it)}`);
  }
});

test('임시로 넣었던 캐릭터 코드는 남아 있지 않다', () => {
  const old = avatars.items().filter((i) => /^(basic|hair|outfit|event)-/.test(i.code));
  assert.deepEqual(old, [], '옛 임시 이미지가 카탈로그에 남아 있다');
});

test('회원 유형별로 캐릭터가 갈린다', () => {
  for (const t of ['male', 'venue']) {
    const list = avatars.characters(t);
    assert.ok(list.length > 0, `${t} 캐릭터가 없다`);
    assert.ok(list.every((i) => i.memberType === t));
  }
});

test('가입 시 남성·업소회원은 무작위로 하나 배정받는다', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(avatars.starterFor('male').assigned.code);
  assert.ok(seen.size > 1, '늘 같은 캐릭터만 준다 (무작위가 아니다)');
  for (const code of seen) assert.match(code, /^male-/);
});

test('무료로 주어지는 캐릭터는 유형당 5개까지', () => {
  for (const t of ['male', 'venue']) {
    const free = avatars.characters(t).filter((i) => i.price === 0);
    assert.ok(free.length <= avatars.FREE_PER_TYPE, `${t} 무료가 너무 많다: ${free.length}`);
  }
});

test('다른 유형의 캐릭터는 쓸 수 없다', () => {
  const male = { member_type: 'male', is_admin: 0 };
  const venueChar = avatars.characters('venue')[0];
  assert.equal(avatars.canUse(male, venueChar.code, new Set()), false);
  assert.equal(avatars.canUse(male, avatars.characters('male')[0].code, new Set()), true);
});

test('운영자 전용 캐릭터는 운영자만 쓸 수 있다', () => {
  const admin = avatars.items().find((i) => i.memberType === 'admin');
  if (!admin) return; // 이미지가 없으면 넘어간다
  assert.equal(avatars.canUse({ member_type: 'female', is_admin: 0 }, admin.code, new Set()), false);
  assert.equal(avatars.canUse({ member_type: 'female', is_admin: 1 }, admin.code, new Set()), true);
});

test('값이 있는 항목은 사야 쓸 수 있다', () => {
  const paid = avatars.items().find((i) => i.price > 0 && i.kind === 'border');
  assert.ok(paid, '유료 항목이 있어야 한다');
  const me = { member_type: 'female', is_admin: 0 };
  assert.equal(avatars.canUse(me, paid.code, new Set()), false, '사기 전에는 못 쓴다');
  assert.equal(avatars.canUse(me, paid.code, new Set([paid.code])), true, '사면 쓸 수 있다');
});

test('캐릭터는 이미지 태그로, 테두리는 그 위에 겹쳐 그린다', () => {
  const code = chars[0].code;
  const plain = avatars.renderAvatar(code, null, 44);
  assert.match(plain, /<img src="\/avatars\//);
  assert.ok(!plain.includes('avatar-ring'), '테두리를 안 골랐으면 고리도 없다');

  const ringed = avatars.renderAvatar(code, borders[0].code, 44);
  assert.match(ringed, /class="avatar-ring"/);
});

test('작은 크기에는 썸네일을 쓴다', () => {
  const c = chars[0];
  assert.ok(avatars.renderAvatar(c.code, null, 34).includes(c.thumb), '작을 때는 썸네일');
  assert.ok(avatars.renderAvatar(c.code, null, 96).includes(c.file), '클 때는 원본');
});

test('없는 코드를 넣어도 화면이 깨지지 않는다', () => {
  const html = avatars.renderAvatar('없는코드', '없는테두리', 44);
  assert.match(html, /class="avatar"/);
  assert.ok(!html.includes('avatar-ring'), '없는 테두리는 그리지 않는다');
});
