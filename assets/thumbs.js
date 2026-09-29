/* ==========================================================================
   thumbs.js — animated pixel-art thumbnails for the home page game cards.

   Each card holds <canvas data-thumb="snake">. This draws a tiny looping
   diorama of that game, so the shelf previews the real thing instead of
   showing a static icon. Everything is drawn on a 2px grid at 80x60 and
   scaled up by CSS with image-rendering: pixelated.

   Kept separate from engine.js: the home page should not pay for the
   game loop, the sound engine, or the input layer.
   ========================================================================== */
(function () {
  "use strict";

  var C = {
    ink: "#f2f2f7",
    amber: "#ffd23f",
    teal: "#2ee6c8",
    red: "#ff2e4d",
    green: "#22c55e",
    blue: "#4f6df5",
    purple: "#9b5cf6",
    pink: "#ff5cc8",
    wall: "#2c2c4a",
    dim: "#6f6f88"
  };

  /* --- Tiny drawing helpers (integer coords only) ------------------------ */
  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  /* Classic arcade sprite: a 2px-scaled blocky shape from a string map. */
  function sprite(ctx, map, x, y, color, scale) {
    scale = scale || 2;
    ctx.fillStyle = color;
    for (var r = 0; r < map.length; r++) {
      for (var c = 0; c < map[r].length; c++) {
        if (map[r][c] !== "#") continue;
        ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
      }
    }
  }

  /* --- Sprites ------------------------------------------------------------ */
  var SNAKE_HEAD = [
    "  ####  ",
    " #######",
    "########",
    "########",
    " ###### ",
    "  ####  ",
    "   ##   "
  ];

  var ALIEN = [
    "..#..",
    ".###.",
    "#####",
    "#.#.#",
    "#####",
    "..#..",
    ".#.#."
  ];

  /* Tetrominoes, each 4 wide. */
  var SHAPES = {
    I: ["####"],
    O: ["##", "##"],
    T: [".#.", "###"],
    S: [".##", "##."],
    Z: ["##.", ".##"]
  };
  var SHAPE_COLORS = { I: C.teal, O: C.amber, T: C.purple, S: C.green, Z: C.red };
  var SHAPE_KEYS = ["I", "O", "T", "S", "Z"];

  /* --- Scenes ------------------------------------------------------------
     Each scene gets (ctx, t) where t is elapsed seconds. Draw inside the
     80x60 logical box. */
  var scenes = {

    /* Snake: a body that grows behind a head that chases an apple. */
    snake: function (ctx, t) {
      rect(ctx, 0, 0, 80, 60, "#05050a");
      for (var y = 6; y < 56; y += 8) rect(ctx, 0, y, 80, 1, "#10101e");

      // Apple blinks in and out on a fixed corner grid.
      var ax = 66, ay = 46;
      if (Math.floor(t * 2) % 2 === 0) {
        rect(ctx, ax, ay, 8, 8, C.red);
        rect(ctx, ax + 6, ay - 2, 2, 3, C.green);
      }

      // Head travels a rounded rectangle loop.
      var loop = 56, p = (t * 14) % (loop * 2);
      var hx, hy;
      if (p < loop) { hx = 6 + p; hy = 6; }
      else if (p < loop * 2) { hx = 6 + loop; hy = 6 + (p - loop); }
      else { hx = 6 + (loop * 2 - p); hy = 6 + loop; }
      // Snap to the 2px grid so the sprite never shears.
      hx = Math.round(hx / 2) * 2;
      hy = Math.round(hy / 2) * 2;

      // Body trails behind the head along the same path.
      for (var i = 5; i >= 1; i--) {
        var q = p - i * 9;
        if (q < 0) q += loop * 3;
        var bx, by;
        if (q < loop) { bx = 6 + q; by = 6; }
        else if (q < loop * 2) { bx = 6 + loop; by = 6 + (q - loop); }
        else { bx = 6 + (loop * 3 - q); by = 6 + loop; }
        rect(ctx, Math.round(bx / 2) * 2, Math.round(by / 2) * 2, 6, 6,
             i === 1 ? C.green : C.teal);
      }
      sprite(ctx, SNAKE_HEAD, hx - 1, hy - 1, C.green, 1);
    },

    /* Pong: paddles track the ball, score flickers. */
    pong: function (ctx, t) {
      rect(ctx, 0, 0, 80, 60, "#05050a");
      // Centre dashed net.
      for (var y = 4; y < 56; y += 8) rect(ctx, 39, y, 2, 4, C.dim);

      // Ball ping-pongs vertically; both paddles ease toward it.
      var ball = (t * 42) % 104 - 12;
      var by = Math.max(4, Math.min(52, ball));
      var py = Math.max(4, Math.min(48, by - 8));

      rect(ctx, 4, py, 3, 16, C.teal);
      rect(ctx, 73, py, 3, 16, C.amber);
      rect(ctx, 36, by, 6, 6, C.ink);

      // Two score pips that blink like a real scoreboard.
      for (var s = 0; s < 2; s++) {
        if (Math.floor(t * 3 + s) % 3 === 0) {
          rect(ctx, s === 0 ? 16 : 58, 6, 6, C.dim);
        }
      }
    },

    /* Breakout: bricks, a ball, and a paddle that tracks it. */
    breakout: function (ctx, t) {
      rect(ctx, 0, 0, 80, 60, "#05050a");
      rect(ctx, 0, 55, 80, 1, C.dim);

      // Brick wall, one column blinks out as the ball works through it.
      var gone = Math.floor(t * 1.5) % 8;
      for (var row = 0; row < 4; row++) {
        for (var col = 0; col < 8; col++) {
          if (row * 8 + col < gone) continue;
          var color = row === 0 ? C.red : row === 1 ? C.amber
                    : row === 2 ? C.green : C.teal;
          rect(ctx, 8 + col * 8, 6 + row * 6, 6, 4, color);
        }
      }

      var bx = 20 + ((t * 40) % 48);
      var by = 34 + Math.sin(t * 3) * 12;
      var px = Math.max(6, Math.min(68, bx - 8));
      rect(ctx, Math.round(px), 50, 16, 3, C.ink);
      rect(ctx, Math.round(bx), Math.round(by), 4, 4, C.amber);
    },

    /* Space Invaders: a rank that shuffles and sways, a firing laser. */
    invaders: function (ctx, t) {
      rect(ctx, 0, 0, 80, 60, "#05050a");
      rect(ctx, 0, 56, 80, 2, C.green);

      // The whole rank sways side to side; a row marches on its own.
      var sway = Math.round(Math.sin(t * 1.6) * 6);
      var march = Math.floor(t * 2) % 2;
      for (var row = 0; row < 3; row++) {
        for (var col = 0; col < 6; col++) {
          var color = row === 0 ? C.red : row === 1 ? C.pink : C.teal;
          var x = 8 + col * 12 + sway + (row === 2 ? march * 2 : 0);
          sprite(ctx, ALIEN, x, 8 + row * 10, color, 2);
        }
      }

      // Cannon locked to the left, firing a blinking bolt on a beat.
      rect(ctx, 6, 50, 12, 5, C.amber);
      rect(ctx, 9, 46, 6, 4, C.amber);
      if (t % 1 < 0.25) {
        for (var y = 18; y < 46; y += 4) rect(ctx, 11, y, 2, 2, C.ink);
      }
    },

    /* Tetris: a board filling up under a falling piece. */
    tetris: function (ctx, t) {
      rect(ctx, 0, 0, 80, 60, "#05050a");
      rect(ctx, 52, 0, 2, 60, C.wall);
      rect(ctx, 54, 0, 2, 60, C.wall);

      // Settled stack, drawn bottom-up with a per-column height.
      var heights = [3, 2, 4, 1, 3, 5, 2, 4];
      for (var col = 0; col < 8; col++) {
        for (var r = 0; r < heights[col]; r++) {
          var y = 54 - r * 6;
          rect(ctx, 6 + col * 6, y, 4, 4,
               r === heights[col] - 1 ? C.dim : C.blue);
        }
      }

      // Next piece cycles while it drops toward the stack.
      var key = SHAPE_KEYS[Math.floor(t * 1.2) % SHAPE_KEYS.length];
      var shape = SHAPES[key];
      var drop = 6 + ((t * 26) % 42);
      for (var sr = 0; sr < shape.length; sr++) {
        for (var sc = 0; sc < shape[sr].length; sc++) {
          if (shape[sr][sc] !== "#") continue;
          rect(ctx, 12 + sc * 4, Math.round(drop / 2) * 2 + sr * 4, 4, 4,
               SHAPE_COLORS[key]);
        }
      }
    },

    /* Pac-Man: chomping Pac chases a trail of pellets past a ghost. */
    pacman: function (ctx, t) {
      rect(ctx, 0, 0, 80, 60, "#05050a");

      // A short slice of maze rather than the full grid.
      var walls = [
        [0, 8, 80, 2], [0, 30, 22, 2], [26, 30, 28, 2],
        [62, 30, 18, 2], [0, 50, 34, 2], [42, 50, 38, 2],
        [14, 8, 2, 12], [64, 8, 2, 12], [40, 12, 2, 10]
      ];
      for (var w = 0; w < walls.length; w++) {
        rect(ctx, walls[w][0], walls[w][1], walls[w][2], walls[w][3], C.blue);
      }

      // Pellets blink in pairs along the corridor.
      for (var i = 0; i < 9; i++) {
        if (Math.floor(t * 3 + i) % 2) continue;
        rect(ctx, 4 + i * 8, 26, 2, 2, "#ffe9b0");
      }
      // A power pellet, pulsing.
      if (Math.floor(t * 4) % 2 === 0) rect(ctx, 68, 46, 4, 4, C.amber);

      // Pac chases right; the chomp is just the mouth wedge opening/closing.
      var px = 8 + ((t * 26) % 52);
      var mouth = Math.floor(t * 8) % 2 ? 3 : 0;
      ctx.fillStyle = C.amber;
      ctx.beginPath();
      ctx.moveTo(px, 38);
      ctx.arc(px + 2, 42, 6, mouth * 0.12, Math.PI * 2 - mouth * 0.12);
      ctx.closePath();
      ctx.fill();

      // Ghost trails behind him, bobbing on the classic wave.
      for (var g = 0; g < 2; g++) {
        var gx = px - 14 - g * 12;
        if (gx < -10) continue;
        var gy = 42 + Math.sin(t * 4 + g) * 2;
        var gc = g === 0 ? C.red : C.pink;
        rect(ctx, gx, gy - 2, 10, 9, gc);
        rect(ctx, gx, gy + 7, 10, 2, gc);
        rect(ctx, gx, gy + 7, 2, 2, "#05050a");
        rect(ctx, gx + 4, gy + 7, 2, 2, "#05050a");
        rect(ctx, gx + 2, gy + 1, 2, 2, "#f2f2f7");
        rect(ctx, gx + 6, gy + 1, 2, 2, "#f2f2f7");
      }
    }
  };

  /* --- Boot --------------------------------------------------------------- */
  function paint(canvas) {
    var name = canvas.getAttribute("data-thumb");
    var scene = scenes[name];
    if (!scene) return null;
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Never let a thumbnail dominate a page: stop when it's off screen.
    var visible = true;
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }).observe(canvas);
    }
    return { ctx: ctx, scene: scene, visible: visible };
  }

  function start() {
    var reduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var items = [].slice.call(document.querySelectorAll("[data-thumb]")).map(function (c) {
      var p = paint(c);
      if (p) p.t0 = performance.now();
      return p;
    }).filter(Boolean);

    if (!items.length) return;

    // Under prefers-reduced-motion, paint one static frame each and stop.
    if (reduced) {
      items.forEach(function (p) { p.scene(p.ctx, 0); });
      return;
    }

    var loop = function (now) {
      for (var i = 0; i < items.length; i++) {
        var p = items[i];
        if (!p.visible) continue;
        p.ctx.clearRect(0, 0, 80, 60);
        p.scene(p.ctx, (now - p.t0) / 1000);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
