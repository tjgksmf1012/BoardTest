-- 커뮤니티 이식 — 표 만들기
--
-- 새로 만드는 표는 넷뿐입니다. 글·댓글·추천은 기존 것을 쓰시면 됩니다.
-- 그리고 기존 회원 표에 칸 네 개를 더합니다.
--
-- MySQL 5.0 에서도 돌도록 낮춰 두었습니다.
--   · CHARSET 은 utf8 입니다. 서버가 5.5.3 이상이면 utf8mb4 로 바꾸시는 편이 낫습니다
--     (이모지가 안 깨집니다). 이 파일에서 utf8 을 utf8mb4 로 모두 바꾸면 됩니다.
--   · DATETIME 에 DEFAULT CURRENT_TIMESTAMP 를 안 씁니다 (MySQL 5.6.5 부터라서).
--     넣을 때 NOW() 를 함께 적습니다 — 첨부된 PHP 파일들은 그렇게 되어 있습니다.


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
--    users.points 는 이 표의 합과 같아야 합니다.
--    지급·차감은 반드시 '내역 남기기' 와 '잔액 고치기' 를 한 트랜잭션으로 묶어 주세요.
-- ============================================================

CREATE TABLE `cm_point_logs` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `amount`     INT          NOT NULL,             -- 지급은 양수, 구매 차감은 음수
  `reason`     VARCHAR(20)  NOT NULL,             -- signup / attendance / post / ... / purchase
  `detail`     VARCHAR(255)     NULL,             -- 화면에 그대로 보여 줄 한 줄
  `created_at` DATETIME     NOT NULL,             -- 넣을 때 NOW() 를 함께 적어 주세요
  PRIMARY KEY (`id`),
  KEY `idx_cm_plog_user` (`user_id`, `id`),
  KEY `idx_cm_plog_limit` (`user_id`, `reason`, `created_at`)   -- 하루 한도 세기
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


-- ============================================================
-- 3) 출석 기록
--    (user_id, day) 를 UNIQUE 로 묶어 하루 두 번 출석을 DB가 막습니다.
--    버튼을 두 번 눌러도, 두 창에서 동시에 눌러도 한 번만 들어갑니다.
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
-- 4) 산 캐릭터·테두리
--    item_code 는 캐릭터목록.php 의 code 입니다 (예: female-glamgold-2-2).
-- ============================================================

CREATE TABLE `cm_user_items` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `item_code`  VARCHAR(40)  NOT NULL,
  `price`      INT          NOT NULL DEFAULT 0,   -- 산 시점의 값 (나중에 값이 바뀌어도 내역이 남게)
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cm_item_user_code` (`user_id`, `item_code`),   -- 같은 걸 두 번 못 사게
  KEY `idx_cm_item_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;


-- ============================================================
-- 5) 알림 (안 쓰셔도 나머지는 정상 동작합니다)
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
-- 기존 회원에게 가입 포인트를 한 번씩 주시려면 (선택):
--
-- INSERT INTO `cm_point_logs` (user_id, amount, reason, detail, created_at)
-- SELECT `id`, 1000, 'signup', '커뮤니티 첫 방문', NOW() FROM `users`;
-- UPDATE `users` SET points = points + 1000;
