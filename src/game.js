import * as BABYLON from "babylonjs";
import { createJet } from "./jet.js";
import { createHUD } from "./ui.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

  return {
    input,
    updateAxes,
    consumeToggle,
    consumeReset,
    consumeBrakeToggle,
    consumePause,
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

  const islandMat = new BABYLON.StandardMaterial("islandMat", scene);
  islandMat.diffuseColor = new BABYLON.Color3(0.2, 0.6, 0.25);
  islandMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);

  const islandConfigs = [
    { name: "island-1", size: 320, x: 0, z: 0 },
    { name: "island-2", size: 140, x: 320, z: -260 },
    { name: "island-3", size: 160, x: -380, z: 280 },
  ];

  const islands = islandConfigs.map((config) => {
    const island = BABYLON.MeshBuilder.CreateGround(
      config.name,
      { width: config.size, height: config.size },
      scene
    );
    island.position.set(config.x, 1, config.z);
    island.material = islandMat;
    return island;
  });

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

  const camera = new BABYLON.FreeCamera(
    "camera",
    new BABYLON.Vector3(0, 8, -20),
    scene
  );
  camera.inputs.clear();

  const hud = createHUD();
  const inputManager = createInputManager();
  let cameraMode = "chase";
  let isPaused = false;
  let brakeEngaged = true;

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

    if (!isPaused) {
      controller.update(clampedDt, inputManager.input, brakeEngaged);
    }

    updateCamera();

    hud.update({
      speed: controller.speed,
      altitude: jet.position.y,
      throttle: controller.throttle,
      position: jet.position,
      islands: islandConfigs,
      isPaused,
      brakeEngaged,
    });

    scene.render();
  });

  window.addEventListener("resize", () => {
    engine.resize();
  });
}
