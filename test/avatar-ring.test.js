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
//
// 다만 이 검사에는 한계가 있다. PNG 의 알파값을 재는 것이라 '알파가 남아 있지만
// 눈에는 안 보이는' 흐린 가장자리까지 고리로 친다. 그래서 여기를 통과하고도
// 화면에는 흰 띠가 남은 적이 있다. 실제로 그려진 픽셀을 재는 검사는 따로 있다 —
//   npm run ring   (scripts/check-ring.js)
// 이 파일은 '그림이 바뀌었는지' 를 지키고, 저쪽이 '화면에서 딱 붙는지' 를 지킨다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const avatars = require('../src/avatars');
const DIR = path.join(__dirname, '..', 'public', 'avatars');
const borders = avatars.borders ? avatars.borders() : avatars.items().filter((i) => i.kind === 'border');

// 그림 한가운데에서 바깥으로 훑어, 처음 색이 나타나는 곳까지가 '구멍'이다.
//
// 구멍은 동그랗지 않다. 붓으로 휘갈긴 고리라 안쪽 경계가 울퉁불퉁하고,
// 반짝이 몇 점은 훨씬 안쪽까지 뻗어 있다. 그래서 두 값을 따로 돌려준다.
//   mid — 고리 몸통의 안쪽 (가운뎃값). 이게 얼굴을 물면 눈에 확 띈다.
//   min — 가장 안쪽까지 뻗은 점. 여기까지 피하려면 얼굴이 절반이 되어야 한다.
// 처음에는 mid 만 보고 기준을 세웠는데, 그래서 '얼굴 가장자리를 고리가 무는' 상태가
// 검사를 통과했다. 실제로 상점에서 아홉 개를 나란히 놓으니 눈에 띄어 지적을 받았다.
async function holeRatio(file) {
  const { data, info } = await sharp(path.join(DIR, file))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const cx = W / 2;
  const cy = H / 2;
  const solid = (x, y) => data[((y | 0) * W + (x | 0)) * C + 3] > 16;

  const found = [];
  for (let k = 0; k < 64; k++) {
    const t = (k * Math.PI) / 32;
    for (let r = 1; r < W / 2; r += 0.5) {
      const x = cx + Math.cos(t) * r;
      const y = cy + Math.sin(t) * r;
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      if (solid(x, y)) { found.push(r); break; }
    }
  }
  // 바깥 경계. 여기도 두 가지다 — 붓터치 본체의 바깥(가운뎃값)과,
  // 바깥으로 튀어 나간 반짝이 몇 점(최댓값). 칸에 맞추는 기준은 본체다.
  const outer = [];
  for (let k = 0; k < 64; k++) {
    const t = (k * Math.PI) / 32;
    let last = 0;
    for (let r = 1; r < W / 2; r += 0.5) {
      const x = cx + Math.cos(t) * r;
      const y = cy + Math.sin(t) * r;
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      if (solid(x, y)) last = r;
    }
    if (last) outer.push(last);
  }
  found.sort((a, b) => a - b);
  outer.sort((a, b) => a - b);
  return {
    mid: (found[Math.floor(found.length / 2)] * 2) / W, // 고리 몸통 안쪽 (지름 비율)
    min: (found[0] * 2) / W,                            // 가장 안쪽까지 뻗은 붓터치
    edge: (outer[Math.floor(outer.length / 2)] * 2) / W, // 고리 몸통 바깥 (가운뎃값)
    edgeMin: (outer[0] * 2) / W,                          // 고리가 가장 가늘어지는 곳의 바깥
    edgeMax: (outer[outer.length - 1] * 2) / W,           // 밖으로 튄 반짝이 끝
  };
}

test('테두리 그림은 모두 가운데가 뚫린 고리다', async () => {
  assert.ok(borders.length > 0, '테두리가 하나도 없다');
  for (const b of borders) {
    assert.ok(fs.existsSync(path.join(DIR, b.file)), `${b.file} 이 없다`);
    const { mid } = await holeRatio(b.file);
    assert.ok(mid > 0.4 && mid < 0.8,
      `${b.code}: 구멍이 ${(mid * 100).toFixed(0)}% — 고리 모양이 아니거나 그림이 바뀌었다`);
  }
});

test('캐릭터 테두리가 고리 몸통 위에 온다 (가이드처럼 고리가 얹히게)', async () => {
  // 가이드의 '움직이는 테두리' 는 고리가 캐릭터 **바깥에 떨어져** 있지 않고
  // 캐릭터 원의 가장자리 **위에 얹혀** 있다.
  // 너무 안쪽이면 사이가 벌어져 흰 띠가 보이고, 너무 바깥이면 고리가 뒤로 숨는다.
  const { RING, FACE } = avatars;
  for (const b of borders) {
    const { mid, edge } = await holeRatio(b.file);
    const 안쪽 = RING * mid;
    const 바깥 = RING * edge;
    const 자리 = (FACE - 안쪽) / (바깥 - 안쪽); // 몸통의 몇 % 지점인가
    assert.ok(자리 >= 0.2 && 자리 <= 0.9,
      `${b.code}: 캐릭터 테두리(${FACE})가 고리 몸통(${안쪽.toFixed(2)}~${바깥.toFixed(2)})의`
      + ` ${(자리 * 100).toFixed(0)}% 지점이다`
      + (자리 < 0.2 ? ' — 사이가 벌어져 흰 띠가 보인다' : ' — 고리가 캐릭터 뒤로 숨는다'));
  }
});

test('고리가 칸 밖으로 나가지 않는다 (목록에서 글 제목을 밀지 않게)', async () => {
  const { RING } = avatars;
  for (const b of borders) {
    const { edge } = await holeRatio(b.file);
    const 바깥 = RING * edge;
    // 고리는 붓으로 휘갈긴 것이라 바깥선이 울퉁불퉁하다. 얼굴이 안 새게 하려면
    // 가장 가는 쪽을 얼굴 밖으로 밀어야 하고, 그러면 가장 굵은 쪽은 칸을 넘는다.
    // 넘는 것 자체는 괜찮다. 목록에서 옆 글자에 닿지만 않으면 된다.
    //
    // 목록 아바타는 44px 이고 글 제목까지 간격이 16px 이다.
    // 한쪽으로 8px (간격의 절반) 까지만 나가게 잡으면 1 + 2×8/44 = 1.36 이다.
    assert.ok(바깥 <= 1.20,
      `${b.code}: 고리 몸통이 칸의 ${(바깥 * 100).toFixed(0)}% 라 너무 크다`);
    assert.ok(바깥 >= 0.95,
      `${b.code}: 고리 몸통이 칸의 ${(바깥 * 100).toFixed(0)}% 뿐이라 칸이 헐겁다`);
    const { edgeMax } = await holeRatio(b.file);
    assert.ok(RING * edgeMax <= 1.36,
      `${b.code}: 반짝이가 칸의 ${(RING * edgeMax * 100).toFixed(0)}% 까지 뻗어 옆 글자에 닿는다`);
  }
});

test('얼굴이 고리 바깥으로 삐져나오지 않는다', async () => {
  // 이번에 놓친 것이 이것이다.
  //
  // 위 검사들은 고리 바깥선의 **가운뎃값·최댓값**만 봤다. 그래서 '고리가 칸을 꽉 채운다'는
  // 통과했는데, 고리가 **가장 가늘어지는 쪽**에서는 바깥선이 얼굴보다 안쪽이었다.
  // 그 각도에서 캐릭터의 머리와 어깨가 고리 밖으로 새어 나왔다.
  // 상점에서 72px 로 크게 놓고 보니 눈에 띄었다.
  //
  // 가운뎃값이 아니라 **최솟값**으로 봐야 한다.
  const { RING, FACE } = avatars;
  for (const b of borders) {
    const { edgeMin } = await holeRatio(b.file);
    const 고리바깥_가장가는쪽 = RING * edgeMin;
    assert.ok(FACE <= 고리바깥_가장가는쪽,
      `${b.code}: 고리가 가장 가는 쪽 바깥선이 칸의 ${(고리바깥_가장가는쪽 * 100).toFixed(0)}% 인데`
      + ` 얼굴이 ${(FACE * 100).toFixed(0)}% 라 그만큼 밖으로 나온다`);
  }
});

test('실측한 구멍 비율이 코드에 적어둔 값과 맞는다', async () => {
  let mid = 1;
  let min = 1;
  for (const b of borders) {
    const h = await holeRatio(b.file);
    mid = Math.min(mid, h.mid);
    min = Math.min(min, h.min);
  }
  assert.ok(Math.abs(mid - avatars.RING_HOLE) < 0.03,
    `몸통 안쪽 실측 ${mid.toFixed(3)} vs 코드의 RING_HOLE ${avatars.RING_HOLE}`
    + ' — 테두리 그림이 바뀌었으면 값도 같이 고쳐야 한다');
  assert.ok(Math.abs(min - avatars.RING_HOLE_MIN) < 0.03,
    `붓터치 끝 실측 ${min.toFixed(3)} vs 코드의 RING_HOLE_MIN ${avatars.RING_HOLE_MIN}`);

  let edge = 0;
  for (const b of borders) edge = Math.max(edge, (await holeRatio(b.file)).edge);
  assert.ok(Math.abs(edge - avatars.RING_EDGE) < 0.03,
    `고리 바깥 실측 ${edge.toFixed(3)} vs 코드의 RING_EDGE ${avatars.RING_EDGE}`);
});

test('크기는 CSS 가 아니라 요소에 직접 붙는다 (우선순위에 지지 않게)', () => {
  const chars = avatars.characters ? avatars.characters() : avatars.items().filter((i) => i.kind !== 'border');
  const html = avatars.renderAvatar(chars[0].code, borders[0].code, 44);
  assert.match(html, /class="avatar-ring"[^>]*style="width:134%/, '고리 크기가 붙어 있어야 한다');
  assert.match(html, /class="avatar-face"[^>]*style="width:92%/, '얼굴 크기가 붙어 있어야 한다');
  // 테두리를 안 낀 아바타는 예전처럼 칸을 꽉 채운다
  const plain = avatars.renderAvatar(chars[0].code, null, 44);
  assert.ok(!plain.includes('style="width:92%'), '고리가 없으면 얼굴을 줄이지 않는다');
});

test('테두리 칸에 나란히 놓을 때는 고리가 없어도 얼굴 크기를 맞춘다', () => {
  const chars = avatars.characters ? avatars.characters() : avatars.items().filter((i) => i.kind !== 'border');
  // 상점의 '사용 안 함' 칸만 테두리가 없어서 혼자 얼굴이 크게 나왔다 (72px 대 55px)
  const slot = avatars.renderAvatar(chars[0].code, null, 72, { ringSlot: true });
  assert.match(slot, /class="avatar-face"[^>]*style="width:92%/);
  assert.ok(!slot.includes('avatar-ring'), '고리를 넣으라는 뜻은 아니다');
  assert.ok(!slot.includes('has-ring'), '고리가 없으니 잘라내기는 그대로 둔다');
});
