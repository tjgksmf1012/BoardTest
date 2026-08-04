// 테두리(고리)와 얼굴의 크기가 서로 맞는지
//
// 이 검사가 왜 있냐면:
// 고리 그림은 가운데가 뚫려 있어서, 고리를 얼굴보다 충분히 키우지 않으면
// 고리가 얼굴 위로 올라와 얼굴을 가로지른다. 그런데 그렇게 그려져도
// 화면에는 오류가 없고, 요소도 제자리에 있고, 흐름 검사·대비 검사도 전부 통과한다.
// 눈으로 봐야만 보이는 결함이라 실제로 배포까지 나갔다가 지적을 받았다.
//
// 그래서 '보이는 것'을 숫자로 바꿔서 검사한다.
// 고리 PNG 를 직접 읽어 구멍이 얼마나 뚫려 있는지 재고, 그 구멍이 얼굴보다 큰지 본다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const avatars = require('../src/avatars');
const DIR = path.join(__dirname, '..', 'public', 'avatars');
const borders = avatars.borders ? avatars.borders() : avatars.items().filter((i) => i.kind === 'border');

// 그림 한가운데에서 바깥으로 훑어, 처음 색이 나타나는 곳까지가 '구멍'이다.
// 여러 방향으로 재서 가운뎃값을 쓴다 (반짝이는 장식 몇 점에 휘둘리지 않게).
async function holeRatio(file) {
  const { data, info } = await sharp(path.join(DIR, file))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const cx = W / 2;
  const cy = H / 2;
  const solid = (x, y) => data[((y | 0) * W + (x | 0)) * C + 3] > 16;

  const found = [];
  for (let k = 0; k < 16; k++) {
    const t = (k * Math.PI) / 8;
    for (let r = 1; r < W / 2; r += 0.5) {
      const x = cx + Math.cos(t) * r;
      const y = cy + Math.sin(t) * r;
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      if (solid(x, y)) { found.push(r); break; }
    }
  }
  found.sort((a, b) => a - b);
  return (found[Math.floor(found.length / 2)] * 2) / W; // 지름 기준 비율
}

test('테두리 그림은 모두 가운데가 뚫린 고리다', async () => {
  assert.ok(borders.length > 0, '테두리가 하나도 없다');
  for (const b of borders) {
    assert.ok(fs.existsSync(path.join(DIR, b.file)), `${b.file} 이 없다`);
    const hole = await holeRatio(b.file);
    assert.ok(hole > 0.4 && hole < 0.8,
      `${b.code}: 구멍이 ${(hole * 100).toFixed(0)}% — 고리 모양이 아니거나 그림이 바뀌었다`);
  }
});

test('고리 구멍이 얼굴보다 커야 한다 (안 그러면 고리가 얼굴을 가로지른다)', async () => {
  const { RING, FACE } = avatars;
  for (const b of borders) {
    const hole = await holeRatio(b.file);
    const 구멍 = RING * hole; // 화면에서 구멍이 차지하는 폭 (칸 대비)
    assert.ok(구멍 >= FACE,
      `${b.code}: 고리를 ${RING}배로 그리면 구멍이 ${구멍.toFixed(2)} 인데`
      + ` 얼굴이 ${FACE} 라 ${((FACE - 구멍) / 2 * 100).toFixed(1)}% 씩 겹친다`);
  }
});

test('실측한 구멍 비율이 코드에 적어둔 값과 맞는다', async () => {
  let min = 1;
  for (const b of borders) min = Math.min(min, await holeRatio(b.file));
  assert.ok(Math.abs(min - avatars.RING_HOLE) < 0.03,
    `실측 최솟값 ${min.toFixed(3)} vs 코드의 RING_HOLE ${avatars.RING_HOLE}`
    + ' — 테두리 그림이 바뀌었으면 RING_HOLE 도 같이 고쳐야 한다');
});

test('크기는 CSS 가 아니라 요소에 직접 붙는다 (우선순위에 지지 않게)', () => {
  const chars = avatars.characters ? avatars.characters() : avatars.items().filter((i) => i.kind !== 'border');
  const html = avatars.renderAvatar(chars[0].code, borders[0].code, 44);
  assert.match(html, /class="avatar-ring"[^>]*style="width:132%/, '고리 크기가 붙어 있어야 한다');
  assert.match(html, /class="avatar-face"[^>]*style="width:76%/, '얼굴 크기가 붙어 있어야 한다');
  // 테두리를 안 낀 아바타는 예전처럼 칸을 꽉 채운다
  const plain = avatars.renderAvatar(chars[0].code, null, 44);
  assert.ok(!plain.includes('style="width:76%'), '고리가 없으면 얼굴을 줄이지 않는다');
});

test('테두리 칸에 나란히 놓을 때는 고리가 없어도 얼굴 크기를 맞춘다', () => {
  const chars = avatars.characters ? avatars.characters() : avatars.items().filter((i) => i.kind !== 'border');
  // 상점의 '사용 안 함' 칸만 테두리가 없어서 혼자 얼굴이 크게 나왔다 (72px 대 55px)
  const slot = avatars.renderAvatar(chars[0].code, null, 72, { ringSlot: true });
  assert.match(slot, /class="avatar-face"[^>]*style="width:76%/);
  assert.ok(!slot.includes('avatar-ring'), '고리를 넣으라는 뜻은 아니다');
  assert.ok(!slot.includes('has-ring'), '고리가 없으니 잘라내기는 그대로 둔다');
});
