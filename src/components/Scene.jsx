import { Suspense } from "react";
import { Environment } from "@react-three/drei";
import GlassHex from "./GlassHex";

export default function Scene() {
  return (
    <>
      <color attach="background" args={["#ffffff"]} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.5} />
      <directionalLight position={[-3, 2, 4]} intensity={0.3} />

      <Suspense fallback={null}>
        <Environment preset="city" />
        <GlassHex />
      </Suspense>
    </>
  );
}
