/* pacman.js — Pac-Man style maze chase, on the shared Arcade engine.
   Tile grid with sub-pixel interpolation, turn buffer, 4 ghost personalities. */
(function () {
  "use strict";

  var W = 160, H = 144;
  var C = Arcade.palette;

  var TS = 6;            // tile size
  var MW = 21, MH = 21;  // maze dimensions in tiles
  var MZ_X = Math.round((W - MW * TS) / 2);  // 17
  var MZ_Y = 16;                                // leaves a HUD strip on top

  var PAC_START = { x: 9, y: 16, dir: "left" };
  var HOUSE_X = 10, HOUSE_Y = 12;      // ghost-house centre tile
  var DOOR_X = 10, DOOR_Y = 10;        // where ghosts emerge (above the door)
  var FRIGHT_TIME = 8;

  /*  # wall   . pellet   o power pellet   (space) path   G ghost-house door
      Every row is exactly MW chars; the layout is left-right symmetric and
      row 10 is the tunnel, open at both edges.                                  */
  var MAZE = [
    "#####################",
    "#o........#........o#",
    "#.###.###.#.###.###.#",
    "#.###.###.#.###.###.#",
    "#...#.....#.....#...#",
    "###.#.###.#.###.#.###",
    "#.....#...#...#.....#",
    "#.#.#.#.##.##.#.#.#.#",
    "#.#.###.##.##.###.#.#",
    "#.###.###...###.###.#",
    "    #...........#    ",
    "#       GGGGG       #",
    "#       G   G       #",
    "#       GGGGG       #",
    "#.....#...#...#.....#",
    "###.#.###.#.###.#.###",
    "#...#.....#.....#...#",
    "#.###.###.#.###.###.#",
    "#.###.###.#.###.###.#",
    "#o........#........o#",
    "#####################"
  ];

  /* --- Maze validation ---------------------------------------------------- */
  var PELLET_TOTAL = 0, POWER_TOTAL = 0;
  (function validate() {
    var seen = [], y, x;
    for (y = 0; y < MH; y++) {
      if (MAZE[y].length !== MW) {
        throw new Error("Maze row " + y + " is " + MAZE[y].length + " wide, expected " + MW);
      }
      seen.push(new Array(MW).fill(false));
    }
    for (x = 0; x < MW; x++) {           // left-right symmetry
      for (y = 0; y < MH; y++) {
        if (MAZE[y][x] !== MAZE[y][MW - 1 - x]) {
          throw new Error("Maze is not symmetric at " + x + "," + y);
        }
      }
    }
    var stack = [[PAC_START.x, PAC_START.y]];
    while (stack.length) {                 // flood fill the walkable maze
      var p = stack.pop(), px = p[0], py = p[1];
      if (px < 0) px += MW;
      if (px >= MW) px -= MW;
      if (py < 0 || py >= MH || seen[py][px]) continue;
      if (MAZE[py][px] === "#" || MAZE[py][px] === "G") continue;
      seen[py][px] = true;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    for (y = 0; y < MH; y++) {
      for (x = 0; x < MW; x++) {
        var ch = MAZE[y][x];
        if (ch === ".") PELLET_TOTAL++;
        if (ch === "o") POWER_TOTAL++;
        if ((ch === "." || ch === "o") && !seen[y][x]) {
          throw new Error("Pellet at " + x + "," + y + " is unreachable");
        }
      }
    }
    if (MAZE[DOOR_Y][0] === "#" || MAZE[DOOR_Y][MW - 1] === "#") {
      throw new Error("Tunnel row is blocked at the edges");
    }
  })();

  /* --- Elements ----------------------------------------------------------- */
  var canvas = document.getElementById("game");
  var screen = document.getElementById("screen");
  var statusEl = document.getElementById("status");
  var scoreEl = document.getElementById("sScore");
  var bestEl = document.getElementById("sBest");
  var lvlEl = document.getElementById("sLevel");
  var livesEl = document.getElementById("sLives");
  var startBtn = document.getElementById("start");
  var soundBtn = document.getElementById("sound");

  var DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
  var ORDER = { up: 0, left: 1, down: 2, right: 3 };  // tie-break priority

  /* --- State -------------------------------------------------------------- */
  var g = null;
  var maze, pelletsLeft, pac, ghosts, lives, level;
  var phase, phaseTimer, releaseTimer, scatterTurn, scatterTimer;
  var stepAcc, deathT, blink, eatT, releaseIndex;

  function blankMaze() {
    var out = [];
    for (var y = 0; y < MH; y++) {
      var row = [];
      for (var x = 0; x < MW; x++) {
        var ch = MAZE[y][x];
        row.push(ch === "." || ch === "o" ? ch : " ");
      }
      out.push(row);
    }
    return out;
  }

  /* Tile lookup that wraps on the left/right edges (the tunnel). */
  function tile(x, y) {
    if (x < 0) x += MW;
    if (x >= MW) x -= MW;
    if (y < 0 || y >= MH) return "#";
    return maze[y][x];
  }

  function wrapX(x) { return (x + MW) % MW; }

  function isOpen(x, y) { return tile(x, y) !== "#" && tile(x, y) !== "G"; }

  function makeGhost(color, name, sx, sy, corner, state) {
    return {
      color: color, name: name, state: state,   // house | out | returning
      x: sx * TS + TS / 2, y: sy * TS + TS / 2,
      dir: DIRS.left, corner: corner,
      frightened: false, eatT: 0, acc: 0
    };
  }

  function resetActors() {
    pac = {
      x: PAC_START.x * TS + TS / 2, y: PAC_START.y * TS + TS / 2,
      dir: DIRS.left, want: DIRS.left, mouth: 0
    };
    ghosts = [
      makeGhost(C.red,   "blinky", DOOR_X, DOOR_Y, { x: MW - 2, y: 0 }, "out"),
      makeGhost(C.pink,  "pinky",  HOUSE_X - 1, HOUSE_Y, { x: 1, y: 0 }, "house"),
      makeGhost(C.cyan,  "inky",   HOUSE_X + 1, HOUSE_Y, { x: MW - 2, y: MH - 1 }, "house"),
      makeGhost(C.orange,"clyde",  HOUSE_X,     HOUSE_Y, { x: 1, y: MH - 1 }, "house")
    ];
    releaseIndex = 0;
    releaseTimer = 3;
    stepAcc = 0;
    fright = 0;
    frightChain = 0;
  }

  var fright = 0, frightChain = 0;

  function releaseGhost() {
    // Blinky starts outside; releaseIndex counts how many house ghosts have left.
    var houseSeen = 0;
    for (var i = 0; i < ghosts.length; i++) {
      if (ghosts[i].state !== "house") continue;
      if (houseSeen === releaseIndex) {
        ghosts[i].state = "out";
        ghosts[i].x = DOOR_X * TS + TS / 2;
        ghosts[i].y = DOOR_Y * TS + TS / 2;
        ghosts[i].dir = DIRS.left;
        releaseIndex++;
        releaseTimer = 4;
        return;
      }
      houseSeen++;
    }
  }

  function startLevel() {
    maze = blankMaze();
    pelletsLeft = PELLET_TOTAL + POWER_TOTAL;
    resetActors();
    phase = "ready";
    phaseTimer = 1.6;
    setStatus(level > 1 ? "Level " + level + " — go!" : "Go!", "play");
  }

  function newGame() {
    level = 1;
    lives = 3;
    startLevel();
    syncHud();
  }

  function die() {
    phase = "dying";
    deathT = 1.8;
    g.sound.cue("die");
    g.shake(3);
    g.flash(C.blue, 110);
    setStatus("Pac-Man down! Lives left: " + Math.max(0, lives - 1), "over");
  }

  function afterDeath() {
    lives--;
    syncHud();
    if (lives <= 0) {
      g.over(false);
      setStatus("Game over. Score " + g.score + ". Press Enter to play again", "over");
      return;
    }
    resetActors();
    phase = "ready";
    phaseTimer = 1.2;
  }

  function levelClear() {
    g.addScore(500 + level * 200);
    g.sound.cue("levelup");
    phase = "clear";
    phaseTimer = 2.2;
    level++;
    syncHud();
    setStatus("Level " + (level - 1) + " cleared!", "win");
  }

  function syncHud() {
    if (!g) return;
    scoreEl.textContent = String(g.score);
    bestEl.textContent = String(g.best);
    lvlEl.textContent = String(level);
    livesEl.textContent = String(Math.max(0, lives));
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status status--" + (kind || "info");
  }

  /* --- Movement ----------------------------------------------------------- */
  function dirName(d) {
    if (d === DIRS.up) return "up";
    if (d === DIRS.left) return "left";
    if (d === DIRS.down) return "down";
    return "right";
  }

  function stepPac(dt) {
    stepAcc += dt;
    var STEP = 0.072;
    if (stepAcc < STEP) return;
    stepAcc -= STEP;

    var cx = Math.floor(pac.x / TS);
    var cy = Math.floor(pac.y / TS);

    // Snap to the tile centre so turns land on exact tile boundaries.
    pac.x = cx * TS + TS / 2;
    pac.y = cy * TS + TS / 2;

    // Apply a buffered turn the instant it becomes legal.
    if (isOpen(cx + pac.want[0], cy + pac.want[1])) pac.dir = pac.want;

    pac.mouth += dt * 11;
    if (!isOpen(cx + pac.dir[0], cy + pac.dir[1])) return;  // wall ahead

    var nx = cx + pac.dir[0];
    var ny = cy + pac.dir[1];
    pac.x += pac.dir[0] * TS;
    pac.y += pac.dir[1] * TS;
    if (pac.x < 0) pac.x += MW * TS;
    if (pac.x >= MW * TS) pac.x -= MW * TS;

    eatAt(wrapX(nx), ny);
  }

  function eatAt(x, y) {
    var ch = tile(x, y);
    if (ch === ".") {
      maze[y][x] = " ";
      pelletsLeft--;
      g.addScore(10);
      g.sound.cue("pickup");
      eatT = 0.08;
      if (pelletsLeft <= 0) levelClear();
    } else if (ch === "o") {
      maze[y][x] = " ";
      pelletsLeft--;
      g.addScore(50);
      g.sound.cue("extra");
      eatT = 0.12;
      fright = FRIGHT_TIME;
      frightChain = 0;
      for (var i = 0; i < ghosts.length; i++) {
        if (ghosts[i].state === "out") ghosts[i].frightened = true;
      }
      if (pelletsLeft <= 0) levelClear();
    }
  }

  function stepGhosts(dt) {
    scatterTimer -= dt;
    if (scatterTimer <= 0) {
      scatterTurn = !scatterTurn;
      scatterTimer = scatterTurn ? 7 : 20;
    }

    releaseTimer -= dt;
    if (releaseTimer <= 0) releaseGhost();

    for (var i = 0; i < ghosts.length; i++) updateGhost(ghosts[i], i, dt);
  }

  function updateGhost(gh, idx, dt) {
    if (gh.eatT > 0) {
      gh.eatT -= dt;
      if (gh.eatT <= 0 && gh.state === "returning") {
        // Back in the house for a beat, then out again.
        gh.state = "out";
        gh.x = DOOR_X * TS + TS / 2;
        gh.y = DOOR_Y * TS + TS / 2;
        gh.dir = DIRS.left;
        gh.frightened = false;
      }
      return;
    }
    if (gh.state !== "out") return;

    // Ghosts move on their own fixed step, slower than Pac-Man.
    gh.acc += dt;
    var cx0 = Math.floor(gh.x / TS);
    var cy0 = Math.floor(gh.y / TS);
    // They crawl in the tunnel row and drift while frightened.
    var slow = cy0 === 10 || (gh.frightened && fright > 0);
    var GHOST_STEP = slow ? 0.15 : 0.095;
    if (gh.acc < GHOST_STEP) return;
    gh.acc -= GHOST_STEP;

    var cx = cx0;
    var cy = cy0;
    gh.x = cx * TS + TS / 2;
    gh.y = cy * TS + TS / 2;

    // The tunnel row is cy === 10; ghosts crawl through it.
    var target = ghostTarget(gh, idx, cx, cy);
    choose(gh, cx, cy, target);
    gh.x += gh.dir[0] * TS;
    gh.y += gh.dir[1] * TS;

    if (gh.x < 0) gh.x += MW * TS;
    if (gh.x >= MW * TS) gh.x -= MW * TS;
  }

  /* Pick the legal direction closest to the target; no reversing. */
  function choose(gh, cx, cy, target) {
    var opts = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];
    var best = null, bestD = Infinity;
    for (var i = 0; i < opts.length; i++) {
      var d = opts[i];
      if (!isOpen(cx + d[0], cy + d[1])) continue;
      if (d[0] === -gh.dir[0] && d[1] === -gh.dir[1]) continue;
      var tx = wrapX(cx + d[0]);
      var dx = tx - target.x;
      var dy = cy + d[1] - target.y;
      var dist = dx * dx + dy * dy;
      if (dist < bestD ||
          (dist === bestD && best !== null && ORDER[dirName(d)] < ORDER[dirName(best)])) {
        bestD = dist;
        best = d;
      }
    }
    gh.dir = best || gh.dir;   // dead end: keep going and bounce
  }

  function ghostTarget(gh, idx, cx, cy) {
    if (gh.frightened && fright > 0) {
      // Wander, biased away from the corner so it isn't predictable.
      var t = (g.frame / 10) | 0;
      return { x: (gh.corner.x + t * 3) % MW, y: (gh.corner.y + t * 5) % MH };
    }
    if (scatterTurn && idx > 0) return { x: gh.corner.x, y: gh.corner.y };

    var ptx = Math.floor(pac.x / TS);
    var pty = Math.floor(pac.y / TS);
    var pdir = dirName(pac.dir);

    switch (gh.name) {
      case "blinky":
        return { x: ptx, y: pty };
      case "pinky": {
        // 4 tiles ahead, including the classic up-and-left overflow bug.
        var ax = ptx + pac.dir[0] * 4;
        var ay = pty + pac.dir[1] * 4;
        if (pdir === "up") ax -= 4;
        return { x: ax, y: ay };
      }
      case "inky": {
        var px2 = ptx + pac.dir[0] * 2;
        var py2 = pty + pac.dir[1] * 2;
        var b = ghosts[0];
        return {
          x: 2 * px2 - Math.floor(b.x / TS),
          y: 2 * py2 - Math.floor(b.y / TS)
        };
      }
      default: // clyde
        var dist = Math.abs(cx - ptx) + Math.abs(cy - pty);
        return dist > 8 ? { x: ptx, y: pty } : { x: gh.corner.x, y: gh.corner.y };
    }
  }

  function checkCollisions() {
    var px = Math.floor(pac.x / TS);
    var py = Math.floor(pac.y / TS);
    for (var i = 0; i < ghosts.length; i++) {
      var gh = ghosts[i];
      if (gh.state !== "out") continue;
      if (Math.floor(gh.x / TS) !== px || Math.floor(gh.y / TS) !== py) continue;
      if (gh.frightened && fright > 0) {
        gh.state = "returning";
        gh.eatT = 1.2;
        frightChain++;
        g.addScore(200 * Math.pow(2, frightChain - 1));
        g.sound.cue("score");
        g.flash(C.cyan, 70);
        syncHud();
      } else {
        die();
        return;
      }
    }
  }

  /* --- Update ------------------------------------------------------------- */
  function update(dt) {
    blink += dt;
    if (eatT > 0) eatT -= dt;

    if (g.hit("left")) pac.want = DIRS.left;
    if (g.hit("right")) pac.want = DIRS.right;
    if (g.hit("up")) pac.want = DIRS.up;
    if (g.hit("down")) pac.want = DIRS.down;
    if (g.hit("fire")) { g.pause(); return; }

    if (phase === "ready") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) phase = "play";
      return;
    }
    if (phase === "dying") {
      deathT -= dt;
      if (deathT <= 0) afterDeath();
      return;
    }
    if (phase === "clear") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) startLevel();
      return;
    }

    if (fright > 0) {
      fright -= dt;
      if (fright <= 0) {
        fright = 0;
        for (var i = 0; i < ghosts.length; i++) ghosts[i].frightened = false;
      }
    }

    stepPac(dt);
    if (phase !== "play") return;   // a pellet cleared the level mid-step
    stepGhosts(dt);
    checkCollisions();
  }

  /* --- Draw --------------------------------------------------------------- */
  function draw(ctx) {
    ctx.fillStyle = C.black;
    ctx.fillRect(0, 0, W, H);

    drawHud(ctx);
    drawMaze(ctx);
    drawActors(ctx);

    if (phase === "ready") centre(ctx, "READY!", 16, C.amber);
    else if (phase === "clear") centre(ctx, "LEVEL " + (level - 1) + " CLEAR", 8, C.green);
    else if (phase === "dying") drawDeath(ctx);

    if (g.state === "idle") panel(ctx, "PAC-MAN", "PRESS ENTER", C.amber);
    else if (g.state === "paused") panel(ctx, "PAUSED", "PRESS P", C.teal);
    else if (g.state === "over") panel(ctx, "GAME OVER", "PRESS ENTER", C.red);
  }

  function drawHud(ctx) {
    g.text("SCORE " + pad(g.score, 5), 3, 3, 8, C.bone);
    g.text("HI " + pad(g.best, 5), 88, 3, 8, C.amber);
    g.text("LV" + level, 140, 3, 8, C.teal);

    // Fright timer, with lives stacked to its right.
    if (fright > 0) g.bar(3, 12, 60, 3, fright / FRIGHT_TIME, C.blue, "#1a1a2e");

    for (var i = 0; i < Math.max(0, lives); i++) {
      ctx.fillStyle = C.amber;
      ctx.fillRect(150 + i * 4 - 6, 12, 3, 3);
    }
  }

  function drawMaze(ctx) {
    var y, x, ch;
    // Walls, drawn as a single-pixel lattice with the corners rounded off.
    ctx.fillStyle = C.blue;
    for (y = 0; y < MH; y++) {
      for (x = 0; x < MW; x++) {
        if (MAZE[y][x] !== "#") continue;
        var px = MZ_X + x * TS, py = MZ_Y + y * TS;
        var openUp = y > 0 && MAZE[y - 1][x] !== "#";
        var openDn = y < MH - 1 && MAZE[y + 1][x] !== "#";
        var openL = MAZE[y][(x - 1 + MW) % MW] !== "#";
        var openR = MAZE[y][(x + 1) % MW] !== "#";

        if (!openUp) ctx.fillRect(px, py, TS, 1);
        if (!openDn) ctx.fillRect(px, py + TS - 1, TS, 1);
        if (!openL) ctx.fillRect(px, py, 1, TS);
        if (!openR) ctx.fillRect(px + TS - 1, py, 1, TS);
        // Fill corners so blocks read as solid, not as loose lines.
        if (openUp && openL) ctx.fillRect(px, py, 1, 1);
        if (openUp && openR) ctx.fillRect(px + TS - 1, py, 1, 1);
        if (openDn && openL) ctx.fillRect(px, py + TS - 1, 1, 1);
        if (openDn && openR) ctx.fillRect(px + TS - 1, py + TS - 1, 1, 1);
      }
    }
    // Ghost-house door
    ctx.fillStyle = C.pink;
    ctx.fillRect(MZ_X + HOUSE_X * TS, MZ_Y + (HOUSE_Y - 1) * TS, TS, 1);

    // Pellets
    for (y = 0; y < MH; y++) {
      for (x = 0; x < MW; x++) {
        ch = maze[y][x];
        var cx2 = MZ_X + x * TS, cy2 = MZ_Y + y * TS;
        if (ch === ".") {
          ctx.fillStyle = C.bone;
          ctx.fillRect(cx2 + 2, cy2 + 2, 2, 2);
        } else if (ch === "o" && ((blink * 5) % 2 < 1)) {
          ctx.fillStyle = C.amber;
          ctx.fillRect(cx2 + 1, cy2 + 1, 4, 4);
        }
      }
    }
  }

  function drawActors(ctx) {
    if (phase !== "dying") {
      var px = MZ_X + pac.x, py = MZ_Y + pac.y, r = TS / 2 - 0.5;
      var ang = Math.atan2(pac.dir[1], pac.dir[0]);
      var open = (Math.sin(pac.mouth) * 0.5 + 0.5) * 0.36 * Math.PI;

      ctx.fillStyle = C.amber;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      // Carve the mouth back out in the background colour.
      ctx.fillStyle = C.black;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, r + 0.3, ang - open, ang + open);
      ctx.closePath();
      ctx.fill();
    }

    for (var i = 0; i < ghosts.length; i++) {
      var gh = ghosts[i];
      var gx = MZ_X + gh.x, gy = MZ_Y + gh.y, gr = TS / 2 - 0.5;
      var frightened = gh.frightened && fright > 0;
      var col = gh.color;
      if (frightened) {
        col = (fright < 2 && ((blink * 6) % 2 < 1)) ? C.bone : C.blue;
      }

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(gx - gr, gy, gr * 2, 2);
      var wob = ((blink * 8) | 0) % 2 === 0;
      for (var w = 0; w < 3; w++) {
        if (wob || w !== 1) ctx.fillRect(gx - gr + w * (gr * 2 / 3), gy + 2, (gr * 2 / 3) | 0, 1);
      }

      if (frightened) {
        ctx.fillStyle = C.bone;
        ctx.fillRect(gx - 2, gy - 1, 1, 1);
        ctx.fillRect(gx + 1, gy - 1, 1, 1);
        ctx.fillStyle = col;
        ctx.fillRect(gx - 2, gy, 1, 1);
        ctx.fillRect(gx + 1, gy, 1, 1);
      } else {
        var off = gh.dir[0] * 0.8;
        ctx.fillStyle = C.white;
        ctx.fillRect(gx - 2.2 + off, gy - 2, 1.6, 2.2);
        ctx.fillRect(gx + 0.6 + off, gy - 2, 1.6, 2.2);
        ctx.fillStyle = C.blue;
        ctx.fillRect(gx - 1.6 + off + gh.dir[0] * 0.6, gy - 1.4, 1, 1.6);
        ctx.fillRect(gx + 0.6 + off + gh.dir[0] * 0.6, gy - 1.4, 1, 1.6);
      }
    }
  }

  function drawDeath(ctx) {
    var t = 1 - deathT / 1.8;
    var r = (TS / 2 - 0.5) * (1 - t);
    if (r <= 0.4) return;
    ctx.fillStyle = C.amber;
    ctx.beginPath();
    ctx.arc(MZ_X + pac.x, MZ_Y + pac.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function centre(ctx, text, size, color) {
    ctx.textAlign = "center";
    ctx.font = size + 'px "Press Start 2P", monospace';
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, H / 2 - size / 2);
  }

  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = "0" + s;
    return s;
  }

  function panel(ctx, title, sub, color) {
    ctx.fillStyle = "rgba(8,8,15,0.82)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.fillStyle = color;
    ctx.fillText(title, W / 2, H / 2 - 14);
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.fillStyle = C.bone;
    ctx.fillText(sub, W / 2, H / 2 + 10);
  }

  /* --- Engine + shell ----------------------------------------------------- */
  g = new Arcade.Engine(canvas, {
    width: W, height: H, bestKey: "pacman",
    onStart: function () { newGame(); g.sound.cue("start"); },
    onUpdate: update,
    onDraw: draw,
    onScore: syncHud
  });

  level = 1;
  lives = 3;
  phase = "ready";
  phaseTimer = 1.2;
  deathT = 0;
  blink = 0;
  eatT = 0;
  scatterTurn = false;
  scatterTimer = 7;
  startLevel();
  syncHud();

  startBtn.addEventListener("click", function () { g.toggle(); startBtn.blur(); });
  Arcade.bindPad(g);
  Arcade.initSoundButton(soundBtn, g);

  /* Pause/resume must run from a listener, because update() only executes
     while the engine is already in the running state. */
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyP" || e.code === "Escape" || e.code === "Space") {
      if (g.state === "running") g.pause();
      else if (g.state === "paused") g.resume();
    }
  });

  /* Swipe to turn — the natural mobile control for this game. */
  var sx = 0, sy = 0, swiping = false;
  screen.addEventListener("pointerdown", function (e) {
    if (g.state === "idle") g.start();
    sx = e.clientX; sy = e.clientY; swiping = true;
    screen.setPointerCapture(e.pointerId);
  });
  screen.addEventListener("pointermove", function (e) {
    if (!swiping) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) pac.want = dx > 0 ? DIRS.right : DIRS.left;
    else pac.want = dy > 0 ? DIRS.down : DIRS.up;
    sx = e.clientX; sy = e.clientY;
  });
  screen.addEventListener("pointerup", function () { swiping = false; });
  screen.addEventListener("pointercancel", function () { swiping = false; });

  Arcade.ready(function () { g.render(); });
})();
