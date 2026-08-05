<?php
/*
 * 출석체크
 *
 *   출석 버튼을 눌렀을 때:  $r = cm_check_attendance($user_id);
 *     $r['already']  오늘 이미 출석했으면 true
 *     $r['streak']   오늘까지 며칠 연속으로 출석했는지
 *     $r['awarded']  이번에 받은 포인트 합계. 출석 10P 에 보너스를 더한 값입니다
 *     $r['bonus']    받은 보너스 이름들
 *
 * 화면에 뿌릴 값들
 *   cm_streak($user_id)        연속 출석 일수. 오늘 아직 안 했으면 어제까지 셉니다
 *   cm_month_count($user_id)   이번 달에 몇 번 출석했는지
 *   cm_checked_today($user_id) 오늘 했는지
 *
 * 하루에 한 번만 되는 건 표에 걸어 둔 UNIQUE (user_id, day) 가 막아 줍니다.
 * 버튼을 두 번 누르셔도, 창 두 개에서 동시에 누르셔도 기록은 하나만 들어갑니다.
 */

function cm_today() { return date('Y-m-d'); }

function cm_checked_today($user_id) {
    global $CM;
    $r = cm_one("SELECT 1 FROM `" . $CM['t_attendance'] . "`
                  WHERE user_id = ? AND day = ?", array($user_id, cm_today()));
    return $r ? true : false;
}

// 기준일부터 거꾸로 세어 연속 출석 일수를 구한다 (기준일에 출석이 없으면 0)
function cm_streak_from($user_id, $from_date) {
    global $CM;
    // 최근 40일치만 본다. 30일 챌린지가 최대라 그 이상은 셀 이유가 없다.
    $rows = cm_all("SELECT day FROM `" . $CM['t_attendance'] . "`
                     WHERE user_id = ? AND day <= ?
                     ORDER BY day DESC LIMIT 40", array($user_id, $from_date));
    $have = array();
    for ($i = 0; $i < count($rows); $i++) { $have[$rows[$i]['day']] = true; }

    $streak = 0;
    $cur = $from_date;
    while (isset($have[$cur])) {
        $streak++;
        $cur = date('Y-m-d', strtotime($cur . ' -1 day'));   // PHP 5.1 에는 DateTime 이 없다
    }
    return $streak;
}

// 오늘 기준 연속 출석. 아직 오늘 안 했으면 어제까지 이어온 값을 돌려준다
// (오늘 누르면 +1 이 되는 값이라 화면에 그대로 쓸 수 있다)
function cm_streak($user_id) {
    $today = cm_today();
    if (cm_checked_today($user_id)) { return cm_streak_from($user_id, $today); }
    return cm_streak_from($user_id, date('Y-m-d', strtotime($today . ' -1 day')));
}

function cm_month_count($user_id) {
    global $CM;
    return (int)cm_one("SELECT COUNT(*) FROM `" . $CM['t_attendance'] . "`
                         WHERE user_id = ? AND day LIKE ?",
                       array($user_id, date('Y-m') . '%'), 0);
}

// 출석 처리
function cm_check_attendance($user_id) {
    global $CM;
    $out = array('already' => false, 'streak' => 0, 'awarded' => 0, 'bonus' => array());
    $today = cm_today();

    if (cm_checked_today($user_id)) {
        $out['already'] = true;
        $out['streak'] = cm_streak($user_id);
        return $out;
    }

    // UNIQUE 가 있어 두 번 들어가지 않는다. 동시에 눌러도 한쪽만 성공한다.
    $ok = cm_q("INSERT INTO `" . $CM['t_attendance'] . "` (user_id, day, created_at)
                VALUES (?, ?, NOW())", array($user_id, $today));
    if (!$ok) {                       // 그 사이 다른 요청이 먼저 넣었다
        $out['already'] = true;
        $out['streak'] = cm_streak($user_id);
        return $out;
    }

    $r = cm_award($user_id, 'attendance');
    $out['awarded'] += $r['awarded'];

    $streak = cm_streak_from($user_id, $today);
    $out['streak'] = $streak;

    // 연속 일수가 '정확히' 그 날짜일 때만 보너스를 준다.
    // 31일째에 또 주지 않고, 끊겼다가 다시 7일을 채우면 다시 받는다(재도전이 되게).
    foreach ($CM['streak_days'] as $days => $reason) {
        if ($streak === (int)$days) {
            $b = cm_award($user_id, $reason);
            $out['awarded'] += $b['awarded'];
            if ($b['awarded'] > 0) { $out['bonus'][] = $b['label']; }
        }
    }
    return $out;
}

// 이번 달 달력에 찍을 출석일 목록 (['2026-08-01', ...])
function cm_month_days($user_id, $ym = '') {
    global $CM;
    if ($ym === '') { $ym = date('Y-m'); }
    $rows = cm_all("SELECT day FROM `" . $CM['t_attendance'] . "`
                     WHERE user_id = ? AND day LIKE ? ORDER BY day",
                   array($user_id, $ym . '%'));
    $out = array();
    for ($i = 0; $i < count($rows); $i++) { $out[] = $rows[$i]['day']; }
    return $out;
}

// 다음 보너스까지 며칠 남았나 (다 채웠으면 null)
function cm_next_streak($streak) {
    global $CM;
    foreach ($CM['streak_days'] as $days => $reason) {
        if ($streak < (int)$days) {
            return array('days' => (int)$days,
                         'left' => (int)$days - $streak,
                         'amount' => $CM['rules'][$reason]['amount']);
        }
    }
    return null;
}
