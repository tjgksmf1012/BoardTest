<?php
/*
 * 마이페이지 화면 — 그대로 쓰시면 됩니다
 *
 *   기존 페이지 안에 넣기:   include '/화면/마이페이지.php';
 *   그냥 열어 보기:          http://사이트/화면/마이페이지.php
 *
 * 내 캐릭터, 보유 포인트, 이번 달 출석 달력, 포인트 내역을 보여 줍니다.
 * 읽기만 하는 화면이라 누를 것이 없습니다.
 *
 * 화면에 쓴 class 이름은 화면HTML/마이페이지.html 과 똑같습니다.
 * cm.css 가 그 이름으로 되어 있어서, 이름을 바꾸시면 모양이 깨집니다.
 */

require_once dirname(__FILE__) . '/cm_boot.php';
cm_set_caller(__FILE__);

$uid = cm_current_user_id();

cm_open('마이페이지');

if (!$uid) {
    cm_need_login();
    cm_close();
    return;
}

$me     = cm_row("SELECT * FROM `" . $CM['user_table'] . "`
                   WHERE `" . $CM['user_pk'] . "` = ?", array($uid));
$points = cm_points($uid);
$today  = cm_earned_today($uid);
$streak = cm_streak($uid);
$month  = cm_month_count($uid);
$days   = cm_month_days($uid);
$logs   = cm_point_logs($uid, 30);
$done   = cm_checked_today($uid);

// 닉네임 칸 이름이 사이트마다 달라서, 있을 만한 것을 차례로 봅니다.
// 다 아니면 아래 $try 에 그 사이트의 칸 이름을 하나 넣어 주세요.
$nick = '';
$try = array('nickname', 'nick', 'mb_nick', 'name', 'mb_name', 'user_name');
for ($i = 0; $i < count($try); $i++) {
    if ($me && isset($me[$try[$i]]) && $me[$try[$i]] !== '') { $nick = $me[$try[$i]]; break; }
}
if ($nick === '') { $nick = '회원'; }
?>

<div class="profile-top card">
  <div class="profile-avatar">
    <?php echo cm_render_avatar($me ? $me['avatar_id'] : '',
                                $me ? $me['border_id'] : null, 96); ?>
  </div>
  <div class="profile-info">
    <h1><?php echo cm_h($nick); ?></h1>
    <p class="accent big"><?php echo number_format($points); ?>P</p>
    <div class="profile-stats">
      <span>오늘 적립 <strong><?php echo number_format($today); ?>P</strong></span>
      <span>연속 출석 <strong><?php echo (int)$streak; ?></strong>일</span>
      <span>이번 달 <strong><?php echo (int)$month; ?></strong>회</span>
    </div>
  </div>
</div>

<?php
// ---- 이번 달 달력 ------------------------------------------------------------
// 지난 달을 보시려면 cm_month_days($uid, '2026-07') 처럼 두 번째 값을 넘기시면 됩니다.
$mark = array();
for ($i = 0; $i < count($days); $i++) { $mark[$days[$i]] = true; }

$first   = mktime(0, 0, 0, (int)date('n'), 1, (int)date('Y'));
$blank   = (int)date('w', $first);            // 1일이 무슨 요일인가 (0 = 일요일)
$total   = (int)date('t');
$today_d = (int)date('j');
$ym      = date('Y-m');
$wd      = array('일', '월', '화', '수', '목', '금', '토');
?>
<div class="att-grid">
  <div class="card att-card">
    <div class="att-card-head">
      <h2><?php echo date('Y'); ?>년 <?php echo date('n'); ?>월</h2>
      <?php if ($done) { ?>
        <span class="badge badge-notice">오늘 출석 완료</span>
      <?php } else { ?>
        <span class="badge badge-lock">오늘 출석 전</span>
      <?php } ?>
    </div>
    <div class="calendar">
      <?php for ($i = 0; $i < 7; $i++) { ?>
        <div class="cal-head"><?php echo $wd[$i]; ?></div>
      <?php } ?>
      <?php for ($i = 0; $i < $blank; $i++) { ?>
        <div class="cal-cell empty-cell"></div>
      <?php } ?>
      <?php for ($d = 1; $d <= $total; $d++) {
          $key = $ym . '-' . str_pad($d, 2, '0', STR_PAD_LEFT);
          $on  = isset($mark[$key]);
          $cls = 'cal-cell' . ($on ? ' checked' : '') . ($d === $today_d ? ' today' : '');
      ?>
        <div class="<?php echo $cls; ?>">
          <span class="cal-day"><?php echo $d; ?></span>
          <?php if ($on) { ?><span class="cal-stamp">✓</span><?php } ?>
        </div>
      <?php } ?>
    </div>
  </div>
</div>

<div class="card">
  <h2>적립 내역</h2>
  <?php if (!count($logs)) { ?>
    <div class="empty small">아직 내역이 없어요.</div>
  <?php } else { ?>
    <ul class="log-list">
      <?php foreach ($logs as $l) {
          $detail = (isset($l['detail']) && $l['detail'] !== '' && $l['detail'] !== null)
              ? $l['detail']
              : (isset($CM['rules'][$l['reason']]) ? $CM['rules'][$l['reason']]['label'] : $l['reason']);
      ?>
        <li>
          <div>
            <strong><?php echo cm_h($detail); ?></strong>
            <span class="muted"><?php echo cm_h(substr($l['created_at'], 0, 16)); ?></span>
          </div>
          <span class="accent"><?php echo cm_point_str($l['amount']); ?></span>
        </li>
      <?php } ?>
    </ul>
  <?php } ?>
</div>

<?php cm_close(); ?>
