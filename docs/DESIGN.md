# 포인트라운지 — 설계 문서

활동(글·댓글·출석)으로 **포인트**를 모으고, 포인트로 **아바타가 성장**하는 커뮤니티 게시판.

## 1. 개요
- 요구사항: 게시판 + 포인트별 아바타 업그레이드(예시와 다른 오리지널 캐릭터)
- 형태: 서버 사이드 렌더링 웹앱 (모바일/데스크톱 반응형)
- 데모 계정: 운영자 `admin`/`admin1234`, 회원 `cherry`·`mint`·`street`·`gold`/`test1234`

## 2. 기술 스택
| 구분 | 사용 |
|---|---|
| 런타임 | Node.js 20+ |
| 서버 | Express 4 |
| DB | SQLite (better-sqlite3), 파일 1개로 동작 + 인덱스 |
| 뷰 | EJS(SSR) + 순수 CSS |
| 세션 | express-session (scrypt 비밀번호 해시) |
| 업로드 | multer (형식·용량·개수 검증) |
| 테스트 | node --test (단위 + HTTP 통합, 49개) |
| CI | GitHub Actions (Node 20·22) |

## 3. 기능 목록
- **회원**: 가입(+1,000P)·로그인·로그아웃, 아이디/닉네임 검증, 로그인 무차별 대입 방어
- **게시판**: 목록(공지 고정·검색·미리보기·상대시간), 말머리(카테고리) 5종·필터,
  정렬(최신·추천·조회), 상세(조회수), 작성/수정/삭제, 이미지 첨부(≤5장, 미리보기·삭제),
  익명 작성, 댓글 차단, 스크랩
- **댓글**: 대댓글, 댓글 좋아요, 베스트댓글(좋아요 3↑ 상단 고정), 신고
- **포인트**: 가입·출석·글·댓글·추천받기·인기글·운영자추천·연속출석(3/7/30일), 하루 한도
- **아바타**: 기본 12종(무료) → 스페셜 헤어(5,000P) → 프리미엄 의상(10,000P) →
  움직이는 테두리(20,000P) → 이벤트 한정(시즌). 코드 SVG 기본, `public/avatars/<id>.png` 있으면 이미지로 대체
- **레벨/배지**: 누적 포인트 레벨(새싹→전설), 업적 배지 8종
- **알림**: 추천·댓글·답글·인기글·운영자추천 시 발송, 벨 뱃지·자동 읽음
- **랭킹**: 포인트 TOP 20
- **출석**: 그날 첫 접속 시 출석부 팝업이 뜨며 확인 절차 없이 바로 출석 처리(fetch).
  최근 7일 도장판·연속일수·적립 포인트를 애니메이션으로 보여주고, 기록(캘린더·
  연속 출석 보너스)은 마이페이지 '출석' 탭
- **운영자**: 공지, 운영자 추천글, 게시글 숨김/복구, 삭제, 신고 관리(글·댓글 반려/숨김/삭제),
  회원 관리(제재/해제)
- **글쓰기**: 서식 에디터(제목·굵게·밑줄·목록·인용)와 **커서 위치 사진 삽입**.
  본문은 `content_format`으로 구분해 `html`은 정화 후 출력, 옛 `text`는 이스케이프 출력.
  목록·검색은 평문 사본(`content_text`)을 사용
- **접근성/보안**: WCAG AA 색 대비, 키보드 포커스, 모션 최소화 존중,
  보안 헤더·SameSite 쿠키·파라미터 바인딩·XSS 이스케이프·오픈리다이렉트 차단,
  서식 본문은 `sanitize-html` 허용목록으로 정화(스크립트·style·iframe 제거, 이미지·링크 출처 제한)

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
| `GET /board/:id` | 상세(+베스트댓글) |
| `GET/POST /board/:id/edit`, `POST /board/:id/delete` | 수정·삭제 |
| `POST /board/:id/like` · `/bookmark` · `/report` | 추천·스크랩·신고 |
| `POST /board/:id/comments` | 댓글 |
| `POST /board/comments/:cid/like` · `/report` · `/delete` | 댓글 좋아요·신고·삭제 |
| `POST /board/:id/admin-pick` · `/hide` · `/dismiss-reports` | 운영자 |
| `POST /board/comments/:cid/dismiss-reports` | 운영자(댓글 신고 반려) |
| `POST /board/upload-image` | 에디터 사진 업로드 (JSON으로 주소 반환) |
| `POST /attendance/check` | 출석. `Accept: application/json`이면 도장판·연속일수·포인트를 JSON으로, 아니면 화면 복귀 |
| `GET /attendance` | 옛 주소 → `/profile#attendance` 리다이렉트 |
| `GET /points` · `/ranking` · `/notifications` · `/profile` | 포인트·랭킹·알림·마이 |
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
npm test           # 테스트 49개

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
