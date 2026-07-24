// 아바타 이미지 오버라이드 로직 테스트
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { renderAvatar, scanAvatarImages } = require('../src/avatars');
const IMG_DIR = path.join(__dirname, '..', 'public', 'avatars');
const testFile = path.join(IMG_DIR, 'basic-01.png');

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('이미지 파일이 있으면 <img>로, 없으면 <svg>로 렌더링된다', () => {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.writeFileSync(testFile, PNG);
  try {
    scanAvatarImages();
    const withImg = renderAvatar('basic-01', null, 44);
    assert.match(withImg, /<img src="\/avatars\/basic-01\.png"/);
    assert.ok(!withImg.includes('<svg'));

    const withSvg = renderAvatar('basic-02', null, 44);
    assert.ok(withSvg.includes('<svg'));
    assert.ok(!withSvg.includes('<img'));
  } finally {
    fs.rmSync(testFile, { force: true });
    scanAvatarImages(); // 원상복구
  }
});

test('알 수 없는 파일명은 무시된다', () => {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const junk = path.join(IMG_DIR, 'not-an-avatar.png');
  fs.writeFileSync(junk, PNG);
  try {
    scanAvatarImages();
    // 유효 아바타가 아니므로 여전히 SVG 폴백
    assert.ok(renderAvatar('basic-01', null, 44).includes('<svg'));
  } finally {
    fs.rmSync(junk, { force: true });
    scanAvatarImages();
  }
});
