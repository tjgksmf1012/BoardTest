// 게시판 말머리(카테고리) 정의
// 알바 커뮤니티 성격에 맞춘 5개 분류. 글이 한 통에 섞이지 않도록 탐색성을 높인다.
// 색상은 흰 배경 대비 4.5:1 이상(WCAG AA)을 만족하도록 조정
const CATEGORIES = [
  { id: '자유',     cls: 'cat-free',   color: '#0b7a70' },
  { id: '질문',     cls: 'cat-q',      color: '#2a72b0' },
  { id: '정보',     cls: 'cat-info',   color: '#6a4ff0' },
  { id: '알바후기', cls: 'cat-review', color: '#9c6a0f' },
  { id: '구인구직', cls: 'cat-job',    color: '#c9451c' },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

function isValid(id) {
  return byId.has(id);
}

// 말머리 태그 HTML
// 색은 인라인이 아니라 클래스로 준다 — 그래야 다크 모드에서 밝은 색으로 바꿔줄 수 있다.
function catTag(id) {
  const c = byId.get(id);
  if (!c) return '';
  return `<span class="cat-tag ${c.cls}">${c.id}</span>`;
}

module.exports = { CATEGORIES, isValid, catTag };
