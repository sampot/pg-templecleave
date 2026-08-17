import { TILE, mapPixelSize } from "./maps.js";
import { clamp } from "./geometry.js";

export const SHEET_COLUMNS = 10;
export const SPRITE_SIZE = 16;
export const PLAYER_SPRITE = 18;

/** Source rect for a tile index in assets/sprites/creatures.png. */
export function spriteRect(index) {
  const col = index % SHEET_COLUMNS;
  const row = Math.floor(index / SHEET_COLUMNS);
  return { sx: col * SPRITE_SIZE, sy: row * SPRITE_SIZE, sw: SPRITE_SIZE, sh: SPRITE_SIZE };
}

export function zoomFor(viewWidth, viewHeight) {
  return clamp(Math.min(viewWidth / 420, viewHeight / 620), 0.75, 2.2);
}

/** Cap the backing store so a huge desktop window cannot melt the GPU budget. */
export const MAX_CANVAS_PIXELS = 2_600_000;

export function backingScale(cssWidth, cssHeight, devicePixelRatio = 1) {
  const capped = Math.min(devicePixelRatio || 1, 2);
  const area = cssWidth * cssHeight * capped * capped;
  if (area <= MAX_CANVAS_PIXELS) return capped;
  return Math.max(1, capped * Math.sqrt(MAX_CANVAS_PIXELS / area));
}

/** Camera top-left in world units, clamped so the view never leaves the map. */
export function computeCamera(map, focus, viewWidth, viewHeight) {
  const { width, height } = mapPixelSize(map);
  const halfW = viewWidth / 2;
  const halfH = viewHeight / 2;
  const x = viewWidth >= width ? (width - viewWidth) / 2 : clamp(focus.x - halfW, 0, width - viewWidth);
  const y = viewHeight >= height ? (height - viewHeight) / 2 : clamp(focus.y - halfH, 0, height - viewHeight);
  return { x, y, width: viewWidth, height: viewHeight };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

const FLOOR = "#2b2420";
const FLOOR_ALT = "#332a24";
const BRICK = "#4a2f26";
const WALL = "#5d211c";
const WALL_TOP = "#7c2f26";
const STALL = "#6a4324";
const PILLAR = "#8d2b22";

function drawStaticMap(map) {
  const { width, height } = mapPixelSize(map);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  for (let row = 0; row < map.height; row += 1) {
    for (let col = 0; col < map.width; col += 1) {
      const ch = map.grid[row][col];
      const x = col * TILE;
      const y = row * TILE;
      const checker = (col + row) % 2 === 0;
      ctx.fillStyle = ch === "," ? BRICK : checker ? FLOOR : FLOOR_ALT;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);

      if (ch === "#") {
        ctx.fillStyle = WALL;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = WALL_TOP;
        ctx.fillRect(x, y, TILE, 7);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(x, y + TILE - 5, TILE, 5);
      } else if (ch === "T") {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(x + 2, y + 6, TILE - 4, TILE - 6);
        ctx.fillStyle = STALL;
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 8);
        ctx.fillStyle = "#c2452f";
        ctx.fillRect(x + 2, y + 2, TILE - 4, 6);
      } else if (ch === "L") {
        ctx.fillStyle = "#3d1d18";
        ctx.fillRect(x + 10, y + 4, 12, TILE - 4);
        ctx.fillStyle = PILLAR;
        ctx.beginPath();
        ctx.ellipse(x + 16, y + 15, 10, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffcf6b";
        ctx.fillRect(x + 13, y + 12, 6, 6);
      } else if (ch === "o") {
        ctx.fillStyle = "#5a4a2c";
        ctx.beginPath();
        ctx.ellipse(x + 16, y + 20, 12, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8a7238";
        ctx.fillRect(x + 8, y + 10, 16, 8);
      }
    }
  }
  return canvas;
}

export function createRenderer(canvas, images) {
  const ctx = canvas.getContext("2d");
  let mapCanvas = null;
  let mapKey = null;
  let shake = 0;

  function setMap(map, key) {
    if (mapKey === key && mapCanvas) return;
    mapCanvas = drawStaticMap(map);
    mapKey = key;
  }

  function addShake(amount) {
    shake = Math.min(12, shake + amount);
  }

  function drawSprite(index, x, y, size, flip = false, tint = 0) {
    const sheet = images.creatures;
    if (!sheet) return;
    const { sx, sy, sw, sh } = spriteRect(index);
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(sheet, sx, sy, sw, sh, -size / 2, -size / 2, size, size);
    if (tint > 0) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = `rgba(255,120,90,${Math.min(0.75, tint)})`;
      ctx.fillRect(-size / 2, -size / 2, size, size);
    }
    ctx.restore();
  }

  function drawShadow(x, y, r) {
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.78, r * 0.9, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHealthBar(x, y, width, ratio, color = "#ff5f52") {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - width / 2, y, width, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, y, width * clamp(ratio, 0, 1), 4);
  }

  function drawEffects(game, layer) {
    for (const fx of game.effects) {
      const t = 1 - fx.ttl / fx.life;
      if (layer === "ground" && fx.kind === "slam") {
        ctx.strokeStyle = `rgba(255,120,60,${1 - t})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.radius * (0.4 + t * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (layer === "ground" && fx.kind === "spawn") {
        ctx.strokeStyle = `rgba(150,120,255,${1 - t})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 6 + t * 20, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (layer !== "air") continue;
      if (fx.kind === "arc") {
        ctx.save();
        ctx.translate(fx.x, fx.y);
        ctx.rotate(fx.facing);
        const grad = ctx.createRadialGradient(0, 0, 6, 0, 0, fx.range);
        grad.addColorStop(0, `rgba(255,255,255,${0.5 * (1 - t)})`);
        grad.addColorStop(1, `rgba(255,190,120,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, fx.range, -fx.halfAngle + t * 0.5, fx.halfAngle + t * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (fx.kind === "whirl") {
        ctx.strokeStyle = `rgba(255,236,170,${0.85 * (1 - t)})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.radius * (0.55 + t * 0.45), 0, Math.PI * 2);
        ctx.stroke();
      } else if (fx.kind === "blast") {
        ctx.fillStyle = `rgba(255,150,60,${0.55 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, fx.radius * (0.5 + t * 0.7), 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === "spark") {
        ctx.fillStyle = `rgba(255,230,150,${1 - t})`;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 4 + t * 8, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === "poof") {
        ctx.fillStyle = `rgba(190,190,210,${0.5 * (1 - t)})`;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 8 + t * 16, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === "dash") {
        ctx.strokeStyle = `rgba(200,230,255,${0.6 * (1 - t)})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(fx.x, fx.y);
        ctx.lineTo(fx.x - Math.cos(fx.facing) * 40, fx.y - Math.sin(fx.facing) * 40);
        ctx.stroke();
      } else if (fx.kind === "text") {
        ctx.fillStyle = fx.color;
        ctx.font = "14px 'Cubic 11', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.globalAlpha = 1 - t;
        ctx.fillText(fx.text, fx.x, fx.y - t * 22);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawGate(game) {
    const gate = game.map.gate;
    const pulse = 0.5 + Math.sin(game.time * 4) * 0.5;
    ctx.fillStyle = game.gateOpen ? `rgba(255,206,92,${0.35 + pulse * 0.4})` : "rgba(60,40,40,0.75)";
    ctx.fillRect(gate.x - TILE, gate.y - TILE / 2, TILE * 2, TILE);
    if (game.gateOpen && images.structure_gate) {
      ctx.drawImage(images.structure_gate, gate.x - 14, gate.y - 14, 28, 28);
    }
  }

  function draw(game, dt = 0) {
    const cssW = canvas.clientWidth || 390;
    const cssH = canvas.clientHeight || 640;
    const dpr = backingScale(cssW, cssH, globalThis.devicePixelRatio || 1);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const zoom = zoomFor(cssW, cssH);
    const viewW = cssW / zoom;
    const viewH = cssH / zoom;
    const cam = computeCamera(game.map, game.player, viewW, viewH);

    shake = Math.max(0, shake - dt * 30);
    const sx = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;
    const sy = shake > 0 ? (Math.random() * 2 - 1) * shake : 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#140f0e";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x + sx, -cam.y + sy);

    if (mapCanvas) ctx.drawImage(mapCanvas, 0, 0);
    drawGate(game);
    drawEffects(game, "ground");

    for (const drop of game.drops) {
      const bob = Math.sin(game.time * 5 + drop.bob) * 3;
      drawShadow(drop.x, drop.y + 4, 8);
      const icon = images[iconForItem(drop.item)];
      const fade = drop.ttl < 4 ? 0.35 + 0.65 * Math.abs(Math.sin(drop.ttl * 6)) : 1;
      ctx.globalAlpha = fade;
      if (icon) ctx.drawImage(icon, drop.x - 11, drop.y - 11 + bob, 22, 22);
      else {
        ctx.fillStyle = "#ffd479";
        ctx.fillRect(drop.x - 6, drop.y - 6 + bob, 12, 12);
      }
      ctx.globalAlpha = 1;
    }

    for (const p of game.projectiles) {
      const colour = p.owner === "player" ? "#ffb347" : p.kind === "water" ? "#6fc6ff" : "#c78bff";
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const ordered = [...game.enemies].sort((a, b) => a.y - b.y);
    for (const enemy of ordered) {
      drawShadow(enemy.x, enemy.y, enemy.radius);
      const size = enemy.radius * 2.6;
      drawSprite(enemy.sprite, enemy.x, enemy.y - 2, size, enemy.facing < 0, enemy.hurtFlash * 4);
      if (enemy.windUp > 0) {
        ctx.strokeStyle = "rgba(255,90,60,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (enemy.hp < enemy.maxHp && !enemy.boss) {
        drawHealthBar(enemy.x, enemy.y - enemy.radius - 12, enemy.radius * 2.2, enemy.hp / enemy.maxHp);
      }
    }

    const player = game.player;
    if (player.alive) {
      drawShadow(player.x, player.y, player.radius);
      if (player.invuln > 0 && Math.floor(player.invuln * 20) % 2 === 0) ctx.globalAlpha = 0.5;
      drawSprite(PLAYER_SPRITE, player.x, player.y - 2, player.radius * 2.8, Math.cos(player.facing) < 0, player.hurtFlash * 3);
      ctx.globalAlpha = 1;
    }

    drawEffects(game, "air");
    ctx.restore();
    return { zoom, cam };
  }

  return { setMap, draw, addShake };
}

export function iconForItem(item) {
  if (!item) return "sword";
  if (item.slot === "weapon") return "sword";
  if (item.slot === "armor") return "shield";
  if (item.slot === "charm") return "fire";
  return "suit_hearts";
}
