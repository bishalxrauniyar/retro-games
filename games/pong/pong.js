/* pong.js — Pong. Reference implementation of the Arcade engine. */
(function () {
  "use strict";

  var W = 160, H = 144;
  var WIN = 11;
  var C = Arcade.palette;

  var canvas = document.getElementById("game");
  var statusEl = document.getElementById("status");
  var p1El = document.getElementById("sP1");
  var p2El = document.getElementById("sP2");
  var bestEl = document.getElementById("sBest");
  var startBtn = document.getElementById("start");
  var modeBtn = document.getElementById("mode");
  var soundBtn = document.getElementById("sound");

  /* --- Model ----------------------------------------------------------- */
  var paddleW = 3, paddleH = 16;
  var ballSize = 3;

  var p1, p2, ball, score1, score2, twoPlayer, serveTimer, rally;

  function makePaddle(x) {
    return { x: x, y: H / 2 - paddleH / 2, w: paddleW, h: paddleH, vy: 0 };
  }

  function resetBall(dir) {
    var speed = 1.5;
    var angle = (Math.random() * 0.5 - 0.25) * Math.PI / 3;
    ball = {
      x: W / 2 - ballSize / 2,
      y: H / 2 - ballSize / 2,
      w: ballSize,
      h: ballSize,
      vx: Math.cos(angle) * speed * dir,
      vy: Math.sin(angle) * speed
    };
    rally = 0;
  }

  /* --- Game lifecycle -------------------------------------------------- */
  function newGame() {
    p1 = makePaddle(8);
    p2 = makePaddle(W - 8 - paddleW);
    score1 = 0;
    score2 = 0;
    serveTimer = 0.6;
    resetBall(1);
    statusEl.textContent = twoPlayer ? "Player 1 serves" : "Get ready";
    statusEl.className = "status status--play";
  }

  function point(forPlayer) {
    if (forPlayer === 1) score1++; else score2++;
    syncHud();
    g.sound.cue("score");
    g.shake(2);
    g.flash(forPlayer === 1 ? "#2ee6c8" : "#ff2e4d", 60);

    if (score1 >= WIN || score2 >= WIN) {
      var youWon = score1 >= WIN;
      g.addScore(Math.max(0, (WIN - score2) * 10 + (WIN - score1) * 2));
      syncHud();
      if (youWon) {
        g.over(true);
        g.sound.cue("clear");
        statusEl.textContent = "You win " + score1 + "-" + score2 + "!";
        statusEl.className = "status status--win";
      } else {
        g.over(false);
        g.sound.cue("die");
        statusEl.textContent = "CPU wins " + score2 + "-" + score1 + ". Press Enter to play again";
        statusEl.className = "status status--over";
      }
      return;
    }
    serveTimer = 0.7;
    // Serve toward whoever just conceded.
    resetBall(forPlayer === 1 ? -1 : 1);
    statusEl.textContent = twoPlayer
      ? (forPlayer === 1 ? "Player 1 scores" : "Player 2 scores")
      : (forPlayer === 1 ? "You score" : "CPU scores");
  }

  function syncHud() {
    p1El.textContent = String(score1);
    p2El.textContent = twoPlayer ? String(score2) : String(score2);
    bestEl.textContent = String(g.best);
  }

  /* --- Update ---------------------------------------------------------- */
  function update(dt) {
    var speed = 3.1;

    // Player 1: up/down (and the pad)
    movePaddle(p1, (g.held("down") ? 1 : 0) - (g.held("up") ? 1 : 0), speed);
    // Player 2: W/S
    movePaddle(p2, (g.held("altDown") ? 1 : 0) - (g.held("altUp") ? 1 : 0), speed);

    // CPU predicts where the ball will cross its face and chases that point.
    // Its top speed sits above the ball's, so long rallies stay winnable.
    if (!twoPlayer) {
      var target;
      if (serveTimer > 0 || ball.vx <= 0) {
        target = H / 2; // ball isn't coming, or we're serving
      } else {
        target = interceptY(ball, p2.x);
        // Human error: large early, tiny once the rally is long.
        var err = (2.5 - Math.min(2.0, rally * 0.12)) * (Math.random() * 2 - 1);
        target += err;
      }
      var p2mid = p2.y + p2.h / 2;
      var diff = target - p2mid;
      var top = 2.6 + Math.min(1.4, rally * 0.15);
      var step = Math.abs(diff) < 1 ? 0 : Math.sign(diff) * Math.min(Math.abs(diff), top);
      movePaddle(p2, step, 1);
    }

    if (serveTimer > 0) {
      serveTimer -= dt;
      if (serveTimer <= 0) g.sound.cue("bounce");
      return;
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    // Walls
    if (ball.y <= 0) { ball.y = 0; ball.vy = Math.abs(ball.vy); g.sound.cue("bounce"); }
    if (ball.y + ball.h >= H) { ball.y = H - ball.h; ball.vy = -Math.abs(ball.vy); g.sound.cue("bounce"); }

    // Paddles
    hits(p1, 1);
    hits(p2, -1);

    // Scoring
    if (ball.x < -ball.w) point(2);
    else if (ball.x > W) point(1);
  }

  function movePaddle(p, dir, speed) {
    p.y += dir * speed;
    if (p.y < 0) p.y = 0;
    if (p.y + p.h > H) p.y = H - p.h;
  }

  /* Where will the ball be when its left edge reaches column `x`? Accounts
     for the top and bottom walls, which the ball bounces off indefinitely. */
  function interceptY(b, x) {
    var t = (x - b.x) / b.vx;
    var y = b.y + b.vy * t;
    var span = H - b.h;
    if (span <= 0) return H / 2;
    var m = (((y - b.h / 2) % (2 * span)) + 2 * span) % (2 * span);
    return (m <= span ? m : 2 * span - m) + b.h / 2;
  }

  /* Returns true if the ball rebounded off `p` this step. */
  function hits(p, side) {
    if (ball.vx * side <= 0) return false;
    if (ball.x + ball.w < p.x || ball.x > p.x + p.w) return false;
    if (ball.y + ball.h < p.y || ball.y > p.y + p.h) return false;

    // Rebound angle depends on where the ball struck the paddle face.
    var rel = (ball.y + ball.h / 2 - (p.y + p.h / 2)) / (p.h / 2);
    if (rel < -1) rel = -1;
    if (rel > 1) rel = 1;

    rally++;
    var spd = Math.min(3.4, 1.5 + rally * 0.075);
    var ang = rel * 0.85; // up to ~49 degrees
    ball.vx = Math.cos(ang) * spd * side;
    ball.vy = Math.sin(ang) * spd;
    ball.x = side === 1 ? p.x + p.w : p.x - ball.w;
    g.sound.cue("bounce");
    g.shake(1);
    return true;
  }

  /* --- Draw ------------------------------------------------------------ */
  function draw(ctx) {
    ctx.fillStyle = "#05050a";
    ctx.fillRect(0, 0, W, H);

    // Centre dashed net
    ctx.fillStyle = "#2c2c4a";
    for (var y = 4; y < H; y += 8) ctx.fillRect(W / 2, y, 1, 4);

    drawPaddle(ctx, p1, C.teal);
    drawPaddle(ctx, p2, twoPlayer ? C.red : C.orange);

    ctx.fillStyle = C.white;
    ctx.fillRect(ball.x | 0, ball.y | 0, ball.w, ball.h);

    if (g.state === "idle") {
      panel(ctx, "PONG", "PRESS ENTER", C.amber);
    } else if (g.state === "paused") {
      panel(ctx, "PAUSED", "PRESS P TO RESUME", C.teal);
    } else if (g.state === "over" || g.state === "won") {
      panel(ctx, score1 > score2 ? "YOU WIN" : "GAME OVER", "PRESS ENTER", score1 > score2 ? C.green : C.red);
    } else if (serveTimer > 0) {
      ctx.textAlign = "center";
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillStyle = C.bone;
      ctx.fillText("GET READY", W / 2, H / 2 - 4);
    }
  }

  function drawPaddle(ctx, p, color) {
    ctx.fillStyle = color;
    ctx.fillRect(p.x | 0, p.y | 0, p.w, p.h);
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
    bestKey: "pong",
    onStart: function () {
      newGame();
      g.sound.cue("start");
      syncHud();
    },
    onUpdate: update,
    onDraw: draw,
    onScore: function () { syncHud(); }
  });

  twoPlayer = false;
  newGame();
  syncHud();

  /* --- Shell wiring ---------------------------------------------------- */
  startBtn.addEventListener("click", function () {
    g.toggle();
    startBtn.blur();
  });

  modeBtn.addEventListener("click", function () {
    twoPlayer = !twoPlayer;
    modeBtn.textContent = twoPlayer ? "Mode: 2P" : "Mode: 1P";
    modeBtn.setAttribute("aria-pressed", String(twoPlayer));
    if (g.state !== "idle") {
      newGame();
      syncHud();
    }
    g.sound.cue("select");
    modeBtn.blur();
  });

  Arcade.bindPad(g);
  Arcade.initSoundButton(soundBtn, g);

  /* Drag anywhere on the screen to move your paddle. */
  var screen = document.getElementById("screen");
  function dragTo(clientY) {
    var r = canvas.getBoundingClientRect();
    if (!r.height) return;
    var y = ((clientY - r.top) / r.height) * H;
    p1.y = y - p1.h / 2;
    if (p1.y < 0) p1.y = 0;
    if (p1.y + p1.h > H) p1.y = H - p1.h;
  }
  var dragging = false;
  screen.addEventListener("pointerdown", function (e) {
    dragging = true;
    if (g.state === "idle") g.start();
    dragTo(e.clientY);
    screen.setPointerCapture(e.pointerId);
  });
  screen.addEventListener("pointermove", function (e) { if (dragging) dragTo(e.clientY); });
  screen.addEventListener("pointerup", function () { dragging = false; });
  screen.addEventListener("pointercancel", function () { dragging = false; });

  Arcade.ready(function () { g.render(); });
})();
