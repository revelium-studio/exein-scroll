import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";
import { useControls, folder } from "leva";
import * as THREE from "three";
import { scrollState } from "../store";

const vertexShader = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vViewNormal;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vObjPos      = position;
  vObjNormal   = normal;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vViewNormal  = normalize(normalMatrix * normal);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir     = normalize(cameraPosition - worldPos.xyz);
  gl_Position  = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uBuffer;
uniform vec2      uResolution;
uniform float     uTime;
uniform vec2      uHexCenter;
uniform float     uHexRadius;
uniform float     uHexHalfH;
uniform float     uBorderRadius;
uniform float     uRefraction;
uniform float     uCA;
uniform float     uFresnelIntensity;
uniform float     uSpecPower;
uniform float     uSpecIntensity;

varying vec3 vObjPos;
varying vec3 vObjNormal;
varying vec3 vViewNormal;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

float hexDist(vec2 p, float r) {
  float ir = r * 0.866025404;
  p = abs(p);
  return max(dot(p, vec2(0.866025404, 0.5)), p.y) - ir;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  // --- SDF edge detection on the hex surface ---
  float dHex = -hexDist(vObjPos.xz, uHexRadius);
  float dCap = uHexHalfH - abs(vObjPos.y);
  float capFactor = abs(normalize(vObjNormal).y);
  float surfDist = mix(max(dCap, 0.0), max(dHex, 0.0), capFactor);

  // Edge mask: 1 at edge, 0 in center
  float edgeMask = 1.0 - smoothstep(0.0, uBorderRadius, surfDist);

  // --- Radial refraction direction (lens effect) ---
  vec2 radial = uv - uHexCenter;
  float radialLen = length(radial);
  vec2 radialDir = radialLen > 0.001 ? radial / radialLen : vec2(0.0);

  vec2 offset = radialDir * edgeMask * uRefraction;

  // Chromatic aberration — split R/G/B at edges
  float ca = uCA * edgeMask;
  float r = texture2D(uBuffer, uv + offset * (1.0 + ca)).r;
  float g = texture2D(uBuffer, uv + offset).g;
  float b = texture2D(uBuffer, uv + offset * (1.0 - ca)).b;
  vec3 color = vec3(r, g, b);

  // Fresnel — white glow at edges
  vec3 Nw = normalize(vWorldNormal);
  Nw *= gl_FrontFacing ? 1.0 : -1.0;
  vec3 V = normalize(vViewDir);
  float edge = 1.0 - abs(dot(V, Nw));
  float fresnel = pow(edge, 3.5);
  color = mix(color, vec3(1.0), fresnel * uFresnelIntensity * edgeMask);

  // Inner shadow at edges
  color *= mix(1.0, 0.88, edgeMask * edgeMask);

  // Animated specular highlights
  vec2 Nv = normalize(vViewNormal).xy;
  vec2 lp1 = vec2(sin(uTime * 0.3), cos(uTime * 0.4)) * 0.5;
  vec2 lp2 = vec2(cos(uTime * -0.35 + 1.5), sin(uTime * 0.25)) * 0.5;
  float h = smoothstep(0.55, 0.0, length(Nv - lp1)) * 0.08;
  h += smoothstep(0.65, 0.0, length(Nv - lp2)) * 0.06;
  color += vec3(h);

  // Fixed specular
  vec3 L = normalize(vec3(1.0, 2.0, 3.0));
  vec3 H = normalize(V + L);
  float spec = pow(max(dot(Nw, H), 0.0), uSpecPower);
  color += spec * uSpecIntensity;

  gl_FragColor = vec4(color, 1.0);
}
`;

export default function GlassHex() {
  const groupRef = useRef();
  const videoMeshRef = useRef();
  const projVec = useRef(new THREE.Vector3());
  const { gl, camera, size } = useThree();

  const fbo = useFBO();

  const hexRadius = 0.9;
  const hexDepth = 1.4;
  const hexHalfH = hexDepth / 2;

  const controls = useControls({
    "Liquid Glass": folder({
      borderRadius: { value: 0.25, min: 0.02, max: 0.8, step: 0.01, label: "Bevel Roundness" },
      refraction: { value: 0.12, min: 0, max: 0.5, step: 0.005, label: "Refraction" },
      scrollRefractionBoost: { value: 0.20, min: 0, max: 0.6, step: 0.01, label: "Scroll Boost" },
      chromaticAberration: { value: 0.4, min: 0, max: 2.0, step: 0.05, label: "Chromatic Aberr." },
      scrollCABoost: { value: 0.5, min: 0, max: 2.0, step: 0.05, label: "Scroll CA+" },
    }),
    "Glass Look": folder({
      fresnelIntensity: { value: 0.25, min: 0, max: 1.0, step: 0.01, label: "Fresnel" },
      specPower: { value: 200, min: 10, max: 500, step: 10, label: "Specular Sharpness" },
      specIntensity: { value: 0.25, min: 0, max: 1.0, step: 0.01, label: "Specular Brightness" },
    }),
  });

  const glassMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uBuffer: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uTime: { value: 0 },
          uHexCenter: { value: new THREE.Vector2(0.5, 0.5) },
          uHexRadius: { value: hexRadius },
          uHexHalfH: { value: hexHalfH },
          uBorderRadius: { value: 0.25 },
          uRefraction: { value: 0.12 },
          uCA: { value: 0.4 },
          uFresnelIntensity: { value: 0.25 },
          uSpecPower: { value: 200.0 },
          uSpecIntensity: { value: 0.25 },
        },
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
      }),
    []
  );

  const videoScene = useMemo(() => {
    const s = new THREE.Scene();
    s.background = new THREE.Color("#ffffff");
    return s;
  }, []);

  useEffect(() => {
    const video = document.createElement("video");
    video.src = "/video/Exein_Photon_Texture_130326.mp4";
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.play().catch(() => {
      document.addEventListener("click", () => video.play(), { once: true });
    });

    const tex = new THREE.VideoTexture(video);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(3.5, 3.5);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    videoScene.add(mesh);
    videoMeshRef.current = mesh;

    return () => {
      video.pause();
      tex.dispose();
      geo.dispose();
      mat.dispose();
      videoScene.remove(mesh);
    };
  }, [videoScene]);

  useEffect(() => {
    const dpr = gl.getPixelRatio();
    glassMat.uniforms.uResolution.value.set(
      size.width * dpr,
      size.height * dpr
    );
  }, [size, gl, glassMat]);

  useFrame(({ clock }) => {
    const p = scrollState.progress;

    if (groupRef.current) {
      groupRef.current.rotation.x = -0.15 + p * Math.PI * 2;
      groupRef.current.rotation.y = 0.45 + p * Math.PI * 4;
      const s = 1 + p * 0.3;
      groupRef.current.scale.setScalar(s);
      const phase = p * Math.PI * 4;
      groupRef.current.position.x = Math.sin(phase) * 0.6;
      groupRef.current.position.y = Math.cos(phase * 0.7) * 0.3;
    }

    if (videoMeshRef.current && groupRef.current) {
      videoMeshRef.current.position.copy(groupRef.current.position);
      videoMeshRef.current.scale.setScalar(groupRef.current.scale.x);
      videoMeshRef.current.quaternion.copy(camera.quaternion);
    }

    // Compute hex center in screen-space for radial refraction
    if (groupRef.current) {
      groupRef.current.getWorldPosition(projVec.current);
      projVec.current.project(camera);
      glassMat.uniforms.uHexCenter.value.set(
        projVec.current.x * 0.5 + 0.5,
        projVec.current.y * 0.5 + 0.5
      );
    }

    gl.setRenderTarget(fbo);
    gl.render(videoScene, camera);
    gl.setRenderTarget(null);

    const u = glassMat.uniforms;
    u.uBuffer.value = fbo.texture;
    u.uTime.value = clock.getElapsedTime();
    u.uBorderRadius.value = controls.borderRadius;
    u.uRefraction.value = controls.refraction + p * controls.scrollRefractionBoost;
    u.uCA.value = controls.chromaticAberration + p * controls.scrollCABoost;
    u.uFresnelIntensity.value = controls.fresnelIntensity;
    u.uSpecPower.value = controls.specPower;
    u.uSpecIntensity.value = controls.specIntensity;
  });

  return (
    <group ref={groupRef} rotation={[-0.15, 0.45, 0]}>
      <mesh material={glassMat}>
        <cylinderGeometry args={[0.9, 0.9, 1.4, 6]} />
      </mesh>
    </group>
  );
}
