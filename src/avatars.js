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
// 받은 테두리 그림 9종은 모두 가운데가 뚫린 고리이고, 그 구멍이 그림 폭의 약 59% 다
// (RING_HOLE — test/avatar-ring.test.js 가 실제 PNG 를 재서 확인한다).
// 그래서 고리를 칸보다 키워야(RING) 구멍이 얼굴을 감싸고, 얼굴은 그 구멍 안에 들어가야(FACE) 한다.
//   구멍 = RING × RING_HOLE = 1.32 × 0.586 ≒ 0.77  ≥  얼굴 0.76  ✅
// 이 값을 지키지 않으면 고리가 얼굴 위로 올라와 얼굴을 가로지른다.
//
// 크기를 CSS 가 아니라 여기서 붙이는 이유:
// 예전에는 style.css 에 `.avatar-ring { width: 132% }` 로 뒀는데, 위쪽에 있던
// `.avatar img { width: 100% }` 가 우선순위에서 이겨 132% 가 통째로 무시됐다.
// 화면에는 오류 없이 잘 그려지고, 고리도 제자리에 있어서 아무도 알아채지 못했다.
// 요소에 직접 붙이면 어떤 선택자도 이길 수 없어서 같은 일이 다시 생기지 않는다.
const RING = 1.32;   // 고리를 칸의 몇 배로 그릴지
const FACE = 0.76;   // 얼굴을 칸의 몇 배로 그릴지 (= 고리 구멍 안)
const RING_HOLE = 0.586; // 고리 그림에서 구멍이 차지하는 비율 (실측 최솟값 — border-blue)

function renderAvatar(avatarCode, borderCode, size = 44) {
  const a = get(avatarCode) || fallback();
  const b = borderCode ? get(borderCode) : null;
  const ringed = !!(b && b.kind === 'border');
  const faceStyle = ringed
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
  return `<span class="avatar${ringed ? ' has-ring' : ''}" style="width:${size}px;height:${size}px">${img}${ring}</span>`;
}

module.exports = {
  MEMBER_TYPES, FREE_PER_TYPE, CHARACTER_PRICE, BORDER_PRICE,
  RING, FACE, RING_HOLE,
  items: () => ITEMS, characters, borders, get, fallback, themes, theme, THEME_NOTES,
  starterFor, canUse, renderAvatar, load,
};
