// 서식 있는 본문(HTML) 처리: 저장 전 정화(sanitize) + 목록/검색용 평문 추출
//
// 에디터가 보낸 HTML은 절대 그대로 믿지 않는다. 아래 허용 목록에 없는 태그·속성은
// 전부 제거하고, 이미지는 우리 업로드 경로만 허용해 외부 추적·XSS를 차단한다.
const sanitizeHtml = require('sanitize-html');

// 본문에서 쓸 수 있는 서식만 남긴다 (style 속성은 통째로 불허 — CSS 기반 공격 차단)
const OPTIONS = {
  allowedTags: [
    'p', 'br', 'div',
    'strong', 'b', 'em', 'i', 'u', 's',
    'h2', 'h3', 'blockquote',
    'ul', 'ol', 'li',
    'a', 'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'loading'],
  },
  // 링크는 평범한 웹 주소만 (javascript: 등 차단)
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  disallowedTagsMode: 'discard',
  transformTags: {
    // 외부 링크는 새 탭으로 열되, 원본 탭 탈취(tabnabbing)를 막는다
    a: (tagName, attribs) => {
      const href = attribs.href || '';
      if (!href) return { tagName: 'span', attribs: {} };
      return { tagName: 'a', attribs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } };
    },
    // 이미지는 우리 서버에 업로드된 것만 허용 (외부 URL·data: 전부 제거)
    img: (tagName, attribs) => {
      const src = attribs.src || '';
      if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(src)) return { tagName: 'span', attribs: {} };
      return { tagName: 'img', attribs: { src, alt: attribs.alt || '첨부 이미지', loading: 'lazy' } };
    },
  },
};

function sanitizePostHtml(html) {
  return sanitizeHtml(String(html || ''), OPTIONS).trim();
}

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

// 목록 미리보기·검색·글자수 계산에 쓸 평문. 블록 태그는 공백으로 끊어 단어가 붙지 않게 한다.
function htmlToText(html) {
  const spaced = String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h2|h3|li|blockquote|ul|ol)>/gi, ' ');
  const stripped = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&[a-z#0-9]+;/gi, (m) => (ENTITIES[m.toLowerCase()] !== undefined ? ENTITIES[m.toLowerCase()] : m))
    .replace(/\s+/g, ' ')
    .trim();
}

// 옛 평문 글을 에디터에서 열 수 있게 문단 HTML로 바꾼다
function textToHtml(text) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>') || '<br>'}</p>`)
    .join('');
}

// 본문에 실제로 남아 있는 업로드 이미지 파일명 목록 (글 삭제 시 파일 정리에 쓴다)
function usedUploadFiles(html) {
  const names = [];
  const re = /<img[^>]+src="\/uploads\/([A-Za-z0-9._-]+)"/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

module.exports = { sanitizePostHtml, htmlToText, textToHtml, usedUploadFiles };
