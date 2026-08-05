// 서식 본문 정화(sanitize)·평문 추출 테스트 — XSS 차단이 핵심
const test = require('node:test');
const assert = require('node:assert');

const { sanitizePostHtml, htmlToText, textToHtml, usedUploadFiles } = require('../src/richtext');

test('스크립트와 이벤트 핸들러는 제거된다', () => {
  assert.equal(sanitizePostHtml('<p>안녕</p><script>alert(1)</script>'), '<p>안녕</p>');
  assert.equal(sanitizePostHtml('<p onclick="alert(1)">눌러</p>'), '<p>눌러</p>');
  assert.ok(!sanitizePostHtml('<img src="/uploads/a.png" onerror="alert(1)">').includes('onerror'));
});

test('허용하지 않은 태그는 통째로 사라진다', () => {
  assert.equal(sanitizePostHtml('<iframe src="https://evil.com"></iframe>'), '');
  assert.equal(sanitizePostHtml('<style>body{display:none}</style>'), '');
  // style 속성도 불허 (화면을 덮는 식의 공격 차단)
  assert.ok(!sanitizePostHtml('<p style="position:fixed">x</p>').includes('style'));
});

test('이미지는 우리 업로드 경로만 허용한다', () => {
  assert.ok(sanitizePostHtml('<img src="/uploads/pic-1.png">').includes('src="/uploads/pic-1.png"'));
  assert.equal(sanitizePostHtml('<img src="https://evil.com/track.gif">'), '');
  assert.equal(sanitizePostHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">'), '');
  assert.equal(sanitizePostHtml('<img src="/uploads/../../etc/passwd">'), '');
});

test('javascript: 링크는 주소가 제거된다', () => {
  assert.ok(!sanitizePostHtml('<a href="javascript:alert(1)">x</a>').includes('javascript'));
  const ok = sanitizePostHtml('<a href="https://naver.com">네이버</a>');
  assert.ok(ok.includes('href="https://naver.com"'));
  assert.ok(ok.includes('rel="noopener noreferrer nofollow"'), '외부 링크는 안전 속성이 붙어야 한다');
});

test('정상 서식은 그대로 남는다', () => {
  const out = sanitizePostHtml('<h2>제목</h2><p><strong>굵게</strong><u>밑줄</u></p><ul><li>항목</li></ul>');
  ['<h2>', '<strong>', '<u>', '<ul>', '<li>'].forEach((t) => assert.ok(out.includes(t), t));
});

test('평문 추출은 태그를 지우고 블록을 띄어쓴다', () => {
  assert.equal(htmlToText('<h2>제목</h2><p>첫줄</p><p>둘째줄</p>'), '제목 첫줄 둘째줄');
  assert.equal(htmlToText('<p>줄1<br>줄2</p>'), '줄1 줄2');
  assert.equal(htmlToText('<p>&amp;&lt;태그&gt;</p>'), '&<태그>');
});

test('옛 평문 글은 문단 HTML로 바뀌고 태그 문자는 이스케이프된다', () => {
  assert.equal(textToHtml('첫 줄\n둘째 줄'), '<p>첫 줄<br>둘째 줄</p>');
  assert.equal(textToHtml('문단1\n\n문단2'), '<p>문단1</p><p>문단2</p>');
  assert.ok(textToHtml('<b>진짜태그아님</b>').includes('&lt;b&gt;'));
});

test('본문에 쓰인 업로드 파일명을 중복 없이 뽑는다', () => {
  const files = usedUploadFiles('<img src="/uploads/a.png"><img src="/uploads/b.png"><img src="/uploads/a.png">');
  assert.deepEqual(files, ['a.png', 'b.png']);
});
