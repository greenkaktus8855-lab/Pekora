(function () {
  class OpenPekoraAvatarRenderer extends HTMLElement {
    connectedCallback() {
      if (this._started) return;
      this._started = true;
      this.classList.add("openpekora-avatar-renderer");
      const canvas = document.createElement("div");
      canvas.className = "openpekora-avatar-canvas";
      this.replaceChildren(canvas);
      let data;
      try { data = JSON.parse(this.getAttribute("data-render") || "null"); }
      catch { data = null; }
      if (!data || !data.camera || !data.aabb || !data.obj || !data.mtl || !Array.isArray(data.textures)) {
        this.showMessage("3D render is not available for this avatar yet.");
        return;
      }
      if (!window.THREE || !THREE.MTLLoader || !THREE.OBJLoader || !THREE.OrbitControls) {
        this.showMessage("OpenPekora 3D libraries could not be loaded.");
        return;
      }
      try {
        this._handler = new Thumbnail3DHandler();
        this._handler.Init(352);
        this._handler.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this._handler.LoadThumbnail(data, canvas, ready => {
          this.classList.toggle("is-ready", !!ready);
        }).catch(error => this.showMessage(error.message || "Could not load this avatar."));
      } catch (error) {
        this.showMessage(error.message || "Could not start the 3D renderer.");
      }
    }
    showMessage(message) {
      const label = document.createElement("div");
      label.className = "openpekora-avatar-message";
      label.textContent = message;
      this.replaceChildren(label);
    }
    disconnectedCallback() {
      if (this._handler) {
        try { this._handler.Dispose(); } catch (error) { console.warn("[OpenPekora renderer]", error); }
        this._handler = null;
      }
      this._started = false;
    }
  }
  if (!customElements.get("openpekora-avatar-renderer")) {
    customElements.define("openpekora-avatar-renderer", OpenPekoraAvatarRenderer);
  }
})();