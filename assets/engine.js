/* ==========================================================================
   engine.js — tiny shared arcade engine.
   Fixed-timestep loop, integer pixel scaling, keyboard + touch input,
   Web Audio blips, pixel-art helpers. No dependencies.
   Exposes window.Arcade.
   ========================================================================== */
(function (global) {
  "use strict";

  /* ---------------------------------------------------------------------
     Sound — tiny Web Audio synth. Lazily unlocked by the first gesture so
     it never trips autoplay policy.
     --------------------------------------------------------------------- */
  function Sound() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
  }

  Sound.prototype.unlock = function () {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
  };

  Sound.prototype.setMuted = function (m) {
    this.muted = !!m;
    if (this.master) this.master.gain.value = m ? 0 : 0.32;
  };

  /* Square-wave blip — the workhorse retro sound. */
  Sound.prototype.blip = function (freq, dur, type, vol, delay) {
    if (!this.ctx || this.muted) return;
    var t0 = this.ctx.currentTime + (delay || 0);
    var osc = this.ctx.createOscillator();
    var gain = this.ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol == null ? 0.3 : vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  /* Pitch slide — used for pickups, jumps, deaths. */
  Sound.prototype.slide = function (from, to, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    var t0 = this.ctx.currentTime;
    var osc = this.ctx.createOscillator();
    var gain = this.ctx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    gain.gain.setValueAtTime(vol == null ? 0.28 : vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  };

  /* Filtered noise burst — explosions, thuds. */
  Sound.prototype.noise = function (dur, vol, freq) {
    if (!this.ctx || this.muted) return;
    var t0 = this.ctx.currentTime;
    var len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    var src = this.ctx.createBufferSource();
    src.buffer = buf;
    var filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(freq || 1400, t0);
    filt.frequency.exponentialRampToValueAtTime(180, t0 + dur);
    var gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol == null ? 0.3 : vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(gain);
    gain.connect(this.master);
    src.start(t0);
  };

  /* Play a list of [freq, dur, delay] steps. */
  Sound.prototype.seq = function (steps, type, vol) {
    for (var i = 0; i < steps.length; i++) {
      this.blip(steps[i][0], steps[i][1], type, vol, steps[i][2]);
    }
  };

  /* Named cues, so games don't hardcode frequencies. */
  Sound.prototype.cue = function (name) {
    switch (name) {
      case "move":    this.blip(440, 0.04, "square", 0.16); break;
      case "bounce":  this.blip(660, 0.05, "square", 0.2); break;
      case "score":   this.slide(520, 1040, 0.1, "square", 0.24); break;
      case "pickup":  this.seq([[660, 0.05, 0], [880, 0.05, 0.05], [1180, 0.07, 0.1]]); break;
      case "place":   this.blip(300, 0.05, "square", 0.2); break;
      case "lock":    this.blip(180, 0.07, "triangle", 0.25); break;
      case "clear":   this.seq([[523, 0.07, 0], [659, 0.07, 0.07], [784, 0.07, 0.14], [1046, 0.12, 0.21]]); break;
      case "shoot":   this.slide(900, 260, 0.09, "sawtooth", 0.18); break;
      case "hit":     this.noise(0.22, 0.3, 1800); this.blip(160, 0.14, "square", 0.2); break;
      case "explode": this.noise(0.45, 0.34, 1200); break;
      case "die":     this.slide(420, 60, 0.55, "sawtooth", 0.28); break;
      case "levelup": this.seq([[392, 0.06, 0], [523, 0.06, 0.06], [659, 0.06, 0.12], [784, 0.14, 0.18]]); break;
      case "start":   this.seq([[392, 0.08, 0], [523, 0.08, 0.09], [659, 0.14, 0.18]]); break;
      case "select":  this.blip(760, 0.05, "square", 0.2); break;
      case "extra":   this.seq([[880, 0.06, 0], [1100, 0.06, 0.07], [1320, 0.06, 0.14], [1760, 0.12, 0.21]]); break;
      default:        this.blip(600, 0.05, "square", 0.2);
    }
  };

  /* ---------------------------------------------------------------------
     Engine
     --------------------------------------------------------------------- */
  var ACTIONS = {
    up:    ["ArrowUp", "KeyW"],
    down:  ["ArrowDown", "KeyS"],
    left:  ["ArrowLeft", "KeyA"],
    right: ["ArrowRight", "KeyD"],
    fire:  ["Space", "KeyJ", "KeyZ", "KeyX"],
    start: ["Enter", "Space", "KeyP"],
    pause: ["KeyP", "Escape"],
    /* Alternate bindings, for two-player games sharing one keyboard. */
    altUp:   ["KeyW"],
    altDown: ["KeyS"],
    altLeft: ["KeyA"],
    altRight:["KeyD"]
  };
  var SCROLL_KEYS = {
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1
  };

  function Engine(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.W = opts.width || 160;
    this.H = opts.height || 144;
    this.scale = 1;
    this.fps = opts.fps || 60;
    this.step = 1000 / this.fps;

    this.state = "idle"; // idle | running | paused | over | won
    this.frame = 0;
    this.time = 0;      // seconds since the run began
    this.score = 0;
    this.lives = opts.lives || 0;

    this.best = 0;
    this.bestKey = opts.bestKey || null;
    if (this.bestKey) this.best = this.loadBest(this.bestKey);

    this.sound = new Sound();
    this.keys = Object.create(null);   // physical keys held
    this.pressed = Object.create(null); // actions pressed this frame
    this.vkeys = Object.create(null);  // on-screen pad held
    this.vpressed = Object.create(null);
    this.anyPressed = false;

    this._shake = 0;
    this._shakeMax = 0;
    this._flash = null;
    this._acc = 0;
    this._last = 0;
    this._raf = 0;
    this._running = false;

    this._on = {
      update: opts.onUpdate || null,
      draw: opts.onDraw || null,
      start: opts.onStart || null,
      pause: opts.onPause || null,
      resume: opts.onResume || null,
      over: opts.onOver || null,
      win: opts.onWin || null,
      score: opts.onScore || null,
      state: opts.onState || null
    };

    this._codeToActions = Object.create(null);
    for (var act in ACTIONS) {
      for (var i = 0; i < ACTIONS[act].length; i++) {
        var code = ACTIONS[act][i];
        // One physical key can drive several actions (WASD plus a second
        // player's W/S), so each code maps to a list.
        (this._codeToActions[code] || (this._codeToActions[code] = [])).push(act);
      }
    }

    this._bind();
    this.resize();
  }

  /* --- Storage --------------------------------------------------------- */
  Engine.prototype.loadBest = function (key) {
    try { return parseInt(localStorage.getItem("arcade." + key), 10) || 0; }
    catch (e) { return 0; }
  };
  Engine.prototype.saveBest = function (key) {
    try { localStorage.setItem("arcade." + key, String(this.best)); } catch (e) { /* ignore */ }
  };

  /* --- Scaling --------------------------------------------------------- */
  Engine.prototype.resize = function () {
    var host = this.canvas.parentElement || this.canvas;
    var availW = host.clientWidth;
    if (!availW) return;

    // Round *down* to a whole number so every pixel stays square, but allow a
    // fractional scale when the viewport is narrower than the logical size.
    var s = availW / this.W;
    this.scale = s >= 1 ? Math.floor(s) : s;

    this.canvas.width = Math.round(this.W * this.scale);
    this.canvas.height = Math.round(this.H * this.scale);
    this.canvas.style.width = Math.round(this.W * this.scale) + "px";
    this.canvas.style.height = Math.round(this.H * this.scale) + "px";
    this.ctx.imageSmoothingEnabled = false;
    if (this._running) this.render();
  };

  /* --- Input ----------------------------------------------------------- */
  Engine.prototype._bind = function () {
    var self = this;

    this._onKeyDown = function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target && e.target.tagName;
      if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      if (SCROLL_KEYS[e.key]) e.preventDefault();

      self.sound.unlock();
      var acts = self._codeToActions[e.code];
      if (!acts) return;
      for (var i = 0; i < acts.length; i++) {
        if (!self.keys[acts[i]]) {
          self.pressed[acts[i]] = true;
          self._maybeAutoStart(acts[i]);
        }
        self.keys[acts[i]] = true;
      }
      self.anyPressed = true;
    };

    this._onKeyUp = function (e) {
      var acts = self._codeToActions[e.code];
      if (!acts) return;
      for (var i = 0; i < acts.length; i++) self.keys[acts[i]] = false;
    };

    this._onBlur = function () {
      self.keys = Object.create(null);
      self.vkeys = Object.create(null);
      if (self.state === "running") self.pause();
    };

    this._onVisibility = function () {
      if (document.hidden && self.state === "running") self.pause();
    };

    this._onResize = function () { self.resize(); };

    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    document.addEventListener("visibilitychange", this._onVisibility);
    window.addEventListener("resize", this._onResize);
  };

  /* A first key press while idle should drop us into the game. */
  Engine.prototype._maybeAutoStart = function (act) {
    if (this.state === "idle") this.start();
    else if (this.state === "over" || this.state === "won") {
      if (act === "start" || act === "fire") this.restart();
    }
  };

  /* On-screen pad: hold-to-repeat is handled by the caller. */
  Engine.prototype.padDown = function (act) {
    this.sound.unlock();
    if (!this.vkeys[act]) {
      this.vpressed[act] = true;
      this.anyPressed = true;
      this._maybeAutoStart(act);
    }
    this.vkeys[act] = true;
  };
  Engine.prototype.padUp = function (act) { this.vkeys[act] = false; };

  Engine.prototype.held = function (act) {
    return !!(this.keys[act] || this.vkeys[act]);
  };
  Engine.prototype.hit = function (act) {
    return !!(this.pressed[act] || this.vpressed[act]);
  };
  /* -1, 0 or 1 on one axis, from either keyboard or pad. */
  Engine.prototype.axisX = function () {
    return (this.held("right") ? 1 : 0) - (this.held("left") ? 1 : 0);
  };
  Engine.prototype.axisY = function () {
    return (this.held("down") ? 1 : 0) - (this.held("up") ? 1 : 0);
  };

  /* --- State ----------------------------------------------------------- */
  Engine.prototype.setState = function (s) {
    if (this.state === s) return;
    this.state = s;
    if (this._on.state) this._on.state(s);
  };

  Engine.prototype.start = function () {
    if (this.state === "running") return;
    if (this.state === "over" || this.state === "won") return this.restart();
    this.setState("running");
    this._acc = 0;
    this._last = performance.now();
    if (this._on.start) this._on.start();
    this._ensureLoop();
  };

  Engine.prototype.restart = function () {
    this.score = 0;
    this.frame = 0;
    this.time = 0;
    this.setState("running");
    this._acc = 0;
    this._last = performance.now();
    if (this._on.start) this._on.start();
    this._ensureLoop();
  };

  Engine.prototype.pause = function () {
    if (this.state !== "running") return;
    this.setState("paused");
    if (this._on.pause) this._on.pause();
  };

  Engine.prototype.resume = function () {
    if (this.state !== "paused") return;
    this.setState("running");
    this._last = performance.now();
    this._acc = 0;
    if (this._on.resume) this._on.resume();
    this._ensureLoop();
  };

  Engine.prototype.toggle = function () {
    if (this.state === "running") this.pause();
    else if (this.state === "paused") this.resume();
    else this.start();
  };

  /* End the run. `win` is optional. */
  Engine.prototype.over = function (win) {
    if (this.state === "over" || this.state === "won") return;
    if (this.bestKey && this.score > this.best) {
      this.best = this.score;
      this.saveBest(this.bestKey);
    }
    this.setState(win ? "won" : "over");
    if (win) { if (this._on.win) this._on.win(); }
    else if (this._on.over) this._on.over();
  };

  Engine.prototype.addScore = function (n) {
    this.score += n;
    if (this._on.score) this._on.score(this.score, n);
  };

  /* --- Effects --------------------------------------------------------- */
  Engine.prototype.shake = function (px) {
    this._shake = px;
    this._shakeMax = px;
  };
  Engine.prototype.flash = function (color, ms) {
    this._flash = { color: color, until: performance.now() + (ms || 80) };
  };

  /* --- Loop ------------------------------------------------------------ */
  Engine.prototype._ensureLoop = function () {
    if (this._running) return;
    this._running = true;
    var self = this;
    this._last = performance.now();
    var loop = function (now) {
      if (!self._running) return;
      self._raf = requestAnimationFrame(loop);

      var dt = now - self._last;
      self._last = now;
      if (dt > 250) dt = self.step; // recovering from a stall

      self._acc += dt;
      var guard = 0;
      while (self._acc >= self.step && guard < 6) {
        self._acc -= self.step;
        guard++;
        self.tick();
      }
      self.render();
    };
    this._raf = requestAnimationFrame(loop);
  };

  /* One fixed update step, then clear per-frame input edges. */
  Engine.prototype.tick = function () {
    if (this.state !== "running") {
      this.pressed = Object.create(null);
      this.vpressed = Object.create(null);
      this.anyPressed = false;
      return;
    }
    this.frame++;
    this.time += this.step / 1000;
    if (this._on.update) this._on.update(this.step / 1000);
    if (this._shake > 0) this._shake = Math.max(0, this._shake - 0.5);
    this.pressed = Object.create(null);
    this.vpressed = Object.create(null);
    this.anyPressed = false;
  };

  /* --- Rendering ------------------------------------------------------- */
  Engine.prototype.render = function () {
    var ctx = this.ctx;
    var s = this.scale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);

    if (this._shake > 0) {
      var a = (Math.random() * 2 - 1) * this._shake;
      var b = (Math.random() * 2 - 1) * this._shake;
      ctx.translate(Math.round(a), Math.round(b));
    }

    if (this._on.draw) this._on.draw(ctx, this);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (this._flash && performance.now() < this._flash.until) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = this._flash.color;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    }
  };

  /* --- Pixel drawing ---------------------------------------------------- */
  Engine.prototype.clear = function (color) {
    var ctx = this.ctx;
    ctx.fillStyle = color || "#000";
    ctx.fillRect(0, 0, this.W, this.H);
  };

  Engine.prototype.rect = function (x, y, w, h, color) {
    var ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  };

  /* Outlined rectangle — the classic arcade panel border. */
  Engine.prototype.frame = function (x, y, w, h, color) {
    var ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, w | 0, 1);
    ctx.fillRect(x | 0, (y | 0) + h - 1, w | 0, 1);
    ctx.fillRect(x | 0, y | 0, 1, h | 0);
    ctx.fillRect((x | 0) + w - 1, y | 0, 1, h | 0);
  };

  Engine.prototype.px = function (x, y, color) {
    var ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, 1, 1);
  };

  Engine.prototype.circle = function (cx, cy, r, color) {
    var ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };

  /* Pixel-art sprite from an array of strings. Any char not in `map` is
     transparent. Each character is one logical pixel.
       g.sprite(["..OO..", ".OOOO."], 10, 20, { O: "#f80" })
  */
  Engine.prototype.sprite = function (rows, x, y, map, scale) {
    var ctx = this.ctx;
    var s = scale || 1;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      for (var c = 0; c < row.length; c++) {
        var col = map[row[c]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect((x + c * s) | 0, (y + r * s) | 0, s, s);
      }
    }
  };

  /* Text in the pixel font. Advance width is 1em per character, so text
     lands on exact pixels when `size` is a multiple of the scale.
       g.text("READY", 80, 70, 8, "#fff", "center")
     `align` is "left" | "center" | "right"; `baseline` defaults to top. */
  Engine.prototype.text = function (str, x, y, size, color, align, baseline) {
    var ctx = this.ctx;
    ctx.font = size + 'px "Press Start 2P", monospace';
    ctx.textAlign = align || "left";
    ctx.textBaseline = baseline || "top";
    ctx.fillStyle = color;
    ctx.fillText(str, x | 0, y | 0);
  };

  Engine.prototype.textWidth = function (str, size) {
    return String(str).length * size;
  };

  /* Drop shadow, the way arcade games layered text. */
  Engine.prototype.textShadow = function (str, x, y, size, color, shadow, align) {
    this.text(str, x + size, y + size, size, shadow || "#000", align);
    this.text(str, x, y, size, color, align);
  };

  /* Horizontal meter with a pixel border — lives and fuel bars. */
  Engine.prototype.bar = function (x, y, w, h, ratio, fg, bg) {
    this.rect(x, y, w, h, bg || "#222");
    this.frame(x, y, w, h, "#555");
    var fill = Math.max(0, Math.min(1, ratio)) * (w - 2);
    this.rect(x + 1, y + 1, Math.round(fill), h - 2, fg);
  };

  /* ---------------------------------------------------------------------
     Boot helper — wires an on-screen pad and a sound toggle to an engine.
     --------------------------------------------------------------------- */
  function bindPad(engine, root) {
    var buttons = (root || document).querySelectorAll("[data-pad]");
    Array.prototype.forEach.call(buttons, function (btn) {
      var acts = btn.getAttribute("data-pad").split(" ");
      var press = function (e) {
        e.preventDefault();
        acts.forEach(function (a) { engine.padDown(a); });
      };
      var release = function (e) {
        e.preventDefault();
        acts.forEach(function (a) { engine.padUp(a); });
      };
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("pointerleave", release);
      btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    });
  }

  function initSoundButton(el, engine) {
    if (!el) return;
    var set = function () {
      var m = engine.sound.muted;
      el.textContent = m ? "SOUND OFF" : "SOUND ON";
      el.setAttribute("aria-pressed", String(!m));
    };
    el.addEventListener("click", function () {
      engine.sound.unlock();
      engine.sound.setMuted(!engine.sound.muted);
      if (!engine.sound.muted) engine.sound.cue("select");
      set();
      el.blur();
    });
    set();
  }

  /* Canvas text is measured at draw time, so the pixel font must be loaded
     before the first frame or everything renders in a fallback face. */
  function ready(cb) {
    if (!document.fonts || !document.fonts.load) { cb(); return; }
    var done = false;
    var once = function () { if (!done) { done = true; cb(); } };
    document.fonts.load('16px "Press Start 2P"').then(once, once);
    document.fonts.ready.then(once, once);
    // Hard ceiling so a stalled font request can't block the game forever.
    setTimeout(once, 1200);
  }

  global.Arcade = {
    Engine: Engine,
    Sound: Sound,
    bindPad: bindPad,
    initSoundButton: initSoundButton,
    ready: ready,
    /* Shared arcade palette. Kept here so every game matches. */
    palette: {
      white:  "#ffffff",
      bone:   "#fcfcfc",
      grey:   "#9a9a9a",
      dark:   "#3b3b4f",
      black:  "#0a0a12",
      red:    "#ff2e4d",
      orange: "#ff9a3c",
      amber:  "#ffd23f",
      lime:   "#7dfc63",
      green:  "#22c55e",
      teal:   "#2ee6c8",
      cyan:   "#38bdf8",
      blue:   "#4f6df5",
      purple: "#9b5cf6",
      pink:   "#ff5cc8",
      brown:  "#9a6b3f",
      night:  "#141428"
    }
  };
})(window);
