// CSRF(교차 사이트 요청 위조) 방어
//
// 쿠키가 SameSite=Lax라 다른 사이트에서 보낸 POST에는 이미 쿠키가 붙지 않는다.
// 다만 그건 브라우저 동작에 기대는 방어라, 표준대로 토큰도 함께 확인한다.
// 세션마다 무작위 토큰을 하나 만들어 두고, 모든 쓰기 요청에 같은 값이 실렸는지 본다.
const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function makeToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// 길이가 달라도 예외 없이 false를 돌려주는 상수 시간 비교
function sameToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// (1) 토큰 발급 — 화면을 그리기 전에 필요하므로 가장 앞쪽에 둔다.
//     어떤 화면이든 <%= csrfToken %>·<%- csrfField() %>를 쓸 수 있게 보장한다.
function csrfToken() {
  return function issueToken(req, res, next) {
    if (req.session) {
      if (!req.session.csrf) req.session.csrf = makeToken();
      res.locals.csrfToken = req.session.csrf;
    } else {
      res.locals.csrfToken = '';
    }
    const token = res.locals.csrfToken;
    res.locals.csrfField = () => `<input type="hidden" name="_csrf" value="${token}">`;
    next();
  };
}

// (2) 검증 — 라우트 바로 앞에 둔다.
//     막힐 때 보여줄 오류 화면도 상단바를 그리므로, 공통 데이터가 채워진 뒤여야 한다.
function csrfVerify() {
  return function verifyToken(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!req.session) return next();

    const sent = (req.body && req.body._csrf)
      || req.get('X-CSRF-Token')
      || req.get('X-Csrf-Token');

    if (!sameToken(sent, req.session.csrf)) {
      // 화면을 오래 열어두면 세션이 바뀌어 토큰이 어긋날 수 있으므로 안내를 남긴다
      if (req.get('Accept') === 'application/json') {
        return res.status(403).json({ error: '요청이 만료됐어요. 새로고침 후 다시 시도해주세요.' });
      }
      return res.status(403).render('error', {
        message: '요청이 만료됐거나 올바르지 않아요. 새로고침 후 다시 시도해주세요.',
      });
    }
    next();
  };
}

module.exports = { csrfToken, csrfVerify, makeToken, sameToken };
