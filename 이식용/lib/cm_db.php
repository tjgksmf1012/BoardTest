<?php
/*
 * DB 붙는 부분입니다. 서버에 있는 방식으로 알아서 연결합니다.
 *
 * 기존 사이트에 이미 연결이 있으면 그걸 그대로 쓰시는 게 좋습니다.
 *   cm_use_link($conn);          // mysqli 나 mysql_* 연결
 *   cm_use_pdo($pdo);            // PDO
 * 안 넘겨 주시면 cm_config.php 에 적힌 접속 정보로 직접 붙습니다.
 *
 * 값은 SQL 문자열에 그냥 붙이지 마시고 cm_q() 의 두 번째 자리로 넘겨 주세요.
 *   cm_q("SELECT * FROM t WHERE id = ?", array($id))
 * 그러면 따옴표 같은 위험한 글자를 안전한 형태로 바꿔서 넣습니다. 이걸 안 하면
 * 남이 주소창에 SQL 을 적어 넣어서 DB 를 통째로 읽어 갈 수 있습니다.
 * 서버에 옛날 mysql_* 함수밖에 없어도 똑같이 처리합니다.
 */

$CM_LINK = null;   // mysqli 링크 또는 mysql_* 링크
$CM_PDO  = null;   // PDO 객체
$CM_KIND = '';     // 'mysqli' | 'mysql' | 'pdo'

function cm_use_link($link) {
    global $CM_LINK, $CM_KIND;
    $CM_LINK = $link;
    $CM_KIND = (function_exists('mysqli_query') && is_object($link)) ? 'mysqli' : 'mysql';
}

function cm_use_pdo($pdo) {
    global $CM_PDO, $CM_KIND;
    $CM_PDO = $pdo;
    $CM_KIND = 'pdo';
}

function cm_connect() {
    global $CM, $CM_LINK, $CM_PDO, $CM_KIND;
    if ($CM_KIND !== '') { return true; }

    if (function_exists('mysqli_connect')) {
        $link = @mysqli_connect($CM['db_host'], $CM['db_user'], $CM['db_pass'], $CM['db_name']);
        if ($link) {
            @mysqli_query($link, "SET NAMES utf8");
            $CM_LINK = $link; $CM_KIND = 'mysqli';
            return true;
        }
    }
    if (function_exists('mysql_connect')) {
        $link = @mysql_connect($CM['db_host'], $CM['db_user'], $CM['db_pass']);
        if ($link) {
            @mysql_select_db($CM['db_name'], $link);
            @mysql_query("SET NAMES utf8", $link);
            $CM_LINK = $link; $CM_KIND = 'mysql';
            return true;
        }
    }
    if (class_exists('PDO')) {
        $dsn = 'mysql:host=' . $CM['db_host'] . ';dbname=' . $CM['db_name'];
        $pdo = new PDO($dsn, $CM['db_user'], $CM['db_pass']);
        $pdo->exec("SET NAMES utf8");
        $CM_PDO = $pdo; $CM_KIND = 'pdo';
        return true;
    }
    return false;
}

// 값 하나를 SQL 에 넣을 수 있는 꼴로 바꾼다
function cm_esc($v) {
    global $CM_LINK, $CM_PDO, $CM_KIND;
    if ($v === null) { return 'NULL'; }
    if (is_int($v) || is_float($v)) { return (string)$v; }
    if (is_bool($v)) { return $v ? '1' : '0'; }
    $s = (string)$v;
    if ($CM_KIND === 'mysqli') { return "'" . mysqli_real_escape_string($CM_LINK, $s) . "'"; }
    if ($CM_KIND === 'mysql')  { return "'" . mysql_real_escape_string($s, $CM_LINK) . "'"; }
    if ($CM_KIND === 'pdo')    { return $CM_PDO->quote($s); }
    return "'" . addslashes($s) . "'";
}

// ? 자리에 값을 끼워 넣은 SQL 을 만든다 (따옴표 안의 ? 는 건드리지 않는다)
function cm_bind($sql, $params) {
    if (!is_array($params) || count($params) === 0) { return $sql; }
    $out = '';
    $n = 0;
    $len = strlen($sql);
    $quote = '';
    for ($i = 0; $i < $len; $i++) {
        $c = $sql[$i];
        if ($quote !== '') {                       // 따옴표 안
            $out .= $c;
            if ($c === '\\' && $i + 1 < $len) { $out .= $sql[$i + 1]; $i++; continue; }
            if ($c === $quote) { $quote = ''; }
            continue;
        }
        if ($c === "'" || $c === '"') { $quote = $c; $out .= $c; continue; }
        if ($c === '?') {
            $out .= array_key_exists($n, $params) ? cm_esc($params[$n]) : 'NULL';
            $n++;
            continue;
        }
        $out .= $c;
    }
    return $out;
}

/* SQL 문법을 바꿔 끼우는 자리입니다.
 * 기본은 MySQL 이라 아무것도 안 바꾸고 그대로 내보냅니다.
 * SQLite 같은 다른 DB 로 돌리실 일이 있으면, 이 파일을 읽기 전에 같은 이름의 함수를
 * 먼저 만들어 두시면 그쪽이 쓰입니다. 같이 드린 테스트가 그런 식으로 돌아갑니다.
 */
if (!function_exists('cm_dialect')) {
    function cm_dialect($sql) { return $sql; }
}

// 쿼리 실행. 성공하면 결과(또는 true), 실패하면 false.
function cm_q($sql, $params = null) {
    global $CM_LINK, $CM_PDO, $CM_KIND;
    if ($CM_KIND === '') { cm_connect(); }
    $full = cm_bind(cm_dialect($sql), $params);
    if ($CM_KIND === 'mysqli') { return mysqli_query($CM_LINK, $full); }
    if ($CM_KIND === 'mysql')  { return mysql_query($full, $CM_LINK); }
    if ($CM_KIND === 'pdo') {
        $st = $CM_PDO->query($full);
        return $st ? $st : false;
    }
    return false;
}

// 한 줄을 이름 붙은 배열로 (없으면 null)
function cm_row($sql, $params = null) {
    global $CM_KIND;
    $r = cm_q($sql, $params);
    if (!$r) { return null; }
    if ($CM_KIND === 'mysqli') { $row = mysqli_fetch_assoc($r); return $row ? $row : null; }
    if ($CM_KIND === 'mysql')  { $row = mysql_fetch_assoc($r);  return $row ? $row : null; }
    if ($CM_KIND === 'pdo')    { $row = $r->fetch(PDO::FETCH_ASSOC); return $row ? $row : null; }
    return null;
}

// 여러 줄
function cm_all($sql, $params = null) {
    global $CM_KIND;
    $out = array();
    $r = cm_q($sql, $params);
    if (!$r) { return $out; }
    if ($CM_KIND === 'mysqli') { while ($x = mysqli_fetch_assoc($r)) { $out[] = $x; } return $out; }
    if ($CM_KIND === 'mysql')  { while ($x = mysql_fetch_assoc($r))  { $out[] = $x; } return $out; }
    if ($CM_KIND === 'pdo')    { return $r->fetchAll(PDO::FETCH_ASSOC); }
    return $out;
}

// 값 하나 (첫 줄 첫 칸). 없으면 $default
function cm_one($sql, $params = null, $default = null) {
    $row = cm_row($sql, $params);
    if ($row === null) { return $default; }
    foreach ($row as $v) { return $v; }
    return $default;
}

// ---- 두 문장을 하나로 묶기 (트랜잭션) ------------------------------------------
// 포인트는 '내역 남기기' 와 '잔액 더하기' 가 한 몸이라 반드시 묶어야 합니다.
// 하나만 되고 중간에 끊기면 내역과 잔액이 어긋나서 영영 안 맞게 됩니다.
function cm_begin()    { cm_q('START TRANSACTION'); }
function cm_commit()   { cm_q('COMMIT'); }
function cm_rollback() { cm_q('ROLLBACK'); }
