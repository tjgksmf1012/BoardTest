// 게시판 말머리(카테고리) 정의
// 알바 커뮤니티 성격에 맞춘 분류. 글이 한 통에 섞이지 않도록 탐색성을 높인다.
// 색은 '흰 배경'이 아니라 '그 색 10%를 흰 바탕에 얹은 뱃지 배경' 위에서 4.5:1(WCAG AA)이
// 나와야 한다. 흰 배경 기준으로만 맞췄더니 질문 4.46:1, 이벤트 4.19:1 로 살짝 모자랐다.
const CATEGORIES = [
  { id: '자유',   cls: 'cat-free',  color: '#0b7a70' },  // 4.54:1
  { id: '질문',   cls: 'cat-q',     color: '#2a71ae' },  // 4.52:1
  { id: '정보',   cls: 'cat-info',  color: '#6a4ff0' },  // 4.59:1
  { id: '이벤트', cls: 'cat-event', color: '#bf421b' },  // 4.54:1
];

// 없어진 말머리로 저장된 옛 글은 '자유'로 읽는다 (데이터는 그대로 두고 표시만 옮긴다)
const RETIRED = { '알바후기': '자유', '구인구직': '자유' };

// 이벤트 글은 상단의 '이벤트·포인트' 메뉴에서 따로 본다.
// 그래서 게시판 말머리 줄에는 안 넣지만, 글을 쓸 때는 고를 수 있고 '전체'에도 그대로 나온다.
const OWN_TAB = new Set(['이벤트']);
const BOARD_TABS = CATEGORIES.filter((c) => !OWN_TAB.has(c.id));

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

module.exports = { CATEGORIES, BOARD_TABS, OWN_TAB, RETIRED, isValid, normalize, catTag };
