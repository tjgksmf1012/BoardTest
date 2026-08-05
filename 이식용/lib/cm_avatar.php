<?php
/*
 * 캐릭터와 테두리
 *
 *   목록이나 글, 댓글에 캐릭터 그리기:
 *     echo cm_render_avatar($row['avatar_id'], $row['border_id'], 44);
 *
 *   상점:
 *     cm_shop_characters($user_id, 'female')   살 수 있는 캐릭터 목록
 *     cm_shop_borders($user_id)                테두리 목록
 *     cm_buy($user_id, $code)                  사기. 포인트를 빼고 보유 목록에 넣습니다
 *     cm_equip($user_id, $code)                장착하기
 *
 * 캐릭터 246종은 캐릭터목록.php 에 배열로 들어 있습니다.
 * 원래는 JSON 파일이었는데 PHP 5.1 에는 그걸 읽는 json_decode 가 없어서
 * 같은 내용을 PHP 배열 파일로 다시 뽑아 뒀습니다.
 */

$CM_ITEMS = null;

function cm_items() {
    global $CM_ITEMS;
    if ($CM_ITEMS === null) {
        $CM_ITEMS = include dirname(__FILE__) . '/../캐릭터목록.php';
        if (!is_array($CM_ITEMS)) { $CM_ITEMS = array(); }
    }
    return $CM_ITEMS;
}

function cm_item($code) {
    $items = cm_items();
    for ($i = 0; $i < count($items); $i++) {
        if ($items[$i]['code'] === $code) { return $items[$i]; }
    }
    return null;
}

// 이 회원이 산 것들의 code 목록
function cm_owned($user_id) {
    global $CM;
    $rows = cm_all("SELECT item_code FROM `" . $CM['t_user_item'] . "` WHERE user_id = ?",
                   array($user_id));
    $out = array();
    for ($i = 0; $i < count($rows); $i++) { $out[$rows[$i]['item_code']] = true; }
    return $out;
}

// 값. 무료로 주어지는 것은 0.
function cm_price($item) {
    global $CM;
    if ($item === null) { return 0; }
    if ($item['kind'] === 'border') { return $CM['price_border']; }
    if ($item['memberType'] === 'anon' || $item['memberType'] === 'admin') { return 0; }
    if (isset($item['free']) && $item['free']) { return 0; }
    return $CM['price_character'];
}

// 쓸 수 있는가 (무료이거나 샀거나)
function cm_can_use($user_id, $code, $member_type = '', $is_admin = false) {
    $it = cm_item($code);
    if ($it === null) { return false; }
    if ($it['memberType'] === 'admin') { return $is_admin ? true : false; }
    if ($it['memberType'] === 'anon')  { return false; }   // 익명 전용은 장착 대상이 아님
    if ($it['kind'] === 'character' && $member_type !== '' && $it['memberType'] !== $member_type) {
        return false;
    }
    if (cm_price($it) === 0) { return true; }
    $owned = cm_owned($user_id);
    return isset($owned[$code]);
}

// 구매. 성공하면 true.
function cm_buy($user_id, $code) {
    global $CM;
    $it = cm_item($code);
    if ($it === null) { return false; }

    $price = cm_price($it);
    if ($price === 0) { return true; }                 // 무료면 살 것도 없다

    $owned = cm_owned($user_id);
    if (isset($owned[$code])) { return true; }          // 이미 샀으면 또 받지 않는다

    if (!cm_spend($user_id, $price, $it['name'] . ' 구매')) { return false; }

    cm_q("INSERT INTO `" . $CM['t_user_item'] . "` (user_id, item_code, price, created_at)
          VALUES (?, ?, ?, NOW())", array($user_id, $code, $price));
    return true;
}

// 장착
function cm_equip($user_id, $code, $member_type = '', $is_admin = false) {
    global $CM;
    if ($code === '' || $code === null) {               // 테두리 빼기
        return cm_q("UPDATE `" . $CM['user_table'] . "` SET border_id = NULL
                      WHERE `" . $CM['user_pk'] . "` = ?", array($user_id)) ? true : false;
    }
    if (!cm_can_use($user_id, $code, $member_type, $is_admin)) { return false; }

    $it = cm_item($code);
    $col = ($it['kind'] === 'border') ? 'border_id' : 'avatar_id';
    return cm_q("UPDATE `" . $CM['user_table'] . "` SET " . $col . " = ?
                  WHERE `" . $CM['user_pk'] . "` = ?", array($code, $user_id)) ? true : false;
}

// 상점 목록 (살 수 있는지·이미 샀는지 표시가 붙어서 나옵니다)
function cm_shop_list($user_id, $kind, $member_type = '') {
    $items = cm_items();
    $owned = cm_owned($user_id);
    $out = array();
    for ($i = 0; $i < count($items); $i++) {
        $it = $items[$i];
        if ($it['kind'] !== $kind) { continue; }
        if ($kind === 'character') {
            if ($it['memberType'] === 'anon' || $it['memberType'] === 'admin') { continue; }
            if ($member_type !== '' && $it['memberType'] !== $member_type) { continue; }
        }
        $it['price']  = cm_price($it);
        $it['owned']  = (isset($owned[$it['code']]) || $it['price'] === 0) ? true : false;
        $out[] = $it;
    }
    return $out;
}

function cm_shop_characters($user_id, $member_type = '') {
    return cm_shop_list($user_id, 'character', $member_type);
}
function cm_shop_borders($user_id) {
    return cm_shop_list($user_id, 'border');
}

/* ---- 화면에 그리기 ----------------------------------------------------------
 *
 * 테두리(고리) 그림은 가운데가 뚫려 있고, 캐릭터 원의 가장자리 **위에 얹혀야** 합니다.
 * 기획 시안('움직이는 테두리')이 그렇게 생겼습니다.
 *
 *   고리 그림 = 칸의 134%   (고리가 가장 가는 쪽에서도 얼굴을 덮습니다)
 *   캐릭터    = 칸의 92%    (그 테두리가 고리 몸통 위에 앉습니다)
 *
 * 처음에는 고리를 120% 로 뒀습니다. 고리 바깥선의 '가운뎃값' 에 맞춘 값이었는데,
 * 고리가 붓으로 휘갈긴 모양이라 바깥선이 출렁입니다. 가는 쪽에서는 얼굴보다 안쪽이라
 * 캐릭터의 머리와 어깨가 고리 밖으로 새어 나왔습니다. 그래서 최솟값 기준으로 다시 잡았습니다.
 *
 * 이 두 값을 CSS 파일에 두지 말고 요소에 직접 붙여 주세요.
 * 예전에 CSS 로 뒀다가 다른 규칙에 우선순위로 져서 통째로 무시된 적이 있습니다.
 * 화면에는 오류 없이 잘 그려져서 아무도 알아채지 못했습니다.
 */
define('CM_RING', 134);   // 고리 그림 크기 (%)
define('CM_FACE', 92);    // 캐릭터 크기 (%)

function cm_avatar_url($file) {
    global $CM;
    return $CM['avatar_url'] . '/' . rawurlencode($file);
}

/* 캐릭터 하나를 그린다.
 *
 * 넷째 값 $ring_slot 은 '테두리 자리는 비워 두되 얼굴 크기는 테두리 낀 것과 똑같이' 그릴 때
 * 씁니다. 상점의 '사용 안 함' 칸이 그렇습니다. 이게 없으면 그 칸만 얼굴이 커 보여서
 * 옆 칸들과 눈높이가 안 맞습니다.
 */
function cm_render_avatar($avatar_code, $border_code, $size = 44, $ring_slot = false) {
    $a = cm_item($avatar_code);
    if ($a === null) {
        $items = cm_items();
        $a = count($items) ? $items[0] : null;          // 없으면 첫 캐릭터로 대신
    }
    $b = ($border_code !== '' && $border_code !== null) ? cm_item($border_code) : null;
    $ringed = ($b !== null && $b['kind'] === 'border');
    $shrink = ($ringed || $ring_slot);        // 얼굴을 칸보다 작게 그릴 것인가

    // 96px 이하로 그릴 자리에는 썸네일을 씁니다.
    // 원본(256px)을 25칸짜리 상점에 그대로 내보내면 1MB 가까이 나갑니다.
    $small = ($size <= 96);

    $html = '<span class="cm-avatar' . ($ringed ? ' has-ring' : '') . '"'
          . ' style="position:relative;display:inline-block;'
          . 'width:' . (int)$size . 'px;height:' . (int)$size . 'px;'
          . ($shrink ? 'overflow:visible' : 'overflow:hidden;border-radius:50%') . '">';

    if ($a !== null) {
        $file = $small ? $a['thumb'] : $a['file'];
        $st = 'display:block;border-radius:50%;';
        if ($shrink) {
            $m = (100 - CM_FACE) / 2;
            $st .= 'width:' . CM_FACE . '%;height:' . CM_FACE . '%;margin:' . $m . '%;';
        } else {
            $st .= 'width:100%;height:100%;object-fit:cover;';
        }
        $html .= '<img src="' . htmlspecialchars(cm_avatar_url($file)) . '"'
               . ' alt="" style="' . $st . '">';
    }
    if ($ringed) {
        $file = $small ? $b['thumb'] : $b['file'];
        $html .= '<img src="' . htmlspecialchars(cm_avatar_url($file)) . '" alt=""'
               . ' style="position:absolute;left:50%;top:50%;'
               . 'transform:translate(-50%,-50%);pointer-events:none;'
               . 'width:' . CM_RING . '%;height:' . CM_RING . '%;">';
    }
    return $html . '</span>';
}
