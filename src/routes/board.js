// 게시판: 목록 / 글쓰기 / 상세 / 수정 / 삭제 / 추천 / 댓글 / 신고 / 운영자 기능
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { award, unlockMessage } = require('../points');
const { notify } = require('../notify');
const { CATEGORIES, isValid: isValidCategory } = require('../categories');
const { sanitizePostHtml, htmlToText, textToHtml, usedUploadFiles } = require('../richtext');

const MAX_CONTENT = 5000; // 평문 기준 글자 수 제한
const MAX_IMAGES = 5;     // 글 한 편에 넣을 수 있는 사진 수

// 에디터가 보낸 본문을 저장 가능한 형태로 정리한다.
// 서식 있는 글이면 정화한 HTML과 평문 사본을 함께 돌려준다.
function prepareContent(body) {
  if (body.content_format === 'html') {
    const html = sanitizePostHtml(body.content);
    const text = htmlToText(html);
    const images = usedUploadFiles(html);
    // 이미지만 있고 글자가 없는 글도 허용해야 하므로 이미지 유무를 함께 본다
    return {
      format: 'html', content: html, text,
      empty: !text && images.length === 0,
      tooLong: text.length > MAX_CONTENT,
      tooManyImages: images.length > MAX_IMAGES,
    };
  }
  const text = (body.content || '').trim();
  return {
    format: 'text', content: text, text,
    empty: !text, tooLong: text.length > MAX_CONTENT, tooManyImages: false,
  };
}

// 수정 화면의 에디터에 넣을 HTML.
// 옛 평문 글은 문단으로 바꾸고, 아래에 따로 붙어 있던 사진도 본문 안으로 옮겨
// 사용자가 위치를 자유롭게 바꿀 수 있게 한다.
function editableHtml(post, images) {
  if (post.content_format === 'html') return post.content;
  const paragraphs = textToHtml(post.content);
  const imgs = (images || [])
    .map((i) => `<p><img src="/uploads/${i.filename}" alt="첨부 이미지"></p>`).join('');
  return sanitizePostHtml(paragraphs + imgs);
}

// 본문에 실제로 남아 있는 이미지만 post_images에 유지한다 (글 삭제 시 파일 정리용)
function syncPostImages(postId, format, html) {
  if (format !== 'html') return;
  const used = usedUploadFiles(html);
  const rows = db.prepare('SELECT * FROM post_images WHERE post_id = ?').all(postId);
  // 본문에서 빠진 이미지는 레코드와 파일을 정리
  rows.forEach((r) => {
    if (!used.includes(r.filename)) {
      db.prepare('DELETE FROM post_images WHERE id = ?').run(r.id);
      fs.rm(path.join(UPLOAD_DIR, r.filename), { force: true }, () => {});
    }
  });
  // 새로 들어온 이미지는 레코드 추가
  const known = rows.map((r) => r.filename);
  const insert = db.prepare('INSERT INTO post_images (post_id, filename) VALUES (?, ?)');
  used.forEach((f) => { if (!known.includes(f)) insert.run(postId, f); });
}

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 이미지 첨부: 최대 5장, JPG/PNG, 장당 10MB 이하 (기획안 그대로)
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png'].includes(file.mimetype);
    cb(ok ? null : new Error('JPG, PNG 파일만 첨부할 수 있어요.'), ok);
  },
});

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = '로그인이 필요한 기능이에요.';
    // GET은 현재 주소로, POST(추천/댓글 등)는 방금 보던 글로 돌아오게 한다
    let back = req.method === 'GET' ? req.originalUrl : '';
    if (!back) {
      try { back = new URL(req.get('Referer')).pathname; } catch { back = ''; }
    }
    const q = /^\/[^/]/.test(back) && !back.startsWith('//') ? `?next=${encodeURIComponent(back)}` : '';
    return res.redirect(`/login${q}`);
  }
  next();
}

const PAGE_SIZE = 10;

// ---- 목록 ----------------------------------------------------------------
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const q = (req.query.q || '').trim();
  const sort = ['latest', 'likes', 'views'].includes(req.query.sort) ? req.query.sort : 'latest';
  const hot = req.query.filter === 'hot';
  const category = isValidCategory(req.query.category) ? req.query.category : null;

  // 공지는 기본 목록에서만 상단 고정 (검색·인기글 필터 중엔 결과에 집중하도록 숨김)
  const notices = (q || hot) ? [] : db.prepare(`
    SELECT p.*, u.nickname, u.avatar_id, u.border_id,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.is_deleted = 0) AS comment_count
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.is_notice = 1 ORDER BY p.id DESC`).all();

  // 숨김 처리된 글은 일반 사용자에겐 안 보이고, 운영자에겐 목록에 표시(배지로 구분)
  const isAdmin = res.locals.me && res.locals.me.is_admin ? 1 : 0;
  // 검색은 평문 사본을 본다 (HTML 태그 이름이 검색어에 걸리지 않도록).
  // LIKE의 와일드카드(% _)를 그대로 두면 '%' 한 글자로 전체 글이 검색되므로 이스케이프한다.
  const where = (q ? `AND (p.title LIKE @like ESCAPE '\\' OR COALESCE(p.content_text, p.content) LIKE @like ESCAPE '\\')` : '')
    + (hot ? ' AND p.is_popular = 1' : '')
    + (category ? ' AND p.category = @category' : '')
    + ' AND (p.is_hidden = 0 OR @admin = 1)';
  const orderBy = sort === 'likes' ? 'p.like_count DESC, p.id DESC'
    : sort === 'views' ? 'p.views DESC, p.id DESC'
    : 'p.id DESC';
  const escapeLike = (v) => v.replace(/[\\%_]/g, (m) => '\\' + m);
  const params = { like: `%${escapeLike(q)}%`, category, admin: isAdmin, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM posts p WHERE p.is_notice = 0 ${where}`
  ).get(params).c;
  const posts = db.prepare(`
    SELECT p.*, u.nickname, u.avatar_id, u.border_id,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.is_deleted = 0) AS comment_count,
      (SELECT COUNT(*) FROM post_images i WHERE i.post_id = p.id) AS image_count
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.is_notice = 0 ${where}
    ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`).all(params);

  // 🔥 지금 뜨는 글: 최근 7일 내 추천 많은 글 상위 5개 (첫 페이지·검색/필터 없을 때만)
  let trending = [];
  if (page === 1 && !q && !hot && !category) {
    trending = db.prepare(`
      SELECT p.id, p.title, p.like_count
      FROM posts p
      WHERE p.is_notice = 0 AND p.is_anonymous = 0 AND p.is_hidden = 0
        AND p.created_at >= datetime('now', 'localtime', '-7 days')
      ORDER BY p.like_count DESC, p.id DESC LIMIT 5`).all()
      .filter((t) => t.like_count > 0);
  }

  res.render('board', {
    notices, posts, page, q, sort, hot, trending, category, categories: CATEGORIES,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

// ---- 글쓰기 ----------------------------------------------------------------
router.get('/new', requireLogin, (req, res) => {
  res.render('write', { post: null, images: [], error: null, categories: CATEGORIES, initialHtml: '' });
});

// 업로드 남용 방지: 한 사람이 10분에 30장까지 (글 한 편 5장 기준 넉넉한 한도)
const uploadHits = new Map(); // userId -> { count, first }
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const UPLOAD_MAX = 30;
function uploadAllowed(userId) {
  const now = Date.now();
  const a = uploadHits.get(userId);
  if (!a || now - a.first > UPLOAD_WINDOW_MS) {
    uploadHits.set(userId, { count: 1, first: now });
    return true;
  }
  a.count += 1;
  return a.count <= UPLOAD_MAX;
}

// 에디터에서 사진을 고르면 즉시 올려 주소를 돌려준다 → 커서 위치에 바로 삽입
router.post('/upload-image', requireLogin, (req, res) => {
  if (!uploadAllowed(req.session.userId)) {
    return res.status(429).json({ error: '사진을 너무 많이 올렸어요. 잠시 후 다시 시도해주세요.' });
  }
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '이미지를 선택해주세요.' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

// 사진은 에디터에서 미리 올라가 본문 안에 들어오므로, 글 저장은 일반 폼 전송으로 처리한다
router.post('/', requireLogin, (req, res) => {
  const title = (req.body.title || '').trim();
  const body = prepareContent(req.body);
  const category = isValidCategory(req.body.category) ? req.body.category : '자유';
  const isAnonymous = req.body.is_anonymous ? 1 : 0;
  const blockComments = req.body.block_comments ? 1 : 0;
  const isNotice = req.body.is_notice && res.locals.me.is_admin ? 1 : 0;
  const fail = (msg) => res.render('write', {
    post: null, images: [], error: msg, categories: CATEGORIES, initialHtml: body.content,
  });

  if (!title || title.length > 50) return fail('제목은 1~50자로 입력해주세요.');
  if (body.empty) return fail('내용을 입력해주세요.');
  if (body.tooLong) return fail('내용은 5,000자 이내로 입력해주세요.');
  if (body.tooManyImages) return fail(`사진은 최대 ${MAX_IMAGES}장까지 넣을 수 있어요.`);

  const info = db.prepare(`
    INSERT INTO posts (user_id, category, title, content, content_format, content_text,
                       is_anonymous, block_comments, is_notice)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.session.userId, category, title, body.content, body.format, body.text,
    isAnonymous, blockComments, isNotice);

  syncPostImages(info.lastInsertRowid, body.format, body.content);

  // 일반글 300P(하루 3개), 익명글 100P(하루 3개)
  if (!isNotice) {
    const r = award(req.session.userId, isAnonymous ? 'anon_post' : 'post');
    req.session.flash = r.limited
      ? '게시글이 등록됐어요. (오늘 게시글 포인트 한도를 모두 받았어요)'
      : `게시글을 등록했어요. +${r.awarded}P 적립됐어요.` + unlockMessage([r]);
  }
  res.redirect(`/board/${info.lastInsertRowid}`);
});

// ---- 상세 ----------------------------------------------------------------
router.get('/:id(\\d+)', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.nickname, u.avatar_id, u.border_id, u.points AS author_points,
      (SELECT COUNT(*) FROM reports r WHERE r.post_id = p.id) AS report_count
    FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(req.params.id);
  if (!post) return res.status(404).render('error', { message: '존재하지 않는 게시글이에요.' });

  // 숨김 처리된 글은 운영자만 열람 가능
  if (post.is_hidden && !(res.locals.me && res.locals.me.is_admin)) {
    return res.status(404).render('error', { message: '운영자에 의해 숨김 처리된 게시글이에요.' });
  }

  // 조회수: 같은 세션에서는 1회만 증가
  req.session.viewed = req.session.viewed || {};
  if (!req.session.viewed[post.id]) {
    db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(post.id);
    req.session.viewed[post.id] = true;
    post.views += 1;
  }

  const images = db.prepare('SELECT * FROM post_images WHERE post_id = ?').all(post.id);
  const uid = req.session.userId || 0;
  const rows = db.prepare(`
    SELECT c.*, u.nickname, u.avatar_id, u.border_id, u.points AS author_points,
      (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
      EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = ?) AS liked
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? ORDER BY c.id`).all(uid, post.id);
  const comments = rows.filter((c) => !c.parent_id)
    .map((c) => ({ ...c, replies: rows.filter((r) => r.parent_id === c.id) }));

  // 베스트댓글: 좋아요 3개 이상인 최상위 댓글 중 상위 2개 (에브리타임식)
  const best = rows.filter((c) => !c.parent_id && !c.is_deleted && c.like_count >= 3)
    .sort((a, b) => b.like_count - a.like_count || a.id - b.id)
    .slice(0, 2);

  const myLike = req.session.userId
    ? db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(post.id, req.session.userId)
    : null;
  const myBookmark = req.session.userId
    ? db.prepare('SELECT 1 FROM bookmarks WHERE post_id = ? AND user_id = ?').get(post.id, req.session.userId)
    : null;

  const prev = db.prepare(
    'SELECT id, title FROM posts WHERE is_notice = 0 AND id < ? ORDER BY id DESC LIMIT 1').get(post.id);
  const next = db.prepare(
    'SELECT id, title FROM posts WHERE is_notice = 0 AND id > ? ORDER BY id LIMIT 1').get(post.id);

  // 링크를 공유했을 때 보일 미리보기 (익명글은 작성자·본문이 드러나지 않게 최소한만)
  const firstImage = post.content_format === 'html'
    ? (usedUploadFiles(post.content)[0] || null)
    : (images[0] && images[0].filename) || null;
  const share = {
    type: 'article',
    title: post.is_hidden ? '포인트라운지' : post.title,
    description: post.is_anonymous || post.is_hidden
      ? '포인트라운지의 게시글이에요.'
      : (post.content_text || htmlToText(post.content) || '').slice(0, 120),
    image: firstImage && !post.is_hidden ? `/uploads/${firstImage}` : null,
  };

  res.render('post', {
    post, images, comments, best, share,
    commentCount: rows.filter((c) => !c.is_deleted).length,
    liked: !!myLike, bookmarked: !!myBookmark, prev, next,
  });
});

// ---- 댓글 좋아요 (포인트 미지급, 순수 소셜 신호) --------------------------------
router.post('/comments/:cid(\\d+)/like', requireLogin, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.cid);
  if (!c) return res.redirect('/board');
  if (c.user_id === req.session.userId) {
    req.session.flash = '내 댓글은 좋아요할 수 없어요.';
  } else {
    const exists = db.prepare('SELECT id FROM comment_likes WHERE comment_id = ? AND user_id = ?')
      .get(c.id, req.session.userId);
    if (exists) {
      db.prepare('DELETE FROM comment_likes WHERE id = ?').run(exists.id);
    } else {
      db.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)').run(c.id, req.session.userId);
    }
  }
  res.redirect(`/board/${c.post_id}#comment-${c.id}`);
});

// ---- 댓글 신고 ------------------------------------------------------------
router.post('/comments/:cid(\\d+)/report', requireLogin, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.cid);
  if (!c) return res.redirect('/board');
  if (c.user_id === req.session.userId) {
    req.session.flash = '내 댓글은 신고할 수 없어요.';
  } else {
    try {
      db.prepare('INSERT INTO comment_reports (comment_id, user_id) VALUES (?, ?)').run(c.id, req.session.userId);
      req.session.flash = '댓글을 신고했어요. 운영자가 확인할 예정이에요.';
    } catch {
      req.session.flash = '이미 신고한 댓글이에요.';
    }
  }
  res.redirect(`/board/${c.post_id}#comment-${c.id}`);
});

// ---- 댓글 수정 --------------------------------------------------------------
// 본인 댓글만 고칠 수 있다. 운영자라도 남의 말을 바꾸는 건 맞지 않아 삭제/숨김만 가능하게 둔다.
router.post('/comments/:cid(\\d+)/edit', requireLogin, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.cid);
  if (!c) return res.redirect('/board');
  if (c.user_id !== req.session.userId) {
    req.session.flash = '내 댓글만 수정할 수 있어요.';
    return res.redirect(`/board/${c.post_id}`);
  }
  const content = (req.body.content || '').trim();
  if (!content || content.length > 1000) {
    req.session.flash = '댓글은 1~1,000자로 입력해주세요.';
  } else if (content === c.content) {
    req.session.flash = '변경된 내용이 없어요.';
  } else {
    db.prepare("UPDATE comments SET content = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(content, c.id);
    req.session.flash = '댓글을 수정했어요.';
  }
  res.redirect(`/board/${c.post_id}#comment-${c.id}`);
});

// ---- 댓글 신고 반려 (운영자) -----------------------------------------------
router.post('/comments/:cid(\\d+)/dismiss-reports', requireLogin, (req, res) => {
  if (!res.locals.me.is_admin) return res.redirect('/board');
  db.prepare('DELETE FROM comment_reports WHERE comment_id = ?').run(req.params.cid);
  req.session.flash = '댓글 신고를 반려했어요.';
  res.redirect('/reports');
});

// ---- 스크랩 ----------------------------------------------------------------
router.post('/:id(\\d+)/bookmark', requireLogin, (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.redirect('/board');
  const exists = db.prepare('SELECT id FROM bookmarks WHERE post_id = ? AND user_id = ?')
    .get(post.id, req.session.userId);
  if (exists) {
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(exists.id);
    req.session.flash = '스크랩을 해제했어요.';
  } else {
    db.prepare('INSERT INTO bookmarks (post_id, user_id) VALUES (?, ?)').run(post.id, req.session.userId);
    req.session.flash = '스크랩했어요. 마이페이지에서 모아볼 수 있어요.';
  }
  res.redirect(`/board/${post.id}`);
});

// ---- 추천 ----------------------------------------------------------------
router.post('/:id(\\d+)/like', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.redirect('/board');

  // 익명글은 추천 비활성화, 내 글은 추천 불가 (기획안의 익명글 규칙)
  if (post.is_anonymous) {
    req.session.flash = '익명글은 추천할 수 없어요.';
  } else if (post.user_id === req.session.userId) {
    req.session.flash = '내가 쓴 글은 추천할 수 없어요.';
  } else {
    try {
      db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(post.id, req.session.userId);
      db.prepare('UPDATE posts SET like_count = like_count + 1 WHERE id = ?').run(post.id);
      award(post.user_id, 'like_received', `추천받기 (게시글 #${post.id})`);
      notify(post.user_id, req.session.userId,
        `${res.locals.me.nickname}님이 회원님의 글을 추천했어요. (+10P)`, `/board/${post.id}`);
      req.session.flash = '추천했어요. 작성자에게 +10P가 적립됐어요.';

      // 추천 10개 이상이면 인기글 선정 (+1,000P, 최초 1회)
      const likeCount = db.prepare('SELECT like_count FROM posts WHERE id = ?').get(post.id).like_count;
      if (likeCount >= 10 && !post.is_popular) {
        db.prepare('UPDATE posts SET is_popular = 1 WHERE id = ?').run(post.id);
        award(post.user_id, 'popular', `인기글 선정 (게시글 #${post.id})`);
        notify(post.user_id, 0, '회원님의 글이 인기글로 선정됐어요. (+1,000P)', `/board/${post.id}`);
      }
    } catch {
      req.session.flash = '이미 추천한 글이에요.';
    }
  }
  res.redirect(`/board/${post.id}`);
});

// ---- 댓글 ----------------------------------------------------------------
router.post('/:id(\\d+)/comments', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.redirect('/board');
  if (post.block_comments) {
    req.session.flash = '댓글이 차단된 게시글이에요.';
    return res.redirect(`/board/${post.id}`);
  }
  const content = (req.body.content || '').trim();
  if (!content || content.length > 1000) {
    req.session.flash = '댓글은 1~1,000자로 입력해주세요.';
    return res.redirect(`/board/${post.id}`);
  }
  const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
  if (parentId) {
    const parent = db.prepare('SELECT id, post_id, parent_id FROM comments WHERE id = ?').get(parentId);
    if (!parent || parent.post_id !== post.id || parent.parent_id) {
      req.session.flash = '답글을 달 수 없는 댓글이에요.';
      return res.redirect(`/board/${post.id}`);
    }
  }
  db.prepare('INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)')
    .run(post.id, req.session.userId, parentId, content);

  // 글 작성자에게 알림, 답글이면 원 댓글 작성자에게도 알림 (중복 제외)
  const myName = res.locals.me.nickname;
  notify(post.user_id, req.session.userId,
    `${myName}님이 회원님의 글에 댓글을 남겼어요.`, `/board/${post.id}`);
  if (parentId) {
    const parentAuthor = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parentId).user_id;
    if (parentAuthor !== post.user_id) {
      notify(parentAuthor, req.session.userId,
        `${myName}님이 회원님의 댓글에 답글을 남겼어요.`, `/board/${post.id}`);
    }
  }

  const r = award(req.session.userId, 'comment'); // 댓글 100P, 하루 10개까지
  req.session.flash = r.limited
    ? '댓글이 등록됐어요. (오늘 댓글 포인트 한도를 모두 받았어요)'
    : `댓글을 등록했어요. +${r.awarded}P 적립됐어요.` + unlockMessage([r]);
  res.redirect(`/board/${post.id}#comments`);
});

router.post('/comments/:cid(\\d+)/delete', requireLogin, (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.cid);
  if (c && (c.user_id === req.session.userId || res.locals.me.is_admin)) {
    // 답글이 달려 있으면 흔적만 남긴다. 통째로 지우면 남이 단 답글까지 함께 사라진다.
    const replies = db.prepare('SELECT COUNT(*) AS c FROM comments WHERE parent_id = ? AND is_deleted = 0')
      .get(c.id).c;
    if (replies > 0) {
      db.prepare("UPDATE comments SET is_deleted = 1, content = '' WHERE id = ?").run(c.id);
      req.session.flash = '댓글을 삭제했어요. (답글이 있어 자리는 남겨둬요)';
    } else {
      db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
      req.session.flash = '댓글을 삭제했어요.';
      // 흔적만 남아 있던 부모에 답글이 하나도 안 남았다면 부모도 정리한다
      if (c.parent_id) {
        const parent = db.prepare('SELECT * FROM comments WHERE id = ?').get(c.parent_id);
        const left = db.prepare('SELECT COUNT(*) AS c FROM comments WHERE parent_id = ?').get(c.parent_id).c;
        if (parent && parent.is_deleted && left === 0) {
          db.prepare('DELETE FROM comments WHERE id = ?').run(parent.id);
        }
      }
    }
  }
  if (req.body.back === 'reports') return res.redirect('/reports');
  res.redirect(c ? `/board/${c.post_id}` : '/board');
});

// ---- 수정 / 삭제 ------------------------------------------------------------
router.get('/:id(\\d+)/edit', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || post.user_id !== req.session.userId) return res.redirect('/board');
  const images = db.prepare('SELECT * FROM post_images WHERE post_id = ?').all(post.id);
  res.render('write', {
    post, images, error: null, categories: CATEGORIES,
    initialHtml: editableHtml(post, images),
  });
});

router.post('/:id(\\d+)/edit', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || post.user_id !== req.session.userId) return res.redirect('/board');

  const title = (req.body.title || '').trim();
  const body = prepareContent(req.body);
  const category = isValidCategory(req.body.category) ? req.body.category : post.category;
  const fail = (msg) => res.render('write', {
    post, images: db.prepare('SELECT * FROM post_images WHERE post_id = ?').all(post.id),
    error: msg, categories: CATEGORIES, initialHtml: body.content,
  });
  if (!title || title.length > 50 || body.empty || body.tooLong) {
    return fail('제목(50자)과 내용(5,000자)을 확인해주세요.');
  }
  if (body.tooManyImages) return fail(`사진은 최대 ${MAX_IMAGES}장까지 넣을 수 있어요.`);

  db.prepare(`UPDATE posts SET category = ?, title = ?, content = ?, content_format = ?,
              content_text = ?, block_comments = ?,
              updated_at = datetime('now', 'localtime') WHERE id = ?`)
    .run(category, title, body.content, body.format, body.text,
      req.body.block_comments ? 1 : 0, post.id);
  // 본문에서 빠진 사진은 여기서 정리된다 (에디터에서 지우면 파일도 삭제)
  syncPostImages(post.id, body.format, body.content);
  req.session.flash = '게시글을 수정했어요.';
  res.redirect(`/board/${post.id}`);
});

router.post('/:id(\\d+)/delete', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (post && (post.user_id === req.session.userId || res.locals.me.is_admin)) {
    db.prepare('SELECT filename FROM post_images WHERE post_id = ?').all(post.id)
      .forEach((i) => fs.rm(path.join(UPLOAD_DIR, i.filename), { force: true }, () => {}));
    // 이 글을 가리키던 알림도 함께 지운다. 남겨두면 눌렀을 때 없는 글로 빠진다.
    db.prepare('DELETE FROM notifications WHERE link = ?').run(`/board/${post.id}`);
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    req.session.flash = '게시글을 삭제했어요.';
  }
  // 신고 관리 페이지에서 삭제한 경우 그 목록으로 복귀
  res.redirect(req.body.back === 'reports' ? '/reports' : '/board');
});

// ---- 신고 / 운영자 추천 ------------------------------------------------------
router.post('/:id(\\d+)/report', requireLogin, (req, res) => {
  try {
    db.prepare('INSERT INTO reports (post_id, user_id) VALUES (?, ?)')
      .run(req.params.id, req.session.userId);
    req.session.flash = '신고가 접수됐어요. 운영자가 확인할 예정이에요.';
  } catch {
    req.session.flash = '이미 신고한 게시글이에요.';
  }
  res.redirect(`/board/${req.params.id}`);
});

router.post('/:id(\\d+)/admin-pick', requireLogin, (req, res) => {
  if (!res.locals.me.is_admin) return res.redirect('/board');
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (post && !post.admin_picked) {
    db.prepare('UPDATE posts SET admin_picked = 1 WHERE id = ?').run(post.id);
    award(post.user_id, 'admin_pick', `운영자 추천글 선정 (게시글 #${post.id})`);
    notify(post.user_id, req.session.userId,
      '회원님의 글이 운영자 추천글로 선정됐어요. (+1,500P)', `/board/${post.id}`);
    req.session.flash = '운영자 추천글로 선정했어요. 작성자에게 +1,500P 지급!';
  }
  res.redirect(`/board/${post ? post.id : ''}`);
});

// ---- 신고 반려 (운영자): 글은 두고 신고 기록만 정리 -----------------------------
router.post('/:id(\\d+)/dismiss-reports', requireLogin, (req, res) => {
  if (!res.locals.me.is_admin) return res.redirect('/board');
  db.prepare('DELETE FROM reports WHERE post_id = ?').run(req.params.id);
  req.session.flash = '신고를 반려하고 처리를 종료했어요.';
  res.redirect(req.body.back === 'reports' ? '/reports' : `/board/${req.params.id}`);
});

// ---- 숨김 처리 / 복구 (운영자) ------------------------------------------------
router.post('/:id(\\d+)/hide', requireLogin, (req, res) => {
  if (!res.locals.me.is_admin) return res.redirect('/board');
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (post) {
    const next = post.is_hidden ? 0 : 1;
    db.prepare('UPDATE posts SET is_hidden = ? WHERE id = ?').run(next, post.id);
    req.session.flash = next ? '게시글을 숨김 처리했어요.' : '게시글 숨김을 해제했어요.';
    if (next) { // 숨기면 신고도 처리 완료로 간주해 정리
      db.prepare('DELETE FROM reports WHERE post_id = ?').run(post.id);
    }
  }
  res.redirect(req.body.back === 'reports' ? '/reports' : `/board/${req.params.id}`);
});

module.exports = router;
