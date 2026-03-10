import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Leva } from "leva";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Scene from "./components/Scene";
import { scrollState } from "./store";

gsap.registerPlugin(ScrollTrigger);

export default function App() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smooth: true,
    });

    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);

    ScrollTrigger.create({
      trigger: ".scroll-container",
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        scrollState.progress = self.progress;
      },
    });

    return () => {
      lenis.destroy();
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, []);

  return (
    <>
      <Leva collapsed={false} flat titleBar={{ title: "Glass Controls" }} />
      <div className="canvas-wrapper">
        <Canvas
          camera={{ position: [0, 0, 5], fov: 45 }}
          gl={{ antialias: true, alpha: false }}
          onCreated={({ gl }) => gl.setClearColor("#ffffff")}
        >
          <Scene />
        </Canvas>
      </div>
      <div className="scroll-container" />
    </>
  );
}
