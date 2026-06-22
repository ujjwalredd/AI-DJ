import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, useGLTF, PresentationControls, Environment, Lightformer } from '@react-three/drei';
import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useDJ } from '../store.js';

const EMPTY_A = { title: 'AI DJ', artist: 'Autonomous AI DJ', bpm: 122, camelot: '8A' };
const EMPTY_B = { title: 'Cue Ready', artist: 'Next record', bpm: 124, camelot: '9A' };
const REAL_CONTROLLER_URL = '/models/dj-controller.glb';
useGLTF.preload(REAL_CONTROLLER_URL);

export default function DJStage3D({ cameraPhase = 'live' }) {
  const engine = useDJ((s) => s.engine);
  const nowPlaying = useDJ((s) => s.nowPlaying);
  const upNext = useDJ((s) => s.upNext);
  const phase = useDJ((s) => s.phase);
  const [, force] = useState(0);
  const reducedMotion = useReducedMotion();
  const realModelAvailable = useModelAvailable(REAL_CONTROLLER_URL);

  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 120);
    return () => window.clearInterval(id);
  }, []);

  const landing = cameraPhase === 'landing';
  const deckA = engine?.deckState('A') || demoDeck('A', nowPlaying || EMPTY_A, phase === 'playing' || landing);
  const deckB = engine?.deckState('B') || demoDeck('B', upNext || EMPTY_B, landing);
  const transition = engine?.transitionInfo?.() || null;
  const fallback = (
    <ControllerFallback deckA={deckA} deckB={deckB} transition={transition} demo={landing} position={[0, -0.5, 0]} scale={0.62} />
  );

  function CameraController({ engine, cameraPhase, reducedMotion }) {
    const target = useMemo(() => new THREE.Vector3(), []);
    const lookAtTarget = useMemo(() => new THREE.Vector3(0, 0.35, 0), []);

    useFrame(({ camera, clock }, delta) => {
      if (cameraPhase === 'landing' || cameraPhase === 'setup') {
        // Landing and setup pages: straight, pulled-back view
        target.set(0, 0, 15.5);
        lookAtTarget.set(0, 0.0, 0.0);
      } else {
        // Live page: zoom in to 10.5 and raise the camera to y=3.5 to tilt the model up from the back
        target.set(0, 3.5, 10.5);
        lookAtTarget.set(0, 0.0, 0.0);
      }

      // Smoothly interpolate to target
      camera.position.lerp(target, delta * 2.5);
      camera.lookAt(lookAtTarget);
    });
    return null;
  }

  function AIBrain({ live }) {
    const groupRef = useRef();
    const outerRef = useRef();
    const innerRef = useRef();
    const materialRef = useRef();
    const feed = useDJ((s) => s.feed);
    const [flash, setFlash] = useState(0);
    const feedLengthRef = useRef(feed.length);

    useEffect(() => {
      if (feed.length > feedLengthRef.current) {
        setFlash(1);
        feedLengthRef.current = feed.length;
      }
    }, [feed]);

    // Color palettes for the inner core
    const colorA = useMemo(() => new THREE.Color('#00ffff'), []); // Cyan
    const colorB = useMemo(() => new THREE.Color('#ff00ff'), []); // Magenta
    const currentColor = useMemo(() => new THREE.Color('#00ffff'), []);

    useFrame((state, delta) => {
      const t = state.clock.elapsedTime;

      // Gentle floating animation
      if (groupRef.current) {
        groupRef.current.position.y = Math.sin(t * 1.5) * 0.2; // Holographic float
      }

      if (live) {
        const bass = engine?.bass?.() || 0;
        const mid = engine?.mid?.() || 0;
        const treble = engine?.treble?.() || 0;

        if (flash > 0) setFlash((f) => Math.max(0, f - delta * 2.5));

        // Smooth audio reactivity
        const ud = groupRef.current.userData;
        if (ud.bass === undefined) {
          ud.bass = 0;
          ud.mid = 0;
          ud.treble = 0;
        }
        ud.bass = THREE.MathUtils.lerp(ud.bass, bass, 0.15);
        ud.mid = THREE.MathUtils.lerp(ud.mid, mid, 0.15);
        ud.treble = THREE.MathUtils.lerp(ud.treble, treble, 0.15);

        const bassReact = ud.bass;
        const midReact = ud.mid;
        const trebleReact = ud.treble;

        if (outerRef.current) {
          // Outer neural web spins slowly, expanding on bass
          outerRef.current.rotation.x += delta * (0.05 + bassReact * 0.2);
          outerRef.current.rotation.y += delta * (0.1 + midReact * 0.3);
          const outerScale = 1.0 + bassReact * 0.2 + flash * 0.1;
          outerRef.current.scale.setScalar(outerScale);
        }

        if (innerRef.current) {
          // Inner core spins very fast to the treble
          innerRef.current.rotation.x -= delta * (0.2 + trebleReact * 0.6);
          innerRef.current.rotation.z += delta * (0.3 + trebleReact * 0.5);
          const innerScale = 1.0 + bassReact * 0.5 + flash * 0.3;
          innerRef.current.scale.setScalar(innerScale);
        }

        if (materialRef.current) {
          // Shift inner core color based on mid/high frequencies
          const mixRatio = Math.min(1, (midReact + trebleReact) * 0.8);
          currentColor.lerpColors(colorA, colorB, mixRatio);
          materialRef.current.color.copy(currentColor);
        }
      } else {
        if (flash > 0) setFlash(0);

        if (outerRef.current) {
          outerRef.current.rotation.x += delta * 0.05;
          outerRef.current.rotation.y += delta * 0.1;
          outerRef.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
        }
        if (innerRef.current) {
          innerRef.current.rotation.x -= delta * 0.2;
          innerRef.current.rotation.z += delta * 0.3;
          innerRef.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
        }
        if (materialRef.current) {
          currentColor.lerpColors(colorA, colorB, 0);
          materialRef.current.color.copy(currentColor);
        }
      }
    });

    return (
      // Pushed back to frame the DJ
      <group ref={groupRef} position={[0, 2.0, -8.0]}>
        {/* Outer Neural Web - Point Cloud */}
        <points ref={outerRef}>
          {/* Detail 16 creates a MASSIVE, highly structured neural point cloud */}
          <icosahedronGeometry args={[5.5, 16]} />
          <pointsMaterial
            color="#333333"
            size={0.03}
            transparent={true}
            opacity={0.6}
            depthWrite={false}
          />
        </points>
        
        {/* Inner Processing Core - Point Cloud */}
        <points ref={innerRef}>
          {/* Detail 12 creates a dense glowing inner core */}
          <icosahedronGeometry args={[2.5, 12]} />
          <pointsMaterial
            ref={materialRef}
            color="#00ffff"
            size={0.05}
            transparent={true}
            opacity={0.9}
            depthWrite={false}
          />
        </points>
      </group>
    );
  }

  return (
    <div className="absolute inset-0" aria-hidden="true" data-stage-mode={cameraPhase}>
      <Canvas
        shadows
        camera={{ position: [5.4, 3.5, 6.4], fov: 40 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        dpr={[1, 1.75]}
      >
        <Suspense fallback={null}>
          <CameraController engine={engine} cameraPhase={cameraPhase} reducedMotion={reducedMotion} />
          {cameraPhase === 'live' && <AIBrain live={true} />}
          <ambientLight intensity={1.15} />
          <hemisphereLight args={['#ffffff', '#c8ccd2', 1.0]} />
          <directionalLight color="#ffffff" position={[3, 8, 4]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
          <directionalLight color="#eef2f6" position={[-5, 4, -2]} intensity={0.7} />
          {/* Procedural studio IBL (no network) so metal/plastic catches light, not a black blob */}
          <Environment resolution={256}>
            <Lightformer intensity={2.2} position={[0, 5, 3]} scale={[10, 6, 1]} color="#ffffff" />
            <Lightformer intensity={1.4} position={[-6, 2, 1]} scale={[4, 8, 1]} color="#ffffff" />
            <Lightformer intensity={1.4} position={[6, 2, 1]} scale={[4, 8, 1]} color="#ffffff" />
            <Lightformer intensity={1.0} position={[0, 3, -6]} scale={[10, 6, 1]} color="#dfe6ee" />
          </Environment>
          <StageLights engine={engine} minimal={false} />
          <Suspense fallback={null}>
            <PresentationControls
              enabled={cameraPhase !== 'live'}
              global={true}
              snap={{ mass: 4, tension: 400 }}
              speed={1.5}
              zoom={1}
              polar={[-Math.PI, Math.PI]}
              azimuth={[-Infinity, Infinity]}
            >
              <RealController deckA={deckA} deckB={deckB} transition={transition} reducedMotion={reducedMotion} landing={landing} />
            </PresentationControls>
          </Suspense>
          <ContactShadows position={[0, -0.02, 0]} opacity={0.5} scale={20} blur={2.6} far={1.5} frames={1} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function ControllerFallback({ deckA, deckB, transition, demo, position, scale }) {
  return (
    <group position={position} scale={scale}>
      <Booth deckA={deckA} deckB={deckB} transition={transition} demo={demo} />
    </group>
  );
}

// Load + auto-fit ANY controller GLB (part names vary), then drive a live overlay
// rig anchored to its bounds - so faders/VU/telemetry animate on top of the
// real model regardless of how the GLB was authored.
function useFittedModel(url, target) {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const obj = scene.clone(true);
    obj.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const mats = Array.isArray(node.material) ? node.material : [node.material].filter(Boolean);
      for (const m of mats) {
        // Keep it matte so it reads as real plastic/metal under studio light instead
        // of a black mirror (high metalness + no reflections = near-black blob).
        if ('metalness' in m) m.metalness = Math.min(0.35, m.metalness ?? 0.2);
        if ('roughness' in m) m.roughness = Math.max(0.45, Math.min(0.85, m.roughness ?? 0.6));
        if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.1;
      }
    });
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = target / (Math.max(size.x, size.z) || 1);
    obj.scale.setScalar(scale);
    obj.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    return { object: obj, width: size.x * scale, height: size.y * scale, depth: size.z * scale };
  }, [scene, target]);
}

function RealController({ deckA, deckB, transition, reducedMotion, landing }) {
  const fit = useFittedModel(REAL_CONTROLLER_URL, 6.4);
  const spin = useRef();

  // Model remains perfectly static on landing page

  return (
    <group ref={spin} position={[0, -0.5, 0]}>
      <primitive object={fit.object} />
    </group>
  );
}

// Live, engine-driven controls floating on the model's top surface.
function OverlayRig({ fit, deckA, deckB, transition, reducedMotion, modelMode = 'procedural' }) {
  const top = (fit?.height || 1) + 0.03;
  const halfW = (fit?.width || 6) / 2;
  const halfD = (fit?.depth || 3) / 2;
  const jx = halfW * 0.62;
  const cross = transition?.progress ?? crossFromDecks(deckA, deckB);
  const realModel = modelMode === 'real';
  return (
    <group>
      {!realModel && (
        <>
          <JogDeck x={-jx} y={top} deck={deckA} color="#2dd4bf" reducedMotion={reducedMotion} />
          <JogDeck x={jx} y={top} deck={deckB} color="#a78bfa" reducedMotion={reducedMotion} />
          <TelemetryScreen x={-jx} y={top} deck={deckA} side="A" />
          <TelemetryScreen x={jx} y={top} deck={deckB} side="B" />
        </>
      )}
      {realModel && (
        <>
          <ModelCueLight x={-halfW * 0.34} z={-halfD * 0.42} y={top} deck={deckA} color="#2dd4bf" />
          <ModelCueLight x={halfW * 0.34} z={-halfD * 0.42} y={top} deck={deckB} color="#a78bfa" />
        </>
      )}
      <group position={[0, top, halfW * 0.12]}>
        <VuTower x={-0.2} gain={deckA?.gain || 0} />
        <VuTower x={0.2} gain={deckB?.gain || 0} />
        <mesh position={[THREE.MathUtils.lerp(-0.55, 0.55, clamp01(cross)), 0.07, 1.0]}>
          <boxGeometry args={[0.34, 0.08, 0.18]} />
          <meshStandardMaterial color="#e6fff8" emissive="#22c55e" emissiveIntensity={0.6} roughness={0.24} metalness={0.45} />
        </mesh>
        <Label text={`AI MIX ${Math.round(cross * 100)}%`} position={[0, 0.14, 1.36]} width={1.05} height={0.18} color="#86efac" size={32} />
      </group>
    </group>
  );
}

function ModelCueLight({ x, y, z, deck, color }) {
  const live = deck?.spinning || deck?.active;
  return (
    <group position={[x, y + 0.03, z]}>
      <mesh>
        <boxGeometry args={[0.28, 0.035, 0.12]} />
        <meshStandardMaterial color={live ? color : '#26323e'} emissive={color} emissiveIntensity={live ? 0.85 : 0.08} roughness={0.3} metalness={0.35} />
      </mesh>
      <Label text={deck?.name || 'DECK'} position={[0, 0.06, 0.18]} width={0.34} height={0.1} color="#f8fafc" size={22} />
    </group>
  );
}

function JogDeck({ x, y, deck, color, reducedMotion }) {
  const ring = useRef();
  const rec = useRecordTexture(deck?.meta, deck?.name === 'B' ? 'B' : 'A');
  const spinning = deck?.spinning || deck?.active;
  useFrame((_, dt) => {
    if (ring.current && spinning && !reducedMotion) ring.current.rotation.z -= dt * (1.6 + (deck.gain || 0) * 4);
  });
  return (
    <group position={[x, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh><circleGeometry args={[0.66, 64]} /><meshStandardMaterial color="#0a0d12" roughness={0.5} metalness={0.45} /></mesh>
      <group ref={ring}>
        <mesh position={[0, 0, 0.001]}><circleGeometry args={[0.5, 64]} /><meshStandardMaterial map={rec} roughness={0.45} metalness={0.05} /></mesh>
      </group>
      <mesh position={[0, 0, 0.004]}>
        <torusGeometry args={[0.6, 0.022, 12, 80]} />
        <meshStandardMaterial color={spinning ? color : '#26323e'} emissive={color} emissiveIntensity={spinning ? 0.8 : 0.1} roughness={0.3} metalness={0.5} />
      </mesh>
    </group>
  );
}

function TelemetryScreen({ x, y, deck, side }) {
  const texture = useDeckScreenTexture(deck, side);
  return (
    <mesh position={[x, y + 0.001, -0.98]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1.4, 0.42]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

class ModelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}


function Booth({ deckA, deckB, transition, demo }) {
  const cross = transition?.progress ?? crossFromDecks(deckA, deckB);
  return (
    <group>
      <mesh position={[0, -0.08, 0]} receiveShadow>
        <boxGeometry args={[9.35, 0.34, 4.55]} />
        <meshStandardMaterial color="#202733" roughness={0.25} metalness={0.62} emissive="#07131b" emissiveIntensity={0.32} />
      </mesh>
      <mesh position={[0, -0.33, 0.1]}>
        <boxGeometry args={[9.8, 0.32, 5.02]} />
        <meshStandardMaterial color="#141922" roughness={0.38} metalness={0.55} />
      </mesh>
      <Turntable side="A" x={-3.02} deck={deckA} demo={demo} />
      <Mixer cross={cross} deckA={deckA} deckB={deckB} />
      <Turntable side="B" x={3.02} deck={deckB} demo={demo} />
      <BackRail />
    </group>
  );
}

function Turntable({ side, x, deck, demo }) {
  const platter = useRef();
  const tonearm = useRef();
  const texture = useRecordTexture(deck.meta || (side === 'A' ? EMPTY_A : EMPTY_B), side);
  const screen = useDeckScreenTexture(deck, side);
  const spin = deck.spinning || demo;
  const gain = deck.gain ?? (side === 'A' ? 1 : 0.25);
  useFrame((_, delta) => {
    if (platter.current && spin) platter.current.rotation.y -= delta * (1.6 + gain * 4.2);
    if (tonearm.current) tonearm.current.rotation.z = THREE.MathUtils.lerp(tonearm.current.rotation.z, spin ? -0.22 : 0.08, 0.08);
  });

  return (
    <group position={[x, 0.18, 0]}>
      <mesh castShadow receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[3.15, 0.28, 3.35]} />
        <meshStandardMaterial color="#242a33" roughness={0.24} metalness={0.64} emissive="#050b12" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, 0.171, -1.16]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.82, 0.54]} />
        <meshStandardMaterial map={screen} emissive="#0ea5a4" emissiveIntensity={0.35} roughness={0.22} metalness={0.02} />
      </mesh>
      <mesh ref={platter} castShadow position={[0, 0.2, 0.08]}>
        <cylinderGeometry args={[1.16, 1.16, 0.16, 128]} />
        <meshStandardMaterial color="#11151b" roughness={0.18} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.294, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.2, 0.025, 12, 128]} />
        <meshStandardMaterial color={spin ? '#2dd4bf' : '#26323e'} emissive="#2dd4bf" emissiveIntensity={spin ? 0.72 : 0.08} roughness={0.24} metalness={0.5} />
      </mesh>
      <JogNotches />
      <mesh position={[0, 0.305, 0.08]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.58, 96]} />
        <meshStandardMaterial map={texture} roughness={0.34} metalness={0.05} />
      </mesh>
      <mesh position={[0, 0.4, 0.08]}>
        <cylinderGeometry args={[0.08, 0.08, 0.12, 32]} />
        <meshStandardMaterial color="#d6fef2" emissive="#2dd4bf" emissiveIntensity={0.6} />
      </mesh>
      <group ref={tonearm} position={[1.08, 0.42, -0.98]} rotation={[0, 0.35, 0.08]}>
        <mesh position={[-0.28, 0, 0.56]} rotation={[0.35, 0, 0.08]}>
          <boxGeometry args={[0.08, 0.08, 1.32]} />
          <meshStandardMaterial color="#b9c4cf" roughness={0.22} metalness={0.75} />
        </mesh>
        <mesh position={[-0.7, -0.02, 1.17]}>
          <boxGeometry args={[0.3, 0.12, 0.18]} />
          <meshStandardMaterial color="#0d1118" roughness={0.35} metalness={0.35} />
        </mesh>
      </group>
      <HotCuePads side={side} />
      <PadModeLabels />
      <PlayCueButtons spinning={spin} />
      <PitchFader rate={deck.rate || 1} />
      <LevelLights deck={deck} x={-1.22} />
      <mesh position={[1.08, 0.32, 1.12]}>
        <cylinderGeometry args={[0.13, 0.13, 0.06, 32]} />
        <meshStandardMaterial color={spin ? '#2dd4bf' : '#26323e'} emissive="#2dd4bf" emissiveIntensity={spin ? 1.4 : 0.08} />
      </mesh>
    </group>
  );
}

function JogNotches() {
  return (
    <group position={[0, 0.33, 0.08]}>
      {Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * Math.PI * 2;
        const x = Math.cos(a) * 1.03;
        const z = Math.sin(a) * 1.03;
        return (
          <mesh key={i} position={[x, 0, z]} rotation={[0, -a, 0]}>
            <boxGeometry args={[0.22, 0.035, 0.07]} />
            <meshStandardMaterial color="#2b313b" roughness={0.45} metalness={0.38} emissive="#05070a" emissiveIntensity={0.05} />
          </mesh>
        );
      })}
    </group>
  );
}

function HotCuePads({ side }) {
  const colors = side === 'A'
    ? ['#22c55e', '#2dd4bf', '#60a5fa', '#a78bfa']
    : ['#f472b6', '#a78bfa', '#38bdf8', '#22c55e'];
  return (
    <group position={[-0.76, 0.335, 1.24]}>
      {colors.map((color, i) => (
        <mesh key={color} position={[i * 0.32, 0, 0]}>
          <boxGeometry args={[0.22, 0.055, 0.2]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.42} roughness={0.4} metalness={0.12} />
        </mesh>
      ))}
    </group>
  );
}

function PadModeLabels() {
  return (
    <group>
      <Label text="HOT CUE" position={[-0.75, 0.395, 1.02]} width={0.42} height={0.1} color="#fb923c" size={28} />
      <Label text="PAD FX1" position={[-0.43, 0.395, 1.02]} width={0.42} height={0.1} size={24} />
      <Label text="BEAT JUMP" position={[-0.11, 0.395, 1.02]} width={0.46} height={0.1} size={23} />
      <Label text="SAMPLER" position={[0.22, 0.395, 1.02]} width={0.44} height={0.1} size={24} />
    </group>
  );
}

function PlayCueButtons({ spinning }) {
  return (
    <group position={[-1.1, 0.35, 1.53]}>
      {[
        ['#22c55e', spinning ? 1.2 : 0.3],
        ['#f59e0b', 0.45],
      ].map(([color, glow], i) => (
        <mesh key={color} position={[i * 0.34, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.055, 32]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} roughness={0.28} metalness={0.28} />
        </mesh>
      ))}
    </group>
  );
}

function PitchFader({ rate }) {
  const z = THREE.MathUtils.lerp(-0.72, 0.72, clamp01((rate - 0.94) / 0.12));
  return (
    <group position={[1.36, 0.34, 0.2]}>
      <Label text="TEMPO" position={[0, 0.095, 0.98]} width={0.46} height={0.12} size={26} />
      <mesh position={[0, -0.02, 0]}>
        <boxGeometry args={[0.065, 0.035, 1.62]} />
        <meshStandardMaterial color="#3b4656" roughness={0.42} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.035, z]}>
        <boxGeometry args={[0.22, 0.095, 0.18]} />
        <meshStandardMaterial color="#e6fff8" emissive="#2dd4bf" emissiveIntensity={0.25} roughness={0.22} metalness={0.54} />
      </mesh>
    </group>
  );
}

function Mixer({ cross, deckA, deckB }) {
  return (
    <group position={[0, 0.2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.22, 0.32, 3.58]} />
        <meshStandardMaterial color="#1d232c" roughness={0.27} metalness={0.62} emissive="#050b12" emissiveIntensity={0.12} />
      </mesh>
      <MixerScreen cross={cross} />
      <MixerTopControls />
      <MixerBranding />
      <KnobColumn x={-0.5} deck={deckA} channel="1" />
      <KnobColumn x={0.5} deck={deckB} channel="2" />
      <VuTower x={-0.08} gain={deckA.gain || 0} />
      <VuTower x={0.08} gain={deckB.gain || 0} />
      <ChannelFader x={-0.5} gain={deckA.gain || 0} />
      <ChannelFader x={0.5} gain={deckB.gain || 0} />
      <Crossfader cross={cross} />
      <MixerCueRow />
      <BeatFxSection />
    </group>
  );
}

function MixerScreen({ cross }) {
  const texture = useMixerTexture(cross);
  return (
    <mesh position={[0, 0.275, -1.28]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1.18, 0.42]} />
      <meshStandardMaterial map={texture} emissive="#22c55e" emissiveIntensity={0.28} roughness={0.2} metalness={0.02} />
    </mesh>
  );
}

function MixerTopControls() {
  return (
    <group>
      <Label text="LOAD" position={[-0.68, 0.405, -1.68]} width={0.36} height={0.1} size={24} />
      <Label text="LOAD" position={[0.68, 0.405, -1.68]} width={0.36} height={0.1} size={24} />
      <mesh position={[-0.68, 0.38, -1.49]}>
        <boxGeometry args={[0.34, 0.08, 0.18]} />
        <meshStandardMaterial color="#202632" emissive="#2dd4bf" emissiveIntensity={0.08} roughness={0.3} metalness={0.4} />
      </mesh>
      <mesh position={[0.68, 0.38, -1.49]}>
        <boxGeometry args={[0.34, 0.08, 0.18]} />
        <meshStandardMaterial color="#202632" emissive="#a78bfa" emissiveIntensity={0.08} roughness={0.3} metalness={0.4} />
      </mesh>
      <Knob position={[0, 0.39, -1.52]} value={8} radius={0.17} />
      <Label text="BROWSE" position={[0, 0.465, -1.28]} width={0.46} height={0.11} size={24} />
      <Knob position={[0.9, 0.39, -0.98]} value={4} radius={0.18} />
      <Label text="MASTER" position={[0.9, 0.465, -0.72]} width={0.5} height={0.12} size={25} />
    </group>
  );
}

function MixerBranding() {
  return (
    <group>
      <Label text="PERFORMANCE DJ CONTROLLER" position={[-0.94, 0.39, -0.92]} width={0.86} height={0.11} size={21} />
      <Label text="AI DJ FLX" position={[-0.94, 0.39, -0.72]} width={0.72} height={0.14} color="#f8fafc" size={28} />
      <Label text="yt-dlp / Web Audio" position={[-0.94, 0.39, -0.52]} width={0.72} height={0.11} size={22} />
      <Label text="AI DJ" position={[0, 0.39, 1.55]} width={0.52} height={0.13} color="#f8fafc" size={30} />
    </group>
  );
}

function KnobColumn({ x, deck, channel }) {
  const values = [0, deck.high || 0, deck.mid || 0, deck.low || 0, 0];
  const labels = ['TRIM', 'HI', 'MID', 'LOW', 'CFX'];
  return (
    <group position={[x, 0.26, -1.05]}>
      <Label text={channel} position={[0, 0.17, 2.32]} width={0.18} height={0.16} color="#f8fafc" size={34} />
      {values.map((v, i) => (
        <group key={labels[i]} position={[0, 0, i * 0.38]}>
          <Label text={labels[i]} position={[0, 0.18, -0.18]} width={0.34} height={0.09} size={22} />
          <Knob value={v} />
        </group>
      ))}
    </group>
  );
}

function Knob({ z = 0, value, position, radius = 0.16 }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = THREE.MathUtils.lerp(ref.current.rotation.y, (value / 30) * Math.PI, 0.15);
  });
  return (
    <group ref={ref} position={position || [0, 0, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[radius, radius, 0.16, 36]} />
        <meshStandardMaterial color="#1d2633" roughness={0.26} metalness={0.7} />
      </mesh>
      <mesh position={[0, 0.09, radius * 0.62]}>
        <boxGeometry args={[0.035, 0.04, radius]} />
        <meshStandardMaterial color="#d8fff5" emissive="#2dd4bf" emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

function ChannelFader({ x, gain }) {
  const z = THREE.MathUtils.lerp(0.75, 1.45, clamp01(gain));
  return (
    <group position={[x, 0.33, z]}>
      <mesh>
        <boxGeometry args={[0.12, 0.08, 0.48]} />
        <meshStandardMaterial color="#e6fff8" emissive="#2dd4bf" emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

function VuTower({ x, gain }) {
  return (
    <group position={[x, 0.34, 0.35]}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const on = clamp01(gain) > i / 8;
        const color = i > 5 ? '#f97316' : i > 3 ? '#facc15' : '#22c55e';
        return (
          <mesh key={i} position={[0, 0, -i * 0.14]}>
            <boxGeometry args={[0.07, 0.045, 0.075]} />
            <meshStandardMaterial color={on ? color : '#17202a'} emissive={color} emissiveIntensity={on ? 1.15 : 0.04} roughness={0.32} metalness={0.18} />
          </mesh>
        );
      })}
    </group>
  );
}

function MixerCueRow() {
  return (
    <group position={[0, 0.36, 0.93]}>
      {[-0.5, 0.5].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Label text="CUE" position={[0, 0.08, -0.18]} width={0.34} height={0.1} color="#f8fafc" size={24} />
          <mesh>
            <boxGeometry args={[0.32, 0.07, 0.18]} />
            <meshStandardMaterial color="#111827" emissive="#2dd4bf" emissiveIntensity={0.3} roughness={0.3} metalness={0.4} />
          </mesh>
        </group>
      ))}
      {[-0.78, -0.22, 0.22, 0.78].map((x, i) => (
        <mesh key={x} position={[x, 0, 0]}>
          <cylinderGeometry args={[0.09, 0.09, 0.052, 28]} />
          <meshStandardMaterial color={i < 2 ? '#2dd4bf' : '#a78bfa'} emissive={i < 2 ? '#2dd4bf' : '#a78bfa'} emissiveIntensity={0.42} roughness={0.3} metalness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

function BeatFxSection() {
  return (
    <group position={[0.94, 0, 0.2]}>
      <Label text="BEAT FX" position={[0, 0.4, -0.25]} width={0.54} height={0.12} size={25} />
      <mesh position={[0, 0.37, 0.05]}>
        <boxGeometry args={[0.38, 0.07, 0.18]} />
        <meshStandardMaterial color="#111827" emissive="#a78bfa" emissiveIntensity={0.18} roughness={0.3} metalness={0.4} />
      </mesh>
      <Knob position={[0, 0.39, 0.58]} value={5} radius={0.18} />
      <Label text="LEVEL / DEPTH" position={[0, 0.465, 0.88]} width={0.66} height={0.1} size={21} />
      <mesh position={[0, 0.39, 1.15]}>
        <boxGeometry args={[0.38, 0.075, 0.2]} />
        <meshStandardMaterial color="#fb923c" emissive="#fb923c" emissiveIntensity={0.48} roughness={0.28} metalness={0.35} />
      </mesh>
      <Label text="ON/OFF" position={[0, 0.465, 1.38]} width={0.52} height={0.1} color="#f8fafc" size={21} />
    </group>
  );
}

function Crossfader({ cross }) {
  const x = THREE.MathUtils.lerp(-0.52, 0.52, clamp01(cross));
  return (
    <group position={[0, 0.42, 1.62]}>
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[1.35, 0.04, 0.08]} />
        <meshStandardMaterial color="#394554" roughness={0.42} metalness={0.35} />
      </mesh>
      <mesh position={[x, 0, 0]}>
        <boxGeometry args={[0.32, 0.12, 0.2]} />
        <meshStandardMaterial color="#d9fff6" emissive="#2dd4bf" emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}

function LevelLights({ deck, x }) {
  const gain = clamp01(deck.gain || 0);
  return (
    <group position={[x, 0.32, 1.1]}>
      {[0, 1, 2, 3, 4].map((i) => {
        const on = gain > i / 5;
        const color = i > 3 ? '#f59e0b' : '#2dd4bf';
        return (
          <mesh key={i} position={[0, 0, -i * 0.18]}>
            <boxGeometry args={[0.08, 0.04, 0.08]} />
            <meshStandardMaterial color={on ? color : '#17202a'} emissive={color} emissiveIntensity={on ? 1.2 : 0.04} />
          </mesh>
        );
      })}
    </group>
  );
}

function BackRail() {
  return (
    <group position={[0, 0.35, -1.9]}>
      <mesh>
        <boxGeometry args={[8.6, 0.12, 0.14]} />
        <meshStandardMaterial color="#1c2733" roughness={0.32} metalness={0.5} />
      </mesh>
      {[-3.6, -1.8, 0, 1.8, 3.6].map((x) => (
        <mesh key={x} position={[x, 0.58, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 1.15, 16]} />
          <meshStandardMaterial color="#263544" roughness={0.32} metalness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function StageLights({ engine, minimal }) {
  const left = useRef();
  const right = useRef();
  useFrame(({ clock }) => {
    const bass = engine?.bass?.() ?? (0.35 + Math.sin(clock.elapsedTime * 1.8) * 0.14);
    const treble = engine?.treble?.() ?? (0.24 + Math.cos(clock.elapsedTime * 2.4) * 0.1);
    if (left.current) left.current.intensity = (minimal ? 3.2 : 2.2) + bass * (minimal ? 3.2 : 5.2);
    if (right.current) right.current.intensity = (minimal ? 2.4 : 1.7) + treble * (minimal ? 2.4 : 4.5);
  });
  return (
    <>
      <spotLight ref={left} color="#2dd4bf" position={minimal ? [-3.1, 5.3, 3.2] : [-4.2, 5.8, 2.4]} angle={0.48} penumbra={0.7} intensity={6.2} castShadow />
      <spotLight ref={right} color="#8b5cf6" position={minimal ? [3.4, 4.6, 2.5] : [4.4, 5.2, 1.8]} angle={0.42} penumbra={0.75} intensity={4.8} />
      <pointLight color="#f8fafc" position={[0, 2.5, 3.2]} intensity={minimal ? 1.8 : 2.2} />
      <pointLight color="#22c55e" position={[2.8, 1.4, 0.8]} intensity={minimal ? 3 : 3.1} />
    </>
  );
}

function useRecordTexture(meta, side) {
  const title = meta?.title || (side === 'A' ? EMPTY_A.title : EMPTY_B.title);
  const artist = meta?.artist || '';
  const bpm = meta?.bpm || '';
  const key = meta?.camelot || '';
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(256, 256, 20, 256, 256, 256);
    gradient.addColorStop(0, side === 'A' ? '#d9fff6' : '#f4e8ff');
    gradient.addColorStop(0.55, side === 'A' ? '#2dd4bf' : '#a855f7');
    gradient.addColorStop(1, '#0b0f15');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath();
    ctx.arc(256, 256, 190, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 34px system-ui, sans-serif';
    wrapCanvasText(ctx, title, 256, 208, 330, 38, 2);
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(248,250,252,0.82)';
    wrapCanvasText(ctx, artist || `DECK ${side}`, 256, 286, 320, 28, 1);
    ctx.font = '700 22px ui-monospace, monospace';
    ctx.fillStyle = '#07100d';
    ctx.fillText(`${bpm || '--'} BPM / ${key || '--'}`, 256, 344);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [artist, bpm, key, side, title]);
}

function useDeckScreenTexture(deck, side) {
  const meta = deck?.meta || (side === 'A' ? EMPTY_A : EMPTY_B);
  const title = meta?.title || (side === 'A' ? 'Deck A' : 'Deck B');
  const artist = meta?.artist || meta?.query || '';
  const bpm = meta?.bpm || '--';
  const key = meta?.camelot || '--';
  const state = deck?.state || 'idle';
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#061014';
    ctx.fillRect(0, 0, 512, 160);
    const gradient = ctx.createLinearGradient(0, 0, 512, 160);
    gradient.addColorStop(0, side === 'A' ? 'rgba(34,197,94,0.28)' : 'rgba(168,85,247,0.24)');
    gradient.addColorStop(1, 'rgba(15,23,42,0.18)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = 'rgba(216,255,245,0.24)';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, 492, 140);
    ctx.fillStyle = '#86efac';
    ctx.font = '700 22px ui-monospace, monospace';
    ctx.fillText(`DECK ${side} / ${state.toUpperCase()}`, 28, 38);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 30px system-ui, sans-serif';
    fitCanvasText(ctx, title, 28, 82, 450);
    ctx.fillStyle = 'rgba(248,250,252,0.72)';
    ctx.font = '500 21px system-ui, sans-serif';
    fitCanvasText(ctx, artist || 'YouTube crate', 28, 114, 330);
    ctx.fillStyle = '#07100d';
    ctx.fillRect(356, 102, 126, 32);
    ctx.fillStyle = '#d9fff6';
    ctx.font = '800 20px ui-monospace, monospace';
    ctx.fillText(`${bpm} / ${key}`, 370, 124);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [artist, bpm, key, side, state, title]);
}

function useMixerTexture(cross) {
  const value = Math.round(clamp01(cross) * 100);
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 144;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050d10';
    ctx.fillRect(0, 0, 384, 144);
    ctx.strokeStyle = 'rgba(134,239,172,0.28)';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, 368, 128);
    ctx.fillStyle = '#86efac';
    ctx.font = '700 18px ui-monospace, monospace';
    ctx.fillText('MASTER MIX', 24, 36);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '800 38px system-ui, sans-serif';
    ctx.fillText(`${value}%`, 24, 84);
    ctx.fillStyle = 'rgba(248,250,252,0.5)';
    ctx.font = '600 16px ui-monospace, monospace';
    ctx.fillText('A  < crossfader >  B', 24, 114);
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(214, 76, Math.max(8, value * 1.2), 8);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [value]);
}

function Label({ text, position, width = 0.42, height = 0.12, color = '#d1d5db', size = 24 }) {
  const texture = useLabelTexture(text, color, size);
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

function useLabelTexture(text, color, size) {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${size}px ui-monospace, system-ui, sans-serif`;
    ctx.fillText(String(text || '').toUpperCase(), 256, 66);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [color, size, text]);
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) visible[visible.length - 1] = `${visible[visible.length - 1].slice(0, 22)}...`;
  const startY = y - ((visible.length - 1) * lineHeight) / 2;
  visible.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}

function fitCanvasText(ctx, text, x, y, maxWidth) {
  const value = String(text || '');
  if (ctx.measureText(value).width <= maxWidth) {
    ctx.fillText(value, x, y);
    return;
  }
  let out = value;
  while (out.length > 4 && ctx.measureText(`${out}...`).width > maxWidth) out = out.slice(0, -1);
  ctx.fillText(`${out}...`, x, y);
}

function demoDeck(name, meta, spinning) {
  return {
    name,
    state: spinning ? 'playing' : 'idle',
    meta,
    active: name === 'A',
    gain: name === 'A' ? 0.86 : 0.34,
    low: name === 'A' ? 0 : -12,
    mid: 0,
    high: 0,
    rate: 1,
    position: 0,
    spinning,
  };
}

function crossFromDecks(a, b) {
  return clamp01((b?.gain || 0) / Math.max(0.001, (a?.gain || 0) + (b?.gain || 0)));
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));


function useModelAvailable(url) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!url) {
      setAvailable(false);
      return undefined;
    }
    let alive = true;
    fetch(url, { method: 'HEAD', cache: 'no-store' })
      .then((res) => {
        if (alive) setAvailable(res.ok && /model|octet-stream|gltf|glb/i.test(res.headers.get('content-type') || 'model/gltf-binary'));
      })
      .catch(() => {
        if (alive) setAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return available;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}
