import * as THREE from "https://esm.sh/three@0.180.0";
import { GLTFLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js";

const BASE_MODEL_PATH = "/assets/sakura-avatar-base.glb.b64";
const SKIN_COLORS = {
  361:"#f3eee6",192:"#6f4934",217:"#79543f",153:"#977b70",359:"#f3c39d",
  352:"#985b32",5:"#d5a17b",101:"#d69a7a",1007:"#c64c3c",1014:"#9b6037",
  38:"#a5a2a0",18:"#b58b6c",125:"#c39270",1030:"#e6b995",133:"#d8ad8b",
  106:"#f3d0a2",105:"#e6b9a3",1017:"#c28b6d",24:"#e8c5a7",334:"#b77c59",
  226:"#dba986",141:"#a96f4e",1021:"#e1bda4",28:"#b98463",37:"#d7ab88",
  310:"#9d6948",317:"#c99776",119:"#b17b5c",23:"#d0a080",305:"#8f6147",
  102:"#c58c69",45:"#e1b69a",107:"#aa765b",11:"#8a5b42",104:"#d2a27e",
  21:"#b98666",330:"#e7c3a6",9:"#edc8a8",364:"#9d6f55",351:"#c18b6b",
  29:"#e6b996",151:"#a87555",135:"#d9b094",26:"#7e5540",199:"#bd8b6a",
  194:"#d8a482",208:"#9d704f",1:"#f3d4b2"
};

let baseBytesPromise;

function decodeBase64(value) {
  const binary = atob(String(value || "").replace(/\\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getBaseBytes() {
  if (!baseBytesPromise) {
    baseBytesPromise = fetch(BASE_MODEL_PATH, { cache: "force-cache" })
      .then(response => {
        if (!response.ok) throw new Error("Could not load the Sakura avatar body model.");
        return response.text();
      })
      .then(decodeBase64);
  }
  return baseBytesPromise;
}

function parseGLB(loader, bytes) {
  return new Promise((resolve, reject) => {
    loader.parse(bytes, "/", resolve, reject);
  });
}

function safeModelUrl(value) {
  try {
    const url = new URL(String(value || ""), location.href);
    return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")
      ? url.href : "";
  } catch {
    return "";
  }
}

function applyBodyMaterials(root, settings) {
  const colorId = Number(settings?.bodyColors?.headColorId ?? settings?.bodyColors?.torsoColorId ?? 125);
  const skin = SKIN_COLORS[colorId] || "#c39270";
  root.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    if (object.name === "SuperHero_Male") {
      object.material = new THREE.MeshStandardMaterial({
        color: skin,
        roughness: 0.82,
        metalness: 0
      });
    } else if (object.name === "Eyes") {
      object.material = new THREE.MeshStandardMaterial({
        color: "#eee9e3",
        roughness: 0.42,
        metalness: 0
      });
    } else if (object.name === "Eyebrows") {
      object.material = new THREE.MeshStandardMaterial({
        color: "#38271f",
        roughness: 0.9,
        metalness: 0
      });
    } else {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const cloned = materials.map(material => material.clone());
      object.material = Array.isArray(object.material) ? cloned : cloned[0];
    }
  });
}

function attachAccessory(character, loader, item) {
  const url = safeModelUrl(item.model_url);
  if (!url) return Promise.resolve(false);

  return loader.loadAsync(url).then(gltf => {
    const category = String(item.category || "");
    const headItem = ["Hats", "Hair", "Faces"].includes(category);
    const anchorName = headItem ? "Head" : "spine_03";
    const anchor = character.getObjectByName(anchorName) || character.getObjectByName("Armature");
    if (!anchor) return false;

    const accessory = new THREE.Group();
    accessory.add(gltf.scene);
    accessory.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    const bounds = new THREE.Box3().setFromObject(accessory);
    if (bounds.isEmpty()) return false;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) return false;

    const targetWidth = category === "Faces" ? 0.24
      : category === "Hats" ? 0.58
      : category === "Hair" ? 0.48
      : 0.42;
    const scale = targetWidth / maxDimension;
    accessory.scale.setScalar(scale);
    anchor.add(accessory);

    let offsetY = 0.14;
    let offsetZ = 0.015;
    if (category === "Faces") {
      offsetY = 0.015;
      offsetZ = 0.15;
    } else if (category === "Accessories") {
      offsetY = -0.10;
      offsetZ = 0.16;
    }
    accessory.position.set(
      -center.x * scale,
      -center.y * scale + offsetY,
      -center.z * scale + offsetZ
    );
    return true;
  }).catch(error => {
    console.warn("[Sakura avatar] Could not load item model:", item?.name, error);
    return false;
  });
}

export async function mountSakuraAvatar(host, publicId) {
  if (!host || !publicId) throw new Error("Avatar profile is missing.");
  host.innerHTML = '<span class="sakura-avatar-loading">Loading Sakura avatar…</span>';

  const [avatarResponse, baseBytes] = await Promise.all([
    fetch("/api/avatar/public/" + encodeURIComponent(publicId), { credentials: "same-origin" }),
    getBaseBytes()
  ]);
  if (!avatarResponse.ok) {
    const problem = await avatarResponse.json().catch(() => ({}));
    throw new Error(problem.error || "Could not load this Sakura avatar.");
  }
  const avatarData = await avatarResponse.json();
  const loader = new GLTFLoader();
  const baseGLTF = await parseGLB(loader, baseBytes);

  const canvas = document.createElement("canvas");
  canvas.className = "sakura-avatar-canvas";
  canvas.setAttribute("aria-label", "Interactive 3D Sakura avatar");
  host.replaceChildren(canvas);

  const width = Math.max(1, host.clientWidth || 180);
  const height = Math.max(1, host.clientHeight || 220);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#17131d");

  const camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
  camera.position.set(0, 1.08, 3.65);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "low-power"
    });
  } catch {
    throw new Error("This browser could not start WebGL for the 3D avatar.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.add(new THREE.HemisphereLight("#fff4e7", "#42334e", 2.0));
  const keyLight = new THREE.DirectionalLight("#fff0dc", 2.7);
  keyLight.position.set(-3.5, 5, 4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight("#b9a5ff", 1.05);
  fillLight.position.set(3, 2.5, -3);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(0.82, 48),
    new THREE.MeshBasicMaterial({ color: "#241d2d" })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012;
  scene.add(floor);

  const character = new THREE.Group();
  character.add(baseGLTF.scene);
  applyBodyMaterials(character, avatarData);
  const initialBounds = new THREE.Box3().setFromObject(character);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  const initialCenter = initialBounds.getCenter(new THREE.Vector3());
  const scale = 2.0 / Math.max(initialSize.y, 0.001);
  character.scale.setScalar(scale);
  character.position.set(
    -initialCenter.x * scale,
    -initialBounds.min.y * scale,
    -initialCenter.z * scale
  );
  character.rotation.y = Math.PI;
  scene.add(character);

  const equipped = Array.isArray(avatarData.equipped) ? avatarData.equipped : [];

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.02, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.minDistance = 2.45;
  controls.maxDistance = 4.8;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 2.25;
  controls.update();

  const idleSpine = character.getObjectByName("spine_03");
  const baseSpineRotation = idleSpine ? idleSpine.rotation.x : 0;
  const clock = new THREE.Clock();
  let frame = 0;
  let disposed = false;
  let resizeObserver;

  const resize = () => {
    if (!host.isConnected) return;
    const nextWidth = Math.max(1, host.clientWidth);
    const nextHeight = Math.max(1, host.clientHeight);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight, false);
  };

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    controls.dispose();
    scene.traverse(object => {
      if (object.isMesh) {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material?.dispose());
      }
    });
    renderer.dispose();
  };

  const animate = () => {
    if (disposed) return;
    if (!host.isConnected) {
      dispose();
      return;
    }
    const elapsed = clock.getElapsedTime();
    if (idleSpine) idleSpine.rotation.x = baseSpineRotation + Math.sin(elapsed * 1.35) * 0.009;
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  };
  animate();

  host.dataset.avatarReady = "true";
  host.parentElement?.classList.add("has-rendered-avatar");
  Promise.all(equipped.slice(0, 12).map(item => attachAccessory(character, loader, item)))
    .catch(error => console.warn("[Sakura avatar] Some accessories could not be loaded.", error));
  return dispose;
}
