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
  const halfSize = options.size * 0.5;
  const squareDist = Math.max(Math.abs(x), Math.abs(z));
  const radial = smoothStep(clamp((halfSize - squareDist) / halfSize, 0, 1));

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
    const centerDist = Math.sqrt(x * x + z * z);
    const centerMask = smoothStep(
      clamp(1 - centerDist / options.centerRadius, 0, 1)
    );
    islandBase = Math.max(islandBase, centerMask);
  }

  return islandBase * radial;
}

function applyLandmassTerrain(mesh, options) {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  const normals = [];
  const colors = [];
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
      4,
      2.2,
      0.55
    );
    const mountainRidge = Math.max(0, mountainNoise - 0.48);
    height += mountainRidge * mountainRidge * options.mountainHeight;

    const landMask = getLandMaskAt(x, z, options);
    const shoreBlend = smoothStep(
      clamp((landMask - options.shoreStart) / options.shoreWidth, 0, 1)
    );

    if (options.flattenCenterRadius > 0) {
      const flat = clamp(1 - dist / options.flattenCenterRadius, 0, 1);
      height *= 1 - smoothStep(flat);
    }

    const landHeight = options.baseHeight + height;
    positions[i + 1] = BABYLON.Scalar.Lerp(
      options.seaFloorHeight,
      landHeight,
      shoreBlend
    );

    const alpha = shoreBlend;
    colors.push(0.18, 0.56, 0.22, alpha);
  }

  BABYLON.VertexData.ComputeNormals(positions, indices, normals);
  mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
  mesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
  mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
  mesh.hasVertexAlpha = true;
  mesh.useVertexColors = true;
  mesh.refreshBoundingInfo();
}

function createCockpit(scene, jet) {
  const cockpitRoot = new BABYLON.TransformNode("cockpitRoot", scene);
  cockpitRoot.parent = jet;
  
  // Minimal dark material
  const panelMat = new BABYLON.StandardMaterial("panelMat", scene);
  panelMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.09);
  panelMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  
  // Lower instrument panel console - positioned in front and down from pilot
  const lowerConsole = BABYLON.MeshBuilder.CreateBox(
    "lowerConsole",
    { width: 0.9, height: 0.25, depth: 0.4 },
    scene
  );
  lowerConsole.position = new BABYLON.Vector3(0, -0.35, 0.6);
  lowerConsole.rotation.x = Math.PI * 0.4;
  lowerConsole.parent = cockpitRoot;
  lowerConsole.material = panelMat;
  
  // Three tiny screen indicators in lower console
  const screenData = [
    { x: -0.3 },
    { x: 0 },
    { x: 0.3 },
  ];
  
  screenData.forEach((pos, idx) => {
    const screen = BABYLON.MeshBuilder.CreatePlane(
      `screen${idx}`,
      { width: 0.15, height: 0.15 },
      scene
    );
    screen.position = new BABYLON.Vector3(pos.x, -0.25, 0.7);
    screen.rotation.x = Math.PI * 0.4;
    screen.parent = cockpitRoot;
    
    const screenMat = new BABYLON.StandardMaterial(`screenMat${idx}`, scene);
    screenMat.diffuseColor = new BABYLON.Color3(0.01, 0.06, 0.04);
    screenMat.emissiveColor = new BABYLON.Color3(0.02, 0.15, 0.08);
    screen.material = screenMat;
  });
  
  // Tiny indicator lights on console
  const buttonPositions = [
    { x: -0.35 },
    { x: -0.12 },
    { x: 0.12 },
    { x: 0.35 },
  ];
  
  const buttonColors = [
    new BABYLON.Color3(0.8, 0.2, 0.1),
    new BABYLON.Color3(0.2, 0.8, 0.2),
    new BABYLON.Color3(0.9, 0.7, 0.1),
    new BABYLON.Color3(0.2, 0.6, 0.9),
  ];
  
  buttonPositions.forEach((pos, idx) => {
    const button = BABYLON.MeshBuilder.CreateCylinder(
      `button${idx}`,
      { diameter: 0.015, height: 0.01 },
      scene
    );
    button.position = new BABYLON.Vector3(pos.x, -0.15, 0.55);
    button.rotation.x = Math.PI * 0.85;
    button.parent = cockpitRoot;
    
    const buttonMat = new BABYLON.StandardMaterial(`buttonMat${idx}`, scene);
    buttonMat.emissiveColor = buttonColors[idx].scale(0.5);
    buttonMat.diffuseColor = buttonColors[idx];
    button.material = buttonMat;
  });
  
  // Flight stick - lower right from pilot's perspective
  const stickPivot = new BABYLON.TransformNode("stickPivot", scene);
  stickPivot.position = new BABYLON.Vector3(0.22, -0.25, 0.4);
  stickPivot.parent = cockpitRoot;
  
  const stickShaft = BABYLON.MeshBuilder.CreateCylinder(
    "stickShaft",
    { diameter: 0.015, height: 0.22 },
    scene
  );
  stickShaft.position = new BABYLON.Vector3(0, 0.11, 0);
  stickShaft.parent = stickPivot;
  
  const stickMat = new BABYLON.StandardMaterial("stickMat", scene);
  stickMat.diffuseColor = new BABYLON.Color3(0.18, 0.18, 0.2);
  stickMat.specularColor = new BABYLON.Color3(0.25, 0.25, 0.25);
  stickShaft.material = stickMat;
  
  const stickGrip = BABYLON.MeshBuilder.CreateSphere(
    "stickGrip",
    { diameter: 0.04, segments: 6 },
    scene
  );
  stickGrip.position = new BABYLON.Vector3(0, 0.22, 0);
  stickGrip.parent = stickPivot;
  stickGrip.material = stickMat;
  
  // Pilot's right hand on stick
  const handRoot = new BABYLON.TransformNode("handRoot", scene);
  handRoot.parent = stickGrip;
  
  const handMat = new BABYLON.StandardMaterial("handMat", scene);
  handMat.diffuseColor = new BABYLON.Color3(0.72, 0.5, 0.38);
  
  // Palm
  const palm = BABYLON.MeshBuilder.CreateBox(
    "palm",
    { width: 0.032, height: 0.048, depth: 0.022 },
    scene
  );
  palm.position = new BABYLON.Vector3(-0.024, 0, 0);
  palm.rotation.z = -0.12;
  palm.parent = handRoot;
  palm.material = handMat;
  
  // Fingers
  for (let i = 0; i < 4; i++) {
    const finger = BABYLON.MeshBuilder.CreateCylinder(
      `finger${i}`,
      { diameter: 0.006, height: 0.032 },
      scene
    );
    const angle = (i / 4) * Math.PI * 0.35 - 0.175;
    finger.position = new BABYLON.Vector3(
      -0.036 + Math.sin(angle) * 0.02,
      -0.006 - i * 0.008,
      Math.cos(angle) * 0.02
    );
    finger.rotation.z = Math.PI / 2 + angle * 0.2;
    finger.parent = handRoot;
    finger.material = handMat;
  }
  
  // Thumb
  const thumb = BABYLON.MeshBuilder.CreateCylinder(
    "thumb",
    { diameter: 0.008, height: 0.026 },
    scene
  );
  thumb.position = new BABYLON.Vector3(-0.014, 0.014, 0.016);
  thumb.rotation.x = Math.PI / 2;
  thumb.rotation.z = -0.35;
  thumb.parent = handRoot;
  thumb.material = handMat;
  
  // Forearm extending down-right
  const forearm = BABYLON.MeshBuilder.CreateCylinder(
    "forearm",
    { diameter: 0.028, height: 0.16, tessellation: 6 },
    scene
  );
  forearm.position = new BABYLON.Vector3(-0.05, -0.04, 0.01);
  forearm.rotation.z = Math.PI / 2 + 0.25;
  forearm.rotation.y = 0.12;
  forearm.parent = handRoot;
  forearm.material = handMat;
  
  // VERY thin side frame rails at peripheral edges
  const leftFrame = BABYLON.MeshBuilder.CreateBox(
    "leftFrame",
    { width: 0.015, height: 0.7, depth: 0.8 },
    scene
  );
  leftFrame.position = new BABYLON.Vector3(-0.85, 0.2, 0.3);
  leftFrame.parent = cockpitRoot;
  leftFrame.material = panelMat;
  
  const rightFrame = BABYLON.MeshBuilder.CreateBox(
    "rightFrame",
    { width: 0.015, height: 0.7, depth: 0.8 },
    scene
  );
  rightFrame.position = new BABYLON.Vector3(0.85, 0.2, 0.3);
  rightFrame.parent = cockpitRoot;
  rightFrame.material = panelMat;
  
  // Thin top frame edge in peripheral view
  const topFrame = BABYLON.MeshBuilder.CreateBox(
    "topFrame",
    { width: 1.7, height: 0.015, depth: 0.02 },
    scene
  );
  topFrame.position = new BABYLON.Vector3(0, 0.75, 0.2);
  topFrame.parent = cockpitRoot;
  topFrame.material = panelMat;
  
  function updateStick(pitch, roll) {
    stickPivot.rotation.x = -pitch * 0.18;
    stickPivot.rotation.z = -roll * 0.18;
  }
  
  function setVisible(visible) {
    cockpitRoot.setEnabled(visible);
  }
  
  // Initially hidden
  setVisible(false);
  
  return { updateStick, setVisible };
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
    zoomIn: false,
    zoomOut: false,
    orbitToggle: false,
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

    if ((event.code === "Equal" || event.code === "NumpadAdd") && !event.repeat) {
      input.zoomIn = true;
    }

    if ((event.code === "Minus" || event.code === "NumpadSubtract") && !event.repeat) {
      input.zoomOut = true;
    }

    if (event.code === "KeyO" && !event.repeat) {
      input.orbitToggle = true;
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
    input.zoomIn = pressed.has("Equal") || pressed.has("NumpadAdd");
    input.zoomOut = pressed.has("Minus") || pressed.has("NumpadSubtract");
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

  function consumeOrbitToggle() {
    const toggle = input.orbitToggle;
    input.orbitToggle = false;
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
    consumeOrbitToggle,
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

  // Keep the camera inside the skybox even in high/overview orbits
  const skybox = BABYLON.MeshBuilder.CreateBox("skybox", { size: 20000 }, scene);
  const skyMat = new BABYLON.StandardMaterial("skyMat", scene);
  skyMat.backFaceCulling = false;
  skyMat.disableLighting = true;
  skyMat.emissiveColor = new BABYLON.Color3(0.6, 0.8, 1.0);
  skybox.material = skyMat;
  skybox.isPickable = false;
  skybox.infiniteDistance = true;

  const grassMat = new BABYLON.StandardMaterial("grassMat", scene);
  grassMat.diffuseColor = new BABYLON.Color3(0.18, 0.56, 0.22);
  grassMat.ambientColor = new BABYLON.Color3(0.1, 0.22, 0.12);
  grassMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
  grassMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHATESTANDBLEND;
  grassMat.alphaCutOff = 0.25;

  const terrainSeed = 42; // Fixed seed for persistent terrain
  const landConfig = {
    name: "landmass",
    size: 5000,
    x: 0,
    z: 0,
    hillHeight: 8,
    mountainHeight: 80,
    flattenCenterRadius: 350,
  };

  const landMaskOptions = {
    size: landConfig.size,
    seed: terrainSeed + 11,
    seedOffset: terrainSeed * 0.4,
    islandScaleLarge: 800,
    islandScaleSmall: 350,
    largeThreshold: 0.5,
    largeFalloff: 0.2,
    smallThreshold: 0.58,
    smallFalloff: 0.22,
    smallWeight: 0.7,
    coastScale: 225,
    coastThreshold: 0.45,
    coastFalloff: 0.35,
    coastCut: 0.35,
    centerRadius: 550,
    shoreStart: 0.3,
    shoreWidth: 0.14,
    hillScale: 150,
    mountainScale: 450,
    hillHeight: landConfig.hillHeight,
    mountainHeight: landConfig.mountainHeight,
    baseHeight: 2,
    seaFloorHeight: -6,
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

  const ocean = BABYLON.MeshBuilder.CreateGround(
    "ocean",
    { width: 2200, height: 2200 },
    scene
  );
  ocean.position.y = landMaskOptions.seaFloorHeight + 0.2;
  const oceanMat = new BABYLON.StandardMaterial("oceanMat", scene);
  oceanMat.diffuseColor = new BABYLON.Color3(0.1, 0.3, 0.6);
  oceanMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.2);
  ocean.material = oceanMat;

  const minimapSamples = 64;
  const minimapLand = new Array(minimapSamples * minimapSamples);
  for (let z = 0; z < minimapSamples; z += 1) {
    for (let x = 0; x < minimapSamples; x += 1) {
      const nx = x / (minimapSamples - 1) - 0.5;
      const nz = z / (minimapSamples - 1) - 0.5;
      const worldX = nx * landConfig.size;
      const worldZ = nz * landConfig.size;
      const mask = getLandMaskAt(worldX, worldZ, landMaskOptions);
      const shoreBlend = smoothStep(
        clamp(
          (mask - landMaskOptions.shoreStart) / landMaskOptions.shoreWidth,
          0,
          1
        )
      );
      minimapLand[z * minimapSamples + x] = shoreBlend;
    }
  }

  const runwayLength = 260;
  const runwayWidth = 40;
  
  // Create large concrete apron/taxiway area around the runway
  const apronSize = 200;
  const apron = BABYLON.MeshBuilder.CreateGround(
    "apron",
    { width: apronSize, height: apronSize, subdivisions: 30 },
    scene
  );
  apron.position.set(0, 1.03, 0);
  
  const apronMat = new BABYLON.StandardMaterial("apronMat", scene);
  apronMat.diffuseColor = new BABYLON.Color3(0.35, 0.35, 0.37);
  apronMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  apron.material = apronMat;
  
  // Create the runway
  const runway = BABYLON.MeshBuilder.CreateGround(
    "runway",
    { width: runwayWidth, height: runwayLength, subdivisions: 50 },
    scene
  );
  runway.position.set(0, 1.05, 0);
  
  const runwayMat = new BABYLON.StandardMaterial("runwayMat", scene);
  runwayMat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.13);
  runwayMat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
  runway.material = runwayMat;

  const markingMat = new BABYLON.StandardMaterial("markingMat", scene);
  markingMat.diffuseColor = new BABYLON.Color3(0.95, 0.95, 0.95);
  markingMat.emissiveColor = new BABYLON.Color3(0.2, 0.2, 0.2);
  markingMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);

  // Dashed center line - white dashes down the middle
  const centerLineCount = 14;
  const centerLineLength = 10;
  const centerLineGap = 12;
  for (let i = 0; i < centerLineCount; i += 1) {
    const dash = BABYLON.MeshBuilder.CreateBox(
      `runway-dash-${i}`,
      { width: 1.2, height: 0.02, depth: centerLineLength },
      scene
    );
    dash.position.set(
      0,
      1.08,
      -runwayLength / 2 + 45 + i * (centerLineLength + centerLineGap)
    );
    dash.material = markingMat;
  }

  // Runway edge lines - solid white lines on both sides
  const leftEdgeLine = BABYLON.MeshBuilder.CreateBox(
    "runway-left-edge",
    { width: 1.5, height: 0.02, depth: runwayLength },
    scene
  );
  leftEdgeLine.position.set(-runwayWidth / 2 + 0.8, 1.08, 0);
  leftEdgeLine.material = markingMat;
  
  const rightEdgeLine = BABYLON.MeshBuilder.CreateBox(
    "runway-right-edge",
    { width: 1.5, height: 0.02, depth: runwayLength },
    scene
  );
  rightEdgeLine.position.set(runwayWidth / 2 - 0.8, 1.08, 0);
  rightEdgeLine.material = markingMat;

  // THRESHOLD AREA - White border frame around the entire marking zone
  const thresholdFrameZ = -runwayLength / 2 + 22;
  
  // Frame border - white rectangle outline
  const thresholdFrameTop = BABYLON.MeshBuilder.CreateBox(
    "threshold-frame-top",
    { width: 36, height: 0.02, depth: 1.5 },
    scene
  );
  thresholdFrameTop.position.set(0, 1.08, thresholdFrameZ);
  thresholdFrameTop.material = markingMat;
  
  const thresholdFrameBottom = BABYLON.MeshBuilder.CreateBox(
    "threshold-frame-bottom",
    { width: 36, height: 0.02, depth: 1.5 },
    scene
  );
  thresholdFrameBottom.position.set(0, 1.08, thresholdFrameZ + 18);
  thresholdFrameBottom.material = markingMat;
  
  const thresholdFrameLeft = BABYLON.MeshBuilder.CreateBox(
    "threshold-frame-left",
    { width: 1.5, height: 0.02, depth: 18 },
    scene
  );
  thresholdFrameLeft.position.set(-18, 1.08, thresholdFrameZ + 9);
  thresholdFrameLeft.material = markingMat;
  
  const thresholdFrameRight = BABYLON.MeshBuilder.CreateBox(
    "threshold-frame-right",
    { width: 1.5, height: 0.02, depth: 18 },
    scene
  );
  thresholdFrameRight.position.set(18, 1.08, thresholdFrameZ + 9);
  thresholdFrameRight.material = markingMat;

  // Threshold blocks - 4 pairs on each side of centerline
  const thresholdBlockZ = -runwayLength / 2 + 8;
  const thresholdBlockSpacing = 3.2;
  
  for (let i = 0; i < 4; i++) {
    // Left side blocks
    const leftBlock = BABYLON.MeshBuilder.CreateBox(
      `threshold-left-${i}`,
      { width: 4.5, height: 0.02, depth: 2.2 },
      scene
    );
    leftBlock.position.set(-6.5, 1.08, thresholdBlockZ + i * thresholdBlockSpacing);
    leftBlock.material = markingMat;
    
    // Right side blocks
    const rightBlock = BABYLON.MeshBuilder.CreateBox(
      `threshold-right-${i}`,
      { width: 4.5, height: 0.02, depth: 2.2 },
      scene
    );
    rightBlock.position.set(6.5, 1.08, thresholdBlockZ + i * thresholdBlockSpacing);
    rightBlock.material = markingMat;
  }
  
  // Touchdown zone markings - 3 pairs of rectangles on each side
  const tdStart = -runwayLength / 2 + 50;
  const tdSpacing = 22;
  const tdWidth = 4.5;
  const tdDepth = 10;
  
  for (let i = 0; i < 3; i++) {
    // Left side
    const tdLeft = BABYLON.MeshBuilder.CreateBox(
      `touchdown-left-${i}`,
      { width: tdWidth, height: 0.02, depth: tdDepth },
      scene
    );
    tdLeft.position.set(-6.5, 1.08, tdStart + i * tdSpacing);
    tdLeft.material = markingMat;
    
    // Right side
    const tdRight = BABYLON.MeshBuilder.CreateBox(
      `touchdown-right-${i}`,
      { width: tdWidth, height: 0.02, depth: tdDepth },
      scene
    );
    tdRight.position.set(6.5, 1.08, tdStart + i * tdSpacing);
    tdRight.material = markingMat;
  }

  // RUNWAY NUMBERS - Large white numerals
  // Bottom end - "09"
  const num09BaseZ = -runwayLength / 2 + 28;
  
  // "0" blocks - left side
  // Vertical left line
  const num0_v1 = BABYLON.MeshBuilder.CreateBox(`num-09-0-v1`, { width: 1.8, height: 0.02, depth: 8 }, scene);
  num0_v1.position.set(-8, 1.08, num09BaseZ);
  num0_v1.material = markingMat;
  
  // Vertical right line
  const num0_v2 = BABYLON.MeshBuilder.CreateBox(`num-09-0-v2`, { width: 1.8, height: 0.02, depth: 8 }, scene);
  num0_v2.position.set(-4, 1.08, num09BaseZ);
  num0_v2.material = markingMat;
  
  // Top horizontal
  const num0_h1 = BABYLON.MeshBuilder.CreateBox(`num-09-0-h1`, { width: 4.8, height: 0.02, depth: 1.8 }, scene);
  num0_h1.position.set(-6, 1.08, num09BaseZ - 3.5);
  num0_h1.material = markingMat;
  
  // Bottom horizontal
  const num0_h2 = BABYLON.MeshBuilder.CreateBox(`num-09-0-h2`, { width: 4.8, height: 0.02, depth: 1.8 }, scene);
  num0_h2.position.set(-6, 1.08, num09BaseZ + 3.5);
  num0_h2.material = markingMat;
  
  // "9" blocks - right side
  // Vertical left line
  const num9_v1 = BABYLON.MeshBuilder.CreateBox(`num-09-9-v1`, { width: 1.8, height: 0.02, depth: 8 }, scene);
  num9_v1.position.set(4, 1.08, num09BaseZ);
  num9_v1.material = markingMat;
  
  // Vertical right line
  const num9_v2 = BABYLON.MeshBuilder.CreateBox(`num-09-9-v2`, { width: 1.8, height: 0.02, depth: 8 }, scene);
  num9_v2.position.set(8, 1.08, num09BaseZ);
  num9_v2.material = markingMat;
  
  // Top horizontal
  const num9_h1 = BABYLON.MeshBuilder.CreateBox(`num-09-9-h1`, { width: 4.8, height: 0.02, depth: 1.8 }, scene);
  num9_h1.position.set(6, 1.08, num09BaseZ - 3.5);
  num9_h1.material = markingMat;
  
  // Middle horizontal
  const num9_h2 = BABYLON.MeshBuilder.CreateBox(`num-09-9-h2`, { width: 4.8, height: 0.02, depth: 1.8 }, scene);
  num9_h2.position.set(6, 1.08, num09BaseZ);
  num9_h2.material = markingMat;
  
  // Bottom horizontal
  const num9_h3 = BABYLON.MeshBuilder.CreateBox(`num-09-9-h3`, { width: 4.8, height: 0.02, depth: 1.8 }, scene);
  num9_h3.position.set(6, 1.08, num09BaseZ + 3.5);
  num9_h3.material = markingMat;
  
  // Top end - "27"
  const num27BaseZ = runwayLength / 2 - 28;
  
  // "2" blocks - left side
  // Top horizontal
  const num2_h1 = BABYLON.MeshBuilder.CreateBox(`num-27-2-h1`, { width: 4.8, height: 0.02, depth: 1.8 }, scene);
  num2_h1.position.set(-6, 1.08, num27BaseZ - 3.5);
  num2_h1.material = markingMat;
  
  // Middle horizontal
  const num2_h2 = BABYLON.MeshBuilder.CreateBox(`num-27-2-h2`, { width: 4.8, height: 0.02, depth: 1.8 }, scene);
  num2_h2.position.set(-6, 1.08, num27BaseZ);
  num2_h2.material = markingMat;
  
  // Bottom horizontal
  const num2_h3 = BABYLON.MeshBuilder.CreateBox(`num-27-2-h3`, { width: 4.8, height: 0.02, depth: 1.8 }, scene);
  num2_h3.position.set(-6, 1.08, num27BaseZ + 3.5);
  num2_h3.material = markingMat;
  
  // Upper right vertical
  const num2_v1 = BABYLON.MeshBuilder.CreateBox(`num-27-2-v1`, { width: 1.8, height: 0.02, depth: 3.6 }, scene);
  num2_v1.position.set(-4, 1.08, num27BaseZ - 2);
  num2_v1.material = markingMat;
  
  // Lower left vertical
  const num2_v2 = BABYLON.MeshBuilder.CreateBox(`num-27-2-v2`, { width: 1.8, height: 0.02, depth: 3.6 }, scene);
  num2_v2.position.set(-8, 1.08, num27BaseZ + 2);
  num2_v2.material = markingMat;
  
  // "7" blocks - right side
  // Top horizontal
  const num7_h1 = BABYLON.MeshBuilder.CreateBox(`num-27-7-h1`, { width: 4.8, height: 0.02, depth: 1.8 }, scene);
  num7_h1.position.set(6, 1.08, num27BaseZ - 3.5);
  num7_h1.material = markingMat;
  
  // Vertical left line (from top to middle)
  const num7_v1 = BABYLON.MeshBuilder.CreateBox(`num-27-7-v1`, { width: 1.8, height: 0.02, depth: 8 }, scene);
  num7_v1.position.set(4, 1.08, num27BaseZ);
  num7_v1.material = markingMat;
  
  // Vertical right line (from top to middle)
  const num7_v2 = BABYLON.MeshBuilder.CreateBox(`num-27-7-v2`, { width: 1.8, height: 0.02, depth: 8 }, scene);
  num7_v2.position.set(8, 1.08, num27BaseZ);
  num7_v2.material = markingMat;

  // Add taxiway lines
  const taxiwayMat = new BABYLON.StandardMaterial("taxiwayMat", scene);
  taxiwayMat.diffuseColor = new BABYLON.Color3(0.9, 0.8, 0.1);
  taxiwayMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

  // Taxiway to left parking area
  const taxiwayLeft = BABYLON.MeshBuilder.CreateBox(
    "taxiway-left",
    { width: 20, height: 0.02, depth: 80 },
    scene
  );
  taxiwayLeft.position.set(-50, 1.08, 40);
  taxiwayLeft.material = taxiwayMat;

  // Taxiway to right parking area
  const taxiwayRight = BABYLON.MeshBuilder.CreateBox(
    "taxiway-right",
    { width: 20, height: 0.02, depth: 80 },
    scene
  );
  taxiwayRight.position.set(50, 1.08, 40);
  taxiwayRight.material = taxiwayMat;

  // Terminal building
  const terminalGroup = new BABYLON.TransformNode("terminal", scene);
  terminalGroup.position.set(-60, 0, 80);
  
  const terminalBody = BABYLON.MeshBuilder.CreateBox(
    "terminalBody",
    { width: 60, height: 20, depth: 40 },
    scene
  );
  terminalBody.parent = terminalGroup;
  
  const terminalMat = new BABYLON.StandardMaterial("terminalMat", scene);
  terminalMat.diffuseColor = new BABYLON.Color3(0.85, 0.82, 0.75);
  terminalMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
  terminalBody.material = terminalMat;
  
  // Windows on terminal
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      const window = BABYLON.MeshBuilder.CreateBox(
        `window-${row}-${col}`,
        { width: 3.5, height: 3, depth: 0.5 },
        scene
      );
      window.position = new BABYLON.Vector3(
        -28 + col * 7,
        8 + row * 4,
        20.3
      );
      window.parent = terminalGroup;
      
      const windowMat = new BABYLON.StandardMaterial(`windowMat-${row}-${col}`, scene);
      windowMat.diffuseColor = new BABYLON.Color3(0.6, 0.7, 0.85);
      windowMat.emissiveColor = new BABYLON.Color3(0.15, 0.2, 0.3);
      window.material = windowMat;
    }
  }
  
  // Hangar building
  const hangarGroup = new BABYLON.TransformNode("hangar", scene);
  hangarGroup.position.set(70, 0, 60);
  
  const hangarBody = BABYLON.MeshBuilder.CreateBox(
    "hangarBody",
    { width: 50, height: 25, depth: 60 },
    scene
  );
  hangarBody.parent = hangarGroup;
  
  const hangarMat = new BABYLON.StandardMaterial("hangarMat", scene);
  hangarMat.diffuseColor = new BABYLON.Color3(0.7, 0.65, 0.6);
  hangarMat.specularColor = new BABYLON.Color3(0.15, 0.15, 0.15);
  hangarBody.material = hangarMat;
  
  // Hangar doors
  const hangarDoor = BABYLON.MeshBuilder.CreateBox(
    "hangarDoor",
    { width: 45, height: 22, depth: 2 },
    scene
  );
  hangarDoor.position.set(0, 1, 30.5);
  hangarDoor.parent = hangarGroup;
  
  const doorMat = new BABYLON.StandardMaterial("doorMat", scene);
  doorMat.diffuseColor = new BABYLON.Color3(0.5, 0.48, 0.45);
  doorMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
  hangarDoor.material = doorMat;
  
  // Control tower - right next to runway
  const towerGroup = new BABYLON.TransformNode("tower", scene);
  towerGroup.position.set(25, 0, 0);
  
  const towerBase = BABYLON.MeshBuilder.CreateBox(
    "towerBase",
    { width: 12, height: 3, depth: 12 },
    scene
  );
  towerBase.parent = towerGroup;
  const baseMat = new BABYLON.StandardMaterial("baseMat", scene);
  baseMat.diffuseColor = new BABYLON.Color3(0.75, 0.72, 0.65);
  towerBase.material = baseMat;
  
  const towerShaft = BABYLON.MeshBuilder.CreateCylinder(
    "towerShaft",
    { diameter: 8, height: 35 },
    scene
  );
  towerShaft.position.set(0, 18, 0);
  towerShaft.parent = towerGroup;
  towerShaft.material = baseMat;
  
  const towerCab = BABYLON.MeshBuilder.CreateCylinder(
    "towerCab",
    { diameter: 10, height: 8 },
    scene
  );
  towerCab.position.set(0, 39, 0);
  towerCab.parent = towerGroup;
  
  const cabMat = new BABYLON.StandardMaterial("cabMat", scene);
  cabMat.diffuseColor = new BABYLON.Color3(0.6, 0.7, 0.85);
  cabMat.emissiveColor = new BABYLON.Color3(0.1, 0.15, 0.25);
  towerCab.material = cabMat;


  const roofMat = new BABYLON.StandardMaterial("roofMat", scene);
  roofMat.diffuseColor = new BABYLON.Color3(0.22, 0.22, 0.24);
  roofMat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);

  const buildingStyles = [
    {
      base: new BABYLON.Color3(0.67, 0.67, 0.7),
      window: new BABYLON.Color3(0.85, 0.88, 0.9),
      accent: new BABYLON.Color3(0.5, 0.52, 0.55),
    },
    {
      base: new BABYLON.Color3(0.62, 0.58, 0.52),
      window: new BABYLON.Color3(0.82, 0.83, 0.76),
      accent: new BABYLON.Color3(0.42, 0.38, 0.33),
    },
    {
      base: new BABYLON.Color3(0.55, 0.6, 0.65),
      window: new BABYLON.Color3(0.72, 0.8, 0.86),
      accent: new BABYLON.Color3(0.36, 0.4, 0.45),
    },
    {
      base: new BABYLON.Color3(0.7, 0.64, 0.58),
      window: new BABYLON.Color3(0.9, 0.86, 0.78),
      accent: new BABYLON.Color3(0.5, 0.44, 0.38),
    },
  ];

  function colorToCss(color) {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function createWindowTexture(sceneRef, name, options) {
    const size = 256;
    const texture = new BABYLON.DynamicTexture(
      name,
      { width: size, height: size },
      sceneRef,
      false
    );
    const ctx = texture.getContext();

    ctx.fillStyle = colorToCss(options.base);
    ctx.fillRect(0, 0, size, size);

    if (options.accent) {
      ctx.fillStyle = colorToCss(options.accent);
      ctx.fillRect(size * 0.08, 0, size * 0.06, size);
    }

    const rows = options.rows;
    const cols = options.cols;
    const margin = size * 0.1;
    const usableW = size - margin * 2;
    const usableH = size - margin * 2;
    const stepX = usableW / cols;
    const stepY = usableH / rows;
    const windowW = stepX * 0.55;
    const windowH = stepY * 0.55;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const noise = hash2d(
          row + options.seed * 0.1,
          col + options.seed * 0.2,
          options.seed
        );
        if (noise < 0.08) {
          continue;
        }
        const intensity = 0.65 + noise * 0.35;
        const windowColor = new BABYLON.Color3(
          clamp(options.window.r * intensity, 0, 1),
          clamp(options.window.g * intensity, 0, 1),
          clamp(options.window.b * intensity, 0, 1)
        );
        ctx.fillStyle = colorToCss(windowColor);
        const x = margin + col * stepX + (stepX - windowW) * 0.5;
        const y = margin + row * stepY + (stepY - windowH) * 0.5;
        ctx.fillRect(x, y, windowW, windowH);
      }
    }

    texture.update(false);
    texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    return texture;
  }

  function createBuildingMaterial(sceneRef, config) {
    const styleIndex = Math.floor(
      hash2d(config.x, config.z, 31) * buildingStyles.length
    );
    const style = buildingStyles[styleIndex];
    const rows = clamp(Math.round(config.h * 0.9), 4, 12);
    const cols = clamp(Math.round(Math.max(config.w, config.d) * 0.5), 3, 10);
    const texture = createWindowTexture(
      sceneRef,
      `building-tex-${config.x}-${config.z}`,
      {
        base: style.base,
        window: style.window,
        accent: style.accent,
        rows,
        cols,
        seed: Math.abs(Math.round(config.x * 9 + config.z * 7)),
      }
    );
    const material = new BABYLON.StandardMaterial(
      `buildingMat-${config.x}-${config.z}`,
      sceneRef
    );
    material.diffuseTexture = texture;
    material.specularColor = new BABYLON.Color3(0.15, 0.15, 0.16);
    material.emissiveColor = new BABYLON.Color3(0.03, 0.03, 0.035);
    return material;
  }

  function addRooftopUnit(sceneRef, parent, config) {
    const unitHeight = Math.max(1.2, config.h * 0.08);
    const unitWidth = Math.max(2.5, config.w * 0.35);
    const unitDepth = Math.max(2.5, config.d * 0.35);
    const unit = BABYLON.MeshBuilder.CreateBox(
      `${parent.name}-rooftop`,
      {
        width: unitWidth,
        height: unitHeight,
        depth: unitDepth,
      },
      sceneRef
    );
    unit.position.set(0, config.h * 0.5 + unitHeight * 0.5 + 0.6, 0);
    unit.material = roofMat;
    unit.parent = parent;
  }

  function addSideAnnex(sceneRef, parent, config, material) {
    const annexWidth = config.w * 0.45;
    const annexHeight = config.h * 0.55;
    const annexDepth = config.d * 0.55;
    const annex = BABYLON.MeshBuilder.CreateBox(
      `${parent.name}-annex`,
      {
        width: annexWidth,
        height: annexHeight,
        depth: annexDepth,
      },
      sceneRef
    );
    const offset = (config.w + annexWidth) * 0.35;
    const side = hash2d(config.x, config.z, 91) > 0.5 ? 1 : -1;
    annex.position.set(side * offset, -config.h * 0.15, 0);
    annex.material = material;
    annex.parent = parent;
  }

  const buildingConfigs = [
    { x: -60, z: -40, w: 20, h: 12, d: 15 },
    { x: -35, z: -50, w: 15, h: 18, d: 12 },
    { x: -80, z: -65, w: 18, h: 8, d: 18 },
    { x: 50, z: -35, w: 22, h: 15, d: 20 },
    { x: 70, z: -60, w: 16, h: 20, d: 14 },
    { x: 85, z: -85, w: 12, h: 10, d: 12 },
    { x: -45, z: 40, w: 14, h: 14, d: 16 },
    { x: 60, z: 50, w: 18, h: 12, d: 15 },
  ];

  for (const config of buildingConfigs) {
    const buildingMat = createBuildingMaterial(scene, config);
    const building = BABYLON.MeshBuilder.CreateBox(
      `building-${config.x}-${config.z}`,
      { width: config.w, height: config.h, depth: config.d },
      scene
    );
    building.position.set(config.x, config.h / 2 + 1, config.z);
    building.material = buildingMat;
    if (config.h >= 12) {
      addRooftopUnit(scene, building, config);
    }
    if (config.w >= 16 && config.d >= 14) {
      addSideAnnex(scene, building, config, buildingMat);
    }
  }

  const runwayStart = new BABYLON.Vector3(
    0,
    2,
    -runwayLength / 2 + 6
  );

  const { mesh: jet, controller } = await createJet(scene, runwayStart);
  controller.reset();
  const cockpit = createCockpit(scene, jet);
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
  let overviewAngle = Math.PI;
  let orbitEnabled = true;
  let overviewRadius = landConfig.size * 0.75;
  const overviewHeightRatio = 0.35;
  const overviewRadiusLimits = {
    min: landConfig.size * 0.2,
    max: landConfig.size * 1.5,
  };
  const overviewZoomStep = landConfig.size * 0.2;

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
      camera.fov = 0.8; // Default FOV
      cockpit.setVisible(false);
    } else if (cameraMode === "cockpit") {
      // Camera positioned INSIDE the cockpit at pilot's seat
      const camPos = jet.position.add(up.scale(0.75)); // Pilot sits up slightly
      const target = jet.position.add(forward.scale(50)); // Looking far ahead
      camera.position.copyFrom(camPos);
      camera.setTarget(target);
      camera.upVector = up;
      camera.fov = 1.1; // Wide natural FOV
      cockpit.setVisible(true);
    } else {
      const overviewHeight = overviewRadius * overviewHeightRatio;
      const orbitSpeed = 0.08;
      if (orbitEnabled) {
        overviewAngle += orbitSpeed * (engine.getDeltaTime() / 1000);
      }
      const camPos = new BABYLON.Vector3(
        Math.sin(overviewAngle) * overviewRadius,
        overviewHeight,
        Math.cos(overviewAngle) * overviewRadius
      );
      camera.position.copyFrom(camPos);
      camera.setTarget(new BABYLON.Vector3(landConfig.x, 0, landConfig.z));
      camera.upVector = BABYLON.Vector3.Up();
      camera.fov = 0.8; // Default FOV
      cockpit.setVisible(false);
    }
  }

  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime() / 1000;
    const clampedDt = clamp(dt, 0, 0.05);

    inputManager.updateAxes();

    if (inputManager.consumeToggle()) {
      if (cameraMode === "chase") {
        cameraMode = "cockpit";
      } else if (cameraMode === "cockpit") {
        cameraMode = "overview";
      } else {
        cameraMode = "chase";
      }
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

    if (cameraMode === "overview") {
      const zoomDirection = (inputManager.input.zoomOut ? 1 : 0) - (inputManager.input.zoomIn ? 1 : 0);
      if (zoomDirection !== 0) {
        overviewRadius = clamp(
          overviewRadius + zoomDirection * overviewZoomStep,
          overviewRadiusLimits.min,
          overviewRadiusLimits.max
        );
      }

      if (inputManager.consumeOrbitToggle()) {
        orbitEnabled = !orbitEnabled;
      }
    }

    if (!isPaused) {
      controller.update(
        clampedDt,
        inputManager.input,
        brakeEngaged,
        autoLevelEnabled
      );
    }

    // Update cockpit stick position based on input
    cockpit.updateStick(
      inputManager.input.pitch,
      inputManager.input.roll
    );

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
      landMapWorldSize: landConfig.size,
      worldExtent: 1000,
      isPaused,
      brakeEngaged,
    });

    scene.render();
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
}
