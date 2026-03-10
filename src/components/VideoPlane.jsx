import { useRef, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { scrollState } from "../store";

export default function VideoPlane() {
  const meshRef = useRef();
  const [videoTexture, setVideoTexture] = useState(null);

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
    setVideoTexture(tex);

    return () => {
      video.pause();
      tex.dispose();
    };
  }, []);

  useFrame(() => {
    if (!meshRef.current) return;
    const p = scrollState.progress;
    const phase = p * Math.PI * 4;
    meshRef.current.position.x = Math.sin(phase) * 0.6;
    meshRef.current.position.y = Math.cos(phase * 0.7) * 0.3;
  });

  if (!videoTexture) return null;

  return (
    <mesh ref={meshRef} position={[0, 0, -1]}>
      <planeGeometry args={[4, 4]} />
      <meshBasicMaterial map={videoTexture} toneMapped={false} />
    </mesh>
  );
}
