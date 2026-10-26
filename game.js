// ============================================
//  CRASH RIDE
//  Matter.js を使った2D物理自転車ゲーム
//  （自転車・ラグドール・トラップ・血しぶき・チェックポイント）
// ============================================

// ---------- 設定 ----------
const VIEW_W = 960;               // 画面の大きさ
const VIEW_H = 540;
const STEP_MS = 1000 / 60;        // 物理演算の1ステップの時間
const PX_PER_METER = 50;          // 50ピクセル = 1メートル

// 自転車
const WHEEL_RADIUS = 18;
const WHEEL_X = 32;               // 車体の中心から車輪までの横の距離
const WHEEL_Y = 22;               // 車体の中心から車輪までの縦の距離
const MAX_SPIN = 0.42;            // 前進の最高回転速度
const REVERSE_SPIN = 0.22;        // 後退の最高回転速度
const SPIN_ACCEL = 0.02;          // 回転の上がり方（加速）
const BRAKE = 0.8;                // ブレーキ（1回ごとに回転を80%にする）
const LEAN_POWER = 0.004;         // 地面で傾ける力
const AIR_LEAN_POWER = 0.014;     // 空中で傾ける力
const MAX_LEAN_SPEED = 0.06;      // 傾ける操作で出せる最大の回転速度（無制限に回らないように）
const LIFT_FORCE = 0.004;         // 地面で傾けるときに車輪を持ち上げる力
const FLIP_ANGLE = 1.75;          // これより大きく傾くと「ひっくり返り」（約100度）
const FLIP_TIME = 0.9;            // ひっくり返ったままこの秒数たつと転倒

// ダメージ（衝突の速さ。単位はピクセル/ステップ）
//   hurt  … これ以上で自転車から投げ出される
//   fatal … これ以上で死亡
const DAMAGE = {
  head: { hurt: 2, fatal: 4 },
  torso: { hurt: 4, fatal: 8 },
  limb: { hurt: 7, fatal: 12 },
};
const LANDING_EJECT = 10;         // 車輪がこの速さで着地すると投げ出される
const LANDING_FATAL = 13.5;       // 車輪がこの速さで着地すると死亡

// 死亡演出
const SLOWMO_TIME = 0.7;          // スローモーションの長さ（秒）
const SLOWMO_SCALE = 0.3;         // スローモーションの速さ
const DEATH_SCREEN_DELAY = 2.6;   // 死亡から YOU DIED を出すまでの秒数

// 当たり判定のグループ（何と何がぶつかるか）
const CAT = { GROUND: 0x0001, BIKE: 0x0002, RIDER: 0x0004, MOVER: 0x0008, DEBRIS: 0x0010 };

// ---------- コース ----------
// lands：地面の表面の点（左から右へ）。点と点の間を、回転させた長方形で作る
// 平らな道は少なめにして、ギミックを次々に並べている
const COURSE = {
  startX: 120,
  goalX: 7950,
  fallY: 1100,   // これより下に落ちたら落とし穴に落ちたことにする
  lands: [
    // A. でこぼこ道 → B. シーソー → C. ジャンプパッドで落とし穴（1600〜1850）をこえる
    [[-1000, 500], [250, 500], [380, 455], [470, 500], [600, 445], [700, 500], [1600, 500]],
    // D. 着地の下り坂 → 谷（振り子ノコギリ）→ 上り坂
    [[1850, 520], [2150, 560], [2400, 560], [2560, 470], [2800, 470]],
    // E. 崩れる橋（2800〜3200）＋上下するノコギリ → F. エレベーター（3350〜3530）
    [[3200, 470], [3350, 470]],
    // G. 高台 → 岩が転がってくる急な下り坂 → 踏み切り → 落とし穴（4230〜4450）
    [[3530, 320], [3750, 320], [4150, 510], [4230, 490]],
    // H. ダブルハンマー
    [[4450, 560], [5500, 560]],
    // I. 柱わたり（すき間はだんだん広くなる）
    [[5560, 560], [5680, 560]],
    [[5750, 560], [5870, 560]],
    [[5950, 560], [6200, 560]],
    // J. 崩れる足場（6200〜6500）＋振り子ノコギリ → 急な上り坂 → ジャンプパッド
    [[6500, 560], [6600, 560], [6800, 440], [6900, 440]],
    // K. トゲの谷（落ちたら戻れない）
    [[6900, 620], [7250, 620]],
    // L. 着地の下り坂 → ハンマー → ゴール
    [[7250, 500], [7500, 600], [8500, 600]],
  ],
  ramps: [],
  walls: [-300, 8200],
  checkpoints: [2600, 4560, 6050, 6550, 7530],
  saws: [],
  movingSaws: [
    { x: 3000, y: 360, r: 35, amp: 80, period: 2.4 },   // 崩れる橋の上で上下するノコギリ
  ],
  spikes: [
    { x: 7075, y: 616, w: 340, h: 8, dir: "up" },       // トゲの谷（車輪ならセーフ）
    { x: 3524, y: 570, w: 12, h: 120, dir: "left" },    // エレベーターの穴の壁
    { x: 5744, y: 600, w: 12, h: 70, dir: "left" },     // 柱の壁
    { x: 5944, y: 600, w: 12, h: 70, dir: "left" },
  ],
  // kind: "saw" は振り子ノコギリ。それ以外は巨大ハンマー
  hammers: [
    { x: 2280, y: 365, len: 100, amp: 1.4, period: 3.4, phase: 0, kind: "saw", r: 30 },
    { x: 4850, y: 365, len: 100, amp: 1.4, period: 3.4, phase: 0 },
    { x: 5250, y: 365, len: 100, amp: 1.4, period: 3.4, phase: -1.5 },
    { x: 6350, y: 380, len: 110, amp: 1.4, period: 4.0, phase: 0.5, kind: "saw", r: 30 },
    { x: 7700, y: 405, len: 100, amp: 1.4, period: 3.0, phase: 1.5 },
  ],
  platforms: [
    { x: 3440, y: 403, w: 170, h: 16, amp: 75, period: 4, axis: "y" },   // エレベーター（上下に動く足場）
  ],
  crumbles: [
    { x1: 2800, x2: 3200, y: 470, pieces: 4, delay: 0.3 },   // 崩れる橋
    { x1: 6200, x2: 6500, y: 560, pieces: 3, delay: 0.3 },   // 崩れる足場
  ],
  pads: [
    { x: 1550, y: 500, w: 50, power: 9, minVx: 6 },     // ジャンプパッド（バネ）
    { x: 6865, y: 440, w: 50, power: 10, minVx: 8 },
  ],
  seesaws: [
    { x: 1030, y: 500, h: 45, len: 260 },    // シーソー
  ],
  boulders: [
    { trigger: 3700, x: 3560, y: 230, r: 42, vx: 3 },   // 自転車がここを通ると、後ろから岩が転がってくる
  ],
  signs: [
    { x: 200, text: "START", color: "#2e9e5b" },
    { x: 330, text: "でこぼこ道", color: "#3a7bd5" },
    { x: 840, text: "シーソー", color: "#ff8a1f" },
    { x: 1450, text: "ジャンプパッド", color: "#ff8a1f" },
    { x: 2010, text: "振り子ノコギリ", color: "#e53935" },
    { x: 2700, text: "崩れる橋", color: "#e53935" },
    { x: 3270, text: "エレベーター", color: "#ff8a1f" },
    { x: 3620, text: "落石注意", color: "#e53935" },
    { x: 4660, text: "ダブルハンマー", color: "#e53935" },
    { x: 5520, text: "柱わたり", color: "#ff8a1f" },
    { x: 6120, text: "崩れる足場", color: "#e53935" },
    { x: 6850, text: "大ジャンプ", color: "#ff8a1f" },
    { x: 7610, text: "ハンマー", color: "#e53935" },
  ],
};

// ---------- Matter.js の準備 ----------
const { Engine, Bodies, Body, Composite, Constraint, Events, Query } = window.Matter || {};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const $ = id => document.getElementById(id);
const overlay = $("overlay");

let engine;
let bike;            // 自転車とラグドールのボディ
let solidBodies;     // 車輪が「地面にいる」と判定するもの
let groundBodies;    // 動かない地面・ジャンプ台・壁
let movers;          // ハンマー・動く足場・動くノコギリ
let crumbles;        // 崩れる足場のかけら
let seesaws;         // シーソーの板
let boulders;        // 転がってくる岩
let padTimer = 0;    // ジャンプパッドが続けて反応しないようにする時間
let hits;            // 物理演算中に起きた衝突（あとでまとめて処理する）

let state = "title"; // "title" / "playing" / "down"（転倒・死亡） / "clear"
let paused = false;
let elapsed = 0;     // 経過時間（秒）
let simTime = 0;     // トラップを動かすための時間
let maxX = 0;        // 一番進んだ位置
let deaths = 0;
let restarts = 0;
let checkpoint = -1; // 通過したチェックポイント（-1 = まだ）
let flipTimer = 0;
let downTimer = 0;
let slowTimer = 0;
let shakeTimer = 0;
let shakePower = 0;
let airTime = 0;
let onGround = false;
let ejected = false;
let dead = false;
let deathCause = "";
let deathShown = false;

const camera = { x: 0, y: 0, zoom: 1, targetZoom: 1 };
const keys = {};
const blood = [];     // 飛んでいる血しぶき
const stains = [];    // 地面に残った跡
const confetti = [];  // ゴールの紙吹雪
const MAX_BLOOD = 500;
const MAX_STAINS = 300;

// ============================================
//  効果音（Web Audio API で作る）
// ============================================
const sfx = {
  ctx: null,
  ride: null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      // 走行音：低い音をずっと鳴らして、速さで音量と高さを変える
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      filter.type = "lowpass";
      filter.frequency.value = 400;
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.ctx.destination);
      osc.start();
      this.ride = { osc, gain };
    } catch (e) {
      this.ctx = null;
    }
  },
  tone(freq, dur, type = "square", vol = 0.08, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },
  noise(dur, vol = 0.2, freq = 800) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
  },
  updateRide(speed, active) {
    if (!this.ride) return;
    const t = this.ctx.currentTime;
    const vol = active ? Math.min(0.035, speed * 0.005) : 0;
    this.ride.gain.gain.setTargetAtTime(vol, t, 0.05);
    this.ride.osc.frequency.setTargetAtTime(50 + speed * 14, t, 0.05);
  },
  jump() { this.tone(300, 0.15, "square", 0.05, 600); },
  land(power) { this.noise(0.12, Math.min(0.25, 0.05 + power * 0.02), 300); },
  hit(power) { this.noise(0.2, Math.min(0.35, 0.08 + power * 0.03), 600); this.tone(120, 0.15, "triangle", 0.1, 60); },
  saw() { this.tone(900, 0.25, "sawtooth", 0.06, 1400); },
  hammer() { this.noise(0.25, 0.3, 200); },
  crumble() { this.noise(0.4, 0.15, 400); },
  die() { this.tone(400, 0.6, "sawtooth", 0.08, 60); this.noise(0.4, 0.3, 500); },
  checkpoint() { this.tone(660, 0.12, "square", 0.06); setTimeout(() => this.tone(990, 0.2, "square", 0.06), 120); },
  goal() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, "square", 0.07), i * 130)); },
};

// ============================================
//  コースを作る
// ============================================

// (x1,y1) から (x2,y2) までの坂を、回転させた長方形で作る。
// 長方形の「上の辺」がちょうど坂の表面になるように、下に半分ずらす。
function makeSegment(x1, y1, x2, y2, thick) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;   // 表面から下向きの方向
  const ny = dx / len;
  return Bodies.rectangle(
    (x1 + x2) / 2 + nx * thick / 2,
    (y1 + y2) / 2 + ny * thick / 2,
    len + 2, thick,
    { isStatic: true, angle: Math.atan2(dy, dx), friction: 1 }
  );
}

// トラップや動く足場を、決めた時間の動きどおりに動かすためのボディ。
// とても重くして、ぶつかったものを押しのける（地面とはぶつからない）
function makeMover(body, motion) {
  Body.setInertia(body, Infinity);
  body.frictionAir = 0;
  body.collisionFilter = { group: 0, category: CAT.MOVER, mask: CAT.BIKE | CAT.RIDER | CAT.DEBRIS };
  body.motion = motion;
  return body;
}

function createCourse() {
  groundBodies = [];
  movers = [];
  crumbles = [];

  for (const land of COURSE.lands) {
    for (let i = 0; i < land.length - 1; i++) {
      const [x1, y1] = land[i];
      const [x2, y2] = land[i + 1];
      groundBodies.push(makeSegment(x1, y1, x2, y2, 40));
    }
  }
  for (const [x1, y1, x2, y2] of COURSE.ramps) {
    const ramp = makeSegment(x1, y1, x2, y2, 16);
    ramp.isRamp = true;
    groundBodies.push(ramp);
  }
  for (const x of COURSE.walls) {
    groundBodies.push(Bodies.rectangle(x, 0, 40, 2400, { isStatic: true }));
  }

  // 回転ノコギリ（動かない）
  for (const s of COURSE.saws) {
    const saw = Bodies.circle(s.x, s.y, s.r, { isStatic: true });
    saw.hazard = "saw";
    saw.radius = s.r;
    groundBodies.push(saw);
  }

  // トゲ
  for (const s of COURSE.spikes) {
    const spike = Bodies.rectangle(s.x, s.y, s.w, s.h, { isStatic: true, friction: 0.8 });
    spike.hazard = "spike";
    spike.dir = s.dir;
    spike.w = s.w;
    spike.h = s.h;
    groundBodies.push(spike);
  }

  // 上下に動くノコギリ
  for (const s of COURSE.movingSaws) {
    const saw = makeMover(Bodies.circle(s.x, s.y, s.r, { density: 0.05 }), t => ({
      x: s.x,
      y: s.y + Math.sin((t / s.period) * Math.PI * 2) * s.amp,
      angle: 0,
    }));
    saw.hazard = "saw";
    saw.radius = s.r;
    movers.push(saw);
  }

  // 巨大ハンマー・振り子ノコギリ
  for (const h of COURSE.hammers) {
    const isSaw = h.kind === "saw";
    const shape = isSaw
      ? Bodies.circle(h.x, h.y + h.len, h.r, { density: 0.05 })
      : Bodies.rectangle(h.x, h.y + h.len, 54, 74, { density: 0.05 });
    const hammer = makeMover(shape, t => {
      const a = Math.sin((t / h.period) * Math.PI * 2 + h.phase) * h.amp;
      return { x: h.x + Math.sin(a) * h.len, y: h.y + Math.cos(a) * h.len, angle: -a };
    });
    hammer.hazard = isSaw ? "saw" : "hammer";
    hammer.radius = h.r;
    hammer.pivot = { x: h.x, y: h.y };
    hammer.len = h.len;
    movers.push(hammer);
  }

  // 動く足場（axis: "y" なら上下に動くエレベーター）
  for (const p of COURSE.platforms) {
    const platform = makeMover(Bodies.rectangle(p.x, p.y, p.w, p.h, { density: 0.05, friction: 1 }), t => {
      const s = Math.sin((t / p.period) * Math.PI * 2) * p.amp;
      return p.axis === "y" ? { x: p.x, y: p.y + s, angle: 0 } : { x: p.x + s, y: p.y, angle: 0 };
    });
    platform.isPlatform = true;
    platform.w = p.w;
    platform.h = p.h;
    platform.axis = p.axis || "x";
    movers.push(platform);
  }

  // ジャンプパッド（バネ）：車輪が乗ると上に飛ばされる
  for (const p of COURSE.pads) {
    const pad = Bodies.rectangle(p.x, p.y - 3, p.w, 10, { isStatic: true, friction: 1 });
    pad.pad = { power: p.power, minVx: p.minVx, squash: 0 };
    pad.w = p.w;
    groundBodies.push(pad);
  }

  // シーソー：まん中を軸にして回る板。最初は左はしが地面についている
  seesaws = [];
  for (const s of COURSE.seesaws) {
    const half = s.len / 2;
    const angle = -Math.asin((s.h - 7) / half);
    const plank = Bodies.rectangle(s.x, s.y - s.h, s.len, 12, {
      angle, density: 0.003, friction: 1, frictionAir: 0.03,
      collisionFilter: { group: 0, category: CAT.DEBRIS, mask: CAT.GROUND | CAT.BIKE | CAT.RIDER },
    });
    plank.seesaw = s;
    const axle = Constraint.create({ pointA: { x: s.x, y: s.y - s.h }, bodyB: plank, pointB: { x: 0, y: 0 }, length: 0, stiffness: 1 });
    seesaws.push(plank);
    Composite.add(engine.world, axle);
  }

  // 転がってくる岩（自転車が近くを通ったときに出てくる）
  boulders = COURSE.boulders.map(b => ({ ...b, body: null }));

  // 崩れる足場：乗ってから少したつと、動かないボディから落ちるボディに変わる
  for (const c of COURSE.crumbles) {
    const w = (c.x2 - c.x1) / c.pieces;
    for (let i = 0; i < c.pieces; i++) {
      const piece = Bodies.rectangle(c.x1 + w * (i + 0.5), c.y + 10, w - 2, 20, { friction: 1, density: 0.004 });
      Body.setStatic(piece, true);   // あとで落とせるように、いったん動かないボディにする
      piece.crumble = { delay: c.delay, timer: -1 };
      crumbles.push(piece);
    }
  }

  // 動く物の最初の位置
  updateMovers();

  solidBodies = [...groundBodies, ...movers, ...crumbles, ...seesaws];
  Composite.add(engine.world, solidBodies);
}

// 自転車が決まった場所を通ったら、後ろから岩を転がす
function updateBoulders() {
  for (const b of boulders) {
    if (!b.body && bike.chassis.position.x > b.trigger && state === "playing") {
      b.body = Bodies.circle(b.x, b.y, b.r, {
        density: 0.01, friction: 0.9, restitution: 0.1, frictionAir: 0.002,
        collisionFilter: { group: 0, category: CAT.DEBRIS, mask: CAT.GROUND | CAT.BIKE | CAT.RIDER | CAT.DEBRIS },
      });
      b.body.hazard = "boulder";
      b.body.radius = b.r;
      Body.setVelocity(b.body, { x: b.vx, y: 0 });
      Composite.add(engine.world, b.body);
      solidBodies.push(b.body);
      sfx.crumble();
      shake(0.3, 5);
    }
    // 穴に落ちた岩は消す（物理演算を軽くする）
    if (b.body && !b.removed && b.body.position.y > COURSE.fallY + 300) {
      b.removed = true;
      Composite.remove(engine.world, b.body);
    }
  }
}

function updateMovers() {
  const dt = STEP_MS / 1000;
  for (const m of movers) {
    const now = m.motion(simTime);
    const next = m.motion(simTime + dt);
    Body.setPosition(m, { x: now.x, y: now.y });
    Body.setAngle(m, now.angle);
    // 速さも設定しておくと、ぶつかったものが正しく吹き飛ぶ
    Body.setVelocity(m, { x: next.x - now.x, y: next.y - now.y });
    Body.setAngularVelocity(m, next.angle - now.angle);
  }
}

function updateCrumbles(dt) {
  for (const piece of crumbles) {
    const c = piece.crumble;
    if (c.timer < 0 || c.fallen) continue;
    c.timer += dt;
    if (c.timer >= c.delay) {
      c.fallen = true;
      Body.setStatic(piece, false);
      piece.collisionFilter = { group: 0, category: CAT.DEBRIS, mask: CAT.GROUND | CAT.BIKE | CAT.RIDER };
      Body.setAngularVelocity(piece, (Math.random() - 0.5) * 0.05);
      sfx.crumble();
    }
  }
}

// ============================================
//  自転車とラグドールを作る
// ============================================
function createBike(x, y) {
  const bikeGroup = Body.nextGroup(true);    // 自転車の部品どうしはぶつからない
  const riderGroup = Body.nextGroup(true);   // 体の部位どうしはぶつからない
  const bikeFilter = { group: bikeGroup, category: CAT.BIKE, mask: CAT.GROUND | CAT.MOVER | CAT.DEBRIS };
  const riderFilter = { group: riderGroup, category: CAT.RIDER, mask: CAT.GROUND | CAT.MOVER | CAT.DEBRIS };
  const P = (lx, ly) => ({ x: x + lx, y: y + ly });   // 車体から見た位置 → 物理の座標

  // ----- 自転車：車体フレーム・ハンドル・サドルを1つのボディにする -----
  const frame = Bodies.rectangle(x, y, 76, 10, { density: 0.002 });
  const handle = Bodies.rectangle(x + 24, y - 18, 14, 5, { density: 0.001 });
  const saddle = Bodies.rectangle(x - 12, y - 12, 16, 5, { density: 0.001 });
  const chassis = Body.create({ parts: [frame, handle, saddle], collisionFilter: { ...bikeFilter }, friction: 0.5, frictionAir: 0.002 });

  const wheelOptions = {
    collisionFilter: { ...bikeFilter },
    friction: 1,
    frictionStatic: 2,
    restitution: 0.05,
    density: 0.0015,
    frictionAir: 0.002,   // 空気抵抗は小さめ（ジャンプが失速しすぎないように）
  };
  const rear = Bodies.circle(x - WHEEL_X, y + WHEEL_Y, WHEEL_RADIUS, wheelOptions);
  const front = Bodies.circle(x + WHEEL_X, y + WHEEL_Y, WHEEL_RADIUS, wheelOptions);

  // ペダル（クランク）：後輪と同じように回る。ほかの物とはぶつからない
  const crankPos = P(0, 12);
  const crank = Bodies.circle(crankPos.x, crankPos.y, 5, {
    collisionFilter: { group: bikeGroup, category: CAT.BIKE, mask: 0 },
    density: 0.004,
  });

  // 2つの物を、ある1点でつなぐ Constraint
  const pin = (A, B, p, stiffness, damping = 0.1) => Constraint.create({
    bodyA: A, pointA: { x: p.x - A.position.x, y: p.y - A.position.y },
    bodyB: B, pointB: { x: p.x - B.position.x, y: p.y - B.position.y },
    length: 0, stiffness, damping,
  });

  // 車輪の中心と車体をつなぐ（少しやわらかくして、サスペンションにする）
  const bikeJoints = [
    pin(chassis, rear, rear.position, 0.6, 0.15),
    pin(chassis, front, front.position, 0.6, 0.15),
    pin(chassis, crank, crankPos, 1, 0.1),
  ];

  // ----- ラグドール：頭・胴体・腕（上腕と前腕）・脚（太ももとすね） -----
  const pts = {
    hip: P(-10, -16), shoulder: P(0, -42), neck: P(1, -46), head: P(3, -56),
    elbow: P(13, -29), hand: P(24, -19),
    kneeF: P(6, -8), footF: P(9, 12),
    kneeB: P(2, -4), footB: P(-9, 12),
  };

  // a から b までの手足を長方形で作る
  const limb = (a, b, thick, kind, color, density = 0.0006) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const body = Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len, thick, {
      angle: Math.atan2(dy, dx),
      collisionFilter: { ...riderFilter },
      density, friction: 0.7, frictionAir: 0.004, restitution: 0.15,
      chamfer: { radius: thick / 2 - 0.5 },
    });
    body.riderPart = kind;
    body.len = len;
    body.thick = thick;
    body.color = color;
    return body;
  };

  const torso = limb(pts.hip, pts.shoulder, 13, "torso", "#2ec4b6", 0.0008);
  const head = Bodies.circle(pts.head.x, pts.head.y, 10, {
    collisionFilter: { ...riderFilter }, density: 0.0006, friction: 0.7, restitution: 0.2, frictionAir: 0.004,
  });
  head.riderPart = "head";
  const upperB = limb(pts.shoulder, pts.elbow, 6, "limb", "#d9a47e");
  const foreB = limb(pts.elbow, pts.hand, 5, "limb", "#d9a47e");
  const thighB = limb(pts.hip, pts.kneeB, 8, "limb", "#2b4f8f");
  const shinB = limb(pts.kneeB, pts.footB, 7, "limb", "#2b4f8f");
  const thighF = limb(pts.hip, pts.kneeF, 8, "limb", "#3566b8");
  const shinF = limb(pts.kneeF, pts.footF, 7, "limb", "#3566b8");
  const upperF = limb(pts.shoulder, pts.elbow, 6, "limb", "#f2c19b");
  const foreF = limb(pts.elbow, pts.hand, 5, "limb", "#f2c19b");

  // 関節（ずっとつながったまま）
  const riderJoints = [
    pin(torso, head, pts.neck, 0.9),
    Constraint.create({ bodyA: torso, bodyB: head, stiffness: 0.25, damping: 0.1 }),   // 首がぐらぐらしすぎないように
    pin(torso, upperB, pts.shoulder, 0.9), pin(upperB, foreB, pts.elbow, 0.9),
    pin(torso, upperF, pts.shoulder, 0.9), pin(upperF, foreF, pts.elbow, 0.9),
    pin(torso, thighB, pts.hip, 0.9), pin(thighB, shinB, pts.kneeB, 0.9),
    pin(torso, thighF, pts.hip, 0.9), pin(thighF, shinF, pts.kneeF, 0.9),
  ];

  // 補助 Constraint：人を自転車に乗せておくためのもの。強い衝突で外れる
  const assists = [
    pin(torso, chassis, pts.hip, 0.6),         // おしり → サドル
    pin(foreB, chassis, pts.hand, 0.5),        // 手 → ハンドル
    pin(foreF, chassis, pts.hand, 0.5),
    pin(shinF, crank, pts.footF, 0.3),         // 足 → ペダル
    pin(shinB, crank, pts.footB, 0.3),
    pin(torso, chassis, pts.shoulder, 0.04),   // 姿勢をゆるく保つ（体が揺れる）
    pin(upperB, chassis, pts.elbow, 0.04),
    pin(upperF, chassis, pts.elbow, 0.04),
    pin(thighB, chassis, pts.kneeB, 0.04),
    pin(thighF, chassis, pts.kneeF, 0.04),
  ];

  const riderParts = [thighB, shinB, upperB, foreB, torso, head, thighF, shinF, upperF, foreF];
  Composite.add(engine.world, [chassis, rear, front, crank, ...bikeJoints, ...riderParts, ...riderJoints, ...assists]);

  return {
    chassis, frame, handle, saddle, rear, front, crank,
    head, torso, riderParts, backParts: [thighB, shinB, upperB, foreB], frontParts: [thighF, shinF, upperF, foreF],
    assists,
    bikeBodies: [chassis, rear, front],
  };
}

// ============================================
//  ゲームの開始・やり直し・チェックポイント
// ============================================
function buildWorld(startX) {
  engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  engine.constraintIterations = 4;
  hits = [];
  createCourse();
  bike = createBike(startX, groundY(startX) - WHEEL_Y - WHEEL_RADIUS - 2);
  Events.on(engine, "collisionStart", onCollision);

  flipTimer = 0;
  downTimer = 0;
  slowTimer = 0;
  shakeTimer = 0;
  airTime = 0;
  padTimer = 0;
  ejected = false;
  dead = false;
  deathCause = "";
  deathShown = false;
  blood.length = 0;
  confetti.length = 0;
  camera.x = startX + 120;
  camera.y = groundY(startX) - 60;
  camera.zoom = camera.targetZoom = 1;
}

// 最初からやり直す
function startGame(fromTitle) {
  sfx.init();
  if (!fromTitle && state !== "title") restarts++;
  if (fromTitle) {
    deaths = 0;
    restarts = 0;
  }
  checkpoint = -1;
  elapsed = 0;
  simTime = 0;
  stains.length = 0;
  maxX = COURSE.startX;
  buildWorld(COURSE.startX);
  state = "playing";
  paused = false;
  overlay.classList.add("hidden");
  updateHud();
}

// チェックポイントから再開する（自転車と人は完全に作り直す）
function respawn() {
  if (checkpoint < 0) {
    startGame(false);
    return;
  }
  buildWorld(COURSE.checkpoints[checkpoint]);
  state = "playing";
  paused = false;
  overlay.classList.add("hidden");
  showToast(`チェックポイント ${checkpoint + 1} から再開`, "#3a7bd5");
}

function checkCheckpoints() {
  const x = bike.chassis.position.x;
  while (checkpoint + 1 < COURSE.checkpoints.length && x >= COURSE.checkpoints[checkpoint + 1]) {
    checkpoint++;
    showToast(`CHECKPOINT ${checkpoint + 1} 通過！`, "#2e9e5b");
    sfx.checkpoint();
  }
}

let toastTimer = null;
function showToast(text, color) {
  const toast = $("toast");
  toast.textContent = text;
  toast.style.background = color;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 1800);
}

// ============================================
//  操作
// ============================================
function setSpin(wheel, value) {
  Body.setAngularVelocity(wheel, value);
}

function controlBike() {
  const { chassis, rear, front } = bike;
  const right = keys.ArrowRight || keys.d;
  const left = keys.ArrowLeft || keys.a;
  const up = keys.ArrowUp || keys.w;
  const down = keys.ArrowDown || keys.s;
  const brake = keys[" "];

  // 車輪を回して進む（キーを押している間だけ）
  for (const wheel of [rear, front]) {
    const spin = wheel.angularVelocity;
    if (brake) {
      setSpin(wheel, spin * BRAKE);
    } else if (right && spin < MAX_SPIN) {
      setSpin(wheel, Math.min(spin + SPIN_ACCEL, MAX_SPIN));
    } else if (left && spin > -REVERSE_SPIN) {
      setSpin(wheel, Math.max(spin - SPIN_ACCEL, -REVERSE_SPIN));
    }
  }

  // 車体を傾ける。回転速度に上限をつけて、無制限に回らないようにする
  const lean = (down ? 1 : 0) - (up ? 1 : 0);
  if (lean !== 0) {
    const power = onGround ? LEAN_POWER : AIR_LEAN_POWER;
    const spin = chassis.angularVelocity + lean * power;
    if (Math.abs(spin) <= MAX_LEAN_SPEED || Math.sign(spin) !== lean) {
      Body.setAngularVelocity(chassis, spin);

      // 地面にいるときは、体重移動で前輪（後ろに傾ける）か後輪（前に傾ける）を持ち上げる
      if (onGround) {
        const lifted = lean < 0 ? front : rear;
        const upX = Math.sin(chassis.angle);    // 車体から見た「上」の向き
        const upY = -Math.cos(chassis.angle);
        Body.applyForce(lifted, lifted.position, { x: upX * LIFT_FORCE, y: upY * LIFT_FORCE });
      }
    }
  }
}

// ペダルを後輪と同じように回す
function syncCrank() {
  Body.setAngle(bike.crank, bike.rear.angle);
  Body.setAngularVelocity(bike.crank, bike.rear.angularVelocity);
}

function checkGround() {
  const others = solidBodies.filter(b => !b.crumble || !b.crumble.fallen);
  const wasOnGround = onGround;
  onGround = Query.collides(bike.rear, others).length > 0 || Query.collides(bike.front, others).length > 0;
  if (!onGround) {
    airTime += STEP_MS / 1000;
    if (wasOnGround && state === "playing" && bike.chassis.velocity.y < -2) sfx.jump();
  } else {
    airTime = 0;
  }
}

// -π〜π の範囲にそろえた車体の角度
function bikeAngle() {
  const a = bike.chassis.angle % (Math.PI * 2);
  return ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

// ============================================
//  衝突・ダメージ
// ============================================
// 物理演算の途中で呼ばれる。ここでは記録だけして、あとでまとめて処理する
function onCollision(event) {
  for (const pair of event.pairs) {
    const a = pair.bodyA;
    const b = pair.bodyB;
    const va = a.parent.velocity;
    const vb = b.parent.velocity;
    const n = pair.collision.normal;
    const speed = Math.abs((va.x - vb.x) * n.x + (va.y - vb.y) * n.y);
    const support = pair.collision.supports && pair.collision.supports[0];
    const point = support ? { x: support.x, y: support.y } : { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
    hits.push({ a, b, speed, point });
    hits.push({ a: b, b: a, speed, point });
  }
}

function isBikePart(body) {
  return bike.bikeBodies.includes(body.parent);
}

function processHits() {
  const list = hits;
  hits = [];
  for (const { a, b, speed, point } of list) {
    // 崩れる足場：自転車か人が乗ったら崩れ始める
    if (b.crumble && b.crumble.timer < 0 && (a.riderPart || isBikePart(a))) b.crumble.timer = 0;

    if (a.riderPart) hitRider(a, b, speed, point);
    else if (isBikePart(a)) hitBike(a, b, speed, point);
  }
}

// 人の体がぶつかったとき
function hitRider(part, other, speed, point) {
  if (other.parent && isBikePart(other)) return;   // 自分の自転車は無視
  const dir = awayFrom(part, other);

  if (other.hazard === "saw") {
    sfx.saw();
    kill("回転ノコギリに切られた！", point, dir, 12);
    fling(dir, 10);
    return;
  }
  if (other.hazard === "spike") {
    kill("トゲに刺さった！", point, dir, 8);
    return;
  }
  if (other.hazard === "hammer") {
    sfx.hammer();
    if (speed > 3) {
      kill("ハンマーで吹き飛ばされた！", point, dir, speed);
      fling(normalize(other.velocity), 6 + speed * 0.8);
    } else {
      eject("ハンマーにぶつかった！", dir, speed);
    }
    return;
  }
  if (other.hazard === "boulder") {
    const rockSpeed = Math.hypot(other.velocity.x, other.velocity.y);
    if (rockSpeed > 2.5 || speed > 3) {
      sfx.hammer();
      kill("岩につぶされた！", point, dir, Math.max(speed, rockSpeed));
      fling(normalize({ x: other.velocity.x, y: other.velocity.y - 2 }), 6 + rockSpeed);
      return;
    }
  }

  // ふつうの地面などにぶつかったとき：強さでダメージが変わる
  const limit = DAMAGE[part.riderPart];
  if (speed >= limit.fatal) {
    const cause = part.riderPart === "head" ? "頭を強く打った！" : "強い衝撃を受けた！";
    kill(cause, point, dir, speed);
  } else if (speed >= limit.hurt) {
    spawnBlood(point.x, point.y, dir, Math.floor(speed * 2), speed);
    sfx.hit(speed);
    eject(part.riderPart === "head" ? "頭をぶつけて転倒した" : "地面にたたきつけられた", dir, speed);
  } else if (speed >= limit.hurt * 0.6 && part.riderPart !== "limb") {
    // 中くらいの衝突：少し血が出る
    spawnBlood(point.x, point.y, dir, 3, speed);
    sfx.hit(speed * 0.5);
  }
}

// 自転車がぶつかったとき
function hitBike(part, other, speed, point) {
  if (other.riderPart) return;
  if (other.hazard === "saw") {
    // 車輪がノコギリにふれると、はじき飛ばされる（すぐには死なない）
    const dir = awayFrom(part, other);
    for (const b of bike.bikeBodies) {
      Body.setVelocity(b, { x: b.velocity.x + dir.x * 7, y: b.velocity.y + dir.y * 7 - 2 });
    }
    Body.setAngularVelocity(bike.chassis, bike.chassis.angularVelocity + (Math.random() - 0.5) * 0.3);
    spawnSparks(point.x, point.y);
    sfx.saw();
    return;
  }
  if (other.hazard === "hammer" || other.hazard === "boulder") {
    sfx.hammer();
    shake(0.3, 8);
    return;
  }
  if (other.pad) {
    if (padTimer <= 0 && state === "playing") launch(other);
    return;
  }
  // 着地の衝撃
  if (state !== "playing") return;
  if (speed >= LANDING_FATAL) {
    kill("高いところから激しく落下した！", point, { x: bike.chassis.velocity.x * 0.1, y: -1 }, speed);
  } else if (speed >= LANDING_EJECT) {
    sfx.hit(speed);
    eject("着地に失敗して投げ出された", normalize({ x: bike.chassis.velocity.x, y: -4 }), speed);
  } else if (speed >= 3 && airTime > 0.2) {
    sfx.land(speed);
    if (speed > 6) shake(0.15, 3);
  }
}

// ジャンプパッドで、自転車と人をまとめて上に飛ばす
function launch(pad) {
  padTimer = 0.5;
  pad.pad.squash = 1;
  for (const b of [...bike.bikeBodies, bike.crank, ...bike.riderParts]) {
    Body.setVelocity(b, { x: Math.max(b.velocity.x, pad.pad.minVx), y: -pad.pad.power });
  }
  sfx.tone(200, 0.3, "square", 0.07, 900);
}

// part が other から離れる向き
function awayFrom(part, other) {
  if (other.circleRadius || other.hazard) {
    return normalize({ x: part.position.x - other.position.x, y: part.position.y - other.position.y });
  }
  // 地面のとき：体の動きを反射させた向き（速さや角度で毎回変わる）
  const v = part.parent.velocity;
  return normalize({ x: v.x * 0.8 + (Math.random() - 0.5), y: -Math.abs(v.y) - 1 });
}

function normalize(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

// 自転車から投げ出される（補助 Constraint を外す）
function eject(cause, dir, speed) {
  if (!ejected) {
    ejected = true;
    for (const c of bike.assists) Composite.remove(engine.world, c);
    fling(dir, Math.min(6, speed * 0.4));
    // 少したってから、人と自転車もぶつかるようにする
    const thisBike = bike;
    setTimeout(() => {
      if (bike !== thisBike) return;   // もうやり直していたら何もしない
      for (const p of bike.riderParts) p.collisionFilter.mask |= CAT.BIKE;
      for (const b of bike.bikeBodies) b.collisionFilter.mask |= CAT.RIDER;
    }, 300);
    shake(0.3, 6);
  }
  fail(cause);
}

// 死亡する
function kill(cause, point, dir, speed) {
  if (dead) return;
  if (state !== "playing" && state !== "down") return;
  dead = true;
  spawnBlood(point.x, point.y, dir, Math.min(120, 30 + Math.floor(speed * 6)), speed + 4);
  eject(cause, dir, speed);
  deathCause = cause;   // 投げ出された後に死んだときも、死亡原因を上書きする
  slowTimer = SLOWMO_TIME;
  shake(0.6, 14);
  sfx.die();
}

// 体全体を dir の向きに吹き飛ばす（部位ごとに少しずつ変える）
function fling(dir, power) {
  for (const p of bike.riderParts) {
    const k = power * (0.6 + Math.random() * 0.8);
    Body.setVelocity(p, { x: p.velocity.x + dir.x * k, y: p.velocity.y + dir.y * k - Math.random() * 2 });
    Body.setAngularVelocity(p, p.angularVelocity + (Math.random() - 0.5) * 0.4);
  }
}

// 転倒・死亡した（ゲームはすぐ止めず、少しのあいだ物理演算を続ける）
function fail(cause) {
  if (state !== "playing") return;
  state = "down";
  deathCause = cause;
  downTimer = 0;
  deaths++;
  updateHud();
}

function shake(time, power) {
  shakePower = shakeTimer > 0 ? Math.max(shakePower, power) : power;
  shakeTimer = Math.max(shakeTimer, time);
}

// ============================================
//  血しぶき・火花・紙吹雪
// ============================================
function spawnBlood(x, y, dir, count, speed) {
  for (let i = 0; i < count; i++) {
    if (blood.length >= MAX_BLOOD) blood.shift();   // 多すぎるときは古いものから消す
    const spread = (Math.random() - 0.5) * 1.6;
    const s = (0.4 + Math.random()) * Math.min(speed, 14) * 0.9;
    const cos = Math.cos(spread);
    const sin = Math.sin(spread);
    blood.push({
      x, y,
      vx: (dir.x * cos - dir.y * sin) * s + (Math.random() - 0.5) * 2,
      vy: (dir.x * sin + dir.y * cos) * s - Math.random() * 3,
      r: 1.5 + Math.random() * 2.5,
      life: 2.5,
      color: "#d0122a",
    });
  }
}

function spawnSparks(x, y) {
  for (let i = 0; i < 14; i++) {
    if (blood.length >= MAX_BLOOD) blood.shift();
    blood.push({
      x, y,
      vx: (Math.random() - 0.5) * 12,
      vy: -Math.random() * 8,
      r: 1.5,
      life: 0.5,
      color: "#ffd23f",
      spark: true,
    });
  }
}

function updateParticles(dt) {
  for (let i = blood.length - 1; i >= 0; i--) {
    const p = blood[i];
    p.vy += 0.35;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= dt;
    const gy = groundY(p.x);
    if (p.life <= 0) {
      blood.splice(i, 1);
    } else if (gy !== null && p.y >= gy && p.y < gy + 30) {
      // 地面に落ちたら赤い跡を残す
      if (!p.spark) {
        if (stains.length >= MAX_STAINS) stains.shift();
        stains.push({ x: p.x, y: gy + 1, r: p.r * (1 + Math.random()), life: 12 });
      }
      blood.splice(i, 1);
    }
  }
  for (let i = stains.length - 1; i >= 0; i--) {
    stains[i].life -= dt;
    if (stains[i].life <= 0) stains.splice(i, 1);
  }
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.vy += 0.08;
    c.x += c.vx;
    c.y += c.vy;
    c.rot += c.vr;
    if (c.y > VIEW_H + 20) confetti.splice(i, 1);
  }
}

function spawnConfetti() {
  const colors = ["#ff5a36", "#ffd23f", "#2ec4b6", "#3a7bd5", "#e040fb", "#47b84a"];
  for (let i = 0; i < 160; i++) {
    confetti.push({
      x: Math.random() * VIEW_W,
      y: -Math.random() * 300,
      vx: (Math.random() - 0.5) * 3,
      vy: Math.random() * 3,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length],
    });
  }
}

// ============================================
//  ルール（転倒・落下・ゴール）
// ============================================
function checkRules(dt) {
  const { chassis, torso } = bike;

  // ひっくり返ったまま一定時間たつと転倒（すぐに立て直せばセーフ）
  if (Math.abs(bikeAngle()) > FLIP_ANGLE) {
    flipTimer += dt;
    if (flipTimer > FLIP_TIME) eject("バランスを崩して転倒した", { x: 0, y: -1 }, 3);
  } else {
    flipTimer = 0;
  }

  if (chassis.position.y > COURSE.fallY || torso.position.y > COURSE.fallY) {
    dead = true;
    eject("落とし穴に落ちた！", { x: 0, y: 1 }, 0);
    sfx.die();
  }

  if (chassis.position.x >= COURSE.goalX && state === "playing") {
    state = "clear";
    camera.targetZoom = 0.8;
    spawnConfetti();
    sfx.goal();
    setTimeout(showClear, 1200);
  }
}

// ============================================
//  1ステップの更新
// ============================================
function step() {
  const dt = STEP_MS / 1000;

  // 死亡直後はスローモーション
  const timeScale = slowTimer > 0 ? SLOWMO_SCALE : 1;
  engine.timing.timeScale = timeScale;
  simTime += dt * timeScale;

  updateMovers();
  updateCrumbles(dt * timeScale);
  checkGround();

  if (state === "playing") {
    controlBike();
    elapsed += dt;
    checkCheckpoints();
  } else if (state === "clear") {
    // ゴール後は自動でブレーキ
    setSpin(bike.rear, bike.rear.angularVelocity * 0.9);
    setSpin(bike.front, bike.front.angularVelocity * 0.9);
  }
  syncCrank();
  updateBoulders();
  if (padTimer > 0) padTimer -= dt;

  Engine.update(engine, STEP_MS);
  processHits();

  if (state === "playing") checkRules(dt);
  if (state === "down") {
    downTimer += dt;
    if (downTimer >= DEATH_SCREEN_DELAY && !deathShown) showDeath();
  }
  if (slowTimer > 0) slowTimer -= dt;
  if (shakeTimer > 0) shakeTimer -= dt;
  updateParticles(dt * timeScale);

  if (state === "playing") maxX = Math.max(maxX, bike.chassis.position.x);
  const speed = Math.abs(bike.rear.angularVelocity) * WHEEL_RADIUS;
  sfx.updateRide(speed, state === "playing" && onGround && !paused);
}

function distanceMeters() {
  return Math.max(0, Math.floor((maxX - COURSE.startX) / PX_PER_METER));
}

// ============================================
//  画面（HUD・タイトル・死亡・クリア）
// ============================================
function updateHud() {
  $("time").textContent = elapsed.toFixed(2);
  $("distance").textContent = distanceMeters();
  $("deaths").textContent = deaths;
  $("checkpoint").textContent = `${checkpoint + 1}/${COURSE.checkpoints.length}`;
}

function setButtons(list) {
  const box = $("overlay-buttons");
  box.innerHTML = "";
  for (const [label, action, sub] of list) {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (sub) btn.className = "sub";
    btn.onclick = () => {
      btn.blur();
      action();
    };
    box.appendChild(btn);
  }
  box.querySelector("button").focus();
}

function showTitle() {
  overlay.className = "";
  $("overlay-title").textContent = "CRASH RIDE";
  $("overlay-body").innerHTML = `
    <p>トラップだらけのコースを自転車でかけぬけろ！<br>
    頭を打ったり、トゲやノコギリにふれたら終わり。チェックポイントは${COURSE.checkpoints.length}つ。</p>
    <table>
      <tr><td>→ / D</td><td>前進・加速</td><td>← / A</td><td>後退</td></tr>
      <tr><td>↑ / W</td><td>後ろに傾ける</td><td>↓ / S</td><td>前に傾ける</td></tr>
      <tr><td>Space</td><td>ブレーキ</td><td>P</td><td>一時停止</td></tr>
      <tr><td>R</td><td>最初から</td><td>Enter</td><td>チェックポイントから</td></tr>
    </table>`;
  setButtons([["START", () => startGame(true)]]);
}

function showDeath() {
  deathShown = true;
  overlay.className = "dead";
  $("overlay-title").textContent = "YOU DIED";
  $("overlay-body").innerHTML = `
    <p class="result">${deathCause}</p>
    <table>
      <tr><td>走行距離</td><td><b>${distanceMeters()} m</b></td></tr>
      <tr><td>経過時間</td><td><b>${elapsed.toFixed(2)} 秒</b></td></tr>
      <tr><td>死亡回数</td><td><b>${deaths} 回</b></td></tr>
    </table>`;
  const cpLabel = checkpoint >= 0 ? `チェックポイント ${checkpoint + 1} から (Enter)` : "スタートから再開 (Enter)";
  setButtons([[cpLabel, respawn], ["最初からやり直す (R)", () => startGame(false), true]]);
}

function showClear() {
  overlay.className = "";
  $("overlay-title").textContent = "CLEAR!";
  $("overlay-body").innerHTML = `
    <p class="result">ゴールしました！</p>
    <table>
      <tr><td>クリアタイム</td><td><b>${elapsed.toFixed(2)} 秒</b></td></tr>
      <tr><td>死亡回数</td><td><b>${deaths} 回</b></td></tr>
      <tr><td>リスタート回数</td><td><b>${restarts} 回</b></td></tr>
      <tr><td>走行距離</td><td><b>${distanceMeters()} m</b></td></tr>
    </table>`;
  setButtons([["もう一度遊ぶ (R)", () => startGame(false)]]);
}

function togglePause() {
  if (state !== "playing" && !paused) return;
  paused = !paused;
  $("pause-btn").textContent = paused ? "▶" : "II";
  if (paused) for (const k in keys) keys[k] = false;
}

// ============================================
//  描画（物理の座標 → カメラでずらして画面に描く）
// ============================================
function updateCamera() {
  // 投げ出されたら人を追いかける
  const target = ejected ? bike.torso.position : bike.chassis.position;
  const lookAhead = ejected || state === "clear" ? 0 : 120;
  const targetY = Math.min(target.y, COURSE.fallY - 300) - 60;
  camera.x += (target.x + lookAhead - camera.x) * 0.1;
  camera.y += (targetY - camera.y) * 0.08;
  camera.zoom += (camera.targetZoom - camera.zoom) * 0.03;
}

// 決まった数から、いつも同じ「でたらめな数」を作る（建物の形に使う）
function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, "#5ec8ff");
  sky.addColorStop(1, "#d8f3ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 太陽
  ctx.fillStyle = "#fff3a6";
  ctx.beginPath();
  ctx.arc(820, 90, 40, 0, Math.PI * 2);
  ctx.fill();

  // 遠くの山（ゆっくり動く）
  ctx.fillStyle = "#a9dcb6";
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  for (let sx = 0; sx <= VIEW_W; sx += 20) {
    const wx = sx + camera.x * 0.1;
    ctx.lineTo(sx, 300 + Math.sin(wx / 160) * 40 + Math.sin(wx / 70) * 12);
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.fill();

  // 雲
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (let i = 0; i < 8; i++) {
    const x = ((i * 420 - camera.x * 0.2) % 3360 + 3360) % 3360 - 200;
    const y = 60 + (i % 3) * 40;
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.arc(x + 26, y - 10, 28, 0, Math.PI * 2);
    ctx.arc(x + 54, y, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  // 建物（少し速く動く）
  const offset = camera.x * 0.35;
  const first = Math.floor(offset / 130) - 1;
  for (let i = first; i < first + 10; i++) {
    const w = 80 + hash(i) * 50;
    const h = 90 + hash(i + 50) * 150;
    const x = i * 130 - offset;
    const y = 420 - h;
    ctx.fillStyle = ["#7f8fb8", "#8e9cc4", "#7486b0"][Math.abs(i) % 3];
    ctx.fillRect(x, y, w, h + 200);
    ctx.fillStyle = "rgba(255,255,210,0.6)";
    for (let wy = y + 12; wy < 420; wy += 22) {
      for (let wx = x + 10; wx < x + w - 14; wx += 20) {
        if (hash(wx * 3 + wy) > 0.35) ctx.fillRect(wx, wy, 9, 11);
      }
    }
  }

  // 近くの丘（さらに速く動く）
  ctx.fillStyle = "#8fd18f";
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  for (let sx = 0; sx <= VIEW_W; sx += 20) {
    const wx = sx + camera.x * 0.55;
    ctx.lineTo(sx, 430 + Math.sin(wx / 120) * 20);
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.fill();
}

function drawPits() {
  // 落とし穴の奥を暗くする（地面の後ろに描く）
  const grad = ctx.createLinearGradient(0, 560, 0, 1100);
  grad.addColorStop(0, "rgba(30,15,10,0)");
  grad.addColorStop(1, "rgba(30,15,10,0.95)");
  ctx.fillStyle = grad;
  ctx.fillRect(camera.x - 2000, 560, 4000, 1600);
}

function drawLands() {
  for (const land of COURSE.lands) {
    // 土
    ctx.fillStyle = "#a0673a";
    ctx.beginPath();
    ctx.moveTo(land[0][0], 2400);
    for (const [x, y] of land) ctx.lineTo(x, y);
    ctx.lineTo(land[land.length - 1][0], 2400);
    ctx.closePath();
    ctx.fill();

    // 土のしま模様
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 6;
    for (let d = 40; d < 400; d += 50) {
      ctx.beginPath();
      land.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y + d) : ctx.lineTo(x, y + d)));
      ctx.stroke();
    }

    // 草
    ctx.strokeStyle = "#47b84a";
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.beginPath();
    land.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y + 3) : ctx.lineTo(x, y + 3)));
    ctx.stroke();
  }
}

function polygon(vertices) {
  ctx.beginPath();
  vertices.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function drawRamps() {
  for (const body of groundBodies) {
    if (!body.isRamp) continue;
    const v = body.vertices;
    // 支柱
    ctx.strokeStyle = "#7a4a1e";
    ctx.lineWidth = 6;
    for (let t = 0.3; t <= 1; t += 0.35) {
      const x = v[0].x + (v[1].x - v[0].x) * t;
      const y = v[0].y + (v[1].y - v[0].y) * t;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, groundY(x) ?? y + 60);
      ctx.stroke();
    }
    // 板
    ctx.fillStyle = "#ffb627";
    polygon(v);
    ctx.fill();
    ctx.strokeStyle = "#5c3a12";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawSaw(x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(simTime * 18);   // 高速回転
  ctx.fillStyle = "#c9ced6";
  ctx.beginPath();
  const teeth = 16;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r + 6 : r - 2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#6b7280";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#e53935";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHazards() {
  for (const body of groundBodies) {
    if (body.hazard === "saw") {
      // ぶら下げている棒
      if (body.position.y < 400) {
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(body.position.x, body.position.y);
        ctx.lineTo(body.position.x, body.position.y - 300);
        ctx.stroke();
      }
      drawSaw(body.position.x, body.position.y, body.radius);
    }
    if (body.hazard === "spike") {
      const { x, y } = body.position;
      const { w, h } = body;
      ctx.fillStyle = "#9aa3ad";
      ctx.strokeStyle = "#4b5563";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (body.dir === "up") {
        const n = Math.round(w / 12);
        for (let i = 0; i < n; i++) {
          const sx = x - w / 2 + (i * w) / n;
          ctx.moveTo(sx, y + h / 2);
          ctx.lineTo(sx + w / n / 2, y - h / 2 - 8);
          ctx.lineTo(sx + w / n, y + h / 2);
        }
      } else {
        const n = Math.round(h / 12);
        for (let i = 0; i < n; i++) {
          const sy = y - h / 2 + (i * h) / n;
          ctx.moveTo(x + w / 2, sy);
          ctx.lineTo(x - w / 2 - 8, sy + h / n / 2);
          ctx.lineTo(x + w / 2, sy + h / n);
        }
      }
      ctx.fill();
      ctx.stroke();
    }
  }

  for (const m of movers) {
    if (m.hazard === "saw") {
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 5;
      ctx.beginPath();
      if (m.pivot) {
        // 振り子ノコギリ：支点からの腕
        ctx.moveTo(m.pivot.x, m.pivot.y);
        ctx.lineTo(m.position.x, m.position.y);
        ctx.stroke();
        ctx.fillStyle = "#333";
        ctx.fillRect(m.pivot.x - 50, m.pivot.y - 12, 100, 8);
        ctx.beginPath();
        ctx.arc(m.pivot.x, m.pivot.y, 7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(m.position.x, m.position.y);
        ctx.lineTo(m.position.x, m.position.y - 400);
        ctx.stroke();
      }
      drawSaw(m.position.x, m.position.y, m.radius);
    }
    if (m.hazard === "hammer") {
      // 腕
      ctx.strokeStyle = "#5b4636";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(m.pivot.x, m.pivot.y);
      ctx.lineTo(m.position.x, m.position.y);
      ctx.stroke();
      // 支点
      ctx.fillStyle = "#333";
      ctx.beginPath();
      ctx.arc(m.pivot.x, m.pivot.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(m.pivot.x - 60, m.pivot.y - 14, 120, 8);
      // 頭（鉄のかたまり）
      ctx.fillStyle = "#4b5563";
      polygon(m.vertices);
      ctx.fill();
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#e53935";
      ctx.save();
      ctx.translate(m.position.x, m.position.y);
      ctx.rotate(m.angle);
      ctx.fillRect(-27, -8, 54, 16);
      ctx.restore();
    }
    if (m.isPlatform) {
      if (m.axis === "y") {
        // エレベーターのワイヤー
        ctx.strokeStyle = "#444";
        ctx.lineWidth = 3;
        for (const dx of [-m.w / 2 + 10, m.w / 2 - 10]) {
          ctx.beginPath();
          ctx.moveTo(m.position.x + dx, m.position.y);
          ctx.lineTo(m.position.x + dx, 100);
          ctx.stroke();
        }
      }
      ctx.fillStyle = "#6b7280";
      polygon(m.vertices);
      ctx.fill();
      ctx.fillStyle = "#ffd23f";
      for (let i = 0; i < m.w; i += 28) {
        ctx.fillRect(m.position.x - m.w / 2 + i, m.position.y - m.h / 2, 14, 5);
      }
    }
  }

  // ジャンプパッド（踏まれると、ばねが縮む）
  for (const body of groundBodies) {
    if (!body.pad) continue;
    const { x, y } = body.position;
    const squash = body.pad.squash;
    body.pad.squash *= 0.9;
    const top = y - 5 - 10 * (1 - squash);
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const sx = x - body.w / 2 + 6 + (i % 2) * (body.w - 12);
      ctx.lineTo(sx, y + 5 - ((y + 5 - top) * i) / 6);
    }
    ctx.stroke();
    ctx.fillStyle = "#e53935";
    ctx.fillRect(x - body.w / 2, top - 6, body.w, 7);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(x - body.w / 2, y + 2, body.w, 5);
  }

  // シーソー
  for (const plank of seesaws) {
    const s = plank.seesaw;
    ctx.fillStyle = "#6b4423";
    ctx.beginPath();
    ctx.moveTo(s.x - 22, s.y);
    ctx.lineTo(s.x + 22, s.y);
    ctx.lineTo(s.x, s.y - s.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#3a7bd5";
    polygon(plank.vertices);
    ctx.fill();
    ctx.strokeStyle = "#1d3f73";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(s.x, s.y - s.h, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 転がる岩
  for (const b of boulders) {
    if (!b.body || b.removed) continue;
    const { x, y } = b.body.position;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.body.angle);
    ctx.fillStyle = "#7d7368";
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4a443d";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#5f574e";
    ctx.beginPath();
    ctx.arc(-b.r * 0.3, -b.r * 0.2, b.r * 0.25, 0, Math.PI * 2);
    ctx.arc(b.r * 0.35, b.r * 0.3, b.r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const piece of crumbles) {
    const c = piece.crumble;
    const jitter = c.timer >= 0 && !c.fallen ? (Math.random() - 0.5) * 3 : 0;
    ctx.save();
    ctx.translate(jitter, 0);
    ctx.fillStyle = c.timer >= 0 ? "#b07a4a" : "#c08a55";
    polygon(piece.vertices);
    ctx.fill();
    ctx.strokeStyle = "#5c3a12";
    ctx.lineWidth = 2;
    ctx.stroke();
    // ひび
    ctx.beginPath();
    ctx.moveTo(piece.position.x - 20, piece.position.y - 8);
    ctx.lineTo(piece.position.x - 5, piece.position.y + 2);
    ctx.lineTo(piece.position.x + 12, piece.position.y - 6);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSigns() {
  for (const sign of COURSE.signs) {
    const y = groundY(sign.x) ?? 500;
    ctx.fillStyle = "#6b4423";
    ctx.fillRect(sign.x - 3, y - 70, 6, 70);
    ctx.font = "bold 18px sans-serif";
    const w = ctx.measureText(sign.text).width + 20;
    ctx.fillStyle = sign.color;
    ctx.fillRect(sign.x - w / 2, y - 100, w, 32);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(sign.text, sign.x, y - 84);
  }
}

function drawCheckpoints() {
  COURSE.checkpoints.forEach((x, i) => {
    const y = groundY(x);
    const done = i <= checkpoint;
    ctx.fillStyle = "#555";
    ctx.fillRect(x - 2, y - 90, 4, 90);
    ctx.fillStyle = done ? "#2e9e5b" : "#9ca3af";
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 90);
    ctx.lineTo(x + 40, y - 78);
    ctx.lineTo(x + 2, y - 66);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`CP${i + 1}`, x + 17, y - 78);
  });
}

function drawWalls() {
  for (const x of COURSE.walls) {
    const y = groundY(x) ?? 500;
    ctx.fillStyle = "#7a4a1e";
    for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * 14 - 4, y - 90, 8, 90);
    ctx.fillRect(x - 24, y - 75, 48, 8);
    ctx.fillRect(x - 24, y - 40, 48, 8);
  }
}

function drawGoal() {
  const x = COURSE.goalX;
  const y = groundY(x);
  ctx.fillStyle = "#555";
  ctx.fillRect(x - 3, y - 160, 6, 160);
  const size = 12;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? "#111" : "#fff";
      ctx.fillRect(x + 3 + c * size, y - 160 + r * size + Math.sin(simTime * 4 + c) * 2, size, size);
    }
  }
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = "#e53935";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("GOAL", x + 36, y - 175);
}

// その x の位置の地面の高さ（地面がないときは null）
function groundY(x) {
  for (const land of COURSE.lands) {
    for (let i = 0; i < land.length - 1; i++) {
      const [x1, y1] = land[i];
      const [x2, y2] = land[i + 1];
      if (x >= x1 && x <= x2) return y1 + (y2 - y1) * (x - x1) / (x2 - x1);
    }
  }
  return null;
}

function drawWheel(wheel) {
  const { x, y } = wheel.position;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(wheel.angle);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, WHEEL_RADIUS - 3, 0, Math.PI * 2);
  ctx.stroke();
  // スポーク（回転が見えるように）
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * -14, Math.sin(a) * -14);
    ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
    ctx.stroke();
  }
  ctx.strokeStyle = "#ff5a36";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(14, 0);
  ctx.stroke();
  ctx.fillStyle = "#666";
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function line(a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

// 自転車（フレーム・ハンドル・サドル・ペダル・車輪）
function drawBike() {
  const { chassis, frame, rear, front, crank } = bike;
  const angle = chassis.angle;
  const ox = frame.position.x;
  const oy = frame.position.y;

  // 物理の座標を、車体から見た座標に直す
  const toLocal = p => {
    const dx = p.x - ox;
    const dy = p.y - oy;
    return { x: dx * Math.cos(-angle) - dy * Math.sin(-angle), y: dx * Math.sin(-angle) + dy * Math.cos(-angle) };
  };
  const r = toLocal(rear.position);
  const f = toLocal(front.position);
  const c = toLocal(crank.position);

  drawWheel(rear);
  drawWheel(front);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(angle);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ff5a36";
  ctx.lineWidth = 5;
  const seat = { x: -12, y: -10 };
  const head = { x: 20, y: -8 };
  line(r, c);
  line(r, seat);
  line(seat, c);
  line(c, head);
  line(seat, head);
  line(head, f);
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 4;
  line(head, { x: 24, y: -18 });                  // ハンドルの柱
  line({ x: 19, y: -19 }, { x: 30, y: -17 });     // ハンドル
  ctx.lineWidth = 5;
  line({ x: -19, y: -12 }, { x: -5, y: -12 });    // サドル
  ctx.restore();

  // ペダル
  ctx.save();
  ctx.translate(crank.position.x, crank.position.y);
  ctx.rotate(crank.angle);
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 3;
  line({ x: -9, y: 0 }, { x: 9, y: 0 });
  ctx.fillStyle = "#222";
  ctx.fillRect(7, -2, 6, 4);
  ctx.fillRect(-13, -2, 6, 4);
  ctx.restore();
}

// ラグドールの手足を1本描く
function drawLimb(body) {
  const ux = Math.cos(body.angle) * body.len / 2;
  const uy = Math.sin(body.angle) * body.len / 2;
  ctx.strokeStyle = body.color;
  ctx.lineWidth = body.thick;
  ctx.lineCap = "round";
  line({ x: body.position.x - ux, y: body.position.y - uy }, { x: body.position.x + ux, y: body.position.y + uy });
}

function drawHead() {
  const { head, torso } = bike;
  const { x, y } = head.position;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(torso.angle + Math.PI / 2 - 0.35);
  ctx.fillStyle = "#f2c19b";
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fill();
  // ヘルメット
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.arc(0, -1, 11.5, Math.PI, Math.PI * 2);
  ctx.fill();
  // 顔（死ぬと × の目になる）
  ctx.strokeStyle = "#222";
  ctx.fillStyle = "#222";
  ctx.lineWidth = 1.6;
  if (dead) {
    for (const ex of [3, 8]) {
      line({ x: ex - 2, y: 1 }, { x: ex + 2, y: 5 });
      line({ x: ex + 2, y: 1 }, { x: ex - 2, y: 5 });
    }
  } else {
    ctx.beginPath();
    ctx.arc(7, 2, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(5, 6, 3, 0.2, Math.PI - 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRider() {
  bike.backParts.forEach(drawLimb);
  drawBike();
  drawLimb(bike.torso);
  drawHead();
  bike.frontParts.forEach(drawLimb);
}

function drawParticles() {
  for (const s of stains) {
    ctx.fillStyle = `rgba(150, 10, 25, ${Math.min(1, s.life / 3) * 0.8})`;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, s.r * 1.8, s.r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of blood) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.r, p.r * 0.8, Math.atan2(p.vy, p.vx), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawScreenEffects() {
  // 死亡したら画面を赤くする
  if (state === "down" && dead) {
    const a = Math.min(0.35, downTimer * 0.3);
    const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, 100, VIEW_W / 2, VIEW_H / 2, VIEW_W / 1.4);
    g.addColorStop(0, "rgba(200,0,0,0)");
    g.addColorStop(1, `rgba(200,0,0,${a * 2})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  // 紙吹雪
  for (const c of confetti) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }
  if (paused) {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PAUSE", VIEW_W / 2, VIEW_H / 2 - 20);
    ctx.font = "20px sans-serif";
    ctx.fillText("P キーで再開", VIEW_W / 2, VIEW_H / 2 + 30);
  }
}

function draw() {
  drawBackground();

  // 強い衝突のときは画面を揺らす
  let sx = 0;
  let sy = 0;
  if (shakeTimer > 0) {
    sx = (Math.random() - 0.5) * shakePower * 2;
    sy = (Math.random() - 0.5) * shakePower * 2;
  }

  ctx.save();
  ctx.translate(VIEW_W / 2 + sx, VIEW_H / 2 + sy);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));
  drawPits();
  drawSigns();
  drawRamps();
  drawLands();
  drawCheckpoints();
  drawWalls();
  drawGoal();
  drawHazards();
  drawRider();
  drawParticles();
  ctx.restore();

  drawScreenEffects();
  updateHud();
}

// ============================================
//  キー入力
// ============================================
const KEY_NAMES = {
  ArrowRight: "ArrowRight", ArrowLeft: "ArrowLeft", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
  d: "d", a: "a", w: "w", s: "s", D: "d", A: "a", W: "w", S: "s", " ": " ",
};

document.addEventListener("keydown", event => {
  const key = event.key;
  if (key === "r" || key === "R") {
    startGame(state === "title");
    return;
  }
  if (key === "p" || key === "P") {
    togglePause();
    return;
  }
  if (key === "Enter" && state === "down") {
    event.preventDefault();
    respawn();
    return;
  }
  const name = KEY_NAMES[key];
  if (name) {
    keys[name] = true;
    event.preventDefault();   // 矢印キーやスペースで画面がスクロールしないように
  }
});

document.addEventListener("keyup", event => {
  const name = KEY_NAMES[event.key];
  if (name) keys[name] = false;
});

// 画面の外に出たらキーを離したことにする
window.addEventListener("blur", () => {
  for (const k in keys) keys[k] = false;
});

$("pause-btn").addEventListener("click", event => {
  event.currentTarget.blur();
  togglePause();
});

// ============================================
//  メインループ
// ============================================
let lastTime = performance.now();
let accumulator = 0;

function loop(now) {
  accumulator += Math.min(now - lastTime, 100);
  lastTime = now;
  // 物理演算は決まった時間ずつ進める（パソコンの速さで動きが変わらないように）
  while (accumulator >= STEP_MS) {
    if (state !== "title" && !paused) step();
    accumulator -= STEP_MS;
  }
  updateCamera();
  draw();
  requestAnimationFrame(loop);
}

if (typeof Matter === "undefined") {
  $("overlay-title").textContent = "読み込みエラー";
  $("overlay-body").textContent = "Matter.js を読み込めませんでした。インターネットに接続してから、ページを開き直してください。";
} else {
  buildWorld(COURSE.startX);
  showTitle();
  requestAnimationFrame(loop);
}
