const app=document.getElementById("app");
const accountArea=document.getElementById("accountArea");
const currency=document.getElementById("currency");
const sidebar=document.getElementById("sidebar");
let me=null,items=[];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,options={}){const res=await fetch(path,{credentials:"same-origin",...options,headers:{"content-type":"application/json",...(options.headers||{})}});let data={};try{data=await res.json()}catch{}if(!res.ok)throw new Error(data.error||"Something went wrong");return data}
function toast(message){const el=document.getElementById("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600)}
function avatar(username=me?.username){const src=String(username||"").toLowerCase()==="koqumo"?"https://tcdn.pekora.pro/images/thumbnails/152d7862464483e0c3989bc1cee7a9d1a954964b95a49f6687945d2c070cb25e_headshot.png":"https://raw.githubusercontent.com/Blue7366/OpenPekora/main/frontend/public/img/generic.svg";return '<img class="avatar-render" src="'+src+'" alt="User avatar" loading="lazy">' }

function renderSidebar(active="home"){
 if(!me){sidebar.classList.remove("visible","mobile-open");sidebar.innerHTML="";return}
 sidebar.classList.add("visible");
 const links=[
  ["home","icon-nav-home","Home"],["profile","icon-nav-profile","Profile"],["messages","icon-nav-message","Messages"],
  ["friends","icon-nav-friends","Friends"],["avatar","icon-nav-charactercustomizer","Avatar"],["inventory","icon-nav-inventory","Inventory"],
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
document.addEventListener("click",e=>{const a=e.target.closest("[data-page]");if(a){e.preventDefault();page(a.dataset.page)}const p=e.target.closest("[data-profile]");if(p){e.preventDefault();profile(p.dataset.profile)}});
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
  '<div class="op-home-header"><a class="op-headshot" href="#profile" data-page="profile">'+avatar()+'</a><h1><a href="#profile" data-page="profile">Hello, '+name+'!</a></h1></div>'+
  '<section class="op-dashboard-section"><div class="op-section-heading"><h3>Friends (0)</h3><a href="#friends" data-page="friends">See All</a></div><div class="op-section-content"><ul class="op-friends-list"></ul><div class="op-empty">You have no friends to display yet.</div></div></section>'+
  '<section class="op-dashboard-section"><div class="op-section-heading"><h3>Recently Played</h3></div><div class="op-section-content op-empty">No games found.</div></section>'+
  '<section class="op-dashboard-section"><div class="op-section-heading"><h3>My Favorites</h3></div><div class="op-section-content op-empty">No games found.</div></section>'+
  '</div>';
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
      '<div class="catalog-results-header"><div><h2 id="catalogCategoryTitle">Featured Items on Pekora</h2><p id="catalogCount" class="muted"></p></div></div>'+
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
 select.addEventListener("change",()=>chooseCategory(select.value));
 document.querySelectorAll("[data-category]").forEach(a=>a.addEventListener("click",e=>{
  e.preventDefault();
  chooseCategory(a.dataset.category);
 }));
}
function drawCatalog(category,q){
 const el=document.getElementById("catalogGrid");if(!el)return;
 const list=items.filter(x=>(category==="All"||x.category===category)&&((x.name||"")+" "+(x.description||"")).toLowerCase().includes(q.toLowerCase()));
 document.getElementById("catalogCount").textContent=list.length+" items";
 el.innerHTML=list.length?list.map(x=>'<article class="item-card"><a class="item-image" href="#" aria-label="'+esc(x.name)+'">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="'+esc(x.name)+'">':'◇')+'</a><h3>'+esc(x.name)+'</h3><div class="muted">'+esc(x.category)+'</div><div class="price">'+Number(x.price||0).toLocaleString()+' P$</div><button class="button" data-buy="'+esc(x.id)+'">Buy</button></article>').join(""):'<div class="empty">No items found.</div>';
 el.querySelectorAll("[data-buy]").forEach(b=>b.addEventListener("click",()=>buy(b.dataset.buy)));
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
  const d=await api("/api/profile/"+encodeURIComponent(username));const p=d.profile;
  app.innerHTML='<div class="profile-header"><div class="home-avatar">'+avatar()+'</div><div><h1>'+esc(p.username)+'</h1><div class="muted">'+esc(p.role)+' · Joined '+new Date(p.createdAt).toLocaleDateString()+'</div><p>'+esc(p.description||"This user has not added a description.")+'</p><div class="profile-stats"><span>'+Number(p.itemCount||0)+' items</span><span>'+Number(p.balance||0).toLocaleString()+' P$</span></div></div></div><section class="content-section"><div class="section-heading"><h2>Inventory</h2></div><div class="section-box muted-box">Public inventory preview is being prepared.</div></section>';
 }catch(e){app.innerHTML='<div class="empty">'+esc(e.message)+'</div>'}
}
async function settings(){
 renderSidebar("settings");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> first.</div>';return}
 let description="";
 try{const d=await api("/api/profile/"+encodeURIComponent(me.username));description=d.profile.description||""}catch{}
 app.innerHTML='<h1 class="page-title">Account Settings</h1><div class="form" style="max-width:600px;margin:0"><h2>Profile</h2><form id="settingsForm"><label>Username</label><input value="'+esc(me.username)+'" disabled><label>Profile description</label><textarea name="description" rows="5" maxlength="500">'+esc(description)+'</textarea><button class="primary" type="submit">Save changes</button><div id="settingsMessage" class="muted"></div></form></div>';
 document.getElementById("settingsForm").addEventListener("submit",async e=>{e.preventDefault();const description=new FormData(e.target).get("description");try{await api("/api/profile",{method:"PUT",body:JSON.stringify({description})});document.getElementById("settingsMessage").textContent="Profile saved."}catch(err){document.getElementById("settingsMessage").textContent=err.message}});
}
function avatarPage(){renderSidebar("avatar");app.innerHTML='<h1 class="page-title">Avatar</h1><div class="section-box" style="text-align:center"><div class="home-avatar" style="margin:0 auto 14px">'+avatar()+'</div><h2>Avatar Editor</h2><p class="muted">R6 and R15 avatar editing is not connected yet.</p><a class="button" href="#inventory" data-page="inventory">Open Inventory</a></div>'}
function comingSoon(name){renderSidebar(name.toLowerCase());app.innerHTML='<h1 class="page-title">'+esc(name)+'</h1><div class="section-box muted-box">'+esc(name)+' features are not available yet.</div>'}
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
   results.innerHTML=found.length?found.map(u=>'<article class="people-user"><div class="people-avatar">'+avatar()+'</div><div class="people-user-info"><strong>'+esc(u.username)+'</strong><span>'+esc(u.role||"USER")+'</span></div><button class="button" type="button" data-profile="'+esc(u.username)+'">View Profile</button></article>').join(""):'<div class="empty">No users found for “'+esc(q)+'”.</div>';
  }catch(e){if(requestId!==latest)return;hint.textContent="Could not load users: "+e.message;hint.style.display="block";results.innerHTML=""}
 }
 form.addEventListener("submit",e=>{e.preventDefault();runSearch()});
 input.addEventListener("input",()=>{if(input.value.trim().length===0){latest++;results.innerHTML="";hint.textContent="Type at least 2 characters to find users. Search results will appear below.";hint.style.display="block"}});
 if(location.hash.startsWith("#users?")){input.value=new URLSearchParams(location.hash.split("?")[1]).get("q")||"";if(input.value.length>=2)runSearch()}
}
async function owner(){
 renderSidebar("owner");
 if(!me||me.role!=="OWNER"){app.innerHTML='<div class="empty">Owner access required.</div>';return}
 app.innerHTML='<h1 class="page-title">Owner Panel</h1><div id="ownerStats" class="item-grid">Loading...</div><div class="notice">PekoraAdmin is the project owner. Additional management tools are being developed.</div>';
 try{const d=await api("/api/owner/stats");document.getElementById("ownerStats").innerHTML='<div class="info-panel"><h3>Users</h3><b>'+d.users+'</b></div><div class="info-panel"><h3>Catalog Items</h3><b>'+d.items+'</b></div><div class="info-panel"><h3>Purchases</h3><b>'+d.purchases+'</b></div>'}catch(e){document.getElementById("ownerStats").textContent=e.message}
}
async function render(name){
 name=name||"home";
 if(name==="home")home();
 else if(name==="catalog")await catalog();
 else if(name==="login"||name==="register")auth(name);
 else if(name==="inventory")await inventory();
 else if(name==="profile")await profile();
 else if(name==="avatar")avatarPage();
 else if(name==="users")users();
 else if(name==="games")comingSoon("Games");
 else if(name==="friends")comingSoon("Friends");
 else if(name==="messages")comingSoon("Messages");
 else if(name==="groups")comingSoon("Groups");
 else if(name==="forums")comingSoon("Forums");
 else if(name==="donate")comingSoon("Donate");
 else if(name==="upgrade")comingSoon("Upgrade");
 else if(name==="community")comingSoon("Community");
 else if(name==="develop"||name==="download")comingSoon(name==="develop"?"Create":"Download");
 else if(name==="trades")comingSoon("Trades");
 else if(name==="settings")await settings();
 else if(name==="owner")await owner();
 else home();
}
(async()=>{await refreshMe();await render(location.hash.slice(1)||"home")})();
