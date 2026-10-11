/* =========================================================
   GỬI CHỊ TRÂM — script.js  (v2: lãng mạn + điện ảnh hơn)
   Kiến trúc:
   - 1 sân khấu sticky, 6 cảnh xếp chồng.
   - Mọi trạng thái hình ảnh là HÀM THUẦN của tiến độ cuộn (u),
     nên cuộn nhanh / cuộn ngược đều ổn định, không reset sai.
   - 1 vòng requestAnimationFrame: làm mượt u, cập nhật cảnh khi u đổi,
     vẽ cánh hoa / hoa nhỏ / bokeh / hạt sáng lên canvas.
   ========================================================= */
(function () {
  'use strict';

  /* =======================================================
     CONFIG — sửa toàn bộ câu chữ và nhịp cuộn tại đây
     ======================================================= */
  const CONFIG = {
    pageTitle: 'uhhh Hello chị ;-;',

    opening: {
      name: 'Chị ơi ờm....,',
      sub: 'em mún nói là..ờm..',
      hint: 'Cuộn xuống'
    },

    journey: [
      'thoi ngại lắm ;-; ',
      'thoi nói đại lunn'
    ],

    bloomLine: 'e có, tình cảm v chị',

    quiet: [
      'cái bình hoa',
      'em tự làm é :>'
    ],

    // Nội dung tỏ tình: tối đa 4 dòng, theo thứ tự (dòng nào bỏ trống thì không hiện)
    confession: [
      'Chị Trâm,',
      'Em thích chị. Em chỉ muốn chị biết điều đó thôi.',
      'Chị không cần trả lời liền đâu ó >.<'
    ],

    ending: {
      thanks: 'Úi sời thấy web ngầu khum chị :D',
      button: 'Xem lại'
    },

    // Độ dài cuộn của từng cảnh (đơn vị: chiều cao màn hình).
    // Thứ tự: Opening, Petal journey, Bloom, Quiet, Confession, Ending
    scrollWeights: [1, 2.4, 3.2, 1.6, 3, 1.6]
  };

  /* =======================================================
     TIỆN ÍCH
     ======================================================= */
  const clamp = (x, a, b) => { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b; return x < a ? a : x > b ? b : x; };
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const seg = (p, a, b) => clamp((p - a) / (b - a));     // đoạn [a,b] của p → 0..1
  const mod = (a, n) => ((a % n) + n) % n;
  const $ = (id) => document.getElementById(id);

  // Nội suy tuyến tính theo bảng [[x, y], ...]
  function stops(x, arr) {
    if (x <= arr[0][0]) return arr[0][1];
    for (let i = 1; i < arr.length; i++) {
      if (x <= arr[i][0]) {
        const a = arr[i - 1], b = arr[i];
        return lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
      }
    }
    return arr[arr.length - 1][1];
  }

  function hexRGB(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  // PRNG có seed: bố cục luôn giống nhau mỗi lần tải
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // Lấy phần tử theo id; nếu HTML cũ chưa có thì tự tạo (để thay mỗi script.js cũng không vỡ)
  function ensure(id, parent, tag, cls) {
    let el = $(id);
    if (!el) {
      el = document.createElement(tag);
      el.id = id;
      if (cls) el.className = cls;
      parent.insertBefore(el, parent.firstChild);
    }
    return el;
  }

  /* =======================================================
     THAM CHIẾU DOM
     ======================================================= */
  const docEl = document.documentElement;
  const scrollEl = $('scroll');
  const stage = $('stage');
  const canvas = $('petals');
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;

  const sceneEls = [$('s0'), $('s1'), $('s2'), $('s3'), $('s4'), $('s5')];
  const E = {
    openText: $('openText'), sprig: $('sprig'), hint: $('hint'),
    s1cam: $('s1cam'), b1: $('b1'), b2: $('b2'), b3: $('b3'),
    roseWrap: $('roseWrap'), stem: $('stem'), leafR: $('leafR'), leafL: $('leafL'),
    recept: $('recept'), petalsG: $('petalsG'), glow: $('bloomGlow'),
    s3cam: $('s3cam'),
    confBox: $('confBox'), rule: $('rule'),
    fall: $('fall'), restart: $('restart')
  };
  E.rays = ensure('rays', sceneEls[2], 'div', 'rays');
  E.ripple = ensure('ripple', sceneEls[5], 'i', 'ripple');
  if (!$('grain')) { const gr = document.createElement('div'); gr.id = 'grain'; stage.appendChild(gr); }

  /* =======================================================
     CHỮ — đổ từ CONFIG, tách từng từ để hiện theo nhịp (focus-pull)
     ======================================================= */
  const WORDS = {};        // key → mảng <span> từng từ
  const cacheV = {};       // key → giá trị v lần cuối (tránh cập nhật thừa)

  function splitInto(key, el, text) {
    if (!el) return;
    el.textContent = '';
    const arr = [];
    const words = String(text === undefined ? '' : text).split(/\s+/).filter(Boolean);
    words.forEach(function (w, i) {
      const s = document.createElement('span');
      s.className = 'w';
      s.textContent = w;
      el.appendChild(s);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
      arr.push(s);
    });
    WORDS[key] = arr;
  }

  function renderText() {
    document.title = CONFIG.pageTitle;
    $('oName').textContent = CONFIG.opening.name;
    $('oSub').textContent = CONFIG.opening.sub;
    $('hintText').textContent = CONFIG.opening.hint;
    CONFIG.journey.forEach(function (t, i) { splitInto('j' + i, $('j' + i), t); });
    splitInto('bLine', $('bLine'), CONFIG.bloomLine);
    CONFIG.quiet.forEach(function (t, i) { splitInto('q' + i, $('q' + i), t); });
    for (let i = 0; i < 4; i++) splitInto('c' + i, $('c' + i), CONFIG.confession[i]);
    splitInto('thanks', $('thanks'), CONFIG.ending.thanks);
    E.restart.textContent = CONFIG.ending.button;
  }

  // Hiện chữ từng từ theo v ∈ [0,1]: mờ nét → rõ nét, trồi lên nhẹ. Reduced-motion: chỉ fade.
  function revealWords(key, v) {
    const ws = WORDS[key];
    if (!ws || !ws.length) return;
    if (cacheV[key] === v && (v === 0 || v === 1)) return;
    cacheV[key] = v;
    const n = ws.length;
    for (let i = 0; i < n; i++) {
      const st = ws[i].style;
      if (REDUCED) { st.opacity = v > 0.5 ? 1 : 0; st.transform = ''; st.filter = ''; continue; }
      const a = (n > 1 ? i / (n - 1) : 0) * 0.55;
      const wv = smooth(seg(v, a, a + 0.45));
      st.opacity = wv.toFixed(3);
      st.transform = wv >= 0.999 ? '' : 'translate3d(0,' + ((1 - wv) * 10).toFixed(1) + 'px,0)';
      st.filter = wv >= 0.999 ? '' : 'blur(' + ((1 - wv) * 5).toFixed(1) + 'px)';
    }
  }

  // Phần tử đơn (nút bấm…)
  function reveal(el, v, rise) {
    if (REDUCED) { el.style.opacity = v > 0.5 ? 1 : 0; el.style.transform = ''; return; }
    el.style.opacity = v;
    el.style.transform = 'translate3d(0,' + ((1 - v) * (rise === undefined ? 14 : rise)).toFixed(2) + 'px,0)';
  }

  /* =======================================================
     REDUCED MOTION
     ======================================================= */
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let REDUCED = !!(mq && mq.matches);

  function onMotionChange() {
    REDUCED = !!(mq && mq.matches);
    docEl.classList.toggle('reduced', REDUCED);
    for (const k in cacheV) delete cacheV[k];
    roses.forEach(function (r) { r.last = -1; });
    snap = true;
    resize(true);
  }
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', onMotionChange);
    else if (mq.addListener) mq.addListener(onMotionChange);
  }

  /* =======================================================
     CHIA CẢNH THEO TIẾN ĐỘ CUỘN
     u = scrollY / maxScroll  ∈ [0,1]
     Cảnh i chiếm [B[i], B[i+1]] của u. p_i = tiến độ cục bộ.
     g = Σ p_i  (0..6) = "vị trí điện ảnh" liên tục toàn trang
     ======================================================= */
  const WSUM = CONFIG.scrollWeights.reduce(function (a, b) { return a + b; }, 0);
  const B = [0];
  CONFIG.scrollWeights.forEach(function (w) { B.push(B[B.length - 1] + w / WSUM); });
  B[B.length - 1] = 1;

  (function setPageHeight() {
    let unit = 'vh';
    try { if (window.CSS && CSS.supports && CSS.supports('height', '1svh')) unit = 'svh'; } catch (e) {}
    scrollEl.style.height = ((WSUM + 1) * 100) + unit;
  })();

  /* ----- Bảng điều khiển theo g ----- */
  // Màu nền [g, màu trên, màu dưới]: sáng → hồng → ấm (bloom) → hoàng hôn (quiet) → kem sáng (confession)
  const BG_STOPS = [
    [0,    '#fdf1ec', '#f7dcd9'],
    [1,    '#fbe9e4', '#f0c8cd'],
    [2,    '#f4d2d6', '#e0a0ad'],
    [2.6,  '#f7dccd', '#e7a8a0'],
    [3,    '#efc5c6', '#c98698'],
    [3.25, '#8a4560', '#a65a74'],
    [3.7,  '#5a2a3d', '#7a3d55'],
    [3.97, '#5a2a3d', '#7a3d55'],
    [4.12, '#fff4ee', '#f9e3de'],
    [5,    '#fff4ee', '#f9e3de'],
    [6,    '#fbe3df', '#f2c9cd']
  ].map(function (s) { return [s[0], hexRGB(s[1]), hexRGB(s[2])]; });

  function bgAt(gv) {
    let i = 1;
    while (i < BG_STOPS.length - 1 && gv > BG_STOPS[i][0]) i++;
    const a = BG_STOPS[i - 1], b = BG_STOPS[i];
    const t = clamp((gv - a[0]) / (b[0] - a[0]));
    const mix = function (x, y) {
      return 'rgb(' + Math.round(lerp(x[0], y[0], t)) + ',' + Math.round(lerp(x[1], y[1], t)) + ',' + Math.round(lerp(x[2], y[2], t)) + ')';
    };
    return [mix(a[1], b[1]), mix(a[2], b[2])];
  }

  // Mật độ cánh hoa, tốc độ thời gian, hạt sáng, bokeh, tia lấp lánh quanh hoa — theo g
  const DENS  = [[0, .14], [.6, .18], [1, .34], [1.35, .95], [1.8, 1], [2, .6], [2.5, .34], [3, .24], [3.4, .12], [4, .06], [4.2, .08], [5, .07], [5.4, .03], [6, 0]];
  const TSCALE = [[0, .7], [1, 1], [1.6, 1.5], [2, 1], [3, .6], [3.5, .3], [4, .2], [6, .2]];
  const MOTE  = [[0, 0], [2.2, 0], [2.6, .7], [3, 1], [3.7, 1], [3.95, .2], [6, 0]];
  const BOKEH = [[0, 0], [.8, 0], [1.4, .5], [2.6, 1], [3.6, 1], [3.97, .7], [4.3, .5], [5.2, .45], [6, .15]];
  const SPARK = [[0, 0], [2.35, 0], [2.7, 1], [2.95, .9], [3.2, 0], [6, 0]];
  const BURST_AT = 2.84;   // g tại đó hoa "nổ" cánh khi bông hoa nở trọn

  /* =======================================================
     CANVAS: cánh hoa, hoa nhỏ, bokeh, hạt sáng, tia lấp lánh, cánh nổ
     Vị trí = hàm thuần của (thời gian T, cuộn sy, g) → cuộn ngược vẫn mượt.
     ======================================================= */
  const SPRITE_COLORS = [
    ['#fcdde1', '#ec9fb0'],   // 0 hồng phấn
    ['#efb0bc', '#c4627b'],   // 1 dusty rose
    ['#e08a9e', '#a53b57'],   // 2 hồng đậm
    ['#fff3ea', '#f4c7c6']    // 3 trắng kem
  ];
  const BLOSSOM_COLORS = [
    ['#ffe3e8', '#f2a6b8'],
    ['#fff7ef', '#f6cfcf'],
    ['#f7b9c6', '#d9728c']
  ];

  function makeSprite(top, base) {
    const S = 160, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const k = S / 150;
    x.translate(S / 2, S * 0.93);
    x.scale(k, k);
    x.beginPath();
    x.moveTo(0, 0);
    x.bezierCurveTo(-58, -14, -74, -78, -40, -116);
    x.bezierCurveTo(-20, -138, 20, -138, 40, -116);
    x.bezierCurveTo(74, -78, 58, -14, 0, 0);
    x.closePath();
    const g = x.createLinearGradient(0, -138, 0, 0);
    g.addColorStop(0, top); g.addColorStop(1, base);
    x.fillStyle = g; x.fill();
    x.strokeStyle = 'rgba(255,244,240,.35)'; x.lineWidth = 1.2; x.stroke();
    const h = x.createLinearGradient(0, -120, 0, -20);
    h.addColorStop(0, 'rgba(255,255,255,.28)'); h.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = h; x.beginPath(); x.ellipse(0, -70, 16, 48, 0, 0, Math.PI * 2); x.fill();
    return c;
  }

  // Hoa năm cánh nhỏ, nhụy vàng
  function makeBlossomSprite(top, base) {
    const S = 96, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    x.translate(S / 2, S / 2);
    for (let k = 0; k < 5; k++) {
      x.save();
      x.rotate(k * Math.PI * 2 / 5);
      const g = x.createLinearGradient(0, -2, 0, -42);
      g.addColorStop(0, base); g.addColorStop(1, top);
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(0, -2);
      x.bezierCurveTo(-18, -10, -17, -38, 0, -42);
      x.bezierCurveTo(17, -38, 18, -10, 0, -2);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(255,255,255,.4)'; x.lineWidth = 1; x.stroke();
      x.restore();
    }
    const cg = x.createRadialGradient(0, 0, 0, 0, 0, 7);
    cg.addColorStop(0, '#fff0b8'); cg.addColorStop(1, '#e2b66a');
    x.fillStyle = cg; x.beginPath(); x.arc(0, 0, 6.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#c98a3a';
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      x.beginPath(); x.arc(Math.cos(a) * 9, Math.sin(a) * 9, 1.3, 0, Math.PI * 2); x.fill();
    }
    return c;
  }

  function makeGlowSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,232,176,1)');
    g.addColorStop(.35, 'rgba(255,214,140,.55)');
    g.addColorStop(1, 'rgba(255,214,140,0)');
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    return c;
  }

  // Bokeh: đĩa mờ, viền sáng hơn một chút như ống kính thật
  function makeBokehSprite(rgb) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 62);
    g.addColorStop(0, 'rgba(' + rgb + ',.10)');
    g.addColorStop(.7, 'rgba(' + rgb + ',.20)');
    g.addColorStop(.9, 'rgba(' + rgb + ',.38)');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return c;
  }

  const petals = [];
  const motes = [];
  const bokehs = [];
  const sparks = [];
  const burst = [];
  let sprites = [], blossoms = [], bokehSprites = [], moteSprite = null;
  const MARG = 100;
  let W = 0, H = 0, dpr = 1, psScale = 1;
  const roseC = { x: 0, y: 0 };   // tâm bông hoa chính trên màn hình (cho tia lấp lánh + hoa nổ)

  function buildPetals() {
    petals.length = 0; motes.length = 0; bokehs.length = 0; sparks.length = 0; burst.length = 0;
    if (!ctx) return;
    sprites = SPRITE_COLORS.map(function (c) { return makeSprite(c[0], c[1]); });
    blossoms = BLOSSOM_COLORS.map(function (c) { return makeBlossomSprite(c[0], c[1]); });
    bokehSprites = ['255,226,170', '255,190,208', '255,255,255'].map(makeBokehSprite);
    moteSprite = makeGlowSprite();

    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    const counts = small ? [10, 9, 4] : [18, 16, 8];
    const rnd = mulberry32(20240214);
    const LAYERS = [
      { size: [13, 20], alpha: .5,  par: .28, spd: [9, 16],  amp: [10, 28], pick: [3, 0] },
      { size: [22, 34], alpha: .72, par: .62, spd: [16, 26], amp: [18, 40], pick: [0, 1, 3] },
      { size: [42, 66], alpha: .8,  par: 1.3, spd: [26, 42], amp: [26, 60], pick: [1, 2, 0] }
    ];
    const between = function (r) { return lerp(r[0], r[1], rnd()); };

    LAYERS.forEach(function (L, li) {
      for (let i = 0; i < counts[li]; i++) {
        petals.push({
          x0: rnd(), y0: rnd(), flat: false,
          size: between(L.size), alpha: L.alpha, par: L.par,
          spd: between(L.spd), amp: between(L.amp),
          freq: lerp(.35, .8, rnd()), ph: rnd() * Math.PI * 2,
          r0: rnd() * Math.PI * 2, rs: (rnd() - .5) * .7,
          flip: lerp(.5, 1.3, rnd()),
          sprite: sprites[L.pick[Math.floor(rnd() * L.pick.length)]],
          rank: 0
        });
      }
    });

    // Hoa nhỏ năm cánh trôi lẫn cánh hoa (không lật 3D, xoay chậm)
    const BL = [
      { n: small ? 2 : 4, size: [26, 38], par: .62, spd: [16, 26], amp: [16, 36] },
      { n: small ? 3 : 6, size: [46, 64], par: 1.2, spd: [24, 38], amp: [24, 50] }
    ];
    let bi = 0;
    BL.forEach(function (L) {
      for (let i = 0; i < L.n; i++) {
        petals.push({
          x0: rnd(), y0: rnd(), flat: true,
          size: between(L.size), alpha: .9, par: L.par,
          spd: between(L.spd), amp: between(L.amp),
          freq: lerp(.3, .6, rnd()), ph: rnd() * Math.PI * 2,
          r0: rnd() * Math.PI * 2, rs: (rnd() - .5) * .45,
          flip: 1,
          sprite: blossoms[bi++ % blossoms.length],
          rank: 0
        });
      }
    });

    // Mỗi cánh/hoa có "thứ hạng" ngẫu nhiên: mật độ tăng thì hiện dần theo thứ hạng
    const order = petals.map(function (_, i) { return i; });
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    order.forEach(function (idx, r) { petals[idx].rank = r / order.length; });

    const mc = small ? 14 : 26;
    for (let i = 0; i < mc; i++) {
      motes.push({
        x0: rnd(), y0: rnd(), size: lerp(7, 15, rnd()),
        rise: lerp(6, 16, rnd()), tw: lerp(.8, 2, rnd()), ph: rnd() * Math.PI * 2
      });
    }

    const bk = small ? 8 : 14;
    for (let i = 0; i < bk; i++) {
      bokehs.push({
        x0: rnd(), y0: rnd(), size: lerp(40, 120, rnd()),
        par: lerp(.05, .3, rnd()), rise: lerp(3, 8, rnd()),
        ph: rnd() * Math.PI * 2, alpha: lerp(.5, 1, rnd()),
        sprite: bokehSprites[i % bokehSprites.length]
      });
    }

    const sk = small ? 9 : 14;
    for (let i = 0; i < sk; i++) {
      sparks.push({
        a0: rnd() * Math.PI * 2, w: lerp(.15, .4, rnd()) * (rnd() < .5 ? -1 : 1),
        r: lerp(70, 210, rnd()), size: lerp(8, 17, rnd()),
        tw: lerp(1, 2.4, rnd()), ph: rnd() * Math.PI * 2
      });
    }

    // Cánh/hoa "nổ" ra từ bông hoa khi nở trọn — vị trí phụ thuộc g nên cuộn ngược vẫn gom lại đúng
    const bc = small ? 16 : 26;
    for (let i = 0; i < bc; i++) {
      const ang = -Math.PI / 2 + (rnd() - .5) * Math.PI * 1.5;
      const spd = lerp(.25, .8, rnd());
      burst.push({
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        size: lerp(22, 46, rnd()), r0: rnd() * Math.PI * 2, spin: (rnd() - .5) * 5,
        ph: rnd() * Math.PI * 2, flip: lerp(.8, 1.6, rnd()),
        sprite: rnd() < .22 ? blossoms[i % blossoms.length] : sprites[Math.floor(rnd() * sprites.length)],
        flat: false
      });
      burst[i].flat = blossoms.indexOf(burst[i].sprite) >= 0;
    }
  }

  function drawPetals(sy, gv, T, forcedDens) {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const full = forcedDens === undefined;
    const dens = full ? stops(gv, DENS) : forcedDens;
    const mv = full ? stops(gv, MOTE) : 0;
    const bv = full ? stops(gv, BOKEH) : 0;
    const sv = full ? stops(gv, SPARK) : 0;
    const Hc = H + 2 * MARG;

    // --- bokeh (xa nhất, mờ nhất) ---
    if (bv > 0.002) {
      for (let i = 0; i < bokehs.length; i++) {
        const b = bokehs[i];
        const s = b.size * psScale;
        const y = mod(b.y0 * Hc - T * b.rise - sy * b.par, Hc) - MARG;
        const x = b.x0 * W + Math.sin(T * .12 + b.ph) * 30;
        ctx.globalAlpha = bv * b.alpha * (.7 + .3 * Math.sin(T * .35 + b.ph)) * .8;
        ctx.drawImage(b.sprite, x - s / 2, y - s / 2, s, s);
      }
    }

    // --- cánh hoa + hoa nhỏ ---
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      const vis = smooth((dens - p.rank) * 12);
      if (vis < 0.01) continue;
      const s = p.size * psScale;
      const y = mod(p.y0 * Hc + T * p.spd * psScale - sy * p.par, Hc) - MARG;
      const ph = T * p.freq + p.ph;
      const x = p.x0 * W + Math.sin(ph) * p.amp * psScale + Math.sin(sy * 0.0016 + p.ph) * 28 * p.par;
      const rot = p.r0 + T * p.rs + Math.sin(ph) * 0.45;
      let sx = 1;
      if (!p.flat) {
        sx = Math.cos(T * p.flip + p.ph * 2);           // lật 3D giả lập
        sx = sx >= 0 ? Math.max(sx, .3) : Math.min(sx, -.3);
      }
      ctx.globalAlpha = p.alpha * vis;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sx, 1);
      ctx.drawImage(p.sprite, -s / 2, -s / 2, s, s);
      ctx.restore();
    }

    // --- tia lấp lánh vàng quay quanh bông hoa ---
    if (sv > 0.002) {
      for (let i = 0; i < sparks.length; i++) {
        const k = sparks[i];
        const a = k.a0 + T * k.w;
        const tw = Math.sin(T * k.tw + k.ph);
        const s = k.size * psScale * (.8 + .4 * tw * tw);
        const x = roseC.x + Math.cos(a) * k.r * psScale;
        const y = roseC.y + Math.sin(a) * k.r * psScale * .8;
        ctx.globalAlpha = sv * (.3 + .7 * tw * tw);
        ctx.drawImage(moteSprite, x - s / 2, y - s / 2, s, s);
      }
    }

    // --- hoa nổ: cánh bay ra từ tâm bông hoa lúc nở trọn rồi rơi xuống ---
    if (full) {
      const age = gv - BURST_AT;
      if (age > 0 && age < 1.6) {
        const al = smooth(seg(age, 0, .06)) * (1 - smooth(seg(age, .8, 1.5)));
        if (al > 0.01) {
          for (let i = 0; i < burst.length; i++) {
            const b = burst[i];
            const s = b.size * psScale;
            const x = roseC.x + b.vx * W * age + Math.sin(T * 2 + b.ph) * 12 * age;
            const y = roseC.y + b.vy * H * age + .5 * 1.1 * H * age * age;
            const rot = b.r0 + age * b.spin * 6 + Math.sin(T * 1.5 + b.ph) * .4;
            let sx = 1;
            if (!b.flat) { sx = Math.cos(T * b.flip + b.ph); sx = sx >= 0 ? Math.max(sx, .3) : Math.min(sx, -.3); }
            ctx.globalAlpha = al * .95;
            ctx.save();
            ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sx, 1);
            ctx.drawImage(b.sprite, -s / 2, -s / 2, s, s);
            ctx.restore();
          }
        }
      }
    }

    // --- hạt sáng vàng (đom đóm) ---
    if (mv > 0.002) {
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const tw = Math.sin(T * m.tw + m.ph);
        const a = mv * (.25 + .75 * tw * tw) * .9;
        const s = m.size * psScale;
        const y = mod(m.y0 * Hc - T * m.rise - sy * .18, Hc) - MARG;
        const x = m.x0 * W + Math.sin(T * .3 + m.ph) * 14;
        ctx.globalAlpha = a;
        ctx.drawImage(moteSprite, x - s / 2, y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* =======================================================
     NHÀNH HOA TRANG TRÍ (hoa nhỏ nở dần trên nhành + nhân bản làm khung)
     ======================================================= */
  const BL_PETAL = 'M0 0 C-10 -4 -11 -22 0 -26 C11 -22 10 -4 0 0Z';

  function makeBlossomG(x, y, s, rot, delay) {
    const outer = svgEl('g', { transform: 'translate(' + x + ' ' + y + ') rotate(' + rot + ') scale(' + s + ')' });
    const inner = svgEl('g', { 'class': 'bl-in' });
    inner.style.setProperty('--bd', delay + 's');
    for (let k = 0; k < 5; k++) {
      inner.appendChild(svgEl('path', {
        d: BL_PETAL, transform: 'rotate(' + (k * 72) + ')',
        fill: 'url(#' + (k % 2 ? 'gRing0' : 'gRing1') + ')',
        stroke: 'rgba(255,244,240,.5)', 'stroke-width': '.8', 'stroke-linejoin': 'round'
      }));
    }
    inner.appendChild(svgEl('circle', { r: '3.4', fill: '#f0c77a' }));
    inner.appendChild(svgEl('circle', { r: '1.4', fill: '#c98a3a', cx: '1.5', cy: '-1' }));
    outer.appendChild(inner);
    return outer;
  }

  function decorateSprig() {
    if (!E.sprig) return;
    const svg = E.sprig.querySelector('svg');
    if (!svg) return;
    // [x, y, scale, rotate, delay] — dọc theo thân nhành
    [[336, 88, .9, 10, 2.6], [292, 152, .7, -30, 3.1], [246, 214, 1.0, 25, 3.6], [180, 288, .75, -10, 4.1]]
      .forEach(function (b) { svg.appendChild(makeBlossomG(b[0], b[1], b[2], b[3], b[4])); });
  }

  function makeDeco(parent, cls) {
    const svg0 = E.sprig && E.sprig.querySelector('svg');
    if (!svg0) return null;
    const w = document.createElement('div');
    w.className = 'deco ' + cls;
    const f = document.createElement('div');
    f.className = 'flip';
    const svg = svg0.cloneNode(true);
    const ids = svg.querySelectorAll('[id]');
    for (let i = 0; i < ids.length; i++) ids[i].removeAttribute('id');
    f.appendChild(svg);
    w.appendChild(f);
    parent.insertBefore(w, parent.firstChild);
    return w;
  }

  let decoOpen = null, decoC1 = null, decoC2 = null;

  /* =======================================================
     HOA HỒNG SVG — bó hoa: 1 bông chính + 2 bông bên, mở theo tiến độ cuộn
     ======================================================= */
  const PETAL_D = 'M0 0 C-58 -14 -74 -78 -40 -116 C-20 -138 20 -138 40 -116 C74 -78 58 -14 0 0Z';
  const LEAF_D = 'M0 0 C22 -24 66 -24 90 -4 C64 16 22 18 0 0Z';

  // sc: [thu nhỏ khi búp, đầy đủ khi nở]; aClosed: hệ số góc khi búp; start: thời điểm bắt đầu mở (vòng ngoài mở trước)
  const RINGS = [
    { grad: 'gRing0', sc: [.74, 1.0],  angles: [-98, -66, -34, -2, 30, 62, 94], aClosed: .16, start: 0 },
    { grad: 'gRing1', sc: [.58, .8],   angles: [-64, -32, 0, 32, 64],           aClosed: .20, start: .14 },
    { grad: 'gRing2', sc: [.46, .6],   angles: [-42, -14, 14, 42],              aClosed: .22, start: .28 },
    { grad: 'gRing3', sc: [.34, .4],   angles: [-16, 6, 26],                    aClosed: .30, start: .40 }
  ];
  const roses = [];        // mỗi bông: { parts, cx, cy, sc, last }
  const sideStems = [];    // thân + lá của hoa bên: { el, leaf, from, to, range }
  const SIDE = [
    { cx: 104, cy: 430, sc: .58, stem: 'M199 590 C160 560 112 500 104 430', bloom: [.30, .86], grow: [.14, .34], leaf: [150, 520, -150] },
    { cx: 296, cy: 446, sc: .52, stem: 'M201 600 C244 570 292 510 296 446', bloom: [.36, .92], grow: [.20, .40], leaf: [250, 530, -30] }
  ];

  function buildRoseInto(parent, cx, cy, sc) {
    const rose = { parts: [], cx: cx, cy: cy, sc: sc, last: -1 };
    RINGS.forEach(function (ring, ri) {
      const list = ring.angles.map(function (a, j) { return { a: a, j: j }; });
      list.sort(function (x, y) { return Math.abs(y.a) - Math.abs(x.a); });  // cánh ngoài cùng vẽ trước (nằm sau)
      list.forEach(function (it) {
        const el = svgEl('path', {
          d: PETAL_D, fill: 'url(#' + ring.grad + ')',
          stroke: 'rgba(255,244,240,.35)', 'stroke-width': '.9', 'stroke-linejoin': 'round'
        });
        parent.appendChild(el);
        const jitter = 0.94 + (((it.j * 37 + ri * 13) % 10) / 10) * 0.12;   // chênh nhẹ cho tự nhiên
        rose.parts.push({
          el: el, a: it.a, ac: ring.aClosed,
          sc0: ring.sc[0] * jitter, sc1: ring.sc[1] * jitter,
          st: ring.start + (it.j / ring.angles.length) * 0.12
        });
      });
      if (ri === 2) {   // bóng tối nhẹ ở tim hoa, nằm giữa vòng 3 và lõi
        parent.appendChild(svgEl('ellipse', {
          cx: 0, cy: -40, rx: 26, ry: 22, fill: '#7d2540', opacity: '.28',
          transform: 'translate(' + cx + ' ' + cy + ') scale(' + sc + ')'
        }));
      }
    });
    roses.push(rose);
    return rose;
  }

  function setRose(r, bp) {
    if (Math.abs(bp - r.last) < 0.0004) return;
    r.last = bp;
    const base = 'translate(' + r.cx + ' ' + r.cy + ') scale(' + r.sc + ') ';
    for (let i = 0; i < r.parts.length; i++) {
      const q = smooth(seg(bp, r.parts[i].st, r.parts[i].st + 0.42));
      const p = r.parts[i];
      const ang = lerp(p.a * p.ac, p.a, q);
      const s = lerp(p.sc0, p.sc1, q);
      const sy = s * lerp(.88, 1, q);
      p.el.setAttribute('transform', base + 'rotate(' + ang.toFixed(2) + ') scale(' + s.toFixed(3) + ' ' + sy.toFixed(3) + ')');
    }
  }

  let mainRose = null;
  const sideRoses = [];

  function buildBouquet() {
    // bó hoa bên: chèn vào TRƯỚC nhóm cánh chính để nằm phía sau bông chính
    const bouq = svgEl('g', {});
    E.petalsG.parentNode.insertBefore(bouq, E.petalsG);
    SIDE.forEach(function (d) {
      const st = svgEl('path', {
        d: d.stem, pathLength: '1', fill: 'none', stroke: '#728a62', 'stroke-width': '5',
        'stroke-linecap': 'round', 'stroke-dasharray': '1 1', 'stroke-dashoffset': '1', opacity: '0'
      });
      bouq.appendChild(st);
      const leaf = svgEl('g', { transform: 'translate(' + d.leaf[0] + ' ' + d.leaf[1] + ') scale(.001) rotate(' + d.leaf[2] + ')' });
      leaf.appendChild(svgEl('path', { d: LEAF_D, fill: 'url(#gLeaf)' }));
      bouq.appendChild(leaf);
      sideStems.push({ el: st, leaf: leaf, d: d });
    });
    SIDE.forEach(function (d) { sideRoses.push(buildRoseInto(bouq, d.cx, d.cy, d.sc)); });
    // bông chính vẽ sau cùng
    mainRose = buildRoseInto(E.petalsG, 200, 312, 1);
  }

  function updateBouquet(p) {
    for (let i = 0; i < SIDE.length; i++) {
      const d = SIDE[i], s = sideStems[i];
      const sp = REDUCED ? 1 : easeOut(seg(p, d.grow[0], d.grow[1]));
      s.el.style.strokeDashoffset = (1 - sp).toFixed(4);
      s.el.style.opacity = sp > 0.001 ? 1 : 0;
      const ls = REDUCED ? 1 : easeOut(seg(p, d.grow[1] - .04, d.grow[1] + .14));
      s.leaf.setAttribute('transform', 'translate(' + d.leaf[0] + ' ' + d.leaf[1] + ') scale(' + Math.max(.001, ls * .95).toFixed(3) + ') rotate(' + d.leaf[2] + ')');
      setRose(sideRoses[i], REDUCED ? 1 : seg(p, d.bloom[0], d.bloom[1]));
    }
  }

  /* =======================================================
     CẬP NHẬT CẢNH THEO TIẾN ĐỘ
     ======================================================= */
  function setScene(i, o, z) {
    const el = sceneEls[i];
    if (o <= 0.003) { el.style.opacity = 0; el.style.visibility = 'hidden'; }
    else {
      el.style.opacity = o; el.style.visibility = 'visible';
      el.style.transform = (!REDUCED && z && Math.abs(z - 1) > 1e-4) ? 'scale(' + z.toFixed(4) + ')' : '';
    }
  }
  // Camera "đẩy vào" khi cảnh xuất hiện, lùi nhẹ khi rời đi
  const zIn = function (p, w) { return 1 + .05 * (1 - smooth(seg(p, 0, w))); };
  const zOut = function (p, a) { return 1 - .03 * smooth(seg(p, a, 1)); };

  let g = 0;           // vị trí điện ảnh 0..6
  let lastBg = '';

  function update(u) {
    const M = REDUCED ? 0 : 1;                 // hệ số chuyển động (0 = chỉ fade)
    const ps = [];
    g = 0;
    for (let i = 0; i < 6; i++) {
      const p = clamp((u - B[i]) / (B[i + 1] - B[i]));
      ps.push(p); g += p;
    }

    // Nền đổi theo g
    const bg = bgAt(g);
    const key = bg[0] + bg[1];
    if (key !== lastBg) {
      lastBg = key;
      stage.style.setProperty('--bg1', bg[0]);
      stage.style.setProperty('--bg2', bg[1]);
    }

    /* ---- 1. OPENING: nhành hoa trôi lên, chữ mờ dần ---- */
    {
      const p = ps[0];
      const o = 1 - smooth(seg(p, .78, 1));
      setScene(0, o, zOut(p, .78));
      if (o > 0.003) {
        E.openText.style.transform = 'translate3d(0,' + (-p * 60 * M).toFixed(1) + 'px,0) scale(' + (1 + p * .05 * M).toFixed(4) + ')';
        E.sprig.style.transform = 'translate3d(' + (p * 40 * M).toFixed(1) + 'px,' + (-p * 90 * M).toFixed(1) + 'px,0) rotate(' + (p * 4 * M).toFixed(2) + 'deg)';
        if (decoOpen) decoOpen.style.transform = 'translate3d(' + (-p * 40 * M).toFixed(1) + 'px,' + (p * 90 * M).toFixed(1) + 'px,0)';
        E.hint.style.opacity = 1 - seg(p, 0, .12);
      }
    }

    /* ---- 2. PETAL JOURNEY: camera trôi + nghiêng nhẹ, vệt sáng parallax ---- */
    {
      const p = ps[1];
      const o = smooth(seg(p, 0, .1)) * (1 - smooth(seg(p, .9, 1)));
      setScene(1, o, zIn(p, .14) * zOut(p, .88));
      if (o > 0.003) {
        E.s1cam.style.transform = 'scale(' + (1 + .08 * p * M).toFixed(4) + ') rotate(' + ((p - .5) * 1.4 * M).toFixed(3) + 'deg)';
        E.b1.style.transform = 'translate3d(' + (p * 40 * M).toFixed(1) + 'px,' + (-p * 220 * M).toFixed(1) + 'px,0)';
        E.b2.style.transform = 'translate3d(' + (-p * 60 * M).toFixed(1) + 'px,' + (-p * 340 * M).toFixed(1) + 'px,0)';
        E.b3.style.transform = 'translate3d(' + (p * 80 * M).toFixed(1) + 'px,' + (-p * 460 * M).toFixed(1) + 'px,0)';
        revealWords('j0', smooth(seg(p, .14, .32)));
        revealWords('j1', smooth(seg(p, .42, .60)));
      }
    }

    /* ---- 3. BLOOM: thân → lá → cánh mở (bó 3 bông) → tia sáng + ánh sáng ---- */
    {
      const p = ps[2];
      const o = smooth(seg(p, 0, .08)) * (1 - smooth(seg(p, .92, 1)));
      setScene(2, o, zIn(p, .12) * zOut(p, .9));
      if (o > 0.003) {
        const sp = smooth(p);
        const sc = (1 - (1 - sp) * .14 + seg(p, .85, 1) * .04);
        E.roseWrap.style.transform = REDUCED ? '' :
          'translate3d(0,' + ((1 - sp) * 28).toFixed(1) + 'px,0) scale(' + sc.toFixed(4) + ')';

        const stemP = REDUCED ? 1 : easeOut(seg(p, 0, .24));
        E.stem.style.strokeDashoffset = (1 - stemP).toFixed(4);
        E.stem.style.opacity = stemP > 0.001 ? 1 : 0;

        const l1 = REDUCED ? 1 : easeOut(seg(p, .20, .40));
        const l2 = REDUCED ? 1 : easeOut(seg(p, .27, .47));
        E.leafR.setAttribute('transform', 'translate(204 470) scale(' + Math.max(.001, l1 * 1.3).toFixed(3) + ') rotate(-38)');
        E.leafL.setAttribute('transform', 'translate(198 548) scale(' + (-Math.max(.001, l2 * 1.3)).toFixed(3) + ' ' + Math.max(.001, l2 * 1.3).toFixed(3) + ') rotate(-38)');
        E.recept.style.opacity = REDUCED ? 1 : seg(p, .2, .32);

        updateBouquet(p);
        setRose(mainRose, REDUCED ? 1 : seg(p, .30, .88));

        const gl = REDUCED ? .85 : smooth(seg(p, .45, .95));
        E.glow.style.opacity = (gl * .95).toFixed(3);
        E.glow.style.transform = 'translate(-50%,-50%) scale(' + (.7 + .5 * gl).toFixed(3) + ')';
        E.rays.style.opacity = (gl * (REDUCED ? .35 : .55)).toFixed(3);
        E.rays.style.transform = 'translate(-50%,-50%) rotate(' + (p * 50 * M).toFixed(2) + 'deg) scale(' + (.8 + .3 * gl).toFixed(3) + ')';

        revealWords('bLine', smooth(seg(p, .84, .95)));
      }
    }

    /* ---- 4. QUIET MOMENT: hoàng hôn, đom đóm, zoom rất chậm ---- */
    {
      const p = ps[3];
      const o = smooth(seg(p, 0, .1)) * (1 - smooth(seg(p, .8, 1)));
      setScene(3, o, zIn(p, .16) * zOut(p, .8));
      if (o > 0.003) {
        E.s3cam.style.transform = 'scale(' + (1 + .04 * p * M).toFixed(4) + ')';
        revealWords('q0', smooth(seg(p, .26, .42)));
        revealWords('q1', smooth(seg(p, .46, .64)));
      }
    }

    /* ---- 5. CONFESSION: nền sáng, khung hoa hai góc, từng từ hiện theo nhịp đọc ---- */
    {
      const p = ps[4];
      const o = smooth(seg(p, .02, .12)) * (1 - smooth(seg(p, .96, 1)));
      setScene(4, o, zIn(p, .14));
      if (o > 0.003) {
        E.confBox.style.transform = 'translate3d(0,' + (-p * 20 * M).toFixed(1) + 'px,0)';
        const fr = smooth(seg(p, .06, .3)) * (REDUCED ? .75 : .9);
        if (decoC1) { decoC1.style.opacity = fr; decoC1.style.transform = 'translate3d(' + ((1 - fr) * -40 * M).toFixed(1) + 'px,' + ((1 - fr) * -30 * M).toFixed(1) + 'px,0)'; }
        if (decoC2) { decoC2.style.opacity = fr; decoC2.style.transform = 'translate3d(' + ((1 - fr) * 40 * M).toFixed(1) + 'px,' + ((1 - fr) * 30 * M).toFixed(1) + 'px,0)'; }
        revealWords('c0', smooth(seg(p, .10, .22)));
        revealWords('c1', smooth(seg(p, .24, .42)));
        revealWords('c2', smooth(seg(p, .46, .64)));
        revealWords('c3', smooth(seg(p, .68, .84)));
        const r = smooth(seg(p, .84, .95));
        E.rule.style.opacity = r;
        E.rule.style.transform = 'scaleX(' + (REDUCED ? 1 : r).toFixed(3) + ')';
      }
    }

    /* ---- 6. ENDING: cánh hoa cuối rơi, gợn sóng, nút xem lại ---- */
    {
      const p = ps[5];
      const o = smooth(seg(p, 0, .08));
      setScene(5, o, zIn(p, .1));
      if (o > 0.003) {
        const t = REDUCED ? 1 : seg(p, .08, .70);
        const te = smooth(t) * .4 + t * .6;
        const y = lerp(-H * .12, H * .74, te);
        const x = Math.sin(t * 6.5) * W * .08 * (REDUCED ? 0 : 1);
        const rot = (-20 + t * 220) * (REDUCED ? 0 : 1);
        let sx = Math.cos(t * 9);
        sx = REDUCED ? 1 : (sx >= 0 ? Math.max(sx, .28) : Math.min(sx, -.28));
        E.fall.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + rot.toFixed(1) + 'deg) scale(' + sx.toFixed(3) + ',1)';
        E.fall.style.opacity = REDUCED ? .4 : (1 - .65 * smooth(seg(p, .6, .85))).toFixed(3);

        // gợn sóng vàng lan ra nơi cánh hoa chạm đất
        const rp = REDUCED ? 0 : seg(p, .68, .94);
        E.ripple.style.top = (H * .74 + 70).toFixed(0) + 'px';
        E.ripple.style.opacity = rp > 0 ? ((1 - rp) * .8).toFixed(3) : 0;
        const rs = .2 + rp * 2.4;
        E.ripple.style.transform = 'scale(' + rs.toFixed(3) + ',' + (rs * .32).toFixed(3) + ')';

        revealWords('thanks', smooth(seg(p, .45, .62)));
        const bv = smooth(seg(p, .70, .82));
        reveal(E.restart, bv);
        E.restart.style.pointerEvents = bv > .6 ? 'auto' : 'none';
        E.restart.tabIndex = bv > .6 ? 0 : -1;
      }
    }
  }

  /* =======================================================
     VÒNG LẶP CHÍNH
     ======================================================= */
  let raf = 0, last = 0, T = 0;
  let us = 0, lastU = -1, snap = true;
  let maxScroll = 1;
  let pageVisible = true;

  const readScroll = function () { return window.pageYOffset || docEl.scrollTop || 0; };

  function request() { if (!raf) raf = requestAnimationFrame(frame); }

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(.05, (now - last) / 1000) : .016;
    last = now;

    const target = clamp(readScroll() / maxScroll);
    // Làm mượt u → "quán tính camera"; cuộn nhanh/ngược chỉ khiến u đuổi theo, không bao giờ nháy
    if (snap || REDUCED) { us = target; snap = false; }
    else {
      us += (target - us) * (1 - Math.exp(-dt * 10));
      if (Math.abs(target - us) < 2e-5) us = target;
    }

    if (us !== lastU) { lastU = us; update(us); }

    if (!REDUCED) {
      T += dt * stops(g, TSCALE);
      drawPetals(us * maxScroll, g, T);
    }

    if (!REDUCED && pageVisible && !document.hidden) request();
    else if (us !== target) request();
    else last = 0;
  }

  /* =======================================================
     RESIZE
     ======================================================= */
  // Tâm bông hoa chính trên màn hình (tính từ layout, không phụ thuộc transform đang chạy)
  function calcRoseCenter() {
    const w = E.roseWrap.offsetWidth, h = E.roseWrap.offsetHeight;
    roseC.x = E.roseWrap.offsetLeft + w / 2;
    roseC.y = E.roseWrap.offsetTop + h * (312 / 640);
  }

  function resize(force) {
    const w = window.innerWidth, h = window.innerHeight;
    maxScroll = Math.max(1, docEl.scrollHeight - h);
    const d = Math.min(window.devicePixelRatio || 1, 2);
    // Thanh địa chỉ điện thoại co/giãn chỉ đổi vài chục px → không dựng lại canvas
    if (force === true || w !== W || Math.abs(h - H) > 150 || d !== dpr) {
      W = w; H = h; dpr = d;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
      psScale = clamp(Math.min(W, H) / 720, .62, 1.15);
      calcRoseCenter();
      if (REDUCED) drawPetals(0, 0, 0, .26);       // reduced-motion: vẽ tĩnh một lần, ít cánh
      else drawPetals(us * maxScroll, g, T);
    }
    lastU = -1;
    request();
  }

  /* =======================================================
     KHỞI TẠO
     ======================================================= */
  function init() {
    docEl.classList.toggle('reduced', REDUCED);
    renderText();
    buildBouquet();
    decorateSprig();
    decoOpen = makeDeco(sceneEls[0], 'open2');
    decoC1 = makeDeco(sceneEls[4], 'c1');
    decoC2 = makeDeco(sceneEls[4], 'c2');
    buildPetals();
    resize(true);

    let rt = 0;
    window.addEventListener('resize', function () {
      if (rt) return;
      rt = requestAnimationFrame(function () { rt = 0; resize(); });
    }, { passive: true });
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('orientationchange', function () { setTimeout(function () { resize(true); }, 250); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { last = 0; request(); } });

    // Tạm dừng vòng lặp khi trang không còn trong khung nhìn (ví dụ nhúng iframe); không hỗ trợ → luôn chạy
    if ('IntersectionObserver' in window) {
      try {
        new IntersectionObserver(function (entries) {
          pageVisible = entries[0].isIntersecting;
          if (pageVisible) { last = 0; request(); }
        }).observe(scrollEl);
      } catch (e) { pageVisible = true; }
    }

    // Nút "Xem lại": mờ đi → về đầu trang → phát lại phần mở đầu
    E.restart.addEventListener('click', function () {
      stage.classList.add('fading');
      setTimeout(function () {
        window.scrollTo(0, 0);
        snap = true; lastU = -1;
        for (const k in cacheV) delete cacheV[k];
        roses.forEach(function (r) { r.last = -1; });
        ['oName', 'oSub'].forEach(function (id) {
          const el = $(id);
          el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
        });
        request();
        requestAnimationFrame(function () { stage.classList.remove('fading'); });
      }, REDUCED ? 0 : 600);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
