import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import { scrollState } from "../store";

export default function GlassHex() {
  const groupRef = useRef();
  const materialRef = useRef();

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

    if (materialRef.current) {
      materialRef.current.distortion = 0.15 + p * 1.8;
      materialRef.current.temporalDistortion = 0.05 + p * 0.6;
      materialRef.current.thickness = 1.2 + p * 1.5;
      materialRef.current.chromaticAberration = 0.04 + p * 0.12;
    }
  });

  return (
    <group ref={groupRef} rotation={[-0.15, 0.45, 0]}>
      <mesh>
        <cylinderGeometry args={[0.9, 0.9, 1.4, 6]} />
        <MeshTransmissionMaterial
          ref={materialRef}
          backside
          backsideThickness={0.4}
          samples={16}
          resolution={1024}
          transmission={1}
          roughness={0.05}
          thickness={1.2}
          ior={1.5}
          chromaticAberration={0.04}
          anisotropy={0.1}
          distortion={0.15}
          distortionScale={0.4}
          temporalDistortion={0.05}
          clearcoat={1}
          clearcoatRoughness={0.1}
          attenuationDistance={0.6}
          attenuationColor="#ffffff"
          color="#ffffff"
          toneMapped={true}
        />
      </mesh>
    </group>
  );
}
