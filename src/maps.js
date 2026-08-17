export const TILE = 32;

/**
 * Legend used by the ASCII level maps.
 *   #  廟牆 (solid wall)      T  供桌／攤位 (solid stall)
 *   L  燈籠柱 (solid pillar)  o  香爐 (solid, round)
 *   .  石板地                 ,  磚地 (decor variant)
 *   G  廟門 (exit gate)       P  玩家起點
 *   1-4 敵方湧出點 (spawn gates, numbered so waves can pick sides)
 */
const SOLID = new Set(["#", "T", "L", "o"]);

export function isSolidChar(ch) {
  return SOLID.has(ch);
}

export function parseMap(rows) {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const grid = [];
  const spawns = [];
  const gateTiles = [];
  let start = null;

  for (let row = 0; row < height; row += 1) {
    const line = rows[row].padEnd(width, "#");
    const cells = [];
    for (let col = 0; col < width; col += 1) {
      const ch = line[col];
      const centre = { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2, col, row };
      if (ch === "P") start = centre;
      else if (ch === "G") gateTiles.push(centre);
      else if (ch >= "1" && ch <= "9") spawns.push({ ...centre, group: Number(ch) });
      cells.push(ch);
    }
    grid.push(cells);
  }

  if (!start) throw new Error("map is missing a player start 'P'");
  if (gateTiles.length === 0) throw new Error("map is missing an exit gate 'G'");
  if (spawns.length === 0) throw new Error("map is missing enemy spawn points '1'-'9'");

  // A 廟門 may be several tiles wide; aim the trigger at its middle.
  const gate = {
    x: gateTiles.reduce((sum, tile) => sum + tile.x, 0) / gateTiles.length,
    y: gateTiles.reduce((sum, tile) => sum + tile.y, 0) / gateTiles.length,
    col: gateTiles[0].col,
    row: gateTiles[0].row,
    tiles: gateTiles,
  };

  return { width, height, grid, spawns, start, gate };
}

export function tileAt(map, col, row) {
  if (col < 0 || row < 0 || row >= map.height || col >= map.width) return "#";
  return map.grid[row][col];
}

export function isSolidTile(map, col, row) {
  return isSolidChar(tileAt(map, col, row));
}

export function isBlocked(map, x, y) {
  return isSolidTile(map, Math.floor(x / TILE), Math.floor(y / TILE));
}

const EPSILON = 0.01;

function columnBlocked(map, col, row0, row1) {
  for (let row = row0; row <= row1; row += 1) {
    if (isSolidTile(map, col, row)) return true;
  }
  return false;
}

function rowBlocked(map, row, col0, col1) {
  for (let col = col0; col <= col1; col += 1) {
    if (isSolidTile(map, col, row)) return true;
  }
  return false;
}

/**
 * Axis-separated tile collision: the entity is treated as a square of side
 * `2 * radius`, X is resolved before Y so walking into a wall still slides
 * along it. Returns the new position plus which axes were blocked.
 */
export function moveCircle(map, x, y, dx, dy, radius) {
  let nx = x;
  let ny = y;
  let hitX = false;
  let hitY = false;

  if (dx !== 0) {
    const target = nx + dx;
    const row0 = Math.floor((ny - radius) / TILE);
    const row1 = Math.floor((ny + radius) / TILE);
    if (dx > 0) {
      const from = Math.floor((nx + radius) / TILE);
      const to = Math.floor((target + radius) / TILE);
      let stop = null;
      for (let col = from + 1; col <= to && stop === null; col += 1) {
        if (columnBlocked(map, col, row0, row1)) stop = col;
      }
      nx = stop === null ? target : stop * TILE - radius - EPSILON;
      hitX = stop !== null;
    } else {
      const from = Math.floor((nx - radius) / TILE);
      const to = Math.floor((target - radius) / TILE);
      let stop = null;
      for (let col = from - 1; col >= to && stop === null; col -= 1) {
        if (columnBlocked(map, col, row0, row1)) stop = col;
      }
      nx = stop === null ? target : (stop + 1) * TILE + radius + EPSILON;
      hitX = stop !== null;
    }
  }

  if (dy !== 0) {
    const target = ny + dy;
    const col0 = Math.floor((nx - radius) / TILE);
    const col1 = Math.floor((nx + radius) / TILE);
    if (dy > 0) {
      const from = Math.floor((ny + radius) / TILE);
      const to = Math.floor((target + radius) / TILE);
      let stop = null;
      for (let row = from + 1; row <= to && stop === null; row += 1) {
        if (rowBlocked(map, row, col0, col1)) stop = row;
      }
      ny = stop === null ? target : stop * TILE - radius - EPSILON;
      hitY = stop !== null;
    } else {
      const from = Math.floor((ny - radius) / TILE);
      const to = Math.floor((target - radius) / TILE);
      let stop = null;
      for (let row = from - 1; row >= to && stop === null; row -= 1) {
        if (rowBlocked(map, row, col0, col1)) stop = row;
      }
      ny = stop === null ? target : (stop + 1) * TILE + radius + EPSILON;
      hitY = stop !== null;
    }
  }

  return { x: nx, y: ny, hitX, hitY };
}

/** Straight-line visibility between two world points (used by enemy AI). */
export function hasLineOfSight(map, ax, ay, bx, by, step = TILE / 3) {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (isBlocked(map, ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Breadth-first tile distances to a world point. The 廟口 is full of 香爐 and
 * 供桌, and neither the 鬼 nor a bot can chase through them on a straight line —
 * a flow field is small enough (a few hundred tiles) to rebuild every frame and
 * removes wedging entirely.
 */
export function buildFlowField(map, targetX, targetY, reuse = null) {
  const width = map.width;
  const height = map.height;
  const size = width * height;
  const dist = reuse?.dist?.length === size ? reuse.dist : new Int32Array(size);
  const queue = reuse?.queue?.length === size ? reuse.queue : new Int32Array(size);
  dist.fill(-1);

  const col = Math.min(width - 1, Math.max(0, Math.floor(targetX / TILE)));
  const row = Math.min(height - 1, Math.max(0, Math.floor(targetY / TILE)));
  let head = 0;
  let tail = 0;
  if (!isSolidTile(map, col, row)) {
    const index = row * width + col;
    dist[index] = 0;
    queue[tail] = index;
    tail += 1;
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const c = index % width;
    const r = (index - c) / width;
    const next = dist[index] + 1;
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= width || nr >= height) continue;
      const ni = nr * width + nc;
      if (dist[ni] !== -1 || isSolidTile(map, nc, nr)) continue;
      dist[ni] = next;
      queue[tail] = ni;
      tail += 1;
    }
  }

  return { width, height, dist, queue, targetX, targetY };
}

/**
 * Unit vector along the flow field, aimed at the centre of the next tile so
 * movement stays smooth. `null` means "no useful hint": already on the target
 * tile, off-map, or walled off — callers fall back to a straight line.
 */
export function flowDirection(field, x, y) {
  const col = Math.floor(x / TILE);
  const row = Math.floor(y / TILE);
  if (col < 0 || row < 0 || col >= field.width || row >= field.height) return null;
  const here = field.dist[row * field.width + col];
  if (here <= 0) return null;

  let best = here;
  let bestCol = col;
  let bestRow = row;
  for (const [dc, dr] of NEIGHBOURS) {
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nr < 0 || nc >= field.width || nr >= field.height) continue;
    const d = field.dist[nr * field.width + nc];
    if (d !== -1 && d < best) {
      best = d;
      bestCol = nc;
      bestRow = nr;
    }
  }
  if (bestCol === col && bestRow === row) return null;

  const dx = bestCol * TILE + TILE / 2 - x;
  const dy = bestRow * TILE + TILE / 2 - y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export function mapPixelSize(map) {
  return { width: map.width * TILE, height: map.height * TILE };
}
