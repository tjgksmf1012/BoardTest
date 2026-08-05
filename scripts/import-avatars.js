// 거래처에서 받은 캐릭터·테두리 이미지를 프로그램에 들여온다.
//
//   node scripts/import-avatars.js <받은폴더>
//
// 받은 폴더 구조 (폴더 이름으로 회원 유형을 정한다)
//   남성회원/  업소회원/  여성캐릭터/  익명/  운영자/  테두리/
//
// 하는 일
//  1) 예전에 임시로 넣어둔 이미지를 모두 지운다
//  2) 캐릭터는 정사각 256px(본문)·96px(썸네일)로 줄여 저장
//  3) 여성회원 캐릭터는 낱장이 아니라 '헤어 5종 × 의상 5종' 모아찍기 한 장으로 왔다.
//     테마 9장 = 225종이므로 격자를 찾아 25칸으로 잘라 낸다 (아래 sliceSheet)
//  4) 테두리는 두 가지 형태로 온다. 이미 투명 배경이면 그대로 쓰고,
//     '검은 배경 위 빛나는 고리'면 밝기를 투명도로 바꿔 어떤 배경에도 얹히게 만든다
//  5) 무엇이 들어왔는지 manifest.json 으로 남긴다 (코드는 이 파일만 읽는다)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'avatars');
const SIZE = 256;      // 본문에서 쓰는 크기
const THUMB = 96;      // 목록·상점 썸네일

// 폴더 이름 → 회원 유형과 코드 접두사 (낱장으로 온 것들)
const GROUPS = [
  { dir: '남성회원', type: 'male',   prefix: 'male',   label: '남성회원' },
  { dir: '업소회원', type: 'venue',  prefix: 'venue',  label: '업소회원' },
  { dir: '익명',     type: 'anon',   prefix: 'anon',   label: '익명' },
  { dir: '운영자',   type: 'admin',  prefix: 'admin',  label: '운영자' },
];

// ---- 여성회원 캐릭터 ---------------------------------------------------------
// 모아찍기 한 장 = 테마 하나. 파일 이름이 곧 테마 이름이다.
const FEMALE_DIR = '여성캐릭터';
const FEMALE_THEMES = {
  '청순 내츄럴': 'purenatural',
  '러블리핑크': 'lovelypink',
  '상큼 민트': 'freshmint',
  '몽한 퍼플': 'dreamypurple',
  '글램 골드': 'glamgold',
  '레드 퀸': 'redqueen',
  '시크 블랙': 'chicblack',
  '힙 스트릿': 'hipstreet',
  '그레이': 'gray',
};
// 한 테마당 잘라낼 칸 수 (기획서의 "캐릭터별 25종 스타일")
const SHEET_COLS = 5;
const SHEET_ROWS = 5;
// 가입할 때 고를 수 있는 무료 5종.
// 수정사항: "여성회원은 청순 내츄럴 폴더 이미지 하단 이미지 5개로 선택 가능"
const FREE_THEME = '청순 내츄럴';
const FREE_ROW = 5;                     // 그 시트의 맨 아랫줄
// 표에 붙은 이름표(모아찍기 왼쪽·위쪽 머리글)는 잘라낸 칸에 들어가면 안 된다.
// 격자를 찾을 때 이름표 띠는 폭이 얇아 자동으로 걸러진다.
const NOT_A_SHEET = /^종합/;            // 전체를 한눈에 보라고 온 안내용 장

// 테두리 파일 이름 → 코드·표시 이름
const BORDER_NAMES = {
  '골드': ['gold', '골드'],
  '레드': ['red', '레드'],
  '민트': ['mint', '민트'],
  '블루': ['blue', '블루'],
  '실버': ['silver', '실버'],
  '오렌지': ['orange', '오렌지'],
  '핑크': ['pink', '핑크'],
  '무지개테두리': ['rainbow', '무지개'],
  'image (3)': ['cyan', '시안'],   // 이름 없이 온 파일 — 청록색 고리
};

const isImage = (f) => /\.(png|jpe?g|webp)$/i.test(f);
const listImages = (dir) => {
  try { return fs.readdirSync(dir).filter(isImage).sort(); } catch { return []; }
};

// 캐릭터: 흰 배경 그대로 두고 정사각으로 맞춘다 (화면에서 원형으로 잘라 쓴다)
async function saveCharacter(src, code) {
  for (const [size, suffix] of [[SIZE, ''], [THUMB, '-t']]) {
    await sharp(src)
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9, palette: true })
      .toFile(path.join(OUT, `${code}${suffix}.png`));
  }
}

// 테두리 저장.
//
// 받은 그림이 이미 투명 배경이면 **그대로** 쓴다.
// 예전에는 형태를 안 보고 무조건 밝기로 알파를 다시 만들었는데(removeAlpha 후 max(r,g,b)),
// 그러면 투명했던 곳이 일단 검게 칠해졌다가 다시 뚫리면서
//   - 원본의 부드러운 가장자리가 뭉개지고
//   - 압축 잡티(빨강·파랑 점)까지 불투명해져 고리가 알록달록 지저분해졌다.
// 실제로 받은 1024px 원본은 처음부터 투명 배경이었는데, 그걸 버리고 있었다.
async function hasRealAlpha(src) {
  const meta = await sharp(src).metadata();
  if (!meta.hasAlpha) return false;
  // 알파 채널이 있어도 전부 불투명이면 '투명 배경' 이 아니다. 줄여서 훑어 확인한다.
  const { data, info } = await sharp(src).resize(64, 64, { fit: 'fill' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0;
  for (let i = 3; i < data.length; i += info.channels) if (data[i] < 16) clear++;
  return clear > (info.width * info.height) * 0.05;
}

async function saveBorder(src, code) {
  const keep = await hasRealAlpha(src);
  for (const [size, suffix] of [[SIZE, ''], [THUMB, '-t']]) {
    const dst = path.join(OUT, `${code}${suffix}.png`);
    if (keep) {
      await sharp(src).resize(size, size, { fit: 'cover' })
        .png({ compressionLevel: 9 }).toFile(dst);
      continue;
    }
    const { data, info } = await sharp(src)
      .resize(size, size, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rgba = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const a = Math.max(r, g, b);          // 검은 곳은 0 → 완전히 투명
      rgba[j] = r; rgba[j + 1] = g; rgba[j + 2] = b; rgba[j + 3] = a;
    }
    await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(dst);
  }
  return keep;
}

// ---- 모아찍기 한 장을 25칸으로 자르기 ---------------------------------------
//
// 좌표를 손으로 적어두면 테마마다 여백이 달라 어긋난다. 그래서 그림에서 격자를 찾는다.
//   1) 가로·세로로 '흰색이 아닌 점'의 개수를 센다
//   2) 그 개수가 충분한 구간(= 캐릭터가 그려진 띠)을 모은다
//   3) 띠 폭의 중앙값을 기준으로, 너무 얇은 것(이름표 칸)은 버리고
//      너무 두꺼운 것(칸끼리 붙어 버린 것)은 균등하게 쪼갠다
function bands(counts, len, floor) {
  const out = [];
  let start = -1;
  for (let i = 0; i < len; i++) {
    const on = counts[i] > floor;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { out.push([start, i - start]); start = -1; }
  }
  if (start >= 0) out.push([start, len - start]);
  return out.filter(([, w]) => w > len * 0.02);
}

const median = (nums) => [...nums].sort((a, b) => a - b)[Math.floor(nums.length / 2)];

function gridLines(raw, counts, want) {
  if (raw.length === 0) return [];
  // 이름표 띠는 폭이 얇거나(머리글), 폭은 비슷해도 글자뿐이라 훨씬 성기다.
  // 칸에는 큰 원이 꽉 차 있으므로 '띠 안의 평균 밀도'로 확실히 갈린다.
  const dense = ([at, w]) => {
    let s = 0;
    for (let i = at; i < at + w; i++) s += counts[i];
    return s / w;
  };
  const midW = median(raw.map(([, w]) => w));
  const midD = median(raw.map(dense));
  const cells = [];
  for (const b of raw) {
    if (b[1] < midW * 0.6) continue;              // 얇은 머리글 띠
    if (dense(b) < midD * 0.55) continue;         // 글자만 있는 이름표 칸
    const n = Math.max(1, Math.round(b[1] / midW)); // 붙어 버린 칸 수
    const w = b[1] / n;
    for (let k = 0; k < n; k++) cells.push([b[0] + Math.round(w * k), Math.round(w)]);
  }
  return cells.slice(0, want);
}

async function sliceSheet(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const colHits = new Array(W).fill(0);
  const rowHits = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * C;
      const blank = data[i + 3] < 30 || (data[i] > 236 && data[i + 1] > 236 && data[i + 2] > 236);
      if (!blank) { colHits[x]++; rowHits[y]++; }
    }
  }
  const cols = gridLines(bands(colHits, W, H * 0.06), colHits, SHEET_COLS);
  const rows = gridLines(bands(rowHits, H, W * 0.06), rowHits, SHEET_ROWS);
  if (cols.length !== SHEET_COLS || rows.length !== SHEET_ROWS) {
    throw new Error(`${path.basename(src)}: 격자를 ${cols.length}×${rows.length} 로 읽었어요 `
      + `(${SHEET_COLS}×${SHEET_ROWS} 이어야 함). 시트 여백이 달라진 것 같아요.`);
  }
  // 칸은 조금 세로로 길다. 원형으로 잘라 쓰므로 가운데 정사각만 가져온다.
  return rows.flatMap(([top, h], r) => cols.map(([left, w], c) => {
    const side = Math.min(w, h);
    return {
      row: r + 1, col: c + 1,
      box: { left: left + Math.round((w - side) / 2), top: top + Math.round((h - side) / 2),
        width: side, height: side },
    };
  }));
}

async function importFemale(srcRoot, items) {
  const dir = path.join(srcRoot, FEMALE_DIR);
  const files = listImages(dir).filter((f) => !NOT_A_SHEET.test(f));
  if (files.length === 0) { console.log(`  - ${FEMALE_DIR}: 없음 (건너뜀)`); return; }

  // 무료 5종이 먼저 오도록 테마 순서를 잡는다 (가입 화면에서 이 순서로 보인다)
  const order = Object.keys(FEMALE_THEMES);
  files.sort((a, b) => {
    const ia = order.indexOf(path.basename(a, path.extname(a)));
    const ib = order.indexOf(path.basename(b, path.extname(b)));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  let themeSort = 0;
  for (const f of files) {
    const theme = path.basename(f, path.extname(f));
    const slug = FEMALE_THEMES[theme];
    if (!slug) { console.log(`  ! ${FEMALE_DIR}/${f}: 모르는 테마라 건너뜁니다`); continue; }
    const src = path.join(dir, f);
    const cells = await sliceSheet(src);
    themeSort++;
    for (const cell of cells) {
      const code = `female-${slug}-${cell.row}-${cell.col}`;
      const free = theme === FREE_THEME && cell.row === FREE_ROW;
      for (const [size, suffix] of [[SIZE, ''], [THUMB, '-t']]) {
        await sharp(src).extract(cell.box)
          .resize(size, size, { fit: 'cover' })
          .png({ compressionLevel: 9, palette: true })
          .toFile(path.join(OUT, `${code}${suffix}.png`));
      }
      items.push({
        code, kind: 'character', memberType: 'female',
        name: `${theme} ${cell.row}-${cell.col}`,
        theme, themeCode: slug, themeSort, row: cell.row, col: cell.col,
        free,
        file: `${code}.png`, thumb: `${code}-t.png`, sort: items.length,
      });
    }
    console.log(`  + ${FEMALE_DIR}/${theme}: ${cells.length}종`);
  }
}

// 다른 스크립트가 이 파일의 도구만 빌려 쓸 수 있게 열어 둔다
// (scripts/import-borders.js 가 테두리만 바꿔 끼울 때 쓴다)
module.exports = { saveBorder, BORDER_NAMES, OUT, SIZE, THUMB, listImages };

// 직접 실행했을 때만 전체를 들여온다
if (require.main !== module) return;

(async () => {
  const srcRoot = process.argv[2];
  if (!srcRoot || !fs.existsSync(srcRoot)) {
    console.error('받은 이미지 폴더 경로를 넘겨주세요.\n  node scripts/import-avatars.js <받은폴더>');
    process.exit(1);
  }

  // 1) 임시로 넣어뒀던 이미지를 모두 치운다
  fs.mkdirSync(OUT, { recursive: true });
  let removed = 0;
  for (const f of fs.readdirSync(OUT)) {
    if (isImage(f) || f === 'manifest.json') { fs.unlinkSync(path.join(OUT, f)); removed++; }
  }
  console.log(`예전 이미지 ${removed}개 삭제`);

  const items = [];

  // 2) 여성회원 캐릭터 (모아찍기 → 25칸)
  await importFemale(srcRoot, items);

  // 3) 낱장으로 온 캐릭터
  for (const g of GROUPS) {
    const files = listImages(path.join(srcRoot, g.dir));
    if (files.length === 0) { console.log(`  - ${g.dir}: 없음 (건너뜀)`); continue; }
    let n = 0;
    for (const f of files) {
      n++;
      const single = files.length === 1;
      const code = single ? g.prefix : `${g.prefix}-${String(n).padStart(2, '0')}`;
      await saveCharacter(path.join(srcRoot, g.dir, f), code);
      items.push({
        code, kind: 'character', memberType: g.type,
        name: single ? g.label : `${g.label} ${n}`,
        file: `${code}.png`, thumb: `${code}-t.png`,
        sort: items.length,
      });
    }
    console.log(`  + ${g.dir}: ${n}개`);
  }

  // 4) 테두리
  const borderDir = path.join(srcRoot, '테두리');
  const borderFiles = listImages(borderDir);
  let etc = 0;
  for (const f of borderFiles) {
    const base = path.basename(f, path.extname(f));
    const known = BORDER_NAMES[base];
    const [slug, label] = known || [`etc${++etc}`, `테두리 ${etc}`];
    const code = `border-${slug}`;
    const kept = await saveBorder(path.join(borderDir, f), code);
    if (!kept) console.log(`    · ${label}: 검은 배경이라 밝기로 투명도를 만들었어요`);
    items.push({
      code, kind: 'border', memberType: null, name: label,
      file: `${code}.png`, thumb: `${code}-t.png`, sort: items.length,
    });
  }
  console.log(`  + 테두리: ${borderFiles.length}개`);

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(items, null, 2) + '\n');
  console.log(`\n총 ${items.length}개를 들여왔어요 → public/avatars/manifest.json`);
})().catch((e) => { console.error(e); process.exit(1); });
