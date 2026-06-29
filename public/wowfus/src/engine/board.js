// =============================================================================
//  IsoForge — board model + grid pathfinding (Dofus-style, 4-directional).
//  Pure data/logic, no THREE. Cells are a square grid; the iso camera draws the
//  diamonds. cells[j][i] with i = column (x), j = row (z).
// =============================================================================

export function makeBoard(N) {
  const cells = [];
  for (let j = 0; j < N; j++) {
    cells.push([]);
    for (let i = 0; i < N; i++) cells[j].push({ walkable: true, occupant: null });
  }
  const inBounds = (i, j) => i >= 0 && i < N && j >= 0 && j < N;
  return {
    N,
    cells,
    inBounds,
    cell: (i, j) => (inBounds(i, j) ? cells[j][i] : null),
    // A cell you can STAND on / move through (in bounds, walkable, not occupied).
    free: (i, j) => inBounds(i, j) && cells[j][i].walkable && !cells[j][i].occupant,
    setObstacle: (i, j) => { if (inBounds(i, j)) cells[j][i].walkable = false; },
    setOccupant: (i, j, who) => { if (inBounds(i, j)) cells[j][i].occupant = who; },
  };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// BFS distances from (si,sj) over FREE cells, up to maxDist. The start cell's own
// occupant is ignored (you stand on it). Returns { dist[j][i], reachable: [[i,j,d]] }.
export function bfs(board, si, sj, maxDist) {
  const N = board.N;
  const dist = Array.from({ length: N }, () => new Array(N).fill(-1));
  dist[sj][si] = 0;
  const reachable = [];
  const q = [[si, sj]];
  let head = 0;
  while (head < q.length) {
    const [i, j] = q[head++];
    const d = dist[j][i];
    if (d > 0) reachable.push([i, j, d]);
    if (d >= maxDist) continue;
    for (const [di, dj] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || ni >= N || nj < 0 || nj >= N) continue;
      if (dist[nj][ni] !== -1) continue;
      if (!board.free(ni, nj)) continue;
      dist[nj][ni] = d + 1;
      q.push([ni, nj]);
    }
  }
  return { dist, reachable };
}

// Shortest path (array of [i,j], excluding the start) to (gi,gj) within maxDist,
// or null if unreachable. Backtracks a precomputed BFS distance field.
export function findPath(board, si, sj, gi, gj, maxDist) {
  if (si === gi && sj === gj) return null;
  const { dist } = bfs(board, si, sj, maxDist);
  if (!board.inBounds(gi, gj) || dist[gj][gi] < 1) return null;
  const path = [];
  let ci = gi, cj = gj;
  let safety = 0;
  while (!(ci === si && cj === sj) && safety++ < 10000) {
    path.push([ci, cj]);
    const d = dist[cj][ci];
    let stepped = false;
    for (const [di, dj] of DIRS) {
      const ni = ci + di, nj = cj + dj;
      if (board.inBounds(ni, nj) && dist[nj][ni] === d - 1) {
        ci = ni; cj = nj; stepped = true; break;
      }
    }
    if (!stepped) return null;
  }
  path.reverse();
  return path;
}

// Manhattan distance (combat range checks use this on a 4-dir grid).
export function manhattan(ai, aj, bi, bj) {
  return Math.abs(ai - bi) + Math.abs(aj - bj);
}
