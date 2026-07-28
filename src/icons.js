// 커스텀 SVG 아이콘 세트 (stroke 기반, currentColor로 색 상속)
// 이모지 대신 일관된 라인 아이콘을 써서 통일감 있는 UI를 만든다.
const PATHS = {
  home: '<path d="M3 10.2 12 3l9 7.2"/><path d="M5.5 9.5V20h13V9.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M8 3v4M16 3v4"/><path d="M8.5 15l2.2 2.2L15.5 13"/>',
  pencil: '<path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 5H4v1.5A3.5 3.5 0 0 0 7 10M17 5h3v1.5A3.5 3.5 0 0 1 17 10"/><path d="M9.5 13h5l-.5 3h-4z"/><path d="M8 20h8"/><path d="M12 16v4"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5"/>',
  bell: '<path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 4.5 2 6 2 6H4.5s2-1.5 2-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  like: '<path d="M7 10.5 11 3a2 2 0 0 1 2.8 2.4L13 10h5.2a2 2 0 0 1 2 2.5l-1.7 6A2 2 0 0 1 16.6 20H7z"/><path d="M7 10.5V20H4.5a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1z"/>',
  comment: '<path d="M20.5 11.5a7.5 7.5 0 0 1-10.8 6.7L4 20l1.8-5.2A7.5 7.5 0 1 1 20.5 11.5z"/>',
  bookmark: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-3.7L5.5 20.5v-16a1 1 0 0 1 1-1z"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  arrowUp: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20.5 20.5 16 16"/>',
  report: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  logout: '<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M9 12h11"/><path d="M16 8l4 4-4 4"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M20 16l-4.5-4.5L6 20"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.5a3 3 0 0 0-2.5-1.2c-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2a3 3 0 0 1-2.5-1.2"/><path d="M12 6.5v11"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  // 점 3개(더보기) — 선 아이콘 세트라 아주 짧은 선에 둥근 끝을 줘서 점처럼 보이게 한다
  more: '<path d="M12 5.5h.01"/><path d="M12 12h.01"/><path d="M12 18.5h.01"/>',
};

function icon(name, size = 20) {
  const p = PATHS[name];
  if (!p) return '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" `
    + `aria-hidden="true">${p}</svg>`;
}

module.exports = { icon };
