// 게시판 말머리(카테고리) 정의
// 알바 커뮤니티 성격에 맞춘 5개 분류. 글이 한 통에 섞이지 않도록 탐색성을 높인다.
const CATEGORIES = [
  { id: '자유',     cls: 'cat-free',   color: '#00a99d' },
  { id: '질문',     cls: 'cat-q',      color: '#5aa9e6' },
  { id: '정보',     cls: 'cat-info',   color: '#7c6bff' },
  { id: '알바후기', cls: 'cat-review', color: '#e6a23c' },
  { id: '구인구직', cls: 'cat-job',    color: '#e0592e' },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

function isValid(id) {
  return byId.has(id);
}

// 말머리 태그 HTML
function catTag(id) {
  const c = byId.get(id);
  if (!c) return '';
  return `<span class="cat-tag" style="color:${c.color};background:${c.color}1a">${c.id}</span>`;
}

module.exports = { CATEGORIES, isValid, catTag };
