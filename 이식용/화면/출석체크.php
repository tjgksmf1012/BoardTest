<?php
/*
 * 출석체크 화면 — 그대로 쓰시면 됩니다
 *
 *   기존 페이지 안에 넣기:   include '/화면/출석체크.php';
 *   그냥 열어 보기:          http://사이트/화면/출석체크.php
 *
 * 출석 버튼을 누르면 이 파일이 자기 자신에게 POST 를 보내 처리하고 다시 그립니다.
 * 따로 처리 페이지를 만드실 필요 없습니다.
 *
 * 고치실 것: 없습니다. 로그인한 사람을 어떻게 알아내는지만 lib/cm_config.php 아래쪽에서
 * 확인해 주세요.
 */

require_once dirname(__FILE__) . '/cm_boot.php';
cm_set_caller(__FILE__);

$uid = cm_current_user_id();

$flash = '';
$flash_kind = 'ok';

// ---- 출석 버튼을 눌렀을 때 ---------------------------------------------------
if ($uid && isset($_POST['cm_do']) && $_POST['cm_do'] === 'attend') {
    if (!cm_token_ok()) {
        $flash = '잠시 후 다시 눌러 주세요.';
        $flash_kind = 'bad';
    } else {
        $r = cm_check_attendance($uid);
        if ($r['already']) {
            $flash = '오늘은 이미 출석하셨어요.';
        } else {
            $flash = $r['streak'] . '일 연속 출석! ' . cm_point_str($r['awarded']) . ' 받으셨어요.';
            if (count($r['bonus'])) { $flash .= ' (' . implode(', ', $r['bonus']) . ')'; }
        }
    }
}

cm_open('출석체크');

if (!$uid) {
    cm_need_login();
    cm_close();
    return;
}

// ---- 화면에 뿌릴 값 ----------------------------------------------------------
$streak    = cm_streak($uid);
$month     = cm_month_count($uid);
$points    = cm_points($uid);
$done      = cm_checked_today($uid);
$next      = cm_next_streak($streak);
$today_amt = $CM['rules']['attendance']['amount'];
?>

<div class="att-head">
  <div>
    <h1>출석체크</h1>
    <p class="muted">매일 출석하고 포인트를 받아보세요!</p>
  </div>
</div>

<?php cm_flash($flash, $flash_kind); ?>

<section class="card att-summary">
  <div class="asum">
    <span class="asum-label">연속 출석</span>
    <strong class="asum-value"><?php echo (int)$streak; ?>일</strong>
  </div>
  <div class="asum">
    <span class="asum-label">이번 달 출석</span>
    <strong class="asum-value warm"><?php echo (int)$month; ?>회</strong>
  </div>
  <div class="asum">
    <span class="asum-label">보유 포인트</span>
    <strong class="asum-value"><?php echo number_format($points); ?>P</strong>
  </div>
</section>

<?php
// ---- 연속 출석 보너스 표 -----------------------------------------------------
$marks = array();
foreach ($CM['streak_days'] as $days => $reason) {
    $marks[] = array('days' => (int)$days,
                     'amount' => $CM['rules'][$reason]['amount'],
                     'done' => $streak >= (int)$days);
}
$last = $marks[count($marks) - 1];
$pct = $last['days'] > 0 ? min(100, floor($streak * 100 / $last['days'])) : 0;
?>
<section class="card att-challenge">
  <div class="att-sec-head">
    <h2><?php echo (int)$last['days']; ?>일 연속 출석 챌린지</h2>
    <?php if ($streak >= $last['days']) { ?><span class="badge badge-notice">달성</span><?php } ?>
  </div>
  <p class="muted att-sec-desc">
    <?php if ($next) { ?>
      다음 보너스까지 <strong><?php echo (int)$next['left']; ?>일</strong> 남았어요
      (<?php echo (int)$next['days']; ?>일 달성 시 <?php echo number_format($next['amount']); ?>P)
    <?php } else { ?>
      보너스를 모두 받으셨어요. 연속이 끊기면 처음부터 다시 받으실 수 있어요.
    <?php } ?>
  </p>

  <div class="progress" aria-hidden="true">
    <div class="progress-fill" style="width:<?php echo (int)$pct; ?>%"></div>
  </div>

  <ol class="att-marks">
    <?php foreach ($marks as $m) { ?>
      <li class="<?php echo $m['done'] ? 'on' : ''; ?>">
        <span class="am-day"><?php echo (int)$m['days']; ?>일</span>
        <span class="am-point"><?php echo number_format($m['amount']); ?>P</span>
        <span class="am-dot" aria-hidden="true"><?php echo $m['done'] ? '✓' : ''; ?></span>
      </li>
    <?php } ?>
  </ol>
</section>

<?php
// ---- 이번 주 도장판 ----------------------------------------------------------
// 연속 일수를 7일씩 끊어서, 지금이 몇 주차인지 보여 준다.
$week     = (int)floor(max(0, $streak - ($done ? 1 : 0)) / 7) + 1;
$week_from = ($week - 1) * 7;                 // 이번 주가 시작되는 연속 일수
?>
<section class="card att-week">
  <div class="att-sec-head">
    <h2><?php echo (int)$week; ?>주차 출석 도전</h2>
  </div>
  <ol class="att-days">
    <?php for ($i = 1; $i <= 7; $i++) {
        $nth = $week_from + $i;               // 몇 일차인가
        $is_done  = $nth <= $streak;
        $is_today = ($done && $nth === $streak) || (!$done && $nth === $streak + 1);
        $cls = ($is_done ? 'done' : '') . ($is_today ? ' today' : '');
    ?>
      <li class="att-day-item <?php echo $cls; ?>">
        <span class="adi-circle"><?php echo $is_done ? '✓' : (int)$nth; ?></span>
        <span class="adi-label"><?php echo $is_today && !$done ? '오늘' : (int)$nth . '일차'; ?></span>
        <span class="adi-point"><?php echo (int)$today_amt; ?>P</span>
      </li>
    <?php } ?>
  </ol>

  <?php if ($done) { ?>
    <button class="btn btn-block att-check-btn" type="button" disabled>오늘 출석 완료</button>
  <?php } else { ?>
    <form method="post" action="<?php echo cm_self_url(); ?>">
      <?php echo cm_token_field(); ?>
      <input type="hidden" name="cm_do" value="attend">
      <button class="btn btn-primary btn-block att-check-btn" type="submit">
        오늘 출석체크 하기 (<?php echo (int)$today_amt; ?>P 적립)
      </button>
    </form>
  <?php } ?>

  <p class="muted att-note">※ 매일 00:00 ~ 23:59 사이에 출석체크가 가능합니다.</p>
</section>

<section class="card att-guide">
  <h2 class="att-guide-head">출석체크 안내</h2>
  <ul>
    <li>매일 한 번 출석체크할 수 있으며, <?php echo (int)$today_amt; ?>P가 적립됩니다.</li>
    <?php foreach ($marks as $m) { ?>
      <li><?php echo (int)$m['days']; ?>일 연속 출석 시 <?php echo number_format($m['amount']); ?>P 보너스가 지급됩니다.</li>
    <?php } ?>
    <li>연속 출석일이 끊기면 다음 날부터 다시 1일차로 시작됩니다.</li>
    <li>부정한 방법으로 포인트를 적립할 경우 회수될 수 있습니다.</li>
  </ul>
</section>

<?php cm_close(); ?>
