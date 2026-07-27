// 아바타 이미지 오버라이드 로직 테스트
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { renderAvatar, scanAvatarImages } = require('../src/avatars');
const IMG_DIR = path.join(__dirname, '..', 'public', 'avatars');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// 실제 이미지가 아직 없는 상위 아바타에 임시 파일을 넣어 오버라이드 동작만 검증한다.
// (basic-* 는 실제 이미지가 커밋돼 있으므로 건드리지 않는다 — 테스트가 실파일을 지우면 안 됨)
test('이미지 파일이 있으면 <img>로, 없으면 <svg>로 렌더링된다', () => {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const tmp = path.join(IMG_DIR, 'outfit-01.png');
  const preexisting = fs.existsSync(tmp);
  fs.writeFileSync(tmp, PNG);
  try {
    scanAvatarImages();
    const withImg = renderAvatar('outfit-01', null, 44);
    assert.match(withImg, /<img src="\/avatars\/outfit-01\.png"/);
    assert.ok(!withImg.includes('<svg'));

    // 이미지가 없는 아바타는 벡터(SVG)로 폴백
    const withSvg = renderAvatar('event-halloween', null, 44);
    assert.ok(withSvg.includes('<svg'));
    assert.ok(!withSvg.includes('<img'));
  } finally {
    if (!preexisting) fs.rmSync(tmp, { force: true });
    scanAvatarImages(); // 원상복구
  }
});

test('알 수 없는 파일명은 무시된다', () => {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const junk = path.join(IMG_DIR, 'not-an-avatar.png');
  fs.writeFileSync(junk, PNG);
  try {
    scanAvatarImages();
    // 유효 아바타가 아니므로 이미지가 없는 아바타는 여전히 SVG 폴백
    assert.ok(renderAvatar('event-halloween', null, 44).includes('<svg'));
  } finally {
    fs.rmSync(junk, { force: true });
    scanAvatarImages();
  }
});
