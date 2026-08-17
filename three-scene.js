/* =========================================================
   Victor Paula — Portfolio
   Three.js "desk scene": a low-poly desk with a CRT monitor,
   camera fixed, looking straight at the screen. The REAL
   terminal window (#main-window — same DOM/CSS you already
   have, untouched) is repositioned every frame to sit exactly
   on top of the monitor's screen, so it looks like your site
   is running "inside" the CRT. No CSS3DRenderer, no iframes —
   just projecting the screen's 3D corners into 2D pixels and
   sizing a normal HTML element to match. Inspired by the
   camera-locked-on-a-screen trick used on henryheffernan.com,
   built from scratch with primitive geometries (no external
   3D models).

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

/* World-space size/position of the monitor's screen. The real
   .window element gets scaled+positioned in CSS pixels to match
   wherever this rectangle projects to on screen.
   z must stay ahead of the bezel/CRT-body front faces (z ≈ 0.25) —
   otherwise, now that the screen can go visibly black (power
   toggle), the white bezel would physically occlude it instead of
   showing black. */
const SCREEN_CONFIG = {
  width: 3.7,
  height: 2.5,
  position: new THREE.Vector3(0, 0.55, 0.3),
};

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
    updateScreenAlignment(camera, screenMesh, renderer, windowEl, screenOverlayEl);

    if (firstFrame) revealAfterFirstFrame();

    s.rafId = requestAnimationFrame(tick);
  }

  if (prefersReducedMotion) {
    // Accessibility: no continuous animation loop, no idle sway, no
    // mouse parallax — but we still render one static frame so the
    // scene is visible. Re-aligns on resize via onResize()/evaluateMode().
    renderer.render(scene, camera);
    updateScreenAlignment(camera, screenMesh, renderer, windowEl, screenOverlayEl);
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
    updateScreenAlignment(s.camera, s.screenMesh, s.renderer, windowEl, screenOverlayEl);
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
   Projects the 4 corners of the screen plane into CSS pixels
   and resizes/positions the real .window element to match.
----------------------------------------------------------- */
function updateScreenAlignment(camera, screenMesh, renderer, el, overlayEl) {
  // Local (not module-level) on purpose: this function can run
  // synchronously during initial module evaluation (reduced-motion
  // static-frame path), before a module-level const declared further
  // down the file would be initialized — a module-level singleton
  // here would throw a temporal-dead-zone ReferenceError in that path.
  const corner = new THREE.Vector3();

  const w = SCREEN_CONFIG.width / 2;
  const h = SCREEN_CONFIG.height / 2;
  const localCorners = [
    [-w, -h], [w, -h], [w, h], [-w, h],
  ];

  const rect = renderer.domElement.getBoundingClientRect();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const [cx, cy] of localCorners) {
    corner.set(cx, cy, 0).applyMatrix4(screenMesh.matrixWorld);
    corner.project(camera);
    const px = rect.left + (corner.x * 0.5 + 0.5) * rect.width;
    const py = rect.top + (1 - (corner.y * 0.5 + 0.5)) * rect.height;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }

  el.style.left = `${minX}px`;
  el.style.top = `${minY}px`;
  el.style.width = `${maxX - minX}px`;
  el.style.height = `${maxY - minY}px`;

  // The scanline overlay mirrors the exact same rect — it's a
  // separate element (not a child of #main-window) so it can sit
  // visually *above* the terminal content without interfering with
  // its own stacking/scroll.
  if (overlayEl) {
    overlayEl.style.left = el.style.left;
    overlayEl.style.top = el.style.top;
    overlayEl.style.width = el.style.width;
    overlayEl.style.height = el.style.height;
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
  screenRecess.position.set(0, 0.55, 0.2);
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