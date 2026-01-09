import * as BABYLON from "babylonjs";
import { createJet } from "./jet.js";
import { createHUD } from "./ui.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function hash2d(x, z, seed) {
  const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise2d(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const z1 = z0 + 1;

  const sx = smoothStep(x - x0);
  const sz = smoothStep(z - z0);

  const n00 = hash2d(x0, z0, seed);
  const n10 = hash2d(x1, z0, seed);
  const n01 = hash2d(x0, z1, seed);
  const n11 = hash2d(x1, z1, seed);

  const ix0 = BABYLON.Scalar.Lerp(n00, n10, sx);
  const ix1 = BABYLON.Scalar.Lerp(n01, n11, sx);

  return BABYLON.Scalar.Lerp(ix0, ix1, sz);
}

function fbmNoise(x, z, seed, octaves, lacunarity, gain) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let normalization = 0;

  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise2d(x * frequency, z * frequency, seed + i * 13) * amplitude;
    normalization += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return sum / normalization;
}

function getLandMaskAt(x, z, options) {
  const radius = options.size * 0.5;
  const dist = Math.sqrt(x * x + z * z);
  const radial = smoothStep(clamp((radius - dist) / radius, 0, 1));

  const largeNoise = fbmNoise(
    (x + options.seedOffset) / options.islandScaleLarge,
    (z + options.seedOffset) / options.islandScaleLarge,
    options.seed + 201,
    3,
    2.0,
    0.5
  );
  const smallNoise = fbmNoise(
    (x + options.seedOffset) / options.islandScaleSmall,
    (z + options.seedOffset) / options.islandScaleSmall,
    options.seed + 401,
    2,
    2.1,
    0.55
  );

  const largeMask = smoothStep(
    clamp((largeNoise - options.largeThreshold) / options.largeFalloff, 0, 1)
  );
  const smallMask = smoothStep(
    clamp((smallNoise - options.smallThreshold) / options.smallFalloff, 0, 1)
  );

  let islandBase = Math.max(largeMask, smallMask * options.smallWeight);

  const coastNoise = fbmNoise(
    (x + options.seedOffset) / options.coastScale,
    (z + options.seedOffset) / options.coastScale,
    options.seed + 701,
    3,
    2.2,
    0.5
  );
  const coastMask = smoothStep(
    clamp((coastNoise - options.coastThreshold) / options.coastFalloff, 0, 1)
  );
  islandBase = clamp(islandBase - (1 - coastMask) * options.coastCut, 0, 1);

  if (options.centerRadius > 0) {
    const centerMask = smoothStep(
      clamp(1 - dist / options.centerRadius, 0, 1)
    );
    islandBase = Math.max(islandBase, centerMask);
  }

  return islandBase * radial;
}

function applyLandmassTerrain(mesh, options) {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  const normals = [];
  const seed = options.seed;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    const dist = Math.sqrt(x * x + z * z);

    const hillNoise = fbmNoise(
      (x + options.seedOffset) / options.hillScale,
      (z + options.seedOffset) / options.hillScale,
      seed,
      4,
      2.1,
      0.5
    );
    let height = (hillNoise - 0.5) * options.hillHeight;

    const mountainNoise = fbmNoise(
      (x + options.seedOffset) / options.mountainScale,
      (z + options.seedOffset) / options.mountainScale,
      seed + 101,
      3,
      2.2,
      0.55
    );
    const mountainRidge = Math.max(0, mountainNoise - 0.52);
    height += mountainRidge * mountainRidge * options.mountainHeight;

    const landMask = getLandMaskAt(x, z, options);

    if (options.flattenCenterRadius > 0) {
      const flat = clamp(1 - dist / options.flattenCenterRadius, 0, 1);
      height *= 1 - smoothStep(flat);
    }

    const landHeight = options.baseHeight + height * landMask;
    positions[i + 1] = BABYLON.Scalar.Lerp(
      options.seaFloorHeight,
      landHeight,
      landMask
    );
  }

  BABYLON.VertexData.ComputeNormals(positions, indices, normals);
  mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
  mesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
  mesh.refreshBoundingInfo();
}

function createJetAudio(scene, jet) {
  const audio = new Audio("/wjet-loop.wav");
  audio.loop = true;
  audio.volume = 0;
  audio.preload = "auto";

  let currentVolume = 0;
  let currentRate = 0.9;
  let started = false;
  let isPaused = false;

  const requestStart = () => {
    if (!started) {
      started = true;
      audio.play().catch(() => {
        started = false;
      });
    }
  };

  window.addEventListener("pointerdown", requestStart, { once: true });
  window.addEventListener("click", requestStart, { once: true });
  window.addEventListener("keydown", requestStart, { once: true });

  function update(dt, throttle) {
    if (isPaused) {
      return;
    }

    const targetVolume = BABYLON.Scalar.Lerp(0.0, 0.95, throttle);
    const targetRate = BABYLON.Scalar.Lerp(0.85, 1.5, throttle);
    const response = 1 - Math.exp(-dt * 6);

    currentVolume += (targetVolume - currentVolume) * response;
    currentRate += (targetRate - currentRate) * response;

    audio.volume = currentVolume;
    audio.playbackRate = currentRate;
  }

  function setPaused(paused) {
    if (paused === isPaused) {
      return;
    }

    isPaused = paused;
    if (isPaused) {
      audio.pause();
      return;
    }

    if (started) {
      audio.play().catch(() => {
        started = false;
      });
    }
  }

  return { update, setPaused };
}

function createInputManager() {
  const pressed = new Set();
  const input = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttleUp: false,
    throttleDown: false,
    toggleCamera: false,
    reset: false,
    brakeToggle: false,
    pause: false,
    autoLevelToggle: false,
  };

  window.addEventListener("keydown", (event) => {
    pressed.add(event.code);

    if (event.code === "Space" && !event.repeat) {
      input.toggleCamera = true;
    }

    if (event.code === "KeyR" && !event.repeat) {
      input.reset = true;
    }

    if (event.code === "KeyB" && !event.repeat) {
      input.brakeToggle = true;
    }

    if (event.code === "KeyP" && !event.repeat) {
      input.pause = true;
    }

    if (event.code === "KeyL" && !event.repeat) {
      input.autoLevelToggle = true;
    }
  });

  window.addEventListener("keyup", (event) => {
    pressed.delete(event.code);
  });

  function updateAxes() {
    input.pitch =
      (pressed.has("ArrowUp") ? 1 : 0) + (pressed.has("ArrowDown") ? -1 : 0);
    input.roll =
      (pressed.has("ArrowRight") ? 1 : 0) +
      (pressed.has("ArrowLeft") ? -1 : 0);
    input.yaw = (pressed.has("KeyD") ? 1 : 0) + (pressed.has("KeyA") ? -1 : 0);
    input.throttleUp = pressed.has("KeyW");
    input.throttleDown = pressed.has("KeyS");
  }

  function consumeToggle() {
    const toggle = input.toggleCamera;
    input.toggleCamera = false;
    return toggle;
  }

  function consumeReset() {
    const reset = input.reset;
    input.reset = false;
    return reset;
  }

  function consumeBrakeToggle() {
    const toggle = input.brakeToggle;
    input.brakeToggle = false;
    return toggle;
  }

  function consumePause() {
    const pause = input.pause;
    input.pause = false;
    return pause;
  }

  function consumeAutoLevelToggle() {
    const toggle = input.autoLevelToggle;
    input.autoLevelToggle = false;
    return toggle;
  }

  return {
    input,
    updateAxes,
    consumeToggle,
    consumeReset,
    consumeBrakeToggle,
    consumePause,
    consumeAutoLevelToggle,
  };
}

export async function startGame() {
  const canvas = document.getElementById("renderCanvas");
  const engine = new BABYLON.Engine(canvas, true);
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.7, 0.9, 1.0, 1.0);

  const light = new BABYLON.HemisphericLight(
    "sun",
    new BABYLON.Vector3(0, 1, 0),
    scene
  );
  light.intensity = 0.9;

  const skybox = BABYLON.MeshBuilder.CreateBox("skybox", { size: 2000 }, scene);
  const skyMat = new BABYLON.StandardMaterial("skyMat", scene);
  skyMat.backFaceCulling = false;
  skyMat.disableLighting = true;
  skyMat.emissiveColor = new BABYLON.Color3(0.6, 0.8, 1.0);
  skybox.material = skyMat;
  skybox.isPickable = false;

  const ocean = BABYLON.MeshBuilder.CreateGround(
    "ocean",
    { width: 2000, height: 2000 },
    scene
  );
  const oceanMat = new BABYLON.StandardMaterial("oceanMat", scene);
  oceanMat.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.6);
  oceanMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.2);
  ocean.material = oceanMat;

  const grassMat = new BABYLON.StandardMaterial("grassMat", scene);
  grassMat.diffuseColor = new BABYLON.Color3(0.18, 0.56, 0.22);
  grassMat.ambientColor = new BABYLON.Color3(0.1, 0.22, 0.12);
  grassMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

  const terrainSeed = Math.floor(Math.random() * 10000) + 1;
  const landConfig = {
    name: "landmass",
    size: 1200,
    x: 0,
    z: 0,
    hillHeight: 6,
    mountainHeight: 26,
    flattenCenterRadius: 140,
  };

  const landMaskOptions = {
    size: landConfig.size,
    seed: terrainSeed + 11,
    seedOffset: terrainSeed * 0.4,
    islandScaleLarge: 320,
    islandScaleSmall: 140,
    largeThreshold: 0.55,
    largeFalloff: 0.18,
    smallThreshold: 0.6,
    smallFalloff: 0.2,
    smallWeight: 0.65,
    coastScale: 90,
    coastThreshold: 0.45,
    coastFalloff: 0.35,
    coastCut: 0.28,
    centerRadius: 220,
    hillScale: 60,
    mountainScale: 180,
    hillHeight: landConfig.hillHeight,
    mountainHeight: landConfig.mountainHeight,
    baseHeight: 1,
    seaFloorHeight: -2.5,
    flattenCenterRadius: landConfig.flattenCenterRadius,
  };

  const landmass = BABYLON.MeshBuilder.CreateGround(
    landConfig.name,
    { width: landConfig.size, height: landConfig.size, subdivisions: 200 },
    scene
  );
  landmass.position.set(landConfig.x, 0, landConfig.z);
  landmass.material = grassMat;
  applyLandmassTerrain(landmass, {
    ...landMaskOptions,
    flattenCenterRadius: landConfig.flattenCenterRadius,
  });

  const minimapSamples = 64;
  const minimapLand = new Array(minimapSamples * minimapSamples);
  for (let z = 0; z < minimapSamples; z += 1) {
    for (let x = 0; x < minimapSamples; x += 1) {
      const nx = x / (minimapSamples - 1) - 0.5;
      const nz = z / (minimapSamples - 1) - 0.5;
      const worldX = nx * 2000;
      const worldZ = nz * 2000;
      minimapLand[z * minimapSamples + x] = getLandMaskAt(
        worldX,
        worldZ,
        landMaskOptions
      );
    }
  }

  const runwayLength = 260;
  const runwayWidth = 40;
  const runway = BABYLON.MeshBuilder.CreateGround(
    "runway",
    { width: runwayWidth, height: runwayLength },
    scene
  );
  runway.position.set(0, 1.02, 0);
  const runwayMat = new BABYLON.StandardMaterial("runwayMat", scene);
  runwayMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.22);
  runwayMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  runway.material = runwayMat;

  const markingMat = new BABYLON.StandardMaterial("markingMat", scene);
  markingMat.diffuseColor = new BABYLON.Color3(0.9, 0.9, 0.92);
  markingMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

  const centerLineCount = 7;
  const centerLineLength = 14;
  const centerLineGap = 12;
  for (let i = 0; i < centerLineCount; i += 1) {
    const dash = BABYLON.MeshBuilder.CreateBox(
      `runway-dash-${i}`,
      { width: 2, height: 0.05, depth: centerLineLength },
      scene
    );
    dash.position.set(
      0,
      1.06,
      -runwayLength / 2 + 30 + i * (centerLineLength + centerLineGap)
    );
    dash.material = markingMat;
  }

  const threshold = BABYLON.MeshBuilder.CreateBox(
    "runway-threshold",
    { width: runwayWidth - 6, height: 0.05, depth: 6 },
    scene
  );
  threshold.position.set(0, 1.06, -runwayLength / 2 + 10);
  threshold.material = markingMat;

  const runwayStart = new BABYLON.Vector3(
    0,
    2,
    -runwayLength / 2 + 6
  );

  const { mesh: jet, controller } = await createJet(scene, runwayStart);
  controller.reset();
  const jetAudio = createJetAudio(scene, jet);

  const camera = new BABYLON.FreeCamera(
    "camera",
    new BABYLON.Vector3(0, 8, -20),
    scene
  );
  camera.inputs.clear();
  scene.activeCamera = camera;

  const hud = createHUD();
  const inputManager = createInputManager();
  let cameraMode = "chase";
  let isPaused = false;
  let brakeEngaged = true;
  let autoLevelEnabled = false;

  hud.setMode(cameraMode);

  function updateCamera() {
    const forward = jet.forward.normalize();
    const up = jet.up.normalize();

    if (cameraMode === "chase") {
      const camPos = jet.position
        .add(forward.scale(-20))
        .add(up.scale(8));
      const target = jet.position.add(forward.scale(10));
      camera.position.copyFrom(camPos);
      camera.setTarget(target);
      camera.upVector = BABYLON.Vector3.Up();
    } else {
      const camPos = jet.position.add(forward.scale(2)).add(up.scale(1));
      const target = jet.position.add(forward.scale(20));
      camera.position.copyFrom(camPos);
      camera.setTarget(target);
      camera.upVector = up;
    }
  }

  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime() / 1000;
    const clampedDt = clamp(dt, 0, 0.05);

    inputManager.updateAxes();

    if (inputManager.consumeToggle()) {
      cameraMode = cameraMode === "chase" ? "cockpit" : "chase";
      hud.setMode(cameraMode);
    }

    if (inputManager.consumeReset()) {
      controller.reset();
    }

    if (inputManager.consumeBrakeToggle()) {
      brakeEngaged = !brakeEngaged;
    }

    if (inputManager.consumePause()) {
      isPaused = !isPaused;
    }

    if (inputManager.consumeAutoLevelToggle()) {
      autoLevelEnabled = !autoLevelEnabled;
    }

    if (!isPaused) {
      controller.update(
        clampedDt,
        inputManager.input,
        brakeEngaged,
        autoLevelEnabled
      );
    }

    jetAudio.setPaused(isPaused);
    jetAudio.update(clampedDt, controller.throttle);
    updateCamera();

    hud.update({
      speed: controller.speed,
      altitude: jet.position.y,
      throttle: controller.throttle,
      position: jet.position,
      landMap: minimapLand,
      landMapResolution: minimapSamples,
      isPaused,
      brakeEngaged,
    });

    scene.render();
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
}
