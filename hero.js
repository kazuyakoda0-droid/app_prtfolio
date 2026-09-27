(() => {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Scenes ---------- */
  const SCENES = [
    { name: 'MORNING', amount: 0, colors: ['#1b313b', '#8fb3c3', '#eef5f7'], dark: false },
    { name: 'DUSK', amount: .88, colors: ['#2a1b38', '#c46f86', '#ffe6cf'], dark: false },
    { name: 'NIGHT', amount: 1, colors: ['#02060d', '#12294a', '#6f95bf'], dark: true },
    { name: 'SILVER', amount: 1, colors: ['#1c1d1f', '#8e9194', '#f3f2ee'], dark: false }
  ];
  const TRANSITION_MS = 1500;
  const AUTO_MS = 7000;

  const imageLayer = hero.querySelector('.hero-image');
  const sceneButtons = [...hero.querySelectorAll('.scene-switch button')];
  const sceneName = hero.querySelector('.scene-name');

  let from = 0;
  let target = 0;
  let progress = 1;
  let transitionStart = 0;
  let autoTimer = 0;
  let heroVisible = true;

  function goTo(index) {
    index = ((index % SCENES.length) + SCENES.length) % SCENES.length;
    if (index === target) return;
    from = progress < .5 ? from : target;
    target = index;
    progress = reduceMotion ? 1 : 0;
    transitionStart = performance.now();
    const scene = SCENES[index];
    hero.dataset.scene = scene.name.toLowerCase();
    hero.classList.toggle('is-dark', scene.dark);
    sceneButtons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.scene) === index)));
    if (sceneName) sceneName.textContent = `${String(index + 1).padStart(2, '0')} ${scene.name}`;
    requestRender();
    scheduleAuto();
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (reduceMotion) return;
    autoTimer = setTimeout(() => {
      if (heroVisible && !document.hidden) goTo(target + 1);
      else scheduleAuto();
    }, AUTO_MS);
  }

  hero.querySelectorAll('.hero-nav a[data-scene]').forEach((link) => {
    const show = () => goTo(Number(link.dataset.scene));
    link.addEventListener('pointerenter', show);
    link.addEventListener('focus', show);
  });
  sceneButtons.forEach((button) => button.addEventListener('click', () => goTo(Number(button.dataset.scene))));

  /* ---------- WebGL background ---------- */
  const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

  const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uRes, uImg, uMouse, uFocus;
uniform float uTime, uProg, uHover, uAmtA, uAmtB;
uniform vec3 uA0, uA1, uA2, uB0, uB1, uB2;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= .5; } return v; }
vec2 cover(vec2 uv){
  float rs = uRes.x / uRes.y, ri = uImg.x / uImg.y;
  vec2 s = rs < ri ? vec2(rs / ri, 1.) : vec2(1., ri / rs);
  s /= 1.04;
  return (uv - .5) * s + .5 + (1. - s) * (uFocus - .5);
}
vec3 grade(vec3 c, vec3 c0, vec3 c1, vec3 c2, float amt){
  float l = dot(c, vec3(.299, .587, .114));
  vec3 g = l < .5 ? mix(c0, c1, l * 2.) : mix(c1, c2, l * 2. - 1.);
  return mix(c, g, amt);
}
void main(){
  vec2 uv = vUv;
  vec2 aspect = vec2(uRes.x / uRes.y, 1.);
  vec2 drift = vec2(fbm(uv * 2. + vec2(uTime * .03, 0.)), fbm(uv * 2. + vec2(0., uTime * .03) + 4.)) - .5;
  vec2 md = (uv - uMouse) * aspect;
  float lens = exp(-dot(md, md) * 7.);
  vec2 base = uv + drift * .014 - md * lens * .05 * uHover;

  float e = clamp((fbm(uv * 3. + 11.) - .2) / .6, 0., 1.) * .6 + uv.y * .4;
  float w = .24;
  float k = clamp((uProg * (1. + w) - e) / w, 0., 1.);
  float edge = sin(k * 3.14159);
  vec2 dir = drift * 2.4;

  vec3 a = texture2D(uTex, cover(base + dir * k * .14)).rgb;
  vec3 b = texture2D(uTex, cover(base - dir * (1. - k) * .14)).rgb;
  a = grade(a, uA0, uA1, uA2, uAmtA);
  b = grade(b, uB0, uB1, uB2, uAmtB);
  vec3 col = mix(a, b, k) + edge * .09;
  gl_FragColor = vec4(col, 1.);
}`;

  let gl = null;
  let program = null;
  let uniforms = {};
  let imgSize = [1, 1];
  let running = false;
  let rafId = 0;
  const mouse = { x: .5, y: .5, tx: .5, ty: .5, hover: 0, thover: 0 };
  const startTime = performance.now();

  const hexToVec = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

  function initGL() {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    } catch (err) {
      console.warn('Hero background falls back to CSS:', err);
      gl = null;
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    ['uTex', 'uRes', 'uImg', 'uMouse', 'uFocus', 'uTime', 'uProg', 'uHover', 'uAmtA', 'uAmtB',
      'uA0', 'uA1', 'uA2', 'uB0', 'uB1', 'uB2'].forEach((name) => { uniforms[name] = gl.getUniformLocation(program, name); });

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      imgSize = [img.naturalWidth, img.naturalHeight];
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      } catch (err) {
        console.warn('Hero background falls back to CSS:', err);
        gl = null;
        return;
      }
      gl.uniform1i(uniforms.uTex, 0);
      imageLayer.appendChild(canvas);
      resize();
      imageLayer.classList.add('is-gl');
      requestRender();
    };
    img.src = './images/hero-seascape.webp';

    hero.addEventListener('pointermove', (event) => {
      const rect = hero.getBoundingClientRect();
      mouse.tx = (event.clientX - rect.left) / rect.width;
      mouse.ty = 1 - (event.clientY - rect.top) / rect.height;
      mouse.thover = event.pointerType === 'touch' ? 0 : 1;
      requestRender();
    });
    hero.addEventListener('pointerleave', () => { mouse.thover = 0; requestRender(); });
    addEventListener('resize', resize);
  }

  function resize() {
    if (!gl) return;
    const canvas = gl.canvas;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(hero.clientWidth * dpr);
    canvas.height = Math.round(hero.clientHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    requestRender();
  }

  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function frame(now) {
    rafId = 0;
    if (progress < 1) progress = Math.min(1, (now - transitionStart) / TRANSITION_MS);
    mouse.x += (mouse.tx - mouse.x) * .06;
    mouse.y += (mouse.ty - mouse.y) * .06;
    mouse.hover += (mouse.thover - mouse.hover) * .05;

    if (gl && imageLayer.classList.contains('is-gl')) {
      const a = SCENES[from];
      const b = SCENES[target];
      const narrow = hero.clientWidth < 760;
      gl.uniform2f(uniforms.uRes, gl.canvas.width, gl.canvas.height);
      gl.uniform2f(uniforms.uImg, imgSize[0], imgSize[1]);
      gl.uniform2f(uniforms.uMouse, mouse.x, mouse.y);
      gl.uniform2f(uniforms.uFocus, narrow ? .61 : .5, .5);
      gl.uniform1f(uniforms.uTime, reduceMotion ? 0 : (now - startTime) / 1000);
      gl.uniform1f(uniforms.uProg, ease(progress));
      gl.uniform1f(uniforms.uHover, reduceMotion ? 0 : mouse.hover);
      gl.uniform1f(uniforms.uAmtA, a.amount);
      gl.uniform1f(uniforms.uAmtB, b.amount);
      ['uA0', 'uA1', 'uA2'].forEach((u, i) => gl.uniform3fv(uniforms[u], hexToVec(a.colors[i])));
      ['uB0', 'uB1', 'uB2'].forEach((u, i) => gl.uniform3fv(uniforms[u], hexToVec(b.colors[i])));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (running && !reduceMotion) requestRender();
  }

  function requestRender() {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  new IntersectionObserver(([entry]) => {
    heroVisible = entry.isIntersecting;
    running = heroVisible;
    if (running) requestRender();
  }).observe(hero);

  initGL();
  scheduleAuto();

  /* ---------- Morphing logo ---------- */
  const VARIANTS = ['v-gothic', 'v-dot', 'v-reggae', 'v-rampart', 'v-brush', 'v-outline', 'v-stretch', 'v-squash', 'v-slant', 'v-flip', 'v-drop'];
  const svgNS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(svgNS, 'svg');
  defs.setAttribute('width', '0');
  defs.setAttribute('height', '0');
  defs.setAttribute('aria-hidden', 'true');
  defs.style.position = 'absolute';
  document.body.appendChild(defs);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  document.querySelectorAll('[data-morph]').forEach((el, n) => {
    const maxWarp = Number(el.dataset.warp || 12);
    const isHeroLogo = hero.contains(el) && el.closest('h1');
    const trigger = (el.dataset.morphTrigger && el.closest(el.dataset.morphTrigger)) || el;
    if (/^H\d$/.test(el.tagName)) el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());

    // Wrap every visible character in its own span, keeping <em>, <br> etc. in place.
    const chars = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      const frag = document.createDocumentFragment();
      [...node.textContent].forEach((ch) => {
        if (/\s/.test(ch)) { frag.appendChild(document.createTextNode(ch)); return; }
        const span = document.createElement('span');
        span.className = 'mc';
        span.textContent = ch;
        frag.appendChild(span);
        chars.push(span);
      });
      node.replaceWith(frag);
    });
    if (!chars.length) return;

    // Lock each glyph to its resting width so font swaps don't shake the line.
    const lockWidths = () => {
      const size = parseFloat(getComputedStyle(el).fontSize) || 16;
      chars.forEach((c) => { c.style.width = ''; });
      chars.forEach((c) => { c.style.width = `${c.getBoundingClientRect().width / size}em`; });
    };
    lockWidths();
    if (document.fonts) document.fonts.ready.then(lockWidths);

    const filterId = `morph-warp-${n}`;
    const filter = document.createElementNS(svgNS, 'filter');
    filter.id = filterId;
    ['x', 'y'].forEach((k) => filter.setAttribute(k, '-20%'));
    ['width', 'height'].forEach((k) => filter.setAttribute(k, '140%'));
    const turbulence = document.createElementNS(svgNS, 'feTurbulence');
    turbulence.setAttribute('type', 'fractalNoise');
    turbulence.setAttribute('numOctaves', '2');
    turbulence.setAttribute('result', 'noise');
    const displace = document.createElementNS(svgNS, 'feDisplacementMap');
    displace.setAttribute('in', 'SourceGraphic');
    displace.setAttribute('in2', 'noise');
    displace.setAttribute('xChannelSelector', 'R');
    displace.setAttribute('yChannelSelector', 'G');
    displace.setAttribute('scale', '0');
    filter.append(turbulence, displace);
    defs.appendChild(filter);

    if (reduceMotion) return;

    let pointerInside = false;
    let burstUntil = 0;
    let hovering = false;
    let energy = 0;
    let lastSwap = 0;
    let lastTick = 0;
    let loop = 0;
    const setVariant = (c, v) => {
      c.classList.remove(...VARIANTS);
      if (v) c.classList.add(v);
    };

    const tick = (now) => {
      hovering = pointerInside || now < burstUntil;
      const dt = Math.min(.5, lastTick ? (now - lastTick) / 1000 : .016);
      lastTick = now;
      energy += ((hovering ? 1 : 0) - energy) * (1 - Math.exp(-dt * (hovering ? 7 : 4.5)));
      if (hovering && now - lastSwap > 70 + Math.random() * 60) {
        lastSwap = now;
        const count = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) setVariant(pick(chars), Math.random() < .2 ? null : pick(VARIANTS));
      } else if (!hovering && now - lastSwap > 55) {
        lastSwap = now;
        const morphed = chars.filter((c) => VARIANTS.some((v) => c.classList.contains(v)));
        if (morphed.length) setVariant(pick(morphed), null);
      }
      const t = now / 1000;
      turbulence.setAttribute('baseFrequency', `${(.012 + Math.sin(t * 3) * .004).toFixed(4)} ${(.05 + Math.cos(t * 2.3) * .015).toFixed(4)}`);
      turbulence.setAttribute('seed', String(Math.floor(t * 12) % 50));
      displace.setAttribute('scale', (energy * maxWarp * (.75 + Math.random() * .5)).toFixed(2));

      const settled = !hovering && now >= burstUntil && energy < .03 && !chars.some((c) => VARIANTS.some((v) => c.classList.contains(v)));
      if (settled) {
        el.style.filter = '';
        displace.setAttribute('scale', '0');
        loop = 0;
        lastTick = 0;
        return;
      }
      loop = requestAnimationFrame(tick);
    };

    const start = () => {
      el.style.filter = `url(#${filterId})`;
      if (!loop) loop = requestAnimationFrame(tick);
    };

    const burst = (ms) => {
      burstUntil = Math.max(burstUntil, performance.now() + ms);
      start();
    };

    trigger.addEventListener('pointerenter', (event) => {
      if (isHeroLogo) goTo(target + 1);
      if (event.pointerType === 'touch') { burst(900); return; }
      pointerInside = true;
      start();
    });
    trigger.addEventListener('pointerleave', () => { pointerInside = false; });

    // Sections further down the page twitch once as they scroll into view.
    if (!isHeroLogo) {
      new IntersectionObserver((entries) => {
        entries.forEach((entry) => { if (entry.isIntersecting) burst(650); });
      }, { threshold: .6 }).observe(el);
    }

    // Idle flicker: now and then one glyph briefly changes shape.
    const idle = () => {
      setTimeout(() => {
        if (!hovering && !document.hidden && (!isHeroLogo || heroVisible)) {
          const c = pick(chars);
          setVariant(c, pick(VARIANTS));
          setTimeout(() => { if (!hovering) setVariant(c, null); }, 160 + Math.random() * 160);
        }
        idle();
      }, 2600 + Math.random() * 3200);
    };
    if (isHeroLogo) idle();
  });
})();
