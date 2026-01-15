import * as BABYLON from "babylonjs";
import "babylonjs-loaders";

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

class JetController {
  constructor(mesh, startPosition) {
    this.mesh = mesh;
    this.startPosition = startPosition.clone();
    this.velocity = new BABYLON.Vector3(0, 0, 20);
    this.angularVelocity = new BABYLON.Vector3(0, 0, 0);
    this.throttle = 0;

    this.maxThrust = 40;
    this.dragCoeff = 0.05;
    this.turnDrag = 0.08;
    this.liftCoeff = 0.02;
    this.gravity = 9.8;

    this.pitchRate = 1.6;
    this.rollRate = 2.2;
    this.yawRate = 1.0;
    this.angularDamping = 6.0;
    this.autoLevelStrength = 0.8;

    this.stallSpeed = 12;
    this.takeoffSpeed = 22;
    this.throttleRate = 0.6;
    this.maxSpeed = 120;

    this.minAltitude = 2;
    this.worldLimit = 950;
  }

  get speed() {
    return this.velocity.length();
  }

  reset() {
    this.mesh.position.copyFrom(this.startPosition);
    this.mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.throttle = 0;
  }

  update(dt, input, brakeEngaged, autoLevelEnabled) {
    const isGrounded = this.mesh.position.y <= this.minAltitude + 0.01;
    const throttleDelta =
      (input.throttleUp ? 1 : 0) - (input.throttleDown ? 1 : 0);
    if (!brakeEngaged || !isGrounded) {
      this.throttle = clamp(
        this.throttle + throttleDelta * this.throttleRate * dt,
        0,
        1
      );
    } else {
      this.throttle = 0;
    }

    const speed = this.speed;
    const controlScale = clamp(speed / this.stallSpeed, 0, 1);

    const pitchInput = input.pitch * controlScale;
    const rollInput = input.roll * controlScale;
    const yawInput = input.yaw * controlScale;

    let autoPitch = 0;
    let autoRoll = 0;
    if (autoLevelEnabled) {
      const currentRotation = this.mesh.rotationQuaternion.toEulerAngles();
      const pitchAngle = currentRotation.x;
      const rollAngle = currentRotation.z;

      autoPitch = Math.abs(input.pitch) < 0.01 ? -pitchAngle : 0;
      autoRoll = Math.abs(input.roll) < 0.01 ? -rollAngle : 0;
    }

    const targetAngular = new BABYLON.Vector3(
      pitchInput * this.pitchRate + autoPitch * this.autoLevelStrength,
      yawInput * this.yawRate,
      rollInput * this.rollRate + autoRoll * this.autoLevelStrength
    );

    const lerpAmount = 1 - Math.exp(-this.angularDamping * dt);
    this.angularVelocity = BABYLON.Vector3.Lerp(
      this.angularVelocity,
      targetAngular,
      lerpAmount
    );

    this.mesh.rotate(
      BABYLON.Axis.X,
      this.angularVelocity.x * dt,
      BABYLON.Space.LOCAL
    );
    this.mesh.rotate(
      BABYLON.Axis.Y,
      this.angularVelocity.y * dt,
      BABYLON.Space.LOCAL
    );
    this.mesh.rotate(
      BABYLON.Axis.Z,
      this.angularVelocity.z * dt,
      BABYLON.Space.LOCAL
    );

    const forward = this.mesh.forward.normalize();
    const up = this.mesh.up.normalize();

    const thrust = forward.scale(this.maxThrust * this.throttle);
    const drag = this.velocity.scale(-this.dragCoeff * speed);

    const turnIntensity = Math.abs(input.pitch) + Math.abs(input.roll) + Math.abs(input.yaw);
    const turnDrag = this.velocity.scale(-this.turnDrag * turnIntensity * speed);

    const liftScaleBase = clamp(speed / this.stallSpeed, 0, 1);
    let liftScale = 0;

    if (speed >= this.takeoffSpeed) {
      if (isGrounded) {
        liftScale = Math.max(0, input.pitch) * liftScaleBase;
      } else {
        liftScale = liftScaleBase;
      }
    }
    const lift = up.scale(this.liftCoeff * speed * speed * liftScale);

    const gravity = new BABYLON.Vector3(0, -this.gravity, 0);
    
    // Normal force from the deck: when close to ground, apply upward force to support the plane
    const nearGroundThreshold = this.minAltitude + 1.5;
    const normalForce = this.mesh.position.y <= nearGroundThreshold
      ? new BABYLON.Vector3(0, this.gravity, 0)  // Support force from deck
      : new BABYLON.Vector3(0, 0, 0);

    const acceleration = thrust
      .add(lift)
      .addInPlace(drag)
      .addInPlace(turnDrag)
      .addInPlace(gravity)
      .addInPlace(normalForce);

    this.velocity.addInPlace(acceleration.scale(dt));

    const newSpeed = this.velocity.length();
    if (newSpeed > this.maxSpeed) {
      this.velocity.scaleInPlace(this.maxSpeed / newSpeed);
    }
    this.mesh.position.addInPlace(this.velocity.scale(dt));

    // Floor constraint: prevent jet from going below minimum altitude
    if (this.mesh.position.y < this.minAltitude) {
      this.mesh.position.y = this.minAltitude;
      if (this.velocity.y < 0) {
        this.velocity.y = 0;
      }
    }

    if (brakeEngaged && isGrounded) {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    if (Math.abs(this.mesh.position.x) > this.worldLimit) {
      this.mesh.position.x = clamp(
        this.mesh.position.x,
        -this.worldLimit,
        this.worldLimit
      );
      this.velocity.x = 0;
    }

    if (Math.abs(this.mesh.position.z) > this.worldLimit) {
      this.mesh.position.z = clamp(
        this.mesh.position.z,
        -this.worldLimit,
        this.worldLimit
      );
      this.velocity.z = 0;
    }
  }
}

function buildPlaceholderJet(scene, root) {
  const bodyMat = new BABYLON.StandardMaterial("jetMat", scene);
  bodyMat.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.75);
  bodyMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);

  const body = BABYLON.MeshBuilder.CreateBox(
    "jetBody",
    { width: 1.2, height: 0.6, depth: 4 },
    scene
  );
  body.material = bodyMat;
  body.parent = root;

  const nose = BABYLON.MeshBuilder.CreateCylinder(
    "jetNose",
    { height: 1, diameterTop: 0, diameterBottom: 0.7, tessellation: 12 },
    scene
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 2.5;
  nose.material = bodyMat;
  nose.parent = root;

  const wing = BABYLON.MeshBuilder.CreateBox(
    "jetWing",
    { width: 4, height: 0.1, depth: 1.2 },
    scene
  );
  wing.position.y = 0;
  wing.position.z = -0.2;
  wing.material = bodyMat;
  wing.parent = root;

  const tail = BABYLON.MeshBuilder.CreateBox(
    "jetTail",
    { width: 1, height: 0.4, depth: 1.2 },
    scene
  );
  tail.position.z = -2.2;
  tail.position.y = 0.1;
  tail.material = bodyMat;
  tail.parent = root;

  const fin = BABYLON.MeshBuilder.CreateBox(
    "jetFin",
    { width: 0.1, height: 0.9, depth: 0.6 },
    scene
  );
  fin.position.z = -2.4;
  fin.position.y = 0.5;
  fin.material = bodyMat;
  fin.parent = root;
}

export async function createJet(scene, startPosition) {
  const root = new BABYLON.TransformNode("jetRoot", scene);
  root.rotationQuaternion = BABYLON.Quaternion.Identity();

  if (startPosition) {
    root.position.copyFrom(startPosition);
  } else {
    root.position.set(0, 10, 0);
  }

  try {
    const modelRoot = new BABYLON.TransformNode("jetModel", scene);
    modelRoot.parent = root;

    const result = await BABYLON.SceneLoader.ImportMeshAsync(
      "",
      "/",
      "mig35.glb",
      scene
    );
    const importedRoot = result.meshes[0];
    importedRoot.parent = modelRoot;

    modelRoot.position.set(0, 0, 0);
    modelRoot.rotation.set(0, 0, 0);
    modelRoot.scaling.setAll(1);

    const renderMeshes = result.meshes.filter(
      (mesh) => mesh.getTotalVertices && mesh.getTotalVertices() > 0
    );
    if (renderMeshes.length > 0) {
      let bounds = computeWorldBounds(renderMeshes);

      if (bounds.size.x > bounds.size.z) {
        modelRoot.rotation.y = Math.PI / 2;
        bounds = computeWorldBounds(renderMeshes);
      }

      const targetLength = 10;
      const lengthAxis = Math.max(bounds.size.x, bounds.size.z);
      if (lengthAxis > 0) {
        const uniformScale = targetLength / lengthAxis;
        modelRoot.scaling.setAll(uniformScale);
        bounds = computeWorldBounds(renderMeshes);
      }

      const centerLocal = bounds.center.subtract(root.position);
      modelRoot.position.subtractInPlace(centerLocal);
    }
  } catch (error) {
    console.warn("Failed to load mig35.glb, using placeholder jet.", error);
    buildPlaceholderJet(scene, root);
  }

  return {
    mesh: root,
    controller: new JetController(root, root.position.clone()),
  };
}
