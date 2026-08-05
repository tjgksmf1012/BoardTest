<?php
/*
 * 드린 PHP 가 실제로 도는지 확인하는 파일입니다.
 *
 *   php 이식용/test/run.php
 *
 * MySQL 을 안 띄우고도 확인할 수 있게 SQLite 로 돌립니다. SQL 은 거의 같은데 날짜
 * 함수 몇 개가 달라서 아래 cm_dialect() 에서 바꿔 줍니다. NOW() 를
 * datetime('now','localtime') 로 바꾸는 식입니다.
 *
 * 하루 한도, 연속 출석, 구매, 포인트 부호 같은 것들은 DB 종류하고 상관없이 똑같이
 * 돌아가는 부분이라 여기서 확인이 됩니다.
 */

$ok = 0; $fail = 0;
function t($what, $cond, $got = '') {
    global $ok, $fail;
    if ($cond) { $ok++; echo "  OK   $what\n"; }
    else { $fail++; echo "  FAIL $what" . ($got !== '' ? "  ($got)" : '') . "\n"; }
}

// ---- SQLite 로 돌리기 위한 최소 준비 -------------------------------------------
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_SILENT);

require dirname(__FILE__) . '/../lib/cm_config.php';
$CM['user_table'] = 'users';
$CM['user_pk'] = 'id';
$CM['avatar_url'] = '/img/avatars';

// SQLite 로 돌리려고 문법만 바꿔 끼운다.
// cm_db.php 를 읽기 전에 정의해 두면 그쪽에서 이걸 쓴다 (function_exists 로 확인함).
function cm_dialect($sql) {
    $sql = str_replace('NOW()', "datetime('now','localtime')", $sql);
    $sql = str_replace('CURDATE()', "date('now','localtime')", $sql);
    $sql = str_replace('START TRANSACTION', 'BEGIN', $sql);
    return str_replace('`', '"', $sql);
}

require dirname(__FILE__) . '/../lib/cm_db.php';
cm_use_pdo($pdo);

$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, points INT NOT NULL DEFAULT 0,
            avatar_id TEXT NOT NULL DEFAULT "", border_id TEXT, member_type TEXT NOT NULL DEFAULT "female")');
$pdo->exec('CREATE TABLE cm_point_logs (id INTEGER PRIMARY KEY, user_id INT, amount INT,
            reason TEXT, detail TEXT, created_at TEXT)');
$pdo->exec('CREATE TABLE cm_attendance (id INTEGER PRIMARY KEY, user_id INT, day TEXT,
            created_at TEXT, UNIQUE(user_id, day))');
$pdo->exec('CREATE TABLE cm_user_items (id INTEGER PRIMARY KEY, user_id INT, item_code TEXT,
            price INT, created_at TEXT, UNIQUE(user_id, item_code))');
$pdo->exec('INSERT INTO users (id, points, member_type) VALUES (1, 0, "female")');

require dirname(__FILE__) . '/../lib/cm_points.php';
require dirname(__FILE__) . '/../lib/cm_attendance.php';
require dirname(__FILE__) . '/../lib/cm_avatar.php';

echo "\n== 포인트 ==\n";
$r = cm_award(1, 'signup');
t('가입 1,000P 가 지급된다', $r['awarded'] === 1000, $r['awarded']);
t('잔액에 반영된다', cm_points(1) === 1000, cm_points(1));

$a = cm_award(1, 'post'); $b = cm_award(1, 'post'); $c = cm_award(1, 'post');
$d = cm_award(1, 'post');
t('글 300P 가 하루 3개까지만 지급된다', $a['awarded'] === 300 && $c['awarded'] === 300
    && $d['awarded'] === 0 && $d['limited'] === true, $d['awarded']);
t('한도가 차면 기록도 안 남는다',
    (int)cm_one("SELECT COUNT(*) FROM cm_point_logs WHERE reason = 'post'") === 3);
t('잔액은 1000 + 900', cm_points(1) === 1900, cm_points(1));

echo "\n== 부호 표기 ==\n";
t('지급은 +1,000P', cm_point_str(1000) === '+1,000P', cm_point_str(1000));
t('차감은 −2,000P (부호 하나)', cm_point_str(-2000) === '−2,000P', cm_point_str(-2000));
t('+- 처럼 두 개가 붙지 않는다', strpos(cm_point_str(-2000), '+-') === false);

echo "\n== 구매 ==\n";
t('포인트가 모자라면 못 산다', cm_spend(1, 999999, '테스트') === false);
t('실패했으면 잔액이 그대로다', cm_points(1) === 1900, cm_points(1));
$items = cm_items();
t('캐릭터 목록을 읽는다 (246종)', count($items) === 246, count($items));

$paid = null;
for ($i = 0; $i < count($items); $i++) {
    if ($items[$i]['kind'] === 'character' && $items[$i]['memberType'] === 'female'
        && cm_price($items[$i]) > 0) { $paid = $items[$i]; break; }
}
cm_q("UPDATE users SET points = 5000 WHERE id = 1");
t('2,000P 짜리 캐릭터를 산다', cm_buy(1, $paid['code']) === true);
t('잔액에서 빠졌다', cm_points(1) === 3000, cm_points(1));
t('내역에 음수로 남았다',
    (int)cm_one("SELECT amount FROM cm_point_logs WHERE reason = 'purchase'") === -2000);
t('오늘 적립은 구매에 깎이지 않는다', cm_earned_today(1) > 0, cm_earned_today(1));
$before = cm_points(1);
cm_buy(1, $paid['code']);
t('같은 걸 두 번 사도 두 번 안 빠진다', cm_points(1) === $before, cm_points(1));
t('산 캐릭터를 장착할 수 있다', cm_equip(1, $paid['code'], 'female') === true);
t('장착이 회원 표에 저장된다',
    cm_one("SELECT avatar_id FROM users WHERE id = 1") === $paid['code']);

$other = null;
for ($i = 0; $i < count($items); $i++) {
    if ($items[$i]['kind'] === 'character' && $items[$i]['memberType'] === 'male') {
        $other = $items[$i]; break;
    }
}
if ($other !== null) {
    t('다른 유형 캐릭터는 장착 못 한다', cm_equip(1, $other['code'], 'female') === false);
}

echo "\n== 출석 ==\n";
$pdo->exec('DELETE FROM cm_attendance');
$r = cm_check_attendance(1);
t('오늘 출석하면 10P', $r['awarded'] === 10 && $r['already'] === false, $r['awarded']);
t('연속 1일', $r['streak'] === 1, $r['streak']);
$r2 = cm_check_attendance(1);
t('같은 날 두 번은 안 된다', $r2['already'] === true && $r2['awarded'] === 0);
t('기록이 하나뿐이다', (int)cm_one("SELECT COUNT(*) FROM cm_attendance") === 1);

// 어제부터 6일 전까지 채워 오늘로 7일 연속을 만든다
$pdo->exec('DELETE FROM cm_attendance');
for ($i = 6; $i >= 1; $i--) {
    $d = date('Y-m-d', strtotime('-' . $i . ' day'));
    cm_q("INSERT INTO cm_attendance (user_id, day, created_at) VALUES (?, ?, NOW())", array(1, $d));
}
t('오늘 전 연속은 6일', cm_streak(1) === 6, cm_streak(1));
$r3 = cm_check_attendance(1);
t('7일째 출석에 연속 7일이 된다', $r3['streak'] === 7, $r3['streak']);
t('7일 보너스 50P 를 받아 총 60P', $r3['awarded'] === 60, $r3['awarded']);
t('보너스 이름이 나온다', count($r3['bonus']) === 1, implode(',', $r3['bonus']));

// 8일째에는 보너스가 없어야 한다
$pdo->exec('DELETE FROM cm_attendance');
for ($i = 7; $i >= 1; $i--) {
    $d = date('Y-m-d', strtotime('-' . $i . ' day'));
    cm_q("INSERT INTO cm_attendance (user_id, day, created_at) VALUES (?, ?, NOW())", array(1, $d));
}
$r4 = cm_check_attendance(1);
t('8일째에는 보너스를 또 주지 않는다', $r4['streak'] === 8 && $r4['awarded'] === 10,
    $r4['streak'] . '일 / ' . $r4['awarded'] . 'P');

// 끊겼다가 다시 채우면 또 받는다
$pdo->exec('DELETE FROM cm_attendance');
for ($i = 6; $i >= 1; $i--) {
    $d = date('Y-m-d', strtotime('-' . $i . ' day'));
    cm_q("INSERT INTO cm_attendance (user_id, day, created_at) VALUES (?, ?, NOW())", array(1, $d));
}
$r5 = cm_check_attendance(1);
t('끊겼다 다시 7일을 채우면 보너스를 다시 받는다', $r5['awarded'] === 60, $r5['awarded']);

echo "\n== 잔액과 내역이 어긋나지 않는다 ==\n";
// UPDATE 는 한 줄도 안 바꿔도 '성공' 으로 돌아온다. 그걸 그대로 믿으면
// 포인트는 안 빠졌는데 구매 기록만 남는다.
cm_q("UPDATE users SET points = 0 WHERE id = 1");
$r = cm_q("UPDATE users SET points = points - ? WHERE id = ? AND points >= ?",
          array(2000, 1, 2000));
t('잔액이 모자란 UPDATE 도 성공으로 돌아온다 (그래서 확인이 필요하다)', $r ? true : false);
t('그때 바뀐 줄 수는 0 이다', cm_affected() === 0, cm_affected());

$logs_before = (int)cm_one("SELECT COUNT(*) FROM cm_point_logs");
t('포인트가 0이면 못 산다', cm_spend(1, 2000, '테스트') === false);
t('실패했으면 내역도 안 남는다',
    (int)cm_one("SELECT COUNT(*) FROM cm_point_logs") === $logs_before,
    (int)cm_one("SELECT COUNT(*) FROM cm_point_logs"));

/* 두 요청이 겹친 상황을 진짜로 만든다.
 *
 * cm_spend 는 잔액을 먼저 읽고 통과시킨 뒤에 UPDATE 를 때린다. 그 사이에 다른 요청이
 * 먼저 돈을 빼 가면, UPDATE 의 `AND points >= ?` 가 한 줄도 못 바꾼다.
 * 그런데 UPDATE 는 그래도 '성공' 으로 돌아온다.
 *
 * 한 프로세스에서는 그 틈을 만들 수가 없어서, 내역이 들어가는 순간 잔액을 0으로
 * 만드는 트리거를 걸어 흉내 낸다. cm_spend 입장에서는 남이 끼어든 것과 똑같다.
 */
cm_q("UPDATE users SET points = 5000 WHERE id = 1");
$pdo->exec("CREATE TRIGGER 끼어들기 AFTER INSERT ON cm_point_logs
            BEGIN UPDATE users SET points = 0 WHERE id = 1; END");
$before_logs = (int)cm_one("SELECT COUNT(*) FROM cm_point_logs");
$r = cm_spend(1, 2000, '겹친 요청');
$pdo->exec("DROP TRIGGER 끼어들기");
t('읽은 뒤에 남이 먼저 빼 가면 실패로 끝난다', $r === false, $r ? 'true' : 'false');
t('그때 구매 내역이 남지 않는다',
    (int)cm_one("SELECT COUNT(*) FROM cm_point_logs") === $before_logs,
    (int)cm_one("SELECT COUNT(*) FROM cm_point_logs") . ' (전 ' . $before_logs . ')');

cm_q("UPDATE users SET points = 3000 WHERE id = 1");
$sum_before = (int)cm_one("SELECT COALESCE(SUM(amount),0) FROM cm_point_logs");
cm_spend(1, 2000, '테스트 구매');
t('잔액과 내역 증감이 맞는다',
    cm_points(1) === 1000
    && (int)cm_one("SELECT COALESCE(SUM(amount),0) FROM cm_point_logs") === $sum_before - 2000,
    cm_points(1));

echo "\n== 캐릭터 그리기 ==\n";
$html = cm_render_avatar($paid['code'], 'border-gold', 44);
t('고리 크기가 요소에 직접 붙는다 (134%)', strpos($html, 'width:134%') !== false);
t('캐릭터 크기가 요소에 직접 붙는다 (92%)', strpos($html, 'width:92%') !== false);
t('고리를 끼면 잘라내기를 푼다', strpos($html, 'overflow:visible') !== false);
$plain = cm_render_avatar($paid['code'], null, 44);
t('고리가 없으면 칸을 꽉 채운다', strpos($plain, 'width:100%') !== false
    && strpos($plain, 'width:92%') === false);
t('작게 그릴 때는 썸네일을 쓴다', strpos($html, $paid['thumb']) !== false);
$big = cm_render_avatar($paid['code'], 'border-gold', 200);
t('크게 그릴 때는 원본을 쓴다', strpos($big, $paid['file']) !== false);

echo "\n== 값 넣기 (SQL 인젝션) ==\n";
$evil = "1' OR '1'='1";
$n = cm_count_today($evil, 'post');
t('따옴표가 든 값을 넣어도 터지지 않는다', $n === 0, $n);
$sql = cm_bind("SELECT ? , 'a?b'", array("O'Reilly"));
t('따옴표 안의 ? 는 값으로 바뀌지 않는다', strpos($sql, "'a?b'") !== false, $sql);
t('값의 따옴표는 이스케이프된다', strpos($sql, "O''Reilly") !== false
    || strpos($sql, "O\\'Reilly") !== false, $sql);

echo "\n----------------------------------------\n";
echo "확인 " . ($ok + $fail) . "개 · 통과 $ok · 실패 $fail\n";
exit($fail > 0 ? 1 : 0);
