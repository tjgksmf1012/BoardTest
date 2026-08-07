// 캐릭터(아바타)·테두리 카탈로그
//
// 이미지는 코드에 박아두지 않고 public/avatars/manifest.json 을 읽는다.
// scripts/import-avatars.js 로 새 이미지를 넣으면 코드를 고치지 않아도 늘어난다.
// (기획서상 캐릭터가 9종 × 스타일 25종 = 225장까지 늘어날 수 있어 그렇게 만들었다)
//
// 회원 유형
//   female / male / venue : 그 유형의 회원에게만 배정·판매되는 캐릭터
//   anon                  : 익명 글에 쓰는 고정 캐릭터
//   admin                 : 운영자 전용
const fs = require('fs');
const path = require('path');

const AVATAR_IMG_DIR = path.join(__dirname, '..', 'public', 'avatars');
// 이미지 제공 경로. 기본은 로컬 정적 폴더(/avatars).
// 읽기전용 서버리스에선 외부(GitHub raw 등) 주소로 대체할 수 있다.
const AVATAR_BASE_URL = (process.env.AVATAR_BASE_URL || '/avatars').replace(/\/$/, '');

const MEMBER_TYPES = {
  female: { label: '여성회원', pick: true },   // 가입 시 직접 고른다
  male:   { label: '남성회원', pick: false },  // 가입 시 무작위로 받는다
  venue:  { label: '업소회원', pick: false },
};

// 가입 시 무료로 주어지는 캐릭터 수 (나머지는 포인트로 산다)
const FREE_PER_TYPE = 5;
// 캐릭터 한 개 가격 (기획 시안의 2,000P)
const CHARACTER_PRICE = 2000;
const BORDER_PRICE = 20000;

let ITEMS = [];
let byCode = new Map();

function load() {
  try {
    ITEMS = JSON.parse(fs.readFileSync(path.join(AVATAR_IMG_DIR, 'manifest.json'), 'utf8'));
  } catch {
    ITEMS = []; // 이미지를 아직 안 넣은 상태
  }
  // 값 매기기.
  //  - manifest 에 free 가 적혀 있으면 그 말을 따른다
  //    (여성회원은 "청순 내츄럴 맨 아랫줄 5종"이 무료라 순번으로는 못 고른다)
  //  - 안 적혀 있으면 유형 안에서 앞 FREE_PER_TYPE개를 무료로 둔다
  const seen = new Map();
  const marked = new Set(ITEMS.filter((i) => i.free).map((i) => i.memberType));
  for (const it of ITEMS) {
    const n = (seen.get(it.memberType) || 0) + 1;
    seen.set(it.memberType, n);
    it.index = n;
    if (it.kind === 'border') it.price = BORDER_PRICE;
    else if (it.memberType === 'anon' || it.memberType === 'admin') it.price = 0;
    else if (marked.has(it.memberType)) it.price = it.free ? 0 : CHARACTER_PRICE;
    else it.price = n <= FREE_PER_TYPE ? 0 : CHARACTER_PRICE;
  }
  byCode = new Map(ITEMS.map((i) => [i.code, i]));
}
load();

const characters = (type) => ITEMS.filter((i) => i.kind === 'character' && (!type || i.memberType === type));
const borders = () => ITEMS.filter((i) => i.kind === 'border');
const get = (code) => byCode.get(code) || null;

// 기본 캐릭터 한 줄 소개. 시안의 상세 화면 머리에 들어간다.
// 이미지에서 뽑아낼 수 없는 값이라 여기에 적어 둔다 (테마가 늘면 한 줄씩 추가).
const THEME_NOTES = {
  purenatural: '꾸미지 않은 듯 단정한, 어디에나 어울리는 기본 스타일',
  lovelypink:  '분홍빛 소품과 리본이 어우러진 사랑스러운 스타일',
  freshmint:   '민트빛 옷차림이 시원하고 산뜻한 스타일',
  dreamypurple: '별빛과 보랏빛이 감도는 몽환적인 스타일',
  glamgold:    '금빛 드레스와 조명이 화려한 파티 스타일',
  redqueen:    '붉은 왕관과 레이스가 강렬한 스타일',
  chicblack:   '검정으로 맞춘 도시적이고 시크한 스타일',
  hipstreet:   '캡모자와 그래피티가 어울리는 힙한 스트릿 스타일',
  gray:        '흑백 톤으로 차분하게 정리한 스타일',
};

// 포인트샵 1차 목록: 캐릭터를 테마(기획서의 "기본 캐릭터 9종")로 묶는다.
// 한 테마 안에 헤어 5종 × 의상 5종 = 25종이 들어 있어 2차 화면에서 고른다.
// 테마 없이 낱장으로 온 유형(남성·업소)은 한 칸에 하나씩 그대로 놓는다.
function themes(type) {
  const out = [];
  const byTheme = new Map();
  for (const it of characters(type)) {
    if (!it.themeCode) {
      out.push({ code: it.code, name: it.name, cover: it, items: [it], single: true });
      continue;
    }
    let t = byTheme.get(it.themeCode);
    if (!t) {
      t = { code: it.themeCode, name: it.theme, cover: it, items: [], single: false,
        note: THEME_NOTES[it.themeCode] || '' };
      byTheme.set(it.themeCode, t);
      out.push(t);
    }
    t.items.push(it);
  }
  return out;
}

const theme = (type, code) => themes(type).find((t) => t.code === code) || null;

// 익명 글·기본값에 쓸 캐릭터 (이미지가 하나도 없으면 null)
function fallback(type) {
  return characters(type)[0] || characters('anon')[0] || characters()[0] || null;
}

// 가입할 때 줄 캐릭터.
// 남성·업소회원은 무작위로 하나 배정하고, 여성회원은 고를 수 있게 후보를 돌려준다.
function starterFor(memberType) {
  const list = characters(memberType).filter((i) => i.price === 0);
  if (list.length === 0) return { assigned: fallback(memberType), choices: [] };
  const info = MEMBER_TYPES[memberType];
  if (info && info.pick) return { assigned: list[0], choices: list };
  return { assigned: list[Math.floor(Math.random() * list.length)], choices: [] };
}

// 그 회원이 이 항목을 쓸 수 있는가.
// 무료로 주어지는 것 + 산 것(owned) 만 쓸 수 있고, 유형이 다르면 애초에 후보가 아니다.
function canUse(user, code, owned) {
  const it = get(code);
  if (!it) return false;
  if (it.memberType === 'admin') return !!user.is_admin;
  if (it.memberType === 'anon') return false;                    // 익명 전용은 장착 대상이 아니다
  if (it.kind === 'character' && it.memberType !== user.member_type) return false;
  if (it.price === 0) return true;
  return !!(owned && owned.has(code));
}

// ---- 화면 출력 ---------------------------------------------------------------
const url = (file) => `${AVATAR_BASE_URL}/${encodeURIComponent(file)}`;

// 게시글·댓글 옆에 붙는 캐릭터. 테두리가 있으면 위에 겹쳐 그린다.
// 썸네일은 96px 이다. 그보다 작게 그릴 자리에 원본(256px)을 내보내면
// 캐릭터 25칸짜리 상점에서만 1MB 가까이 나간다 (썸네일이면 200KB 남짓).
const THUMB_UP_TO = 96;

// 테두리(고리)를 낀 아바타의 크기 규칙.
//
// 기획 시안(A사이트 아바타 해금 가이드, 4번 '움직이는 테두리')이 기준이다.
// 거기서는 고리 안쪽이 캐릭터에 **딱 붙어** 있다 — 사이에 틈도 없고 얼굴을 덮지도 않는다.
// 그리고 고리 전체가 자기 칸 안에 들어가 있다.
//
// 받은 테두리 그림 9종을 실측하면 (test/avatar-ring.test.js 가 PNG 를 직접 잰다):
//   고리 몸통 안쪽 = 그림 폭의 0.613   (RING_HOLE)
//   고리 바깥      = 그림 폭의 0.816   (RING_EDGE — 나머지는 투명 여백이다)
//   가장 안쪽까지 뻗은 붓터치 = 0.477  (RING_HOLE_MIN)
//
// 그래서 두 값을 이렇게 잡는다.
//   ① 고리가 얼굴의 자른 자국 위에 얹힌다 → RING = 1.28
//   ② 캐릭터 원의 테두리가 고리 몸통 **위에** 온다 → FACE = 0.92
//
// ①은 두 번 틀렸다. 지나온 값과 그때 들은 말은 이렇다.
//
//   1.20  "캐릭터가 테두리 밖으로 삐져나온다"
//   1.34  "테두리가 아직도 안 맞는다"
//   1.28  지금 값
//
// 두 번 다 '고리 그림 하나만' 재서 정했다. 처음에는 바깥선의 가운뎃값(0.816)으로
// 1/0.816 = 1.20, 다음에는 최솟값(0.691)으로 0.92/0.691 = 1.34.
// 계산은 맞는데 화면은 계속 틀렸다. 재는 대상이 틀렸기 때문이다.
//
// 이 고리는 실이 여러 가닥인 그림이다. '안쪽 ~ 바깥' 을 한 덩어리로 보면
// 그 사이가 꽉 찬 줄 알게 되는데 실제로는 가닥 사이가 비어 있다.
// 그래서 '얼굴 가장자리가 안쪽과 바깥 사이에 있다' 가 '가려진다' 를 뜻하지 않는다.
//
// 제대로 된 물음은 하나다 — **얼굴을 동그랗게 자른 자국 자리에 금색이 있는가.**
// 그 자리(±3px)에 금색이 있는지를 각도 360개에서 세면 이렇게 나온다.
//
// 두 탈은 서로 반대라 동시에 0 이 될 수 없다. 그래서 **나쁜 쪽이 가장 작은** 값을 고른다.
// 테두리 그림 9종 전부에서 재면 이렇다 (숫자는 가장 나쁜 그림 기준).
//
//   고리    고리가 붕 뜸   얼굴이 삐짐   나쁜 쪽
//   120%         18           117         117    ← "삐져나온다"
//   124%         41            78          78
//   126%         72            58          72    ← 지금
//   128%        109            36         109
//   134%        140             1         140    ← "안 맞는다"
//
// 여기서 한 번 더 헛짚었다. 처음에 금색 고리 하나만 놓고 재서 1.28 로 정했는데,
// 그 그림에서는 1.28 이 제일 나았지만 파랑·빨강 고리에서는 크게 떠 버렸다.
// **그림 한 장으로 정하면 안 된다** — 아홉 장을 다 재야 한다.
// 실제 크기(44px)로 나란히 놓고 눈으로도 골랐다.
//
// 대신 가장 굵은 쪽은 칸을 넘는다 (1.26 × 0.95 = 1.20). 넘는 것 자체는 괜찮다.
// 목록 아바타는 44px 이고 글 제목까지 간격이 16px 인데, 한쪽으로 나가는 건 5px 뿐이다.
//
// ②가 핵심이다. 가이드를 확대해 보면 고리가 캐릭터 **바깥에 떨어져** 있는 게 아니라
// 캐릭터 원의 가장자리 **위에 얹혀** 있다. 빛나는 선이 원의 테두리를 따라 지나간다.
// 그래서 캐릭터가 칸을 거의 꽉 채우고, 고리는 그 위를 두른다.
//
// 고리 몸통은 0.72(안쪽) ~ 1.00(바깥) 에 걸쳐 있다. 캐릭터 테두리는 그 위 어디든
// 올 수 있는데, 안쪽에 붙을수록 캐릭터가 작아지고 바깥에 붙을수록 커진다.
// 0.92 는 눈으로 고르신 값이다 (몸통의 71% 지점).
//
// 이 값은 계산이 아니라 화면에 그려서 가이드와 나란히 놓고 정했다
// (scripts/check-ring.js · npm run ring). 지나온 값들이 다 어긋난 이유가 여기 있다.
//   0.76 — 고리가 얼굴을 가로질렀다
//   0.72 — 고리와 캐릭터 사이가 벌어져 흰 띠가 보였다 (계산으로는 '딱 맞음' 이었다)
//   0.86 — 몸통 한가운데. 맞긴 한데 캐릭터가 아직 작아 보였다
//   0.92 — 캐릭터가 칸을 꽉 채우고 고리가 그 위에 얹힌다
//
// 크기를 CSS 가 아니라 여기서 붙이는 이유:
// 예전에는 style.css 에 `.avatar-ring { width: 132% }` 로 뒀는데, 위쪽에 있던
// `.avatar img { width: 100% }` 가 우선순위에서 이겨 132% 가 통째로 무시됐다.
// 화면에는 오류 없이 잘 그려지고, 고리도 제자리에 있어서 아무도 알아채지 못했다.
// 요소에 직접 붙이면 어떤 선택자도 이길 수 없어서 같은 일이 다시 생기지 않는다.
const RING = 1.26;   // 고리 그림을 칸의 몇 배로 그릴지 (얼굴 자른 자국 위에 금색이 얹히게)
const FACE = 0.92;   // 얼굴을 칸의 몇 배로 그릴지 (가이드와 나란히 놓고 눈으로 정한 값)
const RING_HOLE = 0.613;     // 고리 몸통 안쪽 (실측 가운뎃값)
const RING_EDGE = 0.816;     // 고리 바깥 (실측 가운뎃값)
const RING_EDGE_MIN = 0.691; // 고리가 가장 가늘어지는 곳의 바깥 — RING 은 이 값으로 잡는다
const RING_HOLE_MIN = 0.477; // 가장 안쪽으로 뻗은 붓터치 (실측 최솟값)

// opts.ringSlot — 테두리를 낀 칸들과 나란히 놓이는 자리.
//   테두리를 끼면 얼굴이 고리 구멍만큼 작아지는데, 상점의 '사용 안 함' 칸만 테두리가 없어서
//   혼자 얼굴이 크게 나왔다(72px 대 55px). 크기가 들쭉날쭉해 보여서, 고리가 없어도
//   같은 자리에서는 얼굴을 같은 크기로 그린다.
function renderAvatar(avatarCode, borderCode, size = 44, opts = {}) {
  const a = get(avatarCode) || fallback();
  const b = borderCode ? get(borderCode) : null;
  const ringed = !!(b && b.kind === 'border');
  const faceStyle = ringed || opts.ringSlot
    ? ` style="width:${FACE * 100}%;height:${FACE * 100}%;margin:${((1 - FACE) / 2) * 100}%"`
    : '';
  const img = a
    ? `<img class="avatar-face" src="${url(size <= THUMB_UP_TO ? a.thumb : a.file)}"${faceStyle} alt="" loading="lazy">`
    : '';
  // 고리도 마찬가지다. 테두리 목록(9칸)에서만 원본이 281KB, 썸네일이면 53KB.
  const ring = ringed
    ? `<img class="avatar-ring" src="${url(size <= THUMB_UP_TO ? b.thumb : b.file)}"`
      + ` style="width:${RING * 100}%;height:${RING * 100}%" alt="" loading="lazy">`
    : '';
  // 고리를 끼면 잘라내기를 풀어야 한다 (style.css 의 .has-ring)
  // ring-slot 은 고리는 없지만 회색 테두리선(2px)만큼 얼굴이 작아지지 않게 하는 표시다.
  const cls = 'avatar' + (ringed ? ' has-ring' : opts.ringSlot ? ' ring-slot' : '');
  return `<span class="${cls}" style="width:${size}px;height:${size}px">${img}${ring}</span>`;
}

module.exports = {
  MEMBER_TYPES, FREE_PER_TYPE, CHARACTER_PRICE, BORDER_PRICE,
  RING, FACE, RING_HOLE, RING_EDGE, RING_EDGE_MIN, RING_HOLE_MIN,
  items: () => ITEMS, characters, borders, get, fallback, themes, theme, THEME_NOTES,
  starterFor, canUse, renderAvatar, load,
};
