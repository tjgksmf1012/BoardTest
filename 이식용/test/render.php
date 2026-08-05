<?php
/*
 * 화면 PHP 세 개가 실제로 돌아가는지 확인 (SQLite 로 돌립니다)
 *
 *   php 이식용/test/render.php
 *   php 이식용/test/render.php --save   결과 HTML 을 파일로 남깁니다
 *
 * 왜 이걸 만들었나
 *   함수가 맞게 도는 것과 화면이 그려지는 것은 다른 문제입니다.
 *   run.php 는 함수만 봅니다. 여기서는 화면 파일을 진짜로 include 해서
 *   HTML 이 나오는지, 오류가 안 나는지, 버튼을 눌렀을 때 값이 바뀌는지를 봅니다.
 *
 * 여기서 통과했다고 선배님 서버에서 100% 돈다는 뜻은 아닙니다.
 * DB 가 MySQL 이 아니라 SQLite 고, 로그인도 흉내 낸 것이라서요.
 * 다만 '문법 오류가 있다', '함수 이름을 틀렸다', '값이 안 넘어온다' 같은 것은 여기서 다 걸립니다.
 */

$ok = 0; $fail = 0;
function t($what, $cond, $got = '') {
    global $ok, $fail;
    if ($cond) { $ok++; echo "  OK   $what\n"; }
    else { $fail++; echo "  FAIL $what" . ($got !== '' ? "  ($got)" : '') . "\n"; }
}

// ---- SQLite 로 돌리기 위한 준비 -----------------------------------------------
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_SILENT);

function cm_dialect($sql) {
    $sql = str_replace('NOW()', "datetime('now','localtime')", $sql);
    $sql = str_replace('CURDATE()', "date('now','localtime')", $sql);
    $sql = str_replace('START TRANSACTION', 'BEGIN', $sql);
    return str_replace('`', '"', $sql);
}

// 화면 파일은 cm_current_user_id() 로 '누구 것을 보여 줄까' 를 정합니다.
// 여기서는 로그인을 흉내 내려고 미리 정의해 둡니다.
// cm_config.php 가 function_exists 로 확인하기 때문에 이쪽이 쓰입니다.
$CM_TEST_UID = 1;
function cm_current_user_id() {
    global $CM_TEST_UID;
    return $CM_TEST_UID;
}

$LIB = dirname(__FILE__) . '/../lib';
require $LIB . '/cm_config.php';
$CM['user_table'] = 'users';
$CM['user_pk'] = 'id';
$CM['avatar_url'] = '/img/avatars';

require $LIB . '/cm_db.php';
cm_use_pdo($pdo);

$pdo->exec('CREATE TABLE users (id INTEGER PRIMARY KEY, nickname TEXT, points INT NOT NULL DEFAULT 0,
            avatar_id TEXT NOT NULL DEFAULT "", border_id TEXT, member_type TEXT NOT NULL DEFAULT "female")');
$pdo->exec('CREATE TABLE cm_point_logs (id INTEGER PRIMARY KEY, user_id INT, amount INT,
            reason TEXT, detail TEXT, created_at TEXT)');
$pdo->exec('CREATE TABLE cm_attendance (id INTEGER PRIMARY KEY, user_id INT, day TEXT,
            created_at TEXT, UNIQUE(user_id, day))');
$pdo->exec('CREATE TABLE cm_user_items (id INTEGER PRIMARY KEY, user_id INT, item_code TEXT,
            price INT, created_at TEXT, UNIQUE(user_id, item_code))');
$pdo->exec('INSERT INTO users (id, nickname, points, member_type)
            VALUES (1, "테스트회원", 50000, "female")');

require $LIB . '/cm_points.php';
require $LIB . '/cm_attendance.php';
require $LIB . '/cm_avatar.php';

// 화면 파일을 끼워 넣기 모드로 돌립니다 (기존 페이지 안에 들어간 상태를 흉내 냅니다)
define('CM_EMBED', 1);

// 화면 파일 하나를 돌려서 나온 HTML 을 돌려준다.
// include 는 함수 안에서 하면 그 안의 변수가 함수 지역이 되므로,
// 화면 파일이 쓰는 $CM 을 global 로 끌어와야 한다.
function render($file, $get = array(), $post = array()) {
    global $CM, $CM_LINK, $CM_PDO, $CM_KIND, $CM_ITEMS, $CM_CALLER;
    $_GET = $get;
    $_POST = $post;
    $_SERVER['REQUEST_URI'] = '/화면/' . basename($file);
    $_SERVER['SCRIPT_FILENAME'] = '/화면/index.php';   // 직접 연 것이 아니게
    ob_start();
    include dirname(__FILE__) . '/../화면/' . $file;
    return ob_get_clean();
}

// 태그 짝이 맞는지 대충 본다. 여는 것과 닫는 것 수가 다르면 화면이 깨진다.
function tags_balanced($html, $tag) {
    $open = preg_match_all('/<' . $tag . '[\s>]/', $html, $m);
    $close = preg_match_all('/<\/' . $tag . '>/', $html, $m2);
    return $open === $close;
}

@session_start();

echo "\n== 출석체크 화면 ==\n";
$h = render('출석체크.php');
t('HTML 이 나온다', strlen($h) > 500, strlen($h) . '바이트');
t('제목이 있다', strpos($h, '출석체크') !== false);
t('오류 문구가 안 섞였다',
    strpos($h, 'Fatal error') === false && strpos($h, 'Warning') === false
    && strpos($h, 'Notice') === false && strpos($h, 'Parse error') === false);
t('div 짝이 맞는다', tags_balanced($h, 'div'));
t('출석 버튼이 있다', strpos($h, '오늘 출석체크 하기') !== false);
t('아직 출석 전이라 연속 0일', strpos($h, '>0일</strong>') !== false);
t('폼 위조 막는 값이 들어 있다', strpos($h, 'name="cm_token"') !== false);

// 출석 버튼을 눌러 본다
$post = array('cm_do' => 'attend', 'cm_token' => cm_token());
$h2 = render('출석체크.php', array(), $post);
t('누르면 적립 안내가 뜬다', strpos($h2, '연속 출석!') !== false);
t('연속이 1일이 된다', strpos($h2, '>1일</strong>') !== false);
t('버튼이 완료로 바뀐다', strpos($h2, '오늘 출석 완료') !== false);
t('DB 에 하루치만 들어갔다',
    (int)cm_one("SELECT COUNT(*) FROM cm_attendance") === 1);

// 토큰 없이 누르면 안 먹어야 한다
$pdo->exec('DELETE FROM cm_attendance');
$h3 = render('출석체크.php', array(), array('cm_do' => 'attend'));
t('토큰 없이 누르면 출석이 안 된다',
    (int)cm_one("SELECT COUNT(*) FROM cm_attendance") === 0);
t('그때 안내 문구가 나온다', strpos($h3, '다시 눌러') !== false);

echo "\n== 캐릭터 상점 화면 ==\n";
$h = render('캐릭터상점.php');
t('HTML 이 나온다', strlen($h) > 500, strlen($h) . '바이트');
t('오류 문구가 안 섞였다',
    strpos($h, 'Fatal error') === false && strpos($h, 'Warning') === false
    && strpos($h, 'Notice') === false && strpos($h, 'Parse error') === false);
t('div 짝이 맞는다', tags_balanced($h, 'div'));
t('form 짝이 맞는다', tags_balanced($h, 'form'));
t('1단계에 테마 9개가 나온다', substr_count($h, 'theme-cell') === 9,
    substr_count($h, 'theme-cell'));
t('테두리도 같이 나온다', strpos($h, '사용 안 함') !== false);
t('보유 포인트가 보인다', strpos($h, number_format(cm_points(1)) . 'P') !== false,
    number_format(cm_points(1)));

// 테마 하나를 열어 본다
$h = render('캐릭터상점.php', array('theme' => 'glamgold'));
t('2단계에 25칸이 나온다', substr_count($h, 'shop-name') === 25 + 10,
    substr_count($h, 'shop-name') . '개 (캐릭터25 + 테두리9 + 사용안함1)');
t('테마 이름이 보인다', strpos($h, '글램 골드') !== false);
t('돌아가는 링크가 있다', strpos($h, '테마 고르기') !== false);

// 하나 사 본다
$items = cm_items();
$paid = null;
for ($i = 0; $i < count($items); $i++) {
    if ($items[$i]['kind'] === 'character' && $items[$i]['memberType'] === 'female'
        && cm_price($items[$i]) > 0) { $paid = $items[$i]; break; }
}
$before = cm_points(1);
$h = render('캐릭터상점.php', array(),
            array('cm_do' => 'buy', 'code' => $paid['code'], 'cm_token' => cm_token()));
t('사면 안내가 뜬다', strpos($h, '구매했어요') !== false);
t('포인트가 빠졌다', cm_points(1) === $before - 2000, cm_points(1));

$h = render('캐릭터상점.php', array(),
            array('cm_do' => 'equip', 'code' => $paid['code'], 'cm_token' => cm_token()));
t('장착하면 안내가 뜬다', strpos($h, '장착했어요') !== false);
t('회원 표에 저장된다',
    cm_one("SELECT avatar_id FROM users WHERE id = 1") === $paid['code']);
t('그 칸이 사용 중으로 바뀐다', strpos($h, '사용 중') !== false);

// 토큰 없이 사면 안 먹어야 한다
$before = cm_points(1);
render('캐릭터상점.php', array(), array('cm_do' => 'buy', 'code' => 'border-cyan'));
t('토큰 없이 사면 포인트가 안 빠진다', cm_points(1) === $before, cm_points(1));

echo "\n== 마이페이지 화면 ==\n";
$h = render('마이페이지.php');
t('HTML 이 나온다', strlen($h) > 500, strlen($h) . '바이트');
t('오류 문구가 안 섞였다',
    strpos($h, 'Fatal error') === false && strpos($h, 'Warning') === false
    && strpos($h, 'Notice') === false && strpos($h, 'Parse error') === false);
t('div 짝이 맞는다', tags_balanced($h, 'div'));
t('닉네임이 나온다', strpos($h, '테스트회원') !== false);
t('달력이 나온다', strpos($h, 'calendar') !== false);
t('달력 칸이 이번 달 날짜 수만큼 있다',
    substr_count($h, 'cal-cell') === (int)date('t') + (int)date('w', mktime(0,0,0,(int)date('n'),1,(int)date('Y'))),
    substr_count($h, 'cal-cell'));
t('적립 내역이 나온다', strpos($h, '적립 내역') !== false);
t('구매가 음수로 보인다', strpos($h, '−2,000P') !== false);

echo "\n== 로그인 안 했을 때 ==\n";
$CM_TEST_UID = 0;
$files = array('출석체크.php', '캐릭터상점.php', '마이페이지.php');
for ($i = 0; $i < count($files); $i++) {
    $h = render($files[$i]);
    t($files[$i] . ' 는 로그인 안내를 띄운다', strpos($h, '로그인하시면') !== false);
    t($files[$i] . ' 에 남의 정보가 안 샌다', strpos($h, '테스트회원') === false);
}

// 결과를 눈으로 보고 싶을 때
if (in_array('--save', $argv)) {
    $CM_TEST_UID = 1;
    // 저장한 파일을 브라우저로 바로 열어 보시라고, 그림 주소를 그 폴더 기준으로 바꿉니다.
    // 실제 서버에서는 cm_config.php 의 avatar_url 을 그대로 씁니다.
    $CM['avatar_url'] = '../../img/avatars';
    $dir = dirname(__FILE__) . '/../화면HTML/_php출력';
    @mkdir($dir, 0777, true);
    for ($i = 0; $i < count($files); $i++) {
        $h = '<!doctype html><meta charset="utf-8">'
           . '<link rel="stylesheet" href="../../화면/cm.css">'
           . render($files[$i]);
        file_put_contents($dir . '/' . $files[$i] . '.html', $h);
    }
    echo "\n화면 3개를 " . $dir . " 에 저장했습니다.\n";
}

echo "\n----------------------------------------\n";
echo "확인 " . ($ok + $fail) . "개 · 통과 $ok · 실패 $fail\n";
exit($fail > 0 ? 1 : 0);
