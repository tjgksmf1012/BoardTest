# 포인트라운지 설계 문서

글을 쓰고 댓글을 달고 출석하면 포인트가 쌓이고, 그 포인트로 아바타를 키우는 커뮤니티
게시판입니다. 이 문서는 무엇을 어떻게 만들었는지 한눈에 보시라고 정리해 둔 것입니다.
읽는 순서는 상관없고 필요한 장만 보시면 됩니다.

## 1. 개요
- 요구사항: 게시판에 포인트를 붙이고, 포인트가 쌓이면 아바타가 좋아지게 (캐릭터는 예시가
  아니라 새로 만든 것)
- 형태: 서버에서 화면을 그려 보내는 웹앱. 휴대폰과 컴퓨터 둘 다 맞게 나옵니다
- 데모 계정: 운영자 `admin`/`admin1234`, 회원 `cherry`·`mint`·`street`·`gold`/`test1234`

## 2. 기술 스택
| 구분 | 사용 |
|---|---|
| 런타임 | Node.js 20+ |
| 서버 | Express 4 |
| DB | SQLite (better-sqlite3), 파일 1개로 동작 + 인덱스 |
| 뷰 | EJS(SSR) + 순수 CSS |
| 세션 | express-session + SQLite 저장소 (재기동해도 로그인 유지) |
| 업로드 | multer (형식·용량·개수 검증) |
| 테스트 | node --test (단위 + HTTP 통합, 207개) |
| CI | GitHub Actions (Node 20·22) |

## 3. 기능 목록
- **회원**: 가입(+1,000P)·로그인·로그아웃, 아이디/닉네임 검증, 로그인 무차별 대입 방어
- **게시판**: 목록(공지 고정·검색·미리보기·상대시간, 한 쪽 15개), 말머리 3종(자유·질문·이벤트)·필터,
  정렬(최신·추천·조회, 전체 기간), 상세(조회수), 작성/수정/삭제, 이미지 첨부(≤5장, 미리보기·삭제),
  익명 작성, 댓글 차단, 스크랩
- **댓글**: 대댓글, 댓글 좋아요, 베스트댓글(좋아요 5↑ 중 상위 2개, 맨 위로 이동·복사 아님), 신고
- **포인트**: 가입·출석·글·댓글·추천받기·인기글·운영자추천·연속출석(3/7/30일), 하루 한도
- **아바타**: 기본 12종(무료) → 스페셜 헤어(5,000P) → 프리미엄 의상(10,000P) →
  움직이는 테두리(20,000P) → 이벤트 한정(시즌). 코드 SVG 기본, `public/avatars/<id>.png` 있으면 이미지로 대체
- **레벨/배지**: 누적 포인트 레벨(새싹→전설), 업적 배지 8종
- **알림**: 추천·댓글·답글·인기글·운영자추천 시 발송, 벨 뱃지·자동 읽음
- **랭킹**: 포인트 TOP 20 (여성회원만 — 남성·업소 회원과 운영자는 제외)
- **출석**: 그날 첫 접속 시 출석부 팝업이 뜨며 확인 절차 없이 바로 출석 처리(fetch).
  최근 7일 도장판·연속일수·적립 포인트를 애니메이션으로 보여주고, 기록(캘린더·
  연속 출석 보너스)은 마이페이지 '출석' 탭
- **운영자**: 공지, 운영자 추천글, 게시글 숨김/복구, 삭제, 신고 관리(글·댓글 반려/숨김/삭제),
  회원 관리(제재/해제)
- **글쓰기**: 서식 에디터(제목·굵게·밑줄·목록·인용)와 **커서 위치 사진 삽입**.
  본문은 `content_format`으로 구분해 `html`은 정화 후 출력, 옛 `text`는 이스케이프 출력.
  목록은 평문 사본(`content_text`)을 사용.
  검색은 FTS5 바이그램 색인(`posts_fts`, `src/search.js`)으로 후보를 좁힌 뒤 원문 대조.
  **닉네임으로도 찾을 수 있고, 익명 글은 닉네임으로 안 걸린다**(누가 썼는지 드러나면 안 되므로)
- **접근성/보안**: WCAG AA 색 대비, 키보드 포커스, 모션 최소화 존중,
  보안 헤더·SameSite 쿠키·CSRF 토큰(`src/csrf.js`)·파라미터 바인딩·XSS 이스케이프·오픈리다이렉트 차단,
  서식 본문은 `sanitize-html` 허용목록으로 정화(스크립트·style·iframe 제거, 이미지·링크 출처 제한),
  로그인·가입 시 세션 재발급(세션 고정 방어), 검색어의 LIKE 와일드카드 이스케이프,
  업로드 횟수 제한 + 고아 파일 주기적 정리(`src/uploads-gc.js`)

## 4. 데이터 모델 (SQLite)
```
users(id, username, password_hash, nickname, points, avatar_id, border_id,
      is_admin, is_banned, created_at)
posts(id, user_id→users, category, title, content, is_anonymous, block_comments,
      is_notice, is_hidden, is_popular, admin_picked, views, created_at, updated_at)
post_images(id, post_id→posts, filename)
comments(id, post_id→posts, user_id→users, parent_id→comments, content, created_at)
likes(id, post_id→posts, user_id→users)                 -- UNIQUE(post_id,user_id)
comment_likes(id, comment_id→comments, user_id→users)    -- UNIQUE(comment_id,user_id)
bookmarks(id, user_id→users, post_id→posts)              -- UNIQUE(user_id,post_id)
attendance(id, user_id→users, day)                       -- UNIQUE(user_id,day)
point_logs(id, user_id→users, amount, reason, detail, created_at)
notifications(id, user_id→users, message, link, is_read, created_at)
reports(id, post_id→posts, user_id→users)                -- UNIQUE(post_id,user_id)
comment_reports(id, comment_id→comments, user_id→users)  -- UNIQUE(comment_id,user_id)
```
- 게시글 삭제 시 이미지·댓글·추천·신고·스크랩은 ON DELETE CASCADE로 정리
- 자주 조회하는 컬럼(목록·post_id·user_id 등)에 인덱스 11종

## 5. 주요 라우트
| 메서드·경로 | 설명 |
|---|---|
| `GET/POST /signup`, `/login`, `POST /logout` | 인증 |
| `GET /board` | 목록(검색·카테고리·정렬·인기글·지금 뜨는 글) |
| `GET /board/new`, `POST /board` | 글쓰기 |
| `GET /board/:id` | 상세. 이전글·다음글은 들어온 목록(말머리·검색·정렬)을 따라감 |
| `GET/POST /board/:id/edit`, `POST /board/:id/delete` | 수정·삭제 |
| `POST /board/:id/like` · `/bookmark` · `/report` | 추천·스크랩·신고 |
| `POST /board/:id/comments` | 댓글 |
| `POST /board/comments/:cid/like` · `/report` · `/delete` | 댓글 좋아요·신고·삭제 |
| `POST /board/:id/admin-pick` · `/hide` · `/dismiss-reports` | 운영자 |
| `POST /board/comments/:cid/dismiss-reports` | 운영자(댓글 신고 반려) |
| `POST /board/upload-image` | 에디터 사진 업로드 — 축소·EXIF 제거 후 저장, JSON으로 주소 반환 |
| `POST /attendance/check` | 출석. `Accept: application/json`이면 도장판·연속일수·포인트를 JSON으로, 아니면 화면 복귀 |
| `GET /attendance` | 옛 주소 → `/profile#attendance` 리다이렉트 |
| `GET /points` · `/ranking` · `/notifications` · `/profile` | 포인트·랭킹·알림·마이 |
| `GET /users/:id` | 공개 프로필 (익명글 제외, 본인은 /profile로) |
| `POST /board/comments/:cid/edit` | 댓글 수정 (본인만) |
| `POST /profile/avatar` · `/border` | 아바타·테두리 장착 |
| `GET /reports`, `GET /admin/members`, `POST /admin/members/:id/ban` | 운영 |

## 6. 포인트·해금 규칙
| 활동 | 지급 | 한도 |
|---|---|---|
| 회원가입 | 1,000P | 최초 1회 |
| 출석 | 100P | 하루 1회 |
| 일반글 / 익명글 | 300 / 100P | 하루 3개 |
| 댓글 | 100P | 하루 10개 |
| 추천받기 | 10P | — |
| 인기글 / 운영자추천 | 1,000 / 1,500P | 글당 1회 |
| 연속출석 3·7·30일 | 500·1,000·3,000P | 달성 시 |

해금: 5,000P 스페셜 헤어 · 10,000P 프리미엄 의상 · 20,000P 움직이는 테두리

## 7. 실행
```bash
# 로컬
npm install
npm start          # http://localhost:3000
npm test           # 테스트 207개

# Docker
docker build -t pointlounge .
docker run -e SESSION_SECRET=$(openssl rand -hex 32) \
  -p 3000:3000 -v $PWD/data:/app/data -v $PWD/uploads:/app/uploads pointlounge
```
최초 실행 시 데모 데이터(공지·샘플 글·회원)가 자동 생성됩니다.

## 8. 아바타 이미지 교체
`public/avatars/<아바타id>.png` 를 넣으면 해당 아바타가 그 이미지로 대체됩니다.
예시 수준의 반실사 일러스트를 넣으려면 `docs/avatar-prompts.md`의 프롬프트로 생성하세요.

## 9. 폴더 구조
```
server.js            진입점(보안 헤더·세션·라우팅)
src/db.js            스키마·인덱스        src/seed.js        데모 데이터
src/points.js        포인트 규칙          src/levels.js      레벨·업적
src/avatars.js       아바타(SVG/이미지)    src/categories.js  말머리
src/icons.js         SVG 아이콘           src/notify.js      알림
src/routes/          auth · board · user
views/               EJS (partials 포함)  public/css         스타일
test/                단위·통합 테스트      .github/workflows  CI
```
