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
  // Soft vignette fades to white so no hard edge is visible
  // through the glass. Large enough to cover hex at any rotation.

  var hexRadius = 0.85;
  var hexHeight = 2.2;

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
    "  float edge = smoothstep(0.6, 1.0, max(d.x, d.y));",
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
    new THREE.PlaneGeometry(4.0, 4.0),
    videoMat
  );
  videoPlane.frustumCulled = false;
  bgScene.add(videoPlane);

  // ─── Tall Hexagonal Prism ──────────────────────────────────
  // Vertical orientation (Y-axis), taller than wide like ref image
  var hexGeo = new THREE.CylinderGeometry(hexRadius, hexRadius, hexHeight, 6);

  // ─── Liquid Glass Shader (adapted from liquidGL) ───────────
  // Uses view-space normals for screen-space UV offset,
  // liquidGL-style bevel (pow 10), centre blend, 5-tap AA,
  // chromatic aberration, Schlick fresnel, and animated specular.

  var glassVertSrc = [
    "varying vec3 vViewNormal;",
    "varying vec3 vWorldNormal;",
    "varying vec3 vViewDir;",
    "",
    "void main() {",
    "  vec4 wp       = modelMatrix * vec4(position, 1.0);",
    "  vViewNormal   = normalize(normalMatrix * normal);",
    "  vWorldNormal  = normalize(mat3(modelMatrix) * normal);",
    "  vViewDir      = normalize(cameraPosition - wp.xyz);",
    "  gl_Position   = projectionMatrix * viewMatrix * wp;",
    "}",
  ].join("\n");

  var glassFragSrc = [
    "uniform sampler2D uBackground;",
    "uniform vec2      uResolution;",
    "uniform float     uTime;",
    "",
    "varying vec3 vViewNormal;",
    "varying vec3 vWorldNormal;",
    "varying vec3 vViewDir;",
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
    // Edge factor (fresnel-like, 0 at centre, 1 at edge)
    "  float cosTheta  = abs(dot(V, Nw));",
    "  float edge      = 1.0 - cosTheta;",
    "",
    // liquidGL-style offset: base refraction + sharp pow-10 bevel
    "  float refraction = 0.04;",
    "  float bevelDepth = 0.14;",
    "  float offsetAmt  = edge * refraction + pow(edge, 10.0) * bevelDepth;",
    "",
    // Centre blend — reduce distortion where normal faces camera
    "  float centreBlend = smoothstep(0.08, 0.35, edge);",
    "  offsetAmt *= centreBlend;",
    "",
    // Distortion direction: view-space normal projected to screen
    "  vec2 dir = Nv.xy;",
    "",
    // Chromatic aberration — stronger at edges
    "  float ca = 0.004 + pow(edge, 5.0) * 0.025;",
    "",
    "  vec2 offR = dir * offsetAmt * (1.0 + ca);",
    "  vec2 offG = dir * offsetAmt;",
    "  vec2 offB = dir * offsetAmt * (1.0 - ca);",
    "",
    // 5-tap sampling per channel (liquidGL anti-alias pattern)
    "  vec2 tx = 1.0 / uResolution;",
    "",
    "  float r = (",
    "    texture2D(uBackground, uv + offR).r",
    "  + texture2D(uBackground, uv + offR + vec2( tx.x, 0.0)).r",
    "  + texture2D(uBackground, uv + offR + vec2(-tx.x, 0.0)).r",
    "  + texture2D(uBackground, uv + offR + vec2(0.0,  tx.y)).r",
    "  + texture2D(uBackground, uv + offR + vec2(0.0, -tx.y)).r",
    "  ) / 5.0;",
    "",
    "  float g = (",
    "    texture2D(uBackground, uv + offG).g",
    "  + texture2D(uBackground, uv + offG + vec2( tx.x, 0.0)).g",
    "  + texture2D(uBackground, uv + offG + vec2(-tx.x, 0.0)).g",
    "  + texture2D(uBackground, uv + offG + vec2(0.0,  tx.y)).g",
    "  + texture2D(uBackground, uv + offG + vec2(0.0, -tx.y)).g",
    "  ) / 5.0;",
    "",
    "  float b = (",
    "    texture2D(uBackground, uv + offB).b",
    "  + texture2D(uBackground, uv + offB + vec2( tx.x, 0.0)).b",
    "  + texture2D(uBackground, uv + offB + vec2(-tx.x, 0.0)).b",
    "  + texture2D(uBackground, uv + offB + vec2(0.0,  tx.y)).b",
    "  + texture2D(uBackground, uv + offB + vec2(0.0, -tx.y)).b",
    "  ) / 5.0;",
    "",
    "  vec3 color = vec3(r, g, b);",
    "",
    // Fresnel reflection — brighten at grazing angles
    "  float fresnel = pow(edge, 3.0);",
    "  color = mix(color, vec3(1.0), fresnel * 0.12);",
    "",
    // Inner shadow at edges — adds perceived thickness
    "  color *= mix(1.0, 0.88, edge * edge);",
    "",
    // Animated specular highlights (liquidGL style)
    "  vec2 lp1 = vec2(sin(uTime * 0.3), cos(uTime * 0.4)) * 0.4;",
    "  vec2 lp2 = vec2(sin(uTime * -0.5 + 1.5), cos(uTime * 0.3 - 0.5)) * 0.4;",
    "  float h = 0.0;",
    "  h += smoothstep(0.6, 0.0, length(Nv.xy - lp1)) * 0.12;",
    "  h += smoothstep(0.7, 0.0, length(Nv.xy - lp2)) * 0.09;",
    "  color += vec3(h);",
    "",
    // Fixed specular (view-dependent)
    "  vec3 l1 = normalize(vec3(1.0, 2.0, 3.0));",
    "  vec3 h1 = normalize(V + l1);",
    "  float s1 = pow(max(dot(Nw, h1), 0.0), 200.0);",
    "  color += vec3(1.0) * s1 * 0.4;",
    "",
    "  gl_FragColor = vec4(color, 1.0);",
    "}",
  ].join("\n");

  var glassMat = new THREE.ShaderMaterial({
    uniforms: {
      uBackground: { value: renderTarget.texture },
      uResolution: { value: new THREE.Vector2(rtW, rtH) },
      uTime: { value: 0.0 },
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

  // ─── Hex Group — 3/4 starting angle like reference ────────
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

  function animate() {
    requestAnimationFrame(animate);

    glassMat.uniforms.uTime.value = clock.getElapsedTime();

    videoPlane.position.copy(hexGroup.position);
    videoPlane.scale.setScalar(hexGroup.scale.x);
    videoPlane.quaternion.copy(camera.quaternion);

    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      videoTexture.needsUpdate = true;
    }

    renderer.setRenderTarget(renderTarget);
    renderer.render(bgScene, camera);

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
