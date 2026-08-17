/* =========================================================
   Victor Paula — Portfolio
   Three.js "desk scene": a low-poly desk with a CRT monitor,
   camera fixed, looking straight at the screen. The REAL
   terminal window (#main-window — same DOM/CSS you already
   have, untouched) is transformed every frame with a CSS
   `matrix3d(...)` that exactly matches the screen mesh's own
   3D transform inside the WebGL scene, so it looks like your
   site is running "inside" the CRT — with genuine perspective/
   depth, not just a resized rectangle glued on top. No
   third-party CSS3DRenderer import, no iframes — a small
   inlined version of that same renderer's math (see
   getCameraCSSMatrix/getObjectCSSMatrix/updateScreenTransform
   below). Inspired by the camera-locked-on-a-screen trick used
   on henryheffernan.com, built from scratch with primitive
   geometries (no external 3D models).

   Progressive enhancement: if WebGL isn't available, or the
   user has prefers-reduced-motion on, or the viewport is too
   small for a desk to make sense (phones), this script does
   nothing and the site behaves exactly like before — the
   terminal window flows normally on the page.

   How to extend:
     - Everything that builds the scene lives in buildScene().
       Add your own THREE.Mesh objects to the returned group.
     - SCREEN_CONFIG controls the exact size/position of the
       "screen" the terminal window gets mapped onto — tweak
       those numbers to change how much of the viewport the
       screen takes up.
     - The scene, camera, renderer and screen mesh are exposed
       on `window.deskScene` for poking around in devtools.
   ========================================================= */

import * as THREE from 'three';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MIN_VIEWPORT_WIDTH = 920;
const MIN_VIEWPORT_HEIGHT = 560;

const canvas = document.getElementById('bg-canvas');
const windowEl = document.getElementById('main-window');
const screenOverlayEl = document.getElementById('screen-overlay');
const fullscreenBtn = document.getElementById('fullscreen-toggle');

/* Where #main-window and #screen-overlay originally live in the DOM
   (normal document flow), so teardownDeskScene() can put them back
   exactly where they came from when falling back to the non-3D
   layout (mobile viewport, WebGL unavailable, reduced motion isn't
   relevant here — only the desk-scene on/off toggle). Captured once,
   before three-scene.js ever moves anything. */
const windowHome = windowEl ? { parent: windowEl.parentNode, next: windowEl.nextSibling } : null;
const overlayHome = screenOverlayEl ? { parent: screenOverlayEl.parentNode, next: screenOverlayEl.nextSibling } : null;

/* CSS3D stage: a tiny hand-rolled equivalent of three.js's own
   CSS3DRenderer (same battle-tested technique/algorithm, just
   inlined for a single pair of DOM objects instead of a whole
   scene graph). Created lazily on first initDeskScene() call and
   reused across mode toggles. See updateScreenTransform() below for
   the actual math. */
let stageEl = null;
let cameraEl = null;

/* World-space size/position of the monitor's screen. The real
   .window element gets scaled+positioned in CSS pixels to match
   wherever this rectangle projects to on screen.
   z must stay ahead of the bezel/CRT-body front faces (z ≈ 0.25) —
   otherwise, now that the screen can go visibly black (power
   toggle), the white bezel would physically occlude it instead of
   showing black. */
const SCREEN_CONFIG = {
  width: 3.7,
  height: 2.2,
  position: new THREE.Vector3(0, 0.4, 0.3),
};

/* "Native" (untransformed) pixel size #main-window/#screen-overlay
   are laid out at — chosen close to --shell-max (900px) so text
   renders crisp at a normal reading resolution; the matrix3d
   transform then scales/rotates/perspective-projects that box to
   wherever it needs to appear on the CRT screen. Aspect ratio
   matches SCREEN_CONFIG so nothing gets stretched. */
const CSS3D_BOX = {
  width: 900,
  height: Math.round(900 * (SCREEN_CONFIG.height / SCREEN_CONFIG.width)),
};

// Scales the DOM elements' "native" CSS3D_BOX size down to the
// screen plane's actual size in Three.js world units, so the box
// that gets crisply laid out at ~900px wide ends up occupying
// exactly the same footprint as SCREEN_CONFIG once placed in the
// scene. Constant per screen size, so it's built once and reused.
// Declared up here (not next to updateScreenTransform(), where it's
// used) because the reduced-motion path can call that function
// synchronously during this initial module evaluation, before a
// module-level const declared further down the file would be
// initialized — that would throw a temporal-dead-zone ReferenceError.
const boxToWorldScale = new THREE.Matrix4().makeScale(
  SCREEN_CONFIG.width / CSS3D_BOX.width,
  SCREEN_CONFIG.height / CSS3D_BOX.height,
  1
);

let state = null; // holds everything needed to run/stop the scene

// Manual override: user clicked "tela cheia" to see the site outside
// the monitor confinement. evaluateMode() respects this and won't
// re-enter desk mode until they toggle it back.
let manualFullscreen = false;

if (canvas && windowEl && supportsWebGL()) {
  evaluateMode();
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(evaluateMode, 150);
  });
}

function supportsWebGL() {
  try {
    const test = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (test.getContext('webgl') || test.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

function shouldRunDeskScene() {
  return (
    window.innerWidth >= MIN_VIEWPORT_WIDTH &&
    window.innerHeight >= MIN_VIEWPORT_HEIGHT
  );
}

/* Turns the desk scene on/off depending on viewport size, so a
   window resized down to "mobile-ish" gracefully falls back to
   the normal in-flow layout, and back again if resized up. */
function evaluateMode() {
  const deskPossible = shouldRunDeskScene();
  const shouldRun = deskPossible && !manualFullscreen;
  if (shouldRun && !state) {
    state = initDeskScene();
  } else if (!shouldRun && state) {
    teardownDeskScene(state);
    state = null;
  } else if (shouldRun && state) {
    onResize(state);
  }
  updateFullscreenButton(deskPossible);
}

/* "Tela cheia": deixa o usuário sair da tela do monitor 3D e ver
   o portfólio por completo, como uma página normal. O botão só
   aparece quando o modo mesa 3D é geometricamente possível
   (senão não há "monitor" do qual sair). */
function updateFullscreenButton(deskPossible) {
  if (!fullscreenBtn) return;
  fullscreenBtn.hidden = !deskPossible;
  fullscreenBtn.textContent = manualFullscreen ? '⛶ voltar ao monitor' : '⛶ tela cheia';
  fullscreenBtn.setAttribute(
    'aria-label',
    manualFullscreen ? 'Voltar para a visão do monitor 3D' : 'Ver o portfólio em tela cheia'
  );
}

fullscreenBtn?.addEventListener('click', () => {
  manualFullscreen = !manualFullscreen;
  evaluateMode();
});

/* -----------------------------------------------------------
   Setup
----------------------------------------------------------- */
function initDeskScene() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    32,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  const basePosition = new THREE.Vector3(0, 1.1, 8.4);
  camera.position.copy(basePosition);
  camera.lookAt(0, 0.5, 0);

  const styles = getComputedStyle(document.documentElement);
  const colors = {
    amber: styles.getPropertyValue('--accent-amber').trim() || '#e6a23c',
    mint: styles.getPropertyValue('--accent-mint').trim() || '#7fd9c0',
    violet: styles.getPropertyValue('--accent-violet').trim() || '#b294f0',
    bgPanel: styles.getPropertyValue('--bg-panel').trim() || '#111417',
    bgTab: styles.getPropertyValue('--bg-tab').trim() || '#15181b',
  };

  const { group: deskGroup, screenMesh, led } = buildScene(colors);
  scene.add(deskGroup);

  const particles = createParticleField(colors);
  scene.add(particles);

  addLights(scene, colors);

  // Set up (or reuse) the CSS3D stage and move the real DOM elements
  // inside it. From this point on they're positioned purely via
  // `transform: matrix3d(...)`, computed every frame in
  // updateScreenTransform() to exactly match the screen mesh's own
  // 3D transform — not a 2D bounding box like before.
  if (!stageEl) {
    stageEl = document.createElement('div');
    stageEl.id = 'css3d-stage';
    cameraEl = document.createElement('div');
    cameraEl.id = 'css3d-camera';
    stageEl.appendChild(cameraEl);
  }
  document.body.appendChild(stageEl);
  cameraEl.appendChild(windowEl);
  windowEl.style.width = `${CSS3D_BOX.width}px`;
  windowEl.style.height = `${CSS3D_BOX.height}px`;
  if (screenOverlayEl) {
    cameraEl.appendChild(screenOverlayEl);
    screenOverlayEl.style.width = `${CSS3D_BOX.width}px`;
    screenOverlayEl.style.height = `${CSS3D_BOX.height}px`;
  }

  windowEl.classList.add('is-embedded', 'is-aligning');
  screenOverlayEl?.classList.add('is-active');
  document.body.classList.add('has-desk-scene');

  const clock = new THREE.Clock();
  let running = true;

  function handleVisibility() {
    running = document.visibilityState === 'visible';
    if (running && !prefersReducedMotion) s.rafId = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', handleVisibility);

  const pointer = { x: 0, y: 0 };
  function handlePointerMove(e) {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }
  if (!prefersReducedMotion) {
    window.addEventListener('pointermove', handlePointerMove);
  }

  // Screen power toggle — press "E" to turn the monitor off/on, like
  // flicking a real power switch. Off = quick CRT-style collapse
  // (bright flash -> shrinks to a thin line -> black) plus the
  // terminal fading out; power LED turns red. Ignored while typing
  // (input/textarea/contenteditable focused) so it never eats a
  // keystroke.
  let screenOn = true;
  function toggleScreenPower() {
    screenOn = !screenOn;
    led.material.color.set(screenOn ? colors.mint : '#5a1414');

    if (prefersReducedMotion) {
      // No animation loop running in this mode — just snap state.
      screenMesh.scale.y = screenOn ? 1 : 0.02;
      screenMesh.material.color.set(screenOn ? colors.bgPanel : '#020202');
      windowEl.classList.toggle('is-screen-off', !screenOn);
      screenOverlayEl?.classList.toggle('is-screen-off', !screenOn);
      return;
    }

    if (!screenOn) {
      // Turning off: bright flash, then the picture collapses to a
      // thin horizontal line and cuts to black — the tick loop keeps
      // re-projecting the shrinking screen onto the DOM terminal
      // every frame, so it visually collapses along with it.
      windowEl.classList.add('is-screen-off');
      screenOverlayEl?.classList.add('is-screen-off');
      screenMesh.material.color.set('#ffffff');
      tweenValue(1, 0.015, 260, (v) => { screenMesh.scale.y = v; }, () => {
        screenMesh.material.color.set('#020202');
      });
    } else {
      // Turning on: mirror image — a bright line expands back out.
      windowEl.classList.remove('is-screen-off');
      screenOverlayEl?.classList.remove('is-screen-off');
      screenMesh.material.color.set('#ffffff');
      tweenValue(screenMesh.scale.y, 1, 220, (v) => { screenMesh.scale.y = v; }, () => {
        screenMesh.material.color.set(colors.bgPanel);
      });
    }
  }
  function handleKeydown(e) {
    if (e.key.toLowerCase() !== 'e') return;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;
    toggleScreenPower();
  }
  window.addEventListener('keydown', handleKeydown);

  // `s` is declared before tick() and mutated in place (s.rafId = ...)
  // rather than reassigning a separate closure variable, so that
  // teardownDeskScene() always cancels the *current* pending frame —
  // not a stale id captured only once at startup.
  const s = {
    renderer, scene, camera, screenMesh, deskGroup,
    handlePointerMove, handleVisibility, handleKeydown, rafId: null,
  };

  let firstFrame = true;

  function revealAfterFirstFrame() {
    firstFrame = false;
    canvas.classList.add('is-ready');
    requestAnimationFrame(() => windowEl.classList.remove('is-aligning'));
  }

  function tick() {
    if (!running) return;
    const elapsed = clock.getElapsedTime();

    // Very subtle idle sway — small enough that the per-frame
    // screen-alignment recompute keeps the terminal glued on.
    camera.position.x = basePosition.x + Math.sin(elapsed * 0.25) * 0.05 + pointer.x * 0.06;
    camera.position.y = basePosition.y + Math.sin(elapsed * 0.4) * 0.03 - pointer.y * 0.03;
    camera.lookAt(0, 0.5, 0);

    particles.rotation.y = elapsed * 0.012;

    renderer.render(scene, camera);
    updateScreenTransform(camera, screenMesh, renderer, cameraEl, windowEl, screenOverlayEl);

    if (firstFrame) revealAfterFirstFrame();

    s.rafId = requestAnimationFrame(tick);
  }

  if (prefersReducedMotion) {
    // Accessibility: no continuous animation loop, no idle sway, no
    // mouse parallax — but we still render one static frame so the
    // scene is visible. Re-aligns on resize via onResize()/evaluateMode().
    renderer.render(scene, camera);
    updateScreenTransform(camera, screenMesh, renderer, cameraEl, windowEl, screenOverlayEl);
    revealAfterFirstFrame();
  } else {
    s.rafId = requestAnimationFrame(tick);
  }

  window.deskScene = s;
  return s;
}

function onResize(s) {
  s.camera.aspect = window.innerWidth / window.innerHeight;
  s.camera.updateProjectionMatrix();
  s.renderer.setSize(window.innerWidth, window.innerHeight);
  if (prefersReducedMotion) {
    // No render loop running in this mode — re-render the single
    // static frame manually so the desk/screen match the new size.
    s.renderer.render(s.scene, s.camera);
    updateScreenTransform(s.camera, s.screenMesh, s.renderer, cameraEl, windowEl, screenOverlayEl);
  }
}

function teardownDeskScene(s) {
  cancelAnimationFrame(s.rafId);
  window.removeEventListener('pointermove', s.handlePointerMove);
  window.removeEventListener('keydown', s.handleKeydown);
  document.removeEventListener('visibilitychange', s.handleVisibility);
  s.renderer.dispose();
  canvas.classList.remove('is-ready');
  windowEl.classList.remove('is-embedded', 'is-aligning');
  screenOverlayEl?.classList.remove('is-active');
  screenOverlayEl?.removeAttribute('style');
  windowEl.removeAttribute('style');
  document.body.classList.remove('has-desk-scene');

  // Move the real elements back to their original spot in the
  // document (normal in-flow layout) and take the empty CSS3D stage
  // out of the DOM until desk mode turns on again.
  if (windowHome) windowHome.parent.insertBefore(windowEl, windowHome.next);
  if (overlayHome && screenOverlayEl) overlayHome.parent.insertBefore(screenOverlayEl, overlayHome.next);
  stageEl?.remove();

  delete window.deskScene;
}

/* Minimal ease-out tween — used only for the screen power-toggle
   flash/collapse effect, so we don't need a full animation library. */
function tweenValue(from, to, duration, onUpdate, onDone) {
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - (1 - t) ** 3;
    onUpdate(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else if (onDone) onDone();
  }
  requestAnimationFrame(step);
}

/* -----------------------------------------------------------
   Screen alignment — the core trick.

   Earlier versions of this file projected the screen plane's 4
   corners into 2D and fit an axis-aligned CSS box (left/top/width/
   height) around them. That throws away perspective: whenever the
   camera isn't looking at the screen perfectly head-on (which it
   almost never is, thanks to the idle sway/parallax), the *real*
   screen projects to a trapezoid, not a rectangle — so the flat
   bounding box always looked slightly "pasted on top of" the CRT
   instead of sitting inside it, and the illusion broke the moment
   the screen turned back on.

   This version instead gives #main-window/#screen-overlay the exact
   same 3D transform (as a CSS `matrix3d`) that the screen mesh has
   inside the WebGL scene, using the same camera. It's the technique
   behind three.js's own CSS3DRenderer (see getCameraCSSMatrix /
   getObjectCSSMatrix below, which mirror that implementation almost
   verbatim) — reimplemented here directly for this one screen
   instead of pulling in a whole extra renderer for two elements.
   Because the DOM element now carries real perspective/rotation,
   not just a resized rectangle, it stays visually welded to the
   CRT's screen recess at any camera angle.
----------------------------------------------------------- */
function css3dEpsilon(value) {
  return Math.abs(value) < 1e-10 ? 0 : value;
}

// Camera matrix -> CSS matrix3d(). Rows 1/5/9/13 are negated to flip
// from Three.js's Y-up world space into CSS's Y-down pixel space.
function getCameraCSSMatrix(matrix) {
  const e = matrix.elements;
  return `matrix3d(${css3dEpsilon(e[0])},${css3dEpsilon(-e[1])},${css3dEpsilon(e[2])},${css3dEpsilon(e[3])},`
    + `${css3dEpsilon(e[4])},${css3dEpsilon(-e[5])},${css3dEpsilon(e[6])},${css3dEpsilon(e[7])},`
    + `${css3dEpsilon(e[8])},${css3dEpsilon(-e[9])},${css3dEpsilon(e[10])},${css3dEpsilon(e[11])},`
    + `${css3dEpsilon(e[12])},${css3dEpsilon(-e[13])},${css3dEpsilon(e[14])},${css3dEpsilon(e[15])})`;
}

// Object (screen plane) matrix -> CSS matrix3d(). Here it's the
// local Y *basis vector* (column 2, i.e. elements 4-7) that gets
// negated instead of a whole row — same Y-flip, applied the way
// three.js's CSS3DObject applies it for a child object rather than
// the camera rig. `translate(-50%,-50%)` recenters the element on
// its own transform origin first, since our DOM box (like the
// screen's PlaneGeometry) is centered on its position, not
// corner-anchored.
function getObjectCSSMatrix(matrix) {
  const e = matrix.elements;
  const m3d = `matrix3d(${css3dEpsilon(e[0])},${css3dEpsilon(e[1])},${css3dEpsilon(e[2])},${css3dEpsilon(e[3])},`
    + `${css3dEpsilon(-e[4])},${css3dEpsilon(-e[5])},${css3dEpsilon(-e[6])},${css3dEpsilon(-e[7])},`
    + `${css3dEpsilon(e[8])},${css3dEpsilon(e[9])},${css3dEpsilon(e[10])},${css3dEpsilon(e[11])},`
    + `${css3dEpsilon(e[12])},${css3dEpsilon(e[13])},${css3dEpsilon(e[14])},${css3dEpsilon(e[15])})`;
  return `translate(-50%,-50%)${m3d}`;
}

function updateScreenTransform(camera, screenMesh, renderer, stageCameraEl, el, overlayEl) {
  if (!stageCameraEl) return;

  const rect = renderer.domElement.getBoundingClientRect();
  const widthHalf = rect.width / 2;
  const heightHalf = rect.height / 2;

  // "Focal length" in CSS pixels, derived from the camera's actual
  // vertical FOV + the viewport height — same role as `perspective`
  // plays in CSS, so the DOM's perspective always matches the
  // WebGL camera's, even if the FOV or window size changes.
  const fov = camera.projectionMatrix.elements[5] * heightHalf;
  if (stageEl) stageEl.style.perspective = `${fov}px`;

  // Camera rig: push the whole CSS3D "world" out by `fov` px, apply
  // the camera's (inverse) transform, then recenter world-origin on
  // the viewport's middle — exactly mirroring three.js's
  // CSS3DRenderer.render().
  const cameraCSSMatrix = `translateZ(${fov}px)${getCameraCSSMatrix(camera.matrixWorldInverse)}`;
  stageCameraEl.style.transform = `${cameraCSSMatrix}translate(${widthHalf}px,${heightHalf}px)`;

  const objectMatrix = new THREE.Matrix4().multiplyMatrices(screenMesh.matrixWorld, boxToWorldScale);
  el.style.transform = getObjectCSSMatrix(objectMatrix);

  if (overlayEl) {
    // Nudge the overlay a hair towards the camera along world Z so
    // it reliably paints in front of the terminal content — inside
    // a shared `transform-style: preserve-3d` context, elements at
    // the exact same depth have undefined paint order.
    const overlayWorld = screenMesh.matrixWorld.clone();
    overlayWorld.elements[14] += 0.02;
    const overlayMatrix = overlayWorld.multiply(boxToWorldScale);
    overlayEl.style.transform = getObjectCSSMatrix(overlayMatrix);
  }
}

/* -----------------------------------------------------------
   Scene contents: desk, CRT monitor, screen, small decor.
   Everything below is built from primitive geometries.
----------------------------------------------------------- */
function buildScene(colors) {
  const group = new THREE.Group();

  const plasticDark = new THREE.MeshStandardMaterial({ color: '#0c0e10', roughness: 0.7, metalness: 0.1 });
  const plasticWhite = new THREE.MeshStandardMaterial({ color: '#d8cfb8', roughness: 0.6, metalness: 0.05 });
  const deskMat = new THREE.MeshStandardMaterial({ color: '#2a2016', roughness: 0.75, metalness: 0.05 });

  /* --- Desk --- */
  const desk = new THREE.Mesh(new THREE.BoxGeometry(9, 0.18, 4), deskMat);
  desk.position.set(0, -1.15, 0.4);
  group.add(desk);

  const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.7, 8);
  const legMat = new THREE.MeshStandardMaterial({ color: '#141618', roughness: 0.5, metalness: 0.4 });
  [[-4.2, -0.7, 1.6], [4.2, -0.7, 1.6], [-4.2, -0.7, -1.0], [4.2, -0.7, -1.0]].forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, y, z);
    group.add(leg);
  });

  /* --- Monitor: stand --- */
  const standBase = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.08, 24), plasticWhite);
  standBase.position.set(0, -1.02, 0.1);
  group.add(standBase);

  const standNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 12), plasticWhite);
  standNeck.position.set(0, -0.72, 0.1);
  group.add(standNeck);

  /* --- Monitor: CRT body (chunky back + flat front bezel), white
     "old computer" plastic — matches the keyboard's cream tone --- */
  const crtBack = new THREE.Mesh(new THREE.BoxGeometry(3.9, 2.7, 1.6), plasticWhite);
  crtBack.position.set(0, 0.55, -0.55);
  group.add(crtBack);

  const bezelFront = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.9, 0.22), plasticWhite);
  bezelFront.position.set(0, 0.55, 0.14);
  group.add(bezelFront);

  const screenRecess = new THREE.Mesh(
    new THREE.BoxGeometry(SCREEN_CONFIG.width + 0.14, SCREEN_CONFIG.height + 0.14, 0.06),
    plasticDark
  );
  screenRecess.position.set(SCREEN_CONFIG.position.x, SCREEN_CONFIG.position.y, 0.2);
  group.add(screenRecess);

  // The actual "screen" — kept as a plain dark plane. The real DOM
  // terminal window is aligned on top of this every frame.
  const screenMat = new THREE.MeshBasicMaterial({ color: colors.bgPanel });
  const screenGeo = new THREE.PlaneGeometry(SCREEN_CONFIG.width, SCREEN_CONFIG.height);
  const screenMesh = new THREE.Mesh(screenGeo, screenMat);
  screenMesh.position.copy(SCREEN_CONFIG.position);
  group.add(screenMesh);

  // Small power LED for character — swaps color when the screen is
  // toggled off/on (see toggleScreenPower() below).
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 8, 8),
    new THREE.MeshBasicMaterial({ color: colors.mint })
  );
  led.position.set(0, -0.75, 0.26);
  group.add(led);

  /* --- Keyboard: chunky "beige 80s" model --- */
  const kbBeige = new THREE.MeshStandardMaterial({ color: '#d8cfb8', roughness: 0.65, metalness: 0.05 });
  const kbKeyMat = new THREE.MeshStandardMaterial({ color: '#efe9d8', roughness: 0.55, metalness: 0.05 });
  const keyboardGroup = new THREE.Group();
  keyboardGroup.position.set(0, -1.0, 1.55);
  keyboardGroup.rotation.x = -0.05;
  group.add(keyboardGroup);

  // Wedge-shaped body (taller at the back), classic period silhouette.
  const kbBody = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 0.95), kbBeige);
  kbBody.position.set(0, -0.03, 0);
  kbBody.rotation.x = -0.03;
  keyboardGroup.add(kbBody);

  // Individual keycaps via InstancedMesh (cheap: one draw call for ~60 keys).
  const KEY_COLS = 14;
  const KEY_ROWS = 4;
  const keyGeo = new THREE.BoxGeometry(0.135, 0.06, 0.135);
  const keys = new THREE.InstancedMesh(keyGeo, kbKeyMat, KEY_COLS * KEY_ROWS);
  const dummy = new THREE.Object3D();
  let ki = 0;
  for (let r = 0; r < KEY_ROWS; r += 1) {
    for (let c = 0; c < KEY_COLS; c += 1) {
      dummy.position.set(-1.12 + c * 0.172, 0.09, -0.28 + r * 0.19);
      dummy.updateMatrix();
      keys.setMatrixAt(ki, dummy.matrix);
      ki += 1;
    }
  }
  keys.instanceMatrix.needsUpdate = true;
  keyboardGroup.add(keys);

  // Detached spacebar, front-and-center like a real 80s layout.
  const spacebar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.14), kbKeyMat);
  spacebar.position.set(-0.1, 0.09, 0.48);
  keyboardGroup.add(spacebar);

  /* --- Mouse: same white plastic as the monitor/keyboard --- */
  const mouse = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.15, 4, 8), plasticWhite);
  mouse.rotation.z = Math.PI / 2;
  mouse.position.set(1.55, -0.98, 1.55);
  group.add(mouse);

  /* --- Mug --- */
  const mugMat = new THREE.MeshStandardMaterial({ color: colors.amber, roughness: 0.4 });
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.32, 16), mugMat);
  mug.position.set(-2.9, -0.9, 1.3);
  group.add(mug);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 8, 16, Math.PI), mugMat);
  handle.position.set(-2.72, -0.9, 1.3);
  handle.rotation.y = Math.PI / 2;
  group.add(handle);

  /* --- Small plant --- */
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.18, 0.28, 12),
    new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.8 })
  );
  pot.position.set(3.1, -0.87, 0.9);
  group.add(pot);
  const foliage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34, 0),
    new THREE.MeshStandardMaterial({ color: colors.mint, roughness: 0.6, flatShading: true })
  );
  foliage.position.set(3.1, -0.5, 0.9);
  group.add(foliage);

  /* --- Small book/paper stack --- */
  const bookColors = [colors.violet, colors.amber];
  for (let i = 0; i < 2; i += 1) {
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.06, 0.4),
      new THREE.MeshStandardMaterial({ color: bookColors[i], roughness: 0.7 })
    );
    book.position.set(2.7, -1.03 + i * 0.07, 1.55);
    book.rotation.y = i * 0.15;
    group.add(book);
  }

  /* --- Desk lamp: retro Nordic style — wood stem/base + white
     swivel/shade. Built as a small kinematic chain (base -> stem ->
     pivot -> arm -> shade), where each piece is a child of the
     previous one — so they're guaranteed to stay physically attached
     instead of floating apart at hand-tuned world coordinates. --- */
  const lampWood = new THREE.MeshStandardMaterial({ color: '#c9a06a', roughness: 0.7, metalness: 0.05 });
  const lampWhite = new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.45, metalness: 0.1 });

  const lampGroup = new THREE.Group();
  lampGroup.position.set(-3.4, -1.03, -0.4);
  group.add(lampGroup);

  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.06, 24), lampWood);
  lampBase.position.y = 0.03;
  lampGroup.add(lampBase);

  const STEM_H = 0.75;
  const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, STEM_H, 12), lampWood);
  lampStem.position.y = 0.06 + STEM_H / 2;
  lampGroup.add(lampStem);

  const swivel = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 14), lampWhite);
  swivel.position.y = 0.06 + STEM_H;
  lampGroup.add(swivel);

  // Everything below hangs off armGroup, pivoted at the swivel ball
  // and tilted toward the monitor — arm, collar, shade and bulb are
  // all positioned along its local +Y axis, so rotating armGroup
  // moves the whole assembly together as one rigid piece.
  const armGroup = new THREE.Group();
  armGroup.position.y = 0.06 + STEM_H;
  armGroup.rotation.z = -1.0;
  lampGroup.add(armGroup);

  const ARM_L = 0.6;
  const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, ARM_L, 12), lampWood);
  lampArm.position.y = ARM_L / 2;
  armGroup.add(lampArm);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 14), lampWhite);
  collar.position.y = ARM_L;
  armGroup.add(collar);

  // Cone's apex points up its local +Y by default, which is exactly
  // the direction back toward the collar — so no extra flip needed,
  // just a slight overlap with the arm so there's no visible gap.
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.3, 22, 1, true), lampWhite);
  lampShade.position.y = ARM_L + 0.05;
  lampShade.rotation.z = 0.5;
  armGroup.add(lampShade);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 12),
    new THREE.MeshBasicMaterial({ color: colors.amber })
  );
  bulb.position.y = ARM_L - 0.05;
  armGroup.add(bulb);

  return { group, screenMesh, led };
}

function addLights(scene, colors) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  const lampLight = new THREE.PointLight(colors.amber, 3.6, 6, 2);
  lampLight.position.set(-2.85, 0.13, -0.32);
  scene.add(lampLight);

  const rimLight = new THREE.PointLight(colors.violet, 1.4, 10, 2);
  rimLight.position.set(3.5, 1.5, -3);
  scene.add(rimLight);

  const fill = new THREE.PointLight(colors.mint, 0.6, 10, 2);
  fill.position.set(0, 2, 4);
  scene.add(fill);
}

/* -----------------------------------------------------------
   Ambient particle field behind the desk, for depth/atmosphere.
----------------------------------------------------------- */
function createParticleField(colors) {
  const COUNT = 260;
  const positions = new Float32Array(COUNT * 3);
  const paletteHex = [colors.amber, colors.mint, colors.violet];
  const colorArray = new Float32Array(COUNT * 3);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < COUNT; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 24;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 12 + 1;
    positions[i * 3 + 2] = -6 - Math.random() * 10;

    tmpColor.set(paletteHex[i % paletteHex.length]);
    colorArray[i * 3] = tmpColor.r;
    colorArray[i * 3 + 1] = tmpColor.g;
    colorArray[i * 3 + 2] = tmpColor.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

  const material = new THREE.PointsMaterial({
    size: 0.05,
    vertexColors: true,
    transparent: true,
    opacity: 0.4,
    sizeAttenuation: true,
  });

  return new THREE.Points(geometry, material);
}