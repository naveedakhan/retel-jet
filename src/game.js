import * as BABYLON from "babylonjs";
import { createJet } from "./jet.js";
import { createHUD } from "./ui.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeWorldBounds(meshes) {
  let min = new BABYLON.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY
  );
  let max = new BABYLON.Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  );

  meshes.forEach((mesh) => {
    mesh.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    min = BABYLON.Vector3.Minimize(min, bounds.minimumWorld);
    max = BABYLON.Vector3.Maximize(max, bounds.maximumWorld);
  });

  return {
    min,
    max,
    size: max.subtract(min),
    center: min.add(max).scale(0.5),
  };
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
  const loopAudio = new Audio("/loop.wav");
  loopAudio.loop = true;
  loopAudio.volume = 0;
  loopAudio.preload = "auto";

  const startAudio = new Audio("/start.wav");
  startAudio.loop = false;
  startAudio.volume = 0;
  startAudio.preload = "auto";

  const endAudio = new Audio("/end.wav");
  endAudio.loop = false;
  endAudio.volume = 0;
  endAudio.preload = "auto";

  let currentLoopVolume = 0;
  let currentLoopRate = 0.9;
  let currentStartVolume = 0;
  let currentEndVolume = 0;
  let lastThrottle = 0;
  let started = false;
  let isPaused = false;

  const playSafely = (audio) => {
    audio.play().catch(() => {});
  };

  const playOneShot = (audio) => {
    if (!audio.paused) {
      return;
    }
    audio.currentTime = 0;
    playSafely(audio);
  };

  const requestStart = () => {
    if (!started) {
      started = true;
      playSafely(loopAudio);
    }
  };

  window.addEventListener("pointerdown", requestStart, { once: true });
  window.addEventListener("click", requestStart, { once: true });
  window.addEventListener("keydown", requestStart, { once: true });

  function update(dt, throttle) {
    if (isPaused) {
      return;
    }

    const deltaRate = (throttle - lastThrottle) / Math.max(dt, 0.001);
    const upStrength = clamp((deltaRate - 0.05) / 0.55, 0, 1);
    const downStrength = clamp((-deltaRate - 0.05) / 0.55, 0, 1);
    const steeringStrength = Math.max(upStrength, downStrength);

    const baseLoopVolume = BABYLON.Scalar.Lerp(0.05, 0.9, throttle);
    const targetLoopVolume = baseLoopVolume * (1 - 0.4 * steeringStrength);
    const targetLoopRate = BABYLON.Scalar.Lerp(0.85, 1.45, throttle);

    const targetStartVolume =
      upStrength * BABYLON.Scalar.Lerp(0.12, 0.85, throttle);
    const targetEndVolume =
      downStrength * BABYLON.Scalar.Lerp(0.12, 0.75, 1 - throttle);

    const response = 1 - Math.exp(-dt * 6);

    currentLoopVolume += (targetLoopVolume - currentLoopVolume) * response;
    currentLoopRate += (targetLoopRate - currentLoopRate) * response;
    currentStartVolume += (targetStartVolume - currentStartVolume) * response;
    currentEndVolume += (targetEndVolume - currentEndVolume) * response;

    loopAudio.volume = currentLoopVolume;
    loopAudio.playbackRate = currentLoopRate;
    startAudio.volume = currentStartVolume;
    endAudio.volume = currentEndVolume;

    if (started && upStrength > 0.02) {
      startAudio.playbackRate = BABYLON.Scalar.Lerp(0.95, 1.2, throttle);
      playOneShot(startAudio);
    }

    if (started && downStrength > 0.02) {
      endAudio.playbackRate = BABYLON.Scalar.Lerp(0.95, 1.15, 1 - throttle);
      playOneShot(endAudio);
    }

    if (started && loopAudio.paused) {
      playSafely(loopAudio);
    }

    lastThrottle = throttle;
  }

  function setPaused(paused) {
    if (paused === isPaused) {
      return;
    }

    isPaused = paused;
    if (isPaused) {
      loopAudio.pause();
      startAudio.pause();
      endAudio.pause();
      return;
    }

    if (started) {
      playSafely(loopAudio);
    }
  }

  return { update, setPaused };
}

function requestScenarioSelection() {
  const existing = document.getElementById("scenarioModal");
  if (existing) {
    existing.remove();
  }

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "scenarioModal";
    overlay.className = "scenario-modal";

    const card = document.createElement("div");
    card.className = "scenario-card";

    const title = document.createElement("h2");
    title.textContent = "Select Scenario";
    card.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.textContent = "Choose the starting environment for your flight.";
    card.appendChild(subtitle);

    const options = document.createElement("div");
    options.className = "scenario-options";

    const makeOption = (id, label, description) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scenario-option";
      button.dataset.scenario = id;

      const name = document.createElement("span");
      name.className = "scenario-title";
      name.textContent = label;

      const detail = document.createElement("span");
      detail.className = "scenario-desc";
      detail.textContent = description;

      button.appendChild(name);
      button.appendChild(detail);
      button.addEventListener("click", () => {
        overlay.classList.add("hidden");
        setTimeout(() => overlay.remove(), 150);
        resolve(id);
      });
      return button;
    };

    options.appendChild(
      makeOption(
        "basic",
        "Basic",
        "Classic runway, apron, buildings, and city blocks."
      )
    );
    options.appendChild(
      makeOption(
        "airport",
        "Airport",
        "Load the detailed airport model with a flatter terrain."
      )
    );
    options.appendChild(
      makeOption(
        "carrier",
        "Carrier",
        "Sparse green seas with an anchored aircraft carrier."
      )
    );
    card.appendChild(options);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}

function getScenarioConfig(scenarioId) {
  if (scenarioId === "airport") {
    return {
      id: "airport",
      useAirportModel: true,
      airportTargetLength: 320,
      landOverrides: {
        hillHeight: 4,
        mountainHeight: 45,
        flattenCenterRadius: 1000,
      },
      maskOverrides: {
        centerRadius: 1400,
        largeThreshold: 0.54,
        smallThreshold: 0.6,
        coastCut: 0.25,
        shoreStart: 0.26,
        shoreWidth: 0.18,
      },
    };
  }

  if (scenarioId === "carrier") {
    return {
      id: "carrier",
      useCarrierModel: true,
      carrierLaunchEnd: "min",
      carrierTargetLength: 330,
      oceanSize: 6000,
      oceanColor: new BABYLON.Color3(0.08, 0.4, 0.28),
      landOverrides: {
        size: 6000,
        hillHeight: 3,
        mountainHeight: 22,
        flattenCenterRadius: 0,
      },
      maskOverrides: {
        islandScaleLarge: 1500,
        islandScaleSmall: 800,
        largeThreshold: 0.64,
        largeFalloff: 0.18,
        smallThreshold: 0.72,
        smallFalloff: 0.2,
        smallWeight: 0.35,
        coastScale: 320,
        coastThreshold: 0.52,
        coastFalloff: 0.25,
        coastCut: 0.55,
        centerRadius: 0,
        shoreStart: 0.22,
        shoreWidth: 0.1,
        baseHeight: 1.2,
        seaFloorHeight: -1.8,
      },
    };
  }

  return {
    id: "basic",
    useAirportModel: false,
  };
}

async function loadAirportModel(scene, targetLength) {
  const root = new BABYLON.TransformNode("airportRoot", scene);
  root.rotationQuaternion = BABYLON.Quaternion.Identity();

  const result = await BABYLON.SceneLoader.ImportMeshAsync(
    "",
    "/",
    "airport.glb",
    scene
  );
  const importedRoot = result.meshes[0];
  importedRoot.parent = root;

  const renderMeshes = result.meshes.filter(
    (mesh) => mesh.getTotalVertices && mesh.getTotalVertices() > 0
  );
  let bounds = computeWorldBounds(renderMeshes);
  const lengthAxis = Math.max(bounds.size.x, bounds.size.z);
  if (lengthAxis > 0) {
    const scale = targetLength / lengthAxis;
    root.scaling.setAll(scale);
    bounds = computeWorldBounds(renderMeshes);
  }

  const centerLocal = bounds.center.subtract(root.position);
  root.position.subtractInPlace(centerLocal);

  bounds = computeWorldBounds(renderMeshes);
  root.position.y += 1 - bounds.min.y;
  bounds = computeWorldBounds(renderMeshes);

  const isZAxis = bounds.size.z >= bounds.size.x;
  const axisMin = isZAxis ? bounds.min.z : bounds.min.x;
  const axisLength = isZAxis ? bounds.size.z : bounds.size.x;
  const offset = Math.max(20, axisLength * 0.12);
  const startPosition = new BABYLON.Vector3(
    bounds.center.x,
    2,
    bounds.center.z
  );
  if (isZAxis) {
    startPosition.z = axisMin + offset;
  } else {
    startPosition.x = axisMin + offset;
  }

  return { root, bounds, startPosition };
}

async function loadCarrierModel(scene, targetLength, oceanY, launchEnd) {
  const root = new BABYLON.TransformNode("carrierRoot", scene);
  root.rotationQuaternion = BABYLON.Quaternion.Identity();

  const result = await BABYLON.SceneLoader.ImportMeshAsync(
    "",
    "/",
    "gerald_r_ford_aircraft_carrier.glb",
    scene
  );
  const importedRoot = result.meshes[0];
  importedRoot.parent = root;

  const renderMeshes = result.meshes.filter(
    (mesh) => mesh.getTotalVertices && mesh.getTotalVertices() > 0
  );
  renderMeshes.forEach((mesh) => {
    mesh.isPickable = true;
  });
  let bounds = computeWorldBounds(renderMeshes);
  const lengthAxis = Math.max(bounds.size.x, bounds.size.z);
  if (lengthAxis > 0) {
    const scale = targetLength / lengthAxis;
    root.scaling.setAll(scale);
    bounds = computeWorldBounds(renderMeshes);
  }

  const centerLocal = bounds.center.subtract(root.position);
  root.position.subtractInPlace(centerLocal);
  bounds = computeWorldBounds(renderMeshes);

  const hullHeight = bounds.size.y;
  const waterline = bounds.min.y + hullHeight * 0.3;
  root.position.y += oceanY - waterline;
  bounds = computeWorldBounds(renderMeshes);

  const isZAxis = bounds.size.z >= bounds.size.x;
  const launchPoint = findCarrierLaunchPoint(
    scene,
    renderMeshes,
    bounds,
    isZAxis,
    launchEnd
  );
  const launchYaw = computeCarrierLaunchYaw(isZAxis, launchEnd);
  const startPosition = launchPoint
    ? launchPoint.point.add(new BABYLON.Vector3(0, 0.6, 0))
    : new BABYLON.Vector3(bounds.center.x, bounds.max.y + 1, bounds.center.z);

  const deckHeightAtStart = launchPoint?.point.y ?? null;
  const fallbackDeckHeight = sampleCarrierDeckHeight(
    scene,
    renderMeshes,
    bounds,
    isZAxis
  );
  const deckHeight =
    deckHeightAtStart ??
    fallbackDeckHeight ??
    bounds.max.y - bounds.size.y * 0.05;
  startPosition.y = deckHeight + 0.6;

  return {
    root,
    bounds,
    startPosition,
    deckHeight,
    renderMeshes,
    isZAxis,
    launchYaw,
  };
}

function sampleCarrierDeckHeight(scene, renderMeshes, bounds, isZAxis) {
  const meshSet = new Set(renderMeshes);
  const length = isZAxis ? bounds.size.z : bounds.size.x;
  const width = isZAxis ? bounds.size.x : bounds.size.z;
  const centerX = bounds.center.x;
  const centerZ = bounds.center.z;
  const rayStartY = bounds.max.y + 50;

  const samples = [];
  const lengthSteps = 9;
  const widthSteps = 5;
  for (let i = 0; i < lengthSteps; i += 1) {
    const u = -0.45 + (0.9 * i) / (lengthSteps - 1);
    for (let j = 0; j < widthSteps; j += 1) {
      const v = -0.35 + (0.7 * j) / (widthSteps - 1);
      const x = isZAxis ? centerX + v * width : centerX + u * length;
      const z = isZAxis ? centerZ + u * length : centerZ + v * width;
      const origin = new BABYLON.Vector3(x, rayStartY, z);
      const ray = new BABYLON.Ray(origin, new BABYLON.Vector3(0, -1, 0), 200);
      const hit = scene.pickWithRay(ray, (mesh) => meshSet.has(mesh));
      if (hit && hit.pickedPoint) {
        const normal = hit.getNormal && hit.getNormal(true);
        if (!normal || normal.y > 0.35) {
          samples.push(hit.pickedPoint.y);
        }
      }
    }
  }

  if (samples.length === 0) {
    return bounds.min.y + bounds.size.y * 0.72;
  }

  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.5)];
}

function findCarrierLaunchPoint(scene, renderMeshes, bounds, isZAxis, launchEnd) {
  const meshSet = new Set(renderMeshes);
  const axisLength = isZAxis ? bounds.size.z : bounds.size.x;
  const width = isZAxis ? bounds.size.x : bounds.size.z;
  const axisMax = isZAxis ? bounds.max.z : bounds.max.x;
  const axisMin = isZAxis ? bounds.min.z : bounds.min.x;
  const centerX = bounds.center.x;
  const centerZ = bounds.center.z;
  const endSpan = Math.max(20, axisLength * 0.12);
  const widthSpan = Math.max(12, width * 0.45);
  const rayStartY = bounds.max.y + 80;
  const axisSteps = 7;
  const widthSteps = 9;

  let best = null;

  const useMinEnd = launchEnd === "min";
  for (let i = 0; i < axisSteps; i += 1) {
    const t = i / (axisSteps - 1);
    const axisCoord = useMinEnd
      ? axisMin + t * endSpan
      : axisMax - t * endSpan;
    for (let j = 0; j < widthSteps; j += 1) {
      const w = j / (widthSteps - 1) - 0.5;
      const offset = w * widthSpan;
      const x = isZAxis ? centerX + offset : axisCoord;
      const z = isZAxis ? axisCoord : centerZ + offset;
      const origin = new BABYLON.Vector3(x, rayStartY, z);
      const ray = new BABYLON.Ray(origin, new BABYLON.Vector3(0, -1, 0), 200);
      const hit = scene.pickWithRay(ray, (mesh) => meshSet.has(mesh));
      if (!hit || !hit.pickedPoint) {
        continue;
      }
      const normal = hit.getNormal && hit.getNormal(true);
      if (normal && normal.y <= 0.45) {
        continue;
      }
      const score = axisCoord * 2 - Math.abs(offset);
      if (!best || score > best.score) {
        best = {
          point: hit.pickedPoint.clone(),
          score,
        };
      }
    }
  }

  return best;
}

function computeCarrierLaunchYaw(isZAxis, launchEnd) {
  const useMinEnd = launchEnd === "min";
  if (isZAxis) {
    return useMinEnd ? 0 : Math.PI;
  }
  return useMinEnd ? Math.PI / 2 : -Math.PI / 2;
}

function pickCarrierDeckHeightAt(scene, renderMeshes, bounds, x, z) {
  const meshSet = new Set(renderMeshes);
  const rayStartY = bounds.max.y + 80;
  const span = Math.min(bounds.size.x, bounds.size.z) * 0.08;
  const offsets = [-span, -span * 0.5, 0, span * 0.5, span];
  let best = null;

  for (const dx of offsets) {
    for (const dz of offsets) {
      const origin = new BABYLON.Vector3(x + dx, rayStartY, z + dz);
      const ray = new BABYLON.Ray(origin, new BABYLON.Vector3(0, -1, 0), 200);
      const hit = scene.pickWithRay(ray, (mesh) => meshSet.has(mesh));
      if (!hit || !hit.pickedPoint) {
        continue;
      }
      const normal = hit.getNormal && hit.getNormal(true);
      if (normal && normal.y <= 0.45) {
        continue;
      }
      if (best === null || hit.pickedPoint.y > best) {
        best = hit.pickedPoint.y;
      }
    }
  }

  return best;
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

  // Mobile control state
  let mobileControlsEnabled = false;
  const mobileInput = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttleUp: false,
    throttleDown: false,
  };
  
  let joystickActive = false;
  let joystickStartX = 0;
  let joystickStartY = 0;
  
  // Virtual joystick setup
  const joystickOuter = document.getElementById("joystickOuter");
  const joystickInner = document.getElementById("joystickInner");
  const mobileControlsContainer = document.getElementById("mobileControls");
  const controlModeToggle = document.getElementById("controlModeToggle");
  const keyboardIcon = controlModeToggle.querySelector(".keyboard-icon");
  const mobileIcon = controlModeToggle.querySelector(".mobile-icon");
  
  function setMobileControlsEnabled(enabled) {
    mobileControlsEnabled = enabled;
    if (enabled) {
      mobileControlsContainer.style.display = "block";
      keyboardIcon.style.display = "none";
      mobileIcon.style.display = "block";
    } else {
      mobileControlsContainer.style.display = "none";
      keyboardIcon.style.display = "block";
      mobileIcon.style.display = "none";
      // Reset mobile inputs
      mobileInput.pitch = 0;
      mobileInput.roll = 0;
      mobileInput.yaw = 0;
      mobileInput.throttleUp = false;
      mobileInput.throttleDown = false;
    }
  }
  
  // Control mode toggle
  controlModeToggle.addEventListener("click", () => {
    setMobileControlsEnabled(!mobileControlsEnabled);
  });
  
  // Virtual joystick handlers
  function handleJoystickStart(e) {
    e.preventDefault();
    joystickActive = true;
    const rect = joystickOuter.getBoundingClientRect();
    joystickStartX = rect.left + rect.width / 2;
    joystickStartY = rect.top + rect.height / 2;
  }
  
  function handleJoystickMove(e) {
    if (!joystickActive) return;
    e.preventDefault();
    
    const touch = e.touches ? e.touches[0] : e;
    const deltaX = touch.clientX - joystickStartX;
    const deltaY = touch.clientY - joystickStartY;
    
    const maxDistance = 40; // Max pixels from center
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const limitedDistance = Math.min(distance, maxDistance);
    
    if (distance > 0) {
      const angle = Math.atan2(deltaY, deltaX);
      const x = Math.cos(angle) * limitedDistance;
      const y = Math.sin(angle) * limitedDistance;
      
      joystickInner.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
      
      // Map to flight controls: X = roll, Y = pitch
      mobileInput.roll = clamp(x / maxDistance, -1, 1);
      mobileInput.pitch = clamp(-y / maxDistance, -1, 1); // Invert Y for intuitive up/down
    }
  }
  
  function handleJoystickEnd(e) {
    if (!joystickActive) return;
    e.preventDefault();
    joystickActive = false;
    joystickInner.style.transform = "translate(-50%, -50%)";
    mobileInput.roll = 0;
    mobileInput.pitch = 0;
  }
  
  joystickOuter.addEventListener("touchstart", handleJoystickStart);
  joystickOuter.addEventListener("mousedown", handleJoystickStart);
  document.addEventListener("touchmove", handleJoystickMove);
  document.addEventListener("mousemove", handleJoystickMove);
  document.addEventListener("touchend", handleJoystickEnd);
  document.addEventListener("mouseup", handleJoystickEnd);
  
  // Button handlers
  const buttons = document.querySelectorAll(".control-btn");
  buttons.forEach((button) => {
    const action = button.dataset.action;
    
    function handleButtonStart(e) {
      e.preventDefault();
      
      if (action === "throttle-up") {
        mobileInput.throttleUp = true;
        button.classList.add("active");
      } else if (action === "throttle-down") {
        mobileInput.throttleDown = true;
        button.classList.add("active");
      } else if (action === "yaw-left") {
        mobileInput.yaw = -1;
        button.classList.add("active");
      } else if (action === "yaw-right") {
        mobileInput.yaw = 1;
        button.classList.add("active");
      } else if (action === "brake") {
        input.brakeToggle = true;
      } else if (action === "camera") {
        input.toggleCamera = true;
      } else if (action === "reset") {
        input.reset = true;
      } else if (action === "pause") {
        input.pause = true;
      } else if (action === "autolevel") {
        input.autoLevelToggle = true;
      }
    }
    
    function handleButtonEnd(e) {
      e.preventDefault();
      
      if (action === "throttle-up") {
        mobileInput.throttleUp = false;
        button.classList.remove("active");
      } else if (action === "throttle-down") {
        mobileInput.throttleDown = false;
        button.classList.remove("active");
      } else if (action === "yaw-left" || action === "yaw-right") {
        mobileInput.yaw = 0;
        button.classList.remove("active");
      }
    }
    
    button.addEventListener("touchstart", handleButtonStart);
    button.addEventListener("mousedown", handleButtonStart);
    button.addEventListener("touchend", handleButtonEnd);
    button.addEventListener("mouseup", handleButtonEnd);
    button.addEventListener("touchcancel", handleButtonEnd);
  });

  // Keyboard handlers (only active when mobile controls disabled)
  window.addEventListener("keydown", (event) => {
    if (mobileControlsEnabled) return; // Ignore keyboard when mobile mode is on
    
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
    if (mobileControlsEnabled) return;
    pressed.delete(event.code);
  });

  function updateAxes() {
    if (mobileControlsEnabled) {
      // Use mobile input
      input.pitch = mobileInput.pitch;
      input.roll = mobileInput.roll;
      input.yaw = mobileInput.yaw;
      input.throttleUp = mobileInput.throttleUp;
      input.throttleDown = mobileInput.throttleDown;
    } else {
      // Use keyboard input
      input.pitch =
        (pressed.has("ArrowUp") ? 1 : 0) + (pressed.has("ArrowDown") ? -1 : 0);
      input.roll =
        (pressed.has("ArrowRight") ? 1 : 0) +
        (pressed.has("ArrowLeft") ? -1 : 0);
      input.yaw = (pressed.has("KeyD") ? 1 : 0) + (pressed.has("KeyA") ? -1 : 0);
      input.throttleUp = pressed.has("KeyW");
      input.throttleDown = pressed.has("KeyS");
    }
    
    // Zoom controls only work in keyboard mode
    input.zoomIn = !mobileControlsEnabled && (pressed.has("Equal") || pressed.has("NumpadAdd"));
    input.zoomOut = !mobileControlsEnabled && (pressed.has("Minus") || pressed.has("NumpadSubtract"));
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
  const scenarioId = await requestScenarioSelection();
  const scenario = getScenarioConfig(scenarioId);

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
    ...(scenario.landOverrides || {}),
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
    ...(scenario.maskOverrides || {}),
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
    {
      width: scenario.oceanSize || 2200,
      height: scenario.oceanSize || 2200,
    },
    scene
  );
  ocean.position.y = landMaskOptions.seaFloorHeight + 0.2;
  const oceanMat = new BABYLON.StandardMaterial("oceanMat", scene);
  oceanMat.diffuseColor =
    scenario.oceanColor || new BABYLON.Color3(0.1, 0.3, 0.6);
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

  let runwayLength = 260;
  let runwayWidth = 40;
  let airportStart = null;
  let carrierStart = null;
  let carrierDeckHeight = null;
  let carrierMeshes = null;
  let carrierBounds = null;
  let carrierDeckSampler = null;
  let carrierLaunchYaw = null;

  if (!scenario.useAirportModel && !scenario.useCarrierModel) {
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
  const centerLineLength = 10;
  const centerLineGap = 12;
  const centerLineStart = -runwayLength / 2 + 55;
  const centerLineEnd = runwayLength / 2 - 55;
  for (
    let z = centerLineStart;
    z + centerLineLength / 2 <= centerLineEnd;
    z += centerLineLength + centerLineGap
  ) {
    const dash = BABYLON.MeshBuilder.CreateBox(
      `runway-dash-${z.toFixed(2)}`,
      { width: 1.2, height: 0.02, depth: centerLineLength },
      scene
    );
    dash.position.set(0, 1.08, z);
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

  const glassMat = new BABYLON.StandardMaterial("glassMat", scene);
  glassMat.diffuseColor = new BABYLON.Color3(0.55, 0.7, 0.9);
  glassMat.emissiveColor = new BABYLON.Color3(0.08, 0.12, 0.18);
  glassMat.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
  const glassTexture = createGlassTexture(scene, "glass-texture", {
    top: new BABYLON.Color3(0.5, 0.72, 0.92),
    mid: new BABYLON.Color3(0.35, 0.55, 0.75),
    bottom: new BABYLON.Color3(0.25, 0.35, 0.45),
    seed: 19,
  });
  glassMat.diffuseTexture = glassTexture;
  glassMat.specularPower = 96;

  const trimMat = new BABYLON.StandardMaterial("trimMat", scene);
  trimMat.diffuseColor = new BABYLON.Color3(0.38, 0.38, 0.4);
  trimMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

  const metalMat = new BABYLON.StandardMaterial("metalMat", scene);
  metalMat.diffuseColor = new BABYLON.Color3(0.45, 0.46, 0.5);
  metalMat.specularColor = new BABYLON.Color3(0.35, 0.35, 0.35);

  const roofMat = new BABYLON.StandardMaterial("roofMat", scene);
  roofMat.diffuseColor = new BABYLON.Color3(0.22, 0.22, 0.24);
  roofMat.specularColor = new BABYLON.Color3(0.08, 0.08, 0.08);
  roofMat.specularPower = 32;

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
  terminalMat.diffuseTexture = createConcreteTexture(scene, "terminal-concrete", {
    top: new BABYLON.Color3(0.86, 0.83, 0.77),
    bottom: new BABYLON.Color3(0.7, 0.68, 0.64),
    seed: 11,
  });
  terminalMat.specularPower = 24;
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
      windowMat.diffuseTexture = glassTexture;
      const lit = hash2d(row, col, 101) > 0.6;
      windowMat.emissiveColor = lit
        ? new BABYLON.Color3(0.5, 0.38, 0.2)
        : new BABYLON.Color3(0.08, 0.12, 0.18);
      windowMat.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
      windowMat.specularPower = 96;
      window.material = windowMat;
    }
  }

  const terminalGlassFront = BABYLON.MeshBuilder.CreateBox(
    "terminalGlassFront",
    { width: 54, height: 10, depth: 0.6 },
    scene
  );
  terminalGlassFront.position.set(0, 4, 20.7);
  terminalGlassFront.parent = terminalGroup;
  terminalGlassFront.material = glassMat;

  const terminalRoof = BABYLON.MeshBuilder.CreateBox(
    "terminalRoof",
    { width: 64, height: 2, depth: 44 },
    scene
  );
  terminalRoof.position.set(0, 11, 0);
  terminalRoof.parent = terminalGroup;
  terminalRoof.material = roofMat;

  for (let i = 0; i < 4; i += 1) {
    const roofUnit = BABYLON.MeshBuilder.CreateBox(
      `terminalRoofUnit-${i}`,
      { width: 6, height: 2.2, depth: 4 },
      scene
    );
    roofUnit.position.set(-18 + i * 12, 13, -6 + (i % 2) * 10);
    roofUnit.parent = terminalGroup;
    roofUnit.material = metalMat;
  }

  const terminalCanopy = BABYLON.MeshBuilder.CreateBox(
    "terminalCanopy",
    { width: 50, height: 1.2, depth: 6 },
    scene
  );
  terminalCanopy.position.set(0, -2, 23.5);
  terminalCanopy.parent = terminalGroup;
  terminalCanopy.material = trimMat;

  const terminalAnnex = BABYLON.MeshBuilder.CreateBox(
    "terminalAnnex",
    { width: 24, height: 12, depth: 18 },
    scene
  );
  terminalAnnex.position.set(-22, 2, -18);
  terminalAnnex.parent = terminalGroup;
  terminalAnnex.material = terminalMat;

  const terminalAnnexGlass = BABYLON.MeshBuilder.CreateBox(
    "terminalAnnexGlass",
    { width: 20, height: 6, depth: 0.5 },
    scene
  );
  terminalAnnexGlass.position.set(-22, 2, -27.5);
  terminalAnnexGlass.parent = terminalGroup;
  terminalAnnexGlass.material = glassMat;
  
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
  hangarMat.diffuseTexture = createConcreteTexture(scene, "hangar-concrete", {
    top: new BABYLON.Color3(0.7, 0.66, 0.62),
    bottom: new BABYLON.Color3(0.55, 0.52, 0.5),
    seed: 29,
  });
  hangarMat.specularPower = 18;
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
  doorMat.specularPower = 36;
  hangarDoor.material = doorMat;

  const hangarRoof = BABYLON.MeshBuilder.CreateBox(
    "hangarRoof",
    { width: 54, height: 3, depth: 64 },
    scene
  );
  hangarRoof.position.set(0, 14, 0);
  hangarRoof.parent = hangarGroup;
  hangarRoof.material = roofMat;

  for (let i = 0; i < 6; i += 1) {
    const vent = BABYLON.MeshBuilder.CreateCylinder(
      `hangarVent-${i}`,
      { diameter: 1.6, height: 2.2 },
      scene
    );
    vent.position.set(
      -18 + i * 6,
      16.5,
      -12 + (i % 2) * 8
    );
    vent.parent = hangarGroup;
    vent.material = metalMat;
  }

  const hangarSideBand = BABYLON.MeshBuilder.CreateBox(
    "hangarSideBand",
    { width: 52, height: 4, depth: 1.2 },
    scene
  );
  hangarSideBand.position.set(0, 4, -30.6);
  hangarSideBand.parent = hangarGroup;
  hangarSideBand.material = metalMat;

  const hangarDoorFrame = BABYLON.MeshBuilder.CreateBox(
    "hangarDoorFrame",
    { width: 47, height: 24, depth: 0.6 },
    scene
  );
  hangarDoorFrame.position.set(0, 1, 29.8);
  hangarDoorFrame.parent = hangarGroup;
  hangarDoorFrame.material = trimMat;
  
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
  cabMat.diffuseTexture = glassTexture;
  cabMat.specularColor = new BABYLON.Color3(0.6, 0.6, 0.6);
  cabMat.specularPower = 96;
  towerCab.material = cabMat;

  const towerCabWindows = BABYLON.MeshBuilder.CreateCylinder(
    "towerCabWindows",
    { diameter: 10.6, height: 5.8, tessellation: 24 },
    scene
  );
  towerCabWindows.position.set(0, 39.2, 0);
  towerCabWindows.parent = towerGroup;
  towerCabWindows.material = glassMat;

  const towerRoof = BABYLON.MeshBuilder.CreateCylinder(
    "towerRoof",
    { diameter: 8.6, height: 1.2 },
    scene
  );
  towerRoof.position.set(0, 43.2, 0);
  towerRoof.parent = towerGroup;
  towerRoof.material = trimMat;

  const towerAntenna = BABYLON.MeshBuilder.CreateCylinder(
    "towerAntenna",
    { diameter: 0.6, height: 10 },
    scene
  );
  towerAntenna.position.set(0, 49.4, 0);
  towerAntenna.parent = towerGroup;
  towerAntenna.material = metalMat;

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

  function createGlassTexture(sceneRef, name, options) {
    const size = 256;
    const texture = new BABYLON.DynamicTexture(
      name,
      { width: size, height: size },
      sceneRef,
      false
    );
    const ctx = texture.getContext();
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, colorToCss(options.top));
    gradient.addColorStop(0.6, colorToCss(options.mid));
    gradient.addColorStop(1, colorToCss(options.bottom));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "rgb(255, 255, 255)";
    for (let i = 0; i < 14; i += 1) {
      const x = (i / 14) * size;
      ctx.fillRect(x, 0, 1.5, size);
    }
    ctx.globalAlpha = 1;

    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "rgb(30, 60, 90)";
    for (let i = 0; i < 50; i += 1) {
      const x = (hash2d(i, i * 3, options.seed) * size) | 0;
      const y = (hash2d(i * 2, i, options.seed) * size) | 0;
      ctx.fillRect(x, y, 3, 20);
    }
    ctx.globalAlpha = 1;

    texture.update(false);
    texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    return texture;
  }

  function createFacadeTextures(sceneRef, name, options) {
    const size = 512;
    const diffuse = new BABYLON.DynamicTexture(
      `${name}-diffuse`,
      { width: size, height: size },
      sceneRef,
      false
    );
    const emissive = new BABYLON.DynamicTexture(
      `${name}-emissive`,
      { width: size, height: size },
      sceneRef,
      false
    );
    const bump = new BABYLON.DynamicTexture(
      `${name}-bump`,
      { width: size, height: size },
      sceneRef,
      false
    );

    const ctx = diffuse.getContext();
    const ectx = emissive.getContext();
    const bctx = bump.getContext();

    const baseGradient = ctx.createLinearGradient(0, 0, 0, size);
    baseGradient.addColorStop(0, colorToCss(options.baseTop));
    baseGradient.addColorStop(0.7, colorToCss(options.baseMid));
    baseGradient.addColorStop(1, colorToCss(options.baseBottom));
    ctx.fillStyle = baseGradient;
    ctx.fillRect(0, 0, size, size);

    ectx.fillStyle = "rgb(0, 0, 0)";
    ectx.fillRect(0, 0, size, size);

    bctx.fillStyle = "rgb(128, 128, 128)";
    bctx.fillRect(0, 0, size, size);

    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 1200; i += 1) {
      const x = (hash2d(i, options.seed, 17) * size) | 0;
      const y = (hash2d(options.seed, i, 31) * size) | 0;
      const tone = 40 + (hash2d(i, i * 2, 47) * 35) | 0;
      ctx.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;

    if (options.accent) {
      ctx.fillStyle = colorToCss(options.accent);
      ctx.fillRect(size * 0.08, 0, size * 0.06, size);
    }

    const rows = options.rows;
    const cols = options.cols;
    const margin = size * 0.08;
    const usableW = size - margin * 2;
    const usableH = size - margin * 2;
    const stepX = usableW / cols;
    const stepY = usableH / rows;
    const windowW = stepX * 0.62;
    const windowH = stepY * 0.62;
    const frame = Math.max(1.5, size * 0.002);

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const noise = hash2d(
          row + options.seed * 0.1,
          col + options.seed * 0.2,
          options.seed
        );
        if (noise < 0.04) {
          continue;
        }

        const x = margin + col * stepX + (stepX - windowW) * 0.5;
        const y = margin + row * stepY + (stepY - windowH) * 0.5;

        const topTint = options.glassTop;
        const bottomTint = options.glassBottom;
        const gradient = ctx.createLinearGradient(0, y, 0, y + windowH);
        gradient.addColorStop(0, colorToCss(topTint));
        gradient.addColorStop(1, colorToCss(bottomTint));
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, windowW, windowH);

        ctx.strokeStyle = colorToCss(options.frame);
        ctx.lineWidth = frame;
        ctx.strokeRect(x, y, windowW, windowH);

        ctx.fillStyle = colorToCss(options.frame);
        ctx.fillRect(x, y + windowH * 0.62, windowW, frame);

        const litChance = noise > 0.75;
        if (litChance) {
          const warm = 0.7 + (noise - 0.75) * 0.8;
          ectx.fillStyle = `rgb(${Math.round(255 * warm)}, ${Math.round(
            220 * warm
          )}, ${Math.round(150 * warm)})`;
          ectx.fillRect(x + frame, y + frame, windowW - frame * 2, windowH - frame * 2);
        }

        bctx.fillStyle = "rgb(150, 150, 150)";
        bctx.fillRect(x - frame, y - frame, windowW + frame * 2, windowH + frame * 2);
        bctx.fillStyle = "rgb(110, 110, 110)";
        bctx.fillRect(x + frame, y + frame, windowW - frame * 2, windowH - frame * 2);
      }
    }

    ctx.globalAlpha = 0.18;
    const sunGradient = ctx.createLinearGradient(0, size * 0.2, size, size * 0.8);
    sunGradient.addColorStop(0, "rgba(160, 200, 240, 0.0)");
    sunGradient.addColorStop(0.5, "rgba(140, 200, 220, 0.25)");
    sunGradient.addColorStop(1, "rgba(80, 120, 140, 0.0)");
    ctx.fillStyle = sunGradient;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 1;

    diffuse.update(false);
    emissive.update(false);
    bump.update(false);

    diffuse.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    diffuse.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    emissive.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    emissive.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    bump.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    bump.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;

    return { diffuse, emissive, bump };
  }

  function createConcreteTexture(sceneRef, name, options) {
    const size = 256;
    const texture = new BABYLON.DynamicTexture(
      name,
      { width: size, height: size },
      sceneRef,
      false
    );
    const ctx = texture.getContext();
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, colorToCss(options.top));
    gradient.addColorStop(1, colorToCss(options.bottom));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.globalAlpha = 0.2;
    for (let i = 0; i < 900; i += 1) {
      const x = (hash2d(i, options.seed, 13) * size) | 0;
      const y = (hash2d(options.seed, i, 23) * size) | 0;
      const tone = 140 + ((hash2d(i, i * 2, 37) * 30) | 0);
      ctx.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(40, 40, 40, 0.15)";
    for (let i = 0; i < 14; i += 1) {
      const y = (i / 14) * size;
      ctx.fillRect(0, y, size, 1.5);
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
    const seed = Math.abs(Math.round(config.x * 9 + config.z * 7));
    const facade = createFacadeTextures(
      sceneRef,
      `building-tex-${config.x}-${config.z}`,
      {
        baseTop: BABYLON.Color3.Lerp(style.base, new BABYLON.Color3(0.15, 0.15, 0.16), 0.1),
        baseMid: style.base,
        baseBottom: BABYLON.Color3.Lerp(style.base, new BABYLON.Color3(0.1, 0.1, 0.1), 0.2),
        glassTop: BABYLON.Color3.Lerp(style.window, new BABYLON.Color3(0.2, 0.45, 0.6), 0.35),
        glassBottom: BABYLON.Color3.Lerp(style.window, new BABYLON.Color3(0.05, 0.1, 0.15), 0.5),
        frame: style.accent,
        accent: style.accent,
        rows,
        cols,
        seed,
      }
    );
    const material = new BABYLON.StandardMaterial(
      `buildingMat-${config.x}-${config.z}`,
      sceneRef
    );
    material.diffuseTexture = facade.diffuse;
    material.emissiveTexture = facade.emissive;
    material.bumpTexture = facade.bump;
    material.specularColor = new BABYLON.Color3(0.22, 0.22, 0.24);
    material.specularPower = 64;
    material.emissiveColor = new BABYLON.Color3(0.05, 0.05, 0.06);
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

    const ventCount = Math.max(2, Math.round((unitWidth + unitDepth) * 0.15));
    for (let i = 0; i < ventCount; i += 1) {
      const vent = BABYLON.MeshBuilder.CreateCylinder(
        `${parent.name}-vent-${i}`,
        { diameter: 0.7, height: 1.4 },
        sceneRef
      );
      const offsetX =
        (hash2d(config.x, config.z + i, 61) - 0.5) * unitWidth * 0.6;
      const offsetZ =
        (hash2d(config.z, config.x + i, 73) - 0.5) * unitDepth * 0.6;
      vent.position.set(
        offsetX,
        config.h * 0.5 + unitHeight + 1.2,
        offsetZ
      );
      vent.material = metalMat;
      vent.parent = parent;
    }
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

  function addBuildingDetails(sceneRef, parent, config) {
    const baseHeight = Math.max(1.5, config.h * 0.08);
    const base = BABYLON.MeshBuilder.CreateBox(
      `${parent.name}-base`,
      {
        width: config.w + 1.2,
        height: baseHeight,
        depth: config.d + 1.2,
      },
      sceneRef
    );
    base.position.set(0, -config.h * 0.5 - baseHeight * 0.5, 0);
    base.material = trimMat;
    base.parent = parent;

    const parapet = BABYLON.MeshBuilder.CreateBox(
      `${parent.name}-parapet`,
      {
        width: config.w + 0.8,
        height: 0.8,
        depth: config.d + 0.8,
      },
      sceneRef
    );
    parapet.position.set(0, config.h * 0.5 + 0.4, 0);
    parapet.material = roofMat;
    parapet.parent = parent;

    const band = BABYLON.MeshBuilder.CreateBox(
      `${parent.name}-band`,
      {
        width: config.w * 0.9,
        height: config.h * 0.18,
        depth: 0.4,
      },
      sceneRef
    );
    band.position.set(0, config.h * 0.15, config.d * 0.5 + 0.25);
    band.material = glassMat;
    band.parent = parent;
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
      addBuildingDetails(scene, building, config);
    }
  }

  if (scenario.useAirportModel) {
    const airportData = await loadAirportModel(
      scene,
      scenario.airportTargetLength || 320
    );
    airportStart = airportData.startPosition;
  }

  if (scenario.useCarrierModel) {
    const carrierData = await loadCarrierModel(
      scene,
      scenario.carrierTargetLength || 330,
      ocean.position.y,
      scenario.carrierLaunchEnd
    );
    carrierStart = carrierData.startPosition;
    carrierDeckHeight = carrierData.deckHeight;
    carrierMeshes = carrierData.renderMeshes;
    carrierBounds = carrierData.bounds;
    carrierLaunchYaw = carrierData.launchYaw;
    const carrierAxisIsZ = carrierData.isZAxis;
    carrierDeckSampler = (x, z) => {
      const direct = pickCarrierDeckHeightAt(
        scene,
        carrierMeshes,
        carrierBounds,
        x,
        z
      );
      if (direct !== null) {
        return direct;
      }
      return sampleCarrierDeckHeight(
        scene,
        carrierMeshes,
        carrierBounds,
        carrierAxisIsZ
      );
    };
  }

  const runwayStart =
    carrierStart ||
    airportStart ||
    new BABYLON.Vector3(0, 2, -runwayLength / 2 + 6);

  const { mesh: jet, controller } = await createJet(scene, runwayStart);
  controller.reset();
  if (carrierLaunchYaw !== null) {
    jet.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(
      carrierLaunchYaw,
      0,
      0
    );
  }
  if (carrierDeckHeight !== null) {
    controller.minAltitude = carrierDeckHeight + 0.3;
  }
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

    if (carrierDeckSampler) {
      const deckHeight = carrierDeckSampler(jet.position.x, jet.position.z);
      if (deckHeight !== null) {
        const minAltitude = deckHeight + 0.3;
        controller.minAltitude = Math.max(controller.minAltitude, minAltitude);
        if (jet.position.y < minAltitude) {
          jet.position.y = minAltitude;
          controller.velocity.y = Math.max(0, controller.velocity.y);
        }
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
