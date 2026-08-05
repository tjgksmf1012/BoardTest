<?php
/*
 * 화면 파일들이 맨 위에서 부르는 준비 파일
 *
 * lib/ 의 파일 다섯 개를 순서대로 읽습니다.
 * 기존 페이지에서 이미 읽으셨으면 두 번 읽지 않습니다 (require_once 라서요).
 *
 * lib 위치를 바꾸셨으면 아래 $CM_LIB 한 줄만 고치시면 됩니다.
 */

$CM_LIB = dirname(dirname(__FILE__)) . '/lib';

require_once $CM_LIB . '/cm_config.php';
require_once $CM_LIB . '/cm_db.php';
require_once $CM_LIB . '/cm_points.php';
require_once $CM_LIB . '/cm_attendance.php';
require_once $CM_LIB . '/cm_avatar.php';
require_once dirname(__FILE__) . '/cm_ui.php';

// 화면 파일을 주소로 직접 열었을 때 쓸 CSS 위치.
// 기존 페이지 안에 끼워 넣으실 때는 머리말에 이 파일을 한 번만 걸어 주세요.
//   <link rel="stylesheet" href="/화면/cm.css">
if (!isset($CM['css_url'])) { $CM['css_url'] = './cm.css'; }
