#!/usr/bin/env node
// 테두리 그림만 바꿔 끼운다 (manifest 는 건드리지 않는다)
//
//   node scripts/import-borders.js <받은폴더>      # 받은폴더/테두리/*.png
//
// 왜 따로 있냐면:
// import-avatars.js 를 통째로 다시 돌리면 낱장 캐릭터(파일 이름이 UUID 다)의
// 정렬 순서가 달라져 male-01 이 다른 그림을 가리킬 수 있다. 그러면 이미 그
// 캐릭터를 쓰고 있던 회원의 얼굴이 바뀌어 버린다. 테두리만 고칠 때는 이걸 쓴다.
const fs = require('fs');
const path = require('path');

const { saveBorder, BORDER_NAMES, OUT, listImages } = require('./import-avatars');

const srcRoot = process.argv[2];
if (!srcRoot) {
  console.error('받은 이미지 폴더 경로를 넘겨주세요.\n  node scripts/import-borders.js <받은폴더>');
  process.exit(1);
}

(async () => {
  const dir = path.join(srcRoot, '테두리');
  const files = listImages(dir);
  if (files.length === 0) {
    console.error(`테두리 폴더에 그림이 없어요: ${dir}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
  const known = new Set(manifest.filter((i) => i.kind === 'border').map((i) => i.code));

  let n = 0;
  let etc = 0;
  for (const f of files) {
    const base = path.basename(f, path.extname(f));
    const [slug, label] = BORDER_NAMES[base] || [`etc${++etc}`, `테두리 ${etc}`];
    const code = `border-${slug}`;
    if (!known.has(code)) {
      console.log(`  - ${label}: manifest 에 없는 테두리라 건너뜁니다 (${code})`);
      continue;
    }
    const kept = await saveBorder(path.join(dir, f), code);
    console.log(`  + ${label} (${code})`
      + (kept ? ' — 받은 투명 배경 그대로' : ' — 검은 배경이라 밝기로 투명도 생성'));
    n++;
  }
  console.log(`\n테두리 ${n}개를 바꿔 끼웠어요. manifest 는 그대로입니다.`);
})().catch((e) => { console.error(e); process.exit(1); });
