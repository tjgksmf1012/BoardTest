<?php
/*
 * 캐릭터 상점 화면 — 그대로 쓰시면 됩니다
 *
 *   기존 페이지 안에 넣기:   include '/화면/캐릭터상점.php';
 *   그냥 열어 보기:          http://사이트/화면/캐릭터상점.php
 *
 * 사기·장착하기 버튼은 이 파일이 자기 자신에게 POST 를 보내 처리합니다.
 * 따로 처리 페이지를 만드실 필요 없습니다.
 *
 * 화면이 두 단계입니다.
 *   1단계  테마 9개를 보여 줍니다 (청순 내츄럴 · 러블리핑크 · ...)
 *   2단계  그 테마 안의 25종을 보여 줍니다
 * 여성 캐릭터만 225종이라 한 화면에 다 깔면 아무것도 못 고르십니다. 그래서 나눴습니다.
 * 남성·업소 회원은 5종뿐이라 1단계를 건너뛰고 바로 보여 줍니다.
 *
 * 화면에 쓴 class 이름은 화면HTML/캐릭터상점.html 과 똑같습니다.
 * cm.css 가 그 이름으로 되어 있어서, 이름을 바꾸시면 모양이 깨집니다.
 */

require_once dirname(__FILE__) . '/cm_boot.php';
cm_set_caller(__FILE__);

$uid = cm_current_user_id();

$flash = '';
$flash_kind = 'ok';

// ---- 사기 · 장착하기 ---------------------------------------------------------
if ($uid && isset($_POST['cm_do'])) {
    $code = cm_post('code', '');
    if (!cm_token_ok()) {
        $flash = '잠시 후 다시 눌러 주세요.';
        $flash_kind = 'bad';
    } else if ($_POST['cm_do'] === 'buy') {
        if (cm_buy($uid, $code)) {
            $flash = '구매했어요!';
        } else {
            $flash = '포인트가 모자라거나 이미 갖고 계신 것이에요.';
            $flash_kind = 'bad';
        }
    } else if ($_POST['cm_do'] === 'equip') {
        $mt = cm_current_member_type($uid);
        if (cm_equip($uid, $code, $mt)) {
            $flash = ($code === '') ? '테두리를 뺐어요.' : '장착했어요!';
        } else {
            $flash = '장착할 수 없는 항목이에요.';
            $flash_kind = 'bad';
        }
    }
}

cm_open('캐릭터 상점');

if (!$uid) {
    cm_need_login();
    cm_close();
    return;
}

$mtype   = cm_current_member_type($uid);
$points  = cm_points($uid);
$theme   = cm_get('theme', '');
$me      = cm_row("SELECT avatar_id, border_id FROM `" . $CM['user_table'] . "`
                    WHERE `" . $CM['user_pk'] . "` = ?", array($uid));
$my_char = $me ? $me['avatar_id'] : '';
$my_bd   = ($me && $me['border_id'] !== null) ? $me['border_id'] : '';

// 화면에 쓰는 도우미 함수(cm_shop_url · cm_shop_button)는 cm_ui.php 에 있습니다.
?>

<div class="shop-hero card">
  <h1>캐릭터 상점</h1>
  <p class="shop-lead muted">포인트로 캐릭터와 테두리를 사서 꾸며 보세요.</p>
  <p class="accent big">보유 <?php echo number_format($points); ?>P</p>
</div>

<?php cm_flash($flash, $flash_kind); ?>

<?php
// ---- 캐릭터 ------------------------------------------------------------------
$list = cm_shop_characters($uid, $mtype);

$themes = array();
for ($i = 0; $i < count($list); $i++) {
    $t = isset($list[$i]['themeCode']) ? $list[$i]['themeCode'] : '_';
    if (!isset($themes[$t])) {
        $themes[$t] = array('name' => isset($list[$i]['theme']) ? $list[$i]['theme'] : '캐릭터',
                            'items' => array());
    }
    $themes[$t]['items'][] = $list[$i];
}
if ($theme === '' && count($themes) === 1) {
    $ks = array_keys($themes);
    $theme = $ks[0];
}
?>

<div class="card shop-card">
<?php if ($theme === '' || !isset($themes[$theme])) { ?>
  <div class="tier-head">
    <h3>캐릭터</h3>
    <span class="muted">각 <?php echo number_format($CM['price_character']); ?>P</span>
  </div>
  <div class="shop-grid">
    <?php foreach ($themes as $tc => $t) {
        $first = $t['items'][0];
        $owned = 0;
        for ($i = 0; $i < count($t['items']); $i++) {
            if ($t['items'][$i]['owned']) { $owned++; }
        }
    ?>
      <a class="theme-cell" href="<?php echo cm_shop_url($tc); ?>">
        <?php echo cm_render_avatar($first['code'], null, 88); ?>
        <span class="theme-name"><?php echo cm_h($t['name']); ?></span>
        <span class="shop-count"><?php echo $owned; ?>/<?php echo count($t['items']); ?></span>
      </a>
    <?php } ?>
  </div>
  <p class="muted shop-foot">테마를 하나 골라 들어가 보세요</p>

<?php } else {
    $t = $themes[$theme];
?>
  <div class="tier-head">
    <a class="btn btn-ghost btn-sm shop-back" href="<?php echo cm_shop_url(); ?>">← 테마 고르기</a>
    <h3><?php echo cm_h($t['name']); ?></h3>
    <span class="muted">각 <?php echo number_format($CM['price_character']); ?>P</span>
  </div>
  <div class="shop-grid">
    <?php foreach ($t['items'] as $it) {
        $face = cm_render_avatar($it['code'], null, 72);
        $name = '<span class="shop-name">' . cm_h($it['name']) . '</span>';
        if ($my_char === $it['code']) {
            echo '<div class="shop-item selected"><button type="button" disabled>'
               . $face . $name . '<span class="using">사용 중</span></button></div>';
        } else if ($it['owned']) {
            cm_shop_button('equip', $it['code'], 'owned',
                $it['name'] . ' 장착', $face . $name . '<span class="shop-price">장착</span>');
        } else {
            $can = ($points >= $it['price']);
            cm_shop_button('buy', $it['code'], $can ? '' : 'locked',
                $it['name'] . ' 구매',
                $face . $name . '<span class="shop-price">' . number_format($it['price']) . 'P</span>');
        }
    } ?>
  </div>
<?php } ?>
</div>

<?php
// ---- 테두리 ------------------------------------------------------------------
$borders = cm_shop_borders($uid);
?>
<div class="card shop-card">
  <div class="tier-head">
    <h3>테두리</h3>
    <span class="muted">각 <?php echo number_format($CM['price_border']); ?>P</span>
  </div>
  <div class="shop-grid">
    <?php
    // '사용 안 함' 칸. 테두리를 빼는 자리입니다.
    $none = cm_render_avatar($my_char, null, 72, true)
          . '<span class="shop-name">사용 안 함</span>';
    if ($my_bd === '') {
        echo '<div class="shop-item selected"><button type="button" disabled>'
           . $none . '<span class="using">사용 중</span></button></div>';
    } else {
        cm_shop_button('equip', '', '', '테두리 없음', $none);
    }

    foreach ($borders as $it) {
        $face = cm_render_avatar($my_char, $it['code'], 72);
        $name = '<span class="shop-name">' . cm_h($it['name']) . '</span>';
        if ($my_bd === $it['code']) {
            echo '<div class="shop-item selected"><button type="button" disabled>'
               . $face . $name . '<span class="using">사용 중</span></button></div>';
        } else if ($it['owned']) {
            cm_shop_button('equip', $it['code'], 'owned',
                $it['name'] . ' 장착', $face . $name . '<span class="shop-price">장착</span>');
        } else {
            $can = ($points >= $it['price']);
            cm_shop_button('buy', $it['code'], $can ? '' : 'locked',
                $it['name'] . ' 구매',
                $face . $name . '<span class="shop-price">' . number_format($it['price']) . 'P</span>');
        }
    }
    ?>
  </div>
</div>

<?php cm_close(); ?>
