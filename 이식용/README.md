# 커뮤니티 이식용 — 바로 붙여 쓰시는 PHP

포인트 · 출석체크 · 캐릭터(아바타) 세 가지를 기존 커뮤니티에 얹는 코드입니다.
**PHP 5.1 에서 돌도록** 썼고, 실제로 돌려서 확인한 것들입니다
(테스트 38개 통과 — `php test/run.php` 로 직접 돌려보실 수 있습니다).

글·댓글·추천은 이미 갖고 계신 것을 그대로 쓰시면 됩니다. 여기엔 없습니다.

---

## 폴더 안내

| 폴더 · 파일 | 무엇 |
|---|---|
| `install.sql` | 표 만드는 SQL |
| `lib/` | **바로 쓰시는 PHP** — 포인트·출석·캐릭터 |
| `캐릭터목록.php` | 캐릭터 246종 목록 |
| `img/avatars/` | 캐릭터·테두리 그림 492장 |
| `화면HTML/` | **화면 13개의 실제 HTML + CSS** — 열어 보시고 마크업을 가져다 쓰세요 |
| `원본소스/` | 지금 돌고 있는 프로그램 전체 (Node.js). 동작을 확인하실 때 보세요 |
| `test/run.php` | 이 코드가 제대로 도는지 확인 (38가지) |
| `서버확인.php` | 서버 버전·설정 확인 |

### `화면HTML/` 을 먼저 보시면 편합니다

파일을 그냥 브라우저로 여시면 실제 화면이 그대로 나옵니다 (서버 없이도 됩니다).
목록·글보기·글쓰기·출석체크·마이페이지·캐릭터상점 등 13개가 들어 있고,
`화면HTML/css/style.css` 하나에 디자인이 다 들어 있습니다.

마크업을 그대로 복사해 쓰시면 화면을 다시 그리실 필요가 없습니다.
(링크는 `#` 으로 바꿔 두었습니다. 마크업 참고용이라 눌러도 이동하지 않습니다)

### `원본소스/` 는 이럴 때 보세요

"이 화면은 무슨 값을 어떻게 계산해서 뿌리나" 가 궁금하실 때요.

| 궁금한 것 | 볼 파일 |
|---|---|
| 목록·글·댓글 처리 | `원본소스/src/routes/board.js` |
| 포인트 규칙 | `원본소스/src/points.js` |
| 캐릭터·테두리 | `원본소스/src/avatars.js` |
| 출석·마이페이지·상점 | `원본소스/src/routes/user.js` |
| 화면 틀 | `원본소스/views/*.ejs` |

`lib/` 의 PHP 는 이 중 **포인트·출석·캐릭터 부분만** 옮겨 놓은 것입니다.
글·댓글은 기존 것을 쓰시면 되니 옮기지 않았습니다.

---

## 붙이는 순서 — 30분이면 됩니다

### 1) 표 만들기

`install.sql` 을 여세요. 맨 위 `ALTER TABLE users` 의 **`users` 를 실제 회원 표 이름으로**
바꾸신 뒤 통째로 실행하시면 됩니다.

- 기존 회원 표에 칸 4개가 붙습니다 (`points` `avatar_id` `border_id` `member_type`)
- 새 표 4개가 생깁니다 (`cm_point_logs` `cm_attendance` `cm_user_items` `cm_notifications`)

### 2) 파일 올리기

```
/lib/cm_config.php        ← 여기만 고치시면 됩니다
/lib/cm_db.php
/lib/cm_points.php
/lib/cm_attendance.php
/lib/cm_avatar.php
/캐릭터목록.php            ← 캐릭터 246종 목록
/img/avatars/*.png        ← 캐릭터이미지 폴더의 그림들
```

### 3) 설정 다섯 줄

`lib/cm_config.php` 위쪽만 채우시면 됩니다.

```php
$CM['user_table'] = 'users';        // 회원 표 이름
$CM['user_pk']    = 'id';           // 그 표의 기본키 칸
$CM['avatar_url'] = '/img/avatars'; // 그림을 올린 주소
```

### 4) 기존 코드에서 불러 쓰기

```php
require_once '/lib/cm_config.php';
require_once '/lib/cm_db.php';
require_once '/lib/cm_points.php';
require_once '/lib/cm_attendance.php';
require_once '/lib/cm_avatar.php';

cm_use_link($기존_DB연결);   // 이미 연결이 있으면 넘겨 주세요 (없으면 생략)
```

---

## 어디에 무엇을 넣나

### 글·댓글 — 등록이 **성공한 직후** 한 줄

```php
// 글 등록 후
cm_award($user_id, $is_anonymous ? 'anon_post' : 'post');

// 댓글 등록 후
cm_award($user_id, 'comment');

// 추천 후 (글쓴이에게)
cm_award($글쓴이_id, 'like_received', '추천받기 (게시글 #' . $post_id . ')');
```

하루 한도는 안에서 알아서 셉니다. **한도가 차도 글은 정상으로 써져야 합니다** —
포인트만 안 붙는 것이라, 이 함수 결과로 글 등록을 막지 마세요.

### 목록·글·댓글에 캐릭터 그리기

```php
echo cm_render_avatar($row['avatar_id'], $row['border_id'], 44);
```

세 번째는 크기(px)입니다. 목록 44, 글 상세 48, 마이페이지 96 정도로 쓰고 있습니다.

### 출석체크 화면

```php
// 버튼을 눌렀을 때
$r = cm_check_attendance($user_id);
if ($r['already']) {
    echo '오늘은 이미 출석하셨어요.';
} else {
    echo $r['streak'] . '일 연속 출석! ' . cm_point_str($r['awarded']) . ' 받으셨어요.';
    if (count($r['bonus'])) { echo ' (' . implode(', ', $r['bonus']) . ')'; }
}

// 화면에 뿌릴 값들
$streak = cm_streak($user_id);          // 연속 출석 일수
$month  = cm_month_count($user_id);     // 이번 달 출석 횟수
$days   = cm_month_days($user_id);      // 달력에 찍을 날짜 목록
$next   = cm_next_streak($streak);      // 다음 보너스까지 남은 날 (다 채웠으면 null)
$done   = cm_checked_today($user_id);   // 오늘 했는지
```

### 마이페이지 · 포인트

```php
$points = cm_points($user_id);          // 보유 포인트
$today  = cm_earned_today($user_id);    // 오늘 적립 (구매에 깎이지 않습니다)
$logs   = cm_point_logs($user_id);      // 내역

foreach ($logs as $l) {
    echo $l['detail'] . ' ' . cm_point_str($l['amount']);   // +300P / −2,000P
}
```

> `cm_point_str()` 을 꼭 쓰세요. 직접 `'+' . $amount` 로 붙이면 구매 내역이
> `+-2,000P` 처럼 부호가 두 개 나옵니다. (저희가 그렇게 만들었다가 지적받았습니다)

### 상점

```php
$list = cm_shop_characters($user_id, $member_type);  // 'female' | 'male' | 'venue'
$list = cm_shop_borders($user_id);

foreach ($list as $it) {
    echo cm_render_avatar($it['code'], null, 72);
    echo $it['name'];
    echo $it['owned'] ? '보유중' : number_format($it['price']) . 'P';
}

// 구매 버튼
if (cm_buy($user_id, $code)) { echo '구매했어요!'; }
else { echo '포인트가 모자라요.'; }

// 장착 버튼
cm_equip($user_id, $code, $member_type);
cm_equip($user_id, '', $member_type);      // 테두리 빼기
```

---

## 값은 반드시 두 번째 인자로

직접 SQL 을 쓰실 때는 값을 문자열에 붙이지 마시고 이렇게 해 주세요.

```php
cm_q("SELECT * FROM t WHERE id = ? AND name = ?", array($id, $name));
```

서버에 `mysql_*` 밖에 없어도 안에서 이스케이프합니다.
따옴표 안의 `?` 는 값으로 바뀌지 않으니 `LIKE 'a?b'` 같은 것도 안전합니다.

---

## 확인하실 것

### 이 코드가 서버에서 도는지

`../docs/check-server.php` (또는 전달받으신 `서버확인.php`) 를 웹 폴더에 올리고
브라우저로 열어 보세요. PHP·MySQL 버전, 문자셋, 시간대가 한 화면에 나옵니다.
**확인 후에는 지워 주세요.**

### 이 코드가 제대로 도는지

```
php test/run.php
```

38가지를 확인합니다 — 하루 한도, 연속 출석 보너스(7일에 주고 8일엔 안 주고
끊겼다 다시 채우면 또 주는 것), 구매·장착, 포인트 부호, 값 넣기 안전성.
서버에 SQLite 가 없으면 안 돌지만, 그건 테스트용이라 실제 동작과는 무관합니다.

---

## 미리 말씀드릴 것

- **문자셋**: `install.sql` 은 `utf8` 로 되어 있습니다. 서버가 MySQL 5.5.3 이상이면
  파일에서 `utf8` 을 `utf8mb4` 로 모두 바꿔 주세요. 그래야 이모지가 안 깨집니다.
- **시간대**: 출석과 하루 한도가 날짜로 판정됩니다. PHP 와 MySQL 시간대가
  둘 다 한국이어야 자정 근처에서 어긋나지 않습니다.
- **실시간 알림**은 브라우저 연결을 계속 열어두는 방식이라 넣지 않았습니다.
  `cm_notifications` 표에 쌓아두고 페이지 열 때 읽는 방식이면 그대로 쓰실 수 있습니다.
- 포인트 금액을 바꾸시려면 `cm_config.php` 의 `$CM['rules']` 만 고치시면 됩니다.

막히시는 곳 있으면 말씀 주세요. 바로 맞춰 드리겠습니다.
