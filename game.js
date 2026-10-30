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

// 乗り物に共通の設定
const BRAKE = 0.8;                // ブレーキ（1回ごとに回転を80%にする）
const MAX_LEAN_SPEED = 0.06;      // 傾ける操作で出せる最大の回転速度（無制限に回らないように）
const FLIP_ANGLE = 1.75;          // これより大きく傾くと「ひっくり返り」（約100度）
const FLIP_TIME = 0.9;            // ひっくり返ったままこの秒数たつと転倒

// ---------- 乗り物 ----------
// 位置はすべて「車体フレームの中心」から見た座標（右が +x、下が +y）
//   wheels   … 後輪・前輪の位置と半径
//   parts    … 車体を作る長方形 [x, y, 幅, 高さ, 密度]（1つ目がフレーム）
//   pose     … 人の関節の位置（hip=おしり, shoulder=肩, hand=手, foot=足 など）
//   pedals   … true ならペダルをこぐ（足がペダルにつながる）。false なら足は車体に固定
//   maxSpin  … 前進の最高回転速度 / reverseSpin … 後退の最高回転速度 / accel … 加速
//   lean     … 地面で傾ける力 / airLean … 空中で傾ける力 / lift … 傾けるときに車輪を持ち上げる力
//   landEject / landFatal … 車輪がこの速さで着地すると投げ出される / 死亡
//   suspension … 車輪と車体をつなぐばねの固さ（小さいほどやわらかい）
const VEHICLES = {
  bike: {
    name: "自転車",
    desc: "バランスのいい、ふつうの自転車",
    stars: "★★☆",
    wheels: { rear: { x: -32, y: 22, r: 18 }, front: { x: 32, y: 22, r: 18 } },
    parts: [[0, 0, 76, 10, 0.002], [24, -18, 14, 5, 0.001], [-12, -12, 16, 5, 0.001]],
    pose: {
      hip: [-10, -16], shoulder: [0, -42], neck: [1, -46], head: [3, -56],
      elbow: [13, -29], hand: [24, -19],
      kneeF: [6, -8], footF: [9, 12], kneeB: [2, -4], footB: [-9, 12],
    },
    pedals: true,
    maxSpin: 0.42, reverseSpin: 0.22, accel: 0.02,
    lean: 0.004, airLean: 0.014, lift: 0.004,
    landEject: 10, landFatal: 13.5,
    suspension: 0.6,
  },
  moto: {
    name: "バイク",
    desc: "とにかく速い。重くて着地に強いが、止まりにくい",
    stars: "★★★",
    wheels: { rear: { x: -38, y: 22, r: 20 }, front: { x: 40, y: 22, r: 20 } },
    parts: [[0, 0, 84, 12, 0.004], [30, -20, 14, 6, 0.001], [-10, -12, 30, 8, 0.002]],
    pose: {
      hip: [-12, -18], shoulder: [8, -42], neck: [10, -46], head: [13, -55],
      elbow: [20, -30], hand: [32, -22],
      kneeF: [10, -10], footF: [0, 8], kneeB: [6, -6], footB: [-4, 8],
    },
    pedals: false,
    engine: true,
    maxSpin: 0.5, reverseSpin: 0.2, accel: 0.03,
    lean: 0.005, airLean: 0.012, lift: 0.006,
    landEject: 12.5, landFatal: 16,
    suspension: 0.35,
  },
  chair: {
    name: "車いす",
    desc: "遅いけど、ウィリーで段差をこえられる。前の車輪が小さい",
    stars: "★★★★",
    wheels: { rear: { x: -14, y: 12, r: 22 }, front: { x: 30, y: 27, r: 7 } },
    parts: [[0, 0, 44, 8, 0.002], [-22, -16, 6, 30, 0.001], [28, 16, 14, 4, 0.001]],
    pose: {
      hip: [-12, -8], shoulder: [-10, -38], neck: [-9, -42], head: [-7, -52],
      elbow: [-18, -22], hand: [-10, -8],
      kneeF: [16, -8], footF: [26, 12], kneeB: [14, -6], footB: [22, 12],
    },
    pedals: false,
    maxSpin: 0.3, reverseSpin: 0.2, accel: 0.025,
    lean: 0.004, airLean: 0.016, lift: 0.005,
    landEject: 11, landFatal: 14.5,
    suspension: 0.7,
  },
};
const VEHICLE_ORDER = ["bike", "moto", "chair"];
let vehicleId = "bike";
let vehicle = VEHICLES[vehicleId];

// ダメージ（衝突の速さ。単位はピクセル/ステップ）
//   hurt  … これ以上で自転車から投げ出される
//   fatal … これ以上で死亡
const DAMAGE = {
  head: { hurt: 2, fatal: 4 },
  torso: { hurt: 4, fatal: 8 },
  limb: { hurt: 7, fatal: 12 },
};

// 死亡演出
const SLOWMO_TIME = 0.7;          // スローモーションの長さ（秒）
const SLOWMO_SCALE = 0.3;         // スローモーションの速さ
const DEATH_SCREEN_DELAY = 2.6;   // 死亡から YOU DIED を出すまでの秒数

// 当たり判定のグループ（何と何がぶつかるか）
const CAT = { GROUND: 0x0001, BIKE: 0x0002, RIDER: 0x0004, MOVER: 0x0008, DEBRIS: 0x0010 };

// ---------- コース ----------
// lands：地面の表面の点（左から右へ）。点と点の間を、回転させた長方形で作る
// 平らな道は少なめにして、ギミックを次々に並べている
const MAIN_COURSE = {
  startX: 120,
  goalX: 11750,
  fakeGoalX: 7950,   // ニセのゴール（ここでゴールしたと思って止まると、下の足場が抜ける）
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
    // L. 着地の下り坂 → ハンマー → ニセのゴール → 抜ける床（8000〜8240）
    [[7250, 500], [7500, 600], [8000, 600]],
    // M. 地雷原 → N. プレス機 → O. 飛び出すトゲ
    [[8240, 600], [10500, 600]],
    // P. 大砲の丘 → 最後の地雷 → ゴール
    [[10500, 600], [10650, 560], [10800, 600], [10950, 560], [11150, 600], [12500, 600]],
  ],
  ramps: [],
  walls: [-300, 12000],
  checkpoints: [2600, 4560, 6050, 6550, 7530, 8420, 9720, 10460],
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
    { x1: 8000, x2: 8240, y: 600, pieces: 4, delay: 0.12, fake: true },   // 抜ける床（ふつうの地面に見える）
  ],
  // 地雷：ふむと「ピッ」と鳴って、fuse 秒後に爆発する。止まらずに走りぬければ助かる
  mines: [
    { x: 8650, fuse: 0.5 },
    { x: 8800, fuse: 0.5 },
    { x: 8960, fuse: 0.5 },
    { x: 11600, fuse: 0.45 },   // ゴールの直前
  ],
  // プレス機：自転車が trigger をこえると落ちてくる。そのあとは上下をくりかえす
  crushers: [
    { x: 9500, w: 180, h: 70, top: 300, trigger: 9280, period: 3.4 },
  ],
  // 飛び出すトゲ：自転車が trigger をこえると目の前に飛び出して、up 秒後に引っこむ（1回だけ）
  popSpikes: [
    { x: 9950, w: 70, h: 80, trigger: 9760, up: 1.4 },
    { x: 10150, w: 70, h: 80, trigger: 9960, up: 1.4 },
    { x: 10330, w: 70, h: 80, trigger: 10140, up: 1.4 },
  ],
  // 大砲：自転車が x1〜x2 にいる間、自転車のいる場所をねらって砲弾を撃つ
  cannons: [
    { x: 11300, y: 330, x1: 10520, x2: 11180, interval: 1.7, flight: 1.0, r: 14 },
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
    { x: 8550, text: "ここから先は安全", color: "#2e9e5b" },   // うそ
    { x: 9200, text: "トンネル", color: "#3a7bd5" },
    { x: 9850, text: "まっすぐな道", color: "#2e9e5b" },
    { x: 10560, text: "見晴らしの丘", color: "#2e9e5b" },
  ],
};

// ---------- ステージ ----------
// メインコースも、都道府県ステージ（stages.js）と同じしくみで管理する
STAGES.main = {
  name: "CRASH RIDE",
  sub: "トラップだらけのメインコース",
  course: MAIN_COURSE,
  death: { title: "YOU DIED" },
  clear: { title: "CLEAR!", line: "ゴールしました！" },
};

// テーマで色を書いていないところは、メインコースと同じ色になる
const DEFAULT_THEME = {
  sky: ["#5ec8ff", "#d8f3ff"],
  sun: "#fff3a6",
  mountains: "#a9dcb6",
  hills: "#8fd18f",
  buildings: ["#7f8fb8", "#8e9cc4", "#7486b0"],
  windows: ["rgba(255,255,210,0.6)"],
  soil: "#a0673a",
  stripe: "rgba(0,0,0,0.08)",
  grass: "#47b84a",
  ramp: { fill: "#ffb627", stroke: "#5c3a12" },
  far: null,
};

// コースに書いていない部品は「なし」にする
const COURSE_KEYS = [
  "lands", "ramps", "walls", "checkpoints", "saws", "movingSaws", "spikes", "hammers", "platforms",
  "crumbles", "pads", "seesaws", "boulders", "signs", "mines", "crushers", "popSpikes", "cannons",
  "water", "slippery", "sharks", "depthShots",
];
for (const id in STAGES) {
  const st = STAGES[id];
  for (const key of COURSE_KEYS) if (!st.course[key]) st.course[key] = [];
  st.theme = { ...DEFAULT_THEME, ...st.theme };
  st.decor = st.decor || [];
  st.death = st.death || { title: "YOU DIED" };
  st.clear = st.clear || { title: "CLEAR!", line: "ゴールしました！" };
}

let stageId = "main";
let stage = STAGES.main;
let COURSE = MAIN_COURSE;
let menu = "title";   // タイトル画面で今どのメニューを出しているか（"title" / "prefs"）

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
let mines;           // 地雷
let cannons;         // 大砲
let cannonBalls;     // 飛んでいる砲弾
let blasts;          // 爆発の光（描画用）
let fakeGoalPassed = false;
let liftRamps = [];  // チェーンリフト（自動で引っぱり上げるレール）
let chefs = [];      // 背景のたこ焼き職人
let flyingTakoyaki = [];   // 画面の奥から飛んでくるたこ焼き
let slipCooldown = 0;
let chainTick = 0;
const popups = [];   // 「なんでやねん!」などの、浮かんで消える文字
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
  // engine が true（バイク）なら、止まっていてもエンジン音が鳴る
  updateRide(speed, active, engine) {
    if (!this.ride) return;
    const t = this.ctx.currentTime;
    let vol = active ? Math.min(0.035, speed * 0.005) : 0;
    let freq = 50 + speed * 14;
    if (engine) {
      vol = active ? Math.min(0.06, 0.025 + speed * 0.004) : 0;
      freq = 45 + speed * 20;
    }
    this.ride.gain.gain.setTargetAtTime(vol, t, 0.05);
    this.ride.osc.frequency.setTargetAtTime(freq, t, 0.05);
  },
  jump() { this.tone(300, 0.15, "square", 0.05, 600); },
  land(power) { this.noise(0.12, Math.min(0.25, 0.05 + power * 0.02), 300); },
  hit(power) { this.noise(0.2, Math.min(0.35, 0.08 + power * 0.03), 600); this.tone(120, 0.15, "triangle", 0.1, 60); },
  saw() { this.tone(900, 0.25, "sawtooth", 0.06, 1400); },
  hammer() { this.noise(0.25, 0.3, 200); },
  crumble() { this.noise(0.4, 0.15, 400); },
  die() { this.tone(400, 0.6, "sawtooth", 0.08, 60); this.noise(0.4, 0.3, 500); },
  checkpoint() { this.tone(660, 0.12, "square", 0.06); setTimeout(() => this.tone(990, 0.2, "square", 0.06), 120); },
  beep() { this.tone(1800, 0.07, "square", 0.06); },
  shark() { this.noise(0.5, 0.25, 600); this.tone(90, 0.5, "sawtooth", 0.1, 50); },
  chomp() { this.noise(0.15, 0.4, 900); setTimeout(() => this.noise(0.15, 0.4, 700), 160); },
  chain() { this.tone(1400, 0.02, "square", 0.025); },
  sizzle() { this.noise(0.25, 0.12, 2600); },
  zukko() { this.tone(900, 0.7, "sine", 0.12, 110); },                                   // ズコー
  slap() { this.noise(0.12, 0.35, 3000); this.tone(1300, 0.06, "square", 0.05, 500); },   // パシーン
  splash() { this.noise(0.7, 0.35, 1400); this.tone(300, 0.4, "sine", 0.06, 80); },
  explode() { this.noise(0.9, 0.45, 350); this.tone(90, 0.6, "sawtooth", 0.12, 30); },
  cannon() { this.noise(0.3, 0.3, 250); this.tone(160, 0.25, "triangle", 0.12, 50); },
  pop() { this.tone(500, 0.12, "sawtooth", 0.08, 1500); },
  slam() { this.noise(0.35, 0.4, 180); this.tone(70, 0.3, "triangle", 0.15, 35); },
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
      const segment = makeSegment(x1, y1, x2, y2, 40);
      // ソースでツルツルの地面（タイヤがすべる）
      for (const r of COURSE.slippery) {
        if (x1 >= r.x1 && x2 <= r.x2) {
          segment.friction = r.friction;
          segment.frictionStatic = 0;
          segment.slippery = true;
        }
      }
      groundBodies.push(segment);
    }
  }
  // ジャンプ台・レール。5つ目に { lift: 速さ } があればチェーンリフト
  for (const [x1, y1, x2, y2, opt] of COURSE.ramps) {
    const ramp = makeSegment(x1, y1, x2, y2, 16);
    ramp.isRamp = true;
    if (opt && opt.lift) ramp.lift = opt.lift;
    groundBodies.push(ramp);
  }
  liftRamps = groundBodies.filter(b => b.lift);
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

  // 巨大ハンマー・振り子ノコギリ・ハリセン
  //   motion: "slap" は、ふり上げて待ってから一気にたたきおろす動き（ツッコミ）
  for (const h of COURSE.hammers) {
    const isSaw = h.kind === "saw";
    const shape = isSaw
      ? Bodies.circle(h.x, h.y + h.len, h.r, { density: 0.05 })
      : h.kind === "harisen"
        ? Bodies.rectangle(h.x, h.y + h.len, 80, 36, { density: 0.05 })
        : Bodies.rectangle(h.x, h.y + h.len, 54, 74, { density: 0.05 });
    const hammer = makeMover(shape, t => {
      const a = h.motion === "slap"
        ? slapAngle(((t + h.phase) % h.period + h.period) % h.period, h.period)
        : Math.sin((t / h.period) * Math.PI * 2 + h.phase) * h.amp;
      return { x: h.x + Math.sin(a) * h.len, y: h.y + Math.cos(a) * h.len, angle: -a };
    });
    hammer.hazard = isSaw ? "saw" : "hammer";
    hammer.kind = h.kind;
    hammer.radius = h.r;
    hammer.pivot = { x: h.x, y: h.y };
    hammer.len = h.len;
    hammer.deathText = h.death;
    hammer.ejectText = h.eject;
    if (h.motion === "slap") hammer.slap = { period: h.period, phase: h.phase, last: 0 };
    movers.push(hammer);
  }

  // 動く足場（axis: "y" なら上下に動くエレベーター、motion: "droptower" ならフリーフォール）
  for (const p of COURSE.platforms) {
    const startY = p.motion === "droptower" ? p.bottom : p.y;
    const platform = makeMover(Bodies.rectangle(p.x, startY, p.w, p.h, { density: 0.05, friction: 1 }), t => {
      if (p.motion === "droptower") return { x: p.x, y: dropTowerY(p, t), angle: 0 };
      const s = Math.sin((t / p.period) * Math.PI * 2) * p.amp;
      return p.axis === "y" ? { x: p.x, y: p.y + s, angle: 0 } : { x: p.x + s, y: p.y, angle: 0 };
    });
    platform.isPlatform = true;
    platform.w = p.w;
    platform.h = p.h;
    platform.axis = p.motion === "droptower" ? "drop" : p.axis || "x";
    if (p.motion === "droptower") platform.tower = p;
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
      piece.crumble = { delay: c.delay, timer: -1, fake: c.fake, style: c.style };
      piece.w = w - 2;
      crumbles.push(piece);
    }
  }

  // プレス機：trigger をこえたら落ちてきて、そのあとは上下をくりかえす
  for (const c of COURSE.crushers) {
    // auto: true なら、自転車が来なくても最初から動いている（phase 秒ずらして動き始める）
    const trap = { triggerAt: c.auto ? c.phase : null, trigger: c.trigger, sound: "slam", period: c.period, lastPhase: 0 };
    const floor = groundY(c.x);
    const crusher = makeMover(Bodies.rectangle(c.x, c.top - c.h / 2, c.w, c.h, { density: 0.05, friction: 1 }), t => {
      let k = 0;   // 0 = 一番上、1 = 地面まで下りた
      let shakeX = 0;
      if (trap.triggerAt !== null && t >= trap.triggerAt) {
        const p = (t - trap.triggerAt) % c.period;
        if (p < 0.15) shakeX = Math.sin(p * 120) * 3;            // 落ちる直前にガタガタ揺れる
        else if (p < 0.4) k = ((p - 0.15) / 0.25) ** 2;          // だんだん速く落ちる
        else if (p < 1.4) k = 1;                                 // 地面に着いたまま
        else if (p < 2.6) k = 1 - (p - 1.4) / 1.2;               // ゆっくり上がる
      }
      const bottom = c.top + (floor - c.top) * k;
      return { x: c.x + shakeX, y: bottom - c.h / 2, angle: 0 };
    });
    crusher.hazard = "crusher";
    crusher.kind = c.kind;
    crusher.deathText = c.death;
    crusher.w = c.w;
    crusher.h = c.h;
    crusher.trap = trap;
    movers.push(crusher);
  }

  // 飛び出すトゲ：ふだんは地面の中にかくれている
  for (const sp of COURSE.popSpikes) {
    // period があるときは、自転車が来なくても period 秒ごとに飛び出す
    const trap = { triggerAt: sp.period ? 0 : null, trigger: sp.trigger, sound: "pop" };
    const floor = groundY(sp.x);
    const spike = makeMover(Bodies.rectangle(sp.x, floor + sp.h / 2 + 6, sp.w, sp.h, { density: 0.05 }), t => {
      let k = 0;   // 0 = かくれている、1 = 飛び出している
      if (trap.triggerAt !== null) {
        const p = sp.period ? ((t + sp.phase) % sp.period + sp.period) % sp.period : t - trap.triggerAt;
        if (p < 0) k = 0;
        else if (p < 0.08) k = p / 0.08;
        else if (p < sp.up) k = 1;
        else if (p < sp.up + 0.4) k = 1 - (p - sp.up) / 0.4;
      }
      return { x: sp.x, y: floor + sp.h / 2 + 6 - (sp.h + 2) * k, angle: 0 };
    });
    spike.hazard = "spike";
    spike.dir = "pop";
    spike.style = sp.style;
    spike.deathText = sp.death;
    spike.ejectText = sp.eject;
    spike.w = sp.w;
    spike.h = sp.h;
    spike.floor = floor;
    spike.trap = trap;
    movers.push(spike);
  }

  // サメ：川から飛び出して、乗っている人を食べる
  for (const sh of COURSE.sharks) {
    const trap = { triggerAt: null, trigger: sh.trigger, sound: "shark" };
    const shark = makeMover(Bodies.rectangle(sh.x, sh.waterY + 40, 120, 46, { density: 0.05 }), t => sharkPose(sh, trap, t));
    shark.hazard = "shark";
    shark.deathText = sh.death;
    shark.sharkData = sh;
    shark.trap = trap;
    shark.lastY = sh.waterY + 40;
    movers.push(shark);
  }

  // 背景のたこ焼き職人
  chefs = COURSE.depthShots.map(d => ({ ...d, timer: 0.6, flip: 0 }));
  flyingTakoyaki = [];

  // 地雷：ふれたら作動する（すり抜けるセンサー）
  mines = COURSE.mines.map(m => {
    const y = groundY(m.x);
    const body = Bodies.rectangle(m.x, y - 3, 26, 8, { isStatic: true, isSensor: true });
    body.mine = { x: m.x, y, fuse: m.fuse, timer: -1, done: false };
    Composite.add(engine.world, body);
    return body;
  });

  cannons = COURSE.cannons.map(c => ({ ...c, timer: 0.3, aim: Math.PI, flash: 0 }));
  cannonBalls = [];
  blasts = [];

  // 動く物の最初の位置
  updateMovers();

  solidBodies = [...groundBodies, ...movers, ...crumbles, ...seesaws];
  Composite.add(engine.world, solidBodies);
}

// サメの位置と向き。飛んでいないときは水の中にかくれている
//   右から左へ、放物線をえがいて飛ぶ
function sharkPose(sh, trap, t) {
  const hidden = { x: sh.x, y: sh.waterY + 40, angle: 0 };
  if (trap.triggerAt === null || t < trap.triggerAt) return hidden;
  const p = (t - trap.triggerAt) % sh.period;
  if (p > sh.leap) return hidden;
  const u = p / sh.leap;
  const h = sh.waterY - sh.peakY;
  const x = sh.x + sh.span / 2 - sh.span * u;
  const y = sh.waterY - h * 4 * u * (1 - u);
  // 進む向きに体をかたむける（左向きが 0）
  const angle = Math.atan2(-h * (4 - 8 * u), -sh.span) - Math.PI;
  return { x, y, angle };
}

// サメが水面を出入りするときの水しぶき・食べた人を口の中に入れておく
function updateSharks() {
  for (const m of movers) {
    if (m.hazard !== "shark") continue;
    const w = COURSE.water.find(w => m.position.x > w.x1 && m.position.x < w.x2);
    if (w && (m.lastY > w.y) !== (m.position.y > w.y) && Math.abs(m.position.x - camera.x) < 700) {
      splashFx(m.position.x, w.y, 25);
      sfx.splash();
    }
    m.lastY = m.position.y;
  }
  if (bike.eatenBy) {
    const shark = bike.eatenBy;
    for (const p of bike.riderParts) {
      Body.setPosition(p, { x: shark.position.x - 30 + (Math.random() - 0.5) * 10, y: shark.position.y });
      Body.setVelocity(p, shark.velocity);
    }
  }
}

// サメに食べられる
function eatRider(shark, point) {
  if (dead || (state !== "playing" && state !== "down")) return;
  bike.eatenBy = shark;
  for (const p of bike.riderParts) p.collisionFilter.mask = 0;
  kill(shark.deathText || "サメに食べられた！", point, { x: -1, y: -0.3 }, 14);
  addPopup(point.x, point.y - 90, "ガブッ!!", "#ff5a36", 46);
  sfx.chomp();
}

// チェーンリフト：レールにふれている車輪を、決まった速さで回して引っぱり上げる
function updateLifts(dt) {
  if (!liftRamps.length) return;
  let lift = null;
  for (const wheel of [bike.rear, bike.front]) {
    for (const ramp of liftRamps) {
      if (Query.collides(wheel, [ramp]).length) {
        Body.setAngularVelocity(wheel, ramp.lift / wheel.circleRadius);
        lift = ramp;
      }
    }
  }
  const onLift = lift !== null;
  // リフトの上では車体がレールと平行になるように支える（ひっくり返らないように）
  if (onLift && !ejected) {
    const c = bike.chassis;
    Body.setAngularVelocity(c, c.angularVelocity * 0.7 + (lift.angle - c.angle) * 0.05);
  }
  // カタカタカタ…
  if (onLift && state === "playing") {
    chainTick -= dt;
    if (chainTick <= 0) {
      chainTick = 0.12;
      sfx.chain();
    }
  }
}

// ソースの上でタイヤが空回りしたら「ツルッ」
function updateSlip(dt) {
  if (slipCooldown > 0) slipCooldown -= dt;
  if (state !== "playing" || !onGround || slipCooldown > 0) return;
  const x = bike.chassis.position.x;
  if (!COURSE.slippery.some(r => x > r.x1 && x < r.x2)) return;
  const wheelSpeed = bike.rear.angularVelocity * bike.rear.circleRadius;
  if (Math.abs(wheelSpeed - bike.chassis.velocity.x) > 3) {
    slipCooldown = 1.2;
    addPopup(x, bike.chassis.position.y - 70, "ツルッ", "#ffd23f", 26);
  }
}

// 背景のたこ焼き職人：遠くに見えるように、画面といっしょに少し動く
function chefScreenX(c) {
  return c.x + (camera.x - c.x) * 0.55;
}

// たこ焼き職人がひっくり返すたびに、画面の奥からたこ焼きが飛んでくる
function updateChefs(dt) {
  const x = bike.chassis.position.x;
  for (const c of chefs) {
    if (c.flip > 0) c.flip -= dt;
    if (state !== "playing" || x < c.x1 || x > c.x2) continue;
    c.timer -= dt;
    if (c.timer > 0) continue;
    c.timer = c.interval;
    c.flip = 0.35;
    // 自転車が少し先に進む場所をねらう
    const tx = x + bike.chassis.velocity.x * c.flight * 60 * c.lead;
    const gy = groundY(tx) ?? bike.chassis.position.y + 40;
    const sx = chefScreenX(c);
    flyingTakoyaki.push({ sx, sy: c.y, tx, ty: gy - 40, gy, t: 0, T: c.flight, r: c.r, death: c.death });
    sfx.sizzle();
    addPopup(sx, c.y - 90, "ほいっ!", "#ffd23f", 22);
  }
  // 手前まで飛んできたら、ふつうの（ぶつかる）たこ焼きになる
  for (let i = flyingTakoyaki.length - 1; i >= 0; i--) {
    const f = flyingTakoyaki[i];
    f.t += dt;
    if (f.t < f.T) continue;
    flyingTakoyaki.splice(i, 1);
    const body = Bodies.circle(f.tx, f.ty, f.r, {
      density: 0.02, friction: 0.6, restitution: 0.3, frictionAir: 0,
      collisionFilter: { group: 0, category: CAT.DEBRIS, mask: CAT.GROUND | CAT.BIKE | CAT.RIDER | CAT.DEBRIS },
    });
    body.hazard = "cannonball";
    body.radius = f.r;
    body.kind = "takoyaki";
    body.deathText = f.death;
    Body.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: 6 });
    Composite.add(engine.world, body);
    cannonBalls.push({ body, life: 3 });
  }
}

// 水しぶき（見た目だけ）
function splashFx(x, y, count) {
  for (let i = 0; i < count; i++) {
    if (blood.length >= MAX_BLOOD) blood.shift();
    blood.push({
      x: x + (Math.random() - 0.5) * 50, y,
      vx: (Math.random() - 0.5) * 7, vy: -2 - Math.random() * 7,
      r: 2 + Math.random() * 2.5, life: 0.7 + Math.random() * 0.4,
      color: ["#d6f1ff", "#8fd3ff", "#ffffff"][i % 3], spark: true,
    });
  }
}

// フリーフォールの高さ（床の中心の y）
//   下で待つ → ゆっくり上がる → 上で止まる（最後はガタガタ揺れる）→ 重力より速く落ちる
const DROP_WAIT = 1.2;
const DROP_RISE = 3.4;
const DROP_TOP = 1.3;
const DROP_FALL = 0.55;
function dropTowerY(p, t) {
  const q = ((t + (p.phase || 0)) % p.period + p.period) % p.period;
  if (q < DROP_WAIT) return p.bottom;
  if (q < DROP_WAIT + DROP_RISE) {
    const k = (q - DROP_WAIT) / DROP_RISE;
    return p.bottom + (p.top - p.bottom) * (0.5 - Math.cos(k * Math.PI) / 2);
  }
  if (q < DROP_WAIT + DROP_RISE + DROP_TOP) {
    const left = DROP_WAIT + DROP_RISE + DROP_TOP - q;
    return p.top + (left < 0.4 ? Math.sin(q * 70) * 2 : 0);
  }
  if (q < DROP_WAIT + DROP_RISE + DROP_TOP + DROP_FALL) {
    const k = (q - DROP_WAIT - DROP_RISE - DROP_TOP) / DROP_FALL;
    return p.top + (p.bottom - p.top) * k * k;
  }
  return p.bottom;
}

// ハリセン（ツッコミ）の角度。p は 0〜period の時間
//   ふり上げて待つ → 一気にたたきおろす → 少し止まる → ゆっくりもどる
const SLAP_UP = 1.6;
const SLAP_DOWN = -0.25;
const SLAP_START = 1.1;
function slapAngle(p, period) {
  if (p < SLAP_START) return SLAP_UP + Math.sin(p * 9) * 0.03;
  if (p < SLAP_START + 0.18) return SLAP_UP + (SLAP_DOWN - SLAP_UP) * ((p - SLAP_START) / 0.18) ** 2;
  if (p < SLAP_START + 0.5) return SLAP_DOWN;
  const k = Math.min(1, (p - SLAP_START - 0.5) / (period - SLAP_START - 0.5));
  return SLAP_DOWN + (SLAP_UP - SLAP_DOWN) * (1 - (1 - k) ** 2);
}

// ハリセンをふりおろすときに「なんでやねん!」
function updateSlaps() {
  for (const m of movers) {
    if (!m.slap) continue;
    const { period, phase } = m.slap;
    const p = ((simTime + phase) % period + period) % period;
    if (m.slap.last < SLAP_START && p >= SLAP_START && Math.abs(m.pivot.x - camera.x) < 650) {
      addPopup(m.pivot.x + 40, m.pivot.y - 30, "なんでやねん!", "#ffd23f", 24);
      sfx.slap();
    }
    m.slap.last = p;
  }
}

// 浮かんで消える文字を出す
function addPopup(x, y, text, color, size) {
  popups.push({ x, y, text, color, size, life: 1.6, age: 0 });
}

// 水：入ると動きがにぶくなって、ゆっくりしずむ。自転車か人が落ちたら死亡
function checkWater() {
  const { chassis, torso } = bike;
  for (const w of COURSE.water) {
    for (const b of [...bike.bikeBodies, bike.crank, ...bike.riderParts]) {
      if (b.position.x > w.x1 && b.position.x < w.x2 && b.position.y > w.y) {
        Body.setVelocity(b, { x: b.velocity.x * 0.9, y: b.velocity.y * 0.85 });
      }
    }
    if (dead || (state !== "playing" && state !== "down")) continue;
    for (const b of [chassis, torso]) {
      if (b.position.x > w.x1 && b.position.x < w.x2 && b.position.y > w.y + 12) {
        splash(b.position.x, w.y);
        dead = true;
        eject(w.death || "水に落ちた！", { x: 0, y: 1 }, 0);
        deathCause = w.death || "水に落ちた！";
        slowTimer = SLOWMO_TIME;
        stageDeathEffect({ x: b.position.x, y: w.y });
        return;
      }
    }
  }
}

// 水しぶき
function splash(x, y) {
  sfx.splash();
  shake(0.3, 6);
  for (let i = 0; i < 50; i++) {
    if (blood.length >= MAX_BLOOD) blood.shift();
    blood.push({
      x: x + (Math.random() - 0.5) * 40, y,
      vx: (Math.random() - 0.5) * 8, vy: -3 - Math.random() * 9,
      r: 2 + Math.random() * 3, life: 0.8 + Math.random() * 0.6,
      color: ["#d6f1ff", "#8fd3ff", "#ffffff"][i % 3], spark: true,
    });
  }
}

// その県だけの死亡演出（大阪なら「なんでやねん!!」とズコー）
function stageDeathEffect(point) {
  const d = stage.death;
  if (d.bubbles) {
    const text = d.bubbles[Math.floor(Math.random() * d.bubbles.length)];
    addPopup(point.x, point.y - 50, text, "#ffffff", 40);
  }
  if (d.sound && sfx[d.sound]) setTimeout(() => sfx[d.sound](), 250);
}

// 自転車が trigger をこえたら、プレス機・飛び出すトゲを動かし始める
function updateTriggers() {
  const x = bike.chassis.position.x;
  for (const m of movers) {
    const trap = m.trap;
    if (!trap) continue;
    if (trap.triggerAt === null && state === "playing" && x > trap.trigger) {
      trap.triggerAt = simTime;
      if (trap.sound === "pop") sfx.pop();
      else if (trap.sound === "shark") sfx.shark();
      else sfx.tone(220, 0.15, "square", 0.05);   // プレス機の「ガタッ」
    }
    // プレス機が地面に着いた瞬間に音と揺れ
    if (trap.sound === "slam" && trap.triggerAt !== null) {
      const phase = (simTime - trap.triggerAt) % trap.period;
      if (trap.lastPhase < 0.4 && phase >= 0.4 && Math.abs(m.position.x - x) < 700) {
        sfx.slam();
        shake(0.3, 10);
      }
      trap.lastPhase = phase;
    }
  }
}

// 地雷：作動してから fuse 秒後に爆発する
function updateMines(dt) {
  for (const body of mines) {
    const m = body.mine;
    if (m.timer < 0 || m.done) continue;
    const before = m.timer;
    m.timer += dt;
    // ピッ、ピッ…と鳴る
    if (Math.floor(before / 0.12) !== Math.floor(m.timer / 0.12)) sfx.beep();
    if (m.timer >= m.fuse) {
      m.done = true;
      Composite.remove(engine.world, body);
      explode(m.x, m.y - 6);
    }
  }
}

const BLAST_KILL = 120;    // 爆発でこの距離より近いと死亡
const BLAST_PUSH = 240;    // この距離より近いと吹き飛ばされる

function explode(x, y) {
  sfx.explode();
  blasts.push({ x, y, life: 0.5 });
  for (let i = 0; i < 40; i++) {
    if (blood.length >= MAX_BLOOD) blood.shift();
    const a = -Math.PI * Math.random();
    const s = 3 + Math.random() * 9;
    blood.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 2 + Math.random() * 3,
      life: 0.4 + Math.random() * 0.5,
      color: ["#ffd23f", "#ff8a1f", "#ff5a36", "#555"][i % 4],
      spark: true,
    });
  }
  const dist = Math.hypot(bike.torso.position.x - x, bike.torso.position.y - y);
  shake(dist < BLAST_PUSH ? 0.5 : 0.2, dist < BLAST_PUSH ? 16 : 5);
  if (state === "clear" || dist >= BLAST_PUSH) return;

  // 爆発の中心から外向きに吹き飛ばす（近いほど強い）
  // 遠いときは横向きの力を弱くする（爆風で加速して、次のトラップを楽にぬけられないように）
  const power = 16 * (1 - dist / BLAST_PUSH) + 4;
  const sideways = dist < BLAST_KILL ? 1 : 0.15;
  for (const b of [...bike.bikeBodies, bike.crank, ...bike.riderParts]) {
    const d = normalize({ x: b.position.x - x, y: b.position.y - y - 40 });
    Body.setVelocity(b, { x: b.velocity.x + d.x * power * sideways, y: b.velocity.y + d.y * power });
    Body.setAngularVelocity(b, b.angularVelocity + (Math.random() - 0.5) * 0.3);
  }
  if (dist < BLAST_KILL) {
    const dir = normalize({ x: bike.torso.position.x - x, y: -1 });
    kill("地雷をふんだ！", { x: bike.torso.position.x, y: bike.torso.position.y }, dir, 14);
  }
}

// 大砲：自転車のいる場所（少し先）をねらって砲弾を撃つ
const GRAVITY_PER_STEP = 0.001 * STEP_MS * STEP_MS;   // 1ステップごとに増える落ちる速さ

function updateCannons(dt) {
  const x = bike.chassis.position.x;
  for (const c of cannons) {
    const active = state === "playing" && x > c.x1 && x < c.x2;
    if (c.flash > 0) c.flash -= dt;
    if (!active) continue;
    // 砲身はいつも自転車のほうを向く
    const target = predictTarget(c);
    c.aim = Math.atan2(target.y - c.y, target.x - c.x);
    c.timer -= dt;
    if (c.timer <= 0) {
      c.timer = c.interval;
      fireCannon(c, target);
    }
  }
  // 古い砲弾は消す
  for (let i = cannonBalls.length - 1; i >= 0; i--) {
    const ball = cannonBalls[i];
    ball.life -= dt;
    if (ball.life <= 0 || ball.body.position.y > COURSE.fallY + 300) {
      Composite.remove(engine.world, ball.body);
      cannonBalls.splice(i, 1);
    }
  }
}

// 砲弾が着くまでに自転車が進む距離を少しだけ先読みする
function predictTarget(c) {
  const steps = c.flight * 60;
  const x = bike.chassis.position.x + bike.chassis.velocity.x * steps * 0.6;
  return { x, y: (groundY(x) ?? bike.chassis.position.y) - 45 };
}

function fireCannon(c, target) {
  const mx = c.x + Math.cos(c.aim) * 40;   // 砲口の位置
  const my = c.y + Math.sin(c.aim) * 40;
  const T = c.flight * 60;
  const g = GRAVITY_PER_STEP;
  // T ステップ後に target に着くような速さ
  const vx = (target.x - mx) / T;
  const vy = (target.y - my - g * T * (T + 1) / 2) / T;
  const body = Bodies.circle(mx, my, c.r, {
    density: 0.02, friction: 0.6, restitution: 0.2, frictionAir: 0,
    collisionFilter: { group: 0, category: CAT.DEBRIS, mask: CAT.GROUND | CAT.BIKE | CAT.RIDER | CAT.DEBRIS },
  });
  body.hazard = "cannonball";
  body.radius = c.r;
  body.kind = c.kind;
  body.deathText = c.death;
  Body.setVelocity(body, { x: vx, y: vy });
  Composite.add(engine.world, body);
  cannonBalls.push({ body, life: 5 });
  c.flash = 0.15;
  sfx.cannon();
  for (let i = 0; i < 10; i++) {
    if (blood.length >= MAX_BLOOD) blood.shift();
    blood.push({
      x: mx, y: my,
      vx: Math.cos(c.aim) * (2 + Math.random() * 4) + (Math.random() - 0.5) * 2,
      vy: Math.sin(c.aim) * (2 + Math.random() * 4) + (Math.random() - 0.5) * 2,
      r: 3 + Math.random() * 3, life: 0.35, color: "#bbb", spark: true,
    });
  }
}

// ニセのゴール：通りすぎたらお知らせ（すぐ先の床が抜ける）
function checkFakeGoal() {
  if (COURSE.fakeGoalX === undefined) return;
  if (!fakeGoalPassed && state === "playing" && bike.chassis.position.x > COURSE.fakeGoalX) {
    fakeGoalPassed = true;
    sfx.goal();
    showToast("GOAL!! …じゃなかった", "#e53935");
  }
}

// 自転車が決まった場所を通ったら、後ろから岩を転がす
function updateBoulders() {
  for (const b of boulders) {
    // 坂の上を通りすぎたときだけ出てくる（先のチェックポイントから再開したときは出てこない）
    const bx = bike.chassis.position.x;
    if (!b.body && !b.skipped && bx > b.trigger && state === "playing") {
      if (bx > b.trigger + 400) {
        b.skipped = true;
        continue;
      }
      b.body = Bodies.circle(b.x, b.y, b.r, {
        density: 0.01, friction: 0.9, restitution: 0.1, frictionAir: 0.002,
        collisionFilter: { group: 0, category: CAT.DEBRIS, mask: CAT.GROUND | CAT.BIKE | CAT.RIDER | CAT.DEBRIS },
      });
      b.body.hazard = "boulder";
      b.body.radius = b.r;
      b.body.deathText = b.death;
      Body.setVelocity(b.body, { x: b.vx, y: 0 });
      Composite.add(engine.world, b.body);
      solidBodies.push(b.body);
      sfx.crumble();
      shake(0.3, 5);
    }
    // 鉄板の穴に「スポッ」とはまる
    if (b.holeX !== undefined && b.body && !b.removed && !b.inHole && b.body.position.x > b.holeX) {
      b.inHole = true;
      Body.setVelocity(b.body, { x: b.body.velocity.x * 0.3, y: 10 });
      addPopup(b.holeX + 60, b.body.position.y - 60, "スポッ!", "#ffd23f", 30);
      sfx.tone(600, 0.15, "sine", 0.1, 200);
    }
    // chase：乗り物の最高速度の chase 倍より遅くならない（chaseUntil まで追いかけてくる）
    const chasing = b.chaseUntil === undefined || (b.body && b.body.position.x < b.chaseUntil);
    if (b.chase && b.body && !b.removed && !b.inHole && chasing && b.body.velocity.y < 4) {
      const chaseSpeed = vehicle.maxSpin * vehicle.wheels.rear.r * b.chase;
      if (b.body.velocity.x < chaseSpeed) {
        Body.setVelocity(b.body, { x: chaseSpeed, y: b.body.velocity.y });
        Body.setAngularVelocity(b.body, chaseSpeed / b.r);
      }
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
  const v = vehicle;

  // ----- 乗り物：車体の部品（フレーム・ハンドル・サドルなど）を1つのボディにする -----
  const parts = v.parts.map(([px, py, w, h, density]) => Bodies.rectangle(x + px, y + py, w, h, { density }));
  const frame = parts[0];
  const chassis = Body.create({ parts, collisionFilter: { ...bikeFilter }, friction: 0.5, frictionAir: 0.002 });

  const wheelOptions = {
    collisionFilter: { ...bikeFilter },
    friction: 1,
    frictionStatic: 2,
    restitution: 0.05,
    density: 0.0015,
    frictionAir: 0.002,   // 空気抵抗は小さめ（ジャンプが失速しすぎないように）
  };
  const rear = Bodies.circle(x + v.wheels.rear.x, y + v.wheels.rear.y, v.wheels.rear.r, wheelOptions);
  const front = Bodies.circle(x + v.wheels.front.x, y + v.wheels.front.y, v.wheels.front.r, wheelOptions);

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
    pin(chassis, rear, rear.position, v.suspension, 0.15),
    pin(chassis, front, front.position, v.suspension, 0.15),
    pin(chassis, crank, crankPos, 1, 0.1),
  ];

  // ----- ラグドール：頭・胴体・腕（上腕と前腕）・脚（太ももとすね） -----
  const pts = {};
  for (const name in v.pose) pts[name] = P(...v.pose[name]);

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
    pin(shinF, v.pedals ? crank : chassis, pts.footF, 0.3),   // 足 → ペダル（ペダルがない乗り物は足置き）
    pin(shinB, v.pedals ? crank : chassis, pts.footB, 0.3),
    pin(torso, chassis, pts.shoulder, 0.04),   // 姿勢をゆるく保つ（体が揺れる）
    pin(upperB, chassis, pts.elbow, 0.04),
    pin(upperF, chassis, pts.elbow, 0.04),
    pin(thighB, chassis, pts.kneeB, 0.04),
    pin(thighF, chassis, pts.kneeF, 0.04),
  ];

  const riderParts = [thighB, shinB, upperB, foreB, torso, head, thighF, shinF, upperF, foreF];
  Composite.add(engine.world, [chassis, rear, front, crank, ...bikeJoints, ...riderParts, ...riderJoints, ...assists]);

  return {
    chassis, frame, rear, front, crank,
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
  // 車輪の一番下が地面にくる高さに置く
  const { rear, front } = vehicle.wheels;
  bike = createBike(startX, groundY(startX) - Math.max(rear.y + rear.r, front.y + front.r) - 2);
  Events.on(engine, "collisionStart", onCollision);

  flipTimer = 0;
  downTimer = 0;
  slowTimer = 0;
  shakeTimer = 0;
  airTime = 0;
  padTimer = 0;
  fakeGoalPassed = false;
  ejected = false;
  dead = false;
  deathCause = "";
  deathShown = false;
  blood.length = 0;
  confetti.length = 0;
  popups.length = 0;
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
  // 大きさのちがう車輪は、表面の速さがそろうように回転の速さを変える（後輪が基準）
  const v = vehicle;
  for (const wheel of [rear, front]) {
    const k = v.wheels.rear.r / wheel.circleRadius;
    const spin = wheel.angularVelocity / k;
    if (brake) {
      setSpin(wheel, spin * BRAKE * k);
    } else if (right && spin < v.maxSpin) {
      setSpin(wheel, Math.min(spin + v.accel, v.maxSpin) * k);
    } else if (left && spin > -v.reverseSpin) {
      setSpin(wheel, Math.max(spin - v.accel, -v.reverseSpin) * k);
    }
  }

  // 車体を傾ける。回転速度に上限をつけて、無制限に回らないようにする
  const lean = (down ? 1 : 0) - (up ? 1 : 0);
  if (lean !== 0) {
    const power = onGround ? v.lean : v.airLean;
    const spin = chassis.angularVelocity + lean * power;
    if (Math.abs(spin) <= MAX_LEAN_SPEED || Math.sign(spin) !== lean) {
      Body.setAngularVelocity(chassis, spin);

      // 地面にいるときは、体重移動で前輪（後ろに傾ける）か後輪（前に傾ける）を持ち上げる
      if (onGround) {
        const lifted = lean < 0 ? front : rear;
        const upX = Math.sin(chassis.angle);    // 車体から見た「上」の向き
        const upY = -Math.cos(chassis.angle);
        Body.applyForce(lifted, lifted.position, { x: upX * v.lift, y: upY * v.lift });
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
    // 地雷：自転車か人がふれたら作動
    if (b.mine && b.mine.timer < 0 && (a.riderPart || isBikePart(a))) {
      b.mine.timer = 0;
      sfx.beep();
      continue;
    }
    if (b.mine) continue;

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
    kill(other.deathText || "回転ノコギリに切られた！", point, dir, 12);
    fling(dir, 10);
    return;
  }
  if (other.hazard === "spike") {
    kill(other.deathText || "トゲに刺さった！", point, dir, 8);
    return;
  }
  if (other.hazard === "hammer") {
    sfx.hammer();
    if (speed > 3) {
      kill(other.deathText || "ハンマーで吹き飛ばされた！", point, dir, speed);
      fling(normalize(other.velocity), 6 + speed * 0.8);
    } else {
      eject(other.ejectText || "ハンマーにぶつかった！", dir, speed);
    }
    return;
  }
  if (other.hazard === "shark") {
    eatRider(other, point);
    return;
  }
  if (other.hazard === "crusher") {
    sfx.slam();
    kill(other.deathText || "プレス機につぶされた！", point, { x: dir.x, y: Math.abs(dir.y) }, 12);
    return;
  }
  if (other.hazard === "boulder" || other.hazard === "cannonball") {
    const rockSpeed = Math.hypot(other.velocity.x, other.velocity.y);
    if (rockSpeed > 2.5 || speed > 3) {
      sfx.hammer();
      kill(other.deathText || (other.hazard === "boulder" ? "岩につぶされた！" : "砲弾が直撃した！"), point, dir, Math.max(speed, rockSpeed));
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
  if (other.hazard === "shark") {
    Body.setVelocity(bike.chassis, { x: bike.chassis.velocity.x + other.velocity.x * 0.5, y: bike.chassis.velocity.y + other.velocity.y * 0.5 });
    shake(0.3, 8);
    return;
  }
  if (other.hazard === "hammer" || other.hazard === "boulder" || other.hazard === "cannonball" || other.hazard === "crusher") {
    sfx.hammer();
    shake(0.3, 8);
    return;
  }
  if (other.pad) {
    if (padTimer <= 0 && state === "playing") launch(other);
    return;
  }
  // 飛び出したトゲに乗り物がぶつかると、急に止まって人が前に投げ出される
  if (other.hazard === "spike" && other.dir === "pop" && state === "playing") {
    sfx.hit(speed);
    eject(other.ejectText || "トゲの壁に突っこんだ", { x: 1, y: -0.4 }, 10);
    fling({ x: 1, y: -0.4 }, 5);
    return;
  }
  // 着地の衝撃
  if (state !== "playing") return;
  if (speed >= vehicle.landFatal) {
    kill("高いところから激しく落下した！", point, { x: bike.chassis.velocity.x * 0.1, y: -1 }, speed);
  } else if (speed >= vehicle.landEject) {
    sfx.hit(speed);
    eject("着地に失敗して投げ出された", normalize({ x: bike.chassis.velocity.x, y: -4 }), speed);
  } else if (speed >= 3 && airTime > 0.2) {
    sfx.land(speed);
    if (speed > 6) shake(0.15, 3);
  }
}

// 速い乗り物（バイク）は坂の上で少し浮いて、ジャンプパッドを飛びこえてしまうことがある。
// 車輪がパッドのすぐ上を通ったときも、ふんだことにする
function checkPads() {
  if (padTimer > 0 || state !== "playing") return;
  for (const body of groundBodies) {
    if (!body.pad) continue;
    for (const wheel of [bike.rear, bike.front]) {
      const dx = Math.abs(wheel.position.x - body.position.x);
      const above = body.position.y - wheel.position.y - wheel.circleRadius;
      if (dx < body.w / 2 + 8 && above > -10 && above < 45) {
        launch(body);
        return;
      }
    }
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
  stageDeathEffect(point);
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
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.age += dt;
    p.y -= 0.5;
    if (p.age >= p.life) popups.splice(i, 1);
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
    stageDeathEffect(torso.position);
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
    updateSlip(dt);
    elapsed += dt;
    checkCheckpoints();
  } else if (state === "clear") {
    // ゴール後は自動でブレーキ
    setSpin(bike.rear, bike.rear.angularVelocity * 0.9);
    setSpin(bike.front, bike.front.angularVelocity * 0.9);
  }
  syncCrank();
  updateBoulders();
  updateTriggers();
  updateMines(dt * timeScale);
  updateCannons(dt * timeScale);
  checkFakeGoal();
  updateSlaps();
  updateLifts(dt);
  updateSharks();
  updateChefs(dt * timeScale);
  if (padTimer > 0) padTimer -= dt;
  checkPads();

  Engine.update(engine, STEP_MS);
  processHits();
  checkWater();

  if (state === "playing") checkRules(dt);
  if (state === "down") {
    downTimer += dt;
    if (downTimer >= DEATH_SCREEN_DELAY && !deathShown) showDeath();
  }
  if (slowTimer > 0) slowTimer -= dt;
  if (shakeTimer > 0) shakeTimer -= dt;
  updateParticles(dt * timeScale);

  if (state === "playing") maxX = Math.max(maxX, bike.chassis.position.x);
  const speed = Math.abs(bike.rear.angularVelocity) * bike.rear.circleRadius;
  const engineOn = vehicle.engine && state === "playing" && !paused;
  sfx.updateRide(speed, engineOn || (state === "playing" && onGround && !paused), vehicle.engine);
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
  $("stage-name").textContent = stage.name;
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
  state = "title";
  menu = "title";
  paused = false;
  overlay.className = "";
  $("overlay-title").textContent = "CRASH RIDE";
  $("overlay-body").innerHTML = `
    <p>トラップだらけのコースをかけぬけろ！ 初見殺しに注意。</p>
    <p class="pick-label">乗り物をえらぶ（1 / 2 / 3 キーでも選べます）</p>
    <div id="vehicles"></div>`;
  const box = $("vehicles");
  VEHICLE_ORDER.forEach((id, i) => {
    const v = VEHICLES[id];
    const card = document.createElement("button");
    card.className = "vehicle" + (id === vehicleId ? " selected" : "");
    card.innerHTML = `<span class="key">${i + 1}</span><b>${v.name}</b><span class="stars">むずかしさ ${v.stars}</span><span class="desc">${v.desc}</span>`;
    card.onclick = () => selectVehicle(id);
    box.appendChild(card);
  });
  setButtons([["START", () => startStage("main")], ["日本全国チャレンジ", showPrefectures, true]]);
}

// 乗り物をえらぶ（タイトル画面の後ろに、えらんだ乗り物を表示する）
function selectVehicle(id) {
  vehicleId = id;
  vehicle = VEHICLES[id];
  try {
    localStorage.setItem("crashride-vehicle", id);
  } catch (e) {
    // 保存できなくても遊べる
  }
  buildWorld(COURSE.startX);
  showTitle();
}

// ステージを切りかえる（まだ始めない）
function setStage(id) {
  stageId = id;
  stage = STAGES[id];
  COURSE = stage.course;
}

// ステージを選んで、最初から始める
function startStage(id) {
  setStage(id);
  startGame(true);
}

// タイトル画面にもどる（後ろの景色はメインコース）
function backToTitle() {
  setStage("main");
  buildWorld(COURSE.startX);
  showTitle();
}

// 都道府県えらびにもどる
function backToPrefectures() {
  setStage("main");
  buildWorld(COURSE.startX);
  showPrefectures();
}

// ---------- 記録（クリアタイム・死亡回数）----------
function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem("crashride-records")) || {};
  } catch (e) {
    return {};
  }
}

// 記録を保存して、ベストを更新したかを返す
function saveRecord(id, time, deathCount) {
  const all = loadRecords();
  const r = all[id] || {};
  const result = { newTime: false, newDeaths: false };
  if (r.bestTime === undefined || time < r.bestTime) {
    r.bestTime = time;
    result.newTime = true;
  }
  if (r.bestDeaths === undefined || deathCount < r.bestDeaths) {
    r.bestDeaths = deathCount;
    result.newDeaths = true;
  }
  r.clears = (r.clears || 0) + 1;
  all[id] = r;
  try {
    localStorage.setItem("crashride-records", JSON.stringify(all));
  } catch (e) {
    // 保存できなくても遊べる
  }
  result.record = r;
  return result;
}

// ---------- 日本全国チャレンジ（都道府県えらび）----------
function showPrefectures() {
  state = "title";
  menu = "prefs";
  paused = false;
  overlay.className = "prefs";
  $("overlay-title").textContent = "日本全国チャレンジ";
  const records = loadRecords();
  let html = `<p class="pick-label">県をえらんでスタート（乗り物：${vehicle.name}）</p><div id="regions">`;
  for (const region of PREFECTURES) {
    html += `<div class="region"><div class="region-name">${region.region}</div><div class="prefs-row">`;
    for (const [name, id] of region.list) {
      if (id && STAGES[id]) {
        const r = records[id];
        const best = r ? `BEST ${r.bestTime.toFixed(1)}秒` : "未クリア";
        html += `<button class="pref open" data-stage="${id}"><b>${name}</b><span>${best}</span></button>`;
      } else {
        html += `<button class="pref soon" disabled><b>${name}</b><span>COMING SOON</span></button>`;
      }
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  $("overlay-body").innerHTML = html;
  for (const btn of document.querySelectorAll(".pref.open")) {
    btn.onclick = () => startStage(btn.dataset.stage);
  }
  setButtons([["タイトルにもどる", showTitle, true]]);
}

function showDeath() {
  deathShown = true;
  overlay.className = "dead";
  $("overlay-title").textContent = stage.death.title;
  const lines = stage.death.lines;
  const line = lines ? `<p class="quip">${lines[Math.floor(Math.random() * lines.length)]}</p>` : "";
  $("overlay-body").innerHTML = `
    <p class="result">${deathCause}</p>
    ${line}
    <table>
      <tr><td>走行距離</td><td><b>${distanceMeters()} m</b></td></tr>
      <tr><td>経過時間</td><td><b>${elapsed.toFixed(2)} 秒</b></td></tr>
      <tr><td>死亡回数</td><td><b>${deaths} 回</b></td></tr>
    </table>`;
  const cpLabel = checkpoint >= 0 ? `チェックポイント ${checkpoint + 1} から (Enter)` : "スタートから再開 (Enter)";
  const buttons = [[cpLabel, respawn], ["最初からやり直す (R)", () => startGame(false), true]];
  if (stageId === "main") buttons.push(["乗り物をかえる", backToTitle, true]);
  else buttons.push(["県をえらぶ", backToPrefectures, true]);
  setButtons(buttons);
}

function showClear() {
  const result = saveRecord(stageId, elapsed, deaths);
  const best = result.record;
  overlay.className = "";
  $("overlay-title").textContent = stage.clear.title;
  $("overlay-body").innerHTML = `
    <p class="result">${stage.clear.line}（${vehicle.name}）</p>
    <table>
      <tr><td>クリアタイム</td><td><b>${elapsed.toFixed(2)} 秒</b>${result.newTime ? ' <span class="new">ベスト更新！</span>' : ""}</td></tr>
      <tr><td>死亡回数</td><td><b>${deaths} 回</b>${result.newDeaths ? ' <span class="new">ベスト更新！</span>' : ""}</td></tr>
      <tr><td>ベスト</td><td><b>${best.bestTime.toFixed(2)} 秒 / ${best.bestDeaths} 回</b></td></tr>
      <tr><td>リスタート回数</td><td><b>${restarts} 回</b></td></tr>
    </table>`;
  const buttons = [["もう一度遊ぶ (R)", () => startGame(false)]];
  if (stageId === "main") buttons.push(["乗り物をかえる", backToTitle, true]);
  else buttons.push(["県をえらぶ", backToPrefectures, true]);
  setButtons(buttons);
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
  const target = bike.eatenBy ? bike.eatenBy.position : ejected ? bike.torso.position : bike.chassis.position;
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
  const theme = stage.theme;
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  sky.addColorStop(0, theme.sky[0]);
  sky.addColorStop(1, theme.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 太陽
  ctx.fillStyle = theme.sun;
  ctx.beginPath();
  ctx.arc(820, 90, 40, 0, Math.PI * 2);
  ctx.fill();

  // 遠くの塔（ステージによってはある）
  if (theme.far === "tower") drawFarTower(640 - camera.x * 0.05, 400);

  // 遠くの山（ゆっくり動く）
  ctx.fillStyle = theme.mountains;
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
    ctx.fillStyle = theme.buildings[Math.abs(i) % theme.buildings.length];
    ctx.fillRect(x, y, w, h + 200);
    for (let wy = y + 12; wy < 420; wy += 22) {
      for (let wx = x + 10; wx < x + w - 14; wx += 20) {
        const r = hash(wx * 3 + wy);
        if (r > 0.35) {
          ctx.fillStyle = theme.windows[Math.floor(r * 97) % theme.windows.length];
          ctx.fillRect(wx, wy, 9, 11);
        }
      }
    }
  }

  // 近くの丘（さらに速く動く）
  ctx.fillStyle = theme.hills;
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
    ctx.fillStyle = stage.theme.soil;
    ctx.beginPath();
    ctx.moveTo(land[0][0], 2400);
    for (const [x, y] of land) ctx.lineTo(x, y);
    ctx.lineTo(land[land.length - 1][0], 2400);
    ctx.closePath();
    ctx.fill();

    // 土のしま模様
    ctx.strokeStyle = stage.theme.stripe;
    ctx.lineWidth = 6;
    for (let d = 40; d < 400; d += 50) {
      ctx.beginPath();
      land.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y + d) : ctx.lineTo(x, y + d)));
      ctx.stroke();
    }

    // 草（道路のライン）
    ctx.strokeStyle = stage.theme.grass;
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.beginPath();
    land.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y + 3) : ctx.lineTo(x, y + 3)));
    ctx.stroke();
  }
}

// ソースでツルツルの地面（ぬれて光っている）
function drawSauce() {
  for (const r of COURSE.slippery) {
    if (r.x2 < camera.x - 700 || r.x1 > camera.x + 700) continue;
    ctx.strokeStyle = "#4a230c";
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let x = r.x1; x <= r.x2; x += 10) {
      const y = groundY(x) + 2;
      if (x === r.x1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // 光っているところ・たれているところ
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    for (let x = r.x1 + 20; x < r.x2; x += 55) {
      const y = groundY(x);
      ctx.fillRect(x + Math.sin(simTime * 2 + x) * 3, y - 1, 14, 2);
    }
    ctx.fillStyle = "#4a230c";
    for (let x = r.x1 + 35; x < r.x2; x += 90) {
      const y = groundY(x);
      ctx.beginPath();
      ctx.ellipse(x, y + 10 + (hash(x) * 6), 3, 6 + hash(x + 1) * 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
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
      ctx.lineTo(x, groundY(x) ?? 780);
      ctx.stroke();
    }
    // 板
    ctx.fillStyle = stage.theme.ramp.fill;
    polygon(v);
    ctx.fill();
    ctx.strokeStyle = stage.theme.ramp.stroke;
    ctx.lineWidth = 3;
    ctx.stroke();
    // チェーンリフト：上の面でチェーンが動く
    if (body.lift) {
      ctx.save();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -simTime * body.lift * 60;
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y + 2);
      ctx.lineTo(v[1].x, v[1].y + 2);
      ctx.stroke();
      ctx.restore();
    }
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
    if (m.hazard === "hammer" && m.kind === "harisen") {
      drawHarisen(m);
      continue;
    }
    if (m.isPlatform && m.axis === "drop") {
      drawDropTower(m);
      continue;
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
    if (b.kind === "takoyaki") {
      drawTakoyaki(b.body.position.x, b.body.position.y, b.r, b.body.angle);
      continue;
    }
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
    if (c.fake) {
      drawFakeFloor(piece);
      continue;
    }
    if (c.style === "bridge") {
      drawBridgePiece(piece);
      continue;
    }
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

// 抜ける床：落ちるまでは、ふつうの地面とまったく同じに見える
function drawFakeFloor(piece) {
  ctx.save();
  ctx.translate(piece.position.x, piece.position.y);
  ctx.rotate(piece.angle);
  const hw = piece.w / 2 + (piece.crumble.fallen ? 0 : 1.5);   // 落ちる前は、すき間が見えないように少し広く描く
  ctx.fillStyle = "#a0673a";
  ctx.fillRect(-hw, -10, hw * 2, piece.crumble.fallen ? 20 : 400);
  ctx.strokeStyle = "#47b84a";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(-hw, -7);
  ctx.lineTo(hw, -7);
  ctx.stroke();
  ctx.restore();
}

// プレス機・飛び出すトゲ・地雷・大砲・砲弾・爆発
function drawNewTraps() {
  for (const m of movers) {
    if (m.hazard === "shark") {
      drawShark(m);
      continue;
    }
    if (m.hazard === "crusher" && m.kind === "tentacle") {
      drawTentacle(m);
      continue;
    }
    if (m.hazard === "spike" && m.style === "kushi") {
      drawKushi(m);
      continue;
    }
    if (m.hazard === "crusher") {
      const { x, y } = m.position;
      // 上から押すピストン
      ctx.fillStyle = "#9aa3ad";
      ctx.fillRect(x - 14, 0, 28, y - m.h / 2);
      ctx.fillStyle = "#6b7280";
      ctx.fillRect(x - 24, y - m.h / 2 - 16, 48, 16);
      // 鉄のかたまり
      ctx.fillStyle = "#4b5563";
      ctx.fillRect(x - m.w / 2, y - m.h / 2, m.w, m.h);
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 3;
      ctx.strokeRect(x - m.w / 2, y - m.h / 2, m.w, m.h);
      // 黄色と黒のしま
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - m.w / 2, y + m.h / 2 - 16, m.w, 12);
      ctx.clip();
      for (let i = -2; i < m.w / 12 + 2; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#ffd23f" : "#222";
        ctx.beginPath();
        const sx = x - m.w / 2 + i * 12;
        ctx.moveTo(sx, y + m.h / 2 - 4);
        ctx.lineTo(sx + 12, y + m.h / 2 - 4);
        ctx.lineTo(sx + 24, y + m.h / 2 - 16);
        ctx.lineTo(sx + 12, y + m.h / 2 - 16);
        ctx.fill();
      }
      ctx.restore();
    }
    if (m.hazard === "spike" && m.dir === "pop") {
      // 地面より上の部分だけ描く（地面の中にかくれている部分は見えない）
      ctx.save();
      ctx.beginPath();
      ctx.rect(m.position.x - m.w, m.floor - 300, m.w * 2, 300 + 2);
      ctx.clip();
      const top = m.position.y - m.h / 2;
      const n = 4;
      ctx.fillStyle = "#c9ced6";
      ctx.strokeStyle = "#4b5563";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const sx = m.position.x - m.w / 2 + (i * m.w) / n;
        ctx.moveTo(sx, m.position.y + m.h / 2);
        ctx.lineTo(sx + m.w / n / 2, top - 4);
        ctx.lineTo(sx + m.w / n, m.position.y + m.h / 2);
      }
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // 地雷（土にうまっていて、ほとんど見えない。作動すると赤く光る）
  for (const body of mines) {
    const m = body.mine;
    if (m.done) continue;
    ctx.fillStyle = "#3f7d3c";
    ctx.beginPath();
    ctx.ellipse(m.x, m.y + 1, 11, 5, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    const blink = m.timer >= 0 ? Math.floor(m.timer / 0.06) % 2 === 0 : Math.floor(simTime * 1.5) % 4 === 0;
    ctx.fillStyle = blink ? "#ff2a2a" : "#552222";
    ctx.beginPath();
    ctx.arc(m.x, m.y - 3, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 大砲（塔の上から撃ってくる）
  for (const c of cannons) {
    if (c.kind === "takoyaki") {
      drawStall(c);
      continue;
    }
    if (c.kind === "boss") continue;   // ボスの絵は飾り（decor）で描く
    const floor = groundY(c.x) ?? 600;
    ctx.fillStyle = "#6b4423";
    ctx.fillRect(c.x - 10, c.y + 14, 20, floor - c.y - 14);
    ctx.fillRect(c.x - 34, c.y + 14, 68, 10);
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.aim);
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(0, -11, 46, 22);
    ctx.fillStyle = "#444";
    ctx.fillRect(40, -13, 8, 26);
    if (c.flash > 0) {
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.arc(54, 0, 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "#3d3d3d";
    ctx.beginPath();
    ctx.arc(c.x, c.y + 6, 18, Math.PI, Math.PI * 2);
    ctx.fill();
  }
  for (const ball of cannonBalls) {
    const { x, y } = ball.body.position;
    if (ball.body.kind === "takoyaki" || ball.body.kind === "boss") {
      drawTakoyaki(x, y, ball.body.radius, ball.body.angle);
      continue;
    }
    ctx.fillStyle = "#1f1f1f";
    ctx.beginPath();
    ctx.arc(x, y, ball.body.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(x - 4, y - 4, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // 爆発の光
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i];
    const k = b.life / 0.5;
    ctx.fillStyle = `rgba(255, 180, 40, ${k * 0.8})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y - 20, 30 + (1 - k) * 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 220, ${k})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y - 20, 20 + (1 - k) * 40, 0, Math.PI * 2);
    ctx.fill();
    b.life -= 1 / 60;
    if (b.life <= 0) blasts.splice(i, 1);
  }
}

// ============================================
//  ステージの飾り・ご当地ギミックの描画
// ============================================

// 遠くに見える塔（大阪）
function drawFarTower(x, base) {
  ctx.save();
  ctx.fillStyle = "rgba(70, 40, 80, 0.55)";
  ctx.beginPath();
  ctx.moveTo(x - 50, base);
  ctx.lineTo(x - 14, base - 150);
  ctx.lineTo(x + 14, base - 150);
  ctx.lineTo(x + 50, base);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - 26, base - 190, 52, 40);   // 展望台
  ctx.fillRect(x - 4, base - 250, 8, 60);     // アンテナ
  ctx.fillStyle = `hsl(${(simTime * 60) % 360}, 90%, 65%)`;   // ネオン
  ctx.fillRect(x - 26, base - 160, 52, 6);
  ctx.restore();
}

// 当たり判定のない飾り
function drawDecor() {
  for (const c of chefs) drawChef(c);
  for (const d of stage.decor) {
    if (Math.abs(d.x !== undefined ? d.x - camera.x : 0) > 1200 && d.type !== "lanterns" && d.type !== "fins") continue;
    if (d.type === "lanterns") drawLanterns(d);
    else if (d.type === "neon") drawNeon(d);
    else if (d.type === "globe") drawGlobe(d);
    else if (d.type === "boss") drawOctopusBoss(d);
    else if (d.type === "ferris") drawFerrisWheel(d);
    else if (d.type === "coaster") drawCoasterLoop(d);
    else if (d.type === "fins") drawFins(d);
  }
}

// 提灯の列
function drawLanterns(d) {
  if (d.x2 < camera.x - 700 || d.x1 > camera.x + 700) return;
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = d.x1; x <= d.x2; x += 20) {
    const sag = Math.sin(((x - d.x1) % 280) / 280 * Math.PI) * 18;
    if (x === d.x1) ctx.moveTo(x, d.y + sag);
    else ctx.lineTo(x, d.y + sag);
  }
  ctx.stroke();
  for (let x = d.x1 + 35; x < d.x2; x += 70) {
    const sag = Math.sin(((x - d.x1) % 280) / 280 * Math.PI) * 18;
    const y = d.y + sag + 14 + Math.sin(simTime * 2 + x) * 1.5;
    ctx.fillStyle = "rgba(255, 120, 60, 0.25)";
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e53935";
    ctx.beginPath();
    ctx.ellipse(x, y, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.fillRect(x - 7, y - 15, 14, 4);
    ctx.fillRect(x - 7, y + 11, 14, 4);
  }
}

// ネオンの看板（ときどきチカチカする）
function drawNeon(d) {
  ctx.save();
  ctx.font = "bold 20px sans-serif";
  const w = ctx.measureText(d.text).width + 24;
  ctx.fillStyle = "#1d1630";
  ctx.fillRect(d.x - w / 2, d.y - 18, w, 36);
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(d.x, d.y + 18);
  ctx.lineTo(d.x, (groundY(d.x) ?? d.y + 200));
  ctx.stroke();
  const flicker = hash(Math.floor(simTime * 8) + d.x) > 0.06;
  ctx.fillStyle = flicker ? d.color : "#444";
  ctx.shadowColor = d.color;
  ctx.shadowBlur = flicker ? 14 : 0;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(d.text, d.x, d.y + 1);
  ctx.restore();
}

// テーマパークの回る地球儀
function drawGlobe(d) {
  const r = 70;
  const cy = d.y - 150;
  ctx.fillStyle = "#666";
  ctx.fillRect(d.x - 8, cy + r - 10, 16, d.y - cy - r + 120);
  ctx.fillRect(d.x - 60, cy + r + 20, 120, 16);
  ctx.save();
  ctx.beginPath();
  ctx.arc(d.x, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#3a7bd5";
  ctx.fill();
  ctx.clip();
  // 回る大陸
  ctx.fillStyle = "#47b84a";
  for (let i = 0; i < 4; i++) {
    const lon = ((simTime * 0.5 + i * 1.6) % (Math.PI * 2)) - Math.PI;
    const x = d.x + Math.sin(lon) * r * 0.9;
    const w = Math.cos(lon) * 22;
    if (w <= 0) continue;
    ctx.beginPath();
    ctx.ellipse(x, cy - 20 + i * 12, w, 16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = "#cfd8e3";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(d.x, cy, r + 18, 20, -0.3, 0, Math.PI * 2);
  ctx.stroke();
}

// ボス「たこ焼き大王」（巨大なタコ。ハチマキをしめて怒っている）
function drawOctopusBoss(d) {
  const bob = Math.sin(simTime * 2) * 6;
  const x = d.x;
  const y = d.y + bob - 60;
  // 足の付け根
  ctx.fillStyle = "#d84343";
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(x + i * 22, y + 90, 16, 40 + Math.sin(simTime * 3 + i) * 6, i * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  // 頭
  ctx.fillStyle = "#e9573f";
  ctx.beginPath();
  ctx.ellipse(x, y, 110, 95, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(x - 40, y - 45, 30, 18, -0.5, 0, Math.PI * 2);
  ctx.fill();
  // ハチマキ
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 108, y - 30, 216, 22);
  ctx.fillStyle = "#e53935";
  ctx.beginPath();
  ctx.arc(x, y - 19, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(x + 100, y - 20);
  ctx.lineTo(x + 140, y - 40 + Math.sin(simTime * 6) * 6);
  ctx.lineTo(x + 135, y - 10);
  ctx.closePath();
  ctx.fill();
  // 怒った目（ときどきまばたき）
  const blink = (simTime % 3.5) < 0.12;
  for (const ex of [-38, 18]) {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(x + ex, y + 20, 18, blink ? 2 : 16, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!blink) {
      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(x + ex - 6, y + 22, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + ex - 18, y - 2 + (ex < 0 ? -6 : 6));
    ctx.lineTo(x + ex + 16, y - 2 + (ex < 0 ? 6 : -6));
    ctx.stroke();
  }
  // とがった口（ここからたこ焼きを飛ばす）
  ctx.fillStyle = "#c43c2c";
  ctx.beginPath();
  ctx.ellipse(x - 60, y + 58, 22, 14, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a1010";
  ctx.beginPath();
  ctx.ellipse(x - 72, y + 62, 8, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  // 名前
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#1d1630";
  ctx.strokeText("たこ焼き大王", x, y - 120);
  ctx.fillStyle = "#ffd23f";
  ctx.fillText("たこ焼き大王", x, y - 120);
}

// たこ焼き（ソース・マヨネーズ・青のり・かつおぶし）
function drawTakoyaki(x, y, r, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#c98236";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#a8642a";
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(Math.cos(i * 1.3) * r * 0.55, Math.sin(i * 2.1) * r * 0.55, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
  // ソース
  ctx.fillStyle = "#4a230c";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.98, Math.PI * 1.05, Math.PI * 1.95);
  ctx.quadraticCurveTo(0, -r * 0.1, -r * 0.98 * Math.cos(Math.PI * 0.05), -r * 0.98 * Math.sin(Math.PI * 0.05));
  ctx.fill();
  // マヨネーズ
  ctx.strokeStyle = "#fffbe6";
  ctx.lineWidth = Math.max(1.5, r * 0.08);
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const px = -r * 0.7 + (i * r * 1.4) / 6;
    const py = -r * 0.55 + (i % 2) * r * 0.25;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // 青のり
  ctx.fillStyle = "#3f8f3a";
  for (let i = 0; i < 7; i++) {
    ctx.fillRect(Math.cos(i * 2.7) * r * 0.6, -r * 0.5 + Math.sin(i * 1.9) * r * 0.3, 2, 2);
  }
  // かつおぶし
  ctx.fillStyle = "#f4c7a1";
  ctx.beginPath();
  ctx.ellipse(r * 0.15, -r * 0.75, r * 0.22, r * 0.08, 0.4 + Math.sin(simTime * 10) * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// たこ焼き屋台（たこ焼きを投げてくる）
function drawStall(c) {
  const floor = groundY(c.x) ?? 570;
  const x = c.x;
  ctx.fillStyle = "#8b5a2b";
  ctx.fillRect(x - 60, floor - 60, 120, 60);
  ctx.fillStyle = "#333";
  ctx.fillRect(x - 50, floor - 66, 100, 8);   // 鉄板
  ctx.fillStyle = "#6b4423";
  ctx.fillRect(x - 60, floor - 150, 6, 90);
  ctx.fillRect(x + 54, floor - 150, 6, 90);
  ctx.fillStyle = "#e53935";
  ctx.fillRect(x - 70, floor - 160, 140, 24);
  // のれん
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#e53935" : "#fff";
    ctx.fillRect(x - 60 + i * 30, floor - 136, 28, 26 + Math.sin(simTime * 3 + i) * 2);
  }
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText("たこ焼き", x, floor - 148);
  if (c.flash > 0) {
    ctx.font = "bold 18px sans-serif";
    ctx.fillStyle = "#ffd23f";
    ctx.fillText("ほいっ!", x - 70, floor - 180);
  }
}

// ツッコミのハリセン（上の台からぶら下がっている）
function drawHarisen(m) {
  const { pivot } = m;
  const floor = groundY(pivot.x) ?? pivot.y + 160;
  // 台
  ctx.fillStyle = "#555";
  ctx.fillRect(pivot.x - 70, pivot.y - 18, 230, 10);
  ctx.fillRect(pivot.x + 150, pivot.y - 18, 8, floor - pivot.y + 18);
  // 柄（木）
  ctx.strokeStyle = "#b07a3a";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  line(pivot, m.position);
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(pivot.x, pivot.y, 8, 0, Math.PI * 2);
  ctx.fill();
  // 紙の部分（じゃばら）
  ctx.save();
  ctx.translate(m.position.x, m.position.y);
  ctx.rotate(m.angle);
  ctx.fillStyle = "#fffdf5";
  ctx.beginPath();
  ctx.moveTo(-16, -18);
  ctx.lineTo(16, -18);
  ctx.lineTo(42, 18);
  ctx.lineTo(-42, 18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#e53935";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = "#c9c2b0";
  ctx.lineWidth = 1.5;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 4.5, -18);
    ctx.lineTo(i * 12, 18);
    ctx.stroke();
  }
  ctx.fillStyle = "#e53935";
  ctx.fillRect(-16, -22, 32, 6);
  ctx.restore();
}

// 観覧車（飾り。ゴンドラもいっしょに回る）
function drawFerrisWheel(f) {
  const t = (simTime / f.period) * Math.PI * 2;
  const floor = 700;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = "#8a93a6";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(f.x - 80, floor);
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(f.x + 80, floor);
  ctx.stroke();
  ctx.strokeStyle = "#e9eef5";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < f.count * 2; i++) {
    const a = t + (i / (f.count * 2)) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r);
    ctx.stroke();
  }
  const colors = ["#e53935", "#ffd23f", "#3a7bd5", "#2ec4b6", "#e040fb", "#ff8a1f"];
  for (let i = 0; i < f.count; i++) {
    const a = t + (i / f.count) * Math.PI * 2;
    const gx = f.x + Math.cos(a) * f.r;
    const gy = f.y + Math.sin(a) * f.r;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(gx - 14, gy, 28, 24);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(gx - 9, gy + 5, 18, 9);
  }
  ctx.fillStyle = "#e040fb";
  ctx.beginPath();
  ctx.arc(f.x, f.y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// フリーフォール（塔と、上下する床）
function drawDropTower(m) {
  const p = m.tower;
  const { x, y } = m.position;
  // 塔（赤と白）
  const towerTop = p.top - 140;
  for (let ty = towerTop; ty < 760; ty += 40) {
    ctx.fillStyle = Math.floor((ty - towerTop) / 40) % 2 === 0 ? "#e53935" : "#f5f5f5";
    ctx.fillRect(x - 11, ty, 22, 40);
  }
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.arc(x, towerTop, 16, 0, Math.PI * 2);
  ctx.fill();
  // 床とイス
  ctx.fillStyle = "#444";
  ctx.fillRect(x - m.w / 2, y - m.h / 2, m.w, m.h);
  ctx.fillStyle = "#ffd23f";
  for (let i = 0; i < m.w; i += 28) ctx.fillRect(x - m.w / 2 + i, y - m.h / 2, 14, 5);
  ctx.fillStyle = "#e040fb";
  ctx.fillRect(x + m.w / 2 - 4, y - 60, 10, 60);
  // 上で止まっているあいだは「いまや！」
  const q = ((simTime + (p.phase || 0)) % p.period + p.period) % p.period;
  if (q > DROP_WAIT + DROP_RISE && q < DROP_WAIT + DROP_RISE + DROP_TOP) {
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#1d1630";
    ctx.strokeText("いまや！おりて！", x, y - 110);
    ctx.fillStyle = "#ffd23f";
    ctx.fillText("いまや！おりて！", x, y - 110);
  }
}

// 戎橋のかけら（赤い欄干つき）
function drawBridgePiece(piece) {
  const c = piece.crumble;
  const jitter = c.timer >= 0 && !c.fallen ? (Math.random() - 0.5) * 3 : 0;
  ctx.save();
  ctx.translate(piece.position.x + jitter, piece.position.y);
  ctx.rotate(piece.angle);
  const hw = piece.w / 2;
  ctx.fillStyle = "#8d6e63";
  ctx.fillRect(-hw, -10, hw * 2, 20);
  ctx.fillStyle = "#c62828";
  ctx.fillRect(-hw, -38, hw * 2, 5);
  for (let x = -hw + 6; x < hw; x += 18) ctx.fillRect(x, -36, 4, 26);
  ctx.strokeStyle = "#4e342e";
  ctx.lineWidth = 2;
  ctx.strokeRect(-hw, -10, hw * 2, 20);
  ctx.restore();
}

// 串カツ（地面からリズムよく飛び出す）
function drawKushi(m) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(m.position.x - m.w, m.floor - 300, m.w * 2, 300 + 2);
  ctx.clip();
  const top = m.position.y - m.h / 2;
  const bottom = m.position.y + m.h / 2;
  for (let i = 0; i < 3; i++) {
    const x = m.position.x - m.w / 2 + 10 + i * (m.w - 20) / 2;
    ctx.strokeStyle = "#e8d3a8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, top - 10);
    ctx.stroke();
    ctx.fillStyle = "#e8d3a8";
    ctx.beginPath();
    ctx.moveTo(x - 2, top - 8);
    ctx.lineTo(x, top - 18);
    ctx.lineTo(x + 2, top - 8);
    ctx.fill();
    for (let j = 0; j < 3; j++) {
      const cy = top + 8 + j * 18;
      ctx.fillStyle = "#c68642";
      ctx.beginPath();
      ctx.ellipse(x, cy, 8, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8a5a2b";
      ctx.fillRect(x - 4, cy - 3, 2, 2);
      ctx.fillRect(x + 2, cy + 2, 2, 2);
    }
  }
  ctx.restore();
}

// たこ焼き大王のタコ足（上からたたきつける）
function drawTentacle(m) {
  const { x, y } = m.position;
  const tipY = y + m.h / 2;
  const sway = Math.sin(simTime * 3 + x) * 6;
  ctx.strokeStyle = "#d84343";
  ctx.lineCap = "round";
  ctx.lineWidth = m.w * 0.7;
  ctx.beginPath();
  ctx.moveTo(x + sway, y - 420);
  ctx.quadraticCurveTo(x - sway * 2, y - 200, x, tipY - m.w * 0.35);
  ctx.stroke();
  ctx.fillStyle = "#ffc1b5";
  for (let k = tipY - 30; k > y - 380; k -= 34) {
    ctx.beginPath();
    ctx.arc(x - m.w * 0.18, k, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 水（道頓堀・大阪湾）。人や自転車の手前に、すき通った色で描く
function drawWater() {
  for (const w of COURSE.water) {
    if (w.x2 < camera.x - 700 || w.x1 > camera.x + 700) continue;
    ctx.fillStyle = w.color || "#2f6fa8";
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.moveTo(w.x1, w.y + 600);
    for (let x = w.x1; x <= w.x2; x += 15) {
      ctx.lineTo(x, w.y + Math.sin(x / 30 + simTime * 3) * 3);
    }
    ctx.lineTo(w.x2, w.y + 600);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = w.x1; x <= w.x2; x += 15) {
      const y = w.y + Math.sin(x / 30 + simTime * 3) * 3;
      if (x === w.x1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// サメ（左向き。口を開けて飛び出してくる）
function drawShark(m) {
  const sh = m.sharkData;
  if (m.position.y > sh.waterY + 20) return;
  ctx.save();
  ctx.translate(m.position.x, m.position.y);
  ctx.rotate(m.angle);
  // しっぽ
  ctx.fillStyle = "#5d7086";
  ctx.beginPath();
  ctx.moveTo(48, 0);
  ctx.lineTo(80, -26);
  ctx.lineTo(70, 0);
  ctx.lineTo(80, 24);
  ctx.closePath();
  ctx.fill();
  // 背びれ
  ctx.beginPath();
  ctx.moveTo(-6, -18);
  ctx.lineTo(14, -48);
  ctx.lineTo(24, -16);
  ctx.closePath();
  ctx.fill();
  // 体
  ctx.fillStyle = "#6b7f95";
  ctx.beginPath();
  ctx.ellipse(0, 0, 60, 23, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8eef4";
  ctx.beginPath();
  ctx.ellipse(-6, 10, 48, 11, 0, 0, Math.PI);
  ctx.fill();
  // 大きく開けた口と歯
  ctx.fillStyle = "#7a1020";
  ctx.beginPath();
  ctx.moveTo(-62, -2);
  ctx.lineTo(-30, 4);
  ctx.lineTo(-62, 16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-58 + i * 7, -1 + i * 1.5);
    ctx.lineTo(-55 + i * 7, 5);
    ctx.lineTo(-52 + i * 7, 0 + i * 1.5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-58 + i * 7, 15 - i * 2);
    ctx.lineTo(-55 + i * 7, 9);
    ctx.lineTo(-52 + i * 7, 14 - i * 2);
    ctx.fill();
  }
  // 目
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(-36, -8, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 川を泳ぐサメのヒレ（飾り）
function drawFins(d) {
  ctx.fillStyle = "#5d7086";
  for (let i = 0; i < 3; i++) {
    const len = d.x2 - d.x1;
    const speed = 50 + i * 25;
    const pos = (simTime * speed + i * 900) % (len * 2);
    const dir = pos < len ? 1 : -1;
    const x = d.x1 + (pos < len ? pos : len * 2 - pos);
    if (Math.abs(x - camera.x) > 700) continue;
    const y = d.y + Math.sin(simTime * 3 + i) * 2;
    ctx.beginPath();
    ctx.moveTo(x - 14 * dir, y);
    ctx.lineTo(x + 2 * dir, y - 26);
    ctx.lineTo(x + 12 * dir, y);
    ctx.closePath();
    ctx.fill();
  }
}

// 背景でループするジェットコースター（「キャー!」）
function drawCoasterLoop(d) {
  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = "#8a93a6";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(d.x - 60, d.y + d.r);
  ctx.lineTo(d.x - 90, 700);
  ctx.moveTo(d.x + 60, d.y + d.r);
  ctx.lineTo(d.x + 90, 700);
  ctx.stroke();
  // レール
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(d.x - 380, d.y + d.r + 40);
  ctx.quadraticCurveTo(d.x - 150, d.y + d.r, d.x, d.y + d.r);
  ctx.quadraticCurveTo(d.x + 150, d.y + d.r, d.x + 380, d.y + d.r + 40);
  ctx.stroke();
  // 車両（ぐるぐる回り続ける）
  const base = simTime * 2.2;
  for (let i = 0; i < 4; i++) {
    const a = base - i * 0.32;
    const x = d.x + Math.cos(a) * d.r;
    const y = d.y + Math.sin(a) * d.r;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = ["#e53935", "#3a7bd5", "#2ec4b6", "#e040fb"][i];
    ctx.fillRect(-14, -8, 28, 12);
    ctx.fillStyle = "#f2c19b";
    ctx.beginPath();
    ctx.arc(-5, -12, 4, 0, Math.PI * 2);
    ctx.arc(6, -12, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  // 一番上を通るたびに「キャー!」
  const lap = Math.floor((base + Math.PI / 2) / (Math.PI * 2));
  if (d.lastLap !== undefined && lap !== d.lastLap && Math.abs(d.x - camera.x) < 600) {
    addPopup(d.x, d.y - d.r - 30, "キャー!", "#ffffff", 22);
  }
  d.lastLap = lap;
}

// 背景のたこ焼き職人（ハチマキをして、鉄板でたこ焼きをひっくり返す）
function drawChef(c) {
  const x = chefScreenX(c);
  if (Math.abs(x - camera.x) > 900) return;
  const y = c.y;
  const flip = c.flip > 0 ? Math.sin((c.flip / 0.35) * Math.PI) : 0;
  ctx.save();
  ctx.globalAlpha = 0.92;
  // 体
  ctx.fillStyle = "#f5f5f5";
  ctx.beginPath();
  ctx.ellipse(x, y - 40, 70, 90, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 70, y - 40, 140, 60);
  // 頭とハチマキ
  ctx.fillStyle = "#f2c19b";
  ctx.beginPath();
  ctx.arc(x, y - 150, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 43, y - 172, 86, 14);
  ctx.fillStyle = "#e53935";
  ctx.beginPath();
  ctx.arc(x, y - 165, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(x - 14, y - 145, 4, 0, Math.PI * 2);
  ctx.arc(x + 14, y - 145, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y - 132, 12, 0.2, Math.PI - 0.2);
  ctx.stroke();
  // 鉄板（たこ焼きの穴）
  ctx.fillStyle = "#333";
  ctx.fillRect(x - 110, y + 10, 220, 22);
  for (let i = 0; i < 6; i++) {
    const hx = x - 90 + i * 36;
    const jump = i === 2 || i === 3 ? flip * 40 : 0;
    drawTakoyaki(hx, y + 8 - jump, 12, flip * Math.PI * (i % 2 ? 1 : -1));
  }
  // うで（ピックでひっくり返す）
  ctx.strokeStyle = "#f2c19b";
  ctx.lineWidth = 16;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    const hx = x + side * 40;
    const hy = y - 10 - flip * 30;
    ctx.beginPath();
    ctx.moveTo(x + side * 55, y - 80);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx - side * 10, hy + 26);
    ctx.stroke();
    ctx.strokeStyle = "#f2c19b";
    ctx.lineWidth = 16;
  }
  ctx.restore();
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#1d1630";
  ctx.strokeText("たこ焼き職人", x, y - 215);
  ctx.fillStyle = "#ffd23f";
  ctx.fillText("たこ焼き職人", x, y - 215);
}

// 画面の奥から飛んでくるたこ焼き（だんだん大きくなる。落ちる場所に影）
function drawFlyingTakoyaki() {
  for (const f of flyingTakoyaki) {
    const k = Math.min(1, f.t / f.T);
    ctx.fillStyle = `rgba(0,0,0,${0.15 + k * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(f.tx, f.gy, f.r * (0.6 + k * 1.2), 4 + k * 3, 0, 0, Math.PI * 2);
    ctx.fill();
    const x = f.sx + (f.tx - f.sx) * k;
    const y = f.sy + (f.ty - f.sy) * k - Math.sin(k * Math.PI) * 160;
    drawTakoyaki(x, y, f.r * (0.25 + k * 0.75), k * 12);
  }
}

// 浮かんで消える文字（ポンと大きくなって出てくる）
function drawPopups() {
  for (const p of popups) {
    const k = Math.min(1, p.age / 0.12);
    const alpha = Math.min(1, (p.life - p.age) / 0.4);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.rotate(-0.08);
    ctx.scale(0.5 + k * 0.5, 0.5 + k * 0.5);
    ctx.font = `bold ${p.size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = p.size / 5;
    ctx.strokeStyle = "#1d1630";
    ctx.strokeText(p.text, 0, 0);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, 0, 0);
    ctx.restore();
  }
}

// 「トンネル」の飾り（プレス機のまわり）
function drawTunnels() {
  for (const c of COURSE.crushers) {
    if (c.kind) continue;
    const floor = groundY(c.x);
    const l = c.x - c.w / 2 - 70;
    const r = c.x + c.w / 2 + 70;
    ctx.fillStyle = "rgba(60, 50, 45, 0.15)";
    ctx.fillRect(l, c.top - c.h - 40, r - l, floor - (c.top - c.h - 40));
    ctx.fillStyle = "#8a7a6a";
    ctx.fillRect(l - 20, c.top - c.h - 60, r - l + 40, 24);
    ctx.fillRect(l - 20, c.top - c.h - 60, 22, floor - (c.top - c.h - 60));
    ctx.fillRect(r - 2, c.top - c.h - 60, 22, floor - (c.top - c.h - 60));
  }
}

function drawSigns() {
  for (const sign of COURSE.signs) {
    const y = sign.y ?? groundY(sign.x) ?? 500;
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

function drawGoal(x) {
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

function drawWheel(wheel, tire = "#222", width = 6) {
  const { x, y } = wheel.position;
  const r = wheel.circleRadius;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(wheel.angle);
  ctx.strokeStyle = tire;
  ctx.lineWidth = Math.min(width, r * 0.6);
  ctx.beginPath();
  ctx.arc(0, 0, r - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  // スポーク（回転が見えるように）
  const sr = r - 4;
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * -sr, Math.sin(a) * -sr);
    ctx.lineTo(Math.cos(a) * sr, Math.sin(a) * sr);
    ctx.stroke();
  }
  ctx.strokeStyle = "#ff5a36";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(sr, 0);
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

// 乗り物を描く。車体の座標（フレームの中心が原点）で描けるようにしてから、乗り物ごとの絵を描く
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

  if (vehicleId === "moto") {
    drawWheel(rear, "#111", 9);
    drawWheel(front, "#111", 9);
  } else {
    drawWheel(rear);
    drawWheel(front);
  }

  ctx.save();
  ctx.translate(ox, oy);
  ctx.rotate(angle);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (vehicleId === "moto") drawMotoBody(r, f);
  else if (vehicleId === "chair") drawChairBody(r, f);
  else drawBicycleBody(r, f, c);
  ctx.restore();

  // ペダル（自転車だけ）
  if (vehicle.pedals) {
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
}

// 自転車（フレーム・ハンドル・サドル）
function drawBicycleBody(r, f, c) {
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
}

// バイク（エンジン・タンク・シート・フロントフォーク）
function drawMotoBody(r, f) {
  // スイングアーム・フロントフォーク
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 6;
  line(r, { x: -4, y: 6 });
  ctx.strokeStyle = "#9aa3ad";
  ctx.lineWidth = 5;
  line(f, { x: 26, y: -16 });
  // エンジン
  ctx.fillStyle = "#4b5563";
  ctx.fillRect(-14, -2, 28, 18);
  ctx.fillStyle = "#9aa3ad";
  ctx.fillRect(-10, 2, 6, 10);
  ctx.fillRect(-1, 2, 6, 10);
  // マフラー
  ctx.strokeStyle = "#c0c4cc";
  ctx.lineWidth = 5;
  line({ x: -8, y: 14 }, { x: -44, y: 6 });
  // 車体・タンク
  ctx.fillStyle = "#1f6feb";
  ctx.beginPath();
  ctx.moveTo(-40, -8);
  ctx.lineTo(-6, -12);
  ctx.lineTo(4, -20);
  ctx.lineTo(24, -18);
  ctx.lineTo(28, -6);
  ctx.lineTo(14, 0);
  ctx.lineTo(-36, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffd23f";
  ctx.fillRect(6, -16, 12, 4);
  // シート
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.moveTo(-34, -9);
  ctx.lineTo(-4, -13);
  ctx.lineTo(-2, -17);
  ctx.lineTo(-30, -14);
  ctx.closePath();
  ctx.fill();
  // ハンドル・ライト
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 4;
  line({ x: 26, y: -16 }, { x: 30, y: -24 });
  line({ x: 26, y: -24 }, { x: 36, y: -22 });
  ctx.fillStyle = "#fff3a6";
  ctx.beginPath();
  ctx.arc(32, -12, 4, 0, Math.PI * 2);
  ctx.fill();
}

// 車いす（シート・背もたれ・足置き・手すり）
function drawChairBody(r, f) {
  ctx.strokeStyle = "#7a8594";
  ctx.lineWidth = 4;
  line({ x: -22, y: -30 }, { x: -22, y: 2 });     // 背もたれの柱
  line({ x: -22, y: 2 }, { x: 22, y: 2 });        // シートの下のパイプ
  line({ x: 22, y: 2 }, f);                       // 前の車輪へ
  line({ x: 16, y: 2 }, { x: 28, y: 16 });        // 足置きへ
  line({ x: -22, y: -30 }, { x: -30, y: -32 });   // 押し手
  ctx.lineWidth = 3;
  line({ x: -20, y: -14 }, { x: 8, y: -14 });     // 手すり
  ctx.fillStyle = "#2b4f8f";
  ctx.fillRect(-22, -4, 44, 6);                   // シート
  ctx.fillRect(-24, -28, 5, 26);                  // 背もたれ
  ctx.fillStyle = "#333";
  ctx.fillRect(22, 14, 14, 4);                    // 足置き
  // 後輪のハンドリム
  ctx.strokeStyle = "#c0c4cc";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(r.x, r.y, 17, 0, Math.PI * 2);
  ctx.stroke();
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
  if (bike.eatenBy) {
    drawBike();
    return;
  }
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
  drawDecor();
  drawSigns();
  drawRamps();
  drawLands();
  drawSauce();
  drawCheckpoints();
  drawWalls();
  if (COURSE.fakeGoalX !== undefined) drawGoal(COURSE.fakeGoalX);
  drawGoal(COURSE.goalX);
  drawTunnels();
  drawHazards();
  drawNewTraps();
  drawRider();
  drawFlyingTakoyaki();
  drawWater();
  drawParticles();
  drawPopups();
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
  if (state === "title" && menu === "title" && VEHICLE_ORDER[Number(key) - 1]) {
    selectVehicle(VEHICLE_ORDER[Number(key) - 1]);
    return;
  }
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
  // 前回えらんだ乗り物を使う
  try {
    const saved = localStorage.getItem("crashride-vehicle");
    if (VEHICLES[saved]) {
      vehicleId = saved;
      vehicle = VEHICLES[saved];
    }
  } catch (e) {
    // 読めなくても自転車で遊べる
  }
  buildWorld(COURSE.startX);
  showTitle();
  requestAnimationFrame(loop);
}
