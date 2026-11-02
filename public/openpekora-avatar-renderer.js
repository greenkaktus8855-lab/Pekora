(function () {
  function assetUrl(value) {
    if (typeof value !== "string" || !value.trim()) throw new Error("Avatar model URL is missing.");
    if (/^https:\/\//i.test(value)) return value;
    if (/^http:\/\//i.test(value)) throw new Error("Avatar model URLs must use HTTPS.");
    return "https://www.silrev.biz/" + value.replace(/^\/+/, "");
  }

  class OpenPekoraAvatarRenderer extends HTMLElement {
    connectedCallback() {
      if (this._started) return;
      this._started = true;
      this.classList.add("openpekora-avatar-renderer");
      this._canvasHost = document.createElement("div");
      this._canvasHost.className = "openpekora-avatar-canvas";
      this.replaceChildren(this._canvasHost);

      let data;
      try { data = JSON.parse(this.getAttribute("data-render") || "null"); }
      catch { data = null; }
      if (!data || !data.camera || !data.aabb || !data.obj || !data.mtl || !Array.isArray(data.textures)) {
        this.showMessage("3D render is not available for this avatar yet.");
        return;
      }
      if (!window.THREE || !THREE.MTLLoader || !THREE.OBJLoader || !THREE.OrbitControls) {
        this.showMessage("The 3D renderer libraries could not be loaded.");
        return;
      }

      try { this.startRender(data); }
      catch (error) { this.showMessage(error.message || "Could not start the avatar renderer."); }
    }

    showMessage(message) {
      const label = document.createElement("div");
      label.className = "openpekora-avatar-message";
      label.textContent = message;
      this.replaceChildren(label);
    }

    startRender(data) {
      const width = Math.max(1, this._canvasHost.clientWidth || 352);
      const height = Math.max(1, this._canvasHost.clientHeight || 352);
      this._scene = new THREE.Scene();
      this._renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this._renderer.setSize(width, height);
      this._canvasHost.appendChild(this._renderer.domElement);

      this._camera = new THREE.PerspectiveCamera(Number(data.camera.fov) || 70, width / height, 0.1, 10000);
      const position = data.camera.position;
      const direction = data.camera.direction;
      this._camera.position.set(position.x, position.y, position.z);
      this._camera.lookAt(position.x - direction.x, position.y - direction.y, position.z - direction.z);

      const min = data.aabb.min;
      const max = data.aabb.max;
      const center = new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
      this._scene.add(new THREE.AmbientLight(0x808080, 1));
      const light = new THREE.DirectionalLight(0xffffff, 1.2);
      light.position.set(max.x, max.y + 5, max.z + 5);
      this._scene.add(light);

      this._controls = new THREE.OrbitControls(this._camera, this._renderer.domElement);
      this._controls.target.copy(center);
      this._controls.enableDamping = true;
      this._controls.dampingFactor = 0.08;
      this._controls.update();

      const manager = new THREE.LoadingManager();
      const mtlLoader = new THREE.MTLLoader(manager);
      mtlLoader.setCrossOrigin("anonymous");
      mtlLoader.load(assetUrl(data.mtl), materials => {
        try {
          for (const materialName of Object.keys(materials.materialsInfo || {})) {
            const info = materials.materialsInfo[materialName];
            const playerId = materialName.match(/Player\d+/)?.[0];
            if (!playerId) continue;
            const texture = data.textures.find(value => typeof value === "string" && value.includes(playerId + "Tex"));
            if (!texture) continue;
            for (const key of Object.keys(info)) if (key.startsWith("map_")) info[key] = assetUrl(texture);
          }
          materials.preload();
          const objLoader = new THREE.OBJLoader(manager);
          objLoader.setMaterials(materials);
          objLoader.load(assetUrl(data.obj), object => {
            if (!this.isConnected) return;
            this._scene.add(object);
            this.classList.add("is-ready");
            this.animate();
          }, undefined, error => this.showMessage(error?.message || "Could not load the avatar mesh."));
        } catch (error) {
          this.showMessage(error.message || "Could not prepare avatar materials.");
        }
      }, undefined, error => this.showMessage(error?.message || "Could not load avatar materials."));

      this._resizeObserver = new ResizeObserver(() => {
        if (!this._renderer || !this._camera) return;
        const w = Math.max(1, this._canvasHost.clientWidth);
        const h = Math.max(1, this._canvasHost.clientHeight);
        this._camera.aspect = w / h;
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(w, h);
      });
      this._resizeObserver.observe(this._canvasHost);
    }

    animate() {
      if (!this.isConnected || !this._renderer) return;
      this._raf = requestAnimationFrame(() => this.animate());
      this._controls?.update();
      this._renderer.render(this._scene, this._camera);
    }

    disconnectedCallback() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._resizeObserver?.disconnect();
      this._controls?.dispose();
      this._scene?.traverse(object => {
        if (!object.isMesh) return;
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          material.map?.dispose();
          material.dispose();
        }
      });
      this._renderer?.dispose();
      this._started = false;
    }
  }

  if (!customElements.get("openpekora-avatar-renderer")) {
    customElements.define("openpekora-avatar-renderer", OpenPekoraAvatarRenderer);
  }
})();