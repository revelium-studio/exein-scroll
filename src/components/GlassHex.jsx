import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";
import * as THREE from "three";
import { scrollState } from "../store";

const vertexShader = /* glsl */ `
varying vec3 vViewNormal;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
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
uniform float     uEdgeRefraction;
uniform float     uEdgeCA;

varying vec3 vViewNormal;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  vec3 Nv = normalize(vViewNormal);
  Nv *= gl_FrontFacing ? 1.0 : -1.0;
  vec3 Nw = normalize(vWorldNormal);
  Nw *= gl_FrontFacing ? 1.0 : -1.0;
  vec3 V = normalize(vViewDir);

  // Edge factor: 0 when surface faces camera, 1 at grazing angle
  float edge = 1.0 - abs(dot(V, Nw));

  // --- Edge-only distortion mask ---
  // Center stays COMPLETELY clear; distortion fades in at edges only
  float edgeMask = smoothstep(0.2, 0.8, edge);

  // Bevel boost at extreme edges (liquid glass ridge)
  float bevel = pow(edge, 5.0);
  float totalMask = edgeMask + bevel * 1.5;

  // Refraction direction from view-space normals
  vec2 dir = Nv.xy;

  // Offset — zero in center, strong at edges
  float offset = totalMask * uEdgeRefraction;

  // Chromatic aberration — edge-only
  float ca = totalMask * uEdgeCA;

  // Sample video with per-channel offset (chromatic split)
  float r = texture2D(uBuffer, uv + dir * offset * (1.0 + ca)).r;
  float g = texture2D(uBuffer, uv + dir * offset).g;
  float b = texture2D(uBuffer, uv + dir * offset * (1.0 - ca)).b;
  vec3 color = vec3(r, g, b);

  // Fresnel — subtle white reflection at edges
  float fresnel = pow(edge, 3.5);
  color = mix(color, vec3(1.0), fresnel * 0.18);

  // Inner shadow — simulates glass thickness
  color *= mix(1.0, 0.88, edgeMask * edgeMask);

  // Animated specular highlights (liquid movement feel)
  vec2 lp1 = vec2(sin(uTime * 0.3), cos(uTime * 0.4)) * 0.5;
  vec2 lp2 = vec2(cos(uTime * -0.35 + 1.5), sin(uTime * 0.25)) * 0.5;
  float h = 0.0;
  h += smoothstep(0.55, 0.0, length(Nv.xy - lp1)) * 0.10;
  h += smoothstep(0.65, 0.0, length(Nv.xy - lp2)) * 0.07;
  color += vec3(h);

  // Fixed specular
  vec3 L1 = normalize(vec3(1.0, 2.0, 3.0));
  vec3 H1 = normalize(V + L1);
  float s1 = pow(max(dot(Nw, H1), 0.0), 220.0);
  color += s1 * 0.30;

  // Prismatic tint at extreme edges (dispersion simulation)
  float prism = smoothstep(0.55, 1.0, edge);
  vec3 rainbow = vec3(
    0.5 + 0.5 * sin(edge * 6.28),
    0.5 + 0.5 * sin(edge * 6.28 + 2.09),
    0.5 + 0.5 * sin(edge * 6.28 + 4.18)
  );
  color = mix(color, rainbow, prism * 0.06);

  gl_FragColor = vec4(color, 1.0);
}
`;

export default function GlassHex() {
  const groupRef = useRef();
  const videoMeshRef = useRef();
  const { gl, camera, size, viewport } = useThree();

  const fbo = useFBO();

  const videoScene = useMemo(() => {
    const s = new THREE.Scene();
    s.background = new THREE.Color("#ffffff");
    return s;
  }, []);

  const glassMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uBuffer: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uTime: { value: 0 },
          uEdgeRefraction: { value: 0.04 },
          uEdgeCA: { value: 0.012 },
        },
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
      }),
    []
  );

  useEffect(() => {
    const video = document.createElement("video");
    video.src = "/video/Exein_3D_Texture_White.mp4";
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

    const geo = new THREE.PlaneGeometry(4, 4);
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

    gl.setRenderTarget(fbo);
    gl.render(videoScene, camera);
    gl.setRenderTarget(null);

    glassMat.uniforms.uBuffer.value = fbo.texture;
    glassMat.uniforms.uTime.value = clock.getElapsedTime();
    glassMat.uniforms.uEdgeRefraction.value = 0.04 + p * 0.12;
    glassMat.uniforms.uEdgeCA.value = 0.012 + p * 0.035;
  });

  return (
    <group ref={groupRef} rotation={[-0.15, 0.45, 0]}>
      <mesh material={glassMat}>
        <cylinderGeometry args={[0.9, 0.9, 1.4, 6]} />
      </mesh>
    </group>
  );
}
