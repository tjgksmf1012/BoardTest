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

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
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
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.is_notice = 1 ORDER BY p.id DESC`).all();

  const where = (q ? `AND (p.title LIKE @like OR p.content LIKE @like)` : '')
    + (hot ? ' AND p.is_popular = 1' : '')
    + (category ? ' AND p.category = @category' : '');
  const orderBy = sort === 'likes' ? 'like_count DESC, p.id DESC'
    : sort === 'views' ? 'p.views DESC, p.id DESC'
    : 'p.id DESC';
  const params = { like: `%${q}%`, category, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const total = db.prepare(
    `SELECT COUNT(*) AS c FROM posts p WHERE p.is_notice = 0 ${where}`
  ).get(params).c;
  const posts = db.prepare(`
    SELECT p.*, u.nickname, u.avatar_id, u.border_id,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM post_images i WHERE i.post_id = p.id) AS image_count
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.is_notice = 0 ${where}
    ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`).all(params);

  // 🔥 지금 뜨는 글: 최근 7일 내 추천 많은 글 상위 5개 (첫 페이지·검색/필터 없을 때만)
  let trending = [];
  if (page === 1 && !q && !hot && !category) {
    trending = db.prepare(`
      SELECT p.id, p.title,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
      FROM posts p
      WHERE p.is_notice = 0 AND p.is_anonymous = 0
        AND p.created_at >= datetime('now', 'localtime', '-7 days')
      ORDER BY like_count DESC, p.id DESC LIMIT 5`).all()
      .filter((t) => t.like_count > 0);
  }

  res.render('board', {
    notices, posts, page, q, sort, hot, trending, category, categories: CATEGORIES,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

// ---- 글쓰기 ----------------------------------------------------------------
router.get('/new', requireLogin, (req, res) => {
  res.render('write', { post: null, images: [], error: null, categories: CATEGORIES });
});

router.post('/', requireLogin, (req, res) => {
  upload.array('images', 5)(req, res, (err) => {
    const fail = (msg) => res.render('write', { post: null, images: [], error: msg, categories: CATEGORIES });
    if (err) return fail(err.message);

    const title = (req.body.title || '').trim();
    const content = (req.body.content || '').trim();
    const category = isValidCategory(req.body.category) ? req.body.category : '자유';
    const isAnonymous = req.body.is_anonymous ? 1 : 0;
    const blockComments = req.body.block_comments ? 1 : 0;
    const isNotice = req.body.is_notice && res.locals.me.is_admin ? 1 : 0;

    if (!title || title.length > 50) return fail('제목은 1~50자로 입력해주세요.');
    if (!content || content.length > 5000) return fail('내용은 1~5,000자로 입력해주세요.');

    const info = db.prepare(`
      INSERT INTO posts (user_id, category, title, content, is_anonymous, block_comments, is_notice)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(req.session.userId, category, title, content, isAnonymous, blockComments, isNotice);

    const insertImage = db.prepare('INSERT INTO post_images (post_id, filename) VALUES (?, ?)');
    (req.files || []).forEach((f) => insertImage.run(info.lastInsertRowid, f.filename));

    // 일반글 300P(하루 3개), 익명글 100P(하루 3개)
    if (!isNotice) {
      const r = award(req.session.userId, isAnonymous ? 'anon_post' : 'post');
      req.session.flash = r.limited
        ? '게시글이 등록됐어요. (오늘 게시글 포인트 한도를 모두 받았어요)'
        : `게시글을 등록했어요. +${r.awarded}P 적립됐어요.` + unlockMessage([r]);
    }
    res.redirect(`/board/${info.lastInsertRowid}`);
  });
});

// ---- 상세 ----------------------------------------------------------------
router.get('/:id(\\d+)', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.nickname, u.avatar_id, u.border_id, u.points AS author_points,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM reports r WHERE r.post_id = p.id) AS report_count
    FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`).get(req.params.id);
  if (!post) return res.status(404).render('error', { message: '존재하지 않는 게시글이에요.' });

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
  const best = rows.filter((c) => !c.parent_id && c.like_count >= 3)
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

  res.render('post', {
    post, images, comments, best,
    commentCount: rows.length,
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
      award(post.user_id, 'like_received', `추천받기 (게시글 #${post.id})`);
      notify(post.user_id, req.session.userId,
        `${res.locals.me.nickname}님이 회원님의 글을 추천했어요. (+10P)`, `/board/${post.id}`);
      req.session.flash = '추천했어요. 작성자에게 +10P가 적립됐어요.';

      // 추천 10개 이상이면 인기글 선정 (+1,000P, 최초 1회)
      const likeCount = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(post.id).c;
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
    db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
    req.session.flash = '댓글을 삭제했어요.';
  }
  res.redirect(c ? `/board/${c.post_id}` : '/board');
});

// ---- 수정 / 삭제 ------------------------------------------------------------
router.get('/:id(\\d+)/edit', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || post.user_id !== req.session.userId) return res.redirect('/board');
  const images = db.prepare('SELECT * FROM post_images WHERE post_id = ?').all(post.id);
  res.render('write', { post, images, error: null, categories: CATEGORIES });
});

router.post('/:id(\\d+)/edit', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || post.user_id !== req.session.userId) return res.redirect('/board');

  upload.array('images', 5)(req, res, (err) => {
    const images = () => db.prepare('SELECT * FROM post_images WHERE post_id = ?').all(post.id);
    const fail = (msg) => res.render('write', { post, images: images(), error: msg, categories: CATEGORIES });
    if (err) return fail(err.message);

    const title = (req.body.title || '').trim();
    const content = (req.body.content || '').trim();
    const category = isValidCategory(req.body.category) ? req.body.category : post.category;
    if (!title || title.length > 50 || !content || content.length > 5000) {
      return fail('제목(50자)과 내용(5,000자)을 확인해주세요.');
    }

    // 삭제 체크된 기존 이미지 제거
    const removeIds = [].concat(req.body.remove_images || []).map(Number).filter(Boolean);
    removeIds.forEach((id) => {
      const img = db.prepare('SELECT * FROM post_images WHERE id = ? AND post_id = ?').get(id, post.id);
      if (img) {
        fs.rm(path.join(UPLOAD_DIR, img.filename), { force: true }, () => {});
        db.prepare('DELETE FROM post_images WHERE id = ?').run(img.id);
      }
    });

    // 새 이미지 추가 (총 5장 초과분은 버림)
    const remain = 5 - db.prepare('SELECT COUNT(*) AS c FROM post_images WHERE post_id = ?').get(post.id).c;
    const insertImage = db.prepare('INSERT INTO post_images (post_id, filename) VALUES (?, ?)');
    (req.files || []).forEach((f, i) => {
      if (i < remain) insertImage.run(post.id, f.filename);
      else fs.rm(path.join(UPLOAD_DIR, f.filename), { force: true }, () => {});
    });

    db.prepare(`UPDATE posts SET category = ?, title = ?, content = ?, block_comments = ?,
                updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(category, title, content, req.body.block_comments ? 1 : 0, post.id);
    req.session.flash = '게시글을 수정했어요.';
    res.redirect(`/board/${post.id}`);
  });
});

router.post('/:id(\\d+)/delete', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (post && (post.user_id === req.session.userId || res.locals.me.is_admin)) {
    db.prepare('SELECT filename FROM post_images WHERE post_id = ?').all(post.id)
      .forEach((i) => fs.rm(path.join(UPLOAD_DIR, i.filename), { force: true }, () => {}));
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

module.exports = router;
