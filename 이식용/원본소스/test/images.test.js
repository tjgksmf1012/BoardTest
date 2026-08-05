// 업로드 사진 다듬기 테스트 (크기 축소 · 부가정보 제거 · 회전 보정)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const { saveProcessed, extFor, MAX_EDGE } = require('../src/images');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boardtest-img-'));
const out = (name) => path.join(tmp, name);

test('저장 형식은 올린 형식을 그대로 따른다', () => {
  assert.equal(extFor('image/png'), '.png');
  assert.equal(extFor('image/jpeg'), '.jpg');
});

test('큰 사진은 긴 변 기준으로 줄어든다', async () => {
  const big = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: { r: 180, g: 120, b: 90 } } })
    .jpeg({ quality: 92 }).toBuffer();

  const r = await saveProcessed(big, out('big.jpg'), 'image/jpeg');
  assert.equal(r.width, MAX_EDGE);
  assert.equal(r.height, Math.round(MAX_EDGE * 3024 / 4032));
  assert.ok(r.after < r.before, `용량이 줄어야 한다 (${r.before} → ${r.after})`);
});

test('작은 사진은 억지로 늘리지 않는다', async () => {
  const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 80, g: 160, b: 200 } } })
    .jpeg().toBuffer();
  const r = await saveProcessed(small, out('small.jpg'), 'image/jpeg');
  assert.equal(r.width, 300);
  assert.equal(r.height, 200);
});

test('촬영 정보(EXIF·GPS)는 저장하지 않는다', async () => {
  const withExif = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 10, b: 10 } } })
    .withExif({ IFD0: { Make: '테스트폰', Model: 'X1' } })
    .jpeg().toBuffer();
  assert.ok((await sharp(withExif).metadata()).exif, '원본에는 촬영 정보가 있다');

  await saveProcessed(withExif, out('exif.jpg'), 'image/jpeg');
  const meta = await sharp(out('exif.jpg')).metadata();
  assert.ok(!meta.exif, '저장된 사진에는 촬영 정보가 남으면 안 된다 (위치 노출 방지)');
});

test('세로로 찍은 사진이 눕지 않는다', async () => {
  // orientation 6 = 화면에서는 세로(800x1200)로 보여야 하는 사진
  const rotated = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 100, b: 100 } } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();

  const r = await saveProcessed(rotated, out('rot.jpg'), 'image/jpeg');
  assert.equal(r.width, 800, '회전이 실제 픽셀에 반영돼야 한다');
  assert.equal(r.height, 1200);
  const meta = await sharp(out('rot.jpg')).metadata();
  assert.ok(!meta.orientation || meta.orientation === 1, '방향 정보에 기대지 않아야 한다');
});

test('PNG는 PNG로 저장된다 (스크린샷 글자가 뭉개지지 않도록)', async () => {
  const png = await sharp({ create: { width: 2400, height: 1400, channels: 3, background: { r: 250, g: 250, b: 250 } } })
    .png().toBuffer();
  const r = await saveProcessed(png, out('shot.png'), 'image/png');
  assert.equal(r.width, MAX_EDGE);
  assert.equal((await sharp(out('shot.png')).metadata()).format, 'png');
});

test('이미지가 아닌 파일은 오류로 처리된다', async () => {
  await assert.rejects(
    () => saveProcessed(Buffer.from('이건 이미지가 아님'), out('bad.jpg'), 'image/jpeg')
  );
});
