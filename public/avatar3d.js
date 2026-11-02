import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const activeViewers = new WeakMap();

const defaultAttachment = {
  Hats: "HeadTop",
  Hair: "Head",
  Faces: "Head",
  Shirts: "Torso",
  Pants: "Root",
  Accessories: "Head"
};

function addBlock(parent, name, size, position, color, radius = 0) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  parent.add(group);

  const geometry = new THREE.BoxGeometry(...size);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0.02
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

function buildAvatar(scene) {
  const root = new THREE.Group();
  root.name = "PekoraAvatar";
  scene.add(root);

  const skin = "#d9a47b";
  const mounts = {
    Root: root,
    Head: addBlock(root, "Head", [0.72, 0.72, 0.62], [0, 2.12, 0], skin),
    Torso: addBlock(root, "Torso", [0.9, 0.98, 0.42], [0, 1.32, 0], "#577fa5"),
    LeftArm: addBlock(root, "LeftArm", [0.32, 0.92, 0.36], [-0.64, 1.34, 0], skin),
    RightArm: addBlock(root, "RightArm", [0.32, 0.92, 0.36], [0.64, 1.34, 0], skin),
    LeftLeg: addBlock(root, "LeftLeg", [0.38, 0.98, 0.42], [-0.25, 0.48, 0], "#35465c"),
    RightLeg: addBlock(root, "RightLeg", [0.38, 0.98, 0.42], [0.25, 0.48, 0], "#35465c")
  };

  mounts.HeadTop = new THREE.Group();
  mounts.HeadTop.name = "HeadTop";
  mounts.HeadTop.position.set(0, 2.49, 0);
  root.add(mounts.HeadTop);

  const eyeMaterial = new THREE.MeshStandardMaterial({ color: "#252525", roughness: 0.6 });
  for (const x of [-0.15, 0.15]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), eyeMaterial);
    eye.position.set(x, 2.18, 0.315);
    root.add(eye);
  }
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.105, 0.012, 6, 24, Math.PI),
    new THREE.MeshStandardMaterial({ color: "#854d43", roughness: 0.8 })
  );
  smile.position.set(0, 2.0, 0.317);
  smile.rotation.z = Math.PI;
  root.add(smile);

  return { root, mounts };
}

function addFaceTexture(item, headMount, loader) {
  return new Promise((resolve, reject) => {
    loader.load(item.image_url, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
      });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.54), material);
      plane.position.set(0, 0, 0.316);
      plane.renderOrder = 5;
      headMount.add(plane);
      resolve();
    }, undefined, reject);
  });
}

async function render(container, equippedItems = []) {
  if (!(container instanceof HTMLElement)) throw new Error("Avatar preview container is missing.");
  dispose(container);
  container.innerHTML = "";

  const width = Math.max(container.clientWidth || 280, 220);
  const height = Math.max(container.clientHeight || 320, 280);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    container.textContent = "This browser or graphics driver does not support the 3D avatar preview.";
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
  camera.position.set(3.5, 2.8, 5.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.35, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 3.2;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI * 0.88;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.65;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x778899, 2.0));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(4, 7, 5);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.7);
  fillLight.position.set(-4, 3, -3);
  scene.add(fillLight);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1.9, 48),
    new THREE.MeshStandardMaterial({ color: "#dce3e8", roughness: 1, transparent: true, opacity: 0.48 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  scene.add(ground);

  const { root, mounts } = buildAvatar(scene);
  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const errors = [];

  for (const item of equippedItems) {
    if (!item) continue;
    try {
      if (item.asset_kind === "FACE_TEXTURE" && item.category === "Faces" && item.image_url) {
        await addFaceTexture(item, mounts.Head, textureLoader);
        continue;
      }
      if (item.asset_kind !== "MODEL_3D" || !item.model_url) continue;

      const gltf = await gltfLoader.loadAsync(item.model_url);
      const model = gltf.scene;
      const attachment = item.attachment || defaultAttachment[item.category] || "Root";
      const mount = mounts[attachment] || mounts.Root;
      const scale = Number(item.model_scale) > 0 ? Number(item.model_scale) : 1;

      model.position.set(
        Number(item.offset_x) || 0,
        Number(item.offset_y) || 0,
        Number(item.offset_z) || 0
      );
      model.rotation.set(
        THREE.MathUtils.degToRad(Number(item.rotation_x) || 0),
        THREE.MathUtils.degToRad(Number(item.rotation_y) || 0),
        THREE.MathUtils.degToRad(Number(item.rotation_z) || 0)
      );
      model.scale.setScalar(scale);
      model.traverse(object => {
        if (object.isMesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      mount.add(model);
    } catch (error) {
      errors.push(item.name || item.category || "Item");
      console.warn("[Pekora 3D] Could not load wearable:", item.name, error);
    }
  }

  const resize = () => {
    if (!container.isConnected) return;
    const w = Math.max(container.clientWidth, 220);
    const h = Math.max(container.clientHeight, 280);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const resizeObserver = typeof ResizeObserver !== "undefined"
    ? new ResizeObserver(resize)
    : null;
  resizeObserver?.observe(container);

  let frame = 0;
  let disposed = false;
  const animate = () => {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  if (errors.length) {
    const warning = document.createElement("div");
    warning.className = "avatar-3d-warning";
    warning.textContent = "Could not load: " + errors.join(", ");
    container.appendChild(warning);
  }

  activeViewers.set(container, {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      controls.dispose();
      scene.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material.map) material.map.dispose();
            material.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    }
  });
}

function dispose(container) {
  const current = activeViewers.get(container);
  if (current) {
    current.dispose();
    activeViewers.delete(container);
  }
}

window.PekoraAvatar3D = { render, dispose };
window.dispatchEvent(new Event("pekora-avatar3d-ready"));
