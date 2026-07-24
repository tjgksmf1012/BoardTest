// 최초 실행 시 데모용 데이터 생성 (운영자 계정 + 공지 + 샘플 게시글)
const db = require('./db');
const { hashPassword } = require('./routes/auth');

function seed() {
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return;

  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, points, avatar_id, border_id, is_admin)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertPost = db.prepare(`
    INSERT INTO posts (user_id, title, content, is_anonymous, is_notice, views, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime', ?))`);
  const insertComment = db.prepare(
    'INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)');
  const insertLike = db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)');
  const insertLog = db.prepare(
    "INSERT INTO point_logs (user_id, amount, reason, detail) VALUES (?, ?, 'signup', '회원가입')");

  // 운영자: admin / admin1234
  const admin = insertUser.run('admin', hashPassword('admin1234'), '운영자',
    25000, 'outfit-01', 'border-sunset', 1).lastInsertRowid;

  // 샘플 회원 (비밀번호는 모두 test1234)
  const pw = hashPassword('test1234');
  const cherry = insertUser.run('cherry', pw, '체리블라썸', 1800, 'basic-01', null, 0).lastInsertRowid;
  const mint = insertUser.run('mint', pw, '민트소다', 6200, 'hair-02', null, 0).lastInsertRowid;
  const street = insertUser.run('street', pw, '스트릿캡', 3400, 'basic-05', null, 0).lastInsertRowid;
  const gold = insertUser.run('gold', pw, '골드웨이브', 12500, 'outfit-03', null, 0).lastInsertRowid;

  // 각 회원의 포인트 총액과 적립 내역이 일치하도록 로그를 채워 넣는다
  const logRow = db.prepare(
    "INSERT INTO point_logs (user_id, amount, reason, detail, created_at) VALUES (?, ?, ?, ?, datetime('now','localtime',?))");
  // 포인트 총액과 정확히 일치하면서, 최근 내역이 단조롭지 않도록 다양한 활동으로 채운다.
  // 금액과 사유가 항상 맞도록(예: 3일 연속=500P) 100P 배수 denomination만 사용.
  function fillLogs(userId, target) {
    const seq = [[1000, 'signup', '회원가입']];
    let sum = 1000;
    const big = [
      [500, 'streak3', '3일 연속 출석'], [300, 'post', '일반 게시글 작성'],
      [1000, 'streak7', '7일 연속 출석'], [300, 'post', '일반 게시글 작성'],
      [3000, 'streak30', '30일 연속 출석'], [300, 'post', '일반 게시글 작성'],
    ];
    const small = [
      [100, 'attendance', '출석체크'], [300, 'post', '일반 게시글 작성'],
      [100, 'comment', '댓글·대댓글 작성'], [100, 'attendance', '출석체크'],
    ];
    // 큰 보너스로 대략 채우기
    let bi = 0;
    while (bi < big.length && sum + big[bi][0] <= target - 300) {
      seq.push(big[bi]); sum += big[bi][0]; bi++;
    }
    // 나머지는 100/300 단위로 정확히 채우기 (사유·금액 일치 유지)
    let si = 0;
    while (sum < target) {
      const [a, r, d] = small[si % small.length];
      if (sum + a <= target) { seq.push([a, r, d]); sum += a; }
      else { seq.push([100, 'comment', '댓글·대댓글 작성']); sum += 100; }
      si++;
      if (seq.length > 500) break;
    }
    // 오래된 항목(큰 day offset)부터 삽입 → 최근 항목이 마지막에 삽입되어 목록 상단에 다양하게 노출
    const n = seq.length;
    seq.forEach((e, idx) => logRow.run(userId, e[0], e[1], e[2], `-${Math.max(0, n - 1 - idx)} days`));
  }
  fillLogs(admin, 25000);
  fillLogs(cherry, 1800);
  fillLogs(mint, 6200);
  fillLogs(street, 3400);
  fillLogs(gold, 12500);

  // 공지 2건
  insertPost.run(admin, '커뮤니티 이용 규칙 안내 (필독)',
    `안녕하세요, 운영자입니다.\n\n모두가 즐거운 커뮤니티를 위해 아래 규칙을 지켜주세요.\n\n1. 서로 존중하는 말투를 사용해주세요.\n2. 광고성 게시글은 사전 안내 없이 숨김 처리될 수 있어요.\n3. 다른 회원의 개인정보를 요구하거나 공개하지 마세요.\n4. 신고가 누적된 글은 운영자가 확인 후 조치합니다.\n\n감사합니다!`,
    0, 1, 1254, '-30 days');
  insertPost.run(admin, '포인트 적립 및 아바타 해금 안내',
    `활동할수록 포인트가 쌓이고, 포인트로 아바타가 업그레이드돼요!\n\n[기본 포인트]\n- 회원가입 1,000P (최초 1회)\n- 출석체크 하루 100P\n- 일반 게시글 300P (하루 3개까지)\n- 익명 게시글 100P (하루 3개까지)\n- 댓글·대댓글 100P (하루 10개까지)\n- 게시글 추천받기 1개당 10P\n\n[추가 보상]\n- 인기글 선정 1,000P / 운영자 추천 1,500P\n- 연속 출석 3일 500P · 7일 1,000P · 30일 3,000P\n\n[아바타 해금]\n- 기본 12종: 무료\n- 스페셜 헤어: 5,000P\n- 프리미엄 의상: 10,000P\n- 움직이는 테두리: 20,000P\n- 이벤트 한정: 시즌마다 오픈\n\n자세한 내용은 마이페이지에서 확인하세요!`,
    0, 1, 832, '-30 days');

  // 샘플 게시글
  const p1 = insertPost.run(cherry, '오늘도 좋은 하루 보내세요! ☺',
    '다들 오늘 하루도 화이팅이에요!\n날씨가 좋아서 기분이 좋네요 ㅎㅎ', 0, 0, 88, '-5 days').lastInsertRowid;
  const p2 = insertPost.run(street, '강남 쪽 카페 알바 구해요!',
    '안녕하세요!\n강남 쪽에서 낮이나 저녁 카페 알바 구하고 있어요.\n경험은 없지만 밝은 성격이고 손도 빠른 편이에요 ㅎㅎ\n\n시급이나 근무 조건 괜찮은 곳 있으면 추천 부탁드려요!\n\n감사합니다 :)', 0, 0, 245, '-4 days').lastInsertRowid;
  const p3 = insertPost.run(mint, '새벽 편의점 알바 경험담',
    '새벽 타임 편의점 알바 3개월 해본 후기예요.\n\n장점: 손님이 적어서 여유롭고, 야간 수당이 붙어요.\n단점: 생활 패턴 유지가 진짜 어려워요...\n\n체력 관리가 제일 중요합니다!', 1, 0, 190, '-3 days').lastInsertRowid;
  const p4 = insertPost.run(gold, '면접 볼 때 이것만은 꼭 확인하세요',
    '알바 면접 다니면서 느낀 체크리스트 공유해요.\n\n1. 급여일이 언제인지\n2. 주휴수당 지급 여부\n3. 수습 기간과 수습 시급\n4. 4대보험 가입 여부\n\n꼭 확인하고 시작하세요!', 0, 0, 320, '-2 days').lastInsertRowid;
  const p5 = insertPost.run(mint, '주말에 할만한 알바 추천 부탁드려요',
    '평일에는 수업이 있어서 주말 알바를 찾고 있어요.\n카페, 편의점, 영화관 중에 고민 중인데 해보신 분들 조언 부탁드립니다!', 0, 0, 132, '-1 days').lastInsertRowid;

  // 말머리(카테고리) 지정
  const setCat = db.prepare('UPDATE posts SET category = ? WHERE id = ?');
  setCat.run('자유', p1);
  setCat.run('구인구직', p2);
  setCat.run('알바후기', p3);
  setCat.run('정보', p4);
  setCat.run('질문', p5);

  // 댓글
  const cm1 = insertComment.run(p2, mint, null, '강남역 근처 카페 친구가 일하는데 분위기 괜찮다고 하더라구요!').lastInsertRowid;
  const c2 = insertComment.run(p2, gold, null, '저도 카페 알바 해봤는데 체력적으로 괜찮고 사장님이 좋으면 오래 다닐 수 있어요!').lastInsertRowid;
  insertComment.run(p2, cherry, c2, '오 저도 그 말 듣고 지원해보려구요 ㅎㅎ 같이 화이팅해요!');
  const cm4 = insertComment.run(p4, cherry, null, '주휴수당 얘기 진짜 공감해요. 모르고 넘어가는 경우 많더라구요.').lastInsertRowid;
  insertComment.run(p4, street, null, '수습 시급 부분 저장해갑니다!');
  insertComment.run(p5, gold, null, '영화관 알바 재밌긴 한데 주말이 제일 바빠요 ㅋㅋ 참고하세요!');

  // 댓글 좋아요 (베스트댓글 데모용)
  const insertClike = db.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)');
  [[c2, cherry], [c2, mint], [c2, street], [c2, admin]].forEach(([c, u]) => insertClike.run(c, u));
  [[cm1, gold], [cm1, cherry], [cm1, admin]].forEach(([c, u]) => insertClike.run(c, u));
  [[cm4, mint], [cm4, gold], [cm4, street]].forEach(([c, u]) => insertClike.run(c, u));

  // 추천 (익명글 p3 제외)
  [[p1, mint], [p1, street], [p1, gold],
   [p2, cherry], [p2, mint], [p2, gold], [p2, admin],
   [p4, cherry], [p4, mint], [p4, street], [p4, admin],
   [p5, cherry], [p5, street]].forEach(([post, user]) => insertLike.run(post, user));

  // 알림 샘플 (street 회원에게)
  const insertNoti = db.prepare('INSERT INTO notifications (user_id, message, link, is_read) VALUES (?, ?, ?, ?)');
  insertNoti.run(street, '민트소다님이 회원님의 글을 추천했어요. (+10P)', `/board/${p2}`, 0);
  insertNoti.run(street, '골드웨이브님이 회원님의 글에 댓글을 남겼어요.', `/board/${p2}`, 0);
  insertNoti.run(gold, '회원님의 글이 운영자 추천글로 선정됐어요. (+1,500P)', `/board/${p4}`, 1);

  // 스크랩 샘플
  const insertBookmark = db.prepare('INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)');
  insertBookmark.run(cherry, p4);
  insertBookmark.run(mint, p4);

  // 신고 샘플 (익명글에 신고 2건)
  const insertReport = db.prepare('INSERT INTO reports (post_id, user_id) VALUES (?, ?)');
  insertReport.run(p3, cherry);
  insertReport.run(p3, gold);

  // 댓글 신고 샘플 (p2의 첫 댓글에 1건)
  const insertCReport = db.prepare('INSERT INTO comment_reports (comment_id, user_id) VALUES (?, ?)');
  insertCReport.run(cm1, gold);

  console.log('데모 데이터를 생성했어요. (운영자: admin / admin1234, 샘플 회원: cherry·mint·street·gold / test1234)');
}

module.exports = seed;
