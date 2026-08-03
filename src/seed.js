// 최초 실행 시 데모용 데이터 생성 (운영자 계정 + 공지 + 샘플 게시글)
const db = require('./db');
const { hashPassword } = require('./routes/auth');
const { htmlToText } = require('./richtext');

function seed() {
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return;

  const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, nickname, points, avatar_id, border_id, is_admin, member_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  // 데모 회원이 무료가 아닌 캐릭터·테두리를 달고 있으면 산 기록도 같이 남긴다.
  // 그래야 상점 화면에서 '보유'로 보이고, 장착을 다시 눌러도 통과한다.
  const avatars = require('./avatars');
  const insertItem = db.prepare(
    'INSERT OR IGNORE INTO user_items (user_id, item_code, price) VALUES (?, ?, ?)');
  const own = (userId, ...codes) => {
    for (const code of codes) {
      const item = code && avatars.get(code);
      if (item && item.price > 0) insertItem.run(userId, item.code, item.price);
    }
  };
  const insertPost = db.prepare(`
    INSERT INTO posts (user_id, title, content, is_anonymous, is_notice, views, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime', ?))`);
  const insertComment = db.prepare(
    'INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)');
  const insertLike = db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)');
  const insertLog = db.prepare(
    "INSERT INTO point_logs (user_id, amount, reason, detail) VALUES (?, ?, 'signup', '회원가입')");

  // 운영자: admin / admin1234 — 운영자 전용 캐릭터(검정고양이)를 단다
  const admin = insertUser.run('admin', hashPassword('admin1234'), '운영자',
    25000, 'admin', null, 1, 'female').lastInsertRowid;

  // 샘플 회원 (비밀번호는 모두 test1234)
  // 닉네임에 맞는 캐릭터를 달아 둔다 — 화면마다 다른 얼굴이 보여야 목록이 읽힌다.
  const pw = hashPassword('test1234');
  const member = (id, nick, points, type, avatar, border) => {
    const uid = insertUser.run(id, pw, nick, points, avatar, border, 0, type).lastInsertRowid;
    own(uid, avatar, border);
    return uid;
  };
  const cherry = member('cherry', '체리블라썸', 1800, 'female', 'female-lovelypink-1-1');
  const mint = member('mint', '민트소다', 6200, 'female', 'female-freshmint-3-3');
  const street = member('street', '스트릿캡', 3400, 'female', 'female-hipstreet-5-1');
  const gold = member('gold', '골드웨이브', 12500, 'female', 'female-glamgold-2-2', 'border-gold');
  // 남성회원·업소회원도 한 명씩 둬서 세 유형이 모두 보이게 한다
  member('nightcat', '나이트캣', 1900, 'male', 'male-01');
  member('luno', '루노라운지', 2100, 'venue', 'venue-01');

  // 각 회원의 포인트 총액과 적립 내역이 일치하도록 로그를 채워 넣는다
  const logRow = db.prepare(
    "INSERT INTO point_logs (user_id, amount, reason, detail, created_at) VALUES (?, ?, ?, ?, datetime('now','localtime',?))");
  // 포인트 총액과 내역의 합이 정확히 맞아야 화면이 앞뒤가 맞는다.
  // 금액은 손으로 적지 않고 src/points.js 의 RULES 에서 가져온다 — 규칙이 바뀌면 같이 바뀐다.
  const { RULES } = require('./points');
  function fillLogs(userId, target) {
    const of = (reason, detail) => [RULES[reason].amount, reason, detail || RULES[reason].label];
    const seq = [of('signup')];
    let sum = seq[0][0];
    const big = ['streak7', 'post', 'streak14', 'post', 'streak21', 'post', 'streak28', 'streak30']
      .map((r) => of(r));
    const small = ['post', 'comment', 'like_received', 'comment', 'post'].map((r) => of(r));
    // 굵직한 보상으로 대충 채우고
    for (const e of big) {
      if (sum + e[0] > target - RULES.post.amount) break;
      seq.push(e); sum += e[0];
    }
    // 일상 활동으로 더 채운 뒤
    let si = 0;
    while (si < 400) {
      const e = small[si % small.length];
      if (sum + e[0] > target) break;
      seq.push(e); sum += e[0]; si++;
    }
    // 남는 자투리는 출석(10P)으로 정확히 맞춘다
    while (sum + RULES.attendance.amount <= target) { seq.push(of('attendance')); sum += RULES.attendance.amount; }
    if (sum !== target) {
      throw new Error(`데모 포인트 합계가 안 맞아요: ${sum} ≠ ${target}`
        + ` (가입 ${RULES.signup.amount}P 보다 적거나 10P 배수가 아닌 값은 못 맞춰요)`);
    }
    // 오래된 항목(큰 day offset)부터 삽입 → 최근 항목이 마지막에 삽입되어 목록 상단에 다양하게 노출
    const n = seq.length;
    seq.forEach((e, idx) => logRow.run(userId, e[0], e[1], e[2], `-${Math.max(0, n - 1 - idx)} days`));
  }
  // 캐릭터를 산 사람은 '벌어서 썼다'가 되어야 한다.
  // 쓴 만큼 더 벌어둔 뒤 구매 기록으로 빼면, 남은 잔액이 users.points 와 정확히 맞는다.
  function fillFor(userId, points) {
    const bought = db.prepare('SELECT item_code, price FROM user_items WHERE user_id = ?').all(userId);
    fillLogs(userId, points + bought.reduce((s, r) => s + r.price, 0));
    for (const r of bought) {
      const item = avatars.get(r.item_code);
      db.prepare("INSERT INTO point_logs (user_id, amount, reason, detail) VALUES (?, ?, 'purchase', ?)")
        .run(userId, -r.price, `${item ? item.name : r.item_code} 구매`);
    }
  }
  for (const u of db.prepare('SELECT id, points FROM users').all()) fillFor(u.id, u.points);

  // 공지 2건
  insertPost.run(admin, '커뮤니티 이용 규칙 안내 (필독)',
    `안녕하세요, 운영자입니다.\n\n모두가 즐거운 커뮤니티를 위해 아래 규칙을 지켜주세요.\n\n1. 서로 존중하는 말투를 사용해주세요.\n2. 광고성 게시글은 사전 안내 없이 숨김 처리될 수 있어요.\n3. 다른 회원의 개인정보를 요구하거나 공개하지 마세요.\n4. 신고가 누적된 글은 운영자가 확인 후 조치합니다.\n\n감사합니다!`,
    0, 1, 1254, '-30 days');
  insertPost.run(admin, '포인트 적립 및 캐릭터 구매 안내',
    `활동할수록 포인트가 쌓이고, 포인트로 캐릭터와 테두리를 살 수 있어요!\n\n[기본 포인트]\n- 회원가입 1,000P (최초 1회)\n- 출석체크 하루 10P\n- 일반 게시글 300P (하루 3개까지)\n- 익명 게시글 100P (하루 3개까지)\n- 댓글·대댓글 100P (하루 10개까지)\n- 게시글 추천받기 1개당 10P\n\n[추가 보상]\n- 인기글 선정 1,000P / 운영자 추천 1,500P\n- 연속 출석 7일 50P · 14일 100P · 21일 150P · 28일 200P\n- 30일 연속 출석 달성 시 100P 추가\n\n[캐릭터·테두리]\n- 가입할 때 받는 캐릭터: 무료\n- 그 외 스타일 1종: 2,000P\n- 테두리: 각 20,000P\n\n자세한 내용은 마이페이지 > 아바타 꾸미기에서 확인하세요!`,
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
  setCat.run('이벤트', p2);
  setCat.run('자유', p3);
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

  // 서식 에디터로 쓴 글 예시 한 건 (제목·굵게·목록·인용이 어떻게 보이는지 보여주는 용도)
  const richHtml = [
    '<h2>면접 전에 꼭 확인할 것</h2>',
    '<p>알바 면접 다니면서 느낀 체크리스트를 정리했어요.</p>',
    '<ul><li><strong>급여일</strong>이 언제인지</li><li><strong>주휴수당</strong> 지급 여부</li>',
    '<li>수습 기간과 수습 시급</li><li>4대보험 가입 여부</li></ul>',
    '<h3>특히 주휴수당</h3>',
    '<p>주 15시간 이상 일하면 받을 수 있는데, <u>모르고 넘어가는 경우</u>가 많아요.</p>',
    '<blockquote>계약서는 꼭 사진으로 찍어두세요. 나중에 문제가 생기면 유일한 증거가 됩니다.</blockquote>',
    '<p>다들 좋은 곳에서 일하시길 바라요!</p>',
  ].join('');
  db.prepare("UPDATE posts SET content = ?, content_format = 'html', content_text = ? WHERE id = ?")
    .run(richHtml, htmlToText(richHtml), p4);

  // 추천을 직접 넣었으므로 글에 저장된 추천 수를 맞춰준다
  db.exec('UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id)');

  // 나머지 데모 글은 평문이므로 목록·검색용 평문 사본을 본문 그대로 채워둔다
  db.exec('UPDATE posts SET content_text = content WHERE content_text IS NULL');

  console.log('데모 데이터를 생성했어요. (운영자: admin / admin1234, 샘플 회원: cherry·mint·street·gold / test1234)');
}

module.exports = seed;
