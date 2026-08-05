<?php
/*
 * 설정 파일입니다. 여기 위쪽 몇 줄만 기존 사이트에 맞춰 주시면 됩니다.
 *
 * 나머지 파일들은 이 설정만 보고 돕니다.
 *   cm_db.php          DB 연결. mysqli, mysql_*, PDO 중에 되는 걸 알아서 씁니다
 *   cm_points.php      포인트 주고 빼기
 *   cm_attendance.php  출석체크와 연속 출석
 *   cm_avatar.php      캐릭터와 테두리. 사고, 장착하고, 화면에 그리기
 *
 * PHP 5.1 에서 돌도록 썼습니다. 그 뒤에 나온 문법은 하나도 안 썼습니다.
 */

// ---- 1) 기존 회원 표 ---------------------------------------------------------
// 회원 표 이름과, 그 표의 기본키 칸 이름을 적어 주세요.
$CM['user_table'] = 'users';
$CM['user_pk']    = 'id';

// ---- 2) 새로 만든 표 이름 ----------------------------------------------------
// install.sql 로 만든 표들입니다. 이름을 바꾸셨으면 여기도 바꿔 주세요.
$CM['t_point_log']  = 'cm_point_logs';
$CM['t_attendance'] = 'cm_attendance';
$CM['t_user_item']  = 'cm_user_items';

// ---- 3) 캐릭터 그림 주소 -----------------------------------------------------
// 캐릭터이미지/ 폴더를 웹에서 열 수 있는 주소로 적어 주세요. 끝에 / 는 빼고요.
$CM['avatar_url'] = '/img/avatars';

// ---- 4) DB 연결 --------------------------------------------------------------
// 기존 사이트에 이미 연결이 있으면 cm_db.php 의 cm_use_link() 로 넘겨 주세요.
// 여기 값은 그게 없을 때만 씁니다.
$CM['db_host'] = 'localhost';
$CM['db_user'] = '';
$CM['db_pass'] = '';
$CM['db_name'] = '';

// ---- 5) 포인트 규칙 ----------------------------------------------------------
// 금액을 바꾸시려면 여기만 고치면 됩니다. 화면 안내문도 이 값을 씁니다.
// limit 은 하루에 몇 번까지 줄지 (0 이면 제한 없음).
$CM['rules'] = array(
    'signup'        => array('amount' => 1000, 'label' => '회원가입',            'limit' => 0),
    'attendance'    => array('amount' => 10,   'label' => '출석체크',            'limit' => 0),
    'post'          => array('amount' => 300,  'label' => '일반 게시글 작성',    'limit' => 3),
    'anon_post'     => array('amount' => 100,  'label' => '익명 게시글 작성',    'limit' => 3),
    'comment'       => array('amount' => 100,  'label' => '댓글·대댓글 작성',    'limit' => 10),
    'like_received' => array('amount' => 10,   'label' => '게시글 추천받기',     'limit' => 0),
    'popular'       => array('amount' => 1000, 'label' => '인기글 선정',         'limit' => 0),
    'admin_pick'    => array('amount' => 1500, 'label' => '운영자 추천글 선정',  'limit' => 0),
    'streak7'       => array('amount' => 50,   'label' => '7일 연속 출석',       'limit' => 0),
    'streak14'      => array('amount' => 100,  'label' => '14일 연속 출석',      'limit' => 0),
    'streak21'      => array('amount' => 150,  'label' => '21일 연속 출석',      'limit' => 0),
    'streak28'      => array('amount' => 200,  'label' => '28일 연속 출석',      'limit' => 0),
    'streak30'      => array('amount' => 100,  'label' => '30일 연속 출석 달성', 'limit' => 0),
);

// 연속 출석 보너스를 주는 날짜. 그날에 '정확히' 닿았을 때만 줍니다.
// (8일째에 또 주지 않고, 끊겼다가 다시 7일을 채우면 다시 받습니다)
$CM['streak_days'] = array(7 => 'streak7', 14 => 'streak14', 21 => 'streak21',
                           28 => 'streak28', 30 => 'streak30');

// ---- 6) 상점 값 --------------------------------------------------------------
$CM['price_character'] = 2000;
$CM['price_border']    = 20000;

// 가입할 때 무료로 주는 캐릭터 수 (여성회원은 캐릭터목록.php 의 free 표시를 따릅니다)
$CM['free_per_type'] = 5;


// ---- 7) 지금 로그인한 사람이 누구인가 -----------------------------------------
//
// ★ 여기가 이 꾸러미에서 선배님이 고치셔야 하는 유일한 자리입니다. ★
//
// 화면 파일(화면/출석체크.php 등)은 이 함수를 불러서 "누구 것을 보여 줄까" 를 정합니다.
// 저희는 기존 사이트가 로그인을 어떻게 잡고 있는지 알 수가 없어서, 아래에 흔한 방식
// 몇 가지를 넣어 두고 되는 것을 골라 쓰게 해 뒀습니다.
//
// 아래 자동 찾기가 맞으면 아무것도 안 하셔도 됩니다.
// 안 맞으면 함수 맨 위에 한 줄만 적어 주세요. 예를 들면 이런 식입니다.
//
//     function cm_current_user_id() {
//         return isset($_SESSION['user_no']) ? (int)$_SESSION['user_no'] : 0;
//     }
//
// 로그인 안 한 사람에게는 0 을 돌려주시면 됩니다. 화면이 알아서 '로그인해 주세요' 를 띄웁니다.
//
// 주의: 여기서 돌려주는 값이 그대로 회원 표의 기본키로 쓰입니다.
// 절대로 주소창이나 폼에서 온 값($_GET·$_POST)을 그대로 돌려주지 마세요.
// 그러면 아무나 남의 번호를 적어 넣고 남의 포인트를 쓰게 됩니다.

if (!function_exists('cm_current_user_id')) {
function cm_current_user_id() {
    if (session_id() === '') { @session_start(); }

    // 그누보드 4·5 (PHP 5.1 시절 국내 게시판은 대개 이쪽입니다)
    if (isset($GLOBALS['member']) && is_array($GLOBALS['member'])) {
        if (!empty($GLOBALS['member']['mb_no'])) { return (int)$GLOBALS['member']['mb_no']; }
        if (!empty($GLOBALS['member']['mb_id'])) { return $GLOBALS['member']['mb_id']; }
    }
    if (!empty($_SESSION['ss_mb_id'])) { return $_SESSION['ss_mb_id']; }

    // 흔히 쓰는 세션 이름들
    $keys = array('mb_no', 'mb_id', 'member_no', 'member_id', 'user_no',
                  'user_id', 'userid', 'uid', 'idx', 'no');
    for ($i = 0; $i < count($keys); $i++) {
        if (!empty($_SESSION[$keys[$i]])) { return $_SESSION[$keys[$i]]; }
    }
    return 0;
}
}

// 회원 유형(여성·남성·업소). 어떤 캐릭터를 보여 줄지 가르는 값입니다.
// install.sql 로 회원 표에 member_type 칸을 넣으셨으면 그대로 두시면 됩니다.
if (!function_exists('cm_current_member_type')) {
function cm_current_member_type($user_id) {
    global $CM;
    if (!$user_id) { return 'female'; }
    $t = cm_one("SELECT member_type FROM `" . $CM['user_table'] . "`
                  WHERE `" . $CM['user_pk'] . "` = ?", array($user_id));
    return $t ? $t : 'female';
}
}
