// 아바타 시스템
// 예시 이미지(실사풍 AI 그림)와는 완전히 다른, 코드로 직접 그린 플랫 벡터 캐릭터.
// 포인트 누적에 따라 해금: 기본 12종(무료) → 스페셜 헤어(5,000P) → 프리미엄 의상(10,000P)
// → 움직이는 테두리(20,000P) → 이벤트 한정(시즌별)

const SKIN = '#ffe0cb';
const SKIN_SHADOW = '#f2c3a4';

// 색을 밝게/어둡게 (헤어 하이라이트·음영용)
function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt), g = clamp(((n >> 8) & 255) + amt), b = clamp((n & 255) + amt);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

let _uid = 0; // SVG 내부 id 충돌 방지용 (그라데이션·클립)

// ---- SVG 파츠 생성 -------------------------------------------------------

function hairBack(style, color) {
  switch (style) {
    case 'long':
      return `<path d="M27 34 Q27 14 50 14 Q73 14 73 34 L75 76 Q75 90 62 92 L38 92 Q25 90 25 76 Z" fill="${color}"/>`;
    case 'wave':
      return `<path d="M27 34 Q27 14 50 14 Q73 14 73 34 Q78 46 72 54 Q79 64 72 72 Q80 84 66 91 L34 91 Q20 84 28 72 Q21 64 28 54 Q22 46 27 34 Z" fill="${color}"/>`;
    case 'bob':
      return `<path d="M27 34 Q27 14 50 14 Q73 14 73 34 L73 56 Q73 67 61 67 L39 67 Q27 67 27 56 Z" fill="${color}"/>`;
    case 'ponytail':
      return `<path d="M28 34 Q28 15 50 15 Q72 15 72 34 L72 44 L28 44 Z" fill="${color}"/>
              <path d="M70 26 Q84 30 80 52 Q77 68 68 74 Q74 58 71 44 Q69 34 66 30 Z" fill="${color}"/>`;
    case 'bun':
      return `<circle cx="50" cy="13" r="9" fill="${color}"/>
              <path d="M28 34 Q28 15 50 15 Q72 15 72 34 L72 42 L28 42 Z" fill="${color}"/>`;
    case 'braid':
      return `<path d="M27 34 Q27 13 50 13 Q73 13 73 34 L73 50 L27 50 Z" fill="${color}"/>
              <circle cx="72" cy="52" r="6" fill="${color}"/><circle cx="74" cy="63" r="5.5" fill="${color}"/>
              <circle cx="72" cy="73" r="5" fill="${color}"/><circle cx="70" cy="82" r="4" fill="${color}"/>`;
    case 'hood':
      return '';
    default:
      return '';
  }
}

function hairFront(style, color) {
  if (style === 'hood') return '';
  // 이마를 덮는 물결 앞머리 (모든 스타일 공통, 색만 다름)
  return `<path d="M29 40 Q28 18 50 17 Q72 18 71 40 Q68 30 61 28 Q57 34 50 33 Q43 34 39 28 Q32 30 29 40 Z" fill="${color}"/>`;
}

function face(style, cfg, id) {
  const eye = (cfg && cfg.eyeColor) || '#5b3a2c';
  // 얼굴 + 부드러운 볼 음영
  const head = `
    <ellipse cx="50" cy="43.5" rx="18.5" ry="19.5" fill="url(#skin-${id})"/>
    <path d="M63 40 Q68 50 60 60 Q66 50 62 41 Z" fill="${SKIN_SHADOW}" opacity="0.35"/>`;

  if (style === 'hood') {
    return head + `
      <path d="M34 39 L66 39 L63 47 L37 47 Z" fill="#23232b"/>
      <ellipse cx="43" cy="43.2" rx="2.3" ry="2" fill="#cfe8ff"/>
      <ellipse cx="57" cy="43.2" rx="2.3" ry="2" fill="#cfe8ff"/>
      <circle cx="43.6" cy="42.6" r="0.7" fill="#fff"/>
      <circle cx="57.6" cy="42.6" r="0.7" fill="#fff"/>
      <path d="M46 55 Q50 57.5 54 55" stroke="#d98d78" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
  }

  return head + `
    <path d="M37.5 38.5 Q42 36.4 46.5 38.4" stroke="#8a6552" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M53.5 38.4 Q58 36.4 62.5 38.5" stroke="#8a6552" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <ellipse cx="42.4" cy="45.4" rx="3.5" ry="4.4" fill="#fff"/>
    <ellipse cx="57.6" cy="45.4" rx="3.5" ry="4.4" fill="#fff"/>
    <circle cx="42.6" cy="45.8" r="2.9" fill="${eye}"/>
    <circle cx="57.4" cy="45.8" r="2.9" fill="${eye}"/>
    <circle cx="42.6" cy="46" r="1.4" fill="#241713"/>
    <circle cx="57.4" cy="46" r="1.4" fill="#241713"/>
    <circle cx="43.7" cy="44" r="1" fill="#fff"/>
    <circle cx="58.5" cy="44" r="1" fill="#fff"/>
    <path d="M38.4 42.3 Q42.4 40.2 46.4 42.4" stroke="#3b2822" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <path d="M53.6 42.4 Q57.6 40.2 61.6 42.3" stroke="#3b2822" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <circle cx="37.6" cy="51.5" r="2.9" fill="#ff9d90" opacity="0.45"/>
    <circle cx="62.4" cy="51.5" r="2.9" fill="#ff9d90" opacity="0.45"/>
    <path d="M49.4 50.2 Q50 51 50.6 50.2" stroke="#e0a58c" stroke-width="1" fill="none" stroke-linecap="round"/>
    <path d="M47.2 54.4 Q50 56.8 52.8 54.4" stroke="#d0685a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
}

function outfit(kind, color) {
  const base = `<path d="M17 100 Q19 68 50 68 Q81 68 83 100 Z" fill="${color}"/>
                <rect x="44.5" y="56" width="11" height="14" rx="5" fill="${SKIN_SHADOW}"/>`;
  switch (kind) {
    case 'tux':
      return base +
        `<path d="M50 72 L42 84 L50 100 L58 84 Z" fill="#fff"/>
         <path d="M45 73 L50 79 L55 73 L52 72 L48 72 Z" fill="#1b1b22"/>
         <rect x="47" y="70.5" width="6" height="3" rx="1.5" fill="#c5a253"/>`;
    case 'shirt':
      return base +
        `<path d="M50 70 L43 78 L47 80 L50 76 L53 80 L57 78 Z" fill="#e8ecf1"/>
         <circle cx="50" cy="82" r="1.2" fill="#9aa7b5"/><circle cx="50" cy="88" r="1.2" fill="#9aa7b5"/>
         <circle cx="50" cy="94" r="1.2" fill="#9aa7b5"/>`;
    case 'dress':
      return base +
        `<path d="M38 74 Q44 70 50 74 Q56 70 62 74 L62 68 L38 68 Z" fill="${color}" opacity="0.6"/>
         <circle cx="44" cy="72" r="1.1" fill="#ffe9a8"/><circle cx="50" cy="74.5" r="1.1" fill="#ffe9a8"/>
         <circle cx="56" cy="72" r="1.1" fill="#ffe9a8"/>`;
    case 'hoodie':
      return base +
        `<path d="M36 74 Q50 82 64 74" stroke="rgba(0,0,0,0.25)" stroke-width="2" fill="none"/>
         <line x1="45" y1="76" x2="45" y2="88" stroke="rgba(255,255,255,0.6)" stroke-width="1.6"/>
         <line x1="55" y1="76" x2="55" y2="88" stroke="rgba(255,255,255,0.6)" stroke-width="1.6"/>`;
    default:
      return base;
  }
}

function accessory(kind) {
  switch (kind) {
    case 'cap':
      return `<path d="M31 29 Q32 13 50 13 Q68 13 69 29 L69 32 L31 32 Z" fill="#2e3440"/>
              <path d="M66 29 L86 33 Q87 37 82 37.5 L66 34 Z" fill="#232833"/>
              <circle cx="50" cy="13.5" r="2" fill="#4c566a"/>`;
    case 'ribbon':
      return `<path d="M36 17 L28 10 Q25 15 29 20 Z" fill="#ff7eb3"/>
              <path d="M36 17 L30 26 Q35 29 39 24 Z" fill="#ff7eb3"/>
              <circle cx="36.5" cy="18.5" r="3" fill="#e85d9e"/>`;
    case 'cat':
      return `<path d="M31 22 L27 6 L42 14 Z" fill="#3a3a44"/><path d="M32.5 19 L30.5 11 L38 15 Z" fill="#ff9eb8"/>
              <path d="M69 22 L73 6 L58 14 Z" fill="#3a3a44"/><path d="M67.5 19 L69.5 11 L62 15 Z" fill="#ff9eb8"/>`;
    case 'crown':
      return `<path d="M40 14 L42 6 L46.5 11 L50 4 L53.5 11 L58 6 L60 14 Z" fill="#f6c453" stroke="#d9a63a" stroke-width="1"/>
              <circle cx="50" cy="4" r="1.6" fill="#ff6b81"/>`;
    case 'headphones':
      return `<path d="M29 38 Q28 12 50 12 Q72 12 71 38" stroke="#30343f" stroke-width="4.5" fill="none"/>
              <rect x="24.5" y="34" width="9" height="14" rx="4.5" fill="#30343f"/>
              <rect x="66.5" y="34" width="9" height="14" rx="4.5" fill="#30343f"/>
              <rect x="26.5" y="37" width="5" height="8" rx="2.5" fill="#5e81ac"/>
              <rect x="68.5" y="37" width="5" height="8" rx="2.5" fill="#5e81ac"/>`;
    case 'flower':
      return ['36,15', '46,11', '56,11', '65,16'].map((pt) => {
        const [x, y] = pt.split(',').map(Number);
        const petals = [0, 72, 144, 216, 288].map((deg) =>
          `<circle cx="${x + 3 * Math.cos((deg * Math.PI) / 180)}" cy="${y + 3 * Math.sin((deg * Math.PI) / 180)}" r="2.1" fill="${x % 2 ? '#ffb7c5' : '#fff3b0'}"/>`
        ).join('');
        return petals + `<circle cx="${x}" cy="${y}" r="1.7" fill="#ff8fab"/>`;
      }).join('');
    case 'santa':
      return `<path d="M30 26 Q32 8 52 8 Q66 9 70 22 L70 26 Q50 18 30 26 Z" fill="#d64550"/>
              <path d="M28 26 Q50 16 72 26 Q72 31 68 31 Q50 23 32 31 Q28 31 28 26 Z" fill="#fff"/>
              <circle cx="71" cy="20" r="4" fill="#fff"/>`;
    case 'witch':
      return `<path d="M26 24 L74 24 Q78 28 72 29 L28 29 Q22 28 26 24 Z" fill="#2d1b4e"/>
              <path d="M34 25 Q44 4 58 2 Q54 12 62 25 Z" fill="#3d2566"/>
              <rect x="40" y="20" width="18" height="4" fill="#7c4dff" rx="1"/>`;
    case 'hoodup':
      return `<path d="M25 92 Q18 40 50 16 Q82 40 75 92 L64 92 Q70 46 50 26 Q30 46 36 92 Z" fill="#33333d"/>
              <path d="M25 92 Q18 40 50 16 Q82 40 75 92 L64 92 Q70 46 50 26 Q30 46 36 92 Z" fill="none" stroke="#26262e" stroke-width="1"/>`;
    case 'necklace':
      return `<path d="M44 70 Q50 76 56 70" stroke="#e7c86e" stroke-width="1.4" fill="none"/>
              <circle cx="50" cy="74.5" r="1.8" fill="#ffdf7e"/>`;
    case 'earrings':
      return `<circle cx="31.5" cy="50" r="1.6" fill="#ffd166"/><circle cx="68.5" cy="50" r="1.6" fill="#ffd166"/>`;
    default:
      return '';
  }
}

// 아바타 한 개를 SVG 문자열로 렌더링
function buildSvg(cfg) {
  const id = 'a' + (_uid++);
  const hairHi = shade(cfg.hairColor, 45);   // 헤어 하이라이트
  const hairLo = shade(cfg.hairColor, -35);  // 헤어 음영
  const bgHi = shade(cfg.bg, 22);

  const defs = `<defs>
    <radialGradient id="bg-${id}" cx="35%" cy="28%" r="85%">
      <stop offset="0%" stop-color="${bgHi}"/><stop offset="100%" stop-color="${cfg.bg}"/>
    </radialGradient>
    <radialGradient id="skin-${id}" cx="42%" cy="38%" r="70%">
      <stop offset="0%" stop-color="#fff0e6"/><stop offset="100%" stop-color="${SKIN}"/>
    </radialGradient>
    <clipPath id="clip-${id}"><circle cx="50" cy="50" r="50"/></clipPath>
  </defs>`;

  const parts = [];
  parts.push(`<circle cx="50" cy="50" r="50" fill="url(#bg-${id})"/>`);
  parts.push(hairBack(cfg.hair, cfg.hairColor));
  // 뒷머리 음영
  if (cfg.hair !== 'hood') parts.push(`<path d="M27 60 Q25 80 40 90 L60 90 Q75 80 73 60 Q73 78 60 84 L40 84 Q27 78 27 60 Z" fill="${hairLo}" opacity="0.45"/>`);
  parts.push(outfit(cfg.outfit || 'plain', cfg.outfitColor || '#8ecfc4'));
  parts.push(face(cfg.hair, cfg, id));
  parts.push(hairFront(cfg.hair, cfg.hairColor));
  // 앞머리 하이라이트
  if (cfg.hair !== 'hood') parts.push(`<path d="M35 24 Q50 17 65 24 Q56 21 50 21 Q44 21 35 24 Z" fill="${hairHi}" opacity="0.6"/>`);
  (cfg.accessories || []).forEach((a) => parts.push(accessory(a)));

  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    ${defs}
    <g clip-path="url(#clip-${id})">${parts.join('\n')}</g>
  </svg>`;
}

// ---- 아바타 카탈로그 ------------------------------------------------------
// tier: basic(무료) / hair(5,000P) / outfit(10,000P) / event(시즌 한정)

const AVATARS = [
  // 1. 무료 기본 아바타 12종 (가입 후 바로 사용 가능)
  { id: 'basic-01', name: '체리 블라썸', tier: 'basic', need: 0, cfg: { bg: '#ffe3ec', hair: 'long', hairColor: '#f4a7c0', outfitColor: '#f6b8cd' } },
  { id: 'basic-02', name: '미드나잇', tier: 'basic', need: 0, cfg: { bg: '#e0e4f5', hair: 'long', hairColor: '#2f3040', outfitColor: '#5c6394' } },
  { id: 'basic-03', name: '허니 브라운', tier: 'basic', need: 0, cfg: { bg: '#f9ecd9', hair: 'wave', hairColor: '#a9744f', outfitColor: '#e3b97f' } },
  { id: 'basic-04', name: '나이트 캣', tier: 'basic', need: 0, cfg: { bg: '#e8e3f6', hair: 'bob', hairColor: '#3a3a44', outfitColor: '#8f84c9', accessories: ['cat'] } },
  { id: 'basic-05', name: '스트릿 캡', tier: 'basic', need: 0, cfg: { bg: '#dff0ee', hair: 'ponytail', hairColor: '#463f3a', outfit: 'hoodie', outfitColor: '#4c566a', accessories: ['cap'] } },
  { id: 'basic-06', name: '골드 웨이브', tier: 'basic', need: 0, cfg: { bg: '#fdf3d8', hair: 'wave', hairColor: '#e0b34c', outfitColor: '#f2cd79', accessories: ['earrings'] } },
  { id: 'basic-07', name: '코코아 단발', tier: 'basic', need: 0, cfg: { bg: '#f2e5dc', hair: 'bob', hairColor: '#6b4a3a', outfitColor: '#c99b83' } },
  { id: 'basic-08', name: '라일락 드림', tier: 'basic', need: 0, cfg: { bg: '#f0e4fa', hair: 'long', hairColor: '#b48bd8', outfitColor: '#cbaee0' } },
  { id: 'basic-09', name: '민트 소다', tier: 'basic', need: 0, cfg: { bg: '#e0f5ec', hair: 'bun', hairColor: '#8fd0b6', outfitColor: '#a5dcc8' } },
  { id: 'basic-10', name: '루비 레드', tier: 'basic', need: 0, cfg: { bg: '#fbe3e0', hair: 'wave', hairColor: '#b3382f', outfitColor: '#d96459' } },
  { id: 'basic-11', name: '스카이 포니', tier: 'basic', need: 0, cfg: { bg: '#e0eefa', hair: 'ponytail', hairColor: '#5d8fc9', outfitColor: '#8fb8e0' } },
  { id: 'basic-12', name: '미스터리 후드', tier: 'basic', need: 0, cfg: { bg: '#d9d9e3', hair: 'hood', hairColor: '#33333d', outfitColor: '#33333d', accessories: ['hoodup'] } },

  // 2. 스페셜 헤어 3종 (5,000P 해금) - 헤어 스타일이 더 화려하게
  { id: 'hair-01', name: '힙합 헤드셋', tier: 'hair', need: 5000, cfg: { bg: '#e3e8f2', hair: 'wave', hairColor: '#4a3b52', outfit: 'hoodie', outfitColor: '#3b4252', accessories: ['headphones'] } },
  { id: 'hair-02', name: '리본 웨이브', tier: 'hair', need: 5000, cfg: { bg: '#fde8f0', hair: 'wave', hairColor: '#e8a2b8', outfitColor: '#f3bfd0', accessories: ['ribbon'] } },
  { id: 'hair-03', name: '브레이드 크라운', tier: 'hair', need: 5000, cfg: { bg: '#f5ecdf', hair: 'braid', hairColor: '#8a6642', outfitColor: '#d9b98a', accessories: ['crown'] } },

  // 3. 프리미엄 의상 3종 (10,000P 해금) - 의상과 분위기가 한층 고급스럽게
  { id: 'outfit-01', name: '블랙 턱시도', tier: 'outfit', need: 10000, cfg: { bg: '#e6e6ee', hair: 'long', hairColor: '#26262e', outfit: 'tux', outfitColor: '#1b1b22', accessories: ['earrings'] } },
  { id: 'outfit-02', name: '화이트 오피스', tier: 'outfit', need: 10000, cfg: { bg: '#eef2f5', hair: 'bun', hairColor: '#5a4636', outfit: 'shirt', outfitColor: '#f7f9fb' } },
  { id: 'outfit-03', name: '레드 드레스', tier: 'outfit', need: 10000, cfg: { bg: '#fbe6e6', hair: 'wave', hairColor: '#3d2b2b', outfit: 'dress', outfitColor: '#c0392b', accessories: ['necklace'] } },

  // 5. 이벤트 한정 (시즌마다 열리는 특별 아바타)
  { id: 'event-spring', name: '봄 플로럴', tier: 'event', need: 0, months: [3, 4, 5], cfg: { bg: '#eaf7e2', hair: 'long', hairColor: '#c9906b', outfitColor: '#bfe3a8', accessories: ['flower'] } },
  { id: 'event-xmas', name: '크리스마스', tier: 'event', need: 0, months: [12], cfg: { bg: '#e3f0e8', hair: 'wave', hairColor: '#7a4a35', outfit: 'dress', outfitColor: '#b23a48', accessories: ['santa'] } },
  { id: 'event-halloween', name: '할로윈 마녀', tier: 'event', need: 0, months: [10], cfg: { bg: '#ece2f7', hair: 'long', hairColor: '#4b3869', outfitColor: '#5d3fd3', accessories: ['witch'] } },
];

// 4. 움직이는 테두리 3종 (20,000P 해금) - CSS 애니메이션으로 반짝임
const BORDERS = [
  { id: 'border-neon', name: '네온 블루', need: 20000, cls: 'border-neon' },
  { id: 'border-sunset', name: '선셋 골드', need: 20000, cls: 'border-sunset' },
  { id: 'border-heart', name: '핑크 하트', need: 20000, cls: 'border-heart' },
];

const TIER_INFO = {
  basic: { label: '무료 기본 아바타', desc: '가입 후 바로 사용 가능', need: 0 },
  hair: { label: '스페셜 헤어', desc: '헤어 스타일이 더 화려하게', need: 5000 },
  outfit: { label: '프리미엄 의상', desc: '의상과 분위기가 한층 더 고급스럽게', need: 10000 },
  event: { label: '이벤트 한정', desc: '시즌마다 만날 수 있는 특별 아바타', need: 0 },
};

const avatarMap = new Map(AVATARS.map((a) => [a.id, a]));
const borderMap = new Map(BORDERS.map((b) => [b.id, b]));

function eventOpen(avatar, now = new Date()) {
  return !avatar.months || avatar.months.includes(now.getMonth() + 1);
}

// 사용자(누적 포인트 기준)가 이 아바타/테두리를 쓸 수 있는지
function canUseAvatar(user, avatarId) {
  const a = avatarMap.get(avatarId);
  if (!a) return false;
  if (a.tier === 'event') return eventOpen(a);
  return user.points >= a.need;
}
function canUseBorder(user, borderId) {
  const b = borderMap.get(borderId);
  return !!b && user.points >= b.need;
}

// 게시글/댓글 옆에 표시할 아바타 HTML (익명 글은 미스터리 후드로 고정)
function renderAvatar(avatarId, borderId, size = 44) {
  const a = avatarMap.get(avatarId) || avatarMap.get('basic-12');
  const b = borderId ? borderMap.get(borderId) : null;
  const cls = b ? ` ${b.cls}` : '';
  return `<span class="avatar${cls}" style="width:${size}px;height:${size}px">${buildSvg(a.cfg)}</span>`;
}

module.exports = {
  AVATARS, BORDERS, TIER_INFO,
  renderAvatar, canUseAvatar, canUseBorder, eventOpen,
};
