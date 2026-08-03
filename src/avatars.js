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
  // 유형 안에서의 순번을 매겨 앞 FREE_PER_TYPE개는 무료로 둔다
  const seen = new Map();
  for (const it of ITEMS) {
    const n = (seen.get(it.memberType) || 0) + 1;
    seen.set(it.memberType, n);
    it.index = n;
    if (it.kind === 'border') it.price = BORDER_PRICE;
    else if (it.memberType === 'anon' || it.memberType === 'admin') it.price = 0;
    else it.price = n <= FREE_PER_TYPE ? 0 : CHARACTER_PRICE;
  }
  byCode = new Map(ITEMS.map((i) => [i.code, i]));
}
load();

const characters = (type) => ITEMS.filter((i) => i.kind === 'character' && (!type || i.memberType === type));
const borders = () => ITEMS.filter((i) => i.kind === 'border');
const get = (code) => byCode.get(code) || null;

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
function renderAvatar(avatarCode, borderCode, size = 44) {
  const a = get(avatarCode) || fallback();
  const b = borderCode ? get(borderCode) : null;
  const img = a
    ? `<img src="${url(size <= 48 ? a.thumb : a.file)}" alt="" loading="lazy">`
    : '';
  const ring = b && b.kind === 'border'
    ? `<img class="avatar-ring" src="${url(b.file)}" alt="" loading="lazy">`
    : '';
  return `<span class="avatar" style="width:${size}px;height:${size}px">${img}${ring}</span>`;
}

module.exports = {
  MEMBER_TYPES, FREE_PER_TYPE, CHARACTER_PRICE, BORDER_PRICE,
  items: () => ITEMS, characters, borders, get, fallback,
  starterFor, canUse, renderAvatar, load,
};
