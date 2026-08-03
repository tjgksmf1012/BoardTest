// 게시판 말머리(카테고리) 정의
// 알바 커뮤니티 성격에 맞춘 분류. 글이 한 통에 섞이지 않도록 탐색성을 높인다.
// 색상은 흰 배경 대비 4.5:1 이상(WCAG AA)을 만족하도록 조정
const CATEGORIES = [
  { id: '자유',   cls: 'cat-free',  color: '#0b7a70' },
  { id: '질문',   cls: 'cat-q',     color: '#2a72b0' },
  { id: '정보',   cls: 'cat-info',  color: '#6a4ff0' },
  { id: '이벤트', cls: 'cat-event', color: '#c9451c' },
];

// 없어진 말머리로 저장된 옛 글은 '자유'로 읽는다 (데이터는 그대로 두고 표시만 옮긴다)
const RETIRED = { '알바후기': '자유', '구인구직': '자유' };

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

module.exports = { CATEGORIES, RETIRED, isValid, normalize, catTag };
