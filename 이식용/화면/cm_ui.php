<?php
/*
 * 화면 파일들이 같이 쓰는 것들
 *
 * 화면 파일(출석체크.php · 캐릭터상점.php · 마이페이지.php)은 두 가지로 쓰실 수 있습니다.
 *
 *   1) 기존 페이지 안에 끼워 넣기 — 이게 실제로 쓰실 방법입니다
 *
 *        <?php include '/화면/출석체크.php'; ?>
 *
 *      머리말·꼬리말 없이 내용만 나옵니다. 기존 레이아웃 안에 그대로 들어갑니다.
 *
 *   2) 그냥 주소로 열기 — 붙이기 전에 되는지 보실 때
 *
 *        http://사이트/화면/출석체크.php
 *
 *      이때는 최소한의 <html> 을 알아서 둘러 줍니다.
 *
 * 둘을 어떻게 가르냐면, 기존 페이지가 이미 뭔가 찍었는지(headers_sent)와
 * 이 파일이 직접 열린 것인지를 봅니다. 선배님이 따로 하실 건 없습니다.
 */

// 글자를 화면에 그대로 보여 준다. <script> 같은 게 섞여 들어오는 걸 막는다.
// htmlspecialchars 를 그냥 쓰면 PHP 5.1 에서는 따옴표를 안 막아서 ENT_QUOTES 를 꼭 준다.
function cm_h($s) {
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

// 이 화면 파일이 주소로 직접 열린 것인가
function cm_standalone() {
    if (defined('CM_EMBED')) { return false; }
    $self = isset($_SERVER['SCRIPT_FILENAME']) ? basename($_SERVER['SCRIPT_FILENAME']) : '';
    $me   = basename(cm_caller_file());
    return $self !== '' && $self === $me;
}

$CM_CALLER = '';
function cm_caller_file() {
    global $CM_CALLER;
    return $CM_CALLER;
}
function cm_set_caller($f) {
    global $CM_CALLER;
    $CM_CALLER = $f;
}

// 지금 페이지 주소 (폼을 자기 자신에게 보내려고 씁니다)
function cm_self_url() {
    $u = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
    $q = strpos($u, '?');
    if ($q !== false) { $u = substr($u, 0, $q); }
    return cm_h($u);
}

function cm_css_url() {
    global $CM;
    return isset($CM['css_url']) ? $CM['css_url'] : './cm.css';
}

function cm_open($title) {
    if (cm_standalone()) {
        echo '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
           . '<meta name="viewport" content="width=device-width,initial-scale=1">'
           . '<title>' . cm_h($title) . '</title>'
           . '<link rel="stylesheet" href="' . cm_h(cm_css_url()) . '">'
           . '</head><body>';
    }
    echo '<div class="cm">';
}

function cm_close() {
    echo '</div>';
    if (cm_standalone()) { echo '</body></html>'; }
}

// 로그인 안 했을 때
function cm_need_login() {
    global $CM;
    $url = isset($CM['login_url']) ? $CM['login_url'] : '';
    echo '<div class="card" style="text-align:center;padding:48px 20px">';
    echo '<p class="muted">로그인하시면 이용하실 수 있어요.</p>';
    if ($url !== '') {
        echo '<p style="margin-top:16px"><a class="btn btn-primary" href="' . cm_h($url) . '">로그인</a></p>';
    }
    echo '</div>';
}

// 안내 띠 (출석 결과·구매 결과 같은 것)
function cm_flash($msg, $kind = 'ok') {
    if ($msg === '') { return; }
    $cls = $kind === 'bad' ? 'cm-flash cm-flash-bad' : 'cm-flash';
    echo '<p class="' . $cls . '">' . cm_h($msg) . '</p>';
}

// POST 로 들어온 값 하나 꺼내기
function cm_post($key, $default = '') {
    return isset($_POST[$key]) ? $_POST[$key] : $default;
}
function cm_get($key, $default = '') {
    return isset($_GET[$key]) ? $_GET[$key] : $default;
}

/* 폼 위조 막기 (CSRF)
 *
 * 남의 사이트에 숨겨 둔 폼이 우리 사이트로 POST 를 쏘면, 브라우저가 로그인 쿠키를 같이
 * 보내기 때문에 본인이 누른 것처럼 처리됩니다. 그러면 남이 내 포인트로 물건을 사게 할 수
 * 있습니다. 그래서 폼마다 아무도 모르는 값을 하나 심어 두고, 돌아온 값이 같은지 봅니다.
 *
 * 기존 사이트에 이미 쓰시는 방식이 있으면 이 두 함수만 그쪽 것으로 바꾸시면 됩니다.
 */
function cm_token() {
    if (session_id() === '') { @session_start(); }
    if (empty($_SESSION['cm_token'])) {
        $seed = uniqid('', true) . mt_rand() . (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '');
        $_SESSION['cm_token'] = sha1($seed);
    }
    return $_SESSION['cm_token'];
}
function cm_token_field() {
    return '<input type="hidden" name="cm_token" value="' . cm_h(cm_token()) . '">';
}
function cm_token_ok() {
    $sent = cm_post('cm_token', '');
    return $sent !== '' && $sent === cm_token();
}

/* ---- 상점 화면이 쓰는 것 ----------------------------------------------------
 *
 * 이 두 함수를 캐릭터상점.php 안에 뒀다가 혼났습니다. 화면 파일을 한 요청에서 두 번
 * include 하면 "Cannot redeclare function" 으로 페이지가 통째로 죽습니다.
 * 여기(require_once 로 한 번만 읽는 파일)에 두면 그럴 일이 없습니다.
 */

// 상점 주소 (테마만 갈아 끼운다)
function cm_shop_url($theme = '') {
    $u = cm_self_url();
    if ($theme !== '') { $u .= '?theme=' . urlencode($theme); }
    return $u;
}

// 사기·장착 버튼 하나. 폼이 곧 칸이라 모양이 화면HTML 과 같아진다.
function cm_shop_button($do, $code, $cls, $title, $inner) {
    echo '<form method="post" action="' . cm_self_url() . '" class="shop-item ' . $cls . '">';
    echo cm_token_field();
    echo '<input type="hidden" name="cm_do" value="' . cm_h($do) . '">';
    echo '<input type="hidden" name="code" value="' . cm_h($code) . '">';
    echo '<button type="submit" title="' . cm_h($title) . '">' . $inner . '</button>';
    echo '</form>';
}
