import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js";

class PekoraAvatarViewer extends HTMLElement {
  static get observedAttributes() { return ["items"]; }
  attributeChangedCallback(name, oldValue, newValue) { if (name === "items" && this._started && oldValue !== newValue) this._loadItems(); }
  connectedCallback() {
    if (this._started) return;
    this._started = true;
    this.style.display = "block";
    this.style.width = "100%";
    this.style.minHeight = this.getAttribute("height") || "340px";
    this.style.position = "relative";
    this.style.background = "linear-gradient(#eaf3fa,#dce8f1)";
    this.style.overflow = "hidden";
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0xeaf3fa);
    this._camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this._camera.position.set(4.4, 3.1, 6.2); this._camera.lookAt(0,1.2,0);
    this._renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
    this._renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.setSize(this.clientWidth || 320, this.clientHeight || 340);
    this.appendChild(this._renderer.domElement);
    this._scene.add(new THREE.HemisphereLight(0xffffff, 0x8295a8, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 8, 5); key.castShadow = true; this._scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.1);
    fill.position.set(-5, 3, -4); this._scene.add(fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.MeshStandardMaterial({color:0xd2e0eb, roughness:1}));
    floor.rotation.x = -Math.PI/2; floor.position.y = -0.04; floor.receiveShadow = true; this._scene.add(floor);
    this._avatar = new THREE.Group(); this._scene.add(this._avatar);
    this._buildBody();
    this._loader = new GLTFLoader();
    this._accessoryGroup = new THREE.Group(); this._avatar.add(this._accessoryGroup);
    this._rotation = 0;
    this._drag = false;
    this._lastX = 0;
    this._pointerDown = e => {this._drag=true;this._lastX=e.clientX;this.setPointerCapture?.(e.pointerId)};
    this._pointerMove = e => {if(!this._drag)return;this._rotation+=(e.clientX-this._lastX)*0.012;this._lastX=e.clientX;this._avatar.rotation.y=this._rotation};
    this._pointerUp = () => {this._drag=false};
    this._wheel = e => {e.preventDefault();this._camera.position.multiplyScalar(e.deltaY>0?1.08:0.92);this._camera.position.clampLength(4.2,12)};
    this.addEventListener("pointerdown",this._pointerDown);
    this.addEventListener("pointermove",this._pointerMove);
    this.addEventListener("pointerup",this._pointerUp);
    this.addEventListener("pointercancel",this._pointerUp);
    this.addEventListener("wheel",this._wheel,{passive:false});
    this._resize = new ResizeObserver(()=>this._resizeRenderer());
    this._resize.observe(this);
    this._render = () => {if(!this.isConnected)return;this._renderer.render(this._scene,this._camera);this._raf=requestAnimationFrame(this._render)};
    this._render();
    this._loadItems();
  }
  _part(w,h,d,x,y,z,color,round=0) {
    const geometry = new THREE.BoxGeometry(w,h,d);
    const material = new THREE.MeshStandardMaterial({color,roughness:0.82});
    const mesh = new THREE.Mesh(geometry,material);
    mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true;
    this._avatar.add(mesh); return mesh;
  }
  _buildBody() {
    const skin = 0xd9a77d, shirt = 0x2878b9, pants = 0x343d54, shoe = 0x20242a;
    this._part(.88,.92,.48,0,2.12,0,skin);
    this._part(.94,1.02,.5,0,1.13,0,shirt);
    this._part(.36,.96,.4,-.66,1.15,0,skin);
    this._part(.36,.96,.4,.66,1.15,0,skin);
    this._part(.43,.96,.46,-.25,.14,0,pants);
    this._part(.43,.96,.46,.25,.14,0,pants);
    this._part(.45,.22,.65,-.25,-.45,.06,shoe);
    this._part(.45,.22,.65,.25,-.45,.06,shoe);
    this._part(.34,.18,.34,0,1.66,0,skin);
    const eyeMat = new THREE.MeshStandardMaterial({color:0x262626});
    for (const x of [-.19,.19]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(.075,.075,.035),eyeMat);
      eye.position.set(x,2.18,.247); this._avatar.add(eye);
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(.78,32),new THREE.MeshBasicMaterial({color:0x7893a8,transparent:true,opacity:.18}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-.02;this._avatar.add(ground);
  }
  async _loadItems() {
    if (!this._loader || !this._accessoryGroup) return;
    while (this._accessoryGroup.children.length) {
      const child=this._accessoryGroup.children.pop();
      child.traverse?.(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});
    }
    let items=[];try{items=JSON.parse(this.getAttribute("items")||"[]")}catch{}
    const supported=items.filter(x=>x&&typeof x.model_url==="string"&&/^https:\/\//.test(x.model_url));
    for (const item of supported) {
      try {
        const gltf=await new Promise((resolve,reject)=>this._loader.load(item.model_url,resolve,undefined,reject));
        const model=gltf.scene;
        const box=new THREE.Box3().setFromObject(model);
        const size=box.getSize(new THREE.Vector3());
        const center=box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        const max=Math.max(size.x,size.y,size.z)||1;
        model.scale.setScalar(0.8/max);
        const category=String(item.category||"").toLowerCase();
        if(category==="hats"||category==="hair") model.position.y+=2.72;
        else model.position.y+=2.1;
        this._accessoryGroup.add(model);
      } catch(error) {
        console.warn("[Pekora avatar] Could not load equipped 3D item:",item.name,error);
      }
    }
  }
  _resizeRenderer() {
    if(!this._renderer)return;
    const w=Math.max(1,this.clientWidth),h=Math.max(1,this.clientHeight);
    this._camera.aspect=w/h;this._camera.updateProjectionMatrix();this._renderer.setSize(w,h);
  }
  disconnectedCallback() {
    cancelAnimationFrame(this._raf);this._resize?.disconnect();
    this.removeEventListener("pointerdown",this._pointerDown);this.removeEventListener("pointermove",this._pointerMove);
    this.removeEventListener("pointerup",this._pointerUp);this.removeEventListener("pointercancel",this._pointerUp);this.removeEventListener("wheel",this._wheel);
    this._renderer?.dispose();this._started=false;
  }
}
customElements.define("pekora-avatar-viewer",PekoraAvatarViewer);
