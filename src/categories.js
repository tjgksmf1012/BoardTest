// 게시판 말머리(카테고리) 정의
// 알바 커뮤니티 성격에 맞춘 분류. 글이 한 통에 섞이지 않도록 탐색성을 높인다.
// 색은 '흰 배경'이 아니라 '그 색 10%를 흰 바탕에 얹은 뱃지 배경' 위에서 4.5:1(WCAG AA)이
// 나와야 한다. 흰 배경 기준으로만 맞췄더니 질문 4.46:1, 이벤트 4.19:1 로 살짝 모자랐다.
const CATEGORIES = [
  { id: '자유',   cls: 'cat-free',  color: '#0b7a70' },  // 4.54:1
  { id: '질문',   cls: 'cat-q',     color: '#2a71ae' },  // 4.52:1
  { id: '이벤트', cls: 'cat-event', color: '#bf421b', adminOnly: true },  // 4.54:1
];

// 없어진 말머리로 저장된 옛 글은 '자유'로 읽는다 (데이터는 그대로 두고 표시만 옮긴다).
// '정보' 는 선배님 요청으로 뺐다. 그 말머리로 쓴 글이 이미 있어서, 지우지 않고 '자유' 로 옮긴다.
const RETIRED = { '알바후기': '자유', '구인구직': '자유', '정보': '자유' };

// 이벤트는 운영자만 글을 쓸 수 있다. 회원에게는 글쓰기 화면의 말머리 목록에 안 보인다.
// 목록에서는 누구나 볼 수 있다 (읽기는 막지 않는다).
const ADMIN_ONLY = new Set(CATEGORIES.filter((c) => c.adminOnly).map((c) => c.id));
const BOARD_TABS = CATEGORIES;

// 글쓰기 화면에서 고를 수 있는 말머리
function writable(isAdmin) {
  return CATEGORIES.filter((c) => isAdmin || !ADMIN_ONLY.has(c.id));
}
function canWrite(id, isAdmin) {
  return isValid(id) && (isAdmin || !ADMIN_ONLY.has(id));
}

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

function isValid(id) {
  return byId.has(id);
}

// 저장된 값을 지금 쓰는 말머리로 옮긴다
function normalize(id) {
  return byId.has(id) ? id : (RETIRED[id] || '자유');
}

// 말머리 태그 HTML
// 색은 인라인이 아니라 클래스로 준다 — 그래야 다크 모드에서 밝은 색으로 바꿔줄 수 있다.
function catTag(id) {
  const c = byId.get(id);
  if (!c) return '';
  return `<span class="cat-tag ${c.cls}">${c.id}</span>`;
}

module.exports = { CATEGORIES, BOARD_TABS, ADMIN_ONLY, RETIRED,
  isValid, normalize, catTag, writable, canWrite };
