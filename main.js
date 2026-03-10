(function () {
  "use strict";

  // ─── Smooth Scrolling (Lenis) ───────────────────────────────
  const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smooth: true,
  });

  lenis.on("scroll", ScrollTrigger.update);

  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
  });
  gsap.ticker.lagSmoothing(0);

  // ─── Three.js Setup ─────────────────────────────────────────
  const canvas = document.getElementById("webgl");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
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

  // ─── Video Texture ──────────────────────────────────────────
  const video = document.createElement("video");
  video.src = "video/Exein_3D_Texture_White.mp4";
  video.crossOrigin = "anonymous";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.play();

  const videoTexture = new THREE.VideoTexture(video);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.format = THREE.RGBAFormat;
  videoTexture.encoding = THREE.sRGBEncoding;

  // ─── Cube with Video Masked Inside ──────────────────────────
  // We create a cube where the video plays on all inner faces.
  // Using BackSide rendering so the texture is visible from inside,
  // combined with a front-face wireframe/transparent shell.

  const cubeSize = 1.8;
  const cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

  // Inner material — video texture rendered on inside faces
  const innerMaterial = new THREE.MeshBasicMaterial({
    map: videoTexture,
    side: THREE.BackSide,
  });

  const innerCube = new THREE.Mesh(cubeGeometry, innerMaterial);

  // Outer shell — transparent with visible edges
  const outerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.06,
    side: THREE.FrontSide,
  });

  const outerCube = new THREE.Mesh(cubeGeometry, outerMaterial);

  // Wireframe edges
  const edgesGeometry = new THREE.EdgesGeometry(cubeGeometry);
  const edgesMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.25,
  });
  const wireframe = new THREE.LineSegments(edgesGeometry, edgesMaterial);

  // Group everything
  const cubeGroup = new THREE.Group();
  cubeGroup.add(innerCube);
  cubeGroup.add(outerCube);
  cubeGroup.add(wireframe);
  scene.add(cubeGroup);

  // Subtle ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);

  // ─── GSAP ScrollTrigger Animation ──────────────────────────
  gsap.registerPlugin(ScrollTrigger);

  const scrollState = {
    rotationX: 0,
    rotationY: 0,
    positionX: 0,
    positionY: 0,
    scale: 1,
  };

  // Main scroll-driven timeline over the full 300vh
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1.5,
    },
  });

  tl.to(scrollState, {
    rotationX: Math.PI * 2,
    rotationY: Math.PI * 4,
    positionX: 0,
    positionY: 0,
    scale: 1.4,
    duration: 1,
    ease: "none",
    onUpdate: () => {
      cubeGroup.rotation.x = scrollState.rotationX;
      cubeGroup.rotation.y = scrollState.rotationY;
      cubeGroup.position.x = scrollState.positionX;
      cubeGroup.position.y = scrollState.positionY;
      cubeGroup.scale.setScalar(scrollState.scale);
    },
  });

  // Additional positional movement — sway the cube
  const tlPosition = gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
    },
  });

  tlPosition
    .to(
      cubeGroup.position,
      { x: 1.2, y: 0.5, duration: 0.25, ease: "none" },
      0
    )
    .to(
      cubeGroup.position,
      { x: -0.8, y: -0.3, duration: 0.25, ease: "none" },
      0.25
    )
    .to(
      cubeGroup.position,
      { x: 0.5, y: 0.8, duration: 0.25, ease: "none" },
      0.5
    )
    .to(
      cubeGroup.position,
      { x: 0, y: 0, duration: 0.25, ease: "none" },
      0.75
    );

  // Edge opacity pulse through scroll
  const tlEdges = gsap.timeline({
    scrollTrigger: {
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      scrub: 1,
    },
  });

  tlEdges
    .to(edgesMaterial, { opacity: 0.6, duration: 0.5, ease: "none" }, 0)
    .to(edgesMaterial, { opacity: 0.15, duration: 0.5, ease: "none" }, 0.5);

  // ─── Render Loop ────────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate);
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      videoTexture.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }
  animate();

  // ─── Resize Handler ─────────────────────────────────────────
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  });
})();
