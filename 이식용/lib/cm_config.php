<?php
/*
 * 설정 — 여기 위쪽 몇 줄만 기존 사이트에 맞춰 주시면 됩니다.
 *
 * 아래 파일들은 이 설정만 보고 돕니다.
 *   cm_db.php          DB 연결 (mysqli / mysql_* / PDO 중 되는 것을 씁니다)
 *   cm_points.php      포인트 지급·차감
 *   cm_attendance.php  출석체크·연속 출석
 *   cm_avatar.php      캐릭터·테두리 (구매·장착·그리기)
 *
 * PHP 5.1 에서 돌도록 썼습니다 (클로저·네임스페이스·json_*·[] 배열 안 씁니다).
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
