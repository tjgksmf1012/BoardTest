// 게시판: 목록 / 글쓰기 / 상세 / 수정 / 삭제 / 추천 / 댓글 / 신고 / 운영자 기능
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { award, unlockMessage } = require('../points');

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
    return res.redirect('/login');
  }
  next();
}

const PAGE_SIZE = 10;

// ---- 목록 ----------------------------------------------------------------
router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const q = (req.query.q || '').trim();

  const notices = db.prepare(`
    SELECT p.*, u.nickname, u.avatar_id, u.border_id,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.is_notice = 1 ORDER BY p.id DESC`).all();

  const where = q ? `AND (p.title LIKE @like OR p.content LIKE @like)` : '';
  const params = { like: `%${q}%`, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
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
    ORDER BY p.id DESC LIMIT @limit OFFSET @offset`).all(params);

  res.render('board', {
    notices, posts, page, q,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

// ---- 글쓰기 ----------------------------------------------------------------
router.get('/new', requireLogin, (req, res) => {
  res.render('write', { post: null, images: [], error: null });
});

router.post('/', requireLogin, (req, res) => {
  upload.array('images', 5)(req, res, (err) => {
    if (err) return res.render('write', { post: null, images: [], error: err.message });

    const title = (req.body.title || '').trim();
    const content = (req.body.content || '').trim();
    const isAnonymous = req.body.is_anonymous ? 1 : 0;
    const blockComments = req.body.block_comments ? 1 : 0;
    const isNotice = req.body.is_notice && res.locals.me.is_admin ? 1 : 0;

    if (!title || title.length > 50) {
      return res.render('write', { post: null, images: [], error: '제목은 1~50자로 입력해주세요.' });
    }
    if (!content || content.length > 5000) {
      return res.render('write', { post: null, images: [], error: '내용은 1~5,000자로 입력해주세요.' });
    }

    const info = db.prepare(`
      INSERT INTO posts (user_id, title, content, is_anonymous, block_comments, is_notice)
      VALUES (?, ?, ?, ?, ?, ?)`
    ).run(req.session.userId, title, content, isAnonymous, blockComments, isNotice);

    const insertImage = db.prepare('INSERT INTO post_images (post_id, filename) VALUES (?, ?)');
    (req.files || []).forEach((f) => insertImage.run(info.lastInsertRowid, f.filename));

    // 일반글 300P(하루 3개), 익명글 100P(하루 3개)
    if (!isNotice) {
      const r = award(req.session.userId, isAnonymous ? 'anon_post' : 'post');
      req.session.flash = r.limited
        ? '게시글이 등록됐어요. (오늘 게시글 포인트 한도를 모두 받았어요)'
        : `📝 게시글 등록! +${r.awarded}P 적립됐어요.` + unlockMessage([r]);
    }
    res.redirect(`/board/${info.lastInsertRowid}`);
  });
});

// ---- 상세 ----------------------------------------------------------------
router.get('/:id(\\d+)', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.nickname, u.avatar_id, u.border_id,
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
  const rows = db.prepare(`
    SELECT c.*, u.nickname, u.avatar_id, u.border_id
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.post_id = ? ORDER BY c.id`).all(post.id);
  const comments = rows.filter((c) => !c.parent_id)
    .map((c) => ({ ...c, replies: rows.filter((r) => r.parent_id === c.id) }));

  const myLike = req.session.userId
    ? db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(post.id, req.session.userId)
    : null;

  const prev = db.prepare(
    'SELECT id, title FROM posts WHERE is_notice = 0 AND id < ? ORDER BY id DESC LIMIT 1').get(post.id);
  const next = db.prepare(
    'SELECT id, title FROM posts WHERE is_notice = 0 AND id > ? ORDER BY id LIMIT 1').get(post.id);

  res.render('post', {
    post, images, comments,
    commentCount: rows.length,
    liked: !!myLike, prev, next,
  });
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
      req.session.flash = '👍 추천했어요! 작성자에게 +10P 가 적립됐어요.';

      // 추천 10개 이상이면 인기글 선정 (+1,000P, 최초 1회)
      const likeCount = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(post.id).c;
      if (likeCount >= 10 && !post.is_popular) {
        db.prepare('UPDATE posts SET is_popular = 1 WHERE id = ?').run(post.id);
        award(post.user_id, 'popular', `인기글 선정 (게시글 #${post.id})`);
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

  const r = award(req.session.userId, 'comment'); // 댓글 100P, 하루 10개까지
  req.session.flash = r.limited
    ? '댓글이 등록됐어요. (오늘 댓글 포인트 한도를 모두 받았어요)'
    : `💬 댓글 등록! +${r.awarded}P 적립됐어요.` + unlockMessage([r]);
  res.redirect(`/board/${post.id}`);
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
  res.render('write', { post, images, error: null });
});

router.post('/:id(\\d+)/edit', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || post.user_id !== req.session.userId) return res.redirect('/board');

  upload.array('images', 5)(req, res, (err) => {
    const images = () => db.prepare('SELECT * FROM post_images WHERE post_id = ?').all(post.id);
    if (err) return res.render('write', { post, images: images(), error: err.message });

    const title = (req.body.title || '').trim();
    const content = (req.body.content || '').trim();
    if (!title || title.length > 50 || !content || content.length > 5000) {
      return res.render('write', { post, images: images(), error: '제목(50자)과 내용(5,000자)을 확인해주세요.' });
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

    db.prepare(`UPDATE posts SET title = ?, content = ?, block_comments = ?,
                updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(title, content, req.body.block_comments ? 1 : 0, post.id);
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
  res.redirect('/board');
});

// ---- 신고 / 운영자 추천 ------------------------------------------------------
router.post('/:id(\\d+)/report', requireLogin, (req, res) => {
  try {
    db.prepare('INSERT INTO reports (post_id, user_id) VALUES (?, ?)')
      .run(req.params.id, req.session.userId);
    req.session.flash = '🚨 신고가 접수됐어요. 운영자가 확인할 예정이에요.';
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
    req.session.flash = '⭐ 운영자 추천글로 선정했어요. 작성자에게 +1,500P 지급!';
  }
  res.redirect(`/board/${post ? post.id : ''}`);
});

module.exports = router;
