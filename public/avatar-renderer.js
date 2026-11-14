import * as THREE from "https://esm.sh/three@0.180.0";
import { MTLLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "https://esm.sh/three@0.180.0/examples/jsm/loaders/OBJLoader.js";
import { OrbitControls } from "https://esm.sh/three@0.180.0/examples/jsm/controls/OrbitControls.js";

function decodeBase64(value) {
  const compact = String(value || "").replace(/\s+/g, "");
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBase64Text(value) {
  return new TextDecoder().decode(decodeBase64(value));
}

function vectorFrom(value, fallback = [0, 0, 0]) {
  return new THREE.Vector3(
    Number(value?.x ?? fallback[0]),
    Number(value?.y ?? fallback[1]),
    Number(value?.z ?? fallback[2])
  );
}

function prepareMaterials(mtlText, files, objectUrls) {
  const creator = new MTLLoader().parse(mtlText, "");
  const textureEntries = Object.entries(files).filter(([name, file]) =>
    /\.(png|jpe?g|webp)$/i.test(name) && typeof file?.content === "string"
  );

  const getTextureUrl = (fileName, file) => {
    let url = objectUrls.get(fileName);
    if (!url) {
      const extension = fileName.split(".").pop()?.toLowerCase();
      const mime = extension === "jpg" || extension === "jpeg"
        ? "image/jpeg"
        : extension === "webp" ? "image/webp" : "image/png";
      const bytes = decodeBase64(file.content);
      url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      objectUrls.set(fileName, url);
    }
    return url;
  };

  const textureByName = new Map(
    textureEntries.map(([name, file]) => [name.split(/[\\/]/).pop().toLowerCase(), [name, file]])
  );

  for (const [materialName, info] of Object.entries(creator.materialsInfo || {})) {
    const textureReferences = Object.entries(info).filter(([key, value]) =>
      key.toLowerCase().startsWith("map_") && typeof value === "string" && value.trim()
    );

    let matchedTexture = null;
    for (const [key, reference] of textureReferences) {
      const baseName = reference.trim().replace(/^["']|["']$/g, "").split(/[\\/]/).pop().toLowerCase();
      const entry = textureByName.get(baseName);
      if (entry) {
        matchedTexture = entry;
        info[key] = getTextureUrl(entry[0], entry[1]);
      }
    }

    // RCC versions sometimes emit PlayerNTex.png without a matching map filename.
    if (!matchedTexture) {
      const textureId = materialName.match(/Player\d+/i)?.[0];
      if (textureId) {
        matchedTexture = textureEntries.find(([fileName]) =>
          fileName.toLowerCase().includes((textureId + "Tex").toLowerCase())
        ) || null;
        if (matchedTexture) {
          const textureUrl = getTextureUrl(matchedTexture[0], matchedTexture[1]);
          for (const key of Object.keys(info)) {
            if (key.toLowerCase().startsWith("map_")) info[key] = textureUrl;
          }
        }
      }
    }

    // Avatar atlas materials should not inherit accidental zero-opacity MTL values.
    if (/Player\d+/i.test(materialName) || matchedTexture) {
      info.d = 1;
      delete info.Tr;
      delete info.tr;
    }
  }

  creator.preload();

  for (const [name, material] of Object.entries(creator.materials || {})) {
    if (!material || !/^Player\d+/i.test(name)) continue;
    material.opacity = 1;
    material.transparent = false;
    material.alphaTest = 0.02;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
    material.needsUpdate = true;
  }

  return creator;
}
function disposeScene(scene) {
  scene.traverse(object => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value && value.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}

export async function mountSakuraAvatar(host, publicId) {
  if (!host || !publicId) throw new Error("Avatar profile is missing.");
  host.innerHTML = '<span class="sakura-avatar-loading">Loading avatar…</span>';

  const response = await fetch("/api/avatar/render/" + encodeURIComponent(publicId), {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  const renderData = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(renderData.error || "Sakura could not render this avatar.");
  }

  const files = renderData.files || {};
  const objFile = files["scene.obj"];
  const mtlFile = files["scene.mtl"];
  if (!objFile?.content || !mtlFile?.content) {
    throw new Error("The avatar renderer returned an incomplete 3D scene.");
  }

  const objectUrls = new Map();
  const mtlText = decodeBase64Text(mtlFile.content);
  const objText = decodeBase64Text(objFile.content);
  const materialCreator = prepareMaterials(mtlText, files, objectUrls);
  const avatarObject = new OBJLoader().setMaterials(materialCreator).parse(objText);

  avatarObject.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });

  const bounds = new THREE.Box3().setFromObject(avatarObject);
  if (bounds.isEmpty()) throw new Error("The avatar renderer returned an empty model.");
  const min = vectorFrom(renderData.aabb?.min);
  const max = vectorFrom(renderData.aabb?.max);
  const center = min.clone().add(max).multiplyScalar(0.5);
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) {
    bounds.getCenter(center);
  }

  const width = Math.max(1, host.clientWidth || 178);
  const height = Math.max(1, host.clientHeight || 228);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#17131d");

  const cameraData = renderData.camera || {};
  const camera = new THREE.PerspectiveCamera(
    Math.max(15, Math.min(100, Number(cameraData.fov || 35))),
    width / height,
    0.01,
    10000
  );
  const cameraPosition = vectorFrom(cameraData.position, [0, 2, 5]);
  if (cameraPosition.distanceTo(center) < 0.05) cameraPosition.z += 5;
  camera.position.copy(cameraPosition);
  camera.lookAt(center);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "low-power"
    });
  } catch {
    disposeScene(avatarObject);
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    throw new Error("This browser could not start WebGL for the 3D avatar.");
  }

  renderer.domElement.className = "sakura-avatar-canvas";
  renderer.domElement.setAttribute("aria-label", "Interactive Sakura 3D avatar");
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene.add(new THREE.HemisphereLight("#fff5e9", "#3a3045", 1.8));
  const keyLight = new THREE.DirectionalLight("#fff0dc", 2.3);
  keyLight.position.set(-3, 5, 4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight("#b9a5ff", 0.8);
  fillLight.position.set(3, 2, -3);
  scene.add(fillLight);
  scene.add(avatarObject);

  host.replaceChildren(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  const startingDistance = Math.max(camera.position.distanceTo(center), 1);
  controls.minDistance = Math.max(0.2, startingDistance * 0.45);
  controls.maxDistance = startingDistance * 3.5;
  controls.update();

  let disposed = false;
  let frame = 0;
  const resizeObserver = new ResizeObserver(() => {
    if (disposed || !host.isConnected) return;
    const nextWidth = Math.max(1, host.clientWidth);
    const nextHeight = Math.max(1, host.clientHeight);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight, false);
  });

  resizeObserver.observe(host);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    controls.dispose();
    disposeScene(scene);
    renderer.dispose();
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    host.dataset.avatarReady = "false";
    host.parentElement?.classList.remove("has-rendered-avatar");
  };

  const animate = () => {
    if (disposed) return;
    if (!host.isConnected) {
      dispose();
      return;
    }
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  };

  host.dataset.avatarReady = "true";
  host.parentElement?.classList.add("has-rendered-avatar");
  animate();
  return dispose;
}
