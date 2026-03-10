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
  const canvas = document.getElementById("webgl");
  const dpr = Math.min(window.devicePixelRatio, 2);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0xffffff, 1);

  const camera = new THREE.PerspectiveCamera(
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

  // ─── Two scenes ────────────────────────────────────────────
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

  // ─── Video Plane with soft edge vignette ───────────────────
  // Fades to white at edges so no hard rectangular boundary
  // is ever visible through the glass refraction.
  var hexRadius = 1.2;
  var hexDepth = 0.9;
  var videoPlaneDim = hexRadius * 2.8;

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
    "  float edge = smoothstep(0.65, 1.0, max(d.x, d.y));",
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
    new THREE.PlaneGeometry(videoPlaneDim, videoPlaneDim),
    videoMat
  );
  videoPlane.frustumCulled = false;
  bgScene.add(videoPlane);

  // ─── Hexagonal Prism ──────────────────────────────────────
  var hexGeo = new THREE.CylinderGeometry(hexRadius, hexRadius, hexDepth, 6);
  hexGeo.rotateX(Math.PI / 2);

  // ─── Liquid Glass Refraction Shader ────────────────────────
  // Based on Cauchy dispersion model + Schlick fresnel
  // with per-channel refraction for chromatic aberration,
  // edge-boosted distortion, subtle blur, and specular.

  var glassVertSrc = [
    "varying vec3 vWorldNormal;",
    "varying vec3 vViewDir;",
    "",
    "void main() {",
    "  vec4 wp      = modelMatrix * vec4(position, 1.0);",
    "  vWorldNormal = normalize(mat3(modelMatrix) * normal);",
    "  vViewDir     = normalize(cameraPosition - wp.xyz);",
    "  gl_Position  = projectionMatrix * viewMatrix * wp;",
    "}",
  ].join("\n");

  var glassFragSrc = [
    "uniform sampler2D uBackground;",
    "uniform vec2      uResolution;",
    "",
    "varying vec3 vWorldNormal;",
    "varying vec3 vViewDir;",
    "",
    // Cauchy equation: n(λ) = A + B/λ²
    "float iorAt(float lambdaUm) {",
    "  return 1.5046 + 0.0042 / (lambdaUm * lambdaUm);",
    "}",
    "",
    "vec3 schlick(float cosT, vec3 F0) {",
    "  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);",
    "}",
    "",
    "void main() {",
    "  vec2 uv = gl_FragCoord.xy / uResolution;",
    "",
    "  vec3 N = normalize(vWorldNormal);",
    "  N *= (gl_FrontFacing ? 1.0 : -1.0);",
    "  vec3 V = normalize(vViewDir);",
    "",
    "  float cosTheta  = abs(dot(V, N));",
    "  float edgeFactor = 1.0 - cosTheta;",
    "",
    // Per-wavelength IOR (red, green, blue)
    "  float nR = iorAt(0.700);",
    "  float nG = iorAt(0.546);",
    "  float nB = iorAt(0.435);",
    "",
    // Per-channel refraction direction
    "  vec3 Rdir = refract(-V, N, 1.0 / nR);",
    "  vec3 Gdir = refract(-V, N, 1.0 / nG);",
    "  vec3 Bdir = refract(-V, N, 1.0 / nB);",
    "",
    // Edge-boosted refraction strength
    "  float strength = 0.08 + edgeFactor * 0.22;",
    "",
    "  vec2 uvR = clamp(uv + Rdir.xy * strength * 0.85, 0.0, 1.0);",
    "  vec2 uvG = clamp(uv + Gdir.xy * strength,        0.0, 1.0);",
    "  vec2 uvB = clamp(uv + Bdir.xy * strength * 1.15, 0.0, 1.0);",
    "",
    // 3-tap blur per channel — subtle frosted feel at edges
    "  float blur = 0.001 + edgeFactor * edgeFactor * 0.006;",
    "",
    "  float r = (",
    "    texture2D(uBackground, uvR).r +",
    "    texture2D(uBackground, uvR + vec2(blur, blur)).r +",
    "    texture2D(uBackground, uvR - vec2(blur, blur)).r",
    "  ) / 3.0;",
    "",
    "  float g = (",
    "    texture2D(uBackground, uvG).g +",
    "    texture2D(uBackground, uvG + vec2(-blur, blur)).g +",
    "    texture2D(uBackground, uvG + vec2(blur, -blur)).g",
    "  ) / 3.0;",
    "",
    "  float b = (",
    "    texture2D(uBackground, uvB).b +",
    "    texture2D(uBackground, uvB + vec2(blur, -blur)).b +",
    "    texture2D(uBackground, uvB + vec2(-blur, blur)).b",
    "  ) / 3.0;",
    "",
    "  vec3 refracted = vec3(r, g, b);",
    "",
    // Schlick fresnel
    "  vec3 nRGB = vec3(nR, nG, nB);",
    "  vec3 F0   = pow((nRGB - 1.0) / (nRGB + 1.0), vec3(2.0));",
    "  vec3 F    = schlick(cosTheta, F0);",
    "",
    // Screen-space reflection
    "  vec3 R = reflect(-V, N);",
    "  vec2 uvRefl = clamp(uv + R.xy * 0.1, 0.0, 1.0);",
    "  vec3 reflected = texture2D(uBackground, uvRefl).rgb;",
    "",
    // Specular highlights — two lights, sharp + broad
    "  vec3  l1 = normalize(vec3(1.0, 2.0, 3.0));",
    "  vec3  h1 = normalize(V + l1);",
    "  float s1 = pow(max(dot(N, h1), 0.0), 256.0);",
    "",
    "  vec3  l2 = normalize(vec3(-2.0, 1.0, 1.5));",
    "  vec3  h2 = normalize(V + l2);",
    "  float s2 = pow(max(dot(N, h2), 0.0), 80.0);",
    "",
    // Compose: refraction + fresnel reflection + specular
    "  vec3 color = mix(refracted, reflected, clamp(F * 2.5, 0.0, 1.0));",
    "  color += vec3(1.0) * (s1 * 0.55 + s2 * 0.2);",
    "",
    // Inner shadow at grazing angles — adds depth/thickness
    "  color *= mix(1.0, 0.88, edgeFactor * edgeFactor);",
    "",
    // Subtle prismatic tint at edges
    "  color.r += edgeFactor * edgeFactor * 0.02;",
    "  color.b += edgeFactor * edgeFactor * 0.04;",
    "",
    "  gl_FragColor = vec4(color, 1.0);",
    "}",
  ].join("\n");

  var glassMat = new THREE.ShaderMaterial({
    uniforms: {
      uBackground: { value: renderTarget.texture },
      uResolution: { value: new THREE.Vector2(rtW, rtH) },
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
    color: 0xaaaaaa,
    transparent: true,
    opacity: 0.3,
  });
  var wireframe = new THREE.LineSegments(edgesGeo, edgesMat);

  // ─── Hex Group ────────────────────────────────────────────
  var hexGroup = new THREE.Group();
  hexGroup.add(glassHex);
  hexGroup.add(wireframe);
  mainScene.add(hexGroup);

  // ─── GSAP ScrollTrigger ───────────────────────────────────
  gsap.registerPlugin(ScrollTrigger);

  // Rotation — starts after a short hold so the hex face
  // is fully visible at the beginning of the scroll.
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
    .to(edgesMat, { opacity: 0.5, duration: 0.5, ease: "none" }, 0)
    .to(edgesMat, { opacity: 0.15, duration: 0.5, ease: "none" }, 0.5);

  // ─── Render Loop ──────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate);

    // Billboard: video plane tracks hex pos/scale, always faces camera
    videoPlane.position.copy(hexGroup.position);
    videoPlane.scale.setScalar(hexGroup.scale.x);
    videoPlane.quaternion.copy(camera.quaternion);

    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      videoTexture.needsUpdate = true;
    }

    // Pass 1 — video + white bg → offscreen FBO
    renderer.setRenderTarget(renderTarget);
    renderer.render(bgScene, camera);

    // Pass 2 — glass hex (samples FBO with refraction) → screen
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
