import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";
import { useControls, folder } from "leva";
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
uniform float     uEdgeMaskStart;
uniform float     uEdgeMaskEnd;
uniform float     uBevelPower;
uniform float     uBevelStrength;
uniform float     uFresnelPower;
uniform float     uFresnelIntensity;
uniform float     uSpecPower;
uniform float     uSpecIntensity;
uniform float     uInnerShadow;
uniform float     uPrismIntensity;

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

  float edge = 1.0 - abs(dot(V, Nw));

  float edgeMask = smoothstep(uEdgeMaskStart, uEdgeMaskEnd, edge);
  float bevel = pow(edge, uBevelPower);
  float totalMask = edgeMask + bevel * uBevelStrength;

  vec2 dir = Nv.xy;
  float offset = totalMask * uEdgeRefraction;
  float ca = totalMask * uEdgeCA;

  float r = texture2D(uBuffer, uv + dir * offset * (1.0 + ca)).r;
  float g = texture2D(uBuffer, uv + dir * offset).g;
  float b = texture2D(uBuffer, uv + dir * offset * (1.0 - ca)).b;
  vec3 color = vec3(r, g, b);

  float fresnel = pow(edge, uFresnelPower);
  color = mix(color, vec3(1.0), fresnel * uFresnelIntensity);

  color *= mix(1.0, 1.0 - uInnerShadow, edgeMask * edgeMask);

  vec2 lp1 = vec2(sin(uTime * 0.3), cos(uTime * 0.4)) * 0.5;
  vec2 lp2 = vec2(cos(uTime * -0.35 + 1.5), sin(uTime * 0.25)) * 0.5;
  float h = 0.0;
  h += smoothstep(0.55, 0.0, length(Nv.xy - lp1)) * 0.10;
  h += smoothstep(0.65, 0.0, length(Nv.xy - lp2)) * 0.07;
  color += vec3(h);

  vec3 L1 = normalize(vec3(1.0, 2.0, 3.0));
  vec3 H1 = normalize(V + L1);
  float s1 = pow(max(dot(Nw, H1), 0.0), uSpecPower);
  color += s1 * uSpecIntensity;

  float prism = smoothstep(0.55, 1.0, edge);
  vec3 rainbow = vec3(
    0.5 + 0.5 * sin(edge * 6.28),
    0.5 + 0.5 * sin(edge * 6.28 + 2.09),
    0.5 + 0.5 * sin(edge * 6.28 + 4.18)
  );
  color = mix(color, rainbow, prism * uPrismIntensity);

  gl_FragColor = vec4(color, 1.0);
}
`;

export default function GlassHex() {
  const groupRef = useRef();
  const videoMeshRef = useRef();
  const { gl, camera, size } = useThree();

  const fbo = useFBO();

  const controls = useControls({
    "Edge Refraction": folder({
      edgeRefraction: { value: 0.10, min: 0, max: 0.5, step: 0.005, label: "Strength" },
      scrollRefractionBoost: { value: 0.20, min: 0, max: 0.6, step: 0.01, label: "Scroll Boost" },
      edgeCA: { value: 0.025, min: 0, max: 0.15, step: 0.005, label: "Chromatic Aberration" },
      scrollCABoost: { value: 0.05, min: 0, max: 0.2, step: 0.005, label: "Scroll CA Boost" },
    }),
    "Edge Mask": folder({
      edgeMaskStart: { value: 0.15, min: 0, max: 0.5, step: 0.01, label: "Start" },
      edgeMaskEnd: { value: 0.75, min: 0.3, max: 1.0, step: 0.01, label: "End" },
      bevelPower: { value: 4.0, min: 1, max: 12, step: 0.5, label: "Bevel Power" },
      bevelStrength: { value: 2.0, min: 0, max: 5, step: 0.1, label: "Bevel Strength" },
    }),
    "Glass Look": folder({
      fresnelPower: { value: 3.0, min: 1, max: 8, step: 0.1, label: "Fresnel Power" },
      fresnelIntensity: { value: 0.20, min: 0, max: 0.6, step: 0.01, label: "Fresnel Intensity" },
      specPower: { value: 200, min: 10, max: 500, step: 10, label: "Specular Power" },
      specIntensity: { value: 0.35, min: 0, max: 1.0, step: 0.01, label: "Specular Intensity" },
      innerShadow: { value: 0.12, min: 0, max: 0.4, step: 0.01, label: "Inner Shadow" },
      prismIntensity: { value: 0.06, min: 0, max: 0.3, step: 0.01, label: "Prismatic Tint" },
    }),
  });

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
          uEdgeRefraction: { value: 0.10 },
          uEdgeCA: { value: 0.025 },
          uEdgeMaskStart: { value: 0.15 },
          uEdgeMaskEnd: { value: 0.75 },
          uBevelPower: { value: 4.0 },
          uBevelStrength: { value: 2.0 },
          uFresnelPower: { value: 3.0 },
          uFresnelIntensity: { value: 0.20 },
          uSpecPower: { value: 200.0 },
          uSpecIntensity: { value: 0.35 },
          uInnerShadow: { value: 0.12 },
          uPrismIntensity: { value: 0.06 },
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

    const u = glassMat.uniforms;
    u.uBuffer.value = fbo.texture;
    u.uTime.value = clock.getElapsedTime();

    u.uEdgeRefraction.value = controls.edgeRefraction + p * controls.scrollRefractionBoost;
    u.uEdgeCA.value = controls.edgeCA + p * controls.scrollCABoost;
    u.uEdgeMaskStart.value = controls.edgeMaskStart;
    u.uEdgeMaskEnd.value = controls.edgeMaskEnd;
    u.uBevelPower.value = controls.bevelPower;
    u.uBevelStrength.value = controls.bevelStrength;
    u.uFresnelPower.value = controls.fresnelPower;
    u.uFresnelIntensity.value = controls.fresnelIntensity;
    u.uSpecPower.value = controls.specPower;
    u.uSpecIntensity.value = controls.specIntensity;
    u.uInnerShadow.value = controls.innerShadow;
    u.uPrismIntensity.value = controls.prismIntensity;
  });

  return (
    <group ref={groupRef} rotation={[-0.15, 0.45, 0]}>
      <mesh material={glassMat}>
        <cylinderGeometry args={[0.9, 0.9, 1.4, 6]} />
      </mesh>
    </group>
  );
}
