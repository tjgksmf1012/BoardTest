// 거래처에서 받은 캐릭터·테두리 이미지를 프로그램에 들여온다.
//
//   node scripts/import-avatars.js <받은폴더>
//
// 받은 폴더 구조 (폴더 이름으로 회원 유형을 정한다)
//   남성회원/  업소회원/  여성회원/  익명/  운영자/  테두리/
//
// 하는 일
//  1) 예전에 임시로 넣어둔 이미지를 모두 지운다
//  2) 캐릭터는 정사각 256px(본문)·96px(썸네일)로 줄여 저장
//  3) 테두리는 '검은 배경 위 빛나는 고리'로 와서 그대로 씌우면 검은 사각형이 된다.
//     밝기를 그대로 투명도로 바꿔(alpha = max(r,g,b)) 어떤 배경 위에도 얹히게 만든다
//  4) 무엇이 들어왔는지 manifest.json 으로 남긴다 (코드는 이 파일만 읽는다)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'avatars');
const SIZE = 256;      // 본문에서 쓰는 크기
const THUMB = 96;      // 목록·상점 썸네일

// 폴더 이름 → 회원 유형과 코드 접두사
const GROUPS = [
  { dir: '여성회원', type: 'female', prefix: 'female', label: '여성회원' },
  { dir: '남성회원', type: 'male',   prefix: 'male',   label: '남성회원' },
  { dir: '업소회원', type: 'venue',  prefix: 'venue',  label: '업소회원' },
  { dir: '익명',     type: 'anon',   prefix: 'anon',   label: '익명' },
  { dir: '운영자',   type: 'admin',  prefix: 'admin',  label: '운영자' },
];

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

// 테두리: 검은 배경을 투명으로. 빛나는 고리라 밝기가 곧 불투명도다.
async function saveBorder(src, code) {
  for (const [size, suffix] of [[SIZE, ''], [THUMB, '-t']]) {
    const { data, info } = await sharp(src)
      .resize(size, size, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rgba = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const a = Math.max(r, g, b);          // 검은 곳은 0 → 완전히 투명
      rgba[j] = r; rgba[j + 1] = g; rgba[j + 2] = b; rgba[j + 3] = a;
    }
    await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT, `${code}${suffix}.png`));
  }
}

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

  // 2) 캐릭터
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

  // 3) 테두리
  const borderDir = path.join(srcRoot, '테두리');
  const borderFiles = listImages(borderDir);
  let etc = 0;
  for (const f of borderFiles) {
    const base = path.basename(f, path.extname(f));
    const known = BORDER_NAMES[base];
    const [slug, label] = known || [`etc${++etc}`, `테두리 ${etc}`];
    const code = `border-${slug}`;
    await saveBorder(path.join(borderDir, f), code);
    items.push({
      code, kind: 'border', memberType: null, name: label,
      file: `${code}.png`, thumb: `${code}-t.png`, sort: items.length,
    });
  }
  console.log(`  + 테두리: ${borderFiles.length}개`);

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(items, null, 2) + '\n');
  console.log(`\n총 ${items.length}개를 들여왔어요 → public/avatars/manifest.json`);
})().catch((e) => { console.error(e); process.exit(1); });
