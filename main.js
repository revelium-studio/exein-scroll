(function () {
  "use strict";

  // ─── Smooth Scrolling (Lenis) ───────────────────────────────
  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smooth: true,
  });

  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  // ─── Three.js Setup ─────────────────────────────────────────
  const canvas = document.getElementById("webgl");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    stencil: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 5);
  scene.add(camera);

  // ─── Video Texture ──────────────────────────────────────────
  const video = document.createElement("video");
  video.src = "video/Exein_3D_Texture_White.mp4";
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.play().catch(function () {
    document.addEventListener("click", function () { video.play(); }, { once: true });
  });

  const videoTexture = new THREE.VideoTexture(video);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.format = THREE.RGBAFormat;
  videoTexture.encoding = THREE.sRGBEncoding;

  // ─── Hexagonal Prism Geometry ───────────────────────────────
  var hexRadius = 1.0;
  var hexDepth = 1.0;
  var hexGeo = new THREE.CylinderGeometry(hexRadius, hexRadius, hexDepth, 6);
  hexGeo.rotateX(Math.PI / 2);

  // Max projected extent of the hex at any rotation ≈ space diagonal
  // = sqrt((2r)^2 + depth^2) ≈ sqrt(4 + 1) ≈ 2.24
  // Video plane sized just above that so it always covers the mask.
  var videoPlaneSize = 2.4;

  // ═══════════════════════════════════════════════════════════
  // PASS 1 — Stencil hexagon: invisible, writes 1 to stencil
  // ═══════════════════════════════════════════════════════════
  var stencilMat = new THREE.MeshBasicMaterial();
  stencilMat.colorWrite = false;
  stencilMat.depthWrite = false;
  stencilMat.stencilWrite = true;
  stencilMat.stencilRef = 1;
  stencilMat.stencilFunc = THREE.AlwaysStencilFunc;
  stencilMat.stencilZPass = THREE.ReplaceStencilOp;
  stencilMat.stencilFail = THREE.KeepStencilOp;
  stencilMat.stencilZFail = THREE.KeepStencilOp;

  var stencilHex = new THREE.Mesh(hexGeo, stencilMat);
  stencilHex.renderOrder = 0;

  // ═══════════════════════════════════════════════════════════
  // PASS 2 — Video plane: billboard quad, masked by stencil.
  // Sized to tightly cover the hexagon's max projected extent
  // so the video fills the shape without being zoomed in.
  // ═══════════════════════════════════════════════════════════
  var videoMat = new THREE.MeshBasicMaterial({ map: videoTexture });
  videoMat.depthTest = false;
  videoMat.depthWrite = false;
  videoMat.stencilWrite = true;
  videoMat.stencilRef = 1;
  videoMat.stencilFunc = THREE.EqualStencilFunc;
  videoMat.stencilFail = THREE.KeepStencilOp;
  videoMat.stencilZFail = THREE.KeepStencilOp;
  videoMat.stencilZPass = THREE.KeepStencilOp;

  var videoPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(videoPlaneSize, videoPlaneSize),
    videoMat
  );
  videoPlane.renderOrder = 1;
  videoPlane.frustumCulled = false;

  // ═══════════════════════════════════════════════════════════
  // PASS 3 — Glass hexagon: fresnel reflections + specular
  // ═══════════════════════════════════════════════════════════
  var glassVert = [
    "varying vec3 vNormal;",
    "varying vec3 vViewDir;",
    "void main() {",
    "  vec4 wp = modelMatrix * vec4(position, 1.0);",
    "  vNormal = normalize(mat3(modelMatrix) * normal);",
    "  vViewDir = normalize(cameraPosition - wp.xyz);",
    "  gl_Position = projectionMatrix * viewMatrix * wp;",
    "}",
  ].join("\n");

  var glassFrag = [
    "varying vec3 vNormal;",
    "varying vec3 vViewDir;",
    "void main() {",
    "  vec3 n = normalize(vNormal);",
    "  vec3 v = normalize(vViewDir);",
    "",
    "  float fresnel = pow(1.0 - abs(dot(v, n)), 3.0);",
    "",
    "  vec3 r = reflect(-v, n);",
    "  float envGrad = r.y * 0.5 + 0.5;",
    "  vec3 env = mix(vec3(0.01, 0.01, 0.04), vec3(0.10, 0.12, 0.20), envGrad);",
    "",
    "  vec3 l1 = normalize(vec3(1.0, 1.0, 2.0));",
    "  vec3 l2 = normalize(vec3(-1.0, 0.5, 1.0));",
    "  float s1 = pow(max(dot(n, normalize(v + l1)), 0.0), 128.0);",
    "  float s2 = pow(max(dot(n, normalize(v + l2)), 0.0), 64.0);",
    "",
    "  vec3 col = env * fresnel + vec3(1.0) * (s1 * 0.7 + s2 * 0.35);",
    "  col += vec3(0.35, 0.45, 0.65) * smoothstep(0.0, 0.4, fresnel) * 0.1;",
    "",
    "  float alpha = fresnel * 0.2 + (s1 + s2) * 0.4;",
    "  alpha = clamp(alpha, 0.0, 0.75);",
    "",
    "  gl_FragColor = vec4(col, alpha);",
    "}",
  ].join("\n");

  var glassMat = new THREE.ShaderMaterial({
    vertexShader: glassVert,
    fragmentShader: glassFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  var glassHex = new THREE.Mesh(hexGeo, glassMat);
  glassHex.renderOrder = 2;

  // ═══════════════════════════════════════════════════════════
  // PASS 4 — Wireframe edges
  // ═══════════════════════════════════════════════════════════
  var edgesGeo = new THREE.EdgesGeometry(hexGeo);
  var edgesMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
  });
  var wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
  wireframe.renderOrder = 3;

  // ─── Assemble Scene ─────────────────────────────────────────
  var hexGroup = new THREE.Group();
  hexGroup.add(stencilHex);
  hexGroup.add(glassHex);
  hexGroup.add(wireframe);
  scene.add(hexGroup);
  scene.add(videoPlane);

  // ─── GSAP ScrollTrigger ─────────────────────────────────────
  gsap.registerPlugin(ScrollTrigger);

  // Rotation
  gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1.5,
    },
  }).to(hexGroup.rotation, {
    x: Math.PI * 2,
    y: Math.PI * 4,
    duration: 1,
    ease: "none",
  });

  // Scale
  gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1.5,
    },
  }).fromTo(
    hexGroup.scale,
    { x: 1, y: 1, z: 1 },
    { x: 1.4, y: 1.4, z: 1.4, duration: 1, ease: "none" }
  );

  // Position sway
  var tlPos = gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
    },
  });
  tlPos
    .to(hexGroup.position, { x: 1.2, y: 0.5, duration: 0.25, ease: "none" }, 0)
    .to(hexGroup.position, { x: -0.8, y: -0.3, duration: 0.25, ease: "none" }, 0.25)
    .to(hexGroup.position, { x: 0.5, y: 0.8, duration: 0.25, ease: "none" }, 0.5)
    .to(hexGroup.position, { x: 0, y: 0, duration: 0.25, ease: "none" }, 0.75);

  // Edge brightness pulse
  var tlEdges = gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
    },
  });
  tlEdges
    .to(edgesMat, { opacity: 0.6, duration: 0.5, ease: "none" }, 0)
    .to(edgesMat, { opacity: 0.15, duration: 0.5, ease: "none" }, 0.5);

  // ─── Render Loop ────────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate);

    videoPlane.position.copy(hexGroup.position);
    videoPlane.scale.setScalar(hexGroup.scale.x);
    videoPlane.quaternion.copy(camera.quaternion);

    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      videoTexture.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }
  animate();

  // ─── Resize ─────────────────────────────────────────────────
  window.addEventListener("resize", function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });
})();
