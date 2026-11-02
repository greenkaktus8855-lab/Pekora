const app=document.getElementById("app");
const accountArea=document.getElementById("accountArea");
const currency=document.getElementById("currency");
const sidebar=document.getElementById("sidebar");
let me=null,items=[],catalogSort="relevance",ownedItemIds=new Set(),ownershipLoaded=true,ownershipUserId=null;
let activeView=0;
const beginView=()=>++activeView;
const isActiveView=view=>view===activeView;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,options={}){const res=await fetch(path,{credentials:"same-origin",...options,headers:{"content-type":"application/json",...(options.headers||{})}});let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.error||"Something went wrong");return data}
function toast(message){const el=document.getElementById("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600)}
function avatar(username=me?.username){
 const isKoqumo=String(username||"").toLowerCase()==="koqumo";
 if(!isKoqumo)return '<span class="avatar-render avatar-placeholder" role="img" aria-label="Avatar thumbnail unavailable"><span class="icon-nav-profile"></span></span>';
 return '<img class="avatar-render avatar-real" src="https://tcdn.pekora.pro/images/thumbnails/152d7862464483e0c3989bc1cee7a9d1a954964b95a49f6687945d2c070cb25e_headshot.png" alt="User avatar" loading="lazy">';
}
document.addEventListener("error",event=>{
 const image=event.target;
 if(!image.classList?.contains("avatar-real"))return;
 const placeholder=document.createElement("span");
 placeholder.className="avatar-render avatar-placeholder";
 placeholder.setAttribute("role","img");
 placeholder.setAttribute("aria-label","Avatar thumbnail unavailable");
 const icon=document.createElement("span");
 icon.className="icon-nav-profile";
 placeholder.append(icon);
 image.replaceWith(placeholder);
},true);
const AVATAR_CATEGORIES=["Hats","Hair","Faces","Shirts","Pants","Accessories"];

function renderSidebar(active="home"){
 if(!me){sidebar.classList.remove("visible","mobile-open");sidebar.innerHTML="";return}
 sidebar.classList.add("visible");
 const links=[
  ["home","icon-nav-home","Home"],
  ["profile","icon-nav-profile","Profile"],
  ["friends","icon-nav-friends","Friends"],
  ["avatar","icon-nav-charactercustomizer","Avatar"],
  ["inventory","icon-nav-inventory","Inventory"],
  ["settings","icon-nav-settings","Settings"]
 ];
 sidebar.innerHTML='<div class="sidebar-card">'+
  '<a class="side-user" href="#profile" data-page="profile"><span class="side-avatar">'+avatar()+'</span><span><span class="side-username">'+esc(me.username)+'</span><span class="side-role">Account</span></span></a>'+
  '<nav class="side-nav">'+links.map(([id,ico,label])=>'<a href="#'+id+'" data-page="'+id+'" class="'+(active===id?'active':'')+'"><span class="side-icon '+ico+'"></span><span>'+label+'</span></a>').join("")+
  '<div class="side-separator"></div>'+
  (me.role==="OWNER"?'<a href="#owner" data-page="owner" class="'+(active==="owner"?"active":"")+'"><span class="side-icon icon-nav-settings"></span><span>Owner Panel</span></a>':'')+
  '</nav></div>';
}

function setUser(user){
 const nextUserId=user?.id||null;
 if(nextUserId!==ownershipUserId){
  ownershipUserId=nextUserId;
  ownedItemIds=new Set();
  ownershipLoaded=!user;
 }
 me=user;
 accountArea.innerHTML=user
  ? '<a class="account-name" href="#profile" data-page="profile">'+esc(user.username)+'</a><button id="logoutBtn" type="button">Log out</button>'
  : '<button id="loginBtn" type="button">Login</button><button id="registerBtn" type="button">Sign Up</button>';
 currency.textContent=user?Number(user.balance||0).toLocaleString()+" P$":"";
 document.getElementById("logoutBtn")?.addEventListener("click",logout);
 document.getElementById("loginBtn")?.addEventListener("click",()=>page("login"));
 document.getElementById("registerBtn")?.addEventListener("click",()=>page("register"));
 const currentPage=(location.hash.slice(1).split("?")[0]||"home");
 renderSidebar(currentPage==="item"?"catalog":currentPage);
}
async function refreshMe(){try{const d=await api("/api/me");setUser(d.user)}catch{setUser(null)}}
function page(name){history.pushState({page:name},"","#"+name);render(name)}
window.addEventListener("popstate",()=>render(location.hash.slice(1)||"home"));
document.addEventListener("click",e=>{
 const a=e.target.closest("[data-page]");
 if(a){e.preventDefault();sidebar.classList.remove("mobile-open");page(a.dataset.page)}
 const p=e.target.closest("[data-profile]");
 if(p){
  e.preventDefault();
  sidebar.classList.remove("mobile-open");
  const username=p.dataset.profile;
  history.pushState({page:"profile",username},"","#profile?username="+encodeURIComponent(username));
  profile(username);
 }
 const item=e.target.closest("[data-item-view]");
 if(item){e.preventDefault();showItem(item.dataset.itemView)}
});
document.getElementById("globalSearchForm").addEventListener("submit",e=>{
 e.preventDefault();
 const q=document.getElementById("globalSearch").value.trim().slice(0,20);
 const target="#users?q="+encodeURIComponent(q);
 history.pushState({page:"users",query:q},"",target);
 render("users");
});

document.getElementById("mobileMenu")?.addEventListener("click",()=>sidebar.classList.toggle("mobile-open"));
function home(){
 const view=beginView();
 renderSidebar("home");
 if(!me){
  app.innerHTML='<div class="op-guest"><h1>Welcome to Pekora</h1><p>Join the community and explore the catalog.</p><a class="button" href="#login" data-page="login">Login</a><a class="button" href="#register" data-page="register">Sign Up</a></div>';
  return;
 }
 const name=esc(me.username);
 app.innerHTML='<div class="op-dashboard">'+
  '<div class="op-home-header"><a id="homeAvatar" class="op-home-avatar" href="#profile" data-page="profile">'+avatar(me.username)+'</a><div><h1><a href="#profile" data-page="profile">Hello, '+name+'!</a></h1><p class="home-balance">'+Number(me.balance||0).toLocaleString()+' P$</p></div></div>'+
  '<section class="op-dashboard-section"><div class="op-section-heading"><h3>Friends (<span id="homeFriendCount">0</span>)</h3><a href="#friends" data-page="friends">See All</a></div><div id="homeFriends" class="op-section-content"><div class="op-empty">Loading friends...</div></div></section>'+
  '<section class="op-dashboard-section"><div class="op-section-heading"><h3>My Items</h3><a href="#inventory" data-page="inventory">See All</a></div><div id="homeItems" class="op-section-content"><div class="op-empty">Loading inventory...</div></div></section>'+
  '</div>';
 loadHomeDashboard(view);
}
async function loadHomeDashboard(view=activeView){
 const friendsHost=document.getElementById("homeFriends"),itemsHost=document.getElementById("homeItems");
 if(!friendsHost||!itemsHost||!me)return;
 try{
  const [inventoryData,friendsData]=await Promise.all([
   api("/api/inventory"),
   api("/api/friends")
  ]);
  if(!isActiveView(view)||!document.getElementById("homeFriends"))return;
  const owned=inventoryData.items||[];
  const friends=friendsData.friends||[];
  document.getElementById("homeFriendCount").textContent=friends.length;
  friendsHost.innerHTML=friends.length?'<div class="op-home-friends">'+friends.slice(0,12).map(u=>'<a href="#profile" class="op-home-friend" data-profile="'+esc(u.username)+'">'+avatar(u.username)+'<span>'+esc(u.username)+'</span></a>').join("")+'</div>':'<div class="op-empty">You have no friends to display yet.</div>';
  itemsHost.innerHTML=owned.length?'<div class="op-home-items">'+owned.slice(0,6).map(itemCard).join("")+'</div>':'<div class="op-empty">Your inventory is empty. <a href="#catalog" data-page="catalog">Visit the Catalog</a>.</div>';
 }catch(e){
  if(!isActiveView(view)||!friendsHost.isConnected||!itemsHost.isConnected)return;
  friendsHost.innerHTML='<div class="op-empty">Could not load friends.</div>';
  itemsHost.innerHTML='<div class="op-empty">Could not load inventory.</div>';
 }
}

function itemCard(x){return '<article class="item-card"><div class="item-image">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="'+esc(x.name)+'">':'◇')+'</div><h3>'+esc(x.name)+'</h3><div class="muted">'+esc(x.category)+'</div></article>'}
async function showItem(itemId,updateHistory=true){
 const view=beginView();
 const requestedUserId=me?.id||null;
 sidebar.classList.remove("mobile-open");
 renderSidebar("catalog");
 if(updateHistory)history.pushState({page:"item",itemId},"","#item?id="+encodeURIComponent(itemId||""));
 let item=items.find(x=>x.id===itemId);
 if(!item||(me&&!ownershipLoaded)){
  try{
   const [catalogData,inventoryData]=await Promise.all([
    item?Promise.resolve({items}):api("/api/catalog"),
    me?api("/api/inventory"):Promise.resolve({items:[]})
   ]);
   if(!isActiveView(view)||(me?.id||null)!==requestedUserId)return;
   if(!item){
    items=catalogData.items||[];
    item=items.find(x=>x.id===itemId);
   }
   ownedItemIds=new Set((inventoryData.items||[]).map(x=>x.id));
   ownershipLoaded=true;
   item=item||(inventoryData.items||[]).find(x=>x.id===itemId);
  }catch(error){
   if(isActiveView(view))app.innerHTML='<div class="empty">Could not verify item and inventory: '+esc(error.message)+'</div>';
   return;
  }
 }
 if(!isActiveView(view))return;
 if(!item){app.innerHTML='<div class="empty">Item not found. <a href="#catalog" data-page="catalog">Back to Catalog</a></div>';return}
 const isOwned=ownedItemIds.has(item.id);
 app.innerHTML='<div class="item-detail-page"><a class="item-back-link" href="#catalog" data-page="catalog">‹ Back to Catalog</a><div class="item-detail-card">'+
  '<div class="item-detail-image" id="itemDetailPreview">'+(item.image_url?'<img src="'+esc(item.image_url)+'" alt="'+esc(item.name)+'">':'<span>No preview available</span>')+'</div>'+
  '<div class="item-detail-info"><h1>'+esc(item.name)+'</h1><div class="muted">'+esc(item.category)+'</div><p>'+esc(item.description||"No description available.")+'</p><div class="item-detail-price">'+Number(item.price||0).toLocaleString()+' P$</div>'+(isOwned?'<button class="button secondary" id="detailBuy" type="button" disabled>Owned</button>':'<button class="primary" id="detailBuy" type="button">Buy</button>')+'</div>'+
  '</div></div>';
 document.getElementById("detailBuy").addEventListener("click",()=>buy(item.id));
}


async function catalog(){
 const view=beginView();
 const requestedUserId=me?.id||null;
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
      '<div class="catalog-results-header"><div><h2 id="catalogCategoryTitle">Featured Items on Pekora</h2><p id="catalogCount" class="muted"></p></div><label class="catalog-sort-label">Sort By: <select id="catalogSort" class="catalog-sort"><option value="relevance">Relevance</option><option value="newest">Recently added</option><option value="price-low">Price (Low to High)</option><option value="price-high">Price (High to Low)</option></select></label></div>'+
      '<div id="catalogGrid" class="item-grid">Loading catalog...</div>'+
     '</section>'+
    '</div>'+
   '</div>'+
  '</div>';
 try{
  const catalogData=await api("/api/catalog");
  if(!isActiveView(view)||(me?.id||null)!==requestedUserId)return;
  items=catalogData.items||[];
  ownedItemIds=new Set();
  ownershipLoaded=!me;
  if(me){
   try{
    const inventoryData=await api("/api/inventory");
    if(!isActiveView(view)||(me?.id||null)!==requestedUserId)return;
    ownedItemIds=new Set((inventoryData.items||[]).map(x=>x.id));
    ownershipLoaded=true;
   }catch(error){
    if(!isActiveView(view)||(me?.id||null)!==requestedUserId)return;
    ownershipLoaded=false;
    console.warn("[Pekora catalog] Inventory state unavailable:",error);
   }
  }
  drawCatalog("All","");
 }catch(e){
  const grid=document.getElementById("catalogGrid");
  if(isActiveView(view)&&grid)grid.textContent=e.message;
 }
 if(!isActiveView(view))return;
 const search=document.getElementById("itemSearch");
 const select=document.getElementById("itemCategorySelect");
 if(!search||!select||!document.getElementById("catalogSearchForm"))return;
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
 const el=document.getElementById("catalogGrid"),count=document.getElementById("catalogCount");
 if(!el||!count)return;
 let list=items.filter(x=>(category==="All"||x.category===category)&&((x.name||"")+" "+(x.description||"")).toLowerCase().includes(q.toLowerCase()));
 if(catalogSort==="newest")list.sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
 if(catalogSort==="price-low")list.sort((a,b)=>Number(a.price||0)-Number(b.price||0));
 if(catalogSort==="price-high")list.sort((a,b)=>Number(b.price||0)-Number(a.price||0));
 count.textContent=list.length+" items";
 el.innerHTML=list.length?list.map(x=>'<article class="item-card"><a class="item-image" href="#" data-item-view="'+esc(x.id)+'" aria-label="View '+esc(x.name)+'">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="'+esc(x.name)+'">':'◇')+'</a><h3>'+esc(x.name)+'</h3><div class="muted">'+esc(x.category)+'</div><div class="catalog-asset-kind">'+(x.asset_kind==="IMAGE_ONLY"?"Catalog item":"Original avatar service required")+'</div><div class="price">'+Number(x.price||0).toLocaleString()+' P$</div>'+(ownedItemIds.has(x.id)?'<button class="button secondary" type="button" disabled>Owned</button>':!ownershipLoaded?'<button class="button secondary" type="button" disabled>Checking inventory...</button>':'<button class="button" data-buy="'+esc(x.id)+'">Buy</button>')+'</article>').join(""):'<div class="empty">No items found.</div>';
 el.querySelectorAll("[data-buy]").forEach(b=>b.addEventListener("click",()=>buy(b.dataset.buy)));

}async function buy(itemId){
 if(!me){page("login");return}
 if(!ownershipLoaded){toast("Could not verify your inventory. Reload the Catalog and try again.");return}
 const view=activeView,userId=me.id;
 try{
  const d=await api("/api/purchase",{method:"POST",body:JSON.stringify({itemId})});
  if(!me||me.id!==userId)return;
  me.balance=d.balance;ownedItemIds.add(itemId);ownershipLoaded=true;setUser(me);toast("Item purchased");
  if(isActiveView(view)){
   const detailButton=document.getElementById("detailBuy");
   if(detailButton?.isConnected){detailButton.disabled=true;detailButton.textContent="Owned";detailButton.classList.add("button","secondary")}
   else catalog();
  }
 }catch(e){toast(e.message)}
}
function auth(kind){
 const view=beginView();
 renderSidebar("");
 const reg=kind==="register";
 app.innerHTML='<div class="form"><h2>'+(reg?"Create your Pekora account":"Log in to Pekora")+'</h2><form id="authForm"><label>Username</label><input name="username" required minlength="3" maxlength="20" autocomplete="username"><label>Password</label><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="'+(reg?"new-password":"current-password")+'"><button class="primary" type="submit">'+(reg?"Sign up":"Log in")+'</button><div id="authError" class="error"></div></form><p class="muted">'+(reg?'Already have an account? <a href="#login" data-page="login">Log in</a>':'New to Pekora? <a href="#register" data-page="register">Sign up</a>')+'</p>'+(reg?'':'<p class="muted"><a href="#owner-recovery" data-page="owner-recovery">Recover PekoraAdmin account</a></p>')+'</div>';
 document.getElementById("authForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.target);
  try{
   const d=await api(reg?"/api/register":"/api/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});
   setUser(d.user);
   if(isActiveView(view))page("home");
  }catch(err){
   const error=document.getElementById("authError");
   if(isActiveView(view)&&error)error.textContent=err.message;
  }
 });
}
async function ownerRecoveryPage(){
 const view=beginView();
 renderSidebar("");
 app.innerHTML='<div class="form"><h2>Recover Pekora OWNER account</h2><p class="muted">Use the Worker secret OWNER_BOOTSTRAP_SECRET from your Cloudflare settings. This resets the PekoraAdmin password and signs out previous sessions.</p><form id="ownerRecoveryForm"><label>Worker recovery secret<input name="secret" type="password" required autocomplete="off"></label><label>New password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><label>Confirm new password<input name="confirmPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><button class="primary" type="submit">Reset owner password</button><div id="ownerRecoveryMessage" class="error" role="status"></div></form><p class="muted"><a href="#login" data-page="login">Back to login</a></p></div>';
 document.getElementById("ownerRecoveryForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const form=e.currentTarget,values=new FormData(form),secret=String(values.get("secret")||""),password=String(values.get("password")||""),confirmPassword=String(values.get("confirmPassword")||""),message=document.getElementById("ownerRecoveryMessage");
  if(password!==confirmPassword){message.textContent="Passwords do not match.";return}
  message.textContent="Resetting password...";
  try{
   await api("/api/owner/recover",{method:"POST",body:JSON.stringify({secret,password})});
   if(me?.username?.toLowerCase()==="pekoraadmin")setUser(null);
   form.reset();
   message.textContent="Password reset. Sign in as PekoraAdmin using the new password.";
  }catch(error){message.textContent=error.message}
 });
}

async function logout(){try{await api("/api/logout",{method:"POST"});setUser(null);page("home")}catch(e){toast(e.message)}}
async function inventory(){
 const view=beginView();
 renderSidebar("inventory");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to view your inventory.</div>';return}
 app.innerHTML='<h1 class="page-title">Inventory</h1><div id="inventoryGrid" class="item-grid">Loading...</div>';
 const grid=document.getElementById("inventoryGrid");
 try{
  const d=await api("/api/inventory");
  if(!isActiveView(view)||!grid?.isConnected)return;
  grid.innerHTML=d.items.length?d.items.map(itemCard).join(""):'<div class="empty">Your inventory is empty. <a href="#catalog" data-page="catalog">Browse the Catalog</a>.</div>';
 }catch(e){if(isActiveView(view)&&grid?.isConnected)grid.textContent=e.message}
}
async function profile(username=me?.username){
 const view=beginView();
 renderSidebar("profile");
 if(!username){app.innerHTML='<div class="empty">Choose a user profile.</div>';return}
 app.innerHTML='<div class="empty">Loading profile...</div>';
 try{
  const [d,inventoryData]=await Promise.all([
   api("/api/profile/"+encodeURIComponent(username)),
   api("/api/profile/"+encodeURIComponent(username)+"/inventory")
  ]);
  if(!isActiveView(view))return;
  const p=d.profile,owned=inventoryData.items||[],isSelf=me&&me.username.toLowerCase()===p.username.toLowerCase();
  app.innerHTML='<div class="op-profile">'+
   '<div class="op-profile-header"><div class="op-profile-avatar">'+avatar(p.username)+'</div><div class="op-profile-info">'+
    '<h1>'+esc(p.username)+'</h1><div class="op-profile-meta">'+esc(p.role)+' · Joined '+new Date(p.createdAt).toLocaleDateString()+'</div>'+
    '<p>'+esc(p.description||"This user has not added a description.")+'</p>'+
    '<div class="op-profile-stats"><span><b>'+Number(p.itemCount||0).toLocaleString()+'</b> Items</span></div>'+
    (!isSelf&&me?'<div id="profileFriendAction" class="profile-friend-action">Loading...</div>':'')+
   '</div></div>'+
   '<section class="op-profile-section"><h2>Inventory</h2>'+
    (owned.length?'<div class="op-profile-items">'+owned.map(itemCard).join("")+'</div>':'<div class="op-profile-empty">This user has no items to display.</div>')+
   '</section></div>';
  if(!isSelf&&me)loadProfileFriendAction(p.username);
 }catch(e){if(isActiveView(view))app.innerHTML='<div class="empty">'+esc(e.message)+'</div>'}
}
async function loadProfileFriendAction(username){
 const view=activeView,host=document.getElementById("profileFriendAction");if(!host)return;
 try{
  const {status}=await api("/api/friends/status?username="+encodeURIComponent(username));
  if(!isActiveView(view)||!host.isConnected)return;
  const labels={none:"Add Friend",outgoing:"Cancel Request",incoming:"Accept Request",friends:"Remove Friend",self:"Your Profile"};
  host.innerHTML='<button type="button" class="button '+(status==="friends"?"secondary":"")+'" id="profileFriendBtn" '+(status==="self"?"disabled":"")+'>'+labels[status]+'</button>';
  document.getElementById("profileFriendBtn").addEventListener("click",async()=>{
   try{
    if(status==="none")await api("/api/friends/request",{method:"POST",body:JSON.stringify({username})});
    else if(status==="incoming")await api("/api/friends/accept",{method:"POST",body:JSON.stringify({username})});
    else if(status==="outgoing"||status==="friends")await api("/api/friends?username="+encodeURIComponent(username),{method:"DELETE"});
    if(isActiveView(view))await profile(username);
   }catch(e){toast(e.message)}
  });
 }catch(e){if(isActiveView(view)&&host.isConnected)host.textContent=e.message}
}

async function settings(){
 const view=beginView();
 renderSidebar("settings");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> first.</div>';return}
 const username=me.username;
 app.innerHTML='<div class="empty">Loading settings...</div>';
 let description="",loadError="";
 try{const d=await api("/api/profile/"+encodeURIComponent(username));description=d.profile.description||""}
 catch(error){loadError=error.message||"Could not load your profile description."}
 if(!isActiveView(view))return;
 app.innerHTML='<h1 class="page-title">Account Settings</h1><div class="form" style="max-width:600px;margin:0"><h2>Profile</h2><form id="settingsForm"><label>Username</label><input value="'+esc(username)+'" disabled><label>Profile description</label><textarea name="description" rows="5" maxlength="500" '+(loadError?'disabled':'')+'>'+esc(description)+'</textarea><button class="primary" type="submit" '+(loadError?'disabled':'')+'>Save changes</button><div id="settingsMessage" class="muted">'+esc(loadError)+'</div></form></div>';
 document.getElementById("settingsForm").addEventListener("submit",async e=>{
  e.preventDefault();const description=new FormData(e.target).get("description"),message=document.getElementById("settingsMessage");
  try{await api("/api/profile",{method:"PUT",body:JSON.stringify({description})});if(isActiveView(view)&&message?.isConnected)message.textContent="Profile saved."}
  catch(err){if(isActiveView(view)&&message?.isConnected)message.textContent=err.message}
 });
}
async function avatarPage(){
 const view=beginView();
 renderSidebar("avatar");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to view your avatar.</div>';return}
 app.innerHTML='<div class="avatar-editor"><div class="avatar-editor-heading"><h1 class="page-title">Avatar</h1><a class="button" href="#catalog" data-page="catalog">Catalog</a></div>'+
  '<div class="avatar-editor-layout"><section class="avatar-preview-panel"><h2>Avatar</h2><div class="avatar-original-thumbnail">'+avatar(me.username)+'</div>'+
  '<p class="muted">Original OpenPekora avatar rendering is not connected in this deployment.</p>'+
  '<p class="muted">The real avatar editor requires the Avatar API, Thumbnails API and RCC renderer. This page does not fake equipped items.</p></section>'+
  '<section class="avatar-wardrobe"><h2>Inventory</h2><div class="avatar-category-tabs" id="avatarCategories"></div><div id="avatarWardrobe" class="avatar-wardrobe-grid">Loading inventory...</div></section></div></div>';
 let wardrobe=[],activeCategory="Hats";
 try{const d=await api("/api/inventory");if(!isActiveView(view))return;wardrobe=d.items||[]}
 catch(e){const host=document.getElementById("avatarWardrobe");if(isActiveView(view)&&host)host.textContent=e.message;return}
 function renderWardrobe(){
  document.getElementById("avatarCategories").innerHTML=AVATAR_CATEGORIES.map(c=>'<button type="button" class="avatar-category '+(c===activeCategory?"active":"")+'" data-avatar-category="'+c+'">'+c+'</button>').join("");
  const own=wardrobe.filter(x=>x.category===activeCategory);
  document.getElementById("avatarWardrobe").innerHTML=own.length?own.map(x=>'<article class="avatar-wardrobe-item">'+
   '<div class="avatar-wardrobe-image">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="'+esc(x.name)+'" loading="lazy">':'<span>'+esc(x.category)+'</span>')+'</div>'+
   '<div class="avatar-wardrobe-name">'+esc(x.name)+'</div>'+
   '<span class="avatar-preview-only-label">Inventory item — avatar service unavailable</span>'+
   '</article>').join(""):'<div class="avatar-wardrobe-empty">No '+esc(activeCategory.toLowerCase())+' in your inventory.</div>';
  document.querySelectorAll("[data-avatar-category]").forEach(b=>b.addEventListener("click",()=>{activeCategory=b.dataset.avatarCategory;renderWardrobe()}));
 }
 renderWardrobe();
}
async function friends(){
 const view=beginView();
 renderSidebar("friends");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to view friends.</div>';return}
 app.innerHTML='<h1 class="page-title">Friends</h1><form id="addFriendForm" class="people-search"><input class="search-input" name="username" placeholder="Username" minlength="3" maxlength="20" required><button class="button" type="submit">Add Friend</button></form><div id="friendsMessage" class="muted"></div><div id="friendsContent">Loading...</div>';
 document.getElementById("addFriendForm").addEventListener("submit",async e=>{
  e.preventDefault();const username=new FormData(e.target).get("username").trim();
  try{
   const result=await api("/api/friends/request",{method:"POST",body:JSON.stringify({username})});
   if(!isActiveView(view))return;
   document.getElementById("friendsMessage").textContent=result.status==="friends"?"You are now friends.":"Friend request sent.";
   e.target.reset();loadFriendsList(view);
  }catch(err){const message=document.getElementById("friendsMessage");if(isActiveView(view)&&message)message.textContent=err.message}
 });
 await loadFriendsList(view);
}
async function loadFriendsList(view=activeView){
 const host=document.getElementById("friendsContent");if(!host)return;
 try{
  const d=await api("/api/friends");
  if(!isActiveView(view)||!host.isConnected)return;
  const section=(title,list,kind)=>'<section class="friends-section"><h2>'+title+' ('+list.length+')</h2>'+(list.length?list.map(u=>'<article class="people-user"><div class="people-user-info"><strong>'+esc(u.username)+'</strong><span>'+esc(u.role||"USER")+'</span></div><button class="button" type="button" data-friend-action="'+kind+'" data-friend-name="'+esc(u.username)+'">'+(kind==="accept"?"Accept":title==="Sent Requests"?"Cancel":"Remove")+'</button></article>').join(""):'<div class="op-profile-empty">Nothing here yet.</div>')+'</section>';
  host.innerHTML=section("Friend Requests",d.incoming||[],"accept")+section("Friends",d.friends||[],"remove")+section("Sent Requests",d.outgoing||[],"remove");
  host.querySelectorAll("[data-friend-action]").forEach(b=>b.addEventListener("click",async()=>{
   const username=b.dataset.friendName;
   try{
    if(b.dataset.friendAction==="accept")await api("/api/friends/accept",{method:"POST",body:JSON.stringify({username})});
    else await api("/api/friends?username="+encodeURIComponent(username),{method:"DELETE"});
    if(isActiveView(view))await loadFriendsList(view);
   }catch(e){toast(e.message)}
  }));
 }catch(e){if(isActiveView(view)&&host.isConnected)host.textContent=e.message}
}
function users(){
 const view=beginView();
 renderSidebar("users");
 app.innerHTML='<h1 class="page-title">People</h1><p class="page-subtitle">Search the Pekora community and open user profiles.</p><form id="peopleSearchForm" class="people-search"><input id="userSearch" class="search-input" placeholder="Enter a username..." minlength="2" maxlength="20" autocomplete="off"><button class="button" type="submit">Search</button></form><div id="peopleHint" class="notice">Type at least 2 characters to find users. Search results will appear below.</div><div id="userResults" class="people-results"></div>';
 const form=document.getElementById("peopleSearchForm");
 const input=document.getElementById("userSearch");
 const results=document.getElementById("userResults");
 const hint=document.getElementById("peopleHint");
 let latest=0;
 async function runSearch(){
  const requestId=++latest;
  const q=input.value.trim();
  if(q.length<2){results.innerHTML="";hint.textContent="Type at least 2 characters to find users. Search results will appear below.";hint.style.display="block";return}
  hint.textContent="Searching Pekora users...";
  hint.style.display="block";
  try{
   const d=await api("/api/search-users?q="+encodeURIComponent(q));
   if(requestId!==latest||!isActiveView(view))return;
   const found=Array.isArray(d.users)?d.users:[];
   hint.style.display="none";
   results.innerHTML=found.length?found.map(u=>'<article class="people-user"><div class="people-avatar">'+avatar(u.username)+'</div><div class="people-user-info"><strong>'+esc(u.username)+'</strong><span>'+esc(u.role||"USER")+'</span></div><button class="button" type="button" data-profile="'+esc(u.username)+'">View Profile</button></article>').join(""):'<div class="empty">No users found for “'+esc(q)+'”.</div>';
  }catch(e){if(requestId!==latest||!isActiveView(view))return;hint.textContent="Could not load users: "+e.message;hint.style.display="block";results.innerHTML=""}
 }
 form.addEventListener("submit",e=>{
  e.preventDefault();
  const q=input.value.trim().slice(0,20);
  history.replaceState({page:"users",query:q},"","#users?q="+encodeURIComponent(q));
  runSearch();
 });
 input.addEventListener("input",()=>{
  latest++;
  results.innerHTML="";
  hint.textContent=input.value.trim().length<2
   ?"Type at least 2 characters to find users. Search results will appear below."
   :"Press Search to find matching Pekora users.";
  hint.style.display="block";
 });
 if(location.hash.startsWith("#users?")){
  input.value=new URLSearchParams(location.hash.split("?")[1]).get("q")||"";
  if(input.value.length>=2)runSearch();
 }
}
async function owner(){
 const view=beginView();
 renderSidebar("owner");
 if(!me||me.role!=="OWNER"){app.innerHTML='<div class="empty">Owner access required.</div>';return}
 app.innerHTML='<h1 class="page-title">Owner Panel</h1><div id="ownerStats" class="item-grid">Loading...</div>'+
 '<section class="owner-section"><h2>Owner Account</h2><p class="muted">The current password cannot be displayed because Pekora stores only a password hash. While signed in as OWNER, set a new password here.</p><form id="ownerPasswordForm" class="owner-item-form"><label>New password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label>Confirm password<input name="confirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><button class="primary" type="submit">Set new owner password</button><span id="ownerPasswordMessage" class="muted"></span></form></section>'+
 '<section class="owner-section"><h2>Catalog Management</h2><p class="muted">Remove every item from the public catalog. Existing owners keep their inventory.</p><p class="muted">This deployment currently supports local catalog entries with an image preview. The original Pekora asset catalogue and Avatar API are not connected, so these entries are not wearable.</p><button class="button secondary" id="clearPublicCatalog" type="button">Remove all items from catalog</button><form id="newItemForm" class="owner-item-form">'+
 '<label>Item name<input name="name" maxlength="80" required></label>'+
 '<label>Category<select name="category">'+AVATAR_CATEGORIES.map(c=>'<option>'+c+'</option>').join("")+'</select></label>'+
 '<label>Price (P$)<input name="price" type="number" min="0" max="1000000" value="50" required></label>'+
 '<label>Preview image URL<input name="image_url" type="url" placeholder="https://..."></label>'+
 
 '<label class="owner-description">Description<textarea name="description" maxlength="500" rows="2"></textarea></label>'+
 '<button class="primary" type="submit">Add Item</button><span id="ownerFormMessage" class="muted"></span></form>'+
 '<div id="ownerItems" class="owner-items">Loading items...</div></section>';
 document.getElementById("ownerPasswordForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const form=e.currentTarget,values=new FormData(form),password=String(values.get("password")||""),confirmPassword=String(values.get("confirmPassword")||""),message=document.getElementById("ownerPasswordMessage");
  if(password!==confirmPassword){message.textContent="Passwords do not match.";return}
  message.textContent="Updating password...";
  try{
   await api("/api/owner/password",{method:"POST",body:JSON.stringify({password})});
   if(!isActiveView(view))return;
   form.reset();message.textContent="Owner password changed. Save the new password somewhere safe.";
  }catch(error){message.textContent=error.message}
 });
 try{
  const [stats,data]=await Promise.all([api("/api/owner/stats"),api("/api/owner/items")]);
  if(!isActiveView(view))return;
  document.getElementById("ownerStats").innerHTML='<div class="info-panel"><h3>Users</h3><b>'+stats.users+'</b></div><div class="info-panel"><h3>Catalog Items</h3><b>'+stats.items+'</b></div><div class="info-panel"><h3>Purchases</h3><b>'+stats.purchases+'</b></div>';
  let ownerItems=data.items||[];
  function updateOwnerItemCount(){
   const count=document.querySelectorAll("#ownerStats .info-panel")[1]?.querySelector("b");
   if(count)count.textContent=ownerItems.filter(item=>Number(item.is_for_sale)===1).length;
  }
  document.getElementById("clearPublicCatalog").addEventListener("click",async()=>{
   if(!confirm("Remove ALL items from the public catalog? Existing user inventories and balances will not be changed."))return;
   const button=document.getElementById("clearPublicCatalog");button.disabled=true;button.textContent="Removing...";
   try{
    const result=await api("/api/owner/items",{method:"DELETE"});
    if(!isActiveView(view))return;
    ownerItems=ownerItems.map(item=>({...item,is_for_sale:0}));
    drawOwnerItems();updateOwnerItemCount();
    toast(result.hidden+" items removed from the public catalog");
   }catch(e){toast(e.message)}
   finally{button.disabled=false;button.textContent="Remove all items from catalog"}
  });
  function drawOwnerItems(){
   document.getElementById("ownerItems").innerHTML=ownerItems.length?ownerItems.map(x=>'<form class="owner-item-row" data-edit-item="'+esc(x.id)+'">'+
    '<div class="owner-item-thumb">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="">':'◇')+'</div>'+
    '<div class="owner-item-fields"><input name="name" value="'+esc(x.name)+'" maxlength="80" required>'+
    '<div class="owner-item-subfields"><select name="category">'+AVATAR_CATEGORIES.map(c=>'<option value="'+c+'" '+(c===x.category?'selected':'')+'>'+c+'</option>').join("")+'</select><input name="price" type="number" min="0" max="1000000" value="'+Number(x.price)+'" required><input name="image_url" type="url" value="'+esc(x.image_url||"")+'" placeholder="Preview image URL"></div>'+
    
    '<textarea name="description" rows="2" maxlength="500">'+esc(x.description||"")+'</textarea><span class="muted">'+(x.is_for_sale?'For sale':'Removed from catalog')+'</span></div>'+
    '<div class="owner-item-actions"><button class="button" type="submit">Save</button>'+(x.is_for_sale?'<button class="button secondary" type="button" data-remove-item="'+esc(x.id)+'">Remove</button>':'<button class="button" type="button" data-restore-item="'+esc(x.id)+'">Restore</button>')+'</div></form>').join(""):'<div class="empty">No catalog items yet.</div>';
   document.querySelectorAll("[data-edit-item]").forEach(form=>form.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(form),id=form.dataset.editItem;
    try{
     const updated={name:String(f.get("name")).trim(),category:String(f.get("category")),price:Number(f.get("price")),image_url:String(f.get("image_url")||""),description:String(f.get("description")||"")};
     await api("/api/owner/items/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({...updated,asset_kind:"IMAGE_ONLY",model_url:""})});
     if(!isActiveView(view))return;
     ownerItems=ownerItems.map(item=>item.id===id?{...item,...updated}:item);
     drawOwnerItems();updateOwnerItemCount();toast("Item saved");
    }catch(err){toast(err.message)}
   }));
   document.querySelectorAll("[data-restore-item]").forEach(button=>button.addEventListener("click",async()=>{
    try{
     const id=button.dataset.restoreItem;
     await api("/api/owner/items/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({is_for_sale:true})});
     if(!isActiveView(view))return;
     ownerItems=ownerItems.map(item=>item.id===id?{...item,is_for_sale:1}:item);
     drawOwnerItems();updateOwnerItemCount();toast("Item restored");
    }catch(e){toast(e.message)}
   }));
   document.querySelectorAll("[data-remove-item]").forEach(button=>button.addEventListener("click",async()=>{
    if(!confirm("Remove this item from the public catalog? Existing owners will keep it."))return;
    try{
     const id=button.dataset.removeItem;
     await api("/api/owner/items/"+encodeURIComponent(id),{method:"DELETE"});
     if(!isActiveView(view))return;
     ownerItems=ownerItems.map(item=>item.id===id?{...item,is_for_sale:0}:item);
     drawOwnerItems();updateOwnerItemCount();toast("Item removed from catalog");
    }catch(e){toast(e.message)}
   }));
  }
  drawOwnerItems();
  const newItemForm=document.getElementById("newItemForm");
  if(!newItemForm)return;
  newItemForm.addEventListener("submit",async e=>{
   e.preventDefault();const f=new FormData(e.target),msg=document.getElementById("ownerFormMessage");msg.textContent="Saving...";
   try{
    const data={name:String(f.get("name")).trim(),category:String(f.get("category")),price:Number(f.get("price")),image_url:String(f.get("image_url")||""),description:String(f.get("description")||"")};
    const result=await api("/api/owner/items",{method:"POST",body:JSON.stringify({...data,asset_kind:"IMAGE_ONLY",model_url:""})});
    if(!isActiveView(view))return;
    e.target.reset();e.target.elements.price.value=50;msg.textContent="Item added.";
    ownerItems.unshift({id:result.id,...data,is_for_sale:1,created_at:new Date().toISOString(),asset_kind:"IMAGE_ONLY"});
    drawOwnerItems();updateOwnerItemCount();
   }catch(err){msg.textContent=err.message}
  });
 }catch(e){const host=document.getElementById("ownerItems");if(isActiveView(view)&&host)host.textContent=e.message}
}

function infoPage(type){
 beginView();
 renderSidebar("");
 const pages={
  about:{title:"About Pekora",body:'<p>Pekora is an independent community revival project. It is not affiliated with or endorsed by Roblox Corporation.</p><p>This build includes account profiles, a virtual catalog, inventory previews and friend requests. Original avatar editing is not connected in this deployment.</p><p>Pekora currency is an in-site balance only. It has no real-world monetary value.</p>'},
  terms:{title:"Terms of Use",body:'<p>Use Pekora respectfully and do not impersonate other users, abuse the service or attempt to access accounts that are not yours.</p><p>Do not upload images or descriptions that violate the rights or safety of other people. The project owner may remove catalog entries or accounts that abuse the service.</p><p>Virtual currency and catalog items are for use inside this website only. They cannot be exchanged for real money.</p>'},
  privacy:{title:"Privacy",body:'<p>Pekora stores your username, a password hash, session information, profile description, virtual balance, inventory and friend requests so the service can work.</p><p>Passwords are not stored as plain text. Sign-in uses a secure session cookie. This build does not ask for an email address.</p><p>Do not reuse an important password and do not share your account credentials with anyone.</p>'}
 };
 const pageData=pages[type]||pages.about;
 app.innerHTML='<article class="info-page"><h1 class="page-title">'+pageData.title+'</h1>'+pageData.body+'<a class="button" href="#home" data-page="home">Back to Home</a></article>';
}
async function render(name){
 name=name||"home";
 const parts=String(name).split("?",2);
 name=parts[0];
 const query=new URLSearchParams(parts[1]||"");
 if(name==="home")home();
 else if(name==="catalog")await catalog();
 else if(name==="login"||name==="register")auth(name);
 else if(name==="owner-recovery")await ownerRecoveryPage();
 else if(name==="inventory")await inventory();
 else if(name==="profile")await profile(query.get("username")||me?.username);
 else if(name==="item")await showItem(query.get("id"),false);
 else if(name==="avatar")await avatarPage();
 else if(name==="users"||name==="community")users();
 else if(name==="friends")await friends();
 else if(name==="about"||name==="terms"||name==="privacy")infoPage(name);
 else if(name==="settings")await settings();
 else if(name==="owner")await owner();
 else home();
}
(async()=>{await refreshMe();await render(location.hash.slice(1)||"home")})();
