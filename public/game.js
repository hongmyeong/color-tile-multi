// 서버·클라이언트 공용 게임 로직 (같은 시드 → 같은 판)
(function (exp) {
  const W = 23, H = 15, TILES = 200; // 15x23=345칸, 타일 200개 = 최대 200점
  function rng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeBoard(seed, n) {
    const r = rng(seed), cells = [];
    for (let i = 0; i < W * H; i++) cells.push(i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const b = Array.from({ length: H }, () => Array(W).fill(-1));
    // 같은 색을 짝수 개씩 배치해서 전부 제거 가능하게 함
    for (let k = 0; k < TILES; k += 2) {
      const c = Math.floor(r() * n);
      for (const cell of [cells[k], cells[k + 1]]) b[Math.floor(cell / W)][cell % W] = c;
    }
    return b;
  }
  // 빈 칸이 아니면 null, 아니면 제거된 타일 목록(비어 있으면 감점 대상)
  function applyClick(b, y, x) {
    if (b[y][x] >= 0) return null;
    const f = [], c = {};
    for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let j = y + dy, i = x + dx;
      while (j >= 0 && j < H && i >= 0 && i < W) {
        if (b[j][i] >= 0) { f.push([j, i]); c[b[j][i]] = (c[b[j][i]] || 0) + 1; break; }
        j += dy; i += dx;
      }
    }
    const rem = f.filter(([j, i]) => c[b[j][i]] > 1);
    rem.forEach(([j, i]) => (b[j][i] = -1));
    return rem;
  }
  exp.W = W; exp.H = H; exp.makeBoard = makeBoard; exp.applyClick = applyClick;
})(typeof module !== "undefined" ? module.exports : (window.Game = {}));
