# 커뮤니티 이식용 PHP

안녕하세요. 포인트, 출석체크, 캐릭터(아바타) 이 세 가지를 기존 커뮤니티에 얹으실 수 있게
PHP 로 옮겨 놓은 것입니다.

호스팅이 PHP 5.1 이라고 하셔서 그 버전에서 도는 문법으로만 썼습니다. 짐작으로 맞춘 게 아니라
실제로 돌려 보고 확인했습니다. `php test/run.php` 를 치시면 38가지를 자동으로 확인해 드립니다.

글이랑 댓글, 추천은 이미 갖고 계신 걸 그대로 쓰시면 되니까 여기에는 안 넣었습니다.

## 폴더에 뭐가 들어 있나

| | |
|---|---|
| `install.sql` | 표 만드는 SQL |
| `lib/` | 실제로 쓰시는 PHP 다섯 개. 포인트·출석·캐릭터 |
| `캐릭터목록.php` | 캐릭터 246종의 이름과 값 |
| `img/avatars/` | 그림 492장. 캐릭터당 큰 것 작은 것 두 장씩입니다 |
| `화면HTML/` | 화면 13개를 HTML 로 뽑아 둔 것 |
| `원본소스/` | 지금 돌고 있는 프로그램 전체 (Node.js) |
| `test/run.php` | 이 코드가 제대로 도는지 확인 |
| `서버확인.php` | 서버 PHP 버전과 설정 보기 |

이 중 `화면HTML/` 과 `원본소스/` 는 아래에서 따로 말씀드리겠습니다.

### 화면HTML 폴더를 먼저 보시면 편합니다

파일을 그냥 브라우저로 여시면 실제 화면이 그대로 나옵니다. 서버에 올리지 않으셔도 됩니다.
목록, 글보기, 글쓰기, 출석체크, 마이페이지, 캐릭터상점 이런 것들이 13개 들어 있고
디자인은 `화면HTML/css/style.css` 파일 하나에 다 있습니다.

여기 HTML 을 그대로 복사해서 쓰시면 화면을 새로 그리실 필요가 없습니다. 다만 링크는 전부
`#` 으로 바꿔 뒀습니다. 눌러도 아무 데도 안 가는데, 화면 모양만 보시라고 만든 것이라 그렇습니다.

### 원본소스는 이럴 때 보세요

"이 화면은 무슨 값을 어떻게 계산해서 뿌리는 건가" 가 궁금하실 때 보시면 됩니다.
아래는 전부 `원본소스/` 아래 경로입니다.

| 궁금한 것 | 볼 파일 |
|---|---|
| 목록·글·댓글 처리 | `src/routes/board.js` |
| 포인트 규칙 | `src/points.js` |
| 캐릭터·테두리 | `src/avatars.js` |
| 출석·마이페이지·상점 | `src/routes/user.js` |
| 화면 틀 | `views/*.ejs` |

`lib/` 의 PHP 는 이 중에서 포인트, 출석, 캐릭터 부분만 옮겨 놓은 것입니다.
글이랑 댓글은 기존 걸 쓰시면 되니까 안 옮겼습니다.

## 붙이는 순서

### 1. 표 만들기

`install.sql` 을 여시면 맨 위에 `ALTER TABLE users` 가 있습니다. 여기 `users` 를
실제 회원 표 이름으로 바꾸신 다음에 파일을 통째로 실행하시면 됩니다.

기존 회원 표에 칸 네 개(`points`, `avatar_id`, `border_id`, `member_type`)가 붙고,
새 표 네 개(`cm_point_logs`, `cm_attendance`, `cm_user_items`, `cm_notifications`)가 생깁니다.

### 2. 파일 올리기

```
/lib/cm_config.php        ← 여기만 고치시면 됩니다
/lib/cm_db.php
/lib/cm_points.php
/lib/cm_attendance.php
/lib/cm_avatar.php
/캐릭터목록.php
/img/avatars/*.png
```

### 3. 설정 세 줄

`lib/cm_config.php` 위쪽만 채우시면 됩니다.

```php
$CM['user_table'] = 'users';        // 회원 표 이름
$CM['user_pk']    = 'id';           // 그 표의 기본키 칸
$CM['avatar_url'] = '/img/avatars'; // 그림을 올리신 주소
```

### 4. 기존 코드에서 불러 쓰기

```php
require_once '/lib/cm_config.php';
require_once '/lib/cm_db.php';
require_once '/lib/cm_points.php';
require_once '/lib/cm_attendance.php';
require_once '/lib/cm_avatar.php';

cm_use_link($기존_DB연결);   // 이미 연결이 있으면 넘겨 주세요. 없으면 이 줄은 빼셔도 됩니다
```

## 어디에 무엇을 넣나

### 글, 댓글, 추천

글이나 댓글 등록이 성공한 바로 다음에 한 줄만 넣어 주시면 됩니다.

```php
// 글 등록 후
cm_award($user_id, $is_anonymous ? 'anon_post' : 'post');

// 댓글 등록 후
cm_award($user_id, 'comment');

// 추천 후 (글쓴이에게)
cm_award($글쓴이_id, 'like_received', '추천받기 (게시글 #' . $post_id . ')');
```

하루에 몇 개까지 주는지는 함수 안에서 알아서 셉니다. 그리고 한도가 다 차더라도 글은 정상으로
써져야 합니다. 포인트만 안 붙는 것이지 글을 막는 게 아니라서요. 그러니까 이 함수 결과를 보고
글 등록을 막지는 말아 주세요.

### 목록이나 글, 댓글에 캐릭터 그리기

```php
echo cm_render_avatar($row['avatar_id'], $row['border_id'], 44);
```

세 번째 값이 크기(px)입니다. 저희는 목록에 44, 글 상세에 48, 마이페이지에 96 을 쓰고 있습니다.

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
$next   = cm_next_streak($streak);      // 다음 보너스까지 남은 날. 다 채웠으면 null
$done   = cm_checked_today($user_id);   // 오늘 했는지
```

### 마이페이지와 포인트

```php
$points = cm_points($user_id);          // 지금 갖고 있는 포인트
$today  = cm_earned_today($user_id);    // 오늘 모은 포인트. 뭘 사도 이 값은 안 줄어듭니다
$logs   = cm_point_logs($user_id);      // 내역

foreach ($logs as $l) {
    echo $l['detail'] . ' ' . cm_point_str($l['amount']);   // +300P / −2,000P
}
```

여기서 `cm_point_str()` 을 꼭 써 주세요. 직접 `'+' . $amount` 이렇게 붙이시면 구매 내역이
`+-2,000P` 처럼 부호가 두 개 나옵니다. 저희가 예전에 그렇게 만들었다가 지적받았던 부분입니다.

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

## SQL 을 직접 쓰실 때

값을 SQL 문자열에 그냥 붙이시면 안 됩니다. 아이디에 따옴표가 들어 있으면 SQL 이 깨지고,
나쁜 마음 먹은 사람이 그걸 이용해서 DB 를 통째로 읽어 갈 수도 있습니다.
그래서 값은 이렇게 두 번째 자리에 따로 넘겨 주세요.

```php
cm_q("SELECT * FROM t WHERE id = ? AND name = ?", array($id, $name));
```

그러면 함수 안에서 따옴표 같은 위험한 글자를 알아서 안전한 형태로 바꿔서 넣습니다.
서버에 옛날 `mysql_*` 함수밖에 없어도 마찬가지로 처리합니다.
따옴표 안에 들어 있는 `?` 는 값으로 안 바꾸니까 `LIKE 'a?b'` 같은 것도 그대로 쓰셔도 됩니다.

## 확인해 보실 것

### 서버가 이 코드를 돌릴 수 있는지

`서버확인.php` 를 웹 폴더에 올리시고 브라우저로 열어 보세요. PHP 버전, MySQL 버전, 문자셋,
시간대가 한 화면에 나옵니다. 보시고 나면 파일은 꼭 지워 주세요. 서버 정보가 그대로 드러나는
파일이라 남겨 두면 위험합니다.

### 이 코드가 제대로 도는지

```
php test/run.php
```

38가지를 확인합니다. 하루 한도가 제대로 걸리는지, 연속 출석 보너스가 7일째에 나오고 8일째에는
안 나오는지, 끊겼다가 다시 채우면 또 나오는지, 사고 장착하는 게 되는지, 포인트 부호가 제대로
찍히는지, 값 넣을 때 안전한지 같은 것들입니다.

서버에 SQLite 가 없으면 이 파일은 안 돌아갑니다. 그런데 이건 확인용으로만 쓰는 것이라
실제 동작하고는 상관없습니다.

## 미리 말씀드릴 것

`install.sql` 의 문자셋은 `utf8` 로 해 뒀습니다. 서버 MySQL 이 5.5.3 이상이면 파일에서
`utf8` 을 전부 `utf8mb4` 로 바꿔 주세요. 그래야 이모지가 안 깨집니다. 옛날 `utf8` 은 한 글자에
3바이트까지만 담을 수 있는데 이모지는 4바이트라서 그렇습니다.

시간대도 한 번 봐 주세요. 출석이랑 하루 한도가 전부 날짜로 판정되기 때문에, PHP 와 MySQL
시간대가 둘 다 한국이 아니면 자정 근처에서 하루가 어긋납니다.

실시간 알림은 안 넣었습니다. 브라우저 연결을 계속 열어 두는 방식이라 옛날 서버에서는 부담이
큽니다. `cm_notifications` 표에 쌓아 두고 페이지를 열 때 읽어 오는 식이면 지금 것 그대로
쓰실 수 있습니다.

포인트 금액을 바꾸시려면 `cm_config.php` 의 `$CM['rules']` 만 고치시면 됩니다.

막히시는 곳 있으면 말씀 주세요. 바로 맞춰 드리겠습니다.
