// 업로드된 사진 다듬기
//
// 요즘 폰 사진은 4000px·5MB가 예사라, 그대로 두면
//  - 무료 서버의 저장공간이 금방 차고
//  - 모바일에서 글 하나 여는 데 수 MB를 내려받게 되고
//  - 사진에 박힌 촬영 위치(GPS)가 그대로 공개된다.
// 그래서 올라온 사진은 화면에 필요한 크기로 줄이고, 부가정보는 떼어낸 뒤 저장한다.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MAX_EDGE = 1600;   // 긴 변 기준 (본문 최대 폭의 2배 — 고해상도 화면까지 충분)
const JPEG_QUALITY = 82; // 눈으로 차이를 느끼기 어려운 선

// 파일명에 쓸 확장자 (입력 형식을 그대로 유지 — 스크린샷 PNG를 JPEG로 바꾸면 글자가 뭉갠다)
function extFor(mimetype) {
  return mimetype === 'image/png' ? '.png' : '.jpg';
}

// 원본 버퍼를 다듬어 파일로 저장하고, 어떻게 바뀌었는지 돌려준다
async function saveProcessed(buffer, destPath, mimetype) {
  const before = buffer.length;
  // rotate(): 폰이 기록한 회전 정보를 실제 픽셀에 적용한다.
  //           이걸 안 하면 부가정보를 떼는 순간 사진이 옆으로 눕는다.
  let img = sharp(buffer, { failOn: 'error' })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });

  img = mimetype === 'image/png'
    ? img.png({ compressionLevel: 9, palette: true })
    : img.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });

  // sharp는 기본적으로 부가정보(EXIF·GPS 등)를 결과에 싣지 않는다
  const out = await img.toBuffer();
  await fs.promises.writeFile(destPath, out);

  const meta = await sharp(out).metadata();
  return { before, after: out.length, width: meta.width, height: meta.height };
}

// 저장 경로를 만들어 처리까지 한 번에
async function storeUpload(buffer, uploadDir, mimetype, makeName) {
  const filename = makeName(extFor(mimetype));
  const dest = path.join(uploadDir, filename);
  const info = await saveProcessed(buffer, dest, mimetype);
  return { filename, ...info };
}

module.exports = { storeUpload, saveProcessed, extFor, MAX_EDGE, JPEG_QUALITY };
