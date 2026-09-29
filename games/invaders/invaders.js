/* invaders.js — Space Invaders. Built on the shared Arcade engine. */
(function () {
  "use strict";

  var W = 160, H = 144;
  var C = Arcade.palette;

  var canvas = document.getElementById("game");
  var screenEl = document.getElementById("screen");
  var statusEl = document.getElementById("status");
  var scoreEl = document.getElementById("sScore");
  var bestEl = document.getElementById("sBest");
  var waveEl = document.getElementById("sWave");
  var livesEl = document.getElementById("sLives");
  var startBtn = document.getElementById("start");
  var pauseBtn = document.getElementById("pause");
  var soundBtn = document.getElementById("sound");

  /* --- Layout ---------------------------------------------------------- */
  var COLS = 5, ROWS = 5, TOTAL = COLS * ROWS;
  var STEP_X = 13, STEP_Y = 11;              // grid pitch between invaders
  var INV_W = 8, INV_H = 8;                  // sprite size
  var FORM_W = (COLS - 1) * STEP_X + INV_W;  // 60px wide block
  var FORM_TOP = 32;
  var MARCH = 3;                             // px per march tick
  var DROP = 4;                              // px stepped down at each edge
  var LAND_Y = 124;                          // lowest invader edge = they landed
  var HUD_H = 20;                            // top HUD band

  var SHIELD_W = 22, SHIELD_H = 12, SHIELD_Y = 102;
  var SHIELD_X = [9, 49, 89, 129];

  var PLAYER_W = 13, PLAYER_Y = 132, PLAYER_SPD = 2.4;
  var BULLET_H = 4, BULLET_SPD = 3.4, SHOT_COOL = 7;
  var START_LIVES = 3, EXTRA_LIFE = 5000;
  var UFO_POINTS = [50, 100, 150, 300];

  /* --- Sprite art ------------------------------------------------------- */
  var SPECIES = [
    {
      name: "SKULL", points: 30, color: C.pink,
      frames: [
        ["...##...", "..####..", ".######.", "##.##.##",
         "########", "..#..#..", ".#.##.#.", "#.#..#.#"],
        ["...##...", "..####..", ".######.", "##.##.##",
         "########", ".#.##.#.", "#.#..#.#", ".#....#."]
      ]
    },
    {
      name: "CRAB", points: 20, color: C.cyan,
      frames: [
        ["..#..#..", "...##...", "..####..", ".##..##.",
         "########", "#..##..#", "#.#..#.#", ".#....#."],
        ["#..##..#", "#..##..#", ".######.", "########",
         "#..##..#", "..#..#..", ".#.#.#.#", "#..##..#"]
      ]
    },
    {
      name: "OCTO", points: 10, color: C.lime,
      frames: [
        ["..####..", ".##..##.", "########", "##.##.##",
         "########", "..#..#..", ".#.#.#.#", "#..##..#"],
        ["..####..", ".##..##.", "########", "##.##.##",
         "########", ".#.#.#.#", "#.#..#.#", ".##..##."]
      ]
    },
    {
      name: "GRUNT", points: 5, color: C.white,
      frames: [
        ["#..##..#", "########", "#.#..#.#", "#.####.#",
         "#.####.#", "#..##..#", ".#.##.#.", "#.#..#.#"],
        ["#..##..#", "########", "#.#..#.#", "#.####.#",
         "#.####.#", "#..##..#", "#.#..#.#", ".#.##.#."]
      ]
    }
  ];
  /* Rows 3 and 4 share the cheapest species, exactly like the arcade. */
  var ROW_SPECIES = [0, 1, 2, 3, 3];

  var UFO = [
    "....########....",
    "..##############..",
    ".###.##.##.##.###.",
    "################",
    "..###..####..###",
    "###..######..###",
    ".#..###..###..#."
  ];

  var BOMB = [
    ["#.#", ".#.", "#.#", ".#.", "#.#", ".#.", "#.#"],
    [".#.", "#.#", ".#.", "#.#", ".#.", "#.#", ".#."]
  ];

  var CANNON = [
    "......#......",
    ".....###.....",
    ".....###.....",
    ".###########.",
    "#############",
    "#############",
    "#############",
    "#############"
  ];

  var CANNON_ICON = [".#.#.", "#####", "#####"];

  /* Bunker silhouette: an arch with a slot under the middle. */
  var SHIELD_ART = [
    "..####################",
    ".####################.",
    "######################",
    "######################",
    "######################",
    "######################",
    "######################",
    "######################",
    "########.####.########",
    "########.####.########",
    "#######..####..#######",
    "######....##....######"
  ];

  var FOXFIRE = [C.amber, C.orange, C.red, C.bone];

  /* --- Model ----------------------------------------------------------- */
  var grid = [];          // grid[row][col] -> invader or null
  var shields = [];       // { x, y, w, h, rows: bitmask per row }
  var bombs = [];
  var particles = [];
  var bursts = [];
  var stars = [];

  var formX, formY, dir, anim, marchTimer, marchTick;
  var aliveCount;
  var bullet = null, fireCool = 0;
  var ufo = { active: false, x: 0, d: 1, value: 50, timer: 0 };
  var player = { x: 0, y: PLAYER_Y };
  var wave = 1, newBest = false;
  var freeze = 0, pendingOver = false;
  var bombTimer = 1.2;
  var banner = null, bannerAction = null;
  var pointerDown = false, pointerFire = false;
  var dragging = false;

  /* --- Small helpers --------------------------------------------------- */
  function pad(n, w) {
    var s = String(n);
    while (s.length < w) s = "0" + s;
    return s;
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "status status--" + (kind || "info");
  }

  function popcount(bits) {
    var n = 0;
    for (var i = 0; i < SHIELD_W; i++) if (bits & (1 << i)) n++;
    return n;
  }

  function makeStars() {
    stars.length = 0;
    var seed = 20260929;
    for (var i = 0; i < 44; i++) {
      seed = (seed * 16807) % 2147483647;
      var x = seed % W;
      seed = (seed * 16807) % 2147483647;
      var y = HUD_H + 2 + (seed % (H - HUD_H - 2));
      stars.push({ x: x, y: y });
    }
  }

  /* --- Bunkers --------------------------------------------------------- */
  function buildShields() {
    shields.length = 0;
    for (var s = 0; s < SHIELD_X.length; s++) {
      var rows = [];
      for (var r = 0; r < SHIELD_H; r++) {
        var bits = 0, line = SHIELD_ART[r];
        for (var c = 0; c < SHIELD_W; c++) if (line.charAt(c) === "#") bits |= (1 << c);
        rows.push(bits);
      }
      shields.push({ x: SHIELD_X[s], y: SHIELD_Y, w: SHIELD_W, h: SHIELD_H, rows: rows });
    }
  }

  /* Blow a hole in a bunker. Coordinates are in screen space. */
  function carve(s, wx, wy, ww, hh) {
    var x0 = Math.max(0, Math.floor(wx - s.x));
    var x1 = Math.min(s.w - 1, Math.ceil(wx + ww - s.x) - 1);
    var y0 = Math.max(0, Math.floor(wy - s.y));
    var y1 = Math.min(s.h - 1, Math.ceil(wy + hh - s.y) - 1);
    for (var r = y0; r <= y1; r++) {
      for (var c = x0; c <= x1; c++) s.rows[r] = s.rows[r] & ~(1 << c);
    }
  }

  /* True when any solid bunker pixel overlaps that screen rect. */
  function shieldHit(s, wx, wy, ww, hh) {
    var x0 = Math.max(0, Math.floor(wx - s.x));
    var x1 = Math.min(s.w - 1, Math.ceil(wx + ww - s.x) - 1);
    var y0 = Math.max(0, Math.floor(wy - s.y));
    var y1 = Math.min(s.h - 1, Math.ceil(wy + hh - s.y) - 1);
    for (var r = y0; r <= y1; r++) {
      var bits = s.rows[r];
      for (var c = x0; c <= x1; c++) if (bits & (1 << c)) return true;
    }
    return false;
  }

  function intactShields() {
    var n = 0;
    for (var i = 0; i < shields.length; i++) {
      var whole = true;
      for (var r = 0; r < SHIELD_H; r++) {
        if (popcount(shields[i].rows[r]) < SHIELD_W - 2) { whole = false; break; }
      }
      if (whole) n++;
    }
    return n;
  }

  /* --- Formation ------------------------------------------------------- */
  function buildWave() {
    grid.length = 0;
    aliveCount = 0;
    for (var r = 0; r < ROWS; r++) {
      grid.push([]);
      for (var c = 0; c < COLS; c++) {
        grid[r].push({ cx: c, cy: r, sp: ROW_SPECIES[r], alive: true, x: 0, y: 0 });
        aliveCount++;
      }
    }
    formX = ((W - FORM_W) / 2) | 0;
    formY = FORM_TOP;
    dir = 1;
    anim = 0;
    marchTick = 0;
    marchTimer = marchInterval();
    placeInvaders();
  }

  function placeInvaders() {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var a = grid[r][c];
        a.x = formX + c * STEP_X;
        a.y = formY + r * STEP_Y;
      }
    }
  }

  function moveInvaders(dx, dy) {
    formX += dx;
    if (dy) formY += dy;
    placeInvaders();
  }

  function marchInterval() {
    var ratio = aliveCount / TOTAL;
    var base = 0.33 - Math.min(0.19, (wave - 1) * 0.022);
    return Math.max(0.05, base * Math.pow(ratio, 0.85));
  }

  function bounds() {
    var minX = W, maxX = -1, maxY = -1;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var a = grid[r][c];
        if (!a.alive) continue;
        if (a.x < minX) minX = a.x;
        if (a.x + INV_W > maxX) maxX = a.x + INV_W;
        if (a.y + INV_H > maxY) maxY = a.y + INV_H;
      }
    }
    return { minX: minX, maxX: maxX, maxY: maxY };
  }

  /* --- HUD ------------------------------------------------------------- */
  function syncHud() {
    scoreEl.textContent = String(g.score);
    bestEl.textContent = String(Math.max(g.best, g.score));
    waveEl.textContent = String(wave);
    livesEl.textContent = String(Math.max(0, g.lives));
  }

  /* --- Effects --------------------------------------------------------- */
  function addBurst(x, y, size, color) {
    bursts.push({ x: x, y: y, life: size, max: size, color: color });
    addParticles(x, y, 10, FOXFIRE, 1.4);
  }

  function addParticles(x, y, n, colors, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = 0.4 + Math.random() * spd;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 0.3,
        life: 8 + ((Math.random() * 14) | 0),
        color: colors[(Math.random() * colors.length) | 0]
      });
    }
    if (particles.length > 150) particles.splice(0, particles.length - 150);
  }

  function updateFx() {
    var i;
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.09;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (i = bursts.length - 1; i >= 0; i--) {
      bursts[i].life--;
      if (bursts[i].life <= 0) bursts.splice(i, 1);
    }
  }

  /* --- Scoring --------------------------------------------------------- */
  function award(pts) {
    var before = Math.floor(g.score / EXTRA_LIFE);
    g.addScore(pts);
    if (Math.floor(g.score / EXTRA_LIFE) > before) {
      g.lives++;
      g.sound.cue("extra");
      g.flash(C.lime, 120);
      setStatus("Extra life! " + g.lives + " in reserve", "win");
    }
  }

  /* --- Game lifecycle -------------------------------------------------- */
  function resetModel() {
    wave = 1;
    newBest = false;
    g.lives = START_LIVES;
    bullet = null;
    fireCool = 0;
    bombs.length = 0;
    particles.length = 0;
    bursts.length = 0;
    ufo.active = false;
    ufo.timer = 9 + Math.random() * 9;
    bombTimer = 1.4;
    freeze = 0;
    pendingOver = false;
    banner = null;
    bannerAction = null;
    player.x = ((W - PLAYER_W) / 2) | 0;
    makeStars();
    buildWave();
    buildShields();
    syncHud();
  }

  function newGame() {
    resetModel();
    g.sound.cue("start");
    setStatus("Wave 1 - clear the formation", "play");
  }

  function respawnWave() {
    bombs.length = 0;
    bullet = null;
    ufo.active = false;
    ufo.timer = 8 + Math.random() * 8;
    player.x = ((W - PLAYER_W) / 2) | 0;
    buildWave();
    setStatus(g.lives + (g.lives === 1 ? " life" : " lives") + " left - they came back faster", "play");
  }

  function waveCleared() {
    var bonus = 50 * wave + 20 * intactShields();
    award(bonus);
    syncHud();
    g.sound.cue("levelup");
    g.flash(C.green, 140);
    bombs.length = 0;
    bullet = null;
    ufo.active = false;
    setStatus("Wave clear! Bunker bonus +" + bonus, "win");
    showBanner("CLEARED", "+" + bonus + " BONUS", C.green, 110, nextWave);
  }

  function nextWave() {
    wave++;
    buildWave();
    buildShields();
    bombs.length = 0;
    bullet = null;
    ufo.active = false;
    ufo.timer = 10 + Math.random() * 8;
    bombTimer = bombInterval() * 0.7;
    syncHud();
    setStatus("Wave " + wave + " - they march faster", "play");
    showBanner("WAVE " + wave, "HOLD FIRE", C.teal, 60, null);
  }

  function showBanner(title, sub, color, frames, action) {
    banner = { title: title, sub: sub, color: color, t: frames };
    bannerAction = action || null;
  }

  function invasion() {
    g.shake(4);
    g.flash(C.red, 160);
    g.sound.cue("explode");
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (!grid[r][c].alive) continue;
        addBurst(grid[r][c].x + INV_W / 2, grid[r][c].y + INV_H / 2, 16, C.red);
      }
    }
    finish();
    setStatus("The invaders landed. Game over - press Enter to fight again", "over");
  }

  function finish() {
    newBest = g.score > 0 && g.score >= g.best;
    g.over(false);
    syncHud();
  }

  function killPlayer() {
    g.lives--;
    syncHud();
    addBurst(player.x + (PLAYER_W / 2), player.y + 4, 22, C.amber);
    g.shake(4);
    g.flash(C.red, 150);
    g.sound.cue("die");
    bullet = null;
    bombs.length = 0;
    ufo.active = false;
    pendingOver = g.lives <= 0;
    freeze = pendingOver ? 80 : 90;
    setStatus(pendingOver
      ? "Last cannon down. Game over - press Enter to fight again"
      : "Cannon down! " + g.lives + (g.lives === 1 ? " life" : " lives") + " left", "over");
  }

  /* --- Update ---------------------------------------------------------- */
  function update(dt) {
    updateFx();

    /* Death freeze: no input, just the explosion playing out. */
    if (freeze > 0) {
      freeze -= dt * 60;
      if (freeze <= 0) {
        freeze = 0;
        if (pendingOver) { finish(); return; }
        respawnWave();
      }
      return;
    }

    if (banner) {
      banner.t -= dt * 60;
      if (banner.t <= 0) {
        var next = bannerAction;
        banner = null;
        bannerAction = null;
        if (next) next();
      }
      return;
    }

    /* Player cannon */
    var ax = g.axisX();
    if (!pointerDown && ax !== 0) {
      var nx = player.x + ax * PLAYER_SPD;
      if (nx < 0) { nx = 0; g.sound.cue("bounce"); }
      if (nx > W - PLAYER_W) { nx = W - PLAYER_W; g.sound.cue("bounce"); }
      player.x = nx;
    }
    if (g.held("fire") || g.hit("fire") || pointerFire) tryFire();
    if (fireCool > 0) fireCool--;

    updateMarch(dt);
    if (g.state !== "running") return;
    updateBullet();
    updateBombs(dt);
    updateUfo(dt);
  }

  function tryFire() {
    if (bullet || fireCool > 0 || g.state !== "running") return;
    bullet = { x: player.x + ((PLAYER_W / 2) | 0), y: PLAYER_Y - BULLET_H };
    fireCool = SHOT_COOL;
    g.sound.cue("shoot");
    addParticles(bullet.x, PLAYER_Y - 1, 3, [C.bone, C.amber], 0.8);
  }

  function updateMarch(dt) {
    marchTimer -= dt;
    if (marchTimer > 0) return;
    marchTimer = marchInterval();
    anim ^= 1;
    marchTick++;
    if (marchTick % 2 === 0) g.sound.cue("move");

    var b = bounds();
    if (b.maxX < 0) return; // nothing left, the wave-cleared path handles it

    var edge = (dir > 0 && b.maxX + MARCH > W - 1) || (dir < 0 && b.minX - MARCH < 1);

    if (edge) {
      moveInvaders(0, DROP);
      dir = -dir;
      /* Marching over a bunker wipes it out. */
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
          var a = grid[r][c];
          if (!a.alive) continue;
          for (var s = 0; s < shields.length; s++) {
            if (shieldHit(shields[s], a.x, a.y + INV_H - 2, INV_W, 3)) {
              carve(shields[s], a.x, a.y + INV_H - 2, INV_W, 3);
            }
          }
        }
      }
    } else {
      moveInvaders(dir * MARCH, 0);
    }

    if (bounds().maxY >= LAND_Y) invasion();
  }

  function updateBullet() {
    if (!bullet) return;
    bullet.y -= BULLET_SPD;
    if (bullet.y <= HUD_H) { bullet = null; return; }

    /* Mystery ship first - it flies above everything else. */
    if (ufo.active) {
      var uy = HUD_H + 1;
      if (bullet.x + 1 > ufo.x && bullet.x < ufo.x + 16 &&
          bullet.y + BULLET_H > uy && bullet.y < uy + 7) {
        addBurst(ufo.x + 8, uy + 3, 16, C.pink);
        award(ufo.value);
        syncHud();
        g.sound.cue("score");
        g.shake(1);
        setStatus("Mystery ship +" + ufo.value, "win");
        ufo.active = false;
        ufo.timer = 13 + Math.random() * 14;
        bullet = null;
        return;
      }
    }

    /* Bunkers eat shots. */
    for (var i = 0; i < shields.length; i++) {
      if (shieldHit(shields[i], bullet.x, bullet.y, 1, BULLET_H)) {
        carve(shields[i], bullet.x, bullet.y - 1, 2, BULLET_H + 2);
        addParticles(bullet.x, bullet.y, 3, [C.teal, C.cyan], 0.7);
        g.sound.cue("bounce");
        bullet = null;
        return;
      }
    }

    /* Invaders - the topmost one in the column goes first. */
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var a = grid[r][c];
        if (!a.alive) continue;
        if (bullet.x + 1 > a.x && bullet.x < a.x + INV_W &&
            bullet.y + BULLET_H > a.y && bullet.y < a.y + INV_H) {
          var sp = SPECIES[a.sp];
          a.alive = false;
          aliveCount--;
          addBurst(a.x + (INV_W / 2), a.y + (INV_H / 2), 14, sp.color);
          award(sp.points);
          syncHud();
          g.sound.cue("hit");
          if (sp.points >= 10) g.shake(1);
          bullet = null;
          if (aliveCount <= 0) waveCleared();
          return;
        }
      }
    }
  }

  function bombInterval() {
    return Math.max(0.26, 1.7 - (wave - 1) * 0.15);
  }

  function maxBombs() {
    return Math.min(5, 3 + ((wave / 3) | 0));
  }

  function spawnBomb() {
    for (var tries = 0; tries < COLS; tries++) {
      var col = (Math.random() * COLS) | 0;
      for (var r = ROWS - 1; r >= 0; r--) {
        var a = grid[r][col];
        if (!a || !a.alive) continue;
        bombs.push({
          x: a.x + 2 + ((Math.random() * 3) | 0),
          y: a.y + INV_H,
          f: 0, t: 0,
          v: Math.min(2.3, 0.8 + wave * 0.11)
        });
        return;
      }
    }
  }

  function updateBombs(dt) {
    if (aliveCount > 0 && bombs.length < maxBombs()) {
      bombTimer -= dt;
      if (bombTimer <= 0) {
        spawnBomb();
        bombTimer = bombInterval() * (0.6 + Math.random() * 0.9);
      }
    }

    for (var i = bombs.length - 1; i >= 0; i--) {
      var b = bombs[i];
      b.y += b.v;
      b.t++;
      if (b.t % 8 === 0) b.f ^= 1;

      /* Bombs chew straight down through the bunkers. */
      for (var s = 0; s < shields.length; s++) {
        if (shieldHit(shields[s], b.x, b.y, 1, 2)) {
          carve(shields[s], b.x, b.y, 1, 2);
          addParticles(b.x, b.y, 1, [C.red], 0.5);
        }
      }

      if (b.y >= player.y && b.y <= player.y + 8 && b.x >= player.x - 1 && b.x <= player.x + PLAYER_W) {
        bombs.splice(i, 1);
        killPlayer();
        return;
      }

      if (b.y > H) bombs.splice(i, 1);
    }
  }

  function spawnUfo() {
    ufo.active = true;
    ufo.d = Math.random() < 0.5 ? 1 : -1;
    ufo.x = ufo.d > 0 ? -18 : W + 2;
    ufo.value = UFO_POINTS[(Math.random() * UFO_POINTS.length) | 0];
    ufo.timer = 14 + Math.random() * 14;
    g.sound.cue("pickup");
  }

  function updateUfo(dt) {
    if (!ufo.active) {
      ufo.timer -= dt;
      if (ufo.timer <= 0) spawnUfo();
      return;
    }
    ufo.x += ufo.d * 0.65;
    if (ufo.x > W + 4 || ufo.x < -20) {
      ufo.active = false;
      ufo.timer = 12 + Math.random() * 14;
    }
  }

  /* --- Draw ------------------------------------------------------------ */
  function draw(ctx) {
    g.clear(C.black);

    drawStars(ctx);
    drawHud(ctx);
    drawShields(ctx);
    drawFormation(ctx);
    drawUfo(ctx);
    drawShots(ctx);
    drawPlayer(ctx);
    drawFx(ctx);

    if (banner && g.state === "running") drawBanner(ctx);

    if (g.state === "idle") {
      panel(ctx, "INVADERS", "PRESS ENTER", C.amber, "BEST " + pad(g.best, 5));
    } else if (g.state === "paused") {
      panel(ctx, "PAUSED", "PRESS P TO RESUME", C.teal, "SCORE " + pad(g.score, 5));
    } else if (g.state === "over" || g.state === "won") {
      panel(ctx, g.state === "won" ? "YOU WIN" : "GAME OVER", "PRESS ENTER",
            newBest ? C.amber : C.red,
            (newBest ? "BEST " : "SCORE ") + pad(g.score, 5));
    }
  }

  function drawStars(ctx) {
    ctx.fillStyle = C.dark;
    for (var i = 0; i < stars.length; i++) {
      ctx.fillRect(stars[i].x, stars[i].y, 1, 1);
    }
  }

  /* One-pixel outline. Drawn locally because Engine.prototype.frame() is
     shadowed by the engine's frame counter on every instance. */
  function outline(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, w | 0, 1);
    ctx.fillRect(x | 0, (y | 0) + h - 1, w | 0, 1);
    ctx.fillRect(x | 0, y | 0, 1, h | 0);
    ctx.fillRect((x | 0) + w - 1, y | 0, 1, h | 0);
  }

  /* Meter of invaders left in the wave. */
  function meter(ctx, x, y, w, h, ratio, fg) {
    g.rect(x, y, w, h, C.night);
    outline(ctx, x, y, w, h, C.dark);
    var fill = Math.max(0, Math.min(1, ratio)) * (w - 2);
    g.rect(x + 1, y + 1, Math.round(fill), h - 2, fg);
  }

  function drawHud(ctx) {
    g.text("SCORE", 1, 1, 8, C.grey);
    g.text(pad(g.score, 5), 43, 1, 8, C.bone);
    g.text("HI", 98, 1, 8, C.grey);
    g.text(pad(Math.max(g.best, g.score), 5), 116, 1, 8, C.amber);

    g.text("WAVE", 1, 10, 8, C.grey);
    g.text(pad(wave, 2), 35, 10, 8, C.bone);

    meter(ctx, 58, 11, 48, 5, aliveCount / TOTAL, aliveCount > 10 ? C.teal : C.orange);

    var lives = Math.max(0, g.lives);
    if (lives > 6) {
      g.text("x" + lives, 132, 10, 8, C.bone);
    } else {
      for (var i = 0; i < lives; i++) {
        g.sprite(CANNON_ICON, 141 + i * 6, 10, { "#": C.amber });
      }
    }

    g.rect(0, HUD_H - 1, W, 1, C.dark);
  }

  function drawShields(ctx) {
    ctx.fillStyle = C.teal;
    for (var i = 0; i < shields.length; i++) {
      var s = shields[i];
      for (var r = 0; r < s.h; r++) {
        var bits = s.rows[r];
        if (!bits) continue;
        var c = 0;
        while (c < s.w) {
          if (bits & (1 << c)) {
            var start = c;
            while (c < s.w && (bits & (1 << c))) c++;
            ctx.fillRect(s.x + start, s.y + r, c - start, 1);
          } else {
            c++;
          }
        }
      }
    }
  }

  function drawFormation(ctx) {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var a = grid[r][c];
        if (!a.alive) continue;
        var sp = SPECIES[a.sp];
        var map = { "#": sp.color };
        g.sprite(sp.frames[anim], a.x, a.y, map);
      }
    }
  }

  function drawUfo(ctx) {
    if (!ufo.active) return;
    var col = (g.frame >> 3) % 2 === 0 ? C.pink : C.amber;
    g.sprite(UFO, ufo.x, HUD_H + 1, { "#": col });
  }

  function drawShots(ctx) {
    if (bullet) g.rect(bullet.x, bullet.y, 1, BULLET_H, C.white);
    for (var i = 0; i < bombs.length; i++) {
      g.sprite(BOMB[bombs[i].f], bombs[i].x, bombs[i].y, { "#": C.red });
    }
  }

  function drawPlayer(ctx) {
    if (freeze > 0) return;
    g.sprite(CANNON, player.x, player.y, { "#": C.amber });
  }

  function drawFx(ctx) {
    var i;
    for (i = 0; i < bursts.length; i++) {
      var b = bursts[i];
      var t = 1 - b.life / b.max;
      var rad = Math.round(t * 7);
      if (b.life > b.max * 0.55) {
        ctx.fillStyle = C.bone;
        ctx.fillRect((b.x - 1) | 0, (b.y - 1) | 0, 3, 3);
      }
      g.px(b.x - rad, b.y, b.color);
      g.px(b.x + rad, b.y, b.color);
      g.px(b.x, b.y - rad, b.color);
      g.px(b.x, b.y + rad, b.color);
      var q = Math.round(rad * 0.7);
      g.px(b.x - q, b.y - q, b.color);
      g.px(b.x + q, b.y - q, b.color);
      g.px(b.x - q, b.y + q, b.color);
      g.px(b.x + q, b.y + q, b.color);
    }
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
    }
  }

  function drawBanner(ctx) {
    var boxW = Math.min(W - 8, Math.max(g.textWidth(banner.title, 16) + 16,
                                         g.textWidth(banner.sub, 8) + 16));
    var bx = ((W - boxW) / 2) | 0;
    var by = 60;
    ctx.fillStyle = C.black;
    ctx.fillRect(bx, by, boxW, 36);
    outline(ctx, bx, by, boxW, 36, banner.color);
    g.textShadow(banner.title, W / 2 - (banner.title.length * 8), by + 6, 16, banner.color, C.night, "left");
    g.text(banner.sub, W / 2, by + 24, 8, C.bone, "center");
  }

  /* Overlay panel. ctx is threaded through every helper. */
  function panel(ctx, title, sub, color, third) {
    ctx.save();
    ctx.globalAlpha = 0.84;
    ctx.fillStyle = C.black;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.fillStyle = color;
    ctx.fillText(title, W / 2, H / 2 - 26);
    var blink = (Date.now() % 640) < 360;
    if (sub && (sub.indexOf("PRESS") !== 0 || blink)) {
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillStyle = C.bone;
      ctx.fillText(sub, W / 2, H / 2 + 2);
    }
    if (third) {
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillStyle = C.amber;
      ctx.fillText(third, W / 2, H / 2 + 16);
    }
  }

  /* --- Engine ---------------------------------------------------------- */
  var g = new Arcade.Engine(canvas, {
    width: W,
    height: H,
    bestKey: "invaders",
    onStart: function () {
      newGame();
    },
    onUpdate: update,
    onDraw: draw,
    onScore: function () { syncHud(); },
    onState: function (s) {
      pauseBtn.textContent = s === "paused" ? "Resume" : "Pause";
      pauseBtn.setAttribute("aria-pressed", String(s === "paused"));
      if (s === "paused") setStatus("Paused - press P or tap Resume", "info");
      else if (s === "running") setStatus("Wave " + wave + " - " + aliveCount + " invaders left", "play");
    }
  });

  resetModel();
  setStatus("Press Enter or tap Start to play", "info");
  syncHud();

  /* --- Shell wiring ---------------------------------------------------- */
  startBtn.addEventListener("click", function () {
    g.toggle();
    startBtn.blur();
  });

  pauseBtn.addEventListener("click", function () {
    if (g.state === "running" || g.state === "paused") g.toggle();
    else g.start();
    pauseBtn.blur();
  });

  /* The engine tracks P as "start" but never toggles pause, so we do it here
     in the capture phase - otherwise the engine's own handler would also fire. */
  document.addEventListener("keydown", function (e) {
    if (e.code !== "KeyP" && e.code !== "Escape") return;
    if (g.state !== "running" && g.state !== "paused") return;
    e.preventDefault();
    e.stopPropagation();
    g.toggle();
  }, true);

  /* Resizing the viewport clears the backing store and the engine only
     repaints while the loop is running, so repaint the idle/paused/over art. */
  window.addEventListener("resize", function () {
    if (g.state !== "running") g.render();
  });

  /* --- Pointer: drag to move, tap to fire ------------------------------- */
  function dragTo(clientX) {
    var r = canvas.getBoundingClientRect();
    if (!r.width) return;
    var x = ((clientX - r.left) / r.width) * W;
    player.x = Math.max(0, Math.min(W - PLAYER_W, Math.round(x - PLAYER_W / 2)));
  }

  screenEl.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (g.state === "idle") g.start();
    else if (g.state === "over" || g.state === "won") g.restart();
    dragging = true;
    pointerDown = true;
    pointerFire = true;
    g.sound.unlock();
    dragTo(e.clientX);
    tryFire();
    if (screenEl.setPointerCapture) {
      try { screenEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  });

  screenEl.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    e.preventDefault();
    dragTo(e.clientX);
  });

  function endPointer(e) {
    if (e && e.cancelable) e.preventDefault();
    if (!dragging) return;
    dragging = false;
    pointerDown = false;
    pointerFire = false;
  }
  screenEl.addEventListener("pointerup", endPointer);
  screenEl.addEventListener("pointercancel", endPointer);
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);

  Arcade.bindPad(g);
  Arcade.initSoundButton(soundBtn, g);
  Arcade.ready(function () { g.render(); });
})();
