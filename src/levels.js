// 레벨/등급 시스템 + 업적(배지)
// 아바타가 "꾸미기 해금"이라면, 레벨은 누적 포인트로 결정되는 "신분/등급"이다.
// 커뮤니티 게이미피케이션에서 반응이 좋은 '명확한 성장 경로'를 제공한다.

// 색상은 흰 배경 대비 4.5:1 이상(WCAG AA)을 만족하도록 조정
const LEVELS = [
  { level: 1, title: '새싹',   min: 0,     color: '#327b70' },
  { level: 2, title: '초보',   min: 500,   color: '#2a72b0' },
  { level: 3, title: '일반',   min: 2000,  color: '#6a4ff0' },
  { level: 4, title: '열심',   min: 5000,  color: '#9c6a0f' },
  { level: 5, title: '인기',   min: 10000, color: '#c9451c' },
  { level: 6, title: '우수',   min: 20000, color: '#c9433d' },
  { level: 7, title: '전설',   min: 40000, color: '#a32d52' },
];

function getLevel(points) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) cur = l;
  const next = LEVELS.find((l) => l.min > points) || null;
  const span = next ? next.min - cur.min : 1;
  const into = points - cur.min;
  const percent = next ? Math.max(0, Math.min(100, Math.round((into / span) * 100))) : 100;
  return {
    level: cur.level, title: cur.title, color: cur.color,
    next, percent,
    toNext: next ? next.min - points : 0,
  };
}

// 인라인 레벨 뱃지 HTML (닉네임 옆에 붙이는 작은 칩)
function levelBadge(points) {
  const l = getLevel(points);
  return `<span class="lv-badge" style="background:${l.color}1a;color:${l.color}">Lv.${l.level}</span>`;
}

// 업적(배지) 정의 — 기존 데이터로 계산하므로 별도 테이블 불필요
const ACHIEVEMENTS = [
  { id: 'first_post',  icon: '🌱', name: '첫 발자국',   desc: '첫 게시글을 작성했어요',        test: (s) => s.posts >= 1 },
  { id: 'writer',      icon: '✍️', name: '수다쟁이',     desc: '게시글 10개를 작성했어요',       test: (s) => s.posts >= 10 },
  { id: 'commenter',   icon: '💬', name: '리액션왕',     desc: '댓글 30개를 작성했어요',         test: (s) => s.comments >= 30 },
  { id: 'popular',     icon: '🔥', name: '인기스타',     desc: '인기글을 배출했어요',           test: (s) => s.popularPosts >= 1 },
  { id: 'loved',       icon: '👍', name: '인싸',         desc: '추천을 50개 이상 받았어요',      test: (s) => s.likesReceived >= 50 },
  { id: 'attend7',     icon: '📅', name: '개근왕',       desc: '출석 7일을 달성했어요',          test: (s) => s.attendance >= 7 },
  { id: 'admin_pick',  icon: '⭐', name: '운영자 픽',    desc: '운영자 추천글을 받았어요',        test: (s) => s.adminPicks >= 1 },
  { id: 'legend',      icon: '🏆', name: '만렙 전설',    desc: '최고 레벨(전설)에 도달했어요',    test: (s) => s.points >= 40000 },
];

function achievements(stats) {
  return ACHIEVEMENTS.map((a) => ({ ...a, earned: a.test(stats) }));
}

module.exports = { LEVELS, getLevel, levelBadge, ACHIEVEMENTS, achievements };
