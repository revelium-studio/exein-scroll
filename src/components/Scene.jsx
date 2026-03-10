import { Suspense } from "react";
import { Environment } from "@react-three/drei";
import GlassHex from "./GlassHex";
import VideoPlane from "./VideoPlane";

export default function Scene() {
  return (
    <>
      <color attach="background" args={["#ffffff"]} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />
      <directionalLight position={[-3, 2, 4]} intensity={0.3} />

      <Suspense fallback={null}>
        <Environment preset="city" />
        <VideoPlane />
        <GlassHex />
      </Suspense>
    </>
  );
}
