import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshTransmissionMaterial, useFBO } from "@react-three/drei";
import * as THREE from "three";
import { scrollState } from "../store";

export default function GlassHex() {
  const groupRef = useRef();
  const materialRef = useRef();
  const videoMeshRef = useRef();
  const { gl, camera } = useThree();

  const fbo = useFBO();

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

    if (materialRef.current) {
      materialRef.current.thickness = 0.3 + p * 2.0;
      materialRef.current.chromaticAberration = 0.02 + p * 0.12;
    }
  });

  return (
    <group ref={groupRef} rotation={[-0.15, 0.45, 0]}>
      <mesh>
        <cylinderGeometry args={[0.9, 0.9, 1.4, 6]} />
        <MeshTransmissionMaterial
          ref={materialRef}
          buffer={fbo.texture}
          samples={10}
          resolution={512}
          transmission={1}
          roughness={0.15}
          thickness={0.3}
          ior={1.2}
          chromaticAberration={0.02}
          anisotropy={10}
          distortion={0}
          distortionScale={0}
          temporalDistortion={0}
          attenuationDistance={0.5}
          attenuationColor="#ffffff"
          color="#ffffff"
          envMapIntensity={0.5}
          dispersion={12}
        />
      </mesh>
    </group>
  );
}
