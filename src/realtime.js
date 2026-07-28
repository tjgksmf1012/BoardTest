// 알림 실시간 전달 (SSE, Server-Sent Events)
//
// 새로고침해야 알림 배지가 바뀌던 것을 서버가 먼저 알려주도록 바꿨다.
// 웹소켓 대신 SSE를 쓴 이유:
//  - 서버 → 브라우저 한 방향이면 충분하다 (알림은 브라우저가 보낼 게 없다)
//  - 평범한 HTTP라 프록시·HTTPS를 그대로 타고, 끊기면 브라우저가 알아서 다시 붙는다
//  - 추가 의존성이 없다
const MAX_PER_USER = 5;   // 한 사람이 열어둘 수 있는 탭 수 (그 이상은 오래된 것부터 정리)
const PING_MS = 25000;    // 중간 프록시가 조용한 연결을 끊지 않도록 주기적으로 신호를 보낸다

// userId -> Set<res>
const clients = new Map();

function write(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

// 한 브라우저 탭이 연결을 열었을 때
function subscribe(userId, res) {
  let set = clients.get(userId);
  if (!set) { set = new Set(); clients.set(userId, set); }
  // 탭을 너무 많이 열어둔 경우 가장 오래된 연결을 정리한다 (브라우저가 알아서 다시 붙는다)
  while (set.size >= MAX_PER_USER) {
    const oldest = set.values().next().value;
    set.delete(oldest);
    try { oldest.end(); } catch {}
  }
  set.add(res);

  const timer = setInterval(() => {
    // 주석 줄(:)은 이벤트로 취급되지 않아 연결 유지용으로 딱 맞다
    try { res.write(': ping\n\n'); } catch { /* 곧 close가 온다 */ }
  }, PING_MS);
  if (timer.unref) timer.unref();

  const cleanup = () => {
    clearInterval(timer);
    const s = clients.get(userId);
    if (!s) return;
    s.delete(res);
    if (s.size === 0) clients.delete(userId);
  };
  res.on('close', cleanup);
  res.on('error', cleanup);
  return cleanup;
}

// 특정 사용자의 열린 화면 전부에 보낸다
function publish(userId, data) {
  const set = clients.get(userId);
  if (!set) return 0;
  let sent = 0;
  for (const res of [...set]) {
    if (write(res, 'notify', data)) sent += 1;
    else set.delete(res);
  }
  return sent;
}

function connectionCount(userId) {
  return userId === undefined
    ? [...clients.values()].reduce((n, s) => n + s.size, 0)
    : (clients.get(userId) || new Set()).size;
}

// 테스트·종료 시 정리
function closeAll() {
  for (const set of clients.values()) {
    for (const res of set) { try { res.end(); } catch {} }
  }
  clients.clear();
}

module.exports = { subscribe, publish, connectionCount, closeAll, MAX_PER_USER, PING_MS };
