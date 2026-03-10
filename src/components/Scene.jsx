import { Suspense } from "react";
import GlassHex from "./GlassHex";

export default function Scene() {
  return (
    <>
      <color attach="background" args={["#ffffff"]} />
      <Suspense fallback={null}>
        <GlassHex />
      </Suspense>
    </>
  );
}
