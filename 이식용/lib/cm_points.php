<?php
/*
 * 포인트 지급·차감
 *
 * 기존 게시판 코드에서 **일이 성공한 직후** 한 줄 부르시면 됩니다.
 *
 *   글 등록 성공 후 :  cm_award($user_id, $is_anonymous ? 'anon_post' : 'post');
 *   댓글 등록 성공 후:  cm_award($user_id, 'comment');
 *   추천 성공 후    :  cm_award($글쓴이_id, 'like_received', '추천받기 (게시글 #'.$post_id.')');
 *
 * 돌려주는 값
 *   array('awarded' => 실제로 준 금액, 'limited' => 하루 한도가 차서 못 줬는지)
 *
 * 하루 한도는 **활동 제한이 아닙니다.** 한도를 넘겨도 글·댓글은 정상으로 써지고
 * 포인트만 안 붙습니다. 그러니 이 함수의 결과로 글 등록을 막지 마세요.
 */

// 오늘 이 사유로 몇 번 받았나
function cm_count_today($user_id, $reason) {
    global $CM;
    return (int)cm_one(
        "SELECT COUNT(*) FROM `" . $CM['t_point_log'] . "`
          WHERE user_id = ? AND reason = ? AND DATE(created_at) = CURDATE()",
        array($user_id, $reason), 0);
}

// 포인트 지급
function cm_award($user_id, $reason, $detail = '') {
    global $CM;
    $out = array('awarded' => 0, 'limited' => false, 'label' => '');

    if (!isset($CM['rules'][$reason])) { return $out; }
    $rule = $CM['rules'][$reason];
    $out['label'] = $rule['label'];

    if ($rule['limit'] > 0 && cm_count_today($user_id, $reason) >= $rule['limit']) {
        $out['limited'] = true;
        return $out;                      // 한도가 찼으면 기록도 남기지 않습니다
    }
    if ($detail === '') { $detail = $rule['label']; }

    cm_begin();
    $ok1 = cm_q("INSERT INTO `" . $CM['t_point_log'] . "`
                        (user_id, amount, reason, detail, created_at)
                 VALUES (?, ?, ?, ?, NOW())",
                array($user_id, $rule['amount'], $reason, $detail));
    $ok2 = cm_q("UPDATE `" . $CM['user_table'] . "`
                    SET points = points + ?
                  WHERE `" . $CM['user_pk'] . "` = ?",
                array($rule['amount'], $user_id));
    if ($ok1 && $ok2) { cm_commit(); } else { cm_rollback(); return $out; }

    $out['awarded'] = $rule['amount'];
    return $out;
}

// 포인트 차감 (캐릭터·테두리 구매). 모자라면 false 를 돌려주고 아무것도 안 합니다.
function cm_spend($user_id, $amount, $detail) {
    global $CM;
    $amount = (int)$amount;
    if ($amount <= 0) { return false; }

    cm_begin();
    $have = (int)cm_one("SELECT points FROM `" . $CM['user_table'] . "`
                          WHERE `" . $CM['user_pk'] . "` = ?", array($user_id), 0);
    if ($have < $amount) { cm_rollback(); return false; }

    $ok1 = cm_q("INSERT INTO `" . $CM['t_point_log'] . "`
                        (user_id, amount, reason, detail, created_at)
                 VALUES (?, ?, 'purchase', ?, NOW())",
                array($user_id, -$amount, $detail));
    $ok2 = cm_q("UPDATE `" . $CM['user_table'] . "`
                    SET points = points - ?
                  WHERE `" . $CM['user_pk'] . "` = ? AND points >= ?",
                array($amount, $user_id, $amount));
    if (!$ok1 || !$ok2) { cm_rollback(); return false; }
    cm_commit();
    return true;
}

// 지금 보유 포인트
function cm_points($user_id) {
    global $CM;
    return (int)cm_one("SELECT points FROM `" . $CM['user_table'] . "`
                         WHERE `" . $CM['user_pk'] . "` = ?", array($user_id), 0);
}

// 포인트 내역 (마이페이지)
function cm_point_logs($user_id, $limit = 100) {
    global $CM;
    $limit = (int)$limit;
    return cm_all("SELECT amount, reason, detail, created_at
                     FROM `" . $CM['t_point_log'] . "`
                    WHERE user_id = ?
                    ORDER BY id DESC LIMIT " . $limit, array($user_id));
}

// 오늘 적립 — '적립' 이므로 번 것만 셉니다.
// 그날 기록을 통째로 더하면 캐릭터를 산 날 음수가 나와서 "오늘 하나도 못 벌었네"로 읽힙니다.
function cm_earned_today($user_id) {
    global $CM;
    return (int)cm_one("SELECT COALESCE(SUM(amount), 0)
                          FROM `" . $CM['t_point_log'] . "`
                         WHERE user_id = ? AND amount > 0 AND DATE(created_at) = CURDATE()",
                       array($user_id), 0);
}

// 화면에 찍을 부호 붙은 금액 (+1,000P / −2,000P)
// '+' 를 먼저 붙이고 음수를 이어 붙이면 "+-2,000P" 가 됩니다. 부호는 여기서 한 번만.
function cm_point_str($amount) {
    $amount = (int)$amount;
    $sign = ($amount < 0) ? '−' : '+';        // 빼기 기호는 U+2212 (숫자 옆에서 잘 보입니다)
    return $sign . number_format(abs($amount)) . 'P';
}
