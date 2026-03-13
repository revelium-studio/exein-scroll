import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useFBO } from "@react-three/drei";
import { useControls, folder } from "leva";
import * as THREE from "three";
import { scrollState } from "../store";

const vertexShader = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir     = normalize(cameraPosition - worldPos.xyz);
  gl_Position  = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uBuffer;
uniform vec2      uResolution;
uniform float     uIorR;
uniform float     uIorG;
uniform float     uIorB;
uniform float     uRefraction;
uniform float     uFresnelPower;
uniform float     uFresnelIntensity;
uniform float     uSaturation;
uniform float     uSpecIntensity;
uniform float     uSpecPower;

varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  vec3 normal = normalize(vWorldNormal);
  normal *= gl_FrontFacing ? 1.0 : -1.0;
  vec3 V = normalize(vViewDir);

  // Diamond-style refraction: Snell's law with different IOR per channel
  vec3 refR = refract(-V, normal, 1.0 / uIorR);
  vec3 refG = refract(-V, normal, 1.0 / uIorG);
  vec3 refB = refract(-V, normal, 1.0 / uIorB);

  float r = texture2D(uBuffer, uv + refR.xy * uRefraction).r;
  float g = texture2D(uBuffer, uv + refG.xy * uRefraction).g;
  float b = texture2D(uBuffer, uv + refB.xy * uRefraction).b;

  vec3 color = vec3(r, g, b);

  // Fresnel — edge glow
  float cosTheta = max(dot(V, normal), 0.0);
  float fresnel = pow(1.0 - cosTheta, uFresnelPower);
  color = mix(color, vec3(1.0), fresnel * uFresnelIntensity);

  // Specular highlight
  vec3 L = normalize(vec3(1.0, 2.0, 3.0));
  vec3 H = normalize(V + L);
  float spec = pow(max(dot(normal, H), 0.0), uSpecPower);
  color += spec * uSpecIntensity;

  // Saturation control
  float lum = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(lum), color, uSaturation);

  gl_FragColor = vec4(color, 1.0);
}
`;

export default function GlassHex() {
  const groupRef = useRef();
  const videoMeshRef = useRef();
  const { gl, camera, size } = useThree();

  const fbo = useFBO();

  const controls = useControls({
    "Refraction": folder({
      iorR: { value: 1.16, min: 1.0, max: 2.5, step: 0.01, label: "IOR Red" },
      iorG: { value: 1.22, min: 1.0, max: 2.5, step: 0.01, label: "IOR Green" },
      iorB: { value: 1.30, min: 1.0, max: 2.5, step: 0.01, label: "IOR Blue" },
      refraction: { value: 0.45, min: 0, max: 1.5, step: 0.01, label: "Strength" },
      scrollBoost: { value: 0.35, min: 0, max: 1.0, step: 0.01, label: "Scroll +" },
    }),
    "Glass": folder({
      fresnelPower: { value: 3.0, min: 1, max: 8, step: 0.1, label: "Fresnel Power" },
      fresnelIntensity: { value: 0.25, min: 0, max: 1.0, step: 0.01, label: "Fresnel Intensity" },
      specPower: { value: 200, min: 10, max: 500, step: 10, label: "Specular Sharpness" },
      specIntensity: { value: 0.20, min: 0, max: 1.0, step: 0.01, label: "Specular Brightness" },
      saturation: { value: 1.15, min: 0.5, max: 2.0, step: 0.05, label: "Saturation" },
    }),
  });

  const glassMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uBuffer: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uIorR: { value: 1.16 },
          uIorG: { value: 1.22 },
          uIorB: { value: 1.30 },
          uRefraction: { value: 0.45 },
          uFresnelPower: { value: 3.0 },
          uFresnelIntensity: { value: 0.25 },
          uSpecPower: { value: 200.0 },
          uSpecIntensity: { value: 0.20 },
          uSaturation: { value: 1.15 },
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

    const geo = new THREE.PlaneGeometry(5, 5);
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

  useFrame(() => {
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
    u.uIorR.value = controls.iorR;
    u.uIorG.value = controls.iorG;
    u.uIorB.value = controls.iorB;
    u.uRefraction.value = controls.refraction + p * controls.scrollBoost;
    u.uFresnelPower.value = controls.fresnelPower;
    u.uFresnelIntensity.value = controls.fresnelIntensity;
    u.uSpecPower.value = controls.specPower;
    u.uSpecIntensity.value = controls.specIntensity;
    u.uSaturation.value = controls.saturation;
  });

  return (
    <group ref={groupRef} rotation={[-0.15, 0.45, 0]}>
      <mesh material={glassMat}>
        <cylinderGeometry args={[0.9, 0.9, 1.4, 6]} />
      </mesh>
    </group>
  );
}
