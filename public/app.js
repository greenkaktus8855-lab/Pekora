const app=document.getElementById("app");
const accountArea=document.getElementById("accountArea");
const currency=document.getElementById("currency");
const sidebar=document.getElementById("sidebar");
let me=null,items=[],catalogSort="relevance";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,options={}){const res=await fetch(path,{credentials:"same-origin",...options,headers:{"content-type":"application/json",...(options.headers||{})}});let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.error||"Something went wrong");return data}
function toast(message){const el=document.getElementById("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600)}
function avatar(username=me?.username){const src=String(username||"").toLowerCase()==="koqumo"?"https://tcdn.pekora.pro/images/thumbnails/152d7862464483e0c3989bc1cee7a9d1a954964b95a49f6687945d2c070cb25e_headshot.png":"https://raw.githubusercontent.com/Blue7366/OpenPekora/main/frontend/public/img/generic.svg";return '<img class="avatar-render" src="'+src+'" alt="User avatar" loading="lazy">' }
const AVATAR_CATEGORIES=["Hats","Hair","Faces","Shirts","Pants","Accessories"];
const AVATAR_ATTACHMENTS=["HeadTop","Head","Torso","Root","LeftArm","RightArm","LeftLeg","RightLeg"];
function waitForAvatarRenderer(){
 if(window.PekoraAvatar3D)return Promise.resolve(window.PekoraAvatar3D);
 return new Promise(resolve=>{
  let finished=false;
  const done=()=>{if(finished)return;finished=true;resolve(window.PekoraAvatar3D||null)};
  window.addEventListener("pekora-avatar3d-ready",done,{once:true});
  setTimeout(done,10000);
 });
}
async function render3DAvatar(container,ownedItems){
 container.innerHTML='<div class="avatar-3d-loading">Loading 3D avatar...</div>';
 const renderer=await waitForAvatarRenderer();
 if(!container.isConnected)return;
 if(!renderer){
  container.innerHTML='<div class="avatar-3d-error">3D renderer did not load. Check the browser connection and refresh the page.</div>';
  return;
 }
 try{await renderer.render(container,ownedItems||[])}
 catch(error){console.error("[Pekora avatar]",error);container.innerHTML='<div class="avatar-3d-error">Could not render this avatar. Check the 3D model files.</div>'}
}
function avatarArtwork(username,config={},owned=[]){
 const src=String(username||"").toLowerCase()==="koqumo"?"https://tcdn.pekora.pro/images/thumbnails/152d7862464483e0c3989bc1cee7a9d1a954964b95a49f6687945d2c070cb25e_headshot.png":"https://raw.githubusercontent.com/Blue7366/OpenPekora/main/frontend/public/img/generic.svg";
 const worn=AVATAR_CATEGORIES.map(category=>{const item=owned.find(x=>x.id===config?.[category]);return item?{category,name:item.name,image_url:item.image_url}:null}).filter(Boolean);
 return '<div class="avatar-artwork"><div class="avatar-artwork-image"><img src="'+src+'" alt="'+esc(username)+' avatar" loading="lazy"></div><div class="avatar-artwork-items">'+(worn.length?worn.map(x=>'<span class="avatar-worn-chip">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="" loading="lazy">':'')+'<b>'+esc(x.category)+'</b>'+esc(x.name)+'</span>').join(""):'<span class="avatar-worn-empty">Default avatar</span>')+'</div></div>';
}


function renderSidebar(active="home"){
 if(!me){sidebar.classList.remove("visible","mobile-open");sidebar.innerHTML="";return}
 sidebar.classList.add("visible");
 const links=[
  ["home","icon-nav-home","Home"],["profile","icon-nav-profile","Profile"],["messages","icon-nav-message","Messages"],
  ["friends","icon-nav-friends","Friends"],["avatar","icon-nav-charactercustomizer","Avatar"],["inventory","icon-nav-inventory","Inventory"],["settings","icon-nav-settings","Settings"],
  ["trades","icon-nav-trade","Trade"],["groups","icon-nav-group","Groups"],["forums","icon-nav-forum","Forums"]
 ];
 if(me.role==="OWNER")links.push(["owner","icon-nav-settings","Panel"]);
 sidebar.innerHTML='<div class="sidebar-card">'+
  '<a class="side-user" href="#profile" data-page="profile"><span class="side-avatar">'+avatar()+'</span><span><span class="side-username">'+esc(me.username)+'</span><span class="side-role">Account</span></span></a>'+
  '<nav class="side-nav">'+links.map(([id,ico,label])=>'<a href="#'+id+'" data-page="'+id+'" class="'+(active===id?'active':'')+'"><span class="side-icon '+ico+'"></span><span>'+label+'</span>'+(id==="messages"?'<span class="side-count">0</span>':'')+'</a>').join("")+
  '<div class="side-separator"></div>'+
  '<a href="#donate" data-page="donate"><span class="side-icon icon-nav-robux"></span><span>Donate</span></a>'+
  '<a href="#upgrade" data-page="upgrade"><span class="side-icon icon-nav-settings"></span><span>Upgrade Now</span></a>'+
  '</nav></div>';
}

function setUser(user){
 me=user;
 accountArea.innerHTML=user
  ? '<a class="account-name" href="#profile" data-page="profile">'+esc(user.username)+'</a><button id="logoutBtn" type="button">Log out</button>'
  : '<button id="loginBtn" type="button">Login</button><button id="registerBtn" type="button">Sign Up</button>';
 currency.textContent=user?Number(user.balance||0).toLocaleString()+" P$":"";
 document.getElementById("logoutBtn")?.addEventListener("click",logout);
 document.getElementById("loginBtn")?.addEventListener("click",()=>page("login"));
 document.getElementById("registerBtn")?.addEventListener("click",()=>page("register"));
 renderSidebar(location.hash.slice(1)||"home");
}
async function refreshMe(){try{const d=await api("/api/me");setUser(d.user)}catch{setUser(null)}}
function page(name){history.pushState({page:name},"","#"+name);render(name)}
window.addEventListener("popstate",()=>render(location.hash.slice(1)||"home"));
document.addEventListener("click",e=>{const a=e.target.closest("[data-page]");if(a){e.preventDefault();sidebar.classList.remove("mobile-open");page(a.dataset.page)}const p=e.target.closest("[data-profile]");if(p){e.preventDefault();profile(p.dataset.profile)}const item=e.target.closest("[data-item-view]");if(item){e.preventDefault();showItem(item.dataset.itemView)}});
document.getElementById("globalSearchForm").addEventListener("submit",e=>{e.preventDefault();const q=document.getElementById("globalSearch").value.trim();page("users");setTimeout(()=>{const input=document.getElementById("userSearch");if(input){input.value=q;input.form?.dispatchEvent(new Event("submit",{cancelable:true,bubbles:true}))}},0)});

document.getElementById("mobileMenu")?.addEventListener("click",()=>sidebar.classList.toggle("mobile-open"));
function home(){
 renderSidebar("home");
 if(!me){
  app.innerHTML='<div class="op-guest"><h1>Welcome to Pekora</h1><p>Join the community and explore the catalog.</p><a class="button" href="#login" data-page="login">Login</a><a class="button" href="#register" data-page="register">Sign Up</a></div>';
  return;
 }
 const name=esc(me.username);
 app.innerHTML='<div class="op-dashboard">'+
  '<div class="op-home-header"><a id="homeAvatar" class="op-home-avatar" href="#profile" data-page="profile">'+avatar()+'</a><div><h1><a href="#profile" data-page="profile">Hello, '+name+'!</a></h1><p class="home-balance">'+Number(me.balance||0).toLocaleString()+' P$</p></div></div>'+
  '<section class="op-dashboard-section"><div class="op-section-heading"><h3>Friends (<span id="homeFriendCount">0</span>)</h3><a href="#friends" data-page="friends">See All</a></div><div id="homeFriends" class="op-section-content"><div class="op-empty">Loading friends...</div></div></section>'+
  '<section class="op-dashboard-section"><div class="op-section-heading"><h3>My Items</h3><a href="#inventory" data-page="inventory">See All</a></div><div id="homeItems" class="op-section-content"><div class="op-empty">Loading inventory...</div></div></section>'+
  '</div>';
 loadHomeDashboard();
}
async function loadHomeDashboard(){
 const friendsHost=document.getElementById("homeFriends"),itemsHost=document.getElementById("homeItems");
 if(!friendsHost||!itemsHost||!me)return;
 try{
  const [profileData,inventoryData,friendsData]=await Promise.all([
   api("/api/profile/"+encodeURIComponent(me.username)),
   api("/api/inventory"),
   api("/api/friends")
  ]);
  if(!document.getElementById("homeFriends"))return;
  const owned=inventoryData.items||[],profile=profileData.profile;
  document.getElementById("homeAvatar").innerHTML=avatarArtwork(me.username,profile.avatar,owned);
  const friends=friendsData.friends||[];
  document.getElementById("homeFriendCount").textContent=friends.length;
  friendsHost.innerHTML=friends.length?'<div class="op-home-friends">'+friends.slice(0,12).map(u=>'<a href="#profile" class="op-home-friend" data-profile="'+esc(u.username)+'">'+avatar(u.username)+'<span>'+esc(u.username)+'</span></a>').join("")+'</div>':'<div class="op-empty">You have no friends to display yet.</div>';
  itemsHost.innerHTML=owned.length?'<div class="op-home-items">'+owned.slice(0,6).map(itemCard).join("")+'</div>':'<div class="op-empty">Your inventory is empty. <a href="#catalog" data-page="catalog">Visit the Catalog</a>.</div>';
 }catch(e){
  friendsHost.innerHTML='<div class="op-empty">Could not load friends.</div>';
  itemsHost.innerHTML='<div class="op-empty">Could not load inventory.</div>';
 }
}

async function loadHomeInventory(){
 const el=document.getElementById("homeInventory");
 if(!el)return;
 try{
  const d=await api("/api/inventory");
  el.className="section-content";
  el.innerHTML=d.items.length
   ? '<div class="item-grid">'+d.items.slice(0,4).map(itemCard).join("")+'</div>'
   : '<p class="empty-line">You have no items yet. <a href="#catalog" data-page="catalog">Visit the Catalog</a>.</p>';
 }catch(e){el.textContent=e.message}
}
function itemCard(x){return '<article class="item-card"><div class="item-image">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="'+esc(x.name)+'">':'◇')+'</div><h3>'+esc(x.name)+'</h3><div class="muted">'+esc(x.category)+'</div></article>'}
function showItem(itemId){
 const item=items.find(x=>x.id===itemId);
 if(!item){toast("Item not found");return}
 app.innerHTML='<div class="item-detail-page"><a class="item-back-link" href="#catalog" data-page="catalog">‹ Back to Catalog</a><div class="item-detail-card">'+
  '<div class="item-detail-image" id="itemDetailPreview">'+(item.image_url?'<img src="'+esc(item.image_url)+'" alt="'+esc(item.name)+'">':'<span>No preview available</span>')+'</div>'+
  '<div class="item-detail-info"><h1>'+esc(item.name)+'</h1><div class="muted">'+esc(item.category)+'</div><p>'+esc(item.description||"No description available.")+'</p><div class="item-detail-price">'+Number(item.price||0).toLocaleString()+' P$</div><button class="primary" id="detailBuy" type="button">Buy</button></div>'+
  '</div></div>';
 document.getElementById("detailBuy").addEventListener("click",()=>buy(item.id));
 if(item.asset_kind==="MODEL_3D"||item.asset_kind==="FACE_TEXTURE"){
  const preview=document.getElementById("itemDetailPreview");
  const worn=[item];
  render3DAvatar(preview,worn);
 }
}


async function catalog(){
 renderSidebar("catalog");
 app.innerHTML=
  '<div class="container mt-4 ssp catalog-page">'+
   '<div class="catalog-container">'+
    '<div class="row catalog-title-row">'+
     '<div class="catalog-title-col"><h1 class="catalog-title">Catalog</h1></div>'+
     '<div class="catalog-input-col">'+
      '<form id="catalogSearchForm" class="catalog-input-form">'+
       '<input class="catalog-input" id="itemSearch" type="text" placeholder="Search">'+
       '<select class="catalog-select" id="itemCategorySelect">'+
        '<option value="All">All Categories</option><option value="Hats">Hats</option><option value="Hair">Hair</option>'+
        '<option value="Faces">Faces</option><option value="Shirts">Shirts</option><option value="Pants">Pants</option>'+
        '<option value="Accessories">Accessories</option>'+
       '</select>'+
       '<button class="button catalog-search-button" type="submit">Search</button>'+
      '</form>'+
     '</div>'+
    '</div>'+
    '<div class="catalog-body">'+
     '<aside class="catalog-navigation"><div class="divider-right">'+
      '<div class="catalog-browse-title"><p>Browse by</p><h2>Category</h2></div>'+
      '<nav id="catalogCategories" class="catalog-categories">'+
       '<a href="#" class="active" data-category="All">All Items</a>'+
       '<a href="#" data-category="Hats">Hats</a><a href="#" data-category="Hair">Hair</a>'+
       '<a href="#" data-category="Faces">Faces</a><a href="#" data-category="Shirts">Shirts</a>'+
       '<a href="#" data-category="Pants">Pants</a><a href="#" data-category="Accessories">Accessories</a>'+
      '</nav>'+
      '<div class="catalog-legend"><strong>About</strong><p>Items purchased here belong to your Pekora account.</p></div>'+
     '</div></aside>'+
     '<section class="catalog-results">'+
      '<div class="catalog-results-header"><div><h2 id="catalogCategoryTitle">Featured Items on Pekora</h2><p id="catalogCount" class="muted"></p></div><label class="catalog-sort-label">Sort By: <select id="catalogSort" class="catalog-sort"><option value="relevance">Relevance</option><option value="newest">Recently updated</option><option value="price-low">Price (Low to High)</option><option value="price-high">Price (High to Low)</option></select></label></div>'+
      '<div id="catalogGrid" class="item-grid">Loading catalog...</div>'+
     '</section>'+
    '</div>'+
   '</div>'+
  '</div>';
 try{items=(await api("/api/catalog")).items;drawCatalog("All","")}catch(e){document.getElementById("catalogGrid").textContent=e.message}
 const search=document.getElementById("itemSearch");
 const select=document.getElementById("itemCategorySelect");
 const activeCategory=()=>document.querySelector("[data-category].active")?.dataset.category||"All";
 function chooseCategory(category){
  document.querySelectorAll("[data-category]").forEach(x=>x.classList.toggle("active",x.dataset.category===category));
  select.value=category;
  document.getElementById("catalogCategoryTitle").textContent=category==="All"?"Featured Items on Pekora":category;
  drawCatalog(category,search.value);
 }
 document.getElementById("catalogSearchForm").addEventListener("submit",e=>{
  e.preventDefault();
  chooseCategory(select.value||"All");
 });
 search.addEventListener("input",()=>drawCatalog(activeCategory(),search.value));
 document.getElementById("catalogSort").value=catalogSort;
 document.getElementById("catalogSort").addEventListener("change",e=>{
  catalogSort=e.target.value;
  drawCatalog(activeCategory(),search.value);
 });
 select.addEventListener("change",()=>chooseCategory(select.value));
 document.querySelectorAll("[data-category]").forEach(a=>a.addEventListener("click",e=>{
  e.preventDefault();
  chooseCategory(a.dataset.category);
 }));
}
function drawCatalog(category,q){
 const el=document.getElementById("catalogGrid");if(!el)return;
 let list=items.filter(x=>(category==="All"||x.category===category)&&((x.name||"")+" "+(x.description||"")).toLowerCase().includes(q.toLowerCase()));
 if(catalogSort==="newest")list.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
 if(catalogSort==="price-low")list.sort((a,b)=>Number(a.price||0)-Number(b.price||0));
 if(catalogSort==="price-high")list.sort((a,b)=>Number(b.price||0)-Number(a.price||0));
 document.getElementById("catalogCount").textContent=list.length+" items";
 el.innerHTML=list.length?list.map(x=>'<article class="item-card"><a class="item-image" href="#" data-item-view="'+esc(x.id)+'" aria-label="View '+esc(x.name)+'">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="'+esc(x.name)+'">':'◇')+'</a><h3>'+esc(x.name)+'</h3><div class="muted">'+esc(x.category)+'</div><div class="catalog-asset-kind">'+(x.asset_kind==="MODEL_3D"?"3D wearable":x.asset_kind==="FACE_TEXTURE"?"Face texture":"Image preview only")+'</div><div class="price">'+Number(x.price||0).toLocaleString()+' P$</div><button class="button" data-buy="'+esc(x.id)+'">Buy</button></article>').join(""):'<div class="empty">No items found.</div>';
 el.querySelectorAll("[data-buy]").forEach(b=>b.addEventListener("click",()=>buy(b.dataset.buy)));
 el.querySelectorAll("[data-item-view]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();showItem(a.dataset.itemView)}));
}async function buy(itemId){if(!me){page("login");return}try{const d=await api("/api/purchase",{method:"POST",body:JSON.stringify({itemId})});me.balance=d.balance;setUser(me);toast("Item purchased");catalog()}catch(e){toast(e.message)}}
function auth(kind){
 renderSidebar("");
 const reg=kind==="register";
 app.innerHTML='<div class="form"><h2>'+(reg?"Create your Pekora account":"Log in to Pekora")+'</h2><form id="authForm"><label>Username</label><input name="username" required minlength="3" maxlength="20" autocomplete="username"><label>Password</label><input name="password" type="password" required minlength="'+(reg?8:1)+'" maxlength="128" autocomplete="'+(reg?"new-password":"current-password")+'"><button class="primary" type="submit">'+(reg?"Sign up":"Log in")+'</button><div id="authError" class="error"></div></form><p class="muted">'+(reg?'Already have an account? <a href="#login" data-page="login">Log in</a>':'New to Pekora? <a href="#register" data-page="register">Sign up</a>')+'</p></div>';
 document.getElementById("authForm").addEventListener("submit",async e=>{e.preventDefault();const f=new FormData(e.target);try{const d=await api(reg?"/api/register":"/api/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});setUser(d.user);page("home")}catch(err){document.getElementById("authError").textContent=err.message}});
}
async function logout(){try{await api("/api/logout",{method:"POST"});setUser(null);page("home")}catch(e){toast(e.message)}}
async function inventory(){
 renderSidebar("inventory");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to view your inventory.</div>';return}
 app.innerHTML='<h1 class="page-title">Inventory</h1><div id="inventoryGrid" class="item-grid">Loading...</div>';
 try{const d=await api("/api/inventory");document.getElementById("inventoryGrid").innerHTML=d.items.length?d.items.map(itemCard).join(""):'<div class="empty">Your inventory is empty. <a href="#catalog" data-page="catalog">Browse the Catalog</a>.</div>'}catch(e){document.getElementById("inventoryGrid").textContent=e.message}
}
async function profile(username=me?.username){
 renderSidebar("profile");
 if(!username){app.innerHTML='<div class="empty">Choose a user profile.</div>';return}
 try{
  const [d,inventoryData]=await Promise.all([
   api("/api/profile/"+encodeURIComponent(username)),
   api("/api/profile/"+encodeURIComponent(username)+"/inventory")
  ]);
  const p=d.profile,owned=inventoryData.items||[],isSelf=me&&me.username.toLowerCase()===p.username.toLowerCase();
  app.innerHTML='<div class="op-profile">'+
   '<div class="op-profile-header">'+avatarArtwork(p.username,p.avatar,owned)+'<div class="op-profile-info">'+
    '<h1>'+esc(p.username)+'</h1><div class="op-profile-meta">'+esc(p.role)+' · Joined '+new Date(p.createdAt).toLocaleDateString()+'</div>'+
    '<p>'+esc(p.description||"This user has not added a description.")+'</p>'+
    '<div class="op-profile-stats"><span><b>'+Number(p.itemCount||0).toLocaleString()+'</b> Items</span><span><b>'+Number(p.balance||0).toLocaleString()+'</b> P$</span></div>'+
    (!isSelf&&me?'<div id="profileFriendAction" class="profile-friend-action">Loading...</div>':'')+
   '</div></div>'+
   '<nav class="op-profile-tabs"><a href="#" class="active" data-profile-tab="about">About</a><a href="#" data-profile-tab="creations">Creations</a></nav>'+
   '<section id="profileTabContent" class="op-profile-content">'+
    '<div class="op-profile-section"><h2>Inventory</h2>'+
     (owned.length?'<div class="op-profile-items">'+owned.map(itemCard).join("")+'</div>':'<div class="op-profile-empty">This user has no items to display.</div>')+
    '</div></section></div>';
  app.querySelectorAll("[data-profile-tab]").forEach(tab=>tab.addEventListener("click",e=>{
   e.preventDefault();
   app.querySelectorAll("[data-profile-tab]").forEach(x=>x.classList.toggle("active",x===tab));
   document.getElementById("profileTabContent").innerHTML=tab.dataset.profileTab==="about"
    ? '<div class="op-profile-section"><h2>Inventory</h2>'+(owned.length?'<div class="op-profile-items">'+owned.map(itemCard).join("")+'</div>':'<div class="op-profile-empty">This user has no items to display.</div>')+'</div>'
    : '<div class="op-profile-section"><h2>Creations</h2><div class="op-profile-empty">No creations to display.</div></div>';
  }));
  if(!isSelf&&me)loadProfileFriendAction(p.username);
 }catch(e){app.innerHTML='<div class="empty">'+esc(e.message)+'</div>'}
}
async function loadProfileFriendAction(username){
 const host=document.getElementById("profileFriendAction");if(!host)return;
 try{
  const {status}=await api("/api/friends/status?username="+encodeURIComponent(username));
  const labels={none:"Add Friend",outgoing:"Request Sent",incoming:"Accept Request",friends:"Remove Friend",self:"Your Profile"};
  host.innerHTML='<button type="button" class="button '+(status==="friends"?"secondary":"")+'" id="profileFriendBtn" '+(status==="outgoing"||status==="self"?"disabled":"")+'>'+labels[status]+'</button>';
  document.getElementById("profileFriendBtn").addEventListener("click",async()=>{
   try{
    if(status==="none")await api("/api/friends/request",{method:"POST",body:JSON.stringify({username})});
    else if(status==="incoming")await api("/api/friends/accept",{method:"POST",body:JSON.stringify({username})});
    else if(status==="friends")await api("/api/friends?username="+encodeURIComponent(username),{method:"DELETE"});
    await profile(username);
   }catch(e){toast(e.message)}
  });
 }catch(e){host.textContent=e.message}
}

async function settings(){
 renderSidebar("settings");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> first.</div>';return}
 let description="";
 try{const d=await api("/api/profile/"+encodeURIComponent(me.username));description=d.profile.description||""}catch{}
 app.innerHTML='<h1 class="page-title">Account Settings</h1><div class="form" style="max-width:600px;margin:0"><h2>Profile</h2><form id="settingsForm"><label>Username</label><input value="'+esc(me.username)+'" disabled><label>Profile description</label><textarea name="description" rows="5" maxlength="500">'+esc(description)+'</textarea><button class="primary" type="submit">Save changes</button><div id="settingsMessage" class="muted"></div></form></div>';
 document.getElementById("settingsForm").addEventListener("submit",async e=>{e.preventDefault();const description=new FormData(e.target).get("description");try{await api("/api/profile",{method:"PUT",body:JSON.stringify({description})});document.getElementById("settingsMessage").textContent="Profile saved."}catch(err){document.getElementById("settingsMessage").textContent=err.message}});
}
async function avatarPage(){
 renderSidebar("avatar");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to edit your avatar.</div>';return}
 app.innerHTML='<div class="avatar-editor"><div class="avatar-editor-heading"><h1 class="page-title">Avatar Editor</h1><a class="button" href="#catalog" data-page="catalog">Get More Items</a></div><div class="avatar-editor-layout"><section class="avatar-preview-panel"><h2>Preview</h2><div id="avatarPreview"></div><p class="muted">Your avatar settings are saved to your Pekora account.</p><button class="button secondary" id="clearAvatar" type="button">Reset Avatar</button></section><section class="avatar-wardrobe"><h2>My Wardrobe</h2><div class="avatar-category-tabs" id="avatarCategories"></div><div id="avatarWardrobe" class="avatar-wardrobe-grid">Loading inventory...</div></section></div></div>';
 let wardrobe=[],equipped={},activeCategory="Hats";
 try{
  const [a,i]=await Promise.all([api("/api/avatar"),api("/api/inventory")]);
  equipped=a.avatar||{};wardrobe=i.items||[];
 }catch(e){document.getElementById("avatarWardrobe").textContent=e.message;return}
 async function renderAvatar(){
  const container=document.getElementById("avatarPreview");
  if(!container)return;
  const worn=AVATAR_CATEGORIES.map(category=>wardrobe.find(x=>x.id===equipped[category])).filter(Boolean);
  await render3DAvatar(container,worn);
 }
 function renderWardrobe(){
  document.getElementById("avatarCategories").innerHTML=AVATAR_CATEGORIES.map(c=>'<button type="button" class="avatar-category '+(c===activeCategory?"active":"")+'" data-avatar-category="'+c+'">'+c+'</button>').join("");
  const own=wardrobe.filter(x=>x.category===activeCategory),selected=equipped[activeCategory];
  document.getElementById("avatarWardrobe").innerHTML=own.length?own.map(x=>'<article class="avatar-wardrobe-item">'+
   '<div class="avatar-wardrobe-image">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="'+esc(x.name)+'" loading="lazy">':'<span>'+esc(x.category)+'</span>')+'</div>'+
   '<div class="avatar-wardrobe-name">'+esc(x.name)+'</div>'+
   (selected===x.id?'<span class="avatar-wearing-label">Wearing</span>':(x.asset_kind==="MODEL_3D"||x.asset_kind==="FACE_TEXTURE")?'<button type="button" class="button" data-wear-item="'+esc(x.id)+'">Wear</button>':'<span class="avatar-preview-only-label">Preview only — not wearable</span>')+
   '</article>').join(""):'<div class="avatar-wardrobe-empty">You do not own any '+esc(activeCategory.toLowerCase())+' yet. <a href="#catalog" data-page="catalog">Browse the Catalog</a>.</div>';
  document.querySelectorAll("[data-avatar-category]").forEach(b=>b.addEventListener("click",()=>{activeCategory=b.dataset.avatarCategory;renderWardrobe()}));
  document.querySelectorAll("[data-wear-item]").forEach(b=>b.addEventListener("click",()=>wearAvatarItem(b.dataset.wearItem)));
 }
 async function wearAvatarItem(itemId){
  try{const d=await api("/api/avatar",{method:"PUT",body:JSON.stringify({equipped:{[activeCategory]:itemId}})});equipped=d.avatar||equipped;await renderAvatar();renderWardrobe();toast("Avatar updated")}
  catch(e){toast(e.message)}
 }
 document.getElementById("clearAvatar").addEventListener("click",async()=>{
  try{const cleared=Object.fromEntries(AVATAR_CATEGORIES.map(c=>[c,null]));const d=await api("/api/avatar",{method:"PUT",body:JSON.stringify({equipped:cleared})});equipped=d.avatar||{};await renderAvatar();renderWardrobe();toast("Avatar reset")}
  catch(e){toast(e.message)}
 });
 renderWardrobe();await renderAvatar();
}
function comingSoon(name){renderSidebar(name.toLowerCase());app.innerHTML='<h1 class="page-title">'+esc(name)+'</h1><div class="section-box muted-box">'+esc(name)+' features are not available yet.</div>'}
async function friends(){
 renderSidebar("friends");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to view friends.</div>';return}
 app.innerHTML='<h1 class="page-title">Friends</h1><form id="addFriendForm" class="people-search"><input class="search-input" name="username" placeholder="Username" minlength="3" maxlength="20" required><button class="button" type="submit">Add Friend</button></form><div id="friendsMessage" class="muted"></div><div id="friendsContent">Loading...</div>';
 document.getElementById("addFriendForm").addEventListener("submit",async e=>{
  e.preventDefault();const username=new FormData(e.target).get("username").trim();
  try{await api("/api/friends/request",{method:"POST",body:JSON.stringify({username})});document.getElementById("friendsMessage").textContent="Friend request sent.";e.target.reset();loadFriendsList()}
  catch(err){document.getElementById("friendsMessage").textContent=err.message}
 });
 await loadFriendsList();
}
async function loadFriendsList(){
 const host=document.getElementById("friendsContent");if(!host)return;
 try{
  const d=await api("/api/friends");
  const section=(title,list,kind)=>'<section class="friends-section"><h2>'+title+' ('+list.length+')</h2>'+(list.length?list.map(u=>'<article class="people-user"><div class="people-user-info"><strong>'+esc(u.username)+'</strong><span>'+esc(u.role||"USER")+'</span></div><button class="button" type="button" data-friend-action="'+kind+'" data-friend-name="'+esc(u.username)+'">'+(kind==="accept"?"Accept":kind==="remove"?"Remove":"Cancel")+'</button></article>').join(""):'<div class="op-profile-empty">Nothing here yet.</div>')+'</section>';
  host.innerHTML=section("Friend Requests",d.incoming||[],"accept")+section("Friends",d.friends||[],"remove")+section("Sent Requests",d.outgoing||[],"remove");
  host.querySelectorAll("[data-friend-action]").forEach(b=>b.addEventListener("click",async()=>{
   const username=b.dataset.friendName;
   try{
    if(b.dataset.friendAction==="accept")await api("/api/friends/accept",{method:"POST",body:JSON.stringify({username})});
    else await api("/api/friends?username="+encodeURIComponent(username),{method:"DELETE"});
    await loadFriendsList();
   }catch(e){toast(e.message)}
  }));
 }catch(e){host.textContent=e.message}
}
function users(){
 renderSidebar("users");
 app.innerHTML='<h1 class="page-title">People</h1><p class="page-subtitle">Search the Pekora community and open user profiles.</p><form id="peopleSearchForm" class="people-search"><input id="userSearch" class="search-input" placeholder="Enter a username..." minlength="2" autocomplete="off"><button class="button" type="submit">Search</button></form><div id="peopleHint" class="notice">Type at least 2 characters to find users. Search results will appear below.</div><div id="userResults" class="people-results"></div>';
 const form=document.getElementById("peopleSearchForm");
 const input=document.getElementById("userSearch");
 const results=document.getElementById("userResults");
 const hint=document.getElementById("peopleHint");
 let latest=0;
 async function runSearch(){
  const q=input.value.trim();
  if(q.length<2){results.innerHTML="";hint.textContent="Type at least 2 characters to find users. Search results will appear below.";hint.style.display="block";return}
  const requestId=++latest;
  hint.textContent="Searching Pekora users...";
  hint.style.display="block";
  try{
   const d=await api("/api/search-users?q="+encodeURIComponent(q));
   if(requestId!==latest)return;
   const found=Array.isArray(d.users)?d.users:[];
   hint.style.display="none";
   results.innerHTML=found.length?found.map(u=>'<article class="people-user"><div class="people-avatar">'+avatar(u.username)+'</div><div class="people-user-info"><strong>'+esc(u.username)+'</strong><span>'+esc(u.role||"USER")+'</span></div><button class="button" type="button" data-profile="'+esc(u.username)+'">View Profile</button></article>').join(""):'<div class="empty">No users found for “'+esc(q)+'”.</div>';
  }catch(e){if(requestId!==latest)return;hint.textContent="Could not load users: "+e.message;hint.style.display="block";results.innerHTML=""}
 }
 form.addEventListener("submit",e=>{e.preventDefault();runSearch()});
 input.addEventListener("input",()=>{if(input.value.trim().length===0){latest++;results.innerHTML="";hint.textContent="Type at least 2 characters to find users. Search results will appear below.";hint.style.display="block"}});
 if(location.hash.startsWith("#users?")){input.value=new URLSearchParams(location.hash.split("?")[1]).get("q")||"";if(input.value.length>=2)runSearch()}
}
async function owner(){
 renderSidebar("owner");
 if(!me||me.role!=="OWNER"){app.innerHTML='<div class="empty">Owner access required.</div>';return}
 app.innerHTML='<h1 class="page-title">Owner Panel</h1><div id="ownerStats" class="item-grid">Loading...</div>'+
 '<section class="owner-section"><h2>Catalog Management</h2><p class="muted">Remove every item from the public catalog. Existing owners keep their inventory.</p><button class="button secondary" id="clearPublicCatalog" type="button">Remove all items from catalog</button><form id="newItemForm" class="owner-item-form">'+
 '<label>Item name<input name="name" maxlength="80" required></label>'+
 '<label>Category<select name="category">'+AVATAR_CATEGORIES.map(c=>'<option>'+c+'</option>').join("")+'</select></label>'+
 '<label>Price (P$)<input name="price" type="number" min="0" max="1000000" value="50" required></label>'+
 '<label>Preview image URL<input name="image_url" type="url" placeholder="https://..."></label>'+
 '<label>Asset type<select name="asset_kind"><option value="MODEL_3D">Wearable 3D (.glb)</option><option value="FACE_TEXTURE">Face texture</option><option value="IMAGE_ONLY">Image only</option></select></label>'+
 '<label>3D model URL<input name="model_url" type="text" placeholder="/assets/catalog/item.glb"></label>'+
 '<label>Attach to<select name="attachment">'+AVATAR_ATTACHMENTS.map(a=>'<option value="'+a+'">'+a+'</option>').join("")+'</select></label>'+
 '<label>Model scale<input name="model_scale" type="number" min="0.01" max="10" step="0.01" value="1"></label>'+
 '<details class="owner-model-adjust"><summary>Advanced model position and rotation</summary><div class="owner-model-adjust-grid">'+
 '<label>Offset X<input name="offset_x" type="number" step="0.01" value="0"></label><label>Offset Y<input name="offset_y" type="number" step="0.01" value="0"></label><label>Offset Z<input name="offset_z" type="number" step="0.01" value="0"></label>'+
 '<label>Rotation X<input name="rotation_x" type="number" step="1" value="0"></label><label>Rotation Y<input name="rotation_y" type="number" step="1" value="0"></label><label>Rotation Z<input name="rotation_z" type="number" step="1" value="0"></label></div></details>'+
 '<label class="owner-description">Description<textarea name="description" maxlength="500" rows="2"></textarea></label>'+
 '<button class="primary" type="submit">Add Item</button><span id="ownerFormMessage" class="muted"></span></form>'+
 '<div id="ownerItems" class="owner-items">Loading items...</div></section>';
 try{
  const [stats,data]=await Promise.all([api("/api/owner/stats"),api("/api/owner/items")]);
  document.getElementById("ownerStats").innerHTML='<div class="info-panel"><h3>Users</h3><b>'+stats.users+'</b></div><div class="info-panel"><h3>Catalog Items</h3><b>'+stats.items+'</b></div><div class="info-panel"><h3>Purchases</h3><b>'+stats.purchases+'</b></div>';
  let ownerItems=data.items||[];
  document.getElementById("clearPublicCatalog").addEventListener("click",async()=>{
   if(!confirm("Remove ALL items from the public catalog? Existing user inventories and balances will not be changed."))return;
   const button=document.getElementById("clearPublicCatalog");button.disabled=true;button.textContent="Removing...";
   try{
    const result=await api("/api/owner/items",{method:"DELETE"});
    const fresh=await api("/api/owner/items");ownerItems=fresh.items||[];drawOwnerItems();
    document.getElementById("ownerStats").querySelectorAll(".info-panel")[1].querySelector("b").textContent=ownerItems.length;
    toast(result.hidden+" items removed from the public catalog");
   }catch(e){toast(e.message)}
   finally{button.disabled=false;button.textContent="Remove all items from catalog"}
  });
  function drawOwnerItems(){
   document.getElementById("ownerItems").innerHTML=ownerItems.length?ownerItems.map(x=>'<form class="owner-item-row" data-edit-item="'+esc(x.id)+'">'+
    '<div class="owner-item-thumb">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="">':'◇')+'</div>'+
    '<div class="owner-item-fields"><input name="name" value="'+esc(x.name)+'" maxlength="80" required>'+
    '<div class="owner-item-subfields"><select name="category">'+AVATAR_CATEGORIES.map(c=>'<option value="'+c+'" '+(c===x.category?'selected':'')+'>'+c+'</option>').join("")+'</select><input name="price" type="number" min="0" max="1000000" value="'+Number(x.price)+'" required><input name="image_url" type="url" value="'+esc(x.image_url||"")+'" placeholder="Preview image URL"></div>'+
    '<div class="owner-item-model-fields"><select name="asset_kind"><option value="MODEL_3D" '+(x.asset_kind==="MODEL_3D"?"selected":"")+'>3D wearable</option><option value="FACE_TEXTURE" '+(x.asset_kind==="FACE_TEXTURE"?"selected":"")+'>Face texture</option><option value="IMAGE_ONLY" '+(x.asset_kind!=="MODEL_3D"&&x.asset_kind!=="FACE_TEXTURE"?"selected":"")+'>Image only</option></select><input name="model_url" type="url" value="'+esc(x.model_url||"")+'" placeholder="3D .glb model URL"><select name="attachment">'+AVATAR_ATTACHMENTS.map(a=>'<option value="'+a+'" '+(a===(x.attachment||"Head")?"selected":"")+'>'+a+'</option>').join("")+'</select><input name="model_scale" type="number" min="0.01" max="10" step="0.01" value="'+Number(x.model_scale||1)+'" title="Model scale"></div>'+
    '<details class="owner-model-adjust"><summary>Model position and rotation</summary><div class="owner-model-adjust-grid">'+
    '<label>X<input name="offset_x" type="number" step="0.01" value="'+Number(x.offset_x||0)+'"></label><label>Y<input name="offset_y" type="number" step="0.01" value="'+Number(x.offset_y||0)+'"></label><label>Z<input name="offset_z" type="number" step="0.01" value="'+Number(x.offset_z||0)+'"></label>'+
    '<label>Rotate X<input name="rotation_x" type="number" value="'+Number(x.rotation_x||0)+'"></label><label>Rotate Y<input name="rotation_y" type="number" value="'+Number(x.rotation_y||0)+'"></label><label>Rotate Z<input name="rotation_z" type="number" value="'+Number(x.rotation_z||0)+'"></label></div></details>'+
    '<textarea name="description" rows="2" maxlength="500">'+esc(x.description||"")+'</textarea><span class="muted">'+(x.is_for_sale?'For sale':'Removed from catalog')+'</span></div>'+
    '<div class="owner-item-actions"><button class="button" type="submit">Save</button>'+(x.is_for_sale?'<button class="button secondary" type="button" data-remove-item="'+esc(x.id)+'">Remove</button>':'<button class="button" type="button" data-restore-item="'+esc(x.id)+'">Restore</button>')+'</div></form>').join(""):'<div class="empty">No catalog items yet.</div>';
   document.querySelectorAll("[data-edit-item]").forEach(form=>form.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(form),id=form.dataset.editItem;
    try{
     await api("/api/owner/items/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({name:f.get("name"),category:f.get("category"),price:Number(f.get("price")),image_url:f.get("image_url"),description:f.get("description"),asset_kind:f.get("asset_kind"),model_url:f.get("model_url"),attachment:f.get("attachment"),model_scale:Number(f.get("model_scale")||1),offset_x:Number(f.get("offset_x")||0),offset_y:Number(f.get("offset_y")||0),offset_z:Number(f.get("offset_z")||0),rotation_x:Number(f.get("rotation_x")||0),rotation_y:Number(f.get("rotation_y")||0),rotation_z:Number(f.get("rotation_z")||0)})});
     const fresh=await api("/api/owner/items");ownerItems=fresh.items||[];drawOwnerItems();toast("Item saved");
    }catch(err){toast(err.message)}
   }));
   document.querySelectorAll("[data-restore-item]").forEach(button=>button.addEventListener("click",async()=>{
    try{await api("/api/owner/items/"+encodeURIComponent(button.dataset.restoreItem),{method:"PATCH",body:JSON.stringify({is_for_sale:true})});const fresh=await api("/api/owner/items");ownerItems=fresh.items||[];drawOwnerItems();toast("Item restored")}
    catch(e){toast(e.message)}
   }));
   document.querySelectorAll("[data-remove-item]").forEach(button=>button.addEventListener("click",async()=>{
    if(!confirm("Remove this item from the public catalog? Existing owners will keep it."))return;
    try{await api("/api/owner/items/"+encodeURIComponent(button.dataset.removeItem),{method:"DELETE"});const fresh=await api("/api/owner/items");ownerItems=fresh.items||[];drawOwnerItems();toast("Item removed from catalog")}
    catch(e){toast(e.message)}
   }));
  }
  drawOwnerItems();
  document.getElementById("newItemForm").addEventListener("submit",async e=>{
   e.preventDefault();const f=new FormData(e.target),msg=document.getElementById("ownerFormMessage");msg.textContent="Saving...";
   try{
    await api("/api/owner/items",{method:"POST",body:JSON.stringify({name:f.get("name"),category:f.get("category"),price:Number(f.get("price")),image_url:f.get("image_url"),description:f.get("description"),asset_kind:f.get("asset_kind"),model_url:f.get("model_url"),attachment:f.get("attachment"),model_scale:Number(f.get("model_scale")||1),offset_x:Number(f.get("offset_x")||0),offset_y:Number(f.get("offset_y")||0),offset_z:Number(f.get("offset_z")||0),rotation_x:Number(f.get("rotation_x")||0),rotation_y:Number(f.get("rotation_y")||0),rotation_z:Number(f.get("rotation_z")||0)})});
    e.target.reset();e.target.elements.price.value=50;msg.textContent="Item added.";const fresh=await api("/api/owner/items");ownerItems=fresh.items||[];drawOwnerItems();
   }catch(err){msg.textContent=err.message}
  });
 }catch(e){document.getElementById("ownerItems").textContent=e.message}
}

function infoPage(type){
 renderSidebar("");
 const pages={
  about:{title:"About Pekora",body:'<p>Pekora is an independent community revival project. It is not affiliated with or endorsed by Roblox Corporation.</p><p>This build includes account profiles, a virtual catalog, inventory, avatar outfit settings and friend requests.</p><p>Pekora currency is an in-site balance only. It has no real-world monetary value.</p>'},
  terms:{title:"Terms of Use",body:'<p>Use Pekora respectfully and do not impersonate other users, abuse the service or attempt to access accounts that are not yours.</p><p>Do not upload images or descriptions that violate the rights or safety of other people. The project owner may remove catalog entries or accounts that abuse the service.</p><p>Virtual currency and catalog items are for use inside this website only. They cannot be exchanged for real money.</p>'},
  privacy:{title:"Privacy",body:'<p>Pekora stores your username, a password hash, session information, profile description, avatar selections, virtual balance, inventory and friend requests so the service can work.</p><p>Passwords are not stored as plain text. Sign-in uses a secure session cookie. This build does not ask for an email address.</p><p>Do not reuse an important password and do not share your account credentials with anyone.</p>'}
 };
 const pageData=pages[type]||pages.about;
 app.innerHTML='<article class="info-page"><h1 class="page-title">'+pageData.title+'</h1>'+pageData.body+'<a class="button" href="#home" data-page="home">Back to Home</a></article>';
}
async function render(name){
 name=name||"home";
 if(name==="home")home();
 else if(name==="catalog")await catalog();
 else if(name==="login"||name==="register")auth(name);
 else if(name==="inventory")await inventory();
 else if(name==="profile")await profile();
 else if(name==="avatar")await avatarPage();
 else if(name==="users")users();
 else if(name==="games")comingSoon("Games");
 else if(name==="friends")await friends();
 else if(name==="messages")comingSoon("Messages");
 else if(name==="groups")comingSoon("Groups");
 else if(name==="forums")comingSoon("Forums");
 else if(name==="donate")comingSoon("Donate");
 else if(name==="upgrade")comingSoon("Upgrade");
 else if(name==="community")users();
 else if(name==="about"||name==="terms"||name==="privacy")infoPage(name);
 else if(name==="develop"||name==="download")comingSoon(name==="develop"?"Create":"Download");
 else if(name==="trades")comingSoon("Trades");
 else if(name==="settings")await settings();
 else if(name==="owner")await owner();
 else home();
}
(async()=>{await refreshMe();await render(location.hash.slice(1)||"home")})();
