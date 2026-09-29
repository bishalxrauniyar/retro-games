/* breakout.js — Breakout. Vanilla, no dependencies. */
(function () {
  "use strict";

  var W = 160, H = 144;
  var CEIL = 10;              // top border thickness
  var COLS = 9, ROWS = 6;
  var BRICK_W = 14, BRICK_H = 5, GAP = 2;
  var FIELD_X = Math.floor((W - (COLS * BRICK_W + (COLS - 1) * GAP)) / 2); // 9
  var FIELD_Y = 16;
  var PADDLE_Y = 132, PADDLE_H = 4;
  var PADDLE_W = 22, PADDLE_WIDE = 34;
  var PADDLE_SPEED = 2.7;
  var BALL = 2;
  var LIVES = 3;
  var MAX_BALLS = 6;
  var FINAL_LEVEL = 10;
  var WIDE_TIME = 12;         // seconds
  var SLOW_TIME = 8;
  var MIN_AXIS = 0.45;        // keeps the ball out of the horizontal / vertical lock
  var C = Arcade.palette;
  var ROW_COLORS = [C.red, C.orange, C.amber, C.lime, C.teal, C.blue];

  var canvas = document.getElementById("game");
  var statusEl = document.getElementById("status");
  var scoreEl = document.getElementById("sScore");
  var levelEl = document.getElementById("sLevel");
  var livesEl = document.getElementById("sLives");
  var bestEl = document.getElementById("sBest");
  var startBtn = document.getElementById("start");
  var soundBtn = document.getElementById("sound");
  var screenEl = document.getElementById("screen");

  /* --- Power-up sprites (7x7, one letter per colour) -------------------- */
  var PU = {
    wide: {
      sprite: [
        "WWWWWWW",
        "W.....W",
        "W.WWW.W",
        "W.W.W.W",
        "W.W.W.W",
        "W.WWW.W",
        "WWWWWWW"
      ],
      map: { W: C.teal }, label: "WIDE"
    },
    multi: {
      sprite: [
        "..MMM..",
        ".M...M.",
        "MM.M.MM",
        "M.....M",
        "MM.M.MM",
        ".M...M.",
        "..MMM.."
      ],
      map: { M: C.purple }, label: "MULTI"
    },
    bonus: {
      sprite: [
        "..$$$..",
        ".$...$.",
        "$$.$$$$",
        "$..$..$",
        "$$.$$$$",
        "$.....$",
        ".$$.$$."
      ],
      map: { $: C.amber }, label: "BONUS"
    },
    life: {
      sprite: [
        "..LLL..",
        "..LLL..",
        "LLLLLLL",
        "LLLLLLL",
        "..LLL..",
        "..LLL..",
        "..LLL.."
      ],
      map: { L: C.lime }, label: "1UP"
    },
    slow: {
      sprite: [
        "SSSSSSS",
        "S.....S",
        "S.SSS.S",
        "S.S...S",
        "S.SSS.S",
        "S.....S",
        "SSSSSSS"
      ],
      map: { S: C.pink }, label: "SLOW"
    }
  };
  var PU_ORDER = ["wide", "multi", "bonus", "life", "slow"];

  /* --- Model ----------------------------------------------------------- */
  var paddle, balls, bricks, drops, sparks;
  var level, serving, serveDir, wideT, slowT, busy;   // busy = brief level transition
  var bricksLeft, clearedFlash;

  function makeBall(x, y, vx, vy) {
    return { x: x, y: y, vx: vx, vy: vy };
  }

  function paddleW() { return wideT > 0 ? PADDLE_WIDE : PADDLE_W; }

  function resetPaddle() {
    paddle = { x: Math.floor((W - PADDLE_W) / 2), w: PADDLE_W, y: PADDLE_Y, h: PADDLE_H };
  }

  function resetBall() {
    var ang = (-Math.PI / 2) + (Math.random() * 0.7 - 0.35);
    balls = [];
    balls.push(makeBall(paddle.x + (paddle.w / 2) - BALL / 2, paddle.y - BALL - 1,
      Math.cos(ang) * 1.2, Math.sin(ang) * 1.2));
    serving = true;
    serveDir = Math.random() < 0.5 ? -1 : 1;
  }

  function speedBase() { return 1.22 + Math.min(0.45, (level - 1) * 0.05); }

  function speedCap() { return 2.55; }

  /* --- Level generation ------------------------------------------------ */
  /* Deterministic PRNG so a given level always looks the same. */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* Returns a COLS x ROWS boolean grid for the pattern index. */
  function pattern(kind) {
    var grid = [], r, c, mid = (COLS - 1) / 2, mrow = (ROWS - 1) / 2;
    for (r = 0; r < ROWS; r++) {
      grid.push([]);
      for (c = 0; c < COLS; c++) {
        var on;
        switch (kind) {
          case 0: on = true; break;                                     // solid
          case 1: on = ((r + c) % 2) === 0; break;                       // checker
          case 2: on = Math.abs(c - mid) <= r; break;                    // pyramid
          case 3: on = Math.abs(c - mid) <= 2 && r >= 1; break;          // inner core
          case 4: on = ((c + r) % 3) !== 2; break;                       // stripes
          case 5: on = (c % 2) === (r % 2); break;                       // weave
          case 6: on = Math.abs(c - mid) + Math.abs(r - mrow) <= mrow + 0.5; break; // diamond
          default: on = c <= r || c >= COLS - 1 - r; break;              // hourglass
        }
        grid[r].push(on);
      }
    }
    return grid;
  }

  function buildLevel(n) {
    var rnd = rng(n * 7919 + 13);
    var kind = (n - 1) % 8;
    var grid = pattern(kind);
    var armorRows = n >= 6 ? 2 : (n >= 3 ? 1 : 0);
    var armorChance = n >= 8 ? 0.5 : (n >= 4 ? 0.34 : 0.2);
    var holes = n >= 9 ? 1 : (n >= 5 ? 2 : 0);

    // Punch a couple of deterministic holes so later levels feel denser but
    // not like a solid wall.
    for (var i = 0; i < holes; i++) {
      var hr = Math.floor(rnd() * ROWS);
      var hc = Math.floor(rnd() * COLS);
      var span = 1 + Math.floor(rnd() * 2);
      for (var k = 0; k < span && hc + k < COLS; k++) grid[hr][hc + k] = false;
    }

    bricks = [];
    bricksLeft = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (!grid[r][c]) continue;
        var hp = (r < armorRows && rnd() < armorChance) ? 2 : 1;
        bricks.push({
          x: FIELD_X + c * (BRICK_W + GAP),
          y: FIELD_Y + r * (BRICK_H + GAP),
          w: BRICK_W,
          h: BRICK_H,
          hp: hp,
          max: hp,
          color: ROW_COLORS[r % ROW_COLORS.length],
          alive: true
        });
        bricksLeft++;
      }
    }

    // Safety net: no pattern should ever produce a near-empty field.
    if (bricksLeft < 12) {
      for (var r2 = ROWS - 1; r2 >= 0 && bricksLeft < 16; r2--) {
        for (var c2 = 0; c2 < COLS; c2++) {
          if (!grid[r2][c2]) { grid[r2][c2] = true; }
        }
        bricksLeft = 0;
        for (var q = 0; q < ROWS; q++) {
          for (var z = 0; z < COLS; z++) { if (grid[q][z]) bricksLeft++; }
        }
      }
      bricks = [];
      bricksLeft = 0;
      for (var r3 = 0; r3 < ROWS; r3++) {
        for (var c3 = 0; c3 < COLS; c3++) {
          if (!grid[r3][c3]) continue;
          var hp3 = (r3 < armorRows && rnd() < armorChance) ? 2 : 1;
          bricks.push({
            x: FIELD_X + c3 * (BRICK_W + GAP),
            y: FIELD_Y + r3 * (BRICK_H + GAP),
            w: BRICK_W, h: BRICK_H,
            hp: hp3, max: hp3,
            color: ROW_COLORS[r3 % ROW_COLORS.length],
            alive: true
          });
          bricksLeft++;
        }
      }
    }
  }

  /* --- Game lifecycle --------------------------------------------------- */
  function newGame() {
    level = 1;
    wideT = 0;
    slowT = 0;
    busy = 0;
    clearedFlash = 0;
    sparks = [];
    drops = [];
    resetPaddle();
    buildLevel(level);
    resetBall();
    g.lives = LIVES;
    setStatus("Level 1 — press Space to launch", "play");
    syncHud();
  }

  function nextLevel() {
    level++;
    if (level > FINAL_LEVEL) {
      g.addScore(500);
      g.over(true);
      g.sound.cue("extra");
      setStatus("All ten layouts cleared! Score " + g.score, "win");
      return;
    }
    buildLevel(level);
    drops = [];
    wideT = 0;
    slowT = 0;
    g.addScore(100 * level + 25 * Math.max(0, g.lives));
    g.flash(C.lime, 120);
    g.sound.cue("levelup");
    setStatus("Level " + level + " — " + bricksLeft + " bricks", "play");
    syncHud();
  }

  function loseLife() {
    g.lives--;
    wideT = 0;
    slowT = 0;
    drops = [];
    g.sound.cue("die");
    g.shake(3);
    g.flash(C.red, 110);
    syncHud();
    if (g.lives <= 0) {
      g.over(false);
      setStatus("Game over — " + g.score + " points. Press Enter to play again", "over");
      return;
    }
    resetPaddle();
    resetBall();
    setStatus(g.lives + (g.lives === 1 ? " life left" : " lives left"), "info");
  }

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "status status--" + kind;
  }

  function syncHud() {
    scoreEl.textContent = String(g.score);
    levelEl.textContent = String(Math.min(level, FINAL_LEVEL));
    livesEl.textContent = String(Math.max(0, g.lives));
    bestEl.textContent = String(g.best);
  }

  /* --- Ball helpers ----------------------------------------------------- */
  /* Force the velocity off the axes so the ball can never lock into a
     perfectly horizontal or vertical loop. */
  function sanitize(b) {
    var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (sp < 0.0001) { b.vx = 0.9; b.vy = -0.9; return; }
    var nx = b.vx / sp, ny = b.vy / sp;
    if (Math.abs(ny) < MIN_AXIS) ny = (ny < 0 ? -1 : 1) * MIN_AXIS;
    if (Math.abs(nx) < 0.3) nx = (nx < 0 ? -1 : 1) * 0.3;
    var len = Math.sqrt(nx * nx + ny * ny);
    b.vx = (nx / len) * sp;
    b.vy = (ny / len) * sp;
  }

  function rampSpeed(b, gain) {
    var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy) + gain;
    if (sp > speedCap()) sp = speedCap();
    var len = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (len < 0.0001) return;
    b.vx = (b.vx / len) * sp;
    b.vy = (b.vy / len) * sp;
    sanitize(b);
  }

  function launch() {
    if (!serving) return;
    serving = false;
    var b = balls[0];
    var spread = serveDir * (0.55 + Math.random() * 0.45);
    var ang = -Math.PI / 2 + (serveDir > 0 ? spread : -spread);
    var sp = speedBase();
    b.vx = Math.cos(ang) * sp;
    b.vy = Math.sin(ang) * sp;
    sanitize(b);
    g.sound.cue("shoot");
    setStatus("Level " + level + " — " + bricksLeft + " bricks", "play");
  }

  function puff(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      sparks.push({
        x: x, y: y,
        vx: (Math.random() * 2 - 1) * 1.1,
        vy: -Math.random() * 1.2,
        life: 0.3 + Math.random() * 0.3,
        color: color
      });
    }
  }

  /* --- Update ---------------------------------------------------------- */
  function update(dt) {
    // "P" and Space are also start keys, so ignore a pause edge on the very
    // first frames of a run.
    if (g.time > 0.3 && g.hit("pause")) { g.pause(); return; }

    wideT = Math.max(0, wideT - dt);
    slowT = Math.max(0, slowT - dt);
    if (clearedFlash > 0) clearedFlash -= dt;

    if (busy > 0) {
      busy -= dt;
      if (busy <= 0) nextLevel();
      return;
    }

    movePaddle(g.axisX());

    if (serving) {
      if (g.hit("fire")) launch();
      for (var s = 0; s < balls.length; s++) {
        balls[s].x = paddle.x + (paddle.w / 2) - BALL / 2;
        balls[s].y = paddle.y - BALL - 1;
      }
    } else {
      stepBalls();
    }

    stepDrops();
    stepSparks(dt);
  }

  function movePaddle(dir) {
    if (!dir) return;
    paddle.x += dir * PADDLE_SPEED;
    if (paddle.x < 2) { paddle.x = 2; }
    if (paddle.x + paddle.w > W - 2) paddle.x = W - 2 - paddle.w;
  }

  /* Called by the pointer handler and by the keyboard. */
  function setPaddleCenter(cx) {
    var w = paddleW();
    var x = Math.round(cx - w / 2);
    if (x < 2) x = 2;
    if (x + w > W - 2) x = W - 2 - w;
    paddle.x = x;
    if (wideT > 0) paddle.w = w;
    else paddle.w = PADDLE_W;
    if (serving) {
      for (var i = 0; i < balls.length; i++) {
        balls[i].x = paddle.x + (paddle.w / 2) - BALL / 2;
        balls[i].y = paddle.y - BALL - 1;
      }
    }
  }

  function stepBalls() {
    var slow = slowT > 0 ? 0.62 : 1;
    for (var i = balls.length - 1; i >= 0; i--) {
      var b = balls[i];
      var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      var steps = Math.max(1, Math.ceil((sp * slow) / 1.1));
      var dead = false;
      for (var s = 0; s < steps && !dead; s++) {
        b.x += b.vx * slow / steps;
        b.y += b.vy * slow / steps;
        collideWalls(b);
        collidePaddle(b);
        collideBricks(b);
        if (b.y > H) dead = true;
      }
      if (dead) balls.splice(i, 1);
    }

    if (balls.length === 0) loseLife();
  }

  function collideWalls(b) {
    if (b.x < 1) { b.x = 1; b.vx = Math.abs(b.vx); g.sound.cue("bounce"); }
    if (b.x + BALL > W - 1) { b.x = W - 1 - BALL; b.vx = -Math.abs(b.vx); g.sound.cue("bounce"); }
    if (b.y < CEIL) { b.y = CEIL; b.vy = Math.abs(b.vy); g.sound.cue("bounce"); }
  }

  function collidePaddle(b) {
    if (b.vy <= 0) return;
    if (b.y + BALL < paddle.y) return;
    if (b.y > paddle.y + paddle.h) return;
    if (b.x + BALL < paddle.x || b.x > paddle.x + paddle.w) return;

    // Rebound angle depends on where the ball struck the face.
    var half = paddle.w / 2;
    var rel = ((b.x + BALL / 2) - (paddle.x + half)) / half;
    if (rel < -1) rel = -1;
    if (rel > 1) rel = 1;
    var ang = rel * 1.05;          // up to ~60 degrees, steep on edge hits
    var dir = rel === 0 ? (serveDir || 1) : (rel < 0 ? -1 : 1);
    b.vx = Math.cos(ang) * dir;
    b.vy = -Math.abs(Math.sin(ang));
    var len = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    b.vx /= len;
    b.vy /= len;
    if (Math.abs(b.vy) < 0.001) b.vy = -1;
    b.y = paddle.y - BALL;
    rampSpeed(b, 0.06);
    g.sound.cue("bounce");
    g.shake(1);
    serveDir = b.vx < 0 ? -1 : 1;
  }

  function collideBricks(b) {
    for (var i = 0; i < bricks.length; i++) {
      var k = bricks[i];
      if (!k.alive) continue;
      if (b.x + BALL <= k.x || b.x >= k.x + k.w) continue;
      if (b.y + BALL <= k.y || b.y >= k.y + k.h) continue;

      // Resolve on the axis of least penetration.
      var overX = Math.min(b.x + BALL - k.x, k.x + k.w - b.x);
      var overY = Math.min(b.y + BALL - k.y, k.y + k.h - b.y);
      if (overX < overY) {
        b.vx = -b.vx;
        b.x = b.vx > 0 ? k.x - BALL : k.x + k.w;
      } else {
        b.vy = -b.vy;
        b.y = b.vy > 0 ? k.y - BALL : k.y + k.h;
      }
      sanitize(b);
      hitBrick(i, b);
      return;
    }
  }

  function hitBrick(i, b) {
    var k = bricks[i];
    k.hp--;
    if (k.hp > 0) {
      g.addScore(5);
      g.sound.cue("hit");
      g.shake(2);
      puff(b.x + BALL / 2, b.y + BALL / 2, C.grey, 3);
      syncHud();
      return;
    }
    k.alive = false;
    bricksLeft--;
    var pts = (k.max > 1 ? 25 : 10) * Math.max(1, level);
    g.addScore(pts);
    g.sound.cue("score");
    g.shake(1);
    puff(b.x + BALL / 2, b.y + BALL / 2, k.color, 5);
    rampSpeed(b, 0.02);
    if (Math.random() < 0.17) dropPower(k);
    syncHud();
    if (bricksLeft <= 0) {
      clearedFlash = 0.6;
      busy = 1.0;
      g.flash(C.amber, 120);
      g.addScore(50 * level);
    }
  }

  function dropPower(k) {
    var type = PU_ORDER[Math.floor(Math.random() * PU_ORDER.length)];
    if (type === "wide" && wideT > 0) type = "bonus";
    if (type === "slow" && slowT > 0) type = "bonus";
    drops.push({
      x: k.x + ((k.w - 7) >> 1),
      y: k.y,
      w: 7, h: 7,
      vy: 0.5,
      type: type
    });
  }

  function stepDrops() {
    for (var i = drops.length - 1; i >= 0; i--) {
      var d = drops[i];
      d.y += d.vy;
      if (d.y > H) { drops.splice(i, 1); continue; }
      if (d.y + d.h < paddle.y || d.x + d.w < paddle.x || d.x > paddle.x + paddle.w) continue;
      collect(d);
      drops.splice(i, 1);
    }
  }

  function collect(d) {
    var def = PU[d.type];
    g.sound.cue("pickup");
    g.flash(def.map[Object.keys(def.map)[0]], 70);
    puff(d.x + 3, d.y + 3, def.map[Object.keys(def.map)[0]], 4);
    if (d.type === "wide") {
      wideT = WIDE_TIME;
      setStatus("WIDE paddle!", "play");
    } else if (d.type === "multi") {
      splitBalls();
      setStatus("MULTI ball x" + balls.length, "play");
    } else if (d.type === "bonus") {
      g.addScore(150);
      setStatus("BONUS 150", "play");
    } else if (d.type === "life") {
      if (g.lives < 5) g.lives++;
      else g.addScore(300);
      setStatus("Extra life!", "play");
    } else if (d.type === "slow") {
      slowT = SLOW_TIME;
      setStatus("SLOW ball field", "play");
    }
    syncHud();
  }

  function splitBalls() {
    if (!balls.length) return;
    var seeds = balls.slice(0, balls.length);
    for (var i = 0; i < seeds.length && balls.length < MAX_BALLS; i++) {
      var src = seeds[i];
      var base = Math.atan2(src.vy, src.vx);
      for (var k = 1; k <= 2 && balls.length < MAX_BALLS; k++) {
        var a = base + (k === 1 ? 0.38 : -0.38);
        var sp = Math.sqrt(src.vx * src.vx + src.vy * src.vy);
        var nb = makeBall(src.x, src.y, Math.cos(a) * sp, Math.sin(a) * sp);
        sanitize(nb);
        balls.push(nb);
      }
    }
  }

  function stepSparks(dt) {
    for (var i = sparks.length - 1; i >= 0; i--) {
      var s = sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.06;
      s.life -= dt;
      if (s.life <= 0) sparks.splice(i, 1);
    }
  }

  /* --- Draw ------------------------------------------------------------ */
  function draw(ctx) {
    g.clear(C.black);

    // Ceiling band with a highlight line.
    g.rect(0, 0, W, CEIL, C.night);
    g.rect(0, CEIL - 1, W, 1, C.dark);
    ctx.textAlign = "left";
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.fillStyle = C.grey;
    ctx.fillText("LV" + Math.min(level, FINAL_LEVEL), 3, 2);

    drawBricks(ctx);
    drawDrops(ctx);
    drawPaddle(ctx);
    drawBalls(ctx);
    drawSparks(ctx);
    drawLives(ctx);

    if (g.state === "idle") {
      panel(ctx, "BREAKOUT", "PRESS ENTER", C.amber);
    } else if (g.state === "paused") {
      panel(ctx, "PAUSED", "PRESS P TO RESUME", C.teal);
    } else if (g.state === "over" || g.state === "won") {
      panel(ctx, g.state === "won" ? "YOU WIN" : "GAME OVER", "PRESS ENTER", g.state === "won" ? C.green : C.red);
      ctx.textAlign = "center";
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillStyle = C.bone;
      ctx.fillText("SCORE " + g.score + "  BEST " + g.best, W / 2, H / 2 + 24);
    } else if (busy > 0) {
      ctx.textAlign = "center";
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillStyle = C.amber;
      ctx.fillText(clearedFlash > 0 ? "LEVEL CLEAR" : "LEVEL " + (level + 1), W / 2, H / 2 - 4);
    } else if (serving) {
      ctx.textAlign = "center";
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillStyle = C.bone;
      ctx.fillText("PRESS SPACE", W / 2, H / 2 - 20);
    }

    if (wideT > 0 || slowT > 0) drawTimers(ctx);
  }

  function drawBricks(ctx) {
    for (var i = 0; i < bricks.length; i++) {
      var k = bricks[i];
      if (!k.alive) continue;
      var dmg = k.max > 1 && k.hp === 1;
      g.rect(k.x, k.y, k.w, k.h, dmg ? C.grey : k.color);
      g.rect(k.x + 1, k.y + 1, k.w - 2, 1, dmg ? C.dark : C.bone);
      if (k.max > 1 && !dmg) {
        g.rect(k.x + 2, k.y + 2, 2, 2, C.dark);
        g.rect(k.x + k.w - 4, k.y + 2, 2, 2, C.dark);
      } else if (dmg) {
        g.rect(k.x + k.w - 4, k.y + 2, 2, 2, C.black);
      }
    }
  }

  function drawDrops(ctx) {
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      var def = PU[d.type];
      g.sprite(def.sprite, d.x | 0, d.y | 0, def.map, 1);
    }
  }

  function drawPaddle(ctx) {
    var w = paddleW();
    paddle.w = w;
    var col = wideT > 0 ? C.amber : C.teal;
    g.rect(paddle.x - 1, paddle.y + 1, w + 2, paddle.h + 2, C.dark);
    g.rect(paddle.x, paddle.y, w, paddle.h, col);
    g.rect(paddle.x, paddle.y, w, 1, C.bone);
    if (wideT > 0) {
      g.rect(paddle.x - 2, paddle.y + 1, 1, paddle.h - 2, col);
      g.rect(paddle.x + w + 1, paddle.y + 1, 1, paddle.h - 2, col);
    }
  }

  function drawBalls(ctx) {
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      // subtle glow: a slightly larger darker rect behind the ball
      g.rect((b.x | 0) - 1, (b.y | 0) - 1, BALL + 2, BALL + 2, C.dark);
      g.rect(b.x | 0, b.y | 0, BALL, BALL, slowT > 0 ? C.cyan : C.bone);
    }
  }

  function drawSparks(ctx) {
    for (var i = 0; i < sparks.length; i++) {
      var s = sparks[i];
      g.px(s.x | 0, s.y | 0, s.color);
    }
  }

  function drawLives(ctx) {
    for (var i = 0; i < Math.max(0, g.lives) && i < 5; i++) {
      var x = 3 + i * 9;
      g.rect(x, H - 4, 7, 2, C.teal);
    }
  }

  function drawTimers(ctx) {
    var x = W - 22;
    if (wideT > 0) {
      g.bar(x, 2, 18, 3, wideT / WIDE_TIME, C.teal, C.night);
    }
    if (slowT > 0) {
      g.bar(x, 6, 18, 3, slowT / SLOW_TIME, C.cyan, C.night);
    }
  }

  function panel(ctx, title, sub, color) {
    ctx.fillStyle = "rgba(5,5,10,0.78)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.fillStyle = color;
    ctx.fillText(title, W / 2, H / 2 - 14);
    if ((g.frame >> 4) % 2 === 0 || sub.indexOf("PRESS") !== 0) {
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillStyle = C.bone;
      ctx.fillText(sub, W / 2, H / 2 + 10);
    }
  }

  /* --- Engine ---------------------------------------------------------- */
  var g = new Arcade.Engine(canvas, {
    width: W,
    height: H,
    bestKey: "breakout",
    lives: LIVES,
    onStart: function () {
      newGame();
      g.sound.cue("start");
      syncHud();
    },
    onUpdate: update,
    onDraw: draw,
    onScore: function () { syncHud(); }
  });

  newGame();
  syncHud();

  /* --- Shell wiring ---------------------------------------------------- */
  startBtn.addEventListener("click", function () {
    g.toggle();
    startBtn.blur();
  });

  /* The engine only ticks while running, so un-pause from a raw key event. */
  document.addEventListener("keydown", function (e) {
    if (g.state !== "paused") return;
    var code = e.code;
    if (code === "KeyP" || code === "Escape" || code === "Enter" || code === "Space") {
      g.resume();
      e.preventDefault();
    }
  });

  Arcade.bindPad(g);
  Arcade.initSoundButton(soundBtn, g);

  /* Pointer: drag anywhere on the screen to steer, tap to launch. */
  var dragging = false;
  function dragTo(clientX) {
    var r = canvas.getBoundingClientRect();
    if (!r.width) return;
    var x = ((clientX - r.left) / r.width) * W;
    setPaddleCenter(x);
  }
  screenEl.addEventListener("pointerdown", function (e) {
    dragging = true;
    if (g.state === "idle") g.start();
    dragTo(e.clientX);
    if (serving) launch();
    screenEl.setPointerCapture(e.pointerId);
  });
  screenEl.addEventListener("pointermove", function (e) {
    if (dragging || e.pointerType === "mouse") dragTo(e.clientX);
  });
  screenEl.addEventListener("pointerup", function () { dragging = false; });
  screenEl.addEventListener("pointercancel", function () { dragging = false; });

  Arcade.ready(function () { g.render(); });
})();
