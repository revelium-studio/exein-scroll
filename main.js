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

  // ─── Renderer ───────────────────────────────────────────────
  var canvas = document.getElementById("webgl");
  var dpr = Math.min(window.devicePixelRatio, 2);

  var renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0xffffff, 1);

  var camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 0, 5);

  // ─── Render Target ─────────────────────────────────────────
  var rtW = Math.floor(window.innerWidth * dpr);
  var rtH = Math.floor(window.innerHeight * dpr);

  var renderTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });

  // ─── Scenes ────────────────────────────────────────────────
  var bgScene = new THREE.Scene();
  bgScene.background = new THREE.Color(0xffffff);

  var mainScene = new THREE.Scene();
  mainScene.background = new THREE.Color(0xffffff);

  // ─── Video Texture ─────────────────────────────────────────
  var video = document.createElement("video");
  video.src = "video/Exein_3D_Texture_White.mp4";
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.play().catch(function () {
    document.addEventListener("click", function () { video.play(); }, { once: true });
  });

  var videoTexture = new THREE.VideoTexture(video);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.format = THREE.RGBAFormat;

  // ─── Video Plane (bgScene) ─────────────────────────────────
  var hexRadius = 0.9;
  var hexHeight = 1.4;

  var videoVertSrc = [
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = uv;",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}",
  ].join("\n");

  var videoFragSrc = [
    "uniform sampler2D uVideo;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec4 tex = texture2D(uVideo, vUv);",
    "  vec2 d = abs(vUv - 0.5) * 2.0;",
    "  float edge = smoothstep(0.55, 1.0, max(d.x, d.y));",
    "  vec3 col = mix(tex.rgb, vec3(1.0), edge);",
    "  gl_FragColor = vec4(col, 1.0);",
    "}",
  ].join("\n");

  var videoMat = new THREE.ShaderMaterial({
    uniforms: { uVideo: { value: videoTexture } },
    vertexShader: videoVertSrc,
    fragmentShader: videoFragSrc,
  });

  var videoPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 4.5),
    videoMat
  );
  videoPlane.frustumCulled = false;
  bgScene.add(videoPlane);

  // ─── Hexagonal Prism ──────────────────────────────────────
  var hexGeo = new THREE.CylinderGeometry(hexRadius, hexRadius, hexHeight, 6);

  // ─── Liquid Glass Shader ───────────────────────────────────
  var glassVertSrc = [
    "varying vec3 vViewNormal;",
    "varying vec3 vWorldNormal;",
    "varying vec3 vViewDir;",
    "varying vec4 vClipPos;",
    "",
    "void main() {",
    "  vec4 wp       = modelMatrix * vec4(position, 1.0);",
    "  vViewNormal   = normalize(normalMatrix * normal);",
    "  vWorldNormal  = normalize(mat3(modelMatrix) * normal);",
    "  vViewDir      = normalize(cameraPosition - wp.xyz);",
    "  vClipPos      = projectionMatrix * viewMatrix * wp;",
    "  gl_Position   = vClipPos;",
    "}",
  ].join("\n");

  var glassFragSrc = [
    "uniform sampler2D uBackground;",
    "uniform vec2      uResolution;",
    "uniform float     uTime;",
    "uniform vec2      uCenter;",
    "",
    "varying vec3 vViewNormal;",
    "varying vec3 vWorldNormal;",
    "varying vec3 vViewDir;",
    "varying vec4 vClipPos;",
    "",
    "void main() {",
    "  vec2 uv = gl_FragCoord.xy / uResolution;",
    "",
    "  vec3 Nv = normalize(vViewNormal);",
    "  Nv *= (gl_FrontFacing ? 1.0 : -1.0);",
    "  vec3 Nw = normalize(vWorldNormal);",
    "  Nw *= (gl_FrontFacing ? 1.0 : -1.0);",
    "  vec3 V  = normalize(vViewDir);",
    "",
    "  float cosTheta = abs(dot(V, Nw));",
    "  float edge     = 1.0 - cosTheta;",
    "",
    // ── Distortion direction ──
    // Normal direction in screen space (strong on side faces)
    "  vec2 normalDir = Nv.xy;",
    // Radial from hex center (fallback for faces pointing at camera)
    "  vec2 radialDir = uv - uCenter;",
    "  float radLen   = length(radialDir);",
    "  radialDir      = radLen > 0.001 ? radialDir / radLen : vec2(0.0);",
    "",
    // Blend: use normal when it has XY magnitude, radial as fallback
    "  float nWeight = smoothstep(0.0, 0.2, length(normalDir));",
    "  vec2 dir = mix(radialDir, normalize(normalDir + 0.001), nWeight);",
    "",
    // ── Offset amount ──
    // High base so refraction is ALWAYS visible, not just at extreme edges
    "  float refraction = 0.18;",
    "  float bevelDepth = 0.30;",
    "  float offsetAmt  = 0.012 + refraction * edge + bevelDepth * pow(edge, 4.0);",
    "",
    // ── Chromatic aberration — stronger at edges ──
    "  float ca = 0.008 + edge * edge * 0.04;",
    "",
    "  vec2 offR = dir * offsetAmt * (1.0 + ca);",
    "  vec2 offG = dir * offsetAmt;",
    "  vec2 offB = dir * offsetAmt * (1.0 - ca);",
    "",
    // ── 5-tap sampling per channel (liquidGL pattern) ──
    "  vec2 tx = 1.0 / uResolution;",
    "",
    "  float r = (",
    "    texture2D(uBackground, uv + offR).r",
    "  + texture2D(uBackground, uv + offR + vec2( tx.x, 0.0)).r",
    "  + texture2D(uBackground, uv + offR - vec2( tx.x, 0.0)).r",
    "  + texture2D(uBackground, uv + offR + vec2(0.0,  tx.y)).r",
    "  + texture2D(uBackground, uv + offR - vec2(0.0,  tx.y)).r",
    "  ) / 5.0;",
    "",
    "  float g = (",
    "    texture2D(uBackground, uv + offG).g",
    "  + texture2D(uBackground, uv + offG + vec2( tx.x, 0.0)).g",
    "  + texture2D(uBackground, uv + offG - vec2( tx.x, 0.0)).g",
    "  + texture2D(uBackground, uv + offG + vec2(0.0,  tx.y)).g",
    "  + texture2D(uBackground, uv + offG - vec2(0.0,  tx.y)).g",
    "  ) / 5.0;",
    "",
    "  float b = (",
    "    texture2D(uBackground, uv + offB).b",
    "  + texture2D(uBackground, uv + offB + vec2( tx.x, 0.0)).b",
    "  + texture2D(uBackground, uv + offB - vec2( tx.x, 0.0)).b",
    "  + texture2D(uBackground, uv + offB + vec2(0.0,  tx.y)).b",
    "  + texture2D(uBackground, uv + offB - vec2(0.0,  tx.y)).b",
    "  ) / 5.0;",
    "",
    "  vec3 color = vec3(r, g, b);",
    "",
    // ── Fresnel — brighten at grazing angles ──
    "  float fresnel = pow(edge, 3.0);",
    "  color = mix(color, vec3(1.0), fresnel * 0.15);",
    "",
    // ── Inner shadow — perceived thickness ──
    "  color *= mix(1.0, 0.85, edge * edge);",
    "",
    // ── Animated specular (liquidGL style) ──
    "  vec2 lp1 = vec2(sin(uTime * 0.25), cos(uTime * 0.35)) * 0.45;",
    "  vec2 lp2 = vec2(sin(uTime * -0.4 + 1.5), cos(uTime * 0.2 - 0.5)) * 0.45;",
    "  float h = 0.0;",
    "  h += smoothstep(0.55, 0.0, length(Nv.xy - lp1)) * 0.14;",
    "  h += smoothstep(0.65, 0.0, length(Nv.xy - lp2)) * 0.10;",
    "  color += vec3(h);",
    "",
    // ── Fixed specular ──
    "  vec3 l1 = normalize(vec3(1.0, 2.0, 3.0));",
    "  vec3 h1 = normalize(V + l1);",
    "  float s1 = pow(max(dot(Nw, h1), 0.0), 180.0);",
    "  color += vec3(1.0) * s1 * 0.35;",
    "",
    "  gl_FragColor = vec4(color, 1.0);",
    "}",
  ].join("\n");

  var glassMat = new THREE.ShaderMaterial({
    uniforms: {
      uBackground: { value: renderTarget.texture },
      uResolution: { value: new THREE.Vector2(rtW, rtH) },
      uTime: { value: 0.0 },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    },
    vertexShader: glassVertSrc,
    fragmentShader: glassFragSrc,
    side: THREE.DoubleSide,
  });
  glassMat.polygonOffset = true;
  glassMat.polygonOffsetFactor = 1;
  glassMat.polygonOffsetUnits = 1;

  var glassHex = new THREE.Mesh(hexGeo, glassMat);

  // ─── Wireframe Edges ──────────────────────────────────────
  var edgesGeo = new THREE.EdgesGeometry(hexGeo);
  var edgesMat = new THREE.LineBasicMaterial({
    color: 0xbbbbbb,
    transparent: true,
    opacity: 0.2,
  });
  var wireframe = new THREE.LineSegments(edgesGeo, edgesMat);

  // ─── Hex Group ────────────────────────────────────────────
  var hexGroup = new THREE.Group();
  hexGroup.add(glassHex);
  hexGroup.add(wireframe);
  hexGroup.rotation.set(-0.15, 0.45, 0);
  mainScene.add(hexGroup);

  // ─── GSAP ScrollTrigger ───────────────────────────────────
  gsap.registerPlugin(ScrollTrigger);

  var startRX = hexGroup.rotation.x;
  var startRY = hexGroup.rotation.y;

  gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1.5,
    },
  }).to(hexGroup.rotation, {
    x: startRX + Math.PI * 2,
    y: startRY + Math.PI * 4,
    duration: 1,
    ease: "none",
  });

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
    { x: 1.3, y: 1.3, z: 1.3, duration: 1, ease: "none" }
  );

  var tlPos = gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
    },
  });
  tlPos
    .to(hexGroup.position, { x: 1.0, y: 0.4, duration: 0.25, ease: "none" }, 0)
    .to(hexGroup.position, { x: -0.7, y: -0.3, duration: 0.25, ease: "none" }, 0.25)
    .to(hexGroup.position, { x: 0.4, y: 0.6, duration: 0.25, ease: "none" }, 0.5)
    .to(hexGroup.position, { x: 0, y: 0, duration: 0.25, ease: "none" }, 0.75);

  var tlEdges = gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
    },
  });
  tlEdges
    .to(edgesMat, { opacity: 0.4, duration: 0.5, ease: "none" }, 0)
    .to(edgesMat, { opacity: 0.1, duration: 0.5, ease: "none" }, 0.5);

  // ─── Render Loop ──────────────────────────────────────────
  var clock = new THREE.Clock();
  var projVec = new THREE.Vector3();

  function animate() {
    requestAnimationFrame(animate);

    glassMat.uniforms.uTime.value = clock.getElapsedTime();

    // Compute hex center in normalized screen coords for radial direction
    hexGroup.getWorldPosition(projVec);
    projVec.project(camera);
    glassMat.uniforms.uCenter.value.set(
      projVec.x * 0.5 + 0.5,
      projVec.y * 0.5 + 0.5
    );

    // Billboard: video plane tracks hex, faces camera
    videoPlane.position.copy(hexGroup.position);
    videoPlane.scale.setScalar(hexGroup.scale.x);
    videoPlane.quaternion.copy(camera.quaternion);

    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      videoTexture.needsUpdate = true;
    }

    // Pass 1 — video + white bg → FBO
    renderer.setRenderTarget(renderTarget);
    renderer.render(bgScene, camera);

    // Pass 2 — glass hex (samples FBO with distortion) → screen
    renderer.setRenderTarget(null);
    renderer.render(mainScene, camera);
  }
  animate();

  // ─── Resize ───────────────────────────────────────────────
  window.addEventListener("resize", function () {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var d = Math.min(window.devicePixelRatio, 2);

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(d);

    var nw = Math.floor(w * d);
    var nh = Math.floor(h * d);
    renderTarget.setSize(nw, nh);
    glassMat.uniforms.uResolution.value.set(nw, nh);
  });
})();
