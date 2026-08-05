-- 커뮤니티 이식 - 표 만들기
--
-- 새로 만드는 표는 네 개뿐입니다. 글이랑 댓글, 추천은 기존 것을 쓰시면 됩니다.
-- 대신 기존 회원 표에 칸 네 개를 더합니다.
--
-- 옛날 MySQL 5.0 에서도 돌아가도록 낮춰서 썼습니다. 이런 부분입니다.
--
--   문자셋을 utf8 로 뒀습니다. 서버가 MySQL 5.5.3 이상이면 이 파일에서 utf8 을
--   전부 utf8mb4 로 바꾸시는 편이 낫습니다. 그래야 이모지가 안 깨집니다.
--
--   시각 칸에 DEFAULT CURRENT_TIMESTAMP 를 안 썼습니다. 그건 MySQL 5.6.5 부터
--   되는 것이라서요. 대신 값을 넣을 때 NOW() 를 같이 적어 주셔야 하는데,
--   같이 드린 PHP 파일들은 이미 그렇게 되어 있습니다.


-- ============================================================
-- 1) 기존 회원 표에 칸 더하기
--    'users' 를 실제 회원 표 이름으로 바꿔 주세요.
-- ============================================================

ALTER TABLE `users`
  ADD COLUMN `points`      INT         NOT NULL DEFAULT 0,
  ADD COLUMN `avatar_id`   VARCHAR(40) NOT NULL DEFAULT '',
  ADD COLUMN `border_id`   VARCHAR(40)     NULL,
  ADD COLUMN `member_type` VARCHAR(20) NOT NULL DEFAULT 'female';

-- 랭킹·마이페이지에서 포인트로 줄 세울 때 씁니다
ALTER TABLE `users` ADD INDEX `idx_users_points` (`points`);


-- ============================================================
-- 2) 포인트 내역
--    회원 표의 points 값은 이 표에 쌓인 금액을 다 더한 것과 같아야 합니다.
--    그래서 포인트를 주거나 뺄 때는 '내역 남기기' 와 '잔액 고치기' 두 문장을
--    하나로 묶어서(트랜잭션) 실행해 주세요. 중간에 끊기면 둘이 어긋나 버립니다.
-- ============================================================

CREATE TABLE `cm_point_logs` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `amount`     INT          NOT NULL,             -- 줄 때는 양수, 살 때 빠지는 건 음수
  `reason`     VARCHAR(20)  NOT NULL,             -- signup / attendance / post / ... / purchase
  `detail`     VARCHAR(255)     NULL,             -- 화면에 그대로 보여 줄 한 줄
  `created_at` DATETIME     NOT NULL,             -- 넣으실 때 NOW() 를 같이 적어 주세요
  PRIMARY KEY (`id`),
  KEY `idx_cm_plog_user` (`user_id`, `id`),
  KEY `idx_cm_plog_limit` (`user_id`, `reason`, `created_at`)   -- 하루 한도 세기
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


-- ============================================================
-- 3) 출석 기록
--    회원번호와 날짜를 UNIQUE 로 묶어 뒀습니다. 그래서 하루에 두 번 출석하는 건
--    DB 가 알아서 막아 줍니다. 버튼을 빠르게 두 번 누르셔도, 창 두 개에서 동시에
--    누르셔도 기록은 하나만 들어갑니다.
-- ============================================================

CREATE TABLE `cm_attendance` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `day`        DATE         NOT NULL,             -- 출석한 날짜 (YYYY-MM-DD)
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cm_att_user_day` (`user_id`, `day`),
  KEY `idx_cm_att_user` (`user_id`, `day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


-- ============================================================
-- 4) 산 캐릭터와 테두리
--    item_code 에는 캐릭터목록.php 에 적힌 code 가 들어갑니다.
--    female-glamgold-2-2 이런 모양입니다.
-- ============================================================

CREATE TABLE `cm_user_items` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `item_code`  VARCHAR(40)  NOT NULL,
  `price`      INT          NOT NULL DEFAULT 0,   -- 살 때의 값. 나중에 값을 바꾸셔도 내역은 남게
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cm_item_user_code` (`user_id`, `item_code`),   -- 같은 걸 두 번 못 사게
  KEY `idx_cm_item_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


-- ============================================================
-- 5) 알림
--    안 쓰셔도 나머지 기능은 다 정상으로 돕니다.
-- ============================================================

CREATE TABLE `cm_notifications` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `message`    VARCHAR(255) NOT NULL,
  `link`       VARCHAR(255)     NULL,
  `is_read`    TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cm_noti_user` (`user_id`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


-- ============================================================
-- 이미 회원이 있는 사이트라면
-- ============================================================
-- 이미 있는 회원분들께 가입 포인트를 한 번씩 주고 시작하시려면 아래를 실행하시면 됩니다.
-- 안 하셔도 됩니다.
--
-- INSERT INTO `cm_point_logs` (user_id, amount, reason, detail, created_at)
-- SELECT `id`, 1000, 'signup', '커뮤니티 첫 방문', NOW() FROM `users`;
-- UPDATE `users` SET points = points + 1000;
