// Vercel 서버리스 진입점 — 읽기전용 파일시스템이라 DB·업로드를 /tmp로 돌린다.
// (server.js는 require 시 데모 데이터를 시드하고, module로 불릴 땐 listen하지 않는다)
process.env.DB_PATH = process.env.DB_PATH || '/tmp/board.db';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/uploads';
module.exports = require('../server');
