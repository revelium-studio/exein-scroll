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

  // ─── Render target (offscreen buffer for background pass) ──
  var rtW = Math.floor(window.innerWidth * dpr);
  var rtH = Math.floor(window.innerHeight * dpr);

  var renderTarget = new THREE.WebGLRenderTarget(rtW, rtH, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });

  // ─── Two scenes: background (video) & main (glass hex) ─────
  var bgScene = new THREE.Scene();
  bgScene.background = new THREE.Color(0xffffff);

  var mainScene = new THREE.Scene();
  mainScene.background = new THREE.Color(0xffffff);

  // ─── Video Texture ──────────────────────────────────────────
  var video = document.createElement("video");
  video.src = "video/Exein_3D_Texture_White.mp4";
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.play().catch(function () {
    document.addEventListener(
      "click",
      function () {
        video.play();
      },
      { once: true }
    );
  });

  var videoTexture = new THREE.VideoTexture(video);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.format = THREE.RGBAFormat;

  // ─── Video Plane (bgScene) ─────────────────────────────────
  // Smaller than the hex so the content has breathing room
  // inside the glass — white shows around the edges.
  var hexRadius = 1.0;
  var hexDepth = 1.0;
  var videoPlaneDim = hexRadius * 1.5;

  var videoPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(videoPlaneDim, videoPlaneDim),
    new THREE.MeshBasicMaterial({ map: videoTexture })
  );
  videoPlane.frustumCulled = false;
  bgScene.add(videoPlane);

  // ─── Hexagonal Prism ───────────────────────────────────────
  var hexGeo = new THREE.CylinderGeometry(hexRadius, hexRadius, hexDepth, 6);
  hexGeo.rotateX(Math.PI / 2);

  // ─── Glass Refraction Shader ────────────────────────────────
  var glassVert = [
    "varying vec3 vNormal;",
    "varying vec3 vViewDir;",
    "varying vec3 vWorldNormal;",
    "",
    "void main() {",
    "  vec4 wp = modelMatrix * vec4(position, 1.0);",
    "  vNormal      = normalize(normalMatrix * normal);",
    "  vWorldNormal  = normalize(mat3(modelMatrix) * normal);",
    "  vViewDir      = normalize(cameraPosition - wp.xyz);",
    "  gl_Position   = projectionMatrix * viewMatrix * wp;",
    "}",
  ].join("\n");

  var glassFrag = [
    "uniform sampler2D uBackground;",
    "uniform vec2      uResolution;",
    "",
    "varying vec3 vNormal;",
    "varying vec3 vViewDir;",
    "varying vec3 vWorldNormal;",
    "",
    "void main() {",
    "  vec2 uv = gl_FragCoord.xy / uResolution;",
    "",
    "  vec3 n  = normalize(vNormal);",
    "  vec3 v  = normalize(vViewDir);",
    "  vec3 wn = normalize(vWorldNormal);",
    "",
    "  // ── IOR refraction ──",
    "  float ior = 1.45;",
    "  vec3 refr = refract(-v, n, 1.0 / ior);",
    "  vec2 off  = refr.xy * 0.10;",
    "",
    "  // ── Chromatic aberration ──",
    "  float ca = 0.012;",
    "  vec3 col;",
    "  col.r = texture2D(uBackground, uv + off * (1.0 + ca)).r;",
    "  col.g = texture2D(uBackground, uv + off           ).g;",
    "  col.b = texture2D(uBackground, uv + off * (1.0 - ca)).b;",
    "",
    "  // ── Fresnel ──",
    "  float fresnel = pow(1.0 - abs(dot(v, n)), 4.0);",
    "",
    "  // ── Specular highlights (two lights) ──",
    "  vec3  l1 = normalize(vec3( 1.0, 1.5, 2.0));",
    "  vec3  l2 = normalize(vec3(-1.0, 0.5, 1.5));",
    "  float s1 = pow(max(dot(n, normalize(v + l1)), 0.0), 200.0);",
    "  float s2 = pow(max(dot(n, normalize(v + l2)), 0.0), 100.0);",
    "",
    "  // ── Fake environment reflection ──",
    "  vec3  r       = reflect(-v, wn);",
    "  float envGrad = r.y * 0.5 + 0.5;",
    "  vec3  env     = mix(vec3(0.92, 0.92, 0.95), vec3(1.0), envGrad);",
    "",
    "  // ── Compose ──",
    "  col  = mix(col, env, fresnel * 0.18);",
    "  col += vec3(1.0) * (s1 * 0.45 + s2 * 0.2);",
    "  col *= mix(1.0, 0.97, fresnel);",
    "",
    "  gl_FragColor = vec4(col, 1.0);",
    "}",
  ].join("\n");

  var glassMat = new THREE.ShaderMaterial({
    uniforms: {
      uBackground: { value: renderTarget.texture },
      uResolution: { value: new THREE.Vector2(rtW, rtH) },
    },
    vertexShader: glassVert,
    fragmentShader: glassFrag,
    side: THREE.DoubleSide,
  });
  glassMat.polygonOffset = true;
  glassMat.polygonOffsetFactor = 1;
  glassMat.polygonOffsetUnits = 1;

  var glassHex = new THREE.Mesh(hexGeo, glassMat);

  // ─── Wireframe Edges ───────────────────────────────────────
  var edgesGeo = new THREE.EdgesGeometry(hexGeo);
  var edgesMat = new THREE.LineBasicMaterial({
    color: 0xbbbbbb,
    transparent: true,
    opacity: 0.35,
  });
  var wireframe = new THREE.LineSegments(edgesGeo, edgesMat);

  // ─── Hex Group (mainScene) ─────────────────────────────────
  var hexGroup = new THREE.Group();
  hexGroup.add(glassHex);
  hexGroup.add(wireframe);
  mainScene.add(hexGroup);

  // ─── GSAP ScrollTrigger ─────────────────────────────────────
  gsap.registerPlugin(ScrollTrigger);

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

  var tlEdges = gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
    },
  });
  tlEdges
    .to(edgesMat, { opacity: 0.55, duration: 0.5, ease: "none" }, 0)
    .to(edgesMat, { opacity: 0.2, duration: 0.5, ease: "none" }, 0.5);

  // ─── Render Loop ────────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate);

    // Billboard: video plane tracks hex position & scale, faces camera
    videoPlane.position.copy(hexGroup.position);
    videoPlane.scale.setScalar(hexGroup.scale.x);
    videoPlane.quaternion.copy(camera.quaternion);

    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      videoTexture.needsUpdate = true;
    }

    // Pass 1 — render video + white bg to offscreen target
    renderer.setRenderTarget(renderTarget);
    renderer.render(bgScene, camera);

    // Pass 2 — render glass hex (samples from pass 1) to screen
    renderer.setRenderTarget(null);
    renderer.render(mainScene, camera);
  }
  animate();

  // ─── Resize ─────────────────────────────────────────────────
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
