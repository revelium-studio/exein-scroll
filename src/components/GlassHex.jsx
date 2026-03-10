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
uniform float     uHexRadius;
uniform float     uHexHalfH;
uniform float     uBorderRadius;
uniform float     uSdfStrength;
uniform float     uIor;
uniform float     uThickness;
uniform float     uCA;
uniform float     uFresnelIntensity;
uniform float     uSpecPower;
uniform float     uSpecIntensity;
uniform float     uPrismIntensity;

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

  // --- SDF-based edge detection (Apple liquid glass approach) ---
  float dHex = -hexDist(vObjPos.xz, uHexRadius);
  float dCap = uHexHalfH - abs(vObjPos.y);

  float capFactor = abs(normalize(vObjNormal).y);
  float surfDist = mix(max(dCap, 0.0), max(dHex, 0.0), capFactor);

  float edgeMask = 1.0 - smoothstep(0.0, uBorderRadius, surfDist);

  // Screen-space gradient of surfDist → refraction direction
  vec2 grad = vec2(dFdx(surfDist), dFdy(surfDist));
  float gradLen = length(grad);

  // Fake 3D normal: XY from SDF gradient, Z domes toward center
  vec2 normalXY = gradLen > 0.0001 ? -grad / gradLen : vec2(0.0);
  float normalZ = smoothstep(0.0, uBorderRadius, surfDist);
  vec3 fakeN = normalize(vec3(normalXY * uSdfStrength, max(normalZ, 0.01)));

  // Snell's law refraction
  vec3 incident = vec3(0.0, 0.0, -1.0);
  vec3 refracted = refract(incident, fakeN, 1.0 / uIor);
  vec2 offset = refracted.xy * uThickness * edgeMask;

  // Chromatic aberration
  float ca = uCA * edgeMask;
  float r = texture2D(uBuffer, uv + offset * (1.0 + ca)).r;
  float g = texture2D(uBuffer, uv + offset).g;
  float b = texture2D(uBuffer, uv + offset * (1.0 - ca)).b;
  vec3 color = vec3(r, g, b);

  // Fresnel reflection
  float cosTheta = max(dot(fakeN, vec3(0.0, 0.0, 1.0)), 0.0);
  float fresnel = pow(1.0 - cosTheta, 5.0);
  color = mix(color, vec3(1.0), fresnel * uFresnelIntensity * edgeMask);

  // Inner shadow at edges
  color *= mix(1.0, 0.88, edgeMask * edgeMask);

  // Animated specular highlights (liquid feel)
  vec2 Nv = normalize(vViewNormal).xy;
  vec2 lp1 = vec2(sin(uTime * 0.3), cos(uTime * 0.4)) * 0.5;
  vec2 lp2 = vec2(cos(uTime * -0.35 + 1.5), sin(uTime * 0.25)) * 0.5;
  float h = smoothstep(0.55, 0.0, length(Nv - lp1)) * 0.10;
  h += smoothstep(0.65, 0.0, length(Nv - lp2)) * 0.07;
  color += vec3(h);

  // Fixed specular
  vec3 Nw = normalize(vWorldNormal);
  Nw *= gl_FrontFacing ? 1.0 : -1.0;
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(vec3(1.0, 2.0, 3.0));
  vec3 H = normalize(V + L);
  float spec = pow(max(dot(Nw, H), 0.0), uSpecPower);
  color += spec * uSpecIntensity;

  // Prismatic tint at edges
  vec3 rainbow = vec3(
    0.5 + 0.5 * sin(edgeMask * 6.28),
    0.5 + 0.5 * sin(edgeMask * 6.28 + 2.09),
    0.5 + 0.5 * sin(edgeMask * 6.28 + 4.18)
  );
  color = mix(color, rainbow, edgeMask * edgeMask * uPrismIntensity);

  gl_FragColor = vec4(color, 1.0);
}
`;

export default function GlassHex() {
  const groupRef = useRef();
  const videoMeshRef = useRef();
  const { gl, camera, size } = useThree();

  const fbo = useFBO();

  const hexRadius = 0.9;
  const hexDepth = 1.4;
  const hexHalfH = hexDepth / 2;

  const geoControls = useControls("Geometry", {
    bevelSize: { value: 0.12, min: 0.02, max: 0.35, step: 0.01 },
    bevelSegments: { value: 6, min: 2, max: 12, step: 1 },
  });

  const controls = useControls({
    "Liquid Glass (SDF)": folder({
      borderRadius: { value: 0.25, min: 0.02, max: 0.8, step: 0.01, label: "Bevel Roundness" },
      sdfStrength: { value: 1.5, min: 0.1, max: 5.0, step: 0.1, label: "SDF Normal Strength" },
      ior: { value: 1.5, min: 1.0, max: 3.0, step: 0.05, label: "IOR (Glass)" },
      thickness: { value: 0.4, min: 0.0, max: 2.0, step: 0.01, label: "Glass Thickness" },
      scrollThicknessBoost: { value: 0.8, min: 0, max: 3.0, step: 0.05, label: "Scroll Thickness+" },
      chromaticAberration: { value: 0.5, min: 0.0, max: 2.0, step: 0.05, label: "Chromatic Aberr." },
      scrollCABoost: { value: 0.6, min: 0, max: 2.0, step: 0.05, label: "Scroll CA+" },
    }),
    "Glass Look": folder({
      fresnelIntensity: { value: 0.3, min: 0, max: 1.0, step: 0.01, label: "Fresnel" },
      specPower: { value: 200, min: 10, max: 500, step: 10, label: "Specular Power" },
      specIntensity: { value: 0.30, min: 0, max: 1.0, step: 0.01, label: "Specular Intensity" },
      prismIntensity: { value: 0.05, min: 0, max: 0.3, step: 0.01, label: "Prismatic Tint" },
    }),
  });

  const hexGeo = useMemo(() => {
    const shape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * hexRadius;
      const y = Math.sin(a) * hexRadius;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();

    const bs = geoControls.bevelSize;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: hexDepth,
      bevelEnabled: true,
      bevelThickness: bs,
      bevelSize: bs,
      bevelSegments: geoControls.bevelSegments,
    });

    geo.translate(0, 0, -hexDepth / 2);
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }, [geoControls.bevelSize, geoControls.bevelSegments]);

  const glassMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uBuffer: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uTime: { value: 0 },
          uHexRadius: { value: hexRadius },
          uHexHalfH: { value: hexHalfH },
          uBorderRadius: { value: 0.25 },
          uSdfStrength: { value: 1.5 },
          uIor: { value: 1.5 },
          uThickness: { value: 0.4 },
          uCA: { value: 0.5 },
          uFresnelIntensity: { value: 0.3 },
          uSpecPower: { value: 200.0 },
          uSpecIntensity: { value: 0.30 },
          uPrismIntensity: { value: 0.05 },
        },
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
        extensions: { derivatives: true },
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
    u.uBorderRadius.value = controls.borderRadius;
    u.uSdfStrength.value = controls.sdfStrength;
    u.uIor.value = controls.ior;
    u.uThickness.value = controls.thickness + p * controls.scrollThicknessBoost;
    u.uCA.value = controls.chromaticAberration + p * controls.scrollCABoost;
    u.uFresnelIntensity.value = controls.fresnelIntensity;
    u.uSpecPower.value = controls.specPower;
    u.uSpecIntensity.value = controls.specIntensity;
    u.uPrismIntensity.value = controls.prismIntensity;
  });

  return (
    <group ref={groupRef} rotation={[-0.15, 0.45, 0]}>
      <mesh geometry={hexGeo} material={glassMat} />
    </group>
  );
}
