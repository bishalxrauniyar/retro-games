/* tetris.js — Tetris. Built on the shared Arcade engine. */
(function () {
  "use strict";

  var W = 160, H = 144;
  var C = Arcade.palette;

  /* --- Board geometry --------------------------------------------------
     10 x 18 well at 5px cells = 50 x 90. Left column holds the well plus a
     level bar; the right column is a 94px side panel for the stats, the hold
     slot and the next queue. 10 + 52 + 2 + 94 + 2 = 160.                 */
  var COLS = 10, ROWS = 18, CELL = 5;
  var WELL_X = 11, WELL_Y = 19;
  var PANEL_X = 64, PANEL_Y = 2, PANEL_W = 94, PANEL_H = 140;

  /* --- Tuning ---------------------------------------------------------- */
  var MAX_LEVEL = 20;
  var LOCK_DELAY = 0.4;   /* grace window once the piece is grounded */
  var MAX_RESETS = 8;     /* how often that window may be refreshed */
  var DAS = 0.16;         /* delay before auto-shift kicks in */
  var ARR = 0.045;        /* auto-shift repeat rate */
  var SOFT_STEP = 0.035;  /* soft drop cell rate */
  var CLEAR_TIME = 0.36;  /* line clear freeze */
  var LOCK_FLASH = 0.13;  /* NES style lock flash */
  var GRACE = 0.2;        /* no input accepted right after a spawn */
  var MOVE_SFX = 0.06;

  /* Seconds per row, NES style. Level 1 gives a full second of thinking
     time; by level 20 a row lands every 44ms. */
  var GRAVITY = [
    0.80, 0.72, 0.63, 0.55, 0.47, 0.38, 0.30, 0.22, 0.13, 0.10,
    0.083, 0.083, 0.083, 0.067, 0.067, 0.067, 0.056, 0.056, 0.056, 0.044,
    0.044
  ];
  var LINE_SCORE = [0, 100, 300, 500, 800];

  /* --- Pieces ----------------------------------------------------------
     One palette colour per tetromino, stored as a 4x4 matrix of colour
     keys (O is 2x2). Rotation is precomputed at load time. */
  var TYPES = ["I", "J", "L", "O", "S", "T", "Z"];
  var COLOUR = {
    I: C.cyan, J: C.blue, L: C.orange, O: C.amber,
    S: C.lime, T: C.purple, Z: C.red
  };
  var BASE = {
    I: ["....", "IIII", "....", "...."],
    J: ["J...", "JJJ.", "....", "...."],
    L: ["...L", "LLL.", "....", "...."],
    O: ["OO", "OO"],
    S: [".SS.", "SS..", "....", "...."],
    T: [".T..", "TTT.", "....", "...."],
    Z: ["ZZ..", ".ZZ.", "....", "...."]
  };
  /* Wall kick order: no offset, then sideways, then a small vertical nudge. */
  var KICKS = [
    [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0],
    [0, -1], [-1, -1], [1, -1], [0, -2]
  ];

  var SHAPES = {};
  var MINI = {};
  var TYPES_N = TYPES.length;
  for (var ti = 0; ti < TYPES_N; ti++) {
    var id = TYPES[ti];
    var mats = [toGrid(BASE[id])];
    for (var r = 1; r < 4; r++) mats.push(rotate(mats[r - 1]));
    SHAPES[id] = mats;
    MINI[id] = trimCells(cellsOf(mats[0]));
  }

  function toGrid(rows) {
    var out = [];
    for (var r = 0; r < rows.length; r++) {
      var line = [];
      for (var c = 0; c < rows[r].length; c++) {
        var ch = rows[r].charAt(c);
        line.push(ch === "." ? null : ch);
      }
      out.push(line);
    }
    return out;
  }

  function rotate(m) {
    var n = m.length, out = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) row.push(m[n - 1 - c][r]);
      out.push(row);
    }
    return out;
  }

  /* Filled cells of a matrix as [row, col] pairs. */
  function cellsOf(m) {
    var out = [];
    for (var r = 0; r < m.length; r++) {
      for (var c = 0; c < m[r].length; c++) if (m[r][c]) out.push([r, c]);
    }
    return out;
  }

  /* Same, but cropped to the bounding box so previews centre nicely. */
  function trimCells(cells) {
    var minR = 99, maxR = -1, minC = 99, maxC = -1, i, p;
    for (i = 0; i < cells.length; i++) {
      p = cells[i];
      if (p[0] < minR) minR = p[0];
      if (p[0] > maxR) maxR = p[0];
      if (p[1] < minC) minC = p[1];
      if (p[1] > maxC) maxC = p[1];
    }
    var h = maxR - minR + 1, w = maxC - minC + 1, out = [];
    for (i = 0; i < cells.length; i++) out.push([cells[i][0] - minR, cells[i][1] - minC]);
    return { cells: out, w: w, h: h };
  }

  /* --- DOM ------------------------------------------------------------- */
  var canvas = document.getElementById("game");
  var statusEl = document.getElementById("status");
  var scoreEl = document.getElementById("sScore");
  var levelEl = document.getElementById("sLevel");
  var linesEl = document.getElementById("sLines");
  var bestEl = document.getElementById("sBest");
  var startBtn = document.getElementById("start");
  var holdBtn = document.getElementById("hold");
  var soundBtn = document.getElementById("sound");
  var screenEl = document.getElementById("screen");

  /* --- State ----------------------------------------------------------- */
  var grid, piece, held, heldUsed, bag, queue;
  var level, lines, phase, clearing;
  var dropT, softT, dasT, arrT, dasDir, lockT, lockResets, grounded;
  var lockFlashT, lockFlashMap, graceT, moveSfxT, holdQueued, lastGain;

  /* Fast taps on the on-screen left/right/down buttons can go down and back
     up inside a single frame, so g.held() never sees them. Latch them here
     and let update() consume one move per tap; g.axisX() still handles
     hold-to-repeat after that. */
  var padTaps = [];

  function blankRow() {
    var row = [];
    for (var c = 0; c < COLS; c++) row.push(null);
    return row;
  }

  function blankWell() {
    var b = [];
    for (var r = 0; r < ROWS; r++) b.push(blankRow());
    return b;
  }

  function refillBag() {
    var b = TYPES.slice();
    for (var i = b.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = b[i]; b[i] = b[j]; b[j] = t;
    }
    return b;
  }

  function drawFromBag() {
    if (!bag.length) bag = refillBag();
    return bag.shift();
  }

  function fillQueue() {
    while (queue.length < 3) queue.push(drawFromBag());
  }

  function newGame(playing) {
    grid = blankWell();
    piece = null;
    held = null;
    heldUsed = false;
    bag = [];
    queue = [];
    fillQueue();
    level = 1;
    lines = 0;
    phase = "play";
    clearing = null;
    dropT = 0; softT = 0; dasT = 0; arrT = 0; dasDir = 0;
    lockT = 0; lockResets = 0; grounded = false;
    lockFlashT = 0;
    lockFlashMap = {};
    graceT = GRACE;
    holdQueued = false;
    lastGain = 0;
    spawnNext();
    if (playing) {
      statusEl.textContent = "Level 1. Fill a row to clear it.";
      statusEl.className = "status status--play";
    } else {
      statusEl.textContent = "Press Enter or tap Start to play";
      statusEl.className = "status status--info";
    }
  }

  function dropInterval() {
    return GRAVITY[Math.min(GRAVITY.length - 1, level - 1)];
  }

  /* --- Collision ------------------------------------------------------- */
  function collides(bd, mx, my, m) {
    for (var r = 0; r < m.length; r++) {
      for (var c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        var y = my + r, x = mx + c;
        if (x < 0 || x >= COLS || y >= ROWS) return true;
        if (y >= 0 && bd[y][x]) return true;
      }
    }
    return false;
  }

  function spawnX(type) {
    var m = SHAPES[type][0];
    return Math.floor((COLS - m[0].length) / 2);
  }

  function spawnPiece(type, keepHold) {
    piece = { type: type, rot: 0, x: spawnX(type), y: 0 };
    dropT = 0; softT = 0; dasT = 0; arrT = 0; dasDir = 0;
    lockT = 0; lockResets = 0; grounded = false;
    if (!keepHold) heldUsed = false;
    if (collides(grid, piece.x, piece.y, SHAPES[piece.type][0])) {
      gameOver();
      return false;
    }
    return true;
  }

  function spawnNext() {
    var type = queue.shift();
    fillQueue();
    return spawnPiece(type, false);
  }

  /* --- Piece actions --------------------------------------------------- */
  function moved() {
    if (grounded && lockResets < MAX_RESETS) {
      lockResets++;
      lockT = 0;
    }
  }

  function shift(dx) {
    if (!piece || phase !== "play") return false;
    var m = SHAPES[piece.type][piece.rot];
    if (collides(grid, piece.x + dx, piece.y, m)) return false;
    piece.x += dx;
    moved();
    return true;
  }

  function spin() {
    if (!piece || phase !== "play") return false;
    var next = (piece.rot + 1) % 4;
    for (var k = 0; k < KICKS.length; k++) {
      var nx = piece.x + KICKS[k][0], ny = piece.y + KICKS[k][1];
      if (!collides(grid, nx, ny, SHAPES[piece.type][next])) {
        piece.rot = next; piece.x = nx; piece.y = ny;
        moved();
        return true;
      }
    }
    return false;
  }

  function stepDown(award) {
    if (!piece || phase !== "play") return false;
    if (collides(grid, piece.x, piece.y + 1, SHAPES[piece.type][piece.rot])) return false;
    piece.y++;
    if (award) g.addScore(1);
    return true;
  }

  function ghostY() {
    var m = SHAPES[piece.type][piece.rot];
    var y = piece.y;
    while (!collides(grid, piece.x, y + 1, m)) y++;
    return y;
  }

  function hardDrop() {
    if (!piece || phase !== "play") return;
    var cells = 0, m = SHAPES[piece.type][piece.rot];
    while (!collides(grid, piece.x, piece.y + 1, m)) { piece.y++; cells++; }
    if (cells > 0) g.addScore(cells * 2);
    g.sound.cue("place");
    lockPiece();
  }

  function doHold() {
    if (!piece || heldUsed || phase !== "play") return;
    var cur = piece.type, swap = held;
    held = cur;
    heldUsed = true;
    g.sound.cue("select");
    if (swap) {
      spawnPiece(swap, true);
    } else {
      var type = queue.shift();
      fillQueue();
      spawnPiece(type, true);
    }
  }

  function rowFull(r) {
    for (var c = 0; c < COLS; c++) if (!grid[r][c]) return false;
    return true;
  }

  function lockPiece() {
    var m = SHAPES[piece.type][piece.rot];
    var cells = cellsOf(m);
    var colour = COLOUR[piece.type];
    var topped = false;
    for (var i = 0; i < cells.length; i++) {
      var y = piece.y + cells[i][0], x = piece.x + cells[i][1];
      if (y < 0) { topped = true; continue; }
      grid[y][x] = colour;
      lockFlashMap[y + "," + x] = true;
    }
    lockFlashT = LOCK_FLASH;
    piece = null;
    grounded = false;
    g.sound.cue("lock");
    if (topped) { gameOver(); return; }

    var full = [];
    for (var r = 0; r < ROWS; r++) if (rowFull(r)) full.push(r);
    if (full.length) { beginClear(full); return; }
    spawnNext();
  }

  function beginClear(rows) {
    phase = "clear";
    clearing = { rows: rows, t: 0 };
    g.sound.cue("clear");
    g.flash(C.white, 70);
    g.shake(rows.length >= 4 ? 3 : 1);
  }

  function collapseRows(rows) {
    var kept = [], r;
    for (r = 0; r < ROWS; r++) if (rows.indexOf(r) === -1) kept.push(grid[r]);
    while (kept.length < ROWS) kept.unshift(blankRow());
    grid = kept;
  }

  function tickClear(dt) {
    clearing.t += dt;
    if (clearing.t < CLEAR_TIME) return;

    var n = clearing.rows.length;
    var gained = LINE_SCORE[n] * level;
    g.addScore(gained);
    lastGain = gained;
    collapseRows(clearing.rows);
    lines += n;
    lockFlashMap = {};
    lockFlashT = 0;
    phase = "play";
    clearing = null;

    var nextLevel = Math.min(MAX_LEVEL, 1 + Math.floor(lines / 10));
    if (nextLevel > level) {
      level = nextLevel;
      g.sound.cue("levelup");
      g.flash(C.amber, 90);
      statusEl.textContent = "Level " + level + "! Drop speed up.";
      statusEl.className = "status status--win";
    } else if (n >= 4) {
      statusEl.textContent = "TETRIS! 4 lines +" + gained;
      statusEl.className = "status status--win";
    } else {
      statusEl.textContent = n + (n === 1 ? " line" : " lines") + " +" + gained;
      statusEl.className = "status status--play";
    }

    spawnNext();
    syncHud();
  }

  function gameOver() {
    g.over(false);
    g.sound.cue("die");
    g.shake(3);
    g.flash(C.red, 140);
    statusEl.textContent = "Game over. " + lines + " lines, " + g.score +
      " points. Press Enter to play again";
    statusEl.className = "status status--over";
    syncHud();
  }

  /* --- Update ---------------------------------------------------------- */
  function sfxMove() {
    if (moveSfxT > 0) return;
    moveSfxT = MOVE_SFX;
    g.sound.cue("move");
  }

  function update(dt) {
    if (moveSfxT > 0) moveSfxT -= dt;
    if (lockFlashT > 0) lockFlashT -= dt;
    if (graceT > 0) { graceT -= dt; return; }
    if (phase === "clear") { tickClear(dt); return; }
    if (!piece) return;

    if (g.hit("up")) if (spin()) g.sound.cue("select");
    if (holdQueued) { holdQueued = false; doHold(); if (!piece) return; }
    if (g.hit("fire")) { hardDrop(); if (!piece) return; }

    /* Latched pad taps, one cell each. */
    var tapDrop = false, tapX = 0;
    if (padTaps.length) {
      var taps = padTaps;
      padTaps = [];
      for (var ti = 0; ti < taps.length; ti++) {
        if (taps[ti] === "left") tapX = -1;
        else if (taps[ti] === "right") tapX = 1;
        else if (taps[ti] === "down") tapDrop = true;
      }
      if (tapX) { dasDir = 0; dasT = 0; arrT = 0; if (shift(tapX)) sfxMove(); }
      if (tapDrop && stepDown(true)) sfxMove();
    }

    /* Delayed auto-shift. */
    var ax = g.axisX();
    if (ax !== dasDir) {
      dasDir = ax; dasT = 0; arrT = 0;
      if (ax && shift(ax)) sfxMove();
    } else if (ax) {
      dasT += dt;
      if (dasT >= DAS) {
        arrT += dt;
        var guard = 0;
        while (arrT >= ARR && guard < COLS) {
          arrT -= ARR; guard++;
          if (!shift(ax)) { arrT = 0; dasT = DAS; break; }
        }
      }
    }

    /* Soft drop — roughly 28 cells a second, about 7x gravity. */
    if (g.held("down")) {
      softT += dt;
      var drops = 0;
      while (softT >= SOFT_STEP && drops < ROWS) {
        softT -= SOFT_STEP;
        drops++;
        if (stepDown(true)) sfxMove();
      }
    } else {
      softT = 0;
    }

    /* Gravity and lock delay. */
    var m = SHAPES[piece.type][piece.rot];
    if (collides(grid, piece.x, piece.y + 1, m)) {
      grounded = true;
      lockT += dt;
      if (lockT >= LOCK_DELAY || lockResets >= MAX_RESETS) lockPiece();
      return;
    }
    grounded = false;
    lockT = 0;
    if (g.held("down")) return;
    dropT += dt;
    if (dropT >= dropInterval()) {
      dropT = 0;
      if (!collides(grid, piece.x, piece.y + 1, m)) piece.y++;
    }
  }

  /* --- Draw ------------------------------------------------------------ */
  function draw(ctx) {
    ctx.fillStyle = C.black;
    ctx.fillRect(0, 0, W, H);

    drawWell(ctx);
    drawLeft(ctx);
    drawPanel(ctx);

    if (g.state === "idle") panel(ctx, "TETRIS", "PRESS ENTER", C.amber);
    else if (g.state === "paused") panel(ctx, "PAUSED", "PRESS P TO RESUME", C.teal);
    else if (g.state === "over" || g.state === "won") {
      panel(ctx, "GAME OVER", "PRESS ENTER", C.red,
        g.score + " PTS  " + lines + " LINES");
    }
  }

  /* One 5x5 cell: colour body, white top highlight, black right/bottom. */
  function block(ctx, x, y, colour) {
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.fillStyle = C.white;
    ctx.fillRect(x, y, CELL, 1);
    ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = C.black;
    ctx.fillRect(x, y + CELL - 1, CELL, 1);
    ctx.fillRect(x + CELL - 1, y, 1, CELL);
  }

  function drawWell(ctx) {
    var x = WELL_X, y = WELL_Y, w = COLS * CELL, h = ROWS * CELL;

    ctx.fillStyle = C.black;
    ctx.fillRect(x, y, w, h);

    var c, r;
    for (c = 1; c < COLS; c++) {
      ctx.fillStyle = C.dark;
      ctx.fillRect(x + c * CELL, y, 1, h);
    }
    for (r = 1; r < ROWS; r++) {
      ctx.fillStyle = C.dark;
      ctx.fillRect(x, y + r * CELL, w, 1);
    }

    var flashRow = (g.frame >> 2) % 2 === 0;
    var clearRows = clearing ? clearing.rows : null;

    for (r = 0; r < ROWS; r++) {
      var clearing_ = clearRows && clearRows.indexOf(r) !== -1;
      for (c = 0; c < COLS; c++) {
        var col = grid[r][c];
        if (!col) continue;
        var px = x + c * CELL, py = y + r * CELL;
        if (clearing_ && flashRow) block(ctx, px, py, C.white);
        else if (lockFlashT > 0 && lockFlashMap[r + "," + c] && flashRow) block(ctx, px, py, C.white);
        else block(ctx, px, py, col);
      }
    }

    if (piece && phase === "play") {
      var m = SHAPES[piece.type][piece.rot];
      var cells = cellsOf(m);
      var colour = COLOUR[piece.type];

      var gy = ghostY();
      if (gy !== piece.y) {
        var i;
        for (i = 0; i < cells.length; i++) {
          var gx = x + (piece.x + cells[i][1]) * CELL;
          var gyy = y + (gy + cells[i][0]) * CELL;
          frame(ctx, gx, gyy, CELL, CELL, colour);
        }
      }

      for (i = 0; i < cells.length; i++) {
        if (piece.y + cells[i][0] < 0) continue;
        block(ctx, x + (piece.x + cells[i][1]) * CELL,
              y + (piece.y + cells[i][0]) * CELL, colour);
      }
    }

    ctx.fillStyle = C.grey;
    ctx.fillRect(x - 1, y - 1, w + 2, 1);
    ctx.fillRect(x - 1, y + h, w + 2, 1);
    ctx.fillRect(x - 1, y - 1, 1, h + 2);
    ctx.fillRect(x + w, y - 1, 1, h + 2);
  }

  /* Outlined rectangle. The engine's own frame() helper is unusable here —
     Engine.prototype.frame is shadowed by the frame counter — so the four
     edges are filled by hand. */
  function frame(ctx, x, y, w, h, colour) {
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, w, 1);
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.fillRect(x, y, 1, h);
    ctx.fillRect(x + w - 1, y, 1, h);
  }

  /* Meter with a pixel border. Same reason as frame() above: g.bar() calls
     the broken g.frame(). */
  function bar(ctx, x, y, w, h, ratio, colour) {
    g.rect(x, y, w, h, C.black);
    frame(ctx, x, y, w, h, C.dark);
    var fill = Math.max(0, Math.min(1, ratio)) * (w - 2);
    g.rect(x + 1, y + 1, Math.round(fill), h - 2, colour);
  }

  function drawLeft(ctx) {
    g.text("TETRIS", WELL_X, 4, 8, C.amber);
    g.rect(10, 14, 52, 1, C.dark);

    var toNext = level >= MAX_LEVEL ? 0 : 10 - (lines % 10);
    g.text("LEVEL", 11, 113, 8, C.grey);
    g.text(String(level), 61, 113, 8, C.white, "right");
    bar(ctx, 11, 125, 50, 6, (lines % 10) / 10, C.amber);
    g.text("NEXT LV", 11, 135, 8, C.grey);
    g.text(level >= MAX_LEVEL ? "MAX" : String(toNext), 61, 135, 8, C.white, "right");
  }

  function drawPanel(ctx) {
    g.rect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, C.night);
    frame(ctx, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, C.dark);

    stat(ctx, "SCORE", String(g.score), 6, C.amber);
    stat(ctx, "LINES", String(lines), 18, C.bone);
    stat(ctx, "LEVEL", String(level), 30, C.bone);
    g.rect(66, 42, 90, 1, C.dark);

    g.text("HOLD", 68, 50, 8, C.grey);
    g.rect(68, 60, 32, 24, C.black);
    frame(ctx, 68, 60, 32, 24, heldUsed ? C.dark : C.grey);
    if (held) mini(ctx, held, 68, 60, 32, 24, heldUsed);

    g.text("NEXT", 68, 92, 8, C.grey);
    for (var i = 0; i < 3; i++) {
      var bx = 68 + i * 28;
      g.rect(bx, 102, 24, 24, C.black);
      frame(ctx, bx, 102, 24, 24, C.dark);
      if (queue[i]) mini(ctx, queue[i], bx, 102, 24, 24, false);
    }

    /* Palette strip — the seven piece colours, in a fixed order. */
    for (var k = 0; k < TYPES_N; k++) {
      g.rect(68 + k * 12, 132, 8, 8, COLOUR[TYPES[k]]);
      g.rect(68 + k * 12, 132, 8, 1, C.white);
    }
  }

  function stat(ctx, label, value, y, colour) {
    g.text(label, 68, y, 8, C.grey);
    g.text(value, 156, y, 8, colour, "right");
  }

  /* A tetromino preview centred inside a box. */
  function mini(ctx, type, bx, by, bw, bh, dim) {
    var info = MINI[type];
    var ox = bx + Math.floor((bw - info.w * CELL) / 2);
    var oy = by + Math.floor((bh - info.h * CELL) / 2);
    var colour = dim ? C.dark : COLOUR[type];
    for (var i = 0; i < info.cells.length; i++) {
      ctx.fillStyle = colour;
      ctx.fillRect(ox + info.cells[i][1] * CELL, oy + info.cells[i][0] * CELL, CELL, CELL);
      ctx.fillStyle = C.black;
      ctx.fillRect(ox + info.cells[i][1] * CELL,
                   oy + info.cells[i][0] * CELL + CELL - 1, CELL, 1);
      ctx.fillRect(ox + info.cells[i][1] * CELL + CELL - 1,
                   oy + info.cells[i][0] * CELL, 1, CELL);
    }
  }

  function panel(ctx, title, sub, colour, note) {
    g.rect(0, 0, W, H, C.night);
    g.textShadow(title, W / 2 - 8, H / 2 - 18, 16, colour, C.black, "center");
    if ((g.frame >> 4) % 2 === 0 || sub.indexOf("PRESS") !== 0) {
      g.text(sub, W / 2 - 4, H / 2 + 6, 8, C.bone, "center");
    }
    if (note) g.text(note, W / 2 - 4, H / 2 + 22, 8, C.amber, "center");
  }

  /* --- HUD ------------------------------------------------------------- */
  function syncHud() {
    scoreEl.textContent = String(g.score);
    levelEl.textContent = String(level);
    linesEl.textContent = String(lines);
    bestEl.textContent = String(g.best);
    if (holdBtn) {
      holdBtn.setAttribute("aria-pressed", String(!heldUsed));
    }
  }

  /* --- Engine ---------------------------------------------------------- */
  var g = new Arcade.Engine(canvas, {
    width: 160,
    height: 144,
    bestKey: "tetris",
    onStart: function () {
      newGame(true);
      g.sound.cue("start");
      syncHud();
    },
    onUpdate: update,
    onDraw: draw,
    onScore: function () { syncHud(); },
    onPause: function () {
      statusEl.textContent = "Paused. Press P or tap Start to resume";
      statusEl.className = "status status--info";
    },
    onResume: function () {
      graceT = GRACE;
      statusEl.textContent = "Level " + level + ". " + (10 - (lines % 10)) +
        " lines to the next level";
      statusEl.className = "status status--play";
    },
    onOver: function () {
      statusEl.textContent = "Game over. " + lines + " lines, " + g.score +
        " points. Press Enter to play again";
      statusEl.className = "status status--over";
    }
  });

  newGame(false);
  syncHud();

  /* --- Shell wiring ---------------------------------------------------- */
  startBtn.addEventListener("click", function () {
    g.toggle();
    startBtn.blur();
  });

  if (holdBtn) {
    holdBtn.addEventListener("click", function () {
      g.sound.unlock();
      if (g.state === "idle") g.start();
      else if (g.state === "over" || g.state === "won") g.restart();
      else holdQueued = true;
      holdBtn.blur();
    });
  }

  /* Pause and hold live outside the engine's action table, so they get
     their own listeners. Capture phase: the engine also maps P to "start",
     and a bubble phase listener would see the state it had just switched. */
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var code = e.code;
    if (code === "KeyP" || code === "Escape") {
      e.preventDefault();
      g.sound.unlock();
      if (g.state === "running") g.pause();
      else if (g.state === "paused") g.resume();
      return;
    }
    if (code === "KeyC" || code === "ShiftLeft" || code === "ShiftRight") {
      g.sound.unlock();
      if (g.state === "idle") { g.start(); return; }
      if (g.state === "over" || g.state === "won") { g.restart(); return; }
      holdQueued = true;
    }
  }, true);

  /* --- Touch fallback --------------------------------------------------
     Tap the left or right half to step, tap the top third to rotate, swipe
     sideways to step repeatedly and swipe down to soft drop. */
  var STEP_X = 10, STEP_Y = 8;
  var drag = { id: null, x: 0, y: 0, ax: 0, ay: 0, moved: false, t0: 0 };

  function localPoint(e) {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H
    };
  }

  function nudge(dx) {
    if (g.state === "idle" || g.state === "over" || g.state === "won") return;
    if (shift(dx)) sfxMove();
  }

  function nudgeDrop() {
    if (g.state === "idle" || g.state === "over" || g.state === "won") return;
    if (stepDown(true)) sfxMove();
  }

  function tapRotate() {
    if (g.state === "idle" || g.state === "over" || g.state === "won") return;
    if (spin()) g.sound.cue("select");
  }

  screenEl.addEventListener("pointerdown", function (e) {
    if (drag.id !== null) return;
    e.preventDefault();
    var p = localPoint(e);
    drag.id = e.pointerId;
    drag.x = p.x; drag.y = p.y;
    drag.ax = 0; drag.ay = 0;
    drag.moved = false;
    drag.t0 = (window.performance && performance.now) ? performance.now() : 0;
    try { screenEl.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    g.sound.unlock();
    if (g.state === "idle") g.start();
    else if (g.state === "over" || g.state === "won") g.restart();
  });

  screenEl.addEventListener("pointermove", function (e) {
    if (e.pointerId !== drag.id) return;
    e.preventDefault();
    var p = localPoint(e);
    var dx = p.x - drag.x, dy = p.y - drag.y;
    drag.x = p.x; drag.y = p.y;

    if (dx !== 0) {
      drag.ax += dx;
      while (drag.ax >= STEP_X) { drag.ax -= STEP_X; drag.moved = true; nudge(1); }
      while (drag.ax <= -STEP_X) { drag.ax += STEP_X; drag.moved = true; nudge(-1); }
    }
    if (dy > 0) {
      drag.ay += dy;
      while (drag.ay >= STEP_Y) { drag.ay -= STEP_Y; drag.moved = true; nudgeDrop(); }
    } else if (dy < 0) {
      drag.ay = 0;
    }
  });

  function endDrag(e) {
    if (e.pointerId !== drag.id) return;
    var now = (window.performance && performance.now) ? performance.now() : 0;
    if (!drag.moved && now - drag.t0 < 400) {
      if (drag.y < H / 3) tapRotate();
      else nudge(drag.x < W / 2 ? -1 : 1);
    }
    drag.id = null;
    try { screenEl.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
  }

  screenEl.addEventListener("pointerup", endDrag);
  screenEl.addEventListener("pointercancel", endDrag);
  screenEl.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  Arcade.bindPad(g);
  Arcade.initSoundButton(soundBtn, g);

  /* Latch quick pad taps the engine's held() check would otherwise drop. */
  Array.prototype.forEach.call(document.querySelectorAll("[data-pad]"), function (btn) {
    btn.addEventListener("pointerdown", function () {
      var acts = (btn.getAttribute("data-pad") || "").split(" ");
      for (var i = 0; i < acts.length; i++) {
        if (acts[i]) padTaps.push(acts[i]);
      }
    });
  });

  Arcade.ready(function () { g.render(); });
})();
