/* snake.js — Snake, rebuilt on the shared Arcade engine. */
(function () {
  "use strict";

  var W = 160, H = 144;
  var C = Arcade.palette;

  var CELL = 6;
  var COLS = 22;
  var ROWS = 18;
  var OX = 14;           // maze offset, centred in the 160px width
  var OY = 22;           // leaves a HUD strip along the top

  var START_LEN = 4;
  var POINTS = 10;
  var STEP_START = 0.15; // seconds per step at the start
  var STEP_MIN = 0.055;

  var canvas = document.getElementById("game");
  var screen = document.getElementById("screen");
  var statusEl = document.getElementById("status");
  var scoreEl = document.getElementById("sScore");
  var bestEl = document.getElementById("sBest");
  var lenEl = document.getElementById("sLen");
  var livesEl = document.getElementById("sLives");
  var startBtn = document.getElementById("start");
  var soundBtn = document.getElementById("sound");

  var DIRS = {
    left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]
  };
  var OPPOSITE = { left: "right", right: "left", up: "down", down: "up" };

  var snake, dir, queue, food, acc, lives, dead, deathTimer, blink;

  /* ---------------------------------------------------------------------
     Model
     --------------------------------------------------------------------- */
  function newSnake() {
    var midY = Math.floor(ROWS / 2);
    var midX = Math.floor(COLS / 2);
    snake = [];
    for (var i = 0; i < START_LEN; i++) {
      snake.push({ x: midX - i, y: midY });
    }
    dir = DIRS.right;
    queue = [];
    placeFood();
    acc = 0;
  }

  function placeFood() {
    var open = [];
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (!hits(x, y)) open.push([x, y]);
      }
    }
    food = open.length ? open[(Math.random() * open.length) | 0] : null;
  }

  function hits(x, y) {
    for (var i = 0; i < snake.length; i++) {
      if (snake[i].x === x && snake[i].y === y) return true;
    }
    return false;
  }

  function stepTime() {
    // Ramps with score so long snakes stay tense but survivable.
    return Math.max(STEP_MIN, STEP_START - Math.floor(snake.length / 4) * 0.004);
  }

  function startRun() {
    lives = 3;
    dead = false;
    deathTimer = 0;
    newSnake();
    syncHud();
    setStatus("Go!", "play");
  }

  function loseLife(reason) {
    dead = true;
    deathTimer = 0.85;
    g.sound.cue("die");
    g.shake(3);
    g.flash(C.red, 90);
    setStatus(reason, "over");
  }

  function continueAfterDeath() {
    lives--;
    syncHud();
    if (lives <= 0) {
      g.over(false);
      setStatus("Game over. Score " + g.score + ". Press Enter to play again", "over");
      return;
    }
    dead = false;
    newSnake();
    setStatus(lives + (lives === 1 ? " life left" : " lives left"), "play");
  }

  function syncHud() {
    scoreEl.textContent = String(g.score);
    bestEl.textContent = String(g.best);
    lenEl.textContent = String(snake.length);
    livesEl.textContent = String(Math.max(0, lives));
  }

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = "status status--" + (kind || "info");
  }

  /* ---------------------------------------------------------------------
     Update
     --------------------------------------------------------------------- */
  function update(dt) {
    blink += dt;

    // Steering and pause both read as per-frame key edges.
    if (g.hit("left")) steer("left");
    if (g.hit("right")) steer("right");
    if (g.hit("up")) steer("up");
    if (g.hit("down")) steer("down");
    if (g.hit("fire")) { g.pause(); return; }

    if (dead) {
      deathTimer -= dt;
      if (deathTimer <= 0) continueAfterDeath();
      return;
    }

    if (food === null) {
      // Board full — that is a win.
      g.over(true);
      g.sound.cue("clear");
      setStatus("Board cleared! Perfect run.", "win");
      return;
    }

    acc += dt;
    var st = stepTime();
    var guard = 0;
    while (acc >= st && guard < 4) {
      acc -= st;
      guard++;
      advance();
      if (dead || g.state !== "running") return;
    }
  }

  function advance() {
    if (queue.length) dir = queue.shift();

    var head = { x: snake[0].x + dir[0], y: snake[0].y + dir[1] };

    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) {
      return loseLife("You hit the wall.");
    }

    // The tail vacates its cell this tick, so it is not a collision.
    var body = snake.slice(0, -1);
    for (var i = 0; i < body.length; i++) {
      if (body[i].x === head.x && body[i].y === head.y) {
        return loseLife("You ran into yourself.");
      }
    }

    snake.unshift(head);

    if (head.x === food[0] && head.y === food[1]) {
      g.addScore(POINTS);
      g.sound.cue("pickup");
      g.shake(1);
      syncHud();
      placeFood();
    } else {
      snake.pop();
    }
  }

  function steer(name) {
    if (!DIRS[name]) return;
    // A heading is only valid if it isn't a reversal of the last one queued.
    var ref = queue.length ? dirName(queue[queue.length - 1]) : dirName(dir);
    if (OPPOSITE[ref] === name) return;
    if (queue.length < 2) queue.push(DIRS[name]);
  }

  function dirName(d) {
    if (d === DIRS.left) return "left";
    if (d === DIRS.right) return "right";
    if (d === DIRS.up) return "up";
    if (d === DIRS.down) return "down";
    return "";
  }

  /* ---------------------------------------------------------------------
     Draw
     --------------------------------------------------------------------- */
  function draw(ctx) {
    ctx.fillStyle = C.black;
    ctx.fillRect(0, 0, W, H);

    // HUD strip
    ctx.textAlign = "left";
    g.text("SCORE " + pad(g.score), 6, 6, 8, C.bone);
    g.text("HI " + pad(g.best), 78, 6, 8, C.amber);
    g.text("LIVES", 126, 6, 8, C.grey);
    for (var i = 0; i < Math.max(0, lives); i++) {
      ctx.fillStyle = C.teal;
      ctx.fillRect(126 + 34 + i * 7, 7, 4, 4);
    }

    // Playfield border
    ctx.fillStyle = C.blue;
    ctx.fillRect(OX - 2, OY - 2, COLS * CELL + 4, 1);
    ctx.fillRect(OX - 2, OY + ROWS * CELL + 1, COLS * CELL + 4, 1);
    ctx.fillRect(OX - 2, OY - 2, 1, ROWS * CELL + 4);
    ctx.fillRect(OX + COLS * CELL + 1, OY - 2, 1, ROWS * CELL + 4);

    ctx.fillStyle = "#08080f";
    ctx.fillRect(OX, OY, COLS * CELL, ROWS * CELL);

    // Food blinks so it reads as alive
    if (food && !dead && ((blink * 6) | 0) % 2 === 0) {
      ctx.fillStyle = C.red;
      ctx.fillRect(OX + food[0] * CELL + 1, OY + food[1] * CELL + 1, CELL - 2, CELL - 2);
    }

    // Snake
    for (var s = snake.length - 1; s >= 0; s--) {
      var seg = snake[s];
      var t = snake.length > 1 ? s / (snake.length - 1) : 0;
      ctx.fillStyle = s === 0 ? C.lime : mix(C.green, "#0f6b3a", t);
      var x = OX + seg.x * CELL;
      var y = OY + seg.y * CELL;
      ctx.fillRect(x, y, CELL - 1, CELL - 1);
    }

    // Eyes, so the head's heading is obvious
    if (snake[0]) {
      var h = snake[0];
      var hx = OX + h.x * CELL;
      var hy = OY + h.y * CELL;
      var cx = hx + CELL / 2 + dir[0] * 1.4;
      var cy = hy + CELL / 2 + dir[1] * 1.4;
      var px = -dir[1], py = dir[0];
      ctx.fillStyle = C.black;
      ctx.fillRect(Math.round(cx + px * 1.4) - 1, Math.round(cy + py * 1.4) - 1, 1, 1);
      ctx.fillRect(Math.round(cx - px * 1.4) - 1, Math.round(cy - py * 1.4) - 1, 1, 1);
    }

    // Death wipe
    if (dead) {
      var cut = Math.floor((1 - deathTimer / 0.85) * snake.length);
      for (var d2 = 0; d2 < cut && d2 < snake.length; d2++) {
        var sg = snake[d2];
        ctx.fillStyle = "#08080f";
        ctx.fillRect(OX + sg.x * CELL, OY + sg.y * CELL, CELL - 1, CELL - 1);
      }
    }

    if (g.state === "idle") panel(ctx, "SNAKE", "PRESS ENTER", C.lime);
    else if (g.state === "paused") panel(ctx, "PAUSED", "PRESS P", C.teal);
    else if (g.state === "over") panel(ctx, "GAME OVER", "PRESS ENTER", C.red);
    else if (g.state === "won") panel(ctx, "CLEARED!", "PRESS ENTER", C.green);
  }

  function pad(n) {
    var s = String(n);
    while (s.length < 4) s = "0" + s;
    return s;
  }

  function mix(a, b, t) {
    var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    var r = Math.round(((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t);
    var gg = Math.round(((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t);
    var bb = Math.round((pa & 255) + ((pb & 255) - (pa & 255)) * t);
    return "rgb(" + r + "," + gg + "," + bb + ")";
  }

  function panel(ctx, title, sub, color) {
    ctx.fillStyle = "rgba(8,8,15,0.8)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.fillStyle = color;
    ctx.fillText(title, W / 2, H / 2 - 14);
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.fillStyle = C.bone;
    ctx.fillText(sub, W / 2, H / 2 + 10);
  }

  /* ---------------------------------------------------------------------
     Engine + shell
     --------------------------------------------------------------------- */
  var g = new Arcade.Engine(canvas, {
    width: W,
    height: H,
    bestKey: "snake",
    onStart: function () {
      startRun();
      g.sound.cue("start");
    },
    onUpdate: update,
    onDraw: draw,
    onScore: syncHud
  });

  lives = 3;
  dead = false;
  deathTimer = 0;
  blink = 0;
  newSnake();
  syncHud();

  startBtn.addEventListener("click", function () { g.toggle(); startBtn.blur(); });
  Arcade.bindPad(g);
  Arcade.initSoundButton(soundBtn, g);

  /* Pause/resume has to work from a keydown listener, because update() only
     runs while the engine is already in the running state. */
  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "KeyP" || e.code === "Escape" || e.code === "Space") {
      if (g.state === "running") g.pause();
      else if (g.state === "paused") g.resume();
    }
  });

  /* Swipe anywhere on the screen to turn. */
  var sx = 0, sy = 0, swiping = false;
  screen.addEventListener("pointerdown", function (e) {
    if (g.state === "idle") g.start();
    sx = e.clientX; sy = e.clientY; swiping = true;
    screen.setPointerCapture(e.pointerId);
  });
  screen.addEventListener("pointermove", function (e) {
    if (!swiping) return;
    var dx = e.clientX - sx;
    var dy = e.clientY - sy;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
    sx = e.clientX; sy = e.clientY;
  });
  screen.addEventListener("pointerup", function () { swiping = false; });
  screen.addEventListener("pointercancel", function () { swiping = false; });

  Arcade.ready(function () { g.render(); });
})();
