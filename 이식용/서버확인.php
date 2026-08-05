<?php
/*
 * 서버가 어떤 상태인지 한 화면에 보여 주는 파일입니다. 옮기시기 전에 한 번 돌려 주세요.
 *
 *   1) 이 파일 하나만 웹 폴더에 올리고 브라우저로 엽니다
 *   2) 나온 결과를 그대로 보내 주시면 됩니다
 *   3) 다 보시고 나면 꼭 지워 주세요. 서버 정보가 그대로 드러나는 파일입니다
 *
 * DB 상태까지 보시려면 아래 네 줄만 채워 주세요. 비워 두시면 PHP 만 검사합니다.
 *
 * 이 파일은 아주 옛날 서버에서도 돌게 PHP 4 문법으로만 썼습니다.
 */

$DB_HOST = '';
$DB_USER = '';
$DB_PASS = '';
$DB_NAME = '';

// ---------------------------------------------------------------------------

$rows = array();

function chk($what, $ok, $found, $need) {
    global $rows;
    $rows[] = array('what' => $what, 'ok' => $ok, 'found' => $found, 'need' => $need);
}

// ---- PHP --------------------------------------------------------------------
$php = phpversion();
chk('PHP 버전', version_compare($php, '5.1.0', '>='), $php, '5.1 이상');

chk('hash_hmac() — 연동 토큰 서명에 씁니다',
    function_exists('hash_hmac'), function_exists('hash_hmac') ? '있음' : '없음',
    '있어야 함 (PHP 5.1.2+). 없으면 순수 PHP 판을 드립니다');

chk('json_decode() — 없으면 avatars.php 를 쓰시면 됩니다',
    function_exists('json_decode'), function_exists('json_decode') ? '있음' : '없음',
    '없어도 됩니다');

chk('mbstring — 한글 글자수 세기·자르기',
    function_exists('mb_strlen'), function_exists('mb_strlen') ? '있음' : '없음',
    '있는 편이 좋음');

$gd = function_exists('imagecreatetruecolor');
chk('GD — 올린 사진 크기 줄이기',
    $gd, $gd ? '있음' : '없음', '사진 첨부를 쓰시면 필요');

// DB 연결 수단
$drivers = array();
if (function_exists('mysqli_connect')) { $drivers[] = 'mysqli'; }
if (class_exists('PDO')) { $drivers[] = 'PDO'; }
if (function_exists('mysql_connect')) { $drivers[] = 'mysql_* (옛 방식)'; }
chk('DB 연결 수단', count($drivers) > 0,
    count($drivers) ? implode(' · ', $drivers) : '없음',
    'mysqli 나 PDO 가 있으면 값 바인딩이 쉬워집니다');

chk('업로드 한 장 최대 크기', true, ini_get('upload_max_filesize'), '10M 이상 권장');
chk('한 번에 올릴 수 있는 총량', true, ini_get('post_max_size'), '50M 이상 권장');

$tz = ini_get('date.timezone');
chk('서버 시간대', $tz === 'Asia/Seoul', $tz ? $tz : '(설정 안 됨)',
    'Asia/Seoul — 출석·하루 한도가 날짜로 판정됩니다');

// ---- DB ---------------------------------------------------------------------
$conn = null;
$dbKind = '';
if ($DB_HOST !== '') {
    if (function_exists('mysqli_connect')) {
        $conn = @mysqli_connect($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
        $dbKind = 'mysqli';
    } else if (function_exists('mysql_connect')) {
        $conn = @mysql_connect($DB_HOST, $DB_USER, $DB_PASS);
        if ($conn) { @mysql_select_db($DB_NAME, $conn); }
        $dbKind = 'mysql';
    }
}

function q1($sql) {
    global $conn, $dbKind;
    if (!$conn) { return null; }
    if ($dbKind === 'mysqli') {
        $r = @mysqli_query($conn, $sql);
        if (!$r) { return null; }
        $row = mysqli_fetch_row($r);
        return $row ? $row : null;
    }
    $r = @mysql_query($sql, $conn);
    if (!$r) { return null; }
    $row = mysql_fetch_row($r);
    return $row ? $row : null;
}

if ($DB_HOST === '') {
    chk('DB 검사', true, '건너뜀', '파일 위쪽 네 줄을 채우면 DB 도 봅니다');
} else if (!$conn) {
    chk('DB 연결', false, '실패', '접속 정보를 확인해 주세요');
} else {
    $v = q1('SELECT VERSION()');
    $ver = $v ? $v[0] : '?';
    $num = preg_replace('/[^0-9.].*$/', '', $ver);

    chk('MySQL 버전', true, $ver, '아래 항목들이 이 버전에 달려 있습니다');
    chk('utf8mb4 (이모지 저장)', version_compare($num, '5.5.3', '>='), $ver,
        '5.5.3 이상이면 utf8mb4 로 만드세요. 아니면 utf8(3바이트) 이라 이모지가 깨집니다');
    chk('DATETIME 기본값에 CURRENT_TIMESTAMP', version_compare($num, '5.6.5', '>='), $ver,
        '5.6.5 미만이면 기본값을 빼고 INSERT 때 NOW() 를 적어야 합니다');
    chk('InnoDB 전문검색(FULLTEXT)', version_compare($num, '5.6', '>='), $ver,
        '5.6 미만이면 검색은 LIKE 로 갑니다');
    chk('한글 부분일치용 ngram 파서', version_compare($num, '5.7', '>='), $ver,
        '5.7 이상이면 ngram_token_size=2 로 쓰시길 권합니다');

    $cs = q1("SHOW VARIABLES LIKE 'character_set_database'");
    chk('DB 문자셋', $cs ? true : false, $cs ? $cs[1] : '?', 'utf8 또는 utf8mb4');

    $tzdb = q1("SELECT @@time_zone, NOW()");
    chk('DB 시간대 · 지금 시각', true,
        $tzdb ? ($tzdb[0] . '  /  ' . $tzdb[1]) : '?',
        'PHP 와 같은 시간대여야 출석 날짜가 어긋나지 않습니다');

    // 회원 표에 덧붙일 칸이 이미 있는지
    $need = array('points', 'avatar_id', 'border_id', 'member_type');
    $guess = array('users', 'member', 'members', 'mb_member', 'g5_member');
    $found = '';
    for ($i = 0; $i < count($guess); $i++) {
        if (q1("SELECT 1 FROM `" . $guess[$i] . "` LIMIT 1") !== null) { $found = $guess[$i]; break; }
    }
    if ($found === '') {
        chk('회원 표 찾기', false, '못 찾음',
            '회원 표 이름을 알려 주시면 덧붙일 칸을 정확히 짚어 드리겠습니다');
    } else {
        $have = array();
        $miss = array();
        for ($i = 0; $i < count($need); $i++) {
            $c = q1("SHOW COLUMNS FROM `" . $found . "` LIKE '" . $need[$i] . "'");
            if ($c === null) { $miss[] = $need[$i]; } else { $have[] = $need[$i]; }
        }
        chk('회원 표 (' . $found . ') 에 덧붙일 칸', count($miss) === 0,
            count($miss) ? '없는 칸: ' . implode(', ', $miss) : '이미 다 있음',
            'points · avatar_id · border_id · member_type');
    }
}

// ---- 출력 -------------------------------------------------------------------
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>서버 자가진단</title>
<style>
 body{font:14px/1.6 -apple-system,"Malgun Gothic",sans-serif;margin:24px;color:#263531}
 h1{font-size:18px}
 table{border-collapse:collapse;width:100%;max-width:900px}
 th,td{border:1px solid #e0e6e4;padding:8px 10px;text-align:left;vertical-align:top}
 th{background:#f4f7f6;font-size:13px}
 .ok{color:#0b7a70;font-weight:700}
 .no{color:#c9433d;font-weight:700}
 .m{color:#63706b;font-size:13px}
 p.warn{background:#fdecec;color:#c9433d;padding:10px 12px;border-radius:8px;max-width:900px}
</style></head><body>
<h1>서버 자가진단</h1>
<p class="m">이 결과를 그대로 보내 주시면 됩니다. <b>확인이 끝나면 이 파일은 지워 주세요.</b></p>
<table>
<tr><th style="width:34%">확인한 것</th><th style="width:12%">결과</th><th style="width:22%">서버 값</th><th>필요한 것</th></tr>
<?php for ($i = 0; $i < count($rows); $i++) {
    $r = $rows[$i];
    echo '<tr><td>' . htmlspecialchars($r['what']) . '</td>';
    echo '<td class="' . ($r['ok'] ? 'ok">OK' : 'no">확인 필요') . '</td>';
    echo '<td>' . htmlspecialchars($r['found']) . '</td>';
    echo '<td class="m">' . htmlspecialchars($r['need']) . '</td></tr>';
} ?>
</table>
<p class="warn">이 파일은 서버 설정을 드러냅니다. 확인 후 반드시 삭제해 주세요.</p>
</body></html>
