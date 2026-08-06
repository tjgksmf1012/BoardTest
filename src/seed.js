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
  const nightcat = member('nightcat', '나이트캣', 1900, 'male', 'male-01');
  const luno = member('luno', '루노라운지', 2100, 'venue', 'venue-01');

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

  // 출석 기록을 포인트 내역과 맞춘다.
  // 위에서 포인트 내역에는 '출석체크 +10P' 를 넣어 놓고 attendance 표는 비워 뒀더니,
  // 마이페이지에는 "출석 0일" 인데 포인트 내역에는 출석체크가 줄줄이 있는 상태가 됐다.
  // 적립 내역에 찍힌 출석 횟수만큼 실제 출석일을 채워 앞뒤가 맞게 한다.
  //
  // 마지막 출석은 '어제' 로 둔다. 오늘 것까지 찍어 두면 출석 버튼이 처음부터
  // "오늘 출석 완료" 라서, 화면을 보시는 분이 눌러볼 수가 없다.
  const insertDay = db.prepare('INSERT OR IGNORE INTO attendance (user_id, day) VALUES (?, ?)');
  // 출석일 수는 두 가지를 다 만족해야 한다.
  //  - 하루 10P 짜리 출석체크를 받은 횟수
  //  - '연속 출석 7일 보너스' 를 받았다면 적어도 7일은 나와야 한다 (0일인데 보너스는 이상하다)
  const STREAK_DAYS = { streak7: 7, streak14: 14, streak21: 21, streak28: 28, streak30: 30 };
  for (const u of db.prepare('SELECT id FROM users').all()) {
    const rows = db.prepare('SELECT reason FROM point_logs WHERE user_id = ?').all(u.id);
    let n = rows.filter((r) => r.reason === 'attendance').length;
    for (const r of rows) n = Math.max(n, STREAK_DAYS[r.reason] || 0);
    for (let i = 1; i <= n; i++) {
      const day = db.prepare("SELECT date('now', 'localtime', ?) AS d").get(`-${i} days`).d;
      insertDay.run(u.id, day);
    }
  }

  // 공지 2건
  insertPost.run(admin, '커뮤니티 이용 규칙 안내 (필독)',
    `안녕하세요, 운영자입니다.\n\n모두가 즐거운 커뮤니티를 위해 아래 규칙을 지켜주세요.\n\n1. 서로 존중하는 말투를 사용해주세요.\n2. 광고성 게시글은 사전 안내 없이 숨김 처리될 수 있어요.\n3. 다른 회원의 개인정보를 요구하거나 공개하지 마세요.\n4. 신고가 누적된 글은 운영자가 확인 후 조치합니다.\n\n감사합니다!`,
    0, 1, 1254, '-30 days');
  insertPost.run(admin, '포인트 적립 및 캐릭터 구매 안내',
    `활동할수록 포인트가 쌓이고, 포인트로 캐릭터와 테두리를 살 수 있어요!\n\n[기본 포인트]\n- 회원가입 1,000P (최초 1회)\n- 출석체크 하루 10P\n- 일반 게시글 300P (하루 3개까지)\n- 익명 게시글 100P (하루 3개까지)\n- 댓글·대댓글 100P (하루 10개까지)\n- 게시글 추천받기 1개당 10P\n\n[추가 보상]\n- 인기글 선정 1,000P / 운영자 추천 1,500P\n- 연속 출석 7일 50P · 14일 100P · 21일 150P · 28일 200P\n- 30일 연속 출석 달성 시 100P 추가\n\n[캐릭터·테두리]\n- 가입할 때 받는 캐릭터: 무료\n- 그 외 스타일 1종: 2,000P\n- 테두리: 각 20,000P\n\n자세한 내용은 마이페이지 > 아바타 꾸미기에서 확인하세요!`,
    0, 1, 832, '-30 days');

  // 지난 글 — 목록이 한 페이지로 끝나면 맨 아래 페이지 번호(1 2 3 4)가 나오지 않는다.
  // 한 페이지에 15개씩 보여주므로 넉넉히 채워 여러 쪽이 되게 한다.
  // 아래 '샘플 게시글'보다 먼저 넣어야 번호(id) 순서와 날짜 순서가 어긋나지 않는다.
  const older = [
    [cherry, '자유', '첫 알바 시작했어요!', '오늘 첫 출근 다녀왔어요.\n생각보다 정신없었지만 사람들이 잘 챙겨줘서 다행이었어요 ㅎㅎ', 61, 29],
    [mint, '질문', '알바 면접 복장 어떻게 가야 하나요?', '내일 면접인데 정장까지는 아니어도 단정하게 가려구요.\n청바지는 좀 그럴까요?', 143, 28],
    [gold, '자유', '주휴수당 계산하는 법 정리', '주 15시간 이상 일하고 결근 없으면 받을 수 있어요.\n\n주휴수당 = 1일 소정근로시간 × 시급\n\n헷갈리면 고용노동부 계산기 써보세요!', 402, 27],
    [street, '자유', '알바 끝나고 먹는 야식이 제일 맛있어요', '오늘도 편의점 앞에서 컵라면 먹고 왔습니다 ㅋㅋ', 77, 26],
    [nightcat, '질문', '야간 알바 처음인데 조언 부탁드려요', '주간만 해봤는데 이번에 야간으로 옮기게 됐어요.\n밤낮 바뀌는 거 어떻게 적응하셨나요?', 188, 25],
    [luno, '자유', '신규 오픈 기념 인사드려요', '이번에 새로 문 연 곳입니다.\n앞으로 잘 부탁드려요!', 96, 24],
    [cherry, '자유', '알바 구할 때 조심해야 할 공고', '- 업무 내용이 지나치게 두루뭉술한 곳\n- 면접 전에 개인정보부터 요구하는 곳\n- 시급이 시세보다 지나치게 높은 곳\n\n한 번씩 확인하고 가세요.', 517, 23],
    [mint, '자유', '오늘 손님이 너무 많았어요', '점심시간에 줄이 끊이질 않아서 정신이 하나도 없었네요.\n퇴근하고 바로 뻗었습니다...', 84, 22],
    [gold, '질문', '알바비 정산일이 자꾸 밀리는데요', '매달 10일이라고 했는데 벌써 세 번째 밀렸어요.\n이런 경우 어디에 얘기하면 되나요?', 271, 21],
    [street, '자유', '지하철 막차 시간 정리해뒀어요', '야간 끝나고 막차 놓친 적이 많아서 정리했어요.\n노선마다 다르니 미리 확인해두시면 좋아요!', 233, 20],
    [nightcat, '자유', '알바하면서 제일 뿌듯했던 순간', '단골손님이 이름 기억해주셨을 때요.\n별거 아닌데 하루가 괜찮아지더라구요.', 119, 19],
    [cherry, '질문', '근로계약서 꼭 써야 하나요?', '사장님이 나중에 쓰자고 하시는데 괜찮은 걸까요?', 358, 18],
    [mint, '자유', '근로계약서에 꼭 들어가야 하는 것', '- 근무 장소와 업무 내용\n- 시급과 지급일\n- 근무 시간과 휴게 시간\n- 주휴일\n\n한 부는 꼭 받아서 보관하세요!', 611, 17],
    [gold, '자유', '알바 동료랑 친해지는 법 있을까요', '다들 조용히 일만 하다 가는 분위기라 좀 어색해요 ㅠㅠ', 92, 16],
    [luno, '자유', '이번 주 근무 인원 모집합니다', '주말 저녁 시간대 함께 하실 분 찾고 있어요.\n자세한 조건은 쪽지 주세요!', 154, 15],
    [street, '질문', '시급 협상 해보신 분 계신가요?', '6개월 넘게 일했는데 시급이 그대로예요.\n어떻게 말 꺼내야 할지 모르겠어요.', 297, 14],
    [nightcat, '자유', '야간 수당은 이렇게 계산돼요', '밤 10시부터 새벽 6시까지는 통상임금의 1.5배예요.\n(상시 5인 이상 사업장 기준)\n\n명세서 받으면 한 번 확인해보세요.', 448, 13],
    [cherry, '자유', '알바 첫 월급 받았어요!', '통장에 찍힌 거 보고 괜히 기분이 좋았어요 ㅎㅎ\n부모님 선물 사드리려구요.', 168, 12],
    [mint, '질문', '알바 그만둘 때 며칠 전에 말해야 하나요?', '갑자기 그만두면 민폐일 것 같아서요.\n보통 얼마나 전에 말씀드리나요?', 214, 11],
    [gold, '자유', '알바 관련 상담받을 수 있는 곳', '고용노동부 고객상담센터(1350)에서 무료로 상담해줘요.\n전화가 어려우면 홈페이지로도 접수됩니다.', 386, 10],
    [street, '자유', '비 오는 날은 손님이 확 줄어요', '오늘은 한가해서 오랜만에 여유 있었네요.\n이런 날도 있어야죠 ㅎㅎ', 73, 9],
    [nightcat, '질문', '알바 두 개 같이 해보신 분?', '수입은 늘겠지만 체력이 걱정이에요.\n해보신 분들 어떠셨나요?', 246, 8],
    [luno, '자유', '오늘 하루도 다들 고생하셨어요', '마감하고 정리하다 보니 벌써 이 시간이네요.\n모두 푹 쉬세요!', 88, 7],
    [cherry, '자유', '알바 지원할 때 쓰는 자기소개 예시', '길게 쓸 필요 없어요.\n\n- 지원 동기 한 줄\n- 가능한 요일과 시간\n- 관련 경험 한 줄\n\n이 정도면 충분하더라구요.', 529, 6],
  ];
  for (const [uid, cat, title, body, views, ago] of older) {
    const id = insertPost.run(uid, title, body, 0, 0, views, `-${ago} days`).lastInsertRowid;
    db.prepare('UPDATE posts SET category = ? WHERE id = ?').run(cat, id);
  }

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
  setCat.run('자유', p2);
  setCat.run('자유', p3);
  setCat.run('자유', p4);
  setCat.run('질문', p5);

  // 이벤트 말머리는 운영자만 쓸 수 있으므로, 데모 글도 운영자가 쓴 것으로 넣는다.
  const pe = insertPost.run(admin, '[이벤트] 첫 출석 인증하고 포인트 받아가세요',
    '이번 주 출석체크 이벤트 안내드려요.\n\n· 기간: 이번 주 내내\n'
    + '· 방법: 매일 출석체크 누르기\n· 혜택: 7일 연속 달성 시 보너스 포인트\n\n'
    + '많은 참여 부탁드려요!', 0, 0, 512, '-1 days').lastInsertRowid;
  setCat.run('이벤트', pe);

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
