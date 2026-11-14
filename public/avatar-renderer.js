import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const SKIN_COLORS = Object.freeze({
  1: 0xf5f5f5,
  5: 0xf2d6a0,
  18: 0xe8b995,
  26: 0x24212a,
  45: 0xd59b72,
  125: 0xf1c99b,
  101: 0xc87961,
  192: 0x87543d,
  217: 0x76503a,
  153: 0xa4b8a7,
  359: 0x8b9d91,
  361: 0xf2e1b3,
  352: 0x9d7961,
  334: 0xc1a58e,
  226: 0xb68b72,
  141: 0x536c84,
  133: 0x7f9aa8,
  135: 0x9f8b9e,
  310: 0x536c58,
  317: 0x9a806a,
  119: 0xd6a078
});

function safeColor(id, fallback = 0xf1c99b) {
  return SKIN_COLORS[Number(id)] ?? fallback;
}

function stableColor(value, saturation = 0.48, lightness = 0.48) {
  const text = String(value || "sakura");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return new THREE.Color().setHSL(hue / 360, saturation, lightness);
}

function material(color, roughness = 0.82) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.02
  });
}

function addBox(parent, width, height, depth, x, y, z, mat, name) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function addSphere(parent, radius, x, y, z, mat, scaleX = 1, scaleY = 1, scaleZ = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 14), mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(scaleX, scaleY, scaleZ);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function addDefaultFace(parent, headY, headDepth) {
  const eyeWhite = material(0xffffff, 0.45);
  const pupil = material(0x29212a, 0.35);
  const mouthMat = material(0x6b3940, 0.7);
  for (const x of [-0.16, 0.16]) {
    addSphere(parent, 0.055, x, headY + 0.035, headDepth / 2 + 0.009, eyeWhite, 0.88, 1.15, 0.3);
    addSphere(parent, 0.027, x, headY + 0.035, headDepth / 2 + 0.03, pupil, 0.85, 1.1, 0.35);
  }
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.10, headY - 0.15, headDepth / 2 + 0.014),
    new THREE.Vector3(0, headY - 0.19, headDepth / 2 + 0.022),
    new THREE.Vector3(0.10, headY - 0.15, headDepth / 2 + 0.014)
  ]);
  const mouth = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.012, 6, false), mouthMat);
  parent.add(mouth);
}

function addImagePlane(parent, src, width, height, x, y, z, rotationY = 0) {
  if (!src) return;
  let parsed;
  try {
    parsed = new URL(String(src), window.location.href);
    if (parsed.protocol !== "https:" && parsed.origin !== window.location.origin) return;
  } catch {
    return;
  }
  const texture = new THREE.TextureLoader().load(
    parsed.href,
    loaded => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.needsUpdate = true;
    },
    undefined,
    error => console.warn("[Sakura avatar] Image detail could not load:", error?.message || error)
  );
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.025,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  plane.position.set(x, y, z);
  plane.rotation.y = rotationY;
  parent.add(plane);
}

function buildBody(data) {
  const root = new THREE.Group();
  const equipped = Array.isArray(data.equipped) ? data.equipped : [];
  const findItem = category => equipped.find(item => item.category === category) || null;
  const shirt = findItem("Shirts");
  const pants = findItem("Pants");
  const face = findItem("Faces");
  const hair = findItem("Hair");
  const hat = findItem("Hats");
  const colors = data.bodyColors || {};
  const skin = material(safeColor(colors.torsoColorId));
  const headMat = material(safeColor(colors.headColorId));
  const leftArmMat = material(safeColor(colors.leftArmColorId));
  const rightArmMat = material(safeColor(colors.rightArmColorId));
  const leftLegMat = material(safeColor(colors.leftLegColorId));
  const rightLegMat = material(safeColor(colors.rightLegColorId));
  const shirtColor = shirt ? stableColor(shirt.id || shirt.name, 0.52, 0.43) : skin.color.clone();
  const pantsColor = pants ? stableColor(pants.id || pants.name, 0.44, 0.30) : skin.color.clone();
  const shirtMat = material(shirtColor);
  const pantsMat = material(pantsColor);
  const r15 = data.rigType === "R15";
  let headY;
  let headDepth;
  let torsoY;

  if (r15) {
    headY = 2.56;
    headDepth = 0.66;
    torsoY = 1.63;
    addBox(root, 0.78, 0.58, 0.40, 0, 1.86, 0, shirtMat, "UpperTorso");
    addBox(root, 0.72, 0.34, 0.39, 0, 1.40, 0, shirtMat, "LowerTorso");
    for (const side of [-1, 1]) {
      const armMat = side < 0 ? leftArmMat : rightArmMat;
      addBox(root, 0.30, 0.48, 0.34, side * 0.59, 1.89, 0, (shirt ? shirtMat : armMat), "UpperArm");
      addBox(root, 0.28, 0.47, 0.32, side * 0.61, 1.40, 0, armMat, "LowerArm");
      const legMat = side < 0 ? leftLegMat : rightLegMat;
      addBox(root, 0.34, 0.62, 0.36, side * 0.22, 0.98, 0, (pants ? pantsMat : legMat), "UpperLeg");
      addBox(root, 0.33, 0.58, 0.35, side * 0.22, 0.38, 0, pantsMat || legMat, "LowerLeg");
      if (!pants && side < 0) {
        // Keep the original body color when no pants are equipped.
      }
    }
  } else {
    headY = 2.25;
    headDepth = 0.66;
    torsoY = 1.38;
    addBox(root, 0.92, 1.08, 0.46, 0, torsoY, 0, shirt ? shirtMat : skin, "Torso");
    addBox(root, 0.34, 1.02, 0.38, -0.64, 1.40, 0, shirt ? shirtMat : leftArmMat, "Left Arm");
    addBox(root, 0.34, 1.02, 0.38, 0.64, 1.40, 0, shirt ? shirtMat : rightArmMat, "Right Arm");
    addBox(root, 0.42, 1.02, 0.42, -0.24, 0.52, 0, pants ? pantsMat : leftLegMat, "Left Leg");
    addBox(root, 0.42, 1.02, 0.42, 0.24, 0.52, 0, pants ? pantsMat : rightLegMat, "Right Leg");
  }

  const head = addBox(root, 0.70, 0.70, headDepth, 0, headY, 0, headMat, "Head");
  if (face?.image_url) {
    addImagePlane(root, face.image_url, 0.56, 0.56, 0, headY, headDepth / 2 + 0.012);
  } else {
    addDefaultFace(root, headY, headDepth);
  }

  if (shirt?.image_url) {
    addImagePlane(root, shirt.image_url, 0.72, r15 ? 0.76 : 0.91, 0, torsoY, r15 ? 0.207 : 0.237);
  }
  if (pants?.image_url) {
    const y = r15 ? 0.71 : 0.52;
    addImagePlane(root, pants.image_url, 0.30, 0.70, -0.22, y, 0.221);
    addImagePlane(root, pants.image_url, 0.30, 0.70, 0.22, y, 0.221);
  }
  for (const accessory of equipped.filter(item => item.category === "Accessories" && !item.model_url && item.image_url)) {
    addImagePlane(root, accessory.image_url, 0.42, 0.42, 0, torsoY + 0.28, 0.245);
  }
  if (hair?.image_url && !hair.model_url) {
    addImagePlane(root, hair.image_url, 0.60, 0.45, 0, headY + 0.35, 0.22);
  }
  if (hat?.image_url && !hat.model_url) {
    addImagePlane(root, hat.image_url, 0.64, 0.42, 0, headY + 0.47, 0.17);
  }

  const scales = data.scales || {};
  const width = Math.max(0.7, Math.min(1.0, Number(scales.width) || 1));
  const height = Math.max(0.9, Math.min(1.05, Number(scales.height) || 1));
  const depth = Math.max(0.7, Math.min(1.0, Number(scales.depth) || 1));
  root.scale.set(width, height, depth);

  return { root, equipped, headY, torsoY };
}

async function loadEquippedModels(root, equipped, headY, torsoY) {
  const loader = new GLTFLoader();
  const pending = [];
  for (const item of equipped) {
    const modelUrl = String(item.model_url || "").trim();
    if (!modelUrl) continue;
    let parsed;
    try {
      parsed = new URL(modelUrl, window.location.href);
      if (parsed.protocol !== "https:" && parsed.origin !== window.location.origin) continue;
      if (!/\.(?:glb|gltf)(?:$|[?#])/i.test(parsed.href)) continue;
    } catch {
      continue;
    }
    pending.push((async () => {
      try {
        const gltf = await loader.loadAsync(parsed.href);
        const model = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(maxDimension) || maxDimension <= 0) return;
        const targetSize = item.category === "Hats" ? 0.92 : item.category === "Hair" ? 0.82 : 0.72;
        const scale = targetSize / maxDimension;
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
        model.traverse(object => {
          if (object.isMesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        const anchor = new THREE.Group();
        if (item.category === "Hats") anchor.position.set(0, headY + 0.48, 0);
        else if (item.category === "Hair") anchor.position.set(0, headY + 0.30, 0);
        else if (item.category === "Accessories") anchor.position.set(0, torsoY + 0.03, -0.28);
        else if (item.category === "Faces") anchor.position.set(0, headY, 0.34);
        else anchor.position.set(0, torsoY, 0);
        anchor.add(model);
        root.add(anchor);
      } catch (error) {
        console.warn("[Sakura avatar] A 3D item could not be loaded:", item.name || item.id, error?.message || error);
      }
    })());
  }
  await Promise.allSettled(pending);
}

export function mountSakuraAvatar(container, data = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError("A valid avatar container is required.");
  container.replaceChildren();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x21172d);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(3.2, 2.65, 5.8);
  camera.lookAt(0, 1.38, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(Math.max(container.clientWidth, 160), Math.max(container.clientHeight, 180), false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = "sakura-avatar-3d";
  renderer.domElement.setAttribute("aria-label", "Sakura 3D avatar preview");
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xfff4ff, 0x51415d, 2.0));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.0);
  keyLight.position.set(4, 6, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xbca1ff, 1.1);
  fillLight.position.set(-4, 3, -3);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.MeshStandardMaterial({ color: 0x30233e, roughness: 1, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.035;
  floor.receiveShadow = true;
  scene.add(floor);

  const built = buildBody(data);
  const avatarRoot = built.root;
  scene.add(avatarRoot);

  const pointer = { down: false, x: 0, rotation: 0 };
  const canvas = renderer.domElement;
  const onPointerDown = event => {
    pointer.down = true;
    pointer.x = event.clientX;
    pointer.rotation = avatarRoot.rotation.y;
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = event => {
    if (!pointer.down) return;
    const delta = event.clientX - pointer.x;
    avatarRoot.rotation.y = pointer.rotation + delta * 0.012;
  };
  const onPointerUp = () => { pointer.down = false; };
  const onWheel = event => {
    event.preventDefault();
    camera.position.z = Math.max(3.4, Math.min(8.5, camera.position.z + event.deltaY * 0.004));
    camera.lookAt(0, 1.38, 0);
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  let disposed = false;
  let frame = 0;
  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const animate = () => {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    if (!pointer.down) avatarRoot.rotation.y += 0.0022;
    renderer.render(scene, camera);
  };
  animate();

  loadEquippedModels(avatarRoot, built.equipped, built.headY, built.torsoY).catch(error => {
    console.warn("[Sakura avatar] Could not load one or more accessories:", error?.message || error);
  });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      scene.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const mat of materials) {
            if (mat.map) mat.map.dispose();
            mat.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
