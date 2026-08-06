# DB 표와 쿼리 정리

커뮤니티 게시판을 PHP 로 옮기실 때 보시라고 만든 문서입니다.
지금 돌고 있는 프로그램에서 표 구조를 그대로 읽어다가 MySQL 문법으로 옮겨 적은 것이라
실제 코드하고 어긋날 일이 없습니다. `node scripts/make-db-spec.js` 를 치면 다시 만들어집니다.
이 문서는 2026-08-06 에 만들었습니다.

## 0. 먼저 알아 두실 것

지금 프로그램은 Node.js 로 만들었고 DB 는 SQLite 를 씁니다. 아래에 적은 표 만드는 SQL 은
그 구조를 MySQL 로 옮긴 것입니다.

커뮤니티는 아이디랑 비밀번호를 안 갖고 있습니다. 채용 사이트(문서에서 'A사이트' 라고 부르는
쪽) 회원번호를 `users.external_id` 에 받아 두고, 여기에 포인트랑 캐릭터, 활동 기록만
매답니다. 왜 이렇게 했는지는 [연동가이드](연동가이드.md)에 적어 뒀습니다.

날짜와 시각은 전부 한국 시간 기준 문자열로 저장하고 있습니다. MySQL 로 옮기실 때는
`DATETIME` 으로 두시고 서버 시간대를 `+09:00` 으로 맞춰 주세요.
참과 거짓은 `TINYINT(1)` 에 0 아니면 1 로 넣습니다.

### 옛날 서버에 맞춰서 낮춰 둔 것들

PHP 5.1 은 2005년, 2006년쯤 나온 버전입니다. 그 시절 서버면 MySQL 도 대개 5.0 입니다.
그래서 아래 SQL 은 MySQL 5.0 에서 그대로 돌아가게끔 낮춰서 적었습니다. 이런 것들입니다.

요즘은 문자셋을 `utf8mb4` 로 쓰는데 그건 MySQL 5.5.3 부터 되는 것이라 여기서는 `utf8` 로
적었습니다. 시각 칸에 `DEFAULT CURRENT_TIMESTAMP` 를 붙이는 것도 5.6.5 부터라서 안 썼고,
대신 값을 넣을 때 `NOW()` 를 같이 적게 했습니다. 검색은 InnoDB 의 `FULLTEXT` 가 5.6 부터,
한글 부분일치에 쓰는 `ngram` 은 5.7 부터라서 그냥 `LIKE` 기준으로 적어 뒀습니다. 검색 얘기는
7장에 따로 있습니다.

이 중에 `DEFAULT CURRENT_TIMESTAMP` 를 특히 조심하셔야 합니다. 옛날 MySQL 에서는 이걸
`TIMESTAMP` 칸에만, 그것도 표 하나에 한 칸에만 붙일 수 있습니다. 그래서 여러 칸에 붙여 두면
표를 만드는 것 자체가 실패합니다. 그래서 시각 칸에는 기본값을 아예 안 넣고
`INSERT ... (created_at) VALUES (..., NOW())` 이런 식으로 넣게 해 뒀습니다.

그리고 이모지는 못 담습니다. MySQL 5.0 의 `utf8` 은 한 글자를 3바이트까지만 담는데
이모지는 4바이트라서 잘리거나 오류가 납니다. 지금 데모 글 제목에도 `☺` 가 하나 들어 있습니다.
서버 MySQL 이 5.5.3 이상이면 `utf8` 을 전부 `utf8mb4` 로 바꾸시는 게 낫고, 5.0 이면
글쓰기에서 4바이트짜리 글자를 걸러 주셔야 합니다.

### PHP 5.1 에 아직 없는 것들

JSON 을 읽고 쓰는 `json_decode`, `json_encode` 는 PHP 5.2 부터 생겼습니다.
그래서 캐릭터 목록을 JSON 대신 PHP 배열 파일(`docs/avatars.php`)로 뽑아 뒀습니다.
날짜 다루는 `DateTime` 클래스도 5.2 부터라 `strtotime()` 과 `date()` 를 쓰시면 됩니다.
비밀번호를 다루는 `password_hash` 는 5.5 부터인데, 연동해서 쓰시면 커뮤니티 쪽에는
비밀번호 자체가 없어서 쓸 일이 없습니다. 이름 없는 함수(클로저)와 네임스페이스는 5.3 부터라
안 썼습니다.

캐릭터 목록은 `docs/avatars.php` 를 쓰시면 됩니다. 지금 Node 쪽은
`public/avatars/manifest.json` 을 읽는데 PHP 5.1 에는 그 파일을 읽을 방법이 없어서,
같은 내용을 PHP 배열로 다시 뽑아 놓은 것입니다. 대괄호로 배열 쓰는 것도 5.4 부터라
`array()` 로 적었습니다.

```php
$avatars = include 'avatars.php';
foreach ($avatars as $a) {
    echo $a['code'], ' ', $a['name'];   // female-glamgold-2-2 / 글램 골드 2-2
}
```

여기 `code` 값이 `users.avatar_id`, `users.border_id`, `user_items.item_code` 에
들어가는 값입니다. 그림 파일은 `public/avatars/` 아래에 있는데 `file` 이 본문용 큰 그림,
`thumb` 이 작은 그림입니다. 나중에 캐릭터가 늘어나면 이 파일도 같이 다시 만들어집니다.

SQL 에 값을 넣으실 때는 문자열에 그냥 붙이지 마시고 따로 넘겨 주세요.
PDO 나 mysqli 가 없고 옛날 `mysql_*` 함수만 있는 서버라면
`mysql_real_escape_string()` 을 빠짐없이 거치셔야 합니다. 이걸 안 하면 남이 검색창에
SQL 을 적어 넣어서 DB 를 통째로 읽어 갈 수 있습니다. 지금 Node 쪽은 모든 쿼리가 그렇게
되어 있으니 그 부분만 옮기시면 됩니다.

### SQLite 에서 MySQL 로 바꿀 때 달라지는 함수

여기 왼쪽이 지금 코드에 적혀 있는 것이고 오른쪽이 MySQL 에서 쓰실 것입니다.

| 지금 (SQLite) | MySQL |
|---|---|
| `datetime('now', 'localtime')` | `NOW()` |
| `date('now', 'localtime')` | `CURDATE()` |
| `datetime('now', 'localtime', '-7 days')` | `DATE_SUB(NOW(), INTERVAL 7 DAY)` |
| `strftime('%Y-%m-', 'now', 'localtime')` | `DATE_FORMAT(NOW(), '%Y-%m-')` |
| `AUTOINCREMENT` | `AUTO_INCREMENT` |
| `a || b` (글자 잇기) | `CONCAT(a, b)` |

---

## 0-1. 확인한 것과 그냥 짐작한 것

솔직하게 갈라서 적겠습니다. 저는 옮겨 가실 서버를 한 번도 본 적이 없습니다.

확인한 것부터 말씀드리면, 아래에 적힌 표 만드는 SQL 은 쉼표랑 괄호가 맞는지 문서를 만들 때마다
자동으로 훑어보게 해 뒀습니다. 어긋나면 문서가 아예 안 만들어집니다. 4장의 화면별 쿼리도
문서에 싣기 전에 한 번씩 실제로 돌려 보고 넣습니다. 같이 드린 PHP 파일들이 5.1 문법인지는
`node scripts/check-php51.js` 로 확인하고 있고, 연동 토큰 예제도 그 방식으로 만든 토큰이
제대로 통과하는지 확인하는 테스트가 있습니다.

반대로 짐작만 하고 적은 것도 있습니다. MySQL 이 5.0 대일 거라고 봤는데, PHP 5.1 서버면
대개 그렇기 때문입니다. 더 높은 버전이면 `utf8mb4` 를 쓰시는 게 낫습니다. 기존 회원 표에
칸을 더 붙일 수 있다고 봤습니다. 포인트랑 캐릭터를 어딘가에는 매달아야 해서요. 만약 회원 표를
못 건드리는 상황이면 따로 표를 빼는 방법도 있으니 말씀해 주세요. 글이랑 댓글 표는 이미 있다고
봤습니다. 커뮤니티가 이미 있다고 하셔서 그렇게 뒀는데, 혹시 없으면 2장에 있는 SQL 을 그대로
쓰시면 됩니다. 회원 아이디 칸이 숫자일 거라고 봤는데 문자열이면 연결되는 칸 타입도 같이
맞춰 주셔야 합니다.

그리고 한 가지 미리 말씀드릴 게 있습니다. 4장의 쿼리는 지금 프로그램(SQLite)에서 한 번씩
돌려 보고 확인한 것인데, MySQL 문법으로는 제가 손으로 옮겨 적었습니다. MySQL 에서 직접
돌려 보지는 못했습니다. 날짜 함수처럼 바뀌는 부분은 바로 위에 표로 정리해 뒀지만,
옮기신 다음에 한 번씩 돌려 봐 주시면 좋겠습니다.

서버 정보를 알려 주시면 위에 짐작으로 적은 것들을 실제 값으로 바꾸겠습니다.
`docs/check-server.php` 를 웹 폴더에 올리시고 브라우저로 열면 PHP 와 MySQL 버전, 문자셋,
시간대, 필요한 확장이 깔려 있는지, 회원 표에 어떤 칸이 없는지가 한 화면에 다 나옵니다.
이 파일은 아주 옛날 서버에서도 돌게 PHP 4 문법으로만 썼습니다.
보시고 나면 꼭 지워 주세요. 서버 정보가 그대로 드러나는 파일이라 남겨 두면 위험합니다.

---

## 0-2. 기존 커뮤니티에 이식하실 거면 여기부터 보세요

이 프로그램은 게시판을 처음부터 만든 것이라 글, 댓글, 추천 같은 표가 다 들어 있습니다.
그런데 기존 사이트에 커뮤니티가 이미 있으면 그 표들은 쓰실 일이 없습니다.
새로 붙이셔야 하는 건 이 프로젝트에만 있는 기능, 그러니까 포인트와 출석, 캐릭터뿐입니다.

표를 세 갈래로 나눠 보면 이렇습니다.

| 갈래 | 표 | 어떻게 하시면 되나 |
|---|---|---|
| 이미 있으실 것 | `users` `posts` `comments` `likes` `comment_likes` `reports` `comment_reports` `bookmarks` `post_images` | 기존 표 그대로 쓰시고 아래 칸만 보태기 |
| 새로 만드실 것 | `point_logs` `attendance` `user_items` `notifications` | 이 넷이 핵심입니다 |
| 안 옮기셔도 될 것 | `posts_fts` | 검색 색인입니다. 기존 검색 쓰시면 됩니다 |

새로 만드실 표 네 개가 이 일의 대부분입니다. 기존 커뮤니티에는 없을 가능성이 큽니다.

### 기존 회원 표에 붙이실 칸

| 칸 | 타입 | 왜 필요한가 |
|---|---|---|
| `points` | INT NOT NULL DEFAULT 0 | 지금 갖고 있는 포인트 |
| `avatar_id` | VARCHAR(40) NOT NULL DEFAULT '' | 쓰고 있는 캐릭터 code |
| `border_id` | VARCHAR(40) NULL | 쓰고 있는 테두리 code |
| `member_type` | VARCHAR(20) NOT NULL DEFAULT 'female' | 여성인지 남성인지 업소인지. 어떤 캐릭터를 보여 줄지 가릅니다 |

글 표에는 인기글이랑 운영자 추천을 쓰실 거면 `is_popular` 와 `admin_picked` 정도만
있으면 됩니다. 둘 다 `TINYINT(1) NOT NULL DEFAULT 0` 으로 두시면 됩니다.

### 포인트를 주는 자리

기존 게시판 코드에서 아래 일들이 성공한 바로 다음에 포인트 주는 함수를 한 줄 부르시면 됩니다.

| 언제 | reason | 금액 | 몇 번까지, 무엇으로 막나 |
|---|---|---:|---|
| 커뮤니티 첫 방문(가입) | `signup` | 1,000P | 딱 한 번. 회원을 만들 때만 부르면 되고 따로 확인 안 해도 된다 |
| 출석체크 버튼 | `attendance` | 10P | 하루 한 번. attendance 표의 (user_id, day) UNIQUE 가 막아 준다 |
| 글 등록 (일반) | `post` | 300P | 하루 3개. 오늘 point_logs 를 세어서 판단한다 |
| 글 등록 (익명) | `anon_post` | 100P | 하루 3개. 오늘 point_logs 를 세어서 판단한다 |
| 댓글·대댓글 등록 | `comment` | 100P | 하루 10개. 오늘 point_logs 를 세어서 판단한다 |
| 내 글이 추천받음 | `like_received` | 10P | 제한 없음. 추천 하나당 준다 |
| 내 글이 인기글이 됨 (추천 10개) | `popular` | 1,000P | 글 하나에 한 번. posts.is_popular 를 세워서 두 번 안 준다 |
| 내 글이 운영자 추천글이 됨 | `admin_pick` | 1,500P | 글 하나에 한 번. posts.admin_picked 를 세워서 두 번 안 준다 |
| 연속 출석 7일 | `streak7` | 50P | 연속 일수가 딱 그 날일 때만. 하루 더 채웠다고 또 주면 안 된다 |
| 연속 출석 14일 | `streak14` | 100P | 연속 일수가 딱 그 날일 때만. 하루 더 채웠다고 또 주면 안 된다 |
| 연속 출석 21일 | `streak21` | 150P | 연속 일수가 딱 그 날일 때만. 하루 더 채웠다고 또 주면 안 된다 |
| 연속 출석 28일 | `streak28` | 200P | 연속 일수가 딱 그 날일 때만. 하루 더 채웠다고 또 주면 안 된다 |
| 연속 출석 30일 달성 | `streak30` | 100P | 연속 일수가 딱 그 날일 때만. 하루 더 채웠다고 또 주면 안 된다 |

연속 출석 보너스는 그날 연속 일수가 딱 7일, 14일, 21일, 28일, 30일일 때만 줍니다.
그래서 8일째에는 또 주지 않고, 연속이 끊겼다가 다시 7일을 채우면 그때 다시 받습니다.
다시 도전할 맛이 나라고 일부러 그렇게 뒀습니다.

하루 한도는 글을 못 쓰게 막는 게 아닙니다. 한도를 넘겨도 글이랑 댓글은 정상으로 써지고
포인트만 안 붙습니다. 오늘 몇 번 받았는지는 `point_logs` 를 세어서 판단합니다.

```sql
-- 오늘 이 사유로 몇 번 받았나. 이 수를 한도와 비교합니다
SELECT COUNT(*) FROM point_logs
 WHERE user_id = ? AND reason = ? AND DATE(created_at) = CURDATE();

-- 포인트 주기. 아래 두 문장은 반드시 하나로 묶어서 실행해 주세요
INSERT INTO point_logs (user_id, amount, reason, detail, created_at)
VALUES (?, ?, ?, ?, NOW());
UPDATE users SET points = points + ? WHERE id = ?;
```

### 관리자에서 게시판을 늘릴 수 있어야 한다면

지금은 말머리(자유, 질문, 이벤트)를 코드 안에 적어 두고 있습니다.
`src/categories.js` 파일입니다. 관리자 화면에서 게시판을 늘리시는 구조라면 그쪽 게시판 표를
쓰시고 저희 말머리 개념은 버리셔도 됩니다.

포인트 규칙은 게시판이 몇 개든 상관없이 그대로 돌아갑니다. 다만 "글 쓰면 300P" 를 게시판마다
다르게 주고 싶으시면 `point_logs` 에 `board_id` 칸을 하나 더 두시는 편이 나중에 편합니다.

---

## 1. 표 한눈에 보기

| 테이블 | 설명 |
|---|---|
| `attendance` | 출석 기록 |
| `bookmarks` | 스크랩 |
| `comment_likes` | 댓글 좋아요 |
| `comment_reports` | 댓글 신고 |
| `comments` | 댓글과 답글. parent_id 가 있으면 답글이다 |
| `likes` | 글 추천. 취소는 없고 한 사람이 한 번만 할 수 있다 |
| `notifications` | 알림 |
| `point_logs` | 포인트가 들어오고 나간 내역 |
| `post_images` | 글에 붙인 사진. 본문 안에 넣은 사진은 본문 HTML 에 들어 있고, 이 표는 옛날 방식 첨부다 |
| `posts` | 게시글 |
| `reports` | 글 신고 |
| `user_items` | 포인트로 산 캐릭터와 테두리 |
| `users` | 회원. 연동해서 쓰면 아이디와 비밀번호가 아니라 A사이트 회원번호에 매달린 커뮤니티 프로필이 된다 |

---

## 2. 테이블 정의

### `attendance`
출석 기록

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `user_id` | INT UNSIGNED | N |  |
| `day` | DATE | N | 출석한 날짜. user_id 와 묶어 UNIQUE 라 하루 두 번은 DB 가 막는다 |

```sql
CREATE TABLE `attendance` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `day` DATE NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_user_id_day` (`user_id`, `day`),
  CONSTRAINT `fk_attendance_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `bookmarks`
스크랩

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `user_id` | INT UNSIGNED | N |  |
| `post_id` | INT UNSIGNED | N |  |
| `created_at` | DATETIME | N |  |

```sql
CREATE TABLE `bookmarks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `post_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL,   -- 넣을 때 NOW() 를 함께 적어 주세요
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bookmarks_user_id_post_id` (`user_id`, `post_id`),
  CONSTRAINT `fk_bookmarks_post_id` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bookmarks_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `comment_likes`
댓글 좋아요

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `comment_id` | INT UNSIGNED | N |  |
| `user_id` | INT UNSIGNED | N |  |

```sql
CREATE TABLE `comment_likes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `comment_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comment_likes_comment_id_user_id` (`comment_id`, `user_id`),
  CONSTRAINT `fk_comment_likes_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_comment_likes_comment_id` FOREIGN KEY (`comment_id`) REFERENCES `comments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `comment_reports`
댓글 신고

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `comment_id` | INT UNSIGNED | N |  |
| `user_id` | INT UNSIGNED | N |  |
| `created_at` | DATETIME | N |  |

```sql
CREATE TABLE `comment_reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `comment_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL,   -- 넣을 때 NOW() 를 함께 적어 주세요
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_comment_reports_comment_id_user_id` (`comment_id`, `user_id`),
  CONSTRAINT `fk_comment_reports_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_comment_reports_comment_id` FOREIGN KEY (`comment_id`) REFERENCES `comments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `comments`
댓글과 답글. parent_id 가 있으면 답글이다

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `post_id` | INT UNSIGNED | N |  |
| `user_id` | INT UNSIGNED | N |  |
| `parent_id` | INT UNSIGNED | Y |  |
| `content` | TEXT | N |  |
| `created_at` | DATETIME | N |  |
| `updated_at` | DATETIME | Y |  |
| `is_deleted` | TINYINT(1) | N | 답글이 달린 댓글은 진짜로 지우지 않고 이걸로 표시만 한다 |

```sql
CREATE TABLE `comments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `post_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `parent_id` INT UNSIGNED,
  `content` TEXT NOT NULL,
  `created_at` DATETIME NOT NULL,   -- 넣을 때 NOW() 를 함께 적어 주세요
  `updated_at` DATETIME,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_comments_parent_id` FOREIGN KEY (`parent_id`) REFERENCES `comments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_comments_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_comments_post_id` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `likes`
글 추천. 취소는 없고 한 사람이 한 번만 할 수 있다

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `post_id` | INT UNSIGNED | N |  |
| `user_id` | INT UNSIGNED | N |  |

```sql
CREATE TABLE `likes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `post_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_likes_post_id_user_id` (`post_id`, `user_id`),
  CONSTRAINT `fk_likes_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_likes_post_id` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `notifications`
알림

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `user_id` | INT UNSIGNED | N |  |
| `message` | VARCHAR(255) | N |  |
| `link` | VARCHAR(255) | Y |  |
| `is_read` | TINYINT(1) | N |  |
| `created_at` | DATETIME | N |  |

```sql
CREATE TABLE `notifications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `message` VARCHAR(255) NOT NULL,
  `link` VARCHAR(255),
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,   -- 넣을 때 NOW() 를 함께 적어 주세요
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_notifications_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `point_logs`
포인트가 들어오고 나간 내역

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `user_id` | INT UNSIGNED | N |  |
| `amount` | INT | N | 줄 때는 양수, 살 때 빠지는 건 음수 |
| `reason` | VARCHAR(20) | N | signup / attendance / post / anon_post / comment / like_received / popular / admin_pick / streak7 / streak14 / streak21 / streak28 / streak30 / purchase |
| `detail` | VARCHAR(255) | Y |  |
| `created_at` | DATETIME | N |  |

```sql
CREATE TABLE `point_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `amount` INT NOT NULL,
  `reason` VARCHAR(20) NOT NULL,
  `detail` VARCHAR(255),
  `created_at` DATETIME NOT NULL,   -- 넣을 때 NOW() 를 함께 적어 주세요
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_point_logs_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `post_images`
글에 붙인 사진. 본문 안에 넣은 사진은 본문 HTML 에 들어 있고, 이 표는 옛날 방식 첨부다

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `post_id` | INT UNSIGNED | N |  |
| `filename` | VARCHAR(255) | N |  |
| `sort` | INT | N |  |

```sql
CREATE TABLE `post_images` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `post_id` INT UNSIGNED NOT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `sort` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_post_images_post_id` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `posts`
게시글

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `user_id` | INT UNSIGNED | N |  |
| `category` | VARCHAR(20) | N |  |
| `title` | VARCHAR(255) | N |  |
| `content` | TEXT | N |  |
| `is_anonymous` | TINYINT(1) | N |  |
| `block_comments` | TINYINT(1) | N |  |
| `is_notice` | TINYINT(1) | N |  |
| `is_hidden` | TINYINT(1) | N | 숨김 처리. 일반 회원한테는 안 보이고 운영자만 볼 수 있다 |
| `is_popular` | TINYINT(1) | N | 인기글로 뽑혔는지. 추천 10개 넘으면 선다 |
| `admin_picked` | INT | N | 운영자 추천글로 뽑혔는지 |
| `views` | INT | N |  |
| `created_at` | DATETIME | N |  |
| `updated_at` | DATETIME | Y |  |
| `content_format` | VARCHAR(20) | N | text 는 옛날 글, html 은 에디터로 쓴 글. 저장 전에 위험한 태그를 걸러 낸다 |
| `content_text` | TEXT | Y | 검색과 미리보기에 쓰는 글자만 남긴 사본. 태그가 빠져 있다 |
| `like_count` | INT | N | 추천 수를 여기 같이 저장해 둔다. 매번 세면 목록이 느려져서 |

```sql
CREATE TABLE `posts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `category` VARCHAR(20) NOT NULL DEFAULT '자유',
  `title` VARCHAR(255) NOT NULL,
  `content` TEXT NOT NULL,
  `is_anonymous` TINYINT(1) NOT NULL DEFAULT 0,
  `block_comments` TINYINT(1) NOT NULL DEFAULT 0,
  `is_notice` TINYINT(1) NOT NULL DEFAULT 0,
  `is_hidden` TINYINT(1) NOT NULL DEFAULT 0,
  `is_popular` TINYINT(1) NOT NULL DEFAULT 0,
  `admin_picked` INT NOT NULL DEFAULT 0,
  `views` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,   -- 넣을 때 NOW() 를 함께 적어 주세요
  `updated_at` DATETIME,
  `content_format` VARCHAR(20) NOT NULL DEFAULT 'text',
  `content_text` TEXT,
  `like_count` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_posts_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `reports`
글 신고

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `post_id` | INT UNSIGNED | N |  |
| `user_id` | INT UNSIGNED | N |  |
| `created_at` | DATETIME | N |  |

```sql
CREATE TABLE `reports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `post_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL,   -- 넣을 때 NOW() 를 함께 적어 주세요
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reports_post_id_user_id` (`post_id`, `user_id`),
  CONSTRAINT `fk_reports_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_reports_post_id` FOREIGN KEY (`post_id`) REFERENCES `posts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `user_items`
포인트로 산 캐릭터와 테두리

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `user_id` | INT UNSIGNED | N |  |
| `item_code` | VARCHAR(40) | N | 사 놓은 캐릭터나 테두리의 code |
| `price` | INT | N |  |
| `created_at` | DATETIME | N |  |

```sql
CREATE TABLE `user_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `item_code` VARCHAR(40) NOT NULL,
  `price` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,   -- 넣을 때 NOW() 를 함께 적어 주세요
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_items_user_id_item_code` (`user_id`, `item_code`),
  CONSTRAINT `fk_user_items_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

### `users`
회원. 연동해서 쓰면 아이디와 비밀번호가 아니라 A사이트 회원번호에 매달린 커뮤니티 프로필이 된다

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| `id` | INT UNSIGNED | N | 기본키 (자동 증가) |
| `username` | VARCHAR(50) | N |  |
| `password_hash` | VARCHAR(255) | N | 연동해서 쓰면 빈 문자열. 커뮤니티는 비밀번호를 안 갖는다 |
| `nickname` | VARCHAR(50) | N |  |
| `points` | INT | N | 지금 갖고 있는 포인트. point_logs 를 다 더한 값과 같아야 한다 |
| `avatar_id` | VARCHAR(40) | N | public/avatars/manifest.json 에 적힌 code. male-03 이런 모양 |
| `border_id` | VARCHAR(40) | Y | 같은 파일의 테두리 code. 안 끼고 있으면 NULL |
| `is_admin` | TINYINT(1) | N |  |
| `is_banned` | TINYINT(1) | N |  |
| `created_at` | DATETIME | N |  |
| `member_type` | VARCHAR(20) | N | female, male, venue 중 하나. 어떤 캐릭터를 주고 팔지 가른다 |
| `external_id` | VARCHAR(64) | Y | A사이트 회원번호. 연동했을 때 사람을 알아보는 값 |

```sql
CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `nickname` VARCHAR(50) NOT NULL,
  `points` INT NOT NULL DEFAULT 0,
  `avatar_id` VARCHAR(40) NOT NULL DEFAULT '',
  `border_id` VARCHAR(40),
  `is_admin` TINYINT(1) NOT NULL DEFAULT 0,
  `is_banned` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,   -- 넣을 때 NOW() 를 함께 적어 주세요
  `member_type` VARCHAR(20) NOT NULL DEFAULT 'female',
  `external_id` VARCHAR(64),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_external` (`external_id`),
  UNIQUE KEY `uq_users_nickname` (`nickname`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```


---

## 3. 인덱스와 그걸 왜 걸었는지

목록이 느려지는 자리는 정해져 있습니다. 아래 인덱스는 꼭 같이 옮겨 주세요.

```sql
-- 목록 최신순. 공지를 위로 올리고 나머지는 번호 역순으로
CREATE INDEX idx_posts_list    ON posts (is_notice, id DESC);
-- 추천순, 조회순. 이게 없으면 글을 전부 읽어서 줄 세운 다음에 앞의 20개만 보여 줍니다
CREATE INDEX idx_posts_likes   ON posts (is_notice, like_count DESC, id DESC);
CREATE INDEX idx_posts_views   ON posts (is_notice, views DESC, id DESC);
-- 페이지 수 세는 COUNT 가 본문까지 읽지 않게
CREATE INDEX idx_posts_visible ON posts (is_notice, is_hidden);
CREATE INDEX idx_posts_category ON posts (category);
-- 상세·마이페이지
CREATE INDEX idx_comments_post ON comments (post_id);
CREATE INDEX idx_likes_post    ON likes (post_id);
CREATE INDEX idx_bookmarks_user ON bookmarks (user_id);
CREATE INDEX idx_pointlogs_user ON point_logs (user_id, id DESC);
-- 화면 위쪽 종 모양에 뜨는 '안 읽은 알림 수'. 모든 화면에서 매번 부릅니다
CREATE INDEX idx_noti_user     ON notifications (user_id, is_read);
CREATE INDEX idx_useritems_user ON user_items (user_id);
```

한 가지 말씀드릴 게 있는데, 추천 수를 `likes` 표에서 매번 세지 않고 `posts.like_count` 에
같이 저장해 두고 있습니다. 매번 세어서 줄을 세우면 글이 늘어날수록 목록이 눈에 띄게 느려지기
때문입니다. 추천은 취소가 없어서 두 값이 어긋날 일도 별로 없고, 위에 걸어 둔 인덱스만으로
정렬이 끝나서 훨씬 빠릅니다. 대신 추천을 넣고 뺄 때 `posts.like_count` 도 같이 고쳐 주셔야
하고, 두 문장을 하나로 묶어서 실행해 주셔야 합니다.

---

## 4. 화면별로 쓰는 쿼리

아래 SQL 은 문서를 만들 때 실제로 한 번씩 돌려 보고 넣은 것입니다.
SQLite 문법 그대로라 MySQL 로 옮기실 때는 위에 있는 함수 대응표를 봐 주세요.

### 목록 (최신순)
공지는 위에 고정하고 따로 뽑는다. 숨김 글은 운영자에게만 보인다.

```sql
SELECT p.id, p.category, p.title, p.is_anonymous, p.is_hidden, p.like_count, p.views,
       p.created_at, u.nickname, u.avatar_id, u.border_id,
       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.is_deleted = 0) AS comment_count
FROM posts p JOIN users u ON u.id = p.user_id
WHERE p.is_notice = 0 AND (p.is_hidden = 0 OR ? = 1)
ORDER BY p.id DESC LIMIT 10 OFFSET 0
```

### 목록 (추천순 / 조회순)
수정사항 4번: 최근 일주일 안에서만 줄을 세운다. MySQL 은 datetime(...) 대신 `p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)` 를 쓴다.

```sql
SELECT p.id, p.title, p.like_count, p.views
FROM posts p
WHERE p.is_notice = 0 AND p.is_hidden = 0
  AND p.created_at >= datetime('now', 'localtime', '-7 days')
ORDER BY p.like_count DESC, p.id DESC LIMIT 10
```

### 목록 (말머리 필터)
탭으로 거를 때 쓴다. 없앤 말머리로 저장돼 있던 글은 자유로 옮겨 뒀다.

```sql
SELECT COUNT(*) AS c FROM posts p
WHERE p.is_notice = 0 AND p.is_hidden = 0 AND p.category = ?
```

### 검색
지금 프로그램은 본문을 두 글자씩 잘라 만든 색인으로 후보를 좁히는데, 옛날 MySQL 에는 그 기능이 없다. 그래서 아래 LIKE 방식을 기본으로 적었다. MySQL 5.7 이상이면 `FULLTEXT ... WITH PARSER ngram` 쪽을 권한다.

```sql
SELECT p.id, p.title FROM posts p
WHERE p.is_notice = 0 AND p.is_hidden = 0
  AND (p.title LIKE ? OR p.content_text LIKE ?)
ORDER BY p.id DESC LIMIT 10
```

### 글 상세
조회수는 같은 사람이 새로고침해도 한 번만 올린다. 이미 본 글 번호를 세션에 담아 두고 판단한다.

```sql
SELECT p.*, u.nickname, u.avatar_id, u.border_id, u.points AS author_points
FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?
```

### 댓글 목록
한 번에 다 읽고 최상위 20개 단위로 잘라 그린다. 답글은 부모와 같은 쪽에 함께 싣는다.

```sql
SELECT c.*, u.nickname, u.avatar_id, u.border_id, u.points AS author_points,
       (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count
FROM comments c JOIN users u ON u.id = c.user_id
WHERE c.post_id = ? ORDER BY c.id
```

### 출석 — 오늘 출석했는지
(user_id, day) 가 UNIQUE 라 두 번 눌러도 DB가 막는다.

```sql
SELECT 1 FROM attendance WHERE user_id = ? AND day = ?
```

### 출석 — 이번 달 출석 횟수
MySQL 은 `DATE_FORMAT(NOW(), "%Y-%m-")` 로 바꿔 쓴다.

```sql
SELECT COUNT(*) AS c FROM attendance
WHERE user_id = ? AND day LIKE strftime('%Y-%m-', 'now', 'localtime') || '%'
```

### 포인트 — 하루 지급 한도 확인
글 3개·댓글 10개 한도. 지급 전에 오늘 몇 번 줬는지 센다. MySQL 은 `DATE(created_at) = CURDATE()`.

```sql
SELECT COUNT(*) AS c FROM point_logs
WHERE user_id = ? AND reason = ? AND date(created_at) = date('now', 'localtime')
```

### 포인트 — 내역

```sql
SELECT * FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT 100
```

### 랭킹 TOP 20

```sql
SELECT u.id, u.nickname, u.points, u.avatar_id, u.border_id
FROM users u WHERE u.is_banned = 0 ORDER BY u.points DESC, u.id LIMIT 20
```

### 알림 — 안 읽은 개수
모든 화면 상단에서 매번 부르는 쿼리라 인덱스가 중요하다.

```sql
SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0
```

### 캐릭터 — 내가 산 것

```sql
SELECT item_code FROM user_items WHERE user_id = ?
```


---

## 5. 포인트 규칙

포인트는 서버에서만 계산해서 줘야 합니다. 화면에서 넘어온 금액을 그대로 믿고 넣으면
브라우저에서 값을 고쳐 보내는 것만으로 포인트를 마음대로 만들 수 있게 됩니다.

| 사유 (`point_logs.reason`) | 포인트 | 하루 한도 |
|---|---|---|
| `signup` | 1,000P | — | 
| `attendance` | 10P | — | 
| `post` | 300P | 3회 | 
| `anon_post` | 100P | 3회 | 
| `comment` | 100P | 10회 | 
| `like_received` | 10P | — | 
| `popular` | 1,000P | — | 
| `admin_pick` | 1,500P | — | 
| `streak7` | 50P | — | 
| `streak14` | 100P | — | 
| `streak21` | 150P | — | 
| `streak28` | 200P | — | 
| `streak30` | 100P | — | 
| `purchase` | 음수 (구매 차감) | — |

### 연속 출석 보너스

- **7일 연속** → 50P
- **14일 연속** → 100P
- **21일 연속** → 150P
- **28일 연속** → 200P
- **30일 연속** → 100P (달성 보너스)

출석은 하루에 한 번만 됩니다. `attendance` 표의 `user_id` 와 `day` 를 UNIQUE 로 묶어 둬서
DB 가 알아서 막아 줍니다. 보너스는 딱 그 날짜에 닿았을 때만 줍니다. 8일째에 7일 보너스를
또 주면 안 되니까요. 연속이 끊기면 다음 날부터 1일차로 다시 시작합니다.

### 포인트 주는 순서

```
포인트주기(회원, 사유):
    규칙 = 사유별 규칙표에서 꺼내기
    만약 하루 한도가 있고, 오늘 이미 그만큼 받았으면:
        아무것도 안 주고 끝냄          # 글은 정상으로 써지고 포인트만 안 붙음
    아래 두 줄을 하나로 묶어서:
        point_logs 에 (회원, 금액, 사유) 남기기
        users.points 에 금액 더하기
```

### 사는 순서

```
사기(회원, 물건):
    이미 갖고 있으면: 중복이라고 알려 주고 끝냄
    포인트가 값보다 적으면: 모자란다고 알려 주고 끝냄
    아래 세 줄을 하나로 묶어서:     # 중간에 끊기면 셋 다 없던 일로
        users.points 에서 값만큼 빼기
        user_items 에 (회원, 물건코드, 값) 남기기
        point_logs 에 (회원, 마이너스 값, 'purchase') 남기기
```

값은 캐릭터가 2,000P, 테두리가 20,000P 입니다.
회원 유형(`users.member_type`)에 안 맞는 캐릭터는 상점 목록에 아예 안 띄우고, 혹시 코드를
직접 넣어서 사려고 해도 막습니다.

### 캐릭터 목록은 표가 아니라 파일에 있습니다

그림이 246장이라 표에 한 줄씩 넣으면 관리가 힘듭니다. 그래서 목록은
`public/avatars/manifest.json` 한 곳에만 두고, DB 에는 code 문자열만 들어갑니다.
`users.avatar_id`, `users.border_id`, `user_items.item_code` 이 세 군데입니다.

| 유형 | 개수 | code 예시 |
|---|---:|---|
| 여성회원 캐릭터 | 225 | `female-purenatural-1-1` |
| 남성회원 캐릭터 | 5 | `male-01` |
| 업소회원 캐릭터 | 5 | `venue-01` |
| 익명 전용 | 1 | `anon` |
| 운영자 전용 | 1 | `admin` |
| 테두리 | 9 | `border-cyan` |

여성회원 캐릭터 코드는 `female-테마-헤어-의상` 모양입니다. 예를 들어
`female-purenatural-5-3` 이면 청순 내츄럴 테마에 헤어 5번, 의상 3번이라는 뜻입니다.

상점은 두 단계로 되어 있습니다. 먼저 테마 9종 중에 하나를 고르고, 그 안에서
25종 중에 하나를 고르는 식입니다. 여성 캐릭터만 225종이라 한 화면에
다 깔면 못 보기 때문에 이렇게 나눴습니다.

공짜로 주는 캐릭터도 있습니다. 여성회원은 청순 내츄럴 맨 아랫줄 5종 중에 가입 화면에서 직접
고르고, 남성회원과 업소회원은 각자 유형의 5종 중에 하나를 무작위로 받습니다.

혹시 캐릭터 목록을 파일 말고 DB 표로 두고 싶으시면
`avatar_items(code, kind, member_type, theme, hair, outfit, price, file, thumb)`
정도면 충분합니다. manifest.json 안에 들어 있는 게 딱 그 내용입니다.

---

## 6. 말머리

지금 쓰는 말머리는 자유, 질문, 이벤트 입니다.
이벤트 말머리는 운영자만 글을 쓸 수 있습니다.
읽는 건 누구나 됩니다. 화면에서 감추는 것만으로는 못 막습니다.
폼 값은 얼마든지 고쳐 보낼 수 있어서 서버에서 한 번 더 봐야 합니다.

예전에 쓰던 말머리 알바후기, 구인구직, 정보 는 이제 없습니다. 그런데 그 말머리로 저장된 글은
어느 탭에도 안 걸려서 사라진 것처럼 보입니다. 그래서 아래 SQL 로 자유 말머리로 옮겼습니다.

```sql
UPDATE posts SET category = '자유' WHERE category IN ('알바후기', '구인구직', '정보');
```

---

## 7. 한글 검색에 대해서

`LIKE '%검색어%'` 는 앞에 `%` 가 붙어 있어서 인덱스를 못 씁니다. 검색할 때마다 글을 처음부터
끝까지 다 읽어야 한다는 뜻이라, 글이 몇 만 건 되면 눈에 띄게 느려집니다.

그래도 수천 건까지는 `LIKE` 로도 별 문제 없습니다. 이 문서의 쿼리도 그 기준으로 적었습니다.
MySQL 이 5.7 이상이면 `FULLTEXT ... WITH PARSER ngram` 을 쓰시는 게 제일 좋습니다.
버전이 안 되면 색인 표를 따로 두는 방법도 있는데, 지금 Node 쪽이 그렇게 하고 있습니다.

지금은 본문을 두 글자씩 잘라서 색인에 넣어 두고 검색어도 똑같이 잘라서 찾습니다.
기본 방식은 띄어쓰기로 단어를 나누기 때문에 "주말알바" 에서 "알바" 를 못 찾고,
세 글자 단위로 자르는 방식은 "알바" 나 "카페" 같은 두 글자 검색이 안 됩니다.
MySQL 의 ngram 을 쓰실 때도 같은 이유로 `ngram_token_size=2` 로 두시길 권합니다.

---

## 8. 옮기실 때 놓치기 쉬운 것들

연속 출석 보너스는 그날 연속 일수가 딱 7일, 14일, 21일, 28일, 30일일 때만 줍니다.
8일째에 또 주면 안 되고, 연속이 끊겼다가 다시 7일을 채우면 그때는 다시 받습니다.

하루 한도는 글을 못 쓰게 막는 게 아닙니다. 한도를 넘겨도 글이랑 댓글은 정상으로 써지고
포인트만 안 붙습니다. 기획서 안내문에도 그렇게 적혀 있습니다.

답글이 달린 댓글은 진짜로 지우면 안 됩니다. `is_deleted = 1` 로 표시만 하고 내용을 비워
주세요. 통째로 지우면 남이 달아 놓은 답글까지 같이 사라집니다.

익명으로 쓴 글은 추천을 못 받습니다. 추천 버튼이 눌리지 않고 추천 포인트도 안 붙습니다.

제재된 회원(`is_banned = 1`)은 로그인이랑 활동이 막힙니다. 이미 로그인해 있는 상태였어도
바로 끊어 주셔야 합니다.

조회수는 같은 사람이 새로고침해도 한 번만 올라갑니다. 누를 때마다 올리면 숫자가 아무 의미가
없어집니다.

캐릭터 그림 목록은 코드 안에 적어 두지 않았습니다. `public/avatars/manifest.json` 에 있고
`users.avatar_id` 에는 그 목록의 code 만 들어갑니다. 그래서 나중에 그림이 몇 백 장으로
늘어나도 표 구조는 안 바꾸셔도 됩니다.
