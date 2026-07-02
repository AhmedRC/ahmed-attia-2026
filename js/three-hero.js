/* ============================================================
   WebGL hero — a parametric truss arch bridge that "constructs"
   itself line by line, floating over a fading blueprint grid.
   Colors from the design system: navy #0e2238 / gold #c9a227.
   Degrades gracefully: no WebGL / reduced motion → static bg.
   ============================================================ */
(function () {
  var canvas = document.getElementById('heroCanvas');
  if (!canvas || typeof THREE === 'undefined') return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  } catch (e) { return; }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  var scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0e2238, 60, 190);

  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
  camera.position.set(0, 9, 62);

  var GOLD = 0xc9a227;
  var GOLD_LIGHT = 0xe3c563;
  var STEEL = 0x8fa6bc;

  var world = new THREE.Group();
  scene.add(world);
  world.position.set(12, -2, 0);
  world.rotation.y = -0.5;

  /* ---------- Build the truss arch bridge ---------- */
  var span = 84, panels = 14, deckY = 0, archH = 16;
  var half = span / 2;
  var deckPts = [], archPts = [];
  for (var i = 0; i <= panels; i++) {
    var x = -half + (span * i) / panels;
    var t = x / half;                       // -1..1
    var y = archH * (1 - t * t);            // parabolic arch
    deckPts.push(new THREE.Vector3(x, deckY, 0));
    archPts.push(new THREE.Vector3(x, y, 0));
  }

  // Ordered segment list — order = construction sequence
  var segs = [];
  function seg(a, b) { segs.push(a.x, a.y, a.z, b.x, b.y, b.z); }

  var z;
  var depth = 7; // two truss planes at ±depth/2
  [ -depth / 2, depth / 2 ].forEach(function (zz) {
    z = zz;
    // deck chord
    for (var i = 0; i < panels; i++)
      seg(new THREE.Vector3(deckPts[i].x, deckY, z), new THREE.Vector3(deckPts[i + 1].x, deckY, z));
    // arch chord
    for (i = 0; i < panels; i++)
      seg(new THREE.Vector3(archPts[i].x, archPts[i].y, z), new THREE.Vector3(archPts[i + 1].x, archPts[i + 1].y, z));
    // verticals + diagonals
    for (i = 1; i < panels; i++) {
      seg(new THREE.Vector3(deckPts[i].x, deckY, z), new THREE.Vector3(archPts[i].x, archPts[i].y, z));
      if (i < panels)
        seg(new THREE.Vector3(deckPts[i].x, deckY, z), new THREE.Vector3(archPts[i - 1].x, archPts[i - 1].y, z));
    }
  });
  // cross bracing between the two planes
  for (i = 0; i <= panels; i += 2) {
    seg(new THREE.Vector3(deckPts[i].x, deckY, -depth / 2), new THREE.Vector3(deckPts[i].x, deckY, depth / 2));
    seg(new THREE.Vector3(archPts[i].x, archPts[i].y, -depth / 2), new THREE.Vector3(archPts[i].x, archPts[i].y, depth / 2));
  }
  // piers
  [ -half, half ].forEach(function (px) {
    [ -depth / 2, depth / 2 ].forEach(function (pz) {
      seg(new THREE.Vector3(px, deckY, pz), new THREE.Vector3(px, -12, pz));
    });
  });

  var bridgeGeo = new THREE.BufferGeometry();
  bridgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  var totalVerts = segs.length / 3;
  bridgeGeo.setDrawRange(0, reduceMotion ? totalVerts : 0);

  var bridge = new THREE.LineSegments(
    bridgeGeo,
    new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85 })
  );
  world.add(bridge);

  /* ---------- Glowing nodes ---------- */
  var nodeArr = [];
  [ -depth / 2, depth / 2 ].forEach(function (zz) {
    for (var i = 0; i <= panels; i++) {
      nodeArr.push(deckPts[i].x, deckY, zz);
      nodeArr.push(archPts[i].x, archPts[i].y, zz);
    }
  });
  var nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodeArr, 3));
  var nodes = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
    color: GOLD_LIGHT, size: 0.9, transparent: true, opacity: 0.9, sizeAttenuation: true
  }));
  world.add(nodes);

  /* ---------- Ground grid (blueprint floor) ---------- */
  var grid = new THREE.GridHelper(320, 46, GOLD, 0x1b3f63);
  grid.material.transparent = true;
  grid.material.opacity = 0.16;
  grid.position.y = -12;
  scene.add(grid);

  /* ---------- Dust / particle field ---------- */
  var pCount = 420, pArr = [];
  for (i = 0; i < pCount; i++) {
    pArr.push((Math.random() - 0.5) * 220, Math.random() * 70 - 14, (Math.random() - 0.5) * 160);
  }
  var pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.Float32BufferAttribute(pArr, 3));
  var particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: STEEL, size: 0.45, transparent: true, opacity: 0.5, sizeAttenuation: true
  }));
  scene.add(particles);

  /* ---------- Sizing ---------- */
  function resize() {
    var w = canvas.clientWidth || canvas.parentElement.clientWidth;
    var h = canvas.clientHeight || canvas.parentElement.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  /* ---------- Interaction ---------- */
  var mouseX = 0, mouseY = 0, scrollN = 0;
  window.addEventListener('pointermove', function (e) {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });
  window.addEventListener('scroll', function () {
    var h = window.innerHeight || 1;
    scrollN = Math.min(window.scrollY / h, 1);
  }, { passive: true });

  /* ---------- Animation loop ---------- */
  var clock = new THREE.Clock();
  var drawn = 0;
  var buildDelay = 0.6; // seconds before construction starts

  function animate() {
    requestAnimationFrame(animate);
    var t = clock.getElapsedTime();

    // Construction draw-in (2 verts per segment, keep it even)
    if (!reduceMotion && drawn < totalVerts && t > buildDelay) {
      drawn = Math.min(totalVerts, drawn + Math.max(2, Math.round(totalVerts / 240)) * 2);
      bridgeGeo.setDrawRange(0, drawn);
    }

    // Idle motion
    var idle = reduceMotion ? 0 : 1;
    world.rotation.y = -0.5 + Math.sin(t * 0.12) * 0.16 * idle + mouseX * 0.07;
    world.rotation.x = Math.sin(t * 0.09) * 0.03 * idle + mouseY * 0.04;
    world.position.y = -2 + Math.sin(t * 0.5) * 0.5 * idle;

    nodes.material.opacity = 0.55 + Math.sin(t * 2.2) * 0.35;
    particles.rotation.y = t * 0.014 * idle;

    // Scroll: pull camera up & fade the scene out gently
    camera.position.y = 9 + scrollN * 16;
    camera.position.z = 62 + scrollN * 18;
    camera.lookAt(12, 4 - scrollN * 6, 0);

    renderer.render(scene, camera);
  }
  animate();
})();
