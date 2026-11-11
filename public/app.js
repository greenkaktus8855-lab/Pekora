const app=document.getElementById("app");
const accountArea=document.getElementById("accountArea");
const currency=document.getElementById("currency");
const sidebar=document.getElementById("sidebar");
let me=null,items=[],catalogSort="newest",ownedItemIds=new Set(),ownedItemCounts=new Map(),ownershipLoaded=true,ownershipUserId=null,pendingPurchases=new Set(),detectedBannedAccount=null,friendRequestCount=0;
function setOwnedInventory(list){ownedItemCounts=new Map((list||[]).map(item=>[item.id,Number(item.quantity||1)]));ownedItemIds=new Set([...ownedItemCounts.entries()].filter(([,quantity])=>quantity>0).map(([id])=>id));}
function ownedItemCount(itemId){return Number(ownedItemCounts.get(itemId)||0);}
function canBuyItem(item){const count=ownedItemCount(item.id);return Number(item.is_limited)===1?count<10:count===0;}
let activeView=0;
const ITEM_CATEGORIES=["Hats","Hair","Faces","Shirts","Pants","Accessories"];
const CREATABLE_CATEGORIES=["Shirts","Pants"];
const MEMBERSHIP_PLANS=[
 {type:"None",name:"None",short:"None",daily:0,description:"No membership or daily reward"},
 {type:"BuildersClub",name:"Builders Club",short:"BC",daily:15,description:"Basic membership and daily reward"},
 {type:"TurboBuildersClub",name:"Turbo Builders Club",short:"TBC",daily:35,description:"Higher daily reward"},
 {type:"OutrageousBuildersClub",name:"Outrageous Builders Club",short:"OBC",daily:85,description:"Highest daily reward"},
 {type:"Premium",name:"Premium",short:"Premium",daily:85,description:"Premium-level daily reward"}
];
const beginView=()=>++activeView;
const isActiveView=view=>view===activeView;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function currencyIconMarkup(currencyCode){
 return currencyCode==="Tix"
  ? '<span class="icon-tix-16x16 currency-icon-original" aria-hidden="true"></span>'
  : '<span class="icon-robux-16x16 currency-icon-original" aria-hidden="true"></span>';
}
function currencyMarkup(amount,currencyCode="P$",extraClass=""){
 const code=currencyCode==="Tix"?"Tix":"P$";
 const value=Number(amount||0).toLocaleString();
 return '<span class="currency-inline '+esc(extraClass)+'" aria-label="'+esc(code)+' '+value+'">'+currencyIconMarkup(code)+'<b>'+value+'</b></span>';
}
function profileBadgesMarkup(profileData){
 const badges=[];
 const assigned=new Set(Array.isArray(profileData?.badges)?profileData.badges:[]);
 const definitions={
  ADMINISTRATOR:["Administrator",'<span class="profile-badge-icon icon-administrator-small" role="img" aria-label="Administrator"></span>'],
  ASSET_MODERATOR:["Asset Moderator",'<span class="profile-badge-symbol asset-moderator-symbol" aria-hidden="true">AM</span>'],
  EARLY_SUPPORTER:["Early Supporter",'<span class="profile-badge-symbol early-supporter-symbol" aria-hidden="true">★</span>'],
  CONTRIBUTOR:["Contributor",'<span class="profile-badge-symbol contributor-symbol" aria-hidden="true">C</span>'],
  CREATOR:["Creator",'<span class="profile-badge-symbol creator-symbol" aria-hidden="true">✦</span>'],
  COMMUNITY_HELPER:["Community Helper",'<span class="profile-badge-symbol helper-symbol" aria-hidden="true">H</span>']
 };
 for(const [key,value] of Object.entries(definitions)){
  if(assigned.has(key))badges.push('<article class="profile-badge-card">'+value[1]+'<span class="profile-badge-name">'+value[0]+'</span></article>');
 }
 if(profileData?.isVerified)badges.push('<article class="profile-badge-card"><img class="profile-badge-verified" src="/verified.svg" alt="Verified"><span class="profile-badge-name">Verified</span></article>');
 return badges.length?'<div class="profile-badges-grid">'+badges.join("")+'</div>':'<div class="op-profile-empty">This user has no badges yet.</div>';
}
async function api(path,options={}){
 const res=await fetch(path,{credentials:"same-origin",...options,headers:{"content-type":"application/json",...(options.headers||{})}});
 let data={};try{data=await res.json()}catch{}
 if(!res.ok){
  if(res.status===401&&me&&!["/api/login","/api/register"].includes(path)){
   let banNotice=null;
   try{
    const noticeResponse=await fetch("/api/me",{credentials:"same-origin"});
    const noticeState=await noticeResponse.json();
    banNotice=noticeState.bannedAccount||null;
   }catch{}
   if(banNotice){
    detectedBannedAccount=banNotice;
    setUser(null);
    history.replaceState({page:"banned",username:banNotice.username},"","/#banned?username="+encodeURIComponent(banNotice.username));
    await render("banned?username="+encodeURIComponent(banNotice.username));
   }else{
    setUser(null);
    page("login");
   }
  }
  throw new Error(data.error||"Something went wrong");
 }
 return data;
}
function toast(message){const el=document.getElementById("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600)}
async function copyToClipboard(value,successMessage="Copied"){
 const textValue=String(value??"");
 try{
  if(navigator.clipboard&&window.isSecureContext){
   await navigator.clipboard.writeText(textValue);
  }else{
   const field=document.createElement("textarea");
   field.value=textValue;
   field.setAttribute("readonly","");
   field.style.position="fixed";
   field.style.left="-9999px";
   document.body.appendChild(field);
   field.select();
   const copied=document.execCommand("copy");
   field.remove();
   if(!copied)throw new Error("Clipboard unavailable");
  }
  toast(successMessage);
  return true;
 }catch{
  toast("Could not copy. Check browser clipboard permissions.");
  return false;
 }
}
function avatar(username=me?.username){
 const label=String(username||"?").trim()||"?";
 const initials=label.split(/[ _-]+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase()||"?";
 return '<span class="avatar-initials" role="img" aria-label="'+esc(label)+'">'+esc(initials)+'</span>';
}
function renderSidebar(active="home"){
 if(!me){sidebar.classList.remove("visible","mobile-open");sidebar.innerHTML="";return}
 sidebar.classList.add("visible");
 const links=[
  ["home","icon-nav-home","Home"],
  ["profile","icon-nav-profile","Profile"],
  ["friends","icon-nav-friends","Friends"],
  ["trades","icon-nav-trade","Trades"],
  ["inventory","icon-nav-inventory","Inventory"],
  ["resale","icon-nav-trade","Resale Market"],
  ["groups","icon-nav-group","Groups"],
  ["currency","icon-nav-robux","Currency"],
  ["membership","icon-bc","Membership"],
  ["settings","icon-nav-settings","Settings"]
 ];
 sidebar.innerHTML='<div class="sidebar-card">'+
  '<a class="side-user" href="/#profile?id='+encodeURIComponent(me.publicId||"")+'" data-page="profile"><span class="side-avatar">'+avatar()+'</span><span><span class="side-username">'+esc(me.username)+(me.isVerified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</span><span class="side-role">Account</span></span></a>'+
  '<nav class="side-nav">'+links.map(([id,ico,label])=>'<a href="/#'+id+'" data-page="'+id+'" class="'+(active===id?'active':'')+'"><span class="side-icon '+ico+'"></span><span>'+label+'</span>'+(id==="friends"?'<span class="side-nav-count" id="friendRequestBadge" hidden></span>':'')+'</a>').join("")+
  '<div class="side-separator"></div>'+
  '<a href="/#promocodes" data-page="promocodes" class="side-promo-button '+(active==="promocodes"?"active":"")+'">Promo Codes</a>'+
  '<a class="side-discord-button" href="https://discord.gg/PxVWav9R2R" target="_blank" rel="noopener noreferrer">Discord Server</a>'+
  (me.isAdministrator?'<a href="/#admin-panel" data-page="admin-panel" class="'+(active==="admin-panel"?"active":"")+'"><span class="side-icon icon-nav-settings"></span><span>Admin Panel</span></a>':'')+
   (me.role==="OWNER"?'<a href="/#owner" data-page="owner" class="'+(active==="owner"?"active":"")+'"><span class="side-icon icon-nav-settings"></span><span>Owner Panel</span></a>':(me.isAssetModerator?'<a href="/#asset-panel" data-page="asset-panel" class="'+(active==="asset-panel"?"active":"")+'"><span class="side-icon icon-nav-inventory"></span><span>Asset Panel</span></a>':''))+
  '</nav></div>';
 refreshFriendRequestCount();
}

function setFriendRequestCount(count){
 friendRequestCount=Math.max(0,Math.floor(Number(count)||0));
 const badge=document.getElementById("friendRequestBadge");
 if(!badge)return;
 badge.textContent=friendRequestCount>99?"99+":String(friendRequestCount);
 badge.hidden=friendRequestCount===0;
 if(friendRequestCount>0)badge.setAttribute("aria-label",friendRequestCount+" pending friend requests");
 else badge.removeAttribute("aria-label");
}
async function refreshFriendRequestCount(){
 if(!me){setFriendRequestCount(0);return}
 try{
  const data=await api("/api/friends");
  setFriendRequestCount(Array.isArray(data.incoming)?data.incoming.length:0);
 }catch{}
}

function setUser(user){
 const nextUserId=user?.id||null;
 if(nextUserId!==ownershipUserId){
  ownershipUserId=nextUserId;
  ownedItemIds=new Set();ownedItemCounts=new Map();
  ownershipLoaded=!user;
 }
 me=user;
 accountArea.innerHTML=user
  ? '<a class="account-name" href="/#profile?id='+encodeURIComponent(user.publicId||"")+'" data-page="profile">'+esc(user.username)+(user.isVerified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</a><button id="logoutBtn" type="button">Log out</button>'
  : '<button id="loginBtn" type="button">Login</button><button id="registerBtn" type="button">Sign Up</button>';
 currency.innerHTML=user?'<span class="header-wallets">'+currencyMarkup(user.balance,"P$","wallet-chip")+currencyMarkup(user.tixBalance,"Tix","wallet-chip")+'</span>':"";
 document.getElementById("logoutBtn")?.addEventListener("click",logout);
 document.getElementById("loginBtn")?.addEventListener("click",()=>page("login"));
 document.getElementById("registerBtn")?.addEventListener("click",()=>page("register"));
 const currentPage=(location.hash.slice(1).split("?")[0]||"home");
 renderSidebar(currentPage==="item"?"catalog":currentPage);
}
async function refreshMe(){try{const d=await api("/api/me");detectedBannedAccount=d.bannedAccount||null;setUser(d.user)}catch{detectedBannedAccount=null;setUser(null)}}
function page(name){const base=location.pathname.startsWith("/item/")?"/":"";const target=name==="profile"&&me?.publicId?"profile?id="+encodeURIComponent(me.publicId):name;history.pushState({page:name},"",base+"#"+target);render(target)}
function currentRoute(){const match=location.pathname.match(new RegExp("^/item/([A-Za-z0-9_-]{1,80})/?$"));return match?"item?id="+encodeURIComponent(match[1]):(location.hash.slice(1)||"home")}
window.addEventListener("popstate",()=>render(currentRoute()));
document.addEventListener("click",e=>{
 const a=e.target.closest("[data-page]");
 if(a){e.preventDefault();sidebar.classList.remove("mobile-open");page(a.dataset.page)}
 const banned=e.target.closest("[data-banned-account]");
 if(banned){
  e.preventDefault();
  sidebar.classList.remove("mobile-open");
  const username=banned.dataset.bannedAccount;
  history.pushState({page:"banned",username},"","/#banned?username="+encodeURIComponent(username));
  render("banned?username="+encodeURIComponent(username));
 }
 const group=e.target.closest("[data-group-view]");
 if(group){
  e.preventDefault();
  const groupId=group.dataset.groupView;
  history.pushState({page:"group",groupId},"","/#group?id="+encodeURIComponent(groupId));
  render("group?id="+encodeURIComponent(groupId));
 }
 const p=e.target.closest("[data-profile]");
 if(p){
  e.preventDefault();
  sidebar.classList.remove("mobile-open");
  const username=p.dataset.profile;
  history.pushState({page:"profile",username},"","/#profile?username="+encodeURIComponent(username));
  profile(username);
 }
 const item=e.target.closest("[data-item-view]");
 if(item){e.preventDefault();showItem(item.dataset.itemView)}
});
document.getElementById("globalSearchForm").addEventListener("submit",e=>{
 e.preventDefault();
 const q=document.getElementById("globalSearch").value.trim().slice(0,32);
 const target="#users?q="+encodeURIComponent(q);
 history.pushState({page:"users",query:q},"","/"+target);
 render("users");
});

document.getElementById("mobileMenu")?.addEventListener("click",()=>sidebar.classList.toggle("mobile-open"));
function home(){
 const view=beginView();
 renderSidebar("home");
 if(!me){
  app.innerHTML='<div class="op-guest"><h1>Welcome to Sakura</h1><p>Join the community and explore the catalog.</p><a class="button" href="/#login" data-page="login">Login</a><a class="button" href="/#register" data-page="register">Sign Up</a></div>';
  return;
 }
 const name=esc(me.username);
 app.innerHTML='<div class="sakura-home-shell"><div id="accountWarnings"></div>'+
  '<div class="sakura-home-card">'+
   '<div class="op-home-header"><a id="homeAvatar" class="op-home-avatar" href="/#profile" data-page="profile">'+avatar(me.username)+'</a><div class="sakura-welcome-copy"><h1><a href="/#profile" data-page="profile">Hello, '+name+'!</a></h1><div class="home-balances">'+currencyMarkup(me.balance,"P$","balance-chip")+currencyMarkup(me.tixBalance,"Tix","balance-chip")+'</div></div></div>'+
   '<section class="op-dashboard-section"><div class="op-section-heading"><h3>Friends (<span id="homeFriendCount">0</span>)</h3><a href="/#friends" data-page="friends">See All</a></div><div id="homeFriends" class="op-section-content"><div class="op-empty">Loading friends...</div></div></section>'+
   '<div class="sakura-home-columns">'+
    '<section class="op-dashboard-section"><div class="op-section-heading"><h3>My Favorites</h3><a href="/#catalog" data-page="catalog">See All</a></div><div id="homeFavorites" class="sakura-empty-panel">Your favorite items will appear here.</div></section>'+
   '</div>'+
   '<div class="sakura-home-columns sakura-home-bottom">'+
    '<section class="op-dashboard-section"><div class="op-section-heading"><h3>My Feed</h3><a href="/#friends" data-page="friends">See All</a></div><div id="homeFeed" class="sakura-feed-panel">No posts yet.</div></section>'+
    '<section class="op-dashboard-section"><div class="op-section-heading"><h3>Blog News</h3></div><div class="sakura-feed-panel sakura-blog-empty">No news found.</div></section>'+
   '</div>'+
  '</div></div>';
 loadHomeDashboard(view);
 if(me)api("/api/account/warnings").then(d=>{
  const host=document.getElementById("accountWarnings");
  const warnings=d.warnings||[];
  if(host&&warnings.length)host.innerHTML='<section class="account-warning-panel"><strong>Account warnings</strong>'+warnings.map(w=>'<p>'+esc(w.reason)+' <span class="muted">('+new Date(w.created_at+"Z").toLocaleDateString()+')</span></p>').join("")+'</section>';
 }).catch(()=>{});
}
async function loadHomeDashboard(view=activeView){
 const friendsHost=document.getElementById("homeFriends");
 if(!friendsHost||!me)return;
 try{
  const friendsData=await api("/api/friends");
  if(!isActiveView(view)||!document.getElementById("homeFriends"))return;
  const friends=friendsData.friends||[];
  document.getElementById("homeFriendCount").textContent=friends.length;
  friendsHost.innerHTML=friends.length?'<div class="op-home-friends">'+friends.slice(0,12).map(u=>'<a href="/#profile?id='+encodeURIComponent(u.public_id||"")+'" class="op-home-friend" data-profile="'+esc(u.username)+'">'+avatar(u.username)+'<span>'+esc(u.username)+(u.is_verified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</span></a>').join("")+'</div>':'<div class="op-empty">You have no friends to display yet.</div>';
 }catch(e){
  if(!isActiveView(view)||!friendsHost.isConnected)return;
  friendsHost.innerHTML='<div class="op-empty">Could not load friends.</div>';
 }
}

function itemPreview(x,extraClass=""){
 if(x?.category==="Accessories"){
  return x.model_url
   ? '<model-viewer class="pekora-model '+extraClass+'" src="'+esc(x.model_url)+'" alt="'+esc(x.name||"3D accessory")+'" camera-controls auto-rotate rotation-per-second="20deg" shadow-intensity="1" exposure="1" loading="lazy" reveal="auto"></model-viewer>'
   : '<div class="pekora-model-missing '+extraClass+'">3D model not uploaded</div>';
 }
 return x?.image_url?'<img src="'+esc(x.image_url)+'" alt="'+esc(x.name||"Item")+'" loading="lazy">':'◇';
}
function itemStockState(x){
 const total=Math.max(0,Number(x?.stock_limit||0)),sold=Math.max(0,Number(x?.stock_sold||0));
 return {limited:Number(x?.is_limited)===1,total,sold,finite:total>0,remaining:Math.max(0,total-sold),soldOut:total>0&&sold>=total};
}
function itemBadgeMarkup(x){
 const stock=itemStockState(x);
 return (stock.limited?'<span class="limited-overlay icon-labels Limited" role="img" aria-label="Limited"></span>':"")+
  (Number(x?.is_gift)===1?'<span class="gift-overlay">GIFT</span>':"")+
  (stock.finite?'<span class="stock-overlay '+(stock.soldOut?'sold-out':'')+'">'+(stock.soldOut?'Sold out':stock.remaining+' left')+'</span>':"");
}
function itemStockText(x){
 const stock=itemStockState(x);
 return stock.finite?stock.sold+"/"+stock.total+" sold":stock.sold+" sold · unlimited stock";
}
function itemCreatorMarkup(item){
 if(!item?.creator_name)return "";
 const creator=esc(item.creator_name);
 const link=item.creator_public_id
  ? '<a href="/#profile?id='+encodeURIComponent(item.creator_public_id)+'" data-profile="'+creator+'">'+creator+'</a>'
  : '<span>'+creator+'</span>';
 return '<div class="item-creator muted">Created by '+link+'</div>';
}
function itemCard(x){return '<article class="item-card"><div class="item-image">'+itemPreview(x)+itemBadgeMarkup(x)+'</div><h3>'+esc(x.name)+'</h3><div class="muted">'+esc(x.category)+'</div>'+(Number(x.quantity)>1?'<div class="muted">Quantity: '+Number(x.quantity)+'</div>':"")+itemCreatorMarkup(x)+'<div class="price">'+currencyMarkup(x.price,x.currency||"P$")+'</div>'+(Number(x.stock_limit)>0?'<div class="item-stock-text">'+esc(itemStockText(x))+'</div>':"")+'</article>'}
function itemPriceHistoryMarkup(item,history){
 const soldOut=Number(item.stock_limit)>0&&Number(item.stock_sold)>=Number(item.stock_limit);
 const eligible=Number(item.is_limited)===1||Number(item.is_offsale)===1||soldOut;
 if(!eligible)return "";
 const currentRap=Number(item.rap_value||0);
 const currentRapCurrency=String(item.rap_currency||"P$");
 const currentRapStat=currentRap>0&&currentRapCurrency==="P$"
  ?'<div class="item-price-history-stat item-price-history-stat-current"><span>Current RAP</span><b>'+currentRap.toLocaleString()+' P$</b></div>'
  :'';
 const records=(Array.isArray(history)?history:[])
  .filter(entry=>Number(entry.price)>0&&Number.isFinite(Number(entry.price))&&entry.sold_at)
  .map(entry=>{
   const raw=String(entry.sold_at);
   const date=new Date(raw.includes("T")?raw:raw.replace(" ","T")+"Z");
   return {price:Number(entry.price),date,source:String(entry.source||"Sale")};
  })
  .filter(entry=>!Number.isNaN(entry.date.getTime()))
  .sort((a,b)=>a.date-b.date);
 if(records.length<2){
  const count=records.length;
  return '<section class="item-price-history"><div class="item-price-history-heading"><div><h2>Price History</h2><p class="muted">Completed sales · P$ only. Current RAP is shown separately.</p></div></div><div class="item-price-history-empty">'+(count?'Only one completed sale is recorded. The line chart appears after another sale.':'No completed sales are recorded yet. The line chart will appear as soon as this item has at least two completed sales.')+'</div>'+(currentRapStat?'<div class="item-price-history-stats">'+currentRapStat+'</div>':'')+'</section>';
 }
 const width=760,height=280,left=66,right=22,top=20,bottom=48;
 const values=records.map(entry=>entry.price);
 const minValue=Math.min(...values),maxValue=Math.max(...values);
 const spread=Math.max(1,maxValue-minValue);
 const minAxis=Math.max(0,minValue-spread*.15);
 const maxAxis=maxValue+spread*.15;
 const timeMin=records[0].date.getTime(),timeMax=records[records.length-1].date.getTime();
 const xAt=index=>left+(timeMax===timeMin?index/(records.length-1):(records[index].date.getTime()-timeMin)/(timeMax-timeMin))*(width-left-right);
 const yAt=value=>top+(maxAxis-value)/(maxAxis-minAxis)*(height-top-bottom);
 const points=records.map((entry,index)=>({x:xAt(index),y:yAt(entry.price),entry}));
 const path=points.map((point,index)=>(index?'L':'M')+point.x.toFixed(1)+','+point.y.toFixed(1)).join(' ');
 const area=path+' L '+points[points.length-1].x.toFixed(1)+','+(height-bottom)+' L '+points[0].x.toFixed(1)+','+(height-bottom)+' Z';
 const grid=Array.from({length:4},(_,index)=>{
  const value=minAxis+(maxAxis-minAxis)*index/3;
  const y=yAt(value);
  return '<line x1="'+left+'" y1="'+y.toFixed(1)+'" x2="'+(width-right)+'" y2="'+y.toFixed(1)+'" class="price-chart-gridline"/><text x="'+(left-10)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end" class="price-chart-axis-label">'+Math.round(value).toLocaleString()+'</text>';
 }).join('');
 const dots=points.map(point=>'<circle cx="'+point.x.toFixed(1)+'" cy="'+point.y.toFixed(1)+'" r="4" class="price-chart-point"><title>'+point.entry.price.toLocaleString()+' P$ · '+point.entry.date.toLocaleDateString()+' · '+esc(point.entry.source)+'</title></circle>').join('');
 const startDate=records[0].date.toLocaleDateString(),endDate=records[records.length-1].date.toLocaleDateString();
 const stats='<div class="item-price-history-stats">'+
  '<div class="item-price-history-stat"><span>Lowest completed sale</span><b>'+minValue.toLocaleString()+' P$</b></div>'+
  '<div class="item-price-history-stat"><span>Highest completed sale</span><b>'+maxValue.toLocaleString()+' P$</b></div>'+
  '<div class="item-price-history-stat"><span>Latest completed sale</span><b>'+records[records.length-1].price.toLocaleString()+' P$</b></div>'+
  currentRapStat+
  '</div>';
 return '<section class="item-price-history"><div class="item-price-history-heading"><div><h2>Price History</h2><p class="muted">Completed sale prices only · P$. Current RAP is separate.</p></div><strong>'+records.length.toLocaleString()+' sales</strong></div><div class="item-price-chart-wrap"><svg class="item-price-chart" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Completed sale price history chart for '+esc(item.name)+'">'+grid+'<path d="'+area+'" class="price-chart-area"/><path d="'+path+'" class="price-chart-line"/>'+dots+'<text x="'+left+'" y="'+(height-14)+'" class="price-chart-date">'+startDate+'</text><text x="'+(width-right)+'" y="'+(height-14)+'" text-anchor="end" class="price-chart-date">'+endDate+'</text></svg></div>'+stats+'</section>';
}

async function showItem(itemId,updateHistory=true){
 const view=beginView();
 const requestedUserId=me?.id||null;
 sidebar.classList.remove("mobile-open");
 renderSidebar("catalog");
 if(updateHistory)history.pushState({page:"item",itemId},"","/item/"+encodeURIComponent(itemId||""));
 let item=items.find(x=>x.id===itemId);
 let resaleSnapshot=null;
 if(!item||(me&&!ownershipLoaded)){
  try{
   const [catalogResult,inventoryResult,resaleResult]=await Promise.allSettled([
    item?Promise.resolve({items}):api("/api/catalog"),
    me?api("/api/inventory"):Promise.resolve({items:[]}),
    api("/api/resale/item/"+encodeURIComponent(itemId))
   ]);
   if(!isActiveView(view)||(me?.id||null)!==requestedUserId)return;
   if(catalogResult.status!=="fulfilled")throw catalogResult.reason;
   const catalogData=catalogResult.value;
   const inventoryData=inventoryResult.status==="fulfilled"?inventoryResult.value:{items:[]};
   if(!item){
    items=catalogData.items||[];
    item=items.find(x=>x.id===itemId);
   }
   if(me&&inventoryResult.status!=="fulfilled"){
    ownedItemIds=new Set();ownedItemCounts=new Map();
    ownershipLoaded=false;
   }else{
    setOwnedInventory(inventoryData.items||[]);
    ownershipLoaded=true;
   }
   item=item||(inventoryData.items||[]).find(x=>x.id===itemId)||(resaleResult.status==="fulfilled"?resaleResult.value.item:null);
   if(resaleResult.status==="fulfilled")resaleSnapshot=resaleResult.value;
  }catch(error){
   if(isActiveView(view))app.innerHTML='<div class="empty">Could not verify item and inventory: '+esc(error.message)+'</div>';
   return;
  }
 }
 if(!isActiveView(view))return;
 if(!item){app.innerHTML='<div class="empty">Item not found. <a href="/#catalog" data-page="catalog">Back to Catalog</a></div>';return}
 if(!resaleSnapshot){try{resaleSnapshot=await api("/api/resale/item/"+encodeURIComponent(item.id))}catch{resaleSnapshot={listings:[]}}}
 if(!isActiveView(view))return;
 if(resaleSnapshot?.item){
  item={...item,...resaleSnapshot.item};
  const cachedItemIndex=items.findIndex(entry=>entry.id===item.id);
  if(cachedItemIndex>=0)items[cachedItemIndex]={...items[cachedItemIndex],price:item.price,currency:item.currency,rap_value:item.rap_value,rap_currency:item.rap_currency};
 }
 const maxResalePrice=Math.max(1,Math.floor(Number(resaleSnapshot?.maxListingPrice||1000000)));
 const ownedCount=ownedItemCount(item.id),isOwned=ownedCount>0,isAtLimit=Number(item.is_limited)===1&&ownedCount>=1,isOffsale=Number(item.is_offsale)===1,stock=itemStockState(item);
 const resaleEligible=Number(item.is_limited)===1||stock.soldOut;
 const resaleListings=Array.isArray(resaleSnapshot.listings)?resaleSnapshot.listings:[];
 const myListing=me?resaleListings.find(listing=>listing.seller_id===me.id):null;
 const otherListings=resaleListings.filter(listing=>!me||listing.seller_id!==me.id);
 const sellerMarkup=listing=>'<a href="/#profile?id='+encodeURIComponent(listing.seller_public_id||"")+'" data-profile="'+esc(listing.seller_name)+'">'+esc(listing.seller_name)+'</a>'+(Number(listing.seller_verified)===1?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified seller">':'');
 const listingRows=otherListings.length?otherListings.map(listing=>'<article class="resale-offer-row"><div class="resale-offer-seller"><strong>'+sellerMarkup(listing)+'</strong><span class="muted">Seller</span></div><strong class="resale-offer-price">'+currencyMarkup(listing.price,"P$")+'</strong><button class="primary resale-buy-button" type="button" data-resale-buy="'+esc(listing.id)+'" data-item-id="'+esc(item.id)+'" '+(isAtLimit?'disabled':'')+'>'+(!me?'Log in to buy':isAtLimit?'Limit reached':isOwned?'Buy ('+ownedCount+'/1)':'Buy')+'</button></article>').join(""):'<p class="muted">No player listings for this item yet.</p>';
 const ownListingMarkup=myListing?'<div class="resale-own-listing"><div><strong>Your listing is active</strong><p class="muted">Asking price: '+currencyMarkup(myListing.price,"P$")+'</p></div><button class="button secondary" type="button" id="cancelResaleListing" data-listing-id="'+esc(myListing.id)+'">Remove listing</button></div>':(me&&isOwned&&resaleEligible?'<form id="createResaleListing" class="resale-create-form"><h3>Sell your copy</h3><p class="muted">Set your own price. Your item stays in your inventory until another player buys it.</p><label>Price in P$ <input type="number" name="price" min="1" max="'+maxResalePrice+'" step="1" value="1" required></label><p class="muted">Maximum price: '+maxResalePrice.toLocaleString()+' P$ (5x current RAP). Lower listings can reduce the item price, higher listings cannot raise it.</p><button class="primary" type="submit">List for sale</button><span id="resaleCreateMessage" class="muted" role="status"></span></form>':"");
 const resalePanel=resaleEligible?'<section class="resale-section"><div class="resale-section-heading"><div><h2>Player Marketplace</h2><p class="muted">Limited, Off Sale, and sold-out items can be resold by players.</p></div><a href="/#resale" data-page="resale">Open market</a></div>'+ownListingMarkup+'<div class="resale-offer-list">'+listingRows+'</div></section>':"";
 app.innerHTML='<div class="item-detail-page"><a class="item-back-link" href="/#catalog" data-page="catalog">‹ Back to Catalog</a><div class="item-detail-card">'+
  '<div class="item-detail-image" id="itemDetailPreview">'+itemPreview(item)+itemBadgeMarkup(item)+'</div>'+
  '<div class="item-detail-info"><h1>'+esc(item.name)+'</h1><div class="muted">'+esc(item.category)+'</div>'+itemCreatorMarkup(item)+'<p>'+esc(item.description||"No description available.")+'</p><div class="item-detail-price">'+currencyMarkup(item.price,item.currency||"P$")+'</div>'+(isOffsale?'<p class="offsale-notice">OFF SALE · This item is not available to purchase.</p>':"")+(stock.finite?'<div class="item-detail-stock" id="itemDetailStock">'+esc(itemStockText(item))+'</div>':"")+(isAtLimit?'<button class="button secondary" id="detailBuy" type="button" disabled>Limit reached (1/1)</button>':isOffsale?'<button class="button secondary" id="detailBuy" type="button" disabled>Off Sale</button>':stock.soldOut?'<button class="button secondary" id="detailBuy" type="button" disabled>Sold Out</button>':me&&!ownershipLoaded?'<button class="button secondary" id="detailBuy" type="button" disabled>Inventory check unavailable</button>':'<button class="primary" id="detailBuy" type="button">Buy</button>')+'<button class="button secondary" id="copyItemLink" type="button">Copy item link</button></div>'+
  '</div></div>'+resalePanel+itemPriceHistoryMarkup(item,resaleSnapshot.history||[]);
 if(canBuyItem(item)&&!isOffsale&&!stock.soldOut&&(!me||ownershipLoaded))document.getElementById("detailBuy").addEventListener("click",()=>buy(item.id));
 document.getElementById("copyItemLink")?.addEventListener("click",async()=>{const shareUrl=new URL("/item/"+encodeURIComponent(item.id),location.origin).href;try{await navigator.clipboard.writeText(shareUrl);toast("Item link copied")}catch{toast("Could not copy link. Copy it from the address bar.")}});
 document.getElementById("createResaleListing")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget,button=form.querySelector('button[type="submit"]'),message=document.getElementById("resaleCreateMessage");
  const price=Number(new FormData(form).get("price"));
  button.disabled=true;message.textContent="Creating listing...";
  try{
   await api("/api/resale/listings",{method:"POST",body:JSON.stringify({itemId:item.id,price})});
   
   
   
   
   
   toast("Item listed for sale");
   await showItem(item.id,false);
  }catch(error){message.textContent=error.message;button.disabled=false}
 });
 document.getElementById("cancelResaleListing")?.addEventListener("click",async event=>{
  const button=event.currentTarget;button.disabled=true;button.textContent="Removing...";
  try{
   await api("/api/resale/listings/"+encodeURIComponent(button.dataset.listingId),{method:"DELETE"});
   toast("Listing removed");
   await showItem(item.id,false);
  }catch(error){toast(error.message);button.disabled=false;button.textContent="Remove listing"}
 });
 document.querySelectorAll("[data-resale-buy]").forEach(button=>button.addEventListener("click",()=>buyResaleListing(button.dataset.resaleBuy,item.id,button)));
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
       '<a href="/#" class="active" data-category="All">All Items</a>'+
       '<a href="/#" data-category="Hats">Hats</a><a href="/#" data-category="Hair">Hair</a>'+
       '<a href="/#" data-category="Faces">Faces</a><a href="/#" data-category="Shirts">Shirts</a>'+
       '<a href="/#" data-category="Pants">Pants</a><a href="/#" data-category="Accessories">Accessories</a>'+
      '</nav>'+
      '<div class="catalog-legend"><strong>About</strong><p>Items purchased here belong to your Sakura account.</p></div>'+
     '</div></aside>'+
     '<section class="catalog-results">'+
      '<div class="catalog-results-header"><div><h2 id="catalogCategoryTitle">Featured Items on Sakura</h2><p id="catalogCount" class="muted"></p></div><label class="catalog-sort-label">Sort By: <select id="catalogSort" class="catalog-sort"><option value="newest">Newest first</option><option value="price-low">Price (Low to High)</option><option value="price-high">Price (High to Low)</option></select></label></div>'+
      '<div id="catalogGrid" class="item-grid">Loading catalog...</div>'+
     '</section>'+
    '</div>'+
   '</div>'+
  '</div>';
 try{
  const catalogData=await api("/api/catalog");
  if(!isActiveView(view)||(me?.id||null)!==requestedUserId)return;
  items=catalogData.items||[];
  ownedItemIds=new Set();ownedItemCounts=new Map();
  ownershipLoaded=!me;
  if(me){
   try{
    const inventoryData=await api("/api/inventory");
    if(!isActiveView(view)||(me?.id||null)!==requestedUserId)return;
    setOwnedInventory(inventoryData.items||[]);
    ownershipLoaded=true;
   }catch(error){
    if(!isActiveView(view)||(me?.id||null)!==requestedUserId)return;
    ownershipLoaded=false;
    console.warn("[Sakura catalog] Inventory state unavailable:",error);
   }
  }
  drawCatalog("All","");
 }catch(e){
  const grid=document.getElementById("catalogGrid");
  if(isActiveView(view)&&grid)grid.textContent=e.message;
  items=[];
  ownedItemIds=new Set();ownedItemCounts=new Map();
  ownershipLoaded=false;
  return;
 }
 if(!isActiveView(view))return;
 const search=document.getElementById("itemSearch");
 const select=document.getElementById("itemCategorySelect");
 if(!search||!select||!document.getElementById("catalogSearchForm"))return;
 const activeCategory=()=>document.querySelector("[data-category].active")?.dataset.category||"All";
 function chooseCategory(category){
  document.querySelectorAll("[data-category]").forEach(x=>x.classList.toggle("active",x.dataset.category===category));
  select.value=category;
  document.getElementById("catalogCategoryTitle").textContent=category==="All"?"Featured Items on Sakura":category;
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
 el.innerHTML=list.length?list.map(x=>{
  const stock=itemStockState(x);
  return '<article class="item-card"><a class="item-image" href="/#" data-item-view="'+esc(x.id)+'" aria-label="View '+esc(x.name)+'">'+itemPreview(x)+itemBadgeMarkup(x)+'</a><h3>'+esc(x.name)+'</h3><div class="muted">'+esc(x.category)+'</div>'+'<div class="catalog-asset-kind">'+(x.category==="Accessories"?(x.model_url?"Interactive 3D model":"3D model not uploaded"):"Catalog item")+'</div>'+(stock.finite?'<div class="item-stock-text">'+esc(itemStockText(x))+'</div>':"")+'<div class="price">'+currencyMarkup(x.price,x.currency||"P$")+'</div>'+(ownedItemCount(x.id)>0?'<button class="button secondary" type="button" disabled>'+(Number(x.is_limited)===1?'Limit reached (1/1)':'Owned')+'</button>':Number(x.is_offsale)===1?'<button class="button secondary offsale-button" type="button" disabled>Off Sale</button>':stock.soldOut?'<button class="button secondary" type="button" disabled>Sold Out</button>':!ownershipLoaded?'<button class="button secondary" type="button" disabled>Checking inventory...</button>':'<button class="button" data-buy="'+esc(x.id)+'">Buy</button>')+'</article>';
 }).join(""):'<div class="empty">No items found.</div>';
 el.querySelectorAll("[data-buy]").forEach(b=>b.addEventListener("click",()=>buy(b.dataset.buy)));

}async function buy(itemId){
 if(!me){page("login");return}
 if(!ownershipLoaded){toast("Could not verify your inventory. Reload the Catalog and try again.");return}
 const view=activeView,userId=me.id,pendingKey=userId+":"+itemId;
 if(pendingPurchases.has(pendingKey))return;
 pendingPurchases.add(pendingKey);
 const buttons=[...document.querySelectorAll("[data-buy]")].filter(button=>button.dataset.buy===itemId);
 const detailButton=document.getElementById("detailBuy");
 buttons.forEach(button=>{button.disabled=true;button.textContent="Buying..."});
 if(detailButton?.isConnected){detailButton.disabled=true;detailButton.textContent="Buying..."}
 try{
  const d=await api("/api/purchase",{method:"POST",body:JSON.stringify({itemId})});
  if(!me||me.id!==userId)return;
  me.balance=d.balance;me.tixBalance=d.tixBalance;ownedItemCounts.set(itemId,ownedItemCount(itemId)+1);ownedItemIds.add(itemId);ownershipLoaded=true;
  const purchasedItem=items.find(item=>item.id===itemId);
  if(purchasedItem)purchasedItem.stock_sold=Number(purchasedItem.stock_sold||0)+1;
  setUser(me);toast("Item purchased");
  if(isActiveView(view)){
   const currentDetailButton=document.getElementById("detailBuy");
   if(currentDetailButton?.isConnected){
    currentDetailButton.disabled=true;currentDetailButton.textContent="Owned";currentDetailButton.classList.add("button","secondary");
    const preview=document.getElementById("itemDetailPreview");
    if(preview&&purchasedItem)preview.innerHTML=itemPreview(purchasedItem)+itemBadgeMarkup(purchasedItem);
    const stockLine=document.getElementById("itemDetailStock");
    if(stockLine&&purchasedItem)stockLine.textContent=itemStockText(purchasedItem);
   }else catalog();
  }
 }catch(e){toast(e.message)}
 finally{
  pendingPurchases.delete(pendingKey);
  buttons.forEach(button=>{if(button.isConnected){button.disabled=false;button.textContent="Buy"}});
  if(detailButton?.isConnected&&canBuyItem(items.find(item=>item.id===itemId)||{id:itemId,is_limited:0})){detailButton.disabled=false;detailButton.textContent="Buy"}
 }
}
async function buyResaleListing(listingId,itemId,button){
 if(!me){page("login");return}
 if(button){button.disabled=true;button.textContent="Buying..."}
 try{
  const result=await api("/api/resale/listings/"+encodeURIComponent(listingId)+"/buy",{method:"POST",body:"{}"});
  setUser({...me,balance:Number(result.balance||0),tixBalance:Number(result.tixBalance??me.tixBalance??0)});
  ownedItemIds=new Set();ownedItemCounts=new Map();ownershipLoaded=false;
  try{
   const inventoryData=await api("/api/inventory");
   setOwnedInventory(inventoryData.items||[]);
   ownershipLoaded=true;
  }catch(error){console.warn("[Sakura resale] Could not refresh inventory:",error)}
  toast("Purchased from "+(result.sellerName||"seller"));
  const route=currentRoute().split("?",1)[0];
  if(route==="resale")await resaleMarketPage();
  else await showItem(itemId,false);
 }catch(error){
  toast(error.message);
  if(button?.isConnected){button.disabled=false;button.textContent="Buy"}
 }
}

async function resaleMarketPage(){
 const view=beginView();
 renderSidebar("resale");
 app.innerHTML='<div class="resale-market-page"><div class="resale-market-heading"><div><h1 class="page-title">Resale Market</h1><p class="muted">Limited, Off Sale, and sold-out items listed by Sakura players.</p></div><a class="button secondary" href="/#inventory" data-page="inventory">My Inventory</a></div><div id="resaleMarketGrid" class="resale-market-list">Loading listings...</div></div>';
 const host=document.getElementById("resaleMarketGrid");
 try{
  const data=await api("/api/resale/listings");
  if(!isActiveView(view)||!host?.isConnected)return;
  const listings=data.listings||[];
  host.innerHTML=listings.length?listings.map(listing=>'<article class="resale-market-card"><a class="resale-market-image" href="/item/'+encodeURIComponent(listing.item_id)+'" data-item-view="'+esc(listing.item_id)+'">'+itemPreview(listing)+itemBadgeMarkup(listing)+'</a><div class="resale-market-details"><h2><a href="/item/'+encodeURIComponent(listing.item_id)+'" data-item-view="'+esc(listing.item_id)+'">'+esc(listing.name)+'</a></h2><span class="muted">'+esc(listing.category)+' · '+(Number(listing.is_limited)===1?'LIMITED':'OFF SALE')+'</span><div class="resale-market-seller">Seller: <a href="/#profile?id='+encodeURIComponent(listing.seller_public_id||"")+'" data-profile="'+esc(listing.seller_name)+'">'+esc(listing.seller_name)+'</a>'+(Number(listing.seller_verified)===1?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified seller">':'')+'</div><strong class="resale-market-price">'+currencyMarkup(listing.price,"P$")+'</strong></div><button class="primary resale-buy-button" type="button" data-resale-buy="'+esc(listing.id)+'" data-item-id="'+esc(listing.item_id)+'" '+''+'>'+(!me?'Log in to buy':'Buy')+'</button></article>').join(""):'<div class="empty">There are no player listings yet.</div>';
  host.querySelectorAll("[data-resale-buy]").forEach(button=>button.addEventListener("click",()=>buyResaleListing(button.dataset.resaleBuy,button.dataset.itemId,button)));
 }catch(error){if(host?.isConnected)host.textContent=error.message}
}

function auth(kind){
 const view=beginView();
 renderSidebar("");
 const reg=kind==="register";
 app.innerHTML='<div class="form"><h2>'+(reg?"Create your Sakura account":"Log in to Sakura")+'</h2><form id="authForm"><label>Username</label><input name="username" required minlength="'+(reg?"3":"1")+'" maxlength="20" autocomplete="username"><label>Password</label><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="'+(reg?"new-password":"current-password")+'"><button class="primary" type="submit">'+(reg?"Sign up":"Log in")+'</button><div id="authError" class="error" role="status" aria-live="polite"></div></form><p class="muted">'+(reg?'Already have an account? <a href="/#login" data-page="login">Log in</a>':'New to Sakura? <a href="/#register" data-page="register">Sign up</a>')+'</p>'+(reg?'':'<p class="muted"><a href="/#owner-recovery" data-page="owner-recovery">Recover OWNER account</a></p>')+'</div>';
 const form=document.getElementById("authForm");
 form.addEventListener("submit",async e=>{
  e.preventDefault();
  if(form.dataset.submitting==="1")return;
  form.dataset.submitting="1";
  const submit=form.querySelector('button[type="submit"]');
  const error=document.getElementById("authError");
  const values=new FormData(form);
  submit.disabled=true;
  error.textContent=reg?"Creating account...":"Signing in...";
  try{
   const d=await api(reg?"/api/register":"/api/login",{method:"POST",body:JSON.stringify({username:values.get("username"),password:values.get("password")})});
   setUser(d.user);
   if(isActiveView(view))page("home");
  }catch(err){
   if(isActiveView(view)&&error){
    if(!reg&&String(err.message).startsWith("This account is banned")){
     error.innerHTML=esc(err.message)+'<p><a href="/#banned?username='+encodeURIComponent(String(values.get("username")||""))+'" data-banned-account="'+esc(String(values.get("username")||""))+'">View ban details</a></p>';
    }else error.textContent=err.message;
   }
  }finally{
   form.dataset.submitting="0";
   if(submit.isConnected)submit.disabled=false;
  }
 });
}
async function ownerRecoveryPage(){
 const view=beginView();
 renderSidebar("");
 app.innerHTML='<div class="form"><h2>Recover Sakura OWNER account</h2><p class="muted">Use the Worker secret OWNER_BOOTSTRAP_SECRET from your Cloudflare settings. This resets the active OWNER account password and signs out previous sessions.</p><form id="ownerRecoveryForm"><label>Worker recovery secret<input name="secret" type="password" maxlength="512" required autocomplete="off"></label><label>New password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><label>Confirm new password<input name="confirmPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><button class="primary" type="submit">Reset owner password</button><div id="ownerRecoveryMessage" class="error" role="status"></div></form><p class="muted"><a href="/#login" data-page="login">Back to login</a></p></div>';
 document.getElementById("ownerRecoveryForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const form=e.currentTarget,values=new FormData(form),secret=String(values.get("secret")||""),password=String(values.get("password")||""),confirmPassword=String(values.get("confirmPassword")||""),message=document.getElementById("ownerRecoveryMessage");
  if(password!==confirmPassword){message.textContent="Passwords do not match.";return}
  message.textContent="Resetting password...";
  try{
   await api("/api/owner/recover",{method:"POST",body:JSON.stringify({secret,password})});
   if(me?.username?.toLowerCase()==="pekoraadmin")setUser(null);
   form.reset();
   message.textContent="Password reset. Sign in to the OWNER account using the new password.";
  }catch(error){message.textContent=error.message}
 });
}

async function logout(){try{await api("/api/logout",{method:"POST"});setUser(null);page("home")}catch(e){toast(e.message)}}
function inventoryItemCard(item){
 const soldOut=Number(item.stock_limit)>0&&Number(item.stock_sold)>=Number(item.stock_limit);
  const eligible=Number(item.is_limited)===1||Number(item.is_offsale)===1||soldOut;
 const status=item.active_listing_id
  ?'<span class="inventory-listing-status">Listed · '+currencyMarkup(item.active_listing_price,"P$")+'</span>'
  :eligible?'<span class="inventory-resale-hint">Eligible for resale</span>':"";
 const isGift=Number(item.is_gift)===1;
 const opened=Number(item.gift_opened)===1;
 const giftDate=Date.parse(item.gift_opens_at||"");
 const canOpenGift=isGift&&!opened&&!item.active_listing_id&&Number.isFinite(giftDate)&&Date.now()>=giftDate;
 const giftStatus=isGift?(opened?'<div class="inventory-gift-status">Gift opened · '+esc(item.gift_reward_name||"Reward received")+'</div>':Number.isFinite(giftDate)?'<div class="inventory-gift-status">Opens '+esc(new Date(giftDate).toLocaleString())+'</div>':'<div class="inventory-gift-status">Gift opening date unavailable</div>'):"";
 const giftButton=canOpenGift?'<button class="primary inventory-open-gift" type="button" data-open-gift="'+esc(item.id)+'">Open Gift</button>':"";
 return '<article class="item-card inventory-item-card">'+
  '<a class="item-image" href="/item/'+encodeURIComponent(item.id)+'" data-item-view="'+esc(item.id)+'">'+itemPreview(item)+itemBadgeMarkup(item)+'</a>'+
  '<h3><a href="/item/'+encodeURIComponent(item.id)+'" data-item-view="'+esc(item.id)+'">'+esc(item.name)+'</a></h3>'+
  '<div class="muted">'+esc(item.category)+'</div>'+(Number(item.quantity)>1?'<div class="muted">Quantity: '+Number(item.quantity)+'</div>':"")+status+giftStatus+giftButton+
  '</article>';
}
async function inventory(){
 const view=beginView();
 renderSidebar("inventory");
 if(!me){app.innerHTML='<div class="empty">Please <a href="/#login" data-page="login">log in</a> to view your inventory.</div>';return}
 app.innerHTML='<h1 class="page-title">Inventory</h1><p class="inventory-sell-intro">Select an item to view its details and available actions.</p><div id="inventoryGrid" class="item-grid">Loading...</div>';
 const grid=document.getElementById("inventoryGrid");
 try{
  const d=await api("/api/inventory");
  if(!isActiveView(view)||!grid?.isConnected)return;
  const ownedItems=Array.isArray(d.items)?d.items:[];
  grid.innerHTML=ownedItems.length?ownedItems.map(inventoryItemCard).join(""):'<div class="empty">Your inventory is empty. <a href="/#catalog" data-page="catalog">Browse the Catalog</a>.</div>';
  grid.querySelectorAll("[data-open-gift]").forEach(button=>button.addEventListener("click",async()=>{
   button.disabled=true;button.textContent="Opening...";
   try{
    const result=await api("/api/gifts/open",{method:"POST",body:JSON.stringify({itemId:button.dataset.openGift})});
    toast("Gift opened! You received "+(result.rewardName||"a new item")+".");
    await inventory();
   }catch(error){toast(error.message);button.disabled=false;button.textContent="Open Gift"}
  }));
 }catch(error){if(isActiveView(view)&&grid?.isConnected)grid.textContent=error.message}
}


async function bannedAccountPage(identifier){
 const view=beginView();
 renderSidebar("");
 if(!identifier){app.innerHTML='<div class="empty">Choose a username or User ID to view ban information.</div>';return}
 app.innerHTML='<div class="empty">Loading banned account...</div>';
 try{
  const data=await api("/api/banned-account/"+encodeURIComponent(identifier));
  if(!isActiveView(view))return;
  const account=data.account||{};
  const parsedDate=account.banned_at?new Date(String(account.banned_at).replace(" ","T")+"Z"):null;
  const bannedDate=parsedDate&&!Number.isNaN(parsedDate.valueOf())?parsedDate.toLocaleString():"Date unavailable";
  const joinedDate=account.created_at?new Date(account.created_at).toLocaleDateString():"Unknown";
  app.innerHTML='<div class="banned-account-page"><a href="/#users" data-page="users" class="item-back-link">‹ Back to People</a>'+
   '<section class="banned-account-card"><div class="ban-status-label">BANNED ACCOUNT</div>'+
   '<div class="banned-account-heading"><div class="banned-account-avatar">'+avatar(account.username)+'</div><div><h1>'+esc(account.username)+'</h1><p class="muted">User ID: '+esc(account.public_id)+' · '+esc(account.role||"USER")+'</p><span class="ban-pill">BANNED</span></div></div>'+
   '<div class="ban-detail-row"><strong>Status</strong><span>Account banned from Sakura</span></div>'+
   '<div class="ban-detail-row"><strong>Reason</strong><p>'+esc(account.ban_reason||"Account banned by Sakura moderation")+'</p></div>'+
   '<div class="ban-detail-row"><strong>Banned on</strong><span>'+esc(bannedDate)+'</span></div>'+
   '<div class="ban-detail-row"><strong>Joined Sakura</strong><span>'+esc(joinedDate)+'</span></div>'+
   '<p class="muted">This account is currently banned. Its profile and inventory are unavailable.</p></section></div>';
 }catch(error){
  if(isActiveView(view))app.innerHTML='<div class="banned-account-page"><section class="banned-account-card"><h1>Banned account not found</h1><p>'+esc(error.message)+'</p><a href="/#users" data-page="users">Search People</a></section></div>';
 }
}

async function profile(identifier=me?.username,byId=false){
 const view=beginView();
 renderSidebar("profile");
 if(!identifier){app.innerHTML='<div class="empty">Choose a user profile.</div>';return}
 app.innerHTML='<div class="empty">Loading profile...</div>';
 try{
  const profilePath=byId?"/api/profile/id/"+encodeURIComponent(identifier):"/api/profile/"+encodeURIComponent(identifier);
  const inventoryPath=profilePath+"/inventory";
  const [d,inventoryData]=await Promise.all([
   api(profilePath),
   api(inventoryPath)
  ]);
  if(!isActiveView(view))return;
  const p=d.profile,owned=inventoryData.items||[],isSelf=me&&me.username.toLowerCase()===p.username.toLowerCase();
  const publicId=p.publicId??p.id,profileUrl="/#profile?id="+encodeURIComponent(publicId);
  if(!byId&&publicId){history.replaceState({page:"profile",publicId},"",profileUrl)}
  const profileAvatar=avatar(p.username);
  const profileRenderImage="";
  app.innerHTML='<div class="op-profile">'+
   '<div class="op-profile-header"><div class="op-profile-avatar">'+profileAvatar+profileRenderImage+'</div><div class="op-profile-info">'+
    '<div class="op-profile-id">USER ID <strong>'+esc(publicId)+'</strong> · <a href="'+profileUrl+'" class="profile-share-link"> '+esc(location.host+'/#profile?id='+publicId)+'</a></div><h1>'+esc(p.username)+(p.isVerified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</h1><div class="op-profile-meta">'+esc(p.role)+' · Joined '+new Date(p.createdAt).toLocaleDateString()+'</div>'+
    '<p>'+esc(p.description||"This user has not added a description.")+'</p>'+
    '<div class="op-profile-stats"><span><b>'+Number(p.itemCount||0).toLocaleString()+'</b> Items</span><span><b>'+currencyMarkup(p.totalRap,"P$")+'</b> Total RAP</span></div>'+
    '<a class="button secondary op-profile-rap-link" href="/#rap" data-page="rap">RAP Leaderboard</a>'+
    (!isSelf&&me?'<div id="profileFriendAction" class="profile-friend-action">Loading...</div>':'')+
   '</div></div>'+
   '<section class="op-profile-section"><h2>Inventory</h2>'+
    (owned.length?'<div class="op-profile-items">'+owned.map(itemCard).join("")+'</div>':'<div class="op-profile-empty">This user has no items to display.</div>')+
   '</section>'+
   '<section class="op-profile-section op-profile-badges-section"><h2>Badges</h2>'+profileBadgesMarkup(p)+'</section>'+
   '</div>';
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

async function currencyPage(){
 const view=beginView();
 renderSidebar("currency");
 if(!me){app.innerHTML='<div class="empty">Please <a href="/#login" data-page="login">log in</a> to view your Sakura balances.</div>';return}
 app.innerHTML='<div class="currency-page"><h1 class="page-title">Sakura Currency</h1><section class="info-panel currency-balance-panel"><h2>Your balances</h2><div class="currency-balances">'+currencyMarkup(me.balance,"P$","currency-large")+currencyMarkup(me.tixBalance,"Tix","currency-large")+'</div><p class="muted">P$ and Tix are virtual Sakura currencies used only on this website. They have no real-world monetary value and cannot be withdrawn.</p><p class="muted">Daily reward: every account receives 5 Tix automatically at midnight (Kyiv time).</p></section><section class="owner-section"><h2>Recent purchases</h2><div id="currencyHistory" class="currency-history">Loading purchase history...</div></section><a class="button" href="/#catalog" data-page="catalog">Browse Catalog</a></div>';
 try{
  const d=await api("/api/currency/history");
  const host=document.getElementById("currencyHistory");
  if(!isActiveView(view)||!host)return;
  const rows=d.purchases||[];
  host.innerHTML=rows.length?'<div class="currency-history-list">'+rows.map(x=>'<article class="currency-history-row"><div><strong>'+esc(x.name)+'</strong><span class="muted">'+esc(x.category)+' · '+new Date(x.purchased_at).toLocaleString()+'</span></div><b>−'+currencyMarkup(x.price,x.currency||"P$")+'</b></article>').join("")+'</div>':'<div class="op-empty">No purchases yet.</div>';
 }catch(e){
  const host=document.getElementById("currencyHistory");
  if(isActiveView(view)&&host)host.textContent=e.message;
 }

}
async function membershipPage(){
 const view=beginView();
 renderSidebar("membership");
 if(!me){
  app.innerHTML='<div class="empty">Please <a href="/#login" data-page="login">log in</a> to manage your membership.</div>';
  return;
 }
 app.innerHTML='<div class="membership-original-container container mt-4"><div class="row"><div class="col-12 col-lg-6 offset-lg-3"><div class="membership-openpekora-card card card-body bg-dark text-light"><h2>Builders Club Membership</h2><p class="muted">Loading membership...</p></div></div></div></div>';
 try{
  const data=await api("/api/membership");
  if(!isActiveView(view))return;
  setUser({...me,balance:Number(data.balance??me.balance),tixBalance:Number(data.tixBalance??me.tixBalance)});
  const current=String(data.membershipType||"None");
  const currentPlan=MEMBERSHIP_PLANS.find(plan=>plan.type===current)||MEMBERSHIP_PLANS[0];
  const canUseAdvanced=Boolean(data.canUseAdvancedMemberships);
  const unlockDate=data.membershipUnlockAt?new Date(data.membershipUnlockAt).toLocaleString():null;
  const lastReward=data.lastRewardDate
   ? 'Last daily reward: '+new Date(data.lastRewardDate+"T00:00:00").toLocaleDateString()
   : "No daily rewards have been recorded yet.";
  const options=MEMBERSHIP_PLANS.map(plan=>{
   const advanced=plan.type==="OutrageousBuildersClub"||plan.type==="Premium";
   const locked=advanced&&!canUseAdvanced;
   const label=plan.type==="BuildersClub"?"BC":plan.type==="TurboBuildersClub"?"TBC":plan.type==="OutrageousBuildersClub"?"OBC":plan.name;
   return '<option value="'+esc(plan.type)+'" '+(locked?'disabled ':'')+(plan.type===current?'selected':'')+'>'+esc(label)+(locked?' — locked':'')+'</option>';
  }).join("");
  app.innerHTML='<div class="membership-original-container container mt-4"><div class="row"><div class="col-12 col-lg-6 offset-lg-3"><div class="membership-openpekora-card card card-body bg-dark text-light">'+
   '<h2>Builders Club Membership</h2>'+
   '<p class="membership-openpekora-current">Current Membership: <strong>'+esc(currentPlan.name)+'</strong></p>'+
   '<p class="membership-openpekora-reward">Daily Reward: <strong>'+currencyMarkup(currentPlan.daily,"P$")+'</strong></p>'+
   '<p class="muted">'+esc(lastReward)+'</p>'+
   '<form id="membershipForm" method="post" autocomplete="off"><select class="form-control" name="membershipType">'+options+'</select>'+
   (!canUseAdvanced?'<p class="membership-openpekora-lock-note">OBC and Premium unlock after your account is more than 3 days old'+(unlockDate?' · '+esc(unlockDate):'')+'</p>':'')+
   '<button class="primary membership-openpekora-submit" type="submit">Submit Changes</button></form>'+
   '<p class="membership-openpekora-footnote">Memberships are currently free. Daily rewards are Sakura P$ credits and are added at 00:00 Kyiv time.</p>'+
   '</div></div></div></div>';
  const form=document.getElementById("membershipForm");
  form.elements.membershipType.value=current;
  form.addEventListener("submit",async e=>{
   e.preventDefault();
   const membershipType=String(new FormData(form).get("membershipType")||"");
   const button=form.querySelector("button[type=submit]");
   button.disabled=true;
   try{
    await api("/api/membership",{method:"POST",body:JSON.stringify({membershipType})});
    if(!isActiveView(view))return;
    toast("Membership updated");
    await refreshMe();
    await membershipPage();
   }catch(error){
    if(isActiveView(view)){toast(error.message);button.disabled=false}
   }
  });
 }catch(error){
  if(isActiveView(view))app.innerHTML='<div class="empty">Could not load membership: '+esc(error.message)+'</div>';
 }
}
async function promocodesPage(){
 const view=beginView();
 renderSidebar("promocodes");
 if(!me){
  app.innerHTML='<div class="empty">Please <a href="/#login" data-page="login">log in</a> to redeem promo codes.</div>';
  return;
 }
 app.innerHTML='<div class="promocodes-page"><h1 class="page-title">Promo Codes</h1><p class="muted">Enter a code to claim its Sakura currency or item rewards.</p>'+
  '<section class="promocode-redeem-panel"><form id="promocodeRedeemForm" class="promocode-redeem-form"><label for="promocodeInput">Promo code</label><div class="promocode-redeem-row"><input id="promocodeInput" name="code" minlength="3" maxlength="32" autocomplete="off" placeholder="ENTER CODE" required><button class="primary" type="submit">Redeem</button></div><p id="promocodeMessage" class="muted" role="status"></p></form></section>'+
  '<section class="promocode-history-section"><h2>Redeemed Codes</h2><div id="promocodeHistory" class="promocode-history">Loading...</div></section></div>';
 const form=document.getElementById("promocodeRedeemForm");
 const message=document.getElementById("promocodeMessage");
 const historyHost=document.getElementById("promocodeHistory");
 async function loadClaims(){
  try{
   const data=await api("/api/promocodes");
   if(!isActiveView(view)||!historyHost?.isConnected)return;
   const claims=data.claims||[];
   historyHost.innerHTML=claims.length?claims.map(claim=>'<article class="promocode-claim"><div><strong>'+esc(claim.code)+'</strong><span class="muted">'+new Date(claim.claimed_at+"Z").toLocaleString()+'</span></div><p>'+(Number(claim.reward_amount)>0?currencyMarkup(claim.reward_amount,claim.reward_currency||"P$"):'')+(claim.item_names?'<span class="promocode-items-reward">'+esc(claim.item_names)+'</span>':'')+'</p></article>').join(""):'<div class="empty">You have not redeemed any promo codes yet.</div>';
  }catch(error){if(isActiveView(view)&&historyHost)historyHost.textContent=error.message}
 }
 form.addEventListener("submit",async e=>{
  e.preventDefault();
  const input=form.elements.code;
  const code=String(input.value||"").trim().toUpperCase();
  const button=form.querySelector("button[type=submit]");
  button.disabled=true;
  message.textContent="Checking code...";
  try{
   const result=await api("/api/promocodes/redeem",{method:"POST",body:JSON.stringify({code})});
   if(!isActiveView(view))return;
   const reward=result.reward||{};
   const rewardText=[];
   if(Number(reward.amount)>0)rewardText.push(Number(reward.amount).toLocaleString()+" "+(reward.currency||"P$"));
   if((reward.items||[]).length)rewardText.push(reward.items.join(", "));
   message.textContent="Code redeemed! Reward: "+rewardText.join(" + ");
   input.value="";
   await refreshMe();
   await loadClaims();
   toast("Promo code redeemed");
  }catch(error){
   if(isActiveView(view))message.textContent=error.message;
  }finally{button.disabled=false}
 });
 await loadClaims();
}

async function tradesPage(){
 const view=beginView();
 renderSidebar("trades");
 if(!me){app.innerHTML='<div class="empty">Please <a href="/#login" data-page="login">log in</a> to trade items.</div>';return}
 app.innerHTML='<div class="trades-page"><h1 class="page-title">Trades</h1><section class="owner-section"><h2>Create a trade</h2><p class="muted">Choose items from your inventory and optionally items from another player. Leave their side empty to send a gift. Players can receive duplicates. Items are reserved while the offer is pending. Trades exchange items only and do not use real money.</p>'+
 '<form id="tradeTargetForm" class="trade-target-form"><label>Player username<input name="username" minlength="1" maxlength="20" required placeholder="Username"></label><button class="button" type="submit">Load inventories</button></form><div id="tradeBuilder" class="trade-builder"></div><div id="tradeMessage" class="muted"></div></section>'+
 '<section class="owner-section"><h2>Your trade offers</h2><div id="tradeList" class="trade-list">Loading trades...</div></section></div>';
 async function loadTrades(){
  const host=document.getElementById("tradeList");if(!host)return;
  try{
   const data=await api("/api/trades");
   if(!isActiveView(view)||!host.isConnected)return;
   const trades=data.trades||[];
   host.innerHTML=trades.length?trades.map(t=>{
    const incoming=t.recipient_id===me.id;
    const offeredItems=t.offeredItems||[],requestedItems=t.requestedItems||[];
    const storedOffered=JSON.parse(t.offered_items||"[]"),storedRequested=JSON.parse(t.requested_items||"[]");
    const validTradeItems=offeredItems.length===storedOffered.length&&requestedItems.length===storedRequested.length&&[...offeredItems,...requestedItems].every(x=>Number(x.is_limited)===1||Number(x.is_offsale)===1);
    const tradeTag=x=>'<small class="trade-limited-tag">'+(Number(x.is_limited)===1?'LIMITED':'OFF SALE')+'</small>';
    const items=(label,list)=>'<div class="trade-item-group"><strong>'+label+'</strong><div class="trade-item-list">'+(list.length?list.map(x=>'<span class="trade-item-chip">'+(x.image_url?'<img src="'+esc(x.image_url)+'" alt="">':'')+esc(x.name)+' '+tradeTag(x)+'</span>').join(""):'<span class="muted">No items</span>')+'</div></div>';
    return '<article class="trade-card"><div class="trade-card-heading"><strong>'+(incoming?'From '+esc(t.sender_name):'To '+esc(t.recipient_name))+'</strong><span class="trade-status trade-status-'+esc(t.status.toLowerCase())+'">'+esc(t.status)+'</span></div>'+
     items(incoming?'They offer':'You offered',offeredItems)+items(incoming?'You offer':'They requested',requestedItems)+
     (t.status==="PENDING"?(incoming?(validTradeItems?'<div class="trade-actions"><button class="primary" type="button" data-trade-action="accept" data-trade-id="'+esc(t.id)+'">Accept</button><button class="button secondary" type="button" data-trade-action="decline" data-trade-id="'+esc(t.id)+'">Decline</button></div>':'<p class="muted trade-invalid-note">This offer contains an item that is no longer Limited or Off Sale and cannot be accepted. Decline it.</p><div class="trade-actions"><button class="button secondary" type="button" data-trade-action="decline" data-trade-id="'+esc(t.id)+'">Decline</button></div>'):'<div class="trade-actions"><button class="button secondary" type="button" data-trade-action="cancel" data-trade-id="'+esc(t.id)+'">Cancel offer</button></div>'):'')+
     '</article>';
   }).join(""):'<div class="empty">You do not have any trades yet.</div>';
   host.querySelectorAll("[data-trade-action]").forEach(button=>button.addEventListener("click",async()=>{
    button.disabled=true;
    try{
     const action=button.dataset.tradeAction;
     await api("/api/trades/"+encodeURIComponent(button.dataset.tradeId),{method:"POST",body:JSON.stringify({action})});
     if(action==="accept"){
      ownershipLoaded=false;
      ownedItemIds=new Set();ownedItemCounts=new Map();
      try{
       const inventoryState=await api("/api/inventory");
       setOwnedInventory(inventoryState.items||[]);
       ownershipLoaded=true;
      }catch(error){console.warn("[Sakura trades] Could not refresh inventory after trade:",error)}
     }
     toast("Trade updated");
     await loadTrades();
    }catch(e){toast(e.message);button.disabled=false}
   }));
  }catch(e){host.textContent=e.message}
 }
 const targetForm=document.getElementById("tradeTargetForm");
 targetForm.addEventListener("submit",async e=>{
  e.preventDefault();
  const username=String(new FormData(targetForm).get("username")||"").trim();
  const builder=document.getElementById("tradeBuilder"),message=document.getElementById("tradeMessage");
  builder.textContent="Loading inventories...";message.textContent="";
  try{
   const [ownData,targetData]=await Promise.all([api("/api/inventory"),api("/api/profile/"+encodeURIComponent(username)+"/inventory")]);
   if(!isActiveView(view))return;
   const own=ownData.items||[],target=targetData.items||[];
   if(!target.length)message.textContent="That player has no items available to trade.";
   const uniqueEligible=items=>[...new Map(items.filter(item=>Number(item.is_limited)===1||Number(item.is_offsale)===1).map(item=>[item.id,item])).values()];
   const ownEligible=uniqueEligible(own),targetEligible=uniqueEligible(target);
    const checks=(list,prefix)=>list.map(item=>'<label class="trade-select-item"><input type="checkbox" value="'+esc(item.id)+'" data-trade-side="'+prefix+'"><span>'+(item.image_url?'<img src="'+esc(item.image_url)+'" alt="">':'')+'<span>'+esc(item.name)+' <small class="trade-limited-tag">'+(Number(item.is_limited)===1?'LIMITED':'OFF SALE')+'</small></span></span></label>').join("");
    if(!ownEligible.length&&!targetEligible.length)message.textContent="Trading is available for Limited and Off Sale items. Neither player has an eligible item.";
    else if(!ownEligible.length)message.textContent="You do not have any Limited or Off Sale items to offer.";
    else if(!targetEligible.length)message.textContent="That player does not have any Limited or Off Sale items to request.";
    builder.innerHTML='<div class="trade-pick-columns"><div><h3>Your tradeable items</h3><div class="trade-pick-list">'+(ownEligible.length?checks(ownEligible,"offered"):'<p class="muted">No tradeable items available.</p>')+'</div></div><div><h3>'+esc(username)+' tradeable items</h3><div class="trade-pick-list">'+(targetEligible.length?checks(targetEligible,"requested"):'<p class="muted">No tradeable items available.</p>')+'</div></div></div><button id="sendTradeOffer" class="primary" type="button" '+(!ownEligible.length&&!targetEligible.length?'disabled':'')+'>Send trade offer</button>';
    document.getElementById("sendTradeOffer").addEventListener("click",async()=>{
    const offeredIds=[...builder.querySelectorAll('[data-trade-side="offered"]:checked')].map(x=>x.value);
    const requestedIds=[...builder.querySelectorAll('[data-trade-side="requested"]:checked')].map(x=>x.value);
    if(!offeredIds.length&&!requestedIds.length){message.textContent="Select at least one item.";return}
    const button=document.getElementById("sendTradeOffer");button.disabled=true;message.textContent="Sending offer...";
    try{await api("/api/trades",{method:"POST",body:JSON.stringify({username,offeredIds,requestedIds})});message.textContent="Trade offer sent.";builder.innerHTML="";await loadTrades()}
    catch(err){message.textContent=err.message;button.disabled=false}
   });
  }catch(err){builder.textContent="";message.textContent=err.message}
 });
 await loadTrades();
}
async function groupsPage(){
 const view=beginView();
 renderSidebar("groups");
 app.innerHTML='<div class="groups-page"><h1 class="page-title">Groups</h1>'+
  (me?'<section class="owner-section"><h2>Create a group</h2><p class="muted">Creating a group costs '+currencyMarkup(100,"P$")+'</p><form id="groupCreateForm" class="group-create-form"><label>Group name<input name="name" minlength="3" maxlength="32" required placeholder="Your group name"></label><label>Description<textarea name="description" maxlength="300" rows="2" placeholder="What is this group about?"></textarea></label><button class="primary" type="submit">Create group · '+currencyMarkup(100,"P$")+'</button><span id="groupCreateMessage" class="muted"></span></form></section>':'<section class="owner-section"><p>Please <a href="/#login" data-page="login">log in</a> to create or join groups.</p></section>')+
  '<section class="owner-section"><h2>All Groups</h2><div id="groupsList" class="groups-list">Loading groups...</div></section></div>';
 const host=document.getElementById("groupsList");
 async function loadGroups(){
  try{
   const data=await api("/api/groups");
   if(!isActiveView(view)||!host?.isConnected)return;
   const groups=data.groups||[];
   host.innerHTML=groups.length?groups.map(group=>'<article class="group-card"><div class="group-card-mark">'+(group.avatar_url?'<img src="'+esc(group.avatar_url)+'" alt="">':esc(String(group.name||"?").slice(0,1).toUpperCase()))+'</div><div class="group-card-info"><h3><a href="/#group?id='+encodeURIComponent(group.id)+'" data-group-view="'+esc(group.id)+'">'+esc(group.name)+'</a>'+(Number(group.is_verified)===1?' <img class="verified-badge group-verified-badge" src="/verified.svg" alt="Verified group" title="Verified group">':'')+'</h3><p>'+esc(group.description||"No description.")+'</p><span class="muted">Owner: '+esc(group.owner_name)+' · '+Number(group.member_count||0).toLocaleString()+' members</span></div>'+(me?(Number(group.is_member)===1?'<button class="button secondary" type="button" disabled>Joined</button>':'<button class="button" type="button" data-join-group="'+esc(group.id)+'">Join</button>'):'')+'</article>').join(""):'<div class="empty">No groups yet. Be the first to create one.</div>';
  }catch(error){if(host?.isConnected)host.textContent=error.message}
 }
 host?.addEventListener("click",async event=>{
  const button=event.target.closest("[data-join-group]");
  if(!button)return;
  button.disabled=true;
  try{
   await api("/api/groups/"+encodeURIComponent(button.dataset.joinGroup)+"/join",{method:"POST"});
   toast("Joined group");
   await loadGroups();
  }catch(error){toast(error.message);button.disabled=false}
 });
 document.getElementById("groupCreateForm")?.addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget,values=new FormData(form),message=document.getElementById("groupCreateMessage"),button=form.querySelector("button[type=submit]");
  const data={name:String(values.get("name")||"").trim(),description:String(values.get("description")||"").trim(),
   is_limited:values.get("is_limited")==="1"};
  if(Number(me?.balance||0)<100){message.textContent="You need at least 100 P$ to create a group.";return}
  button.disabled=true;message.textContent="Creating group...";
  try{
   const result=await api("/api/groups",{method:"POST",body:JSON.stringify(data)});
   setUser({...me,balance:result.balance});
   form.reset();message.textContent="Group created.";
   toast("Group created");
   await loadGroups();
  }catch(error){message.textContent=error.message}
  finally{if(button.isConnected)button.disabled=false}
 });
 await loadGroups();
}

async function groupPage(groupId){
 const view=beginView();
 renderSidebar("groups");
 if(!groupId){app.innerHTML='<div class="empty">Group not found.</div>';return}
 app.innerHTML='<div class="empty">Loading group...</div>';
 try{
  const data=await api("/api/groups/"+encodeURIComponent(groupId));
  if(!isActiveView(view))return;
  const group=data.group||{},members=data.members||[];
  const mark=group.avatar_url?'<img src="'+esc(group.avatar_url)+'" alt="'+esc(group.name)+'">':esc(String(group.name||"?").slice(0,1).toUpperCase());
  const verifiedMark=Number(group.is_verified)===1?' <img class="verified-badge group-verified-badge" src="/verified.svg" alt="Verified group" title="Verified group">':'';
  const owner=Number(group.is_owner)===1;
  const member=Number(group.is_member)===1;
  const memberList=members.length?members.map(person=>'<article class="group-member"><div class="people-avatar">'+avatar(person.username)+'</div><div class="people-user-info"><strong><a href="/#profile?username='+encodeURIComponent(person.username)+'" data-profile="'+esc(person.username)+'">'+esc(person.username)+'</a>'+(person.group_role==="OWNER"?' <span class="group-owner-tag">OWNER</span>':'')+'</strong><span>'+esc(person.account_role||"USER")+' · Joined '+esc(new Date(person.joined_at+"Z").toLocaleDateString())+'</span></div></article>').join(""):'<div class="empty">No members yet.</div>';
  app.innerHTML='<div class="groups-page"><a href="/#groups" data-page="groups" class="item-back-link">‹ Back to Groups</a>'+
   '<section class="group-detail-card"><div class="group-detail-heading"><div class="group-detail-avatar">'+mark+'</div><div><h1>'+esc(group.name)+verifiedMark+'</h1><p class="muted">Owner: <a href="/#profile?username='+encodeURIComponent(group.owner_name)+'" data-profile="'+esc(group.owner_name)+'">'+esc(group.owner_name)+'</a> · '+Number(group.member_count||0).toLocaleString()+' members</p><span class="muted">Created '+esc(new Date(group.created_at+"Z").toLocaleDateString())+'</span></div></div>'+
   '<p class="group-detail-description">'+esc(group.description||"No description.")+'</p>'+
   (owner?'<form id="groupSettingsForm" class="group-create-form group-settings-form"><h2>Group settings</h2><label>Group name<input name="name" minlength="3" maxlength="32" required value="'+esc(group.name)+'"></label><label>Description<textarea name="description" maxlength="300" rows="3">'+esc(group.description||"")+'</textarea></label><div class="group-avatar-upload"><label for="groupAvatarFile">Group image</label><div class="group-avatar-upload-row"><div class="group-avatar-preview" id="groupAvatarPreview">'+mark+'</div><div class="group-avatar-file-controls"><input id="groupAvatarFile" name="avatar_file" type="file" accept="image/png,image/jpeg,image/webp"><span class="muted">PNG, JPG or WebP · up to 2 MB</span>'+(group.avatar_url?'<button class="button secondary" id="removeGroupAvatarBtn" type="button">Remove image</button>':'')+'</div></div></div><button class="primary" type="submit">Save settings</button><button class="button danger-button" id="deleteGroupBtn" type="button">Delete group</button><span id="groupSettingsMessage" class="muted"></span></form>':
    (me?(member?'<button class="button secondary" id="leaveGroupBtn" type="button">Leave group</button>':'<button class="primary" id="joinGroupBtn" type="button">Join group</button>'):'<p class="muted">Log in to join this group.</p>'))+
   '</section><section class="owner-section group-members-section"><h2>Members ('+Number(group.member_count||0).toLocaleString()+')</h2><div class="group-members-list">'+memberList+'</div></section></div>';
  document.getElementById("groupSettingsForm")?.addEventListener("submit",async event=>{
   event.preventDefault();
   const form=event.currentTarget,values=new FormData(form),message=document.getElementById("groupSettingsMessage"),button=form.querySelector('button[type="submit"]');
   const payload={name:String(values.get("name")||"").trim(),description:String(values.get("description")||"").trim()};
   const avatarFile=values.get("avatar_file");
   button.disabled=true;message.textContent="Saving group settings...";
   try{
    if(avatarFile instanceof File&&avatarFile.size){
     if(!["image/png","image/jpeg","image/webp"].includes(avatarFile.type))throw new Error("Choose a PNG, JPG or WebP image.");
     if(avatarFile.size>2*1024*1024)throw new Error("Group image must be 2 MB or smaller.");
     message.textContent="Uploading group image...";
     const upload=await fetch("/api/groups/"+encodeURIComponent(groupId)+"/avatar",{method:"PUT",credentials:"same-origin",headers:{"content-type":avatarFile.type},body:avatarFile});
     let uploaded={};try{uploaded=await upload.json()}catch{}
     if(!upload.ok)throw new Error(uploaded.error||"Group image upload failed.");
    }
    message.textContent="Saving group settings...";
    await api("/api/groups/"+encodeURIComponent(groupId),{method:"PATCH",body:JSON.stringify(payload)});
    toast("Group settings saved");
    await groupPage(groupId);
   }catch(error){message.textContent=error.message;button.disabled=false}
  });
  document.getElementById("groupAvatarFile")?.addEventListener("change",event=>{
   const file=event.currentTarget.files?.[0];
   const preview=document.getElementById("groupAvatarPreview");
   if(!file||!preview)return;
   if(!["image/png","image/jpeg","image/webp"].includes(file.type)){toast("Choose a PNG, JPG or WebP image.");event.currentTarget.value="";return}
   if(file.size>2*1024*1024){toast("Group image must be 2 MB or smaller.");event.currentTarget.value="";return}
   const reader=new FileReader();
   reader.onload=()=>{if(preview.isConnected)preview.innerHTML='<img src="'+esc(String(reader.result||""))+'" alt="Selected group image preview">'};
   reader.onerror=()=>toast("Could not preview this image.");
   reader.readAsDataURL(file);
  });
  document.getElementById("removeGroupAvatarBtn")?.addEventListener("click",async()=>{
   const button=document.getElementById("removeGroupAvatarBtn");
   button.disabled=true;
   try{
    const response=await fetch("/api/groups/"+encodeURIComponent(groupId)+"/avatar",{method:"DELETE",credentials:"same-origin"});
    let data={};try{data=await response.json()}catch{}
    if(!response.ok)throw new Error(data.error||"Could not remove group image.");
    toast("Group image removed");await groupPage(groupId);
   }catch(error){toast(error.message);button.disabled=false}
  });
  document.getElementById("deleteGroupBtn")?.addEventListener("click",async()=>{
   if(!confirm('Delete the group "'+group.name+'"? This cannot be undone.'))return;
   const button=document.getElementById("deleteGroupBtn");button.disabled=true;button.textContent="Deleting...";
   try{await api("/api/groups/"+encodeURIComponent(groupId),{method:"DELETE"});toast("Group deleted");page("groups")}
   catch(error){toast(error.message);button.disabled=false;button.textContent="Delete group"}
  });
  document.getElementById("joinGroupBtn")?.addEventListener("click",async()=>{
   const button=document.getElementById("joinGroupBtn");button.disabled=true;
   try{await api("/api/groups/"+encodeURIComponent(groupId)+"/join",{method:"POST"});toast("Joined group");await groupPage(groupId)}
   catch(error){toast(error.message);button.disabled=false}
  });
  document.getElementById("leaveGroupBtn")?.addEventListener("click",()=>{
   const leaveButton=document.getElementById("leaveGroupBtn");
   if(!leaveButton||leaveButton.disabled)return;
   const modal=document.createElement("div");
   modal.className="sakura-leave-backdrop";
   modal.innerHTML='<div class="sakura-leave-dialog" role="dialog" aria-modal="true" aria-labelledby="sakuraLeaveTitle"><div class="sakura-leave-face" aria-hidden="true">:((</div><h2 id="sakuraLeaveTitle">Why do you want to leave? :((</h2><p>Sakura will miss you. Are you really sure?</p><div class="sakura-leave-actions"><button class="button secondary" type="button" data-stay>I’ll stay</button><button class="button danger-button" type="button" data-leave>Leave anyway</button></div></div>';
   document.body.appendChild(modal);
   const stay=modal.querySelector("[data-stay]");
   const leave=modal.querySelector("[data-leave]");
   const face=modal.querySelector(".sakura-leave-face");
   const close=()=>modal.remove();
   stay.addEventListener("click",close);
   modal.addEventListener("click",event=>{if(event.target===modal)close()});
   leave.addEventListener("click",async()=>{
    if(leave.disabled)return;
    leave.disabled=true;stay.disabled=true;leave.textContent="Leaving...";
    face.classList.add("is-vanishing");
    await new Promise(resolve=>setTimeout(resolve,320));
    try{
     leaveButton.disabled=true;
     await api("/api/groups/"+encodeURIComponent(groupId)+"/leave",{method:"DELETE"});
     close();toast("Left group");await groupPage(groupId);
    }catch(error){
     close();toast(error.message);leaveButton.disabled=false;
    }
   });
  });
 }catch(error){
  if(isActiveView(view))app.innerHTML='<div class="empty">'+esc(error.message)+' <a href="/#groups" data-page="groups">Back to Groups</a></div>';
 }
}

async function settings(){
 const view=beginView();
 renderSidebar("settings");
 if(!me){app.innerHTML='<div class="empty">Please <a href="/#login" data-page="login">log in</a> first.</div>';return}
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
async function loadFriendsList(view=activeView){
 const host=document.getElementById("friendsContent");if(!host)return;
 try{
  const d=await api("/api/friends");
  setFriendRequestCount(Array.isArray(d.incoming)?d.incoming.length:0);
  if(!isActiveView(view)||!host.isConnected)return;
  const section=(title,list,kind)=>{
   const actionLabel=kind==="accept"?"Accept":title==="Sent Requests"?"Cancel request":"Remove friend";
   const rows=list.map(u=>'<article class="people-user friend-list-row">'+
    '<div class="people-avatar">'+avatar(u.username)+'</div>'+
    '<div class="people-user-info"><strong><a href="/#profile?username='+encodeURIComponent(u.username)+'" data-profile="'+esc(u.username)+'">'+esc(u.username)+'</a>'+(u.is_verified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</strong>'+
    '<span>'+esc(u.role||"USER")+'</span></div>'+
    (kind==="accept"
     ? '<span class="friend-action-buttons"><button class="button" type="button" data-friend-action="accept" data-friend-name="'+esc(u.username)+'">Accept</button><button class="button secondary" type="button" data-friend-action="decline" data-friend-name="'+esc(u.username)+'">Decline</button></span>'
     : '<button class="button secondary" type="button" data-friend-action="'+kind+'" data-friend-name="'+esc(u.username)+'">'+actionLabel+'</button>')+
   '</article>').join("");
   return '<section class="friends-section"><h2>'+title+' ('+list.length+')</h2>'+
    (rows||'<div class="op-profile-empty">Nothing here yet.</div>')+'</section>';
  };
  host.innerHTML=section("Friend Requests",d.incoming||[],"accept")+
   section("Friends",d.friends||[],"remove")+
   section("Sent Requests",d.outgoing||[],"remove");
  host.querySelectorAll("[data-friend-action]").forEach(button=>button.addEventListener("click",async()=>{
   const username=button.dataset.friendName;
   button.disabled=true;
   try{
    if(button.dataset.friendAction==="accept")await api("/api/friends/accept",{method:"POST",body:JSON.stringify({username})});
    else await api("/api/friends?username="+encodeURIComponent(username),{method:"DELETE"});
    if(isActiveView(view))await loadFriendsList(view);
   }catch(error){
    toast(error.message);
    if(button.isConnected)button.disabled=false;
   }
  }));
 }catch(error){
  if(isActiveView(view)&&host.isConnected)host.innerHTML='<div class="op-profile-empty">Could not load friends: '+esc(error.message)+'</div>';
 }
}
async function friends(){
 const view=beginView();
 renderSidebar("friends");
 if(!me){
  app.innerHTML='<div class="empty">Please <a href="/#login" data-page="login">log in</a> to manage your friends.</div>';
  return;
 }
 app.innerHTML='<div class="friends-page"><h1 class="page-title">Friends</h1><p class="page-subtitle">Manage friend requests and view your Sakura friends.</p><div id="friendsContent"><div class="op-profile-empty">Loading friends...</div></div></div>';
 await loadFriendsList(view);
}
function users(){
 const view=beginView();
 renderSidebar("users");
 app.innerHTML='<div class="rap-people-heading"><div><h1 class="page-title">People</h1><p class="page-subtitle">Search the Sakura community by username or User ID and open user profiles.</p></div><a class="button secondary" href="/#rap" data-page="rap">RAP Leaderboard</a></div><form id="peopleSearchForm" class="people-search"><input id="userSearch" class="search-input" placeholder="Username or User ID..." minlength="1" maxlength="32" autocomplete="off"><button class="button" type="submit">Search</button></form><div id="peopleHint" class="notice">Type a username or numeric User ID to find a player.</div><div id="userResults" class="people-results"></div>';
 const form=document.getElementById("peopleSearchForm");
 const input=document.getElementById("userSearch");
 const results=document.getElementById("userResults");
 const hint=document.getElementById("peopleHint");
 let latest=0;
 async function runSearch(){
  const requestId=++latest;
  const q=input.value.trim().slice(0,32);
  if(q.length<1){results.innerHTML="";hint.textContent="Type at least 1 character to find users. Search results will appear below.";hint.style.display="block";return}
  hint.textContent="Searching Sakura users...";
  hint.style.display="block";
  try{
   const d=await api("/api/search-users?q="+encodeURIComponent(q));
   if(requestId!==latest||!isActiveView(view))return;
   const found=Array.isArray(d.users)?d.users:[];
   hint.style.display="none";
   results.innerHTML=found.length?found.map(u=>'<article class="people-user"><div class="people-avatar">'+avatar(u.username)+'</div><div class="people-user-info"><strong>'+esc(u.username)+(u.is_verified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+(u.is_banned?' <span class="ban-pill">BANNED</span>':'')+'</strong><span>'+esc(u.role||"USER")+' · ID '+esc(u.public_id)+'</span></div>'+(u.is_banned?'<button class="button secondary" type="button" data-banned-account="'+esc(u.username)+'">View ban info</button>':'<button class="button" type="button" data-profile="'+esc(u.username)+'">View Profile</button>')+'</article>').join(""):'<div class="empty">No users found for “'+esc(q)+'”.</div>';
  }catch(e){if(requestId!==latest||!isActiveView(view))return;hint.textContent="Could not load users: "+e.message;hint.style.display="block";results.innerHTML=""}
 }
 form.addEventListener("submit",e=>{
  e.preventDefault();
  const q=input.value.trim().slice(0,32);
  history.replaceState({page:"users",query:q},"","#users?q="+encodeURIComponent(q));
  runSearch();
 });
 input.addEventListener("input",()=>{
  latest++;
  results.innerHTML="";
  hint.textContent=input.value.trim().length<1
   ?"Type at least 1 character to find users. Search results will appear below."
   :"Press Search to find matching Sakura users.";
  hint.style.display="block";
 });
 if(location.hash.startsWith("#users?")){
  input.value=new URLSearchParams(location.hash.split("?")[1]).get("q")||"";
  if(input.value.length>=1)runSearch();
 }
}


async function rapLeaderboardPage(){
 const view=beginView();
 renderSidebar("users");
 app.innerHTML='<div class="rap-leaderboard-page"><div class="rap-leaderboard-heading"><div><h1 class="page-title">Top 10 RAP</h1><p class="page-subtitle">Players ranked by the current P$ value of every item in their inventory.</p></div><a class="button secondary" href="/#users" data-page="users">People</a></div><div id="rapLeaderboardState" class="notice">Loading leaderboard...</div></div>';
 const host=document.getElementById("rapLeaderboardState");
 try{
  const data=await api("/api/rap-leaderboard");
  if(!isActiveView(view)||!host?.isConnected)return;
  const users=Array.isArray(data.users)?data.users:[];
  host.className=users.length?"rap-leaderboard-table-wrap":"notice";
  host.innerHTML=users.length
   ?'<table class="rap-leaderboard-table"><thead><tr><th>#</th><th>Player</th><th>User ID</th><th>Items</th><th>Total RAP</th></tr></thead><tbody>'+users.map((u,index)=>'<tr><td class="rap-rank-cell">#'+(index+1)+'</td><td><a class="rap-player-link" href="/#profile?id='+encodeURIComponent(u.public_id||"")+'" data-profile="'+esc(u.username)+'">'+esc(u.username)+(Number(u.is_verified)===1?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</a></td><td>'+esc(u.public_id)+'</td><td>'+Number(u.item_count||0).toLocaleString()+'</td><td>'+currencyMarkup(u.total_rap,"P$")+'</td></tr>').join("")+'</tbody></table>'
   :'<div class="empty">No inventory with P$ value has been found yet.</div>';
 }catch(error){
  if(!isActiveView(view)||!host?.isConnected)return;
  host.className="notice";
  host.textContent="Could not load the RAP leaderboard: "+error.message;
 }
}

function parseRobloxClothingReference(value){
 const raw=String(value||"").trim();
 if(/^[0-9]+$/.test(raw)){
  const assetId=Number(raw);
  return Number.isSafeInteger(assetId)&&assetId>0?{assetId,url:"https://www.roblox.com/catalog/"+assetId}:null;
 }
 try{
  const normalizedUrl=raw.startsWith("//")?"https:"+raw:/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)?raw:"https://"+raw;
  const source=new URL(normalizedUrl);
  if(source.protocol!=="https:"||!["roblox.com","www.roblox.com","m.roblox.com"].includes(source.hostname.toLowerCase()))return null;
  const pathParts=source.pathname.split("/").filter(Boolean);
  let assetId=0;
  if(["catalog","library"].includes(pathParts[0])&&/^[0-9]+$/.test(pathParts[1]||""))assetId=Number(pathParts[1]);
  else if(pathParts[0]==="marketplace"&&pathParts[1]==="asset"&&/^[0-9]+$/.test(pathParts[2]||""))assetId=Number(pathParts[2]);
  if(!Number.isSafeInteger(assetId)||assetId<1)return null;
  return {assetId,url:"https://www.roblox.com/catalog/"+assetId};
 }catch{return null}
}

async function createPage(){
 const view=beginView();
 renderSidebar("create");
 if(!me){
  app.innerHTML='<div class="creator-create-page"><h1 class="page-title">Create</h1><section class="creator-create-card"><h2>Sign in to create clothing</h2><p class="muted">Sign in to submit a Shirt or Pants item for review.</p><a class="primary" href="/#login" data-page="login">Log in</a></section></div>';
  return;
 }
 app.innerHTML='<div class="creator-create-page">'+
  '<div class="creator-create-heading"><div><h1 class="page-title">Create</h1><p class="page-subtitle">Submit classic clothing to the Sakura catalog</p></div></div>'+
  '<section class="creator-create-card"><h2>New clothing</h2><p class="muted">Only Shirts and Pants are available. Your item stays private until the Owner approves it. After approval it appears in the catalog and one free copy is added to your inventory.</p>'+
  '<form id="creatorSubmissionForm" class="creator-create-form">'+
   '<label>Item name<input name="name" maxlength="80" required placeholder="Name your clothing"></label>'+
   '<label>Type<select name="category">'+CREATABLE_CATEGORIES.map(category=>'<option value="'+category+'">'+(category==="Shirts"?"Shirt":"Pants")+'</option>').join("")+'</select></label>'+
   '<label>Description <span class="muted">(optional)</span><textarea name="description" maxlength="500" rows="3" placeholder="Tell players a little about this item"></textarea></label>'+
   '<label>Your price in P$<input name="price" type="number" min="0" max="1000000" step="1" value="50" required></label>'+
   '<label>Roblox item link or ID<input name="roblox_url" type="text" inputmode="url" autocomplete="off" maxlength="500" required placeholder="roblox.com/catalog/123456789 or 123456789"></label>'+

   '<div class="creator-create-actions"><button class="primary" type="submit">Submit for review</button><span id="creatorSubmissionMessage" class="muted" role="status"></span></div>'+
  '</form></section>'+
  '<section class="creator-submissions-section"><div class="creator-submissions-heading"><h2>My submissions</h2><span class="muted">Review status</span></div><div id="myCreatorSubmissions" class="creator-submissions-list">Loading submissions...</div></section>'+
 '</div>';
 const host=document.getElementById("myCreatorSubmissions");
 async function loadMySubmissions(){
  if(!host)return;
  try{
   const data=await api("/api/creator/submissions");
   if(!isActiveView(view)||!host.isConnected)return;
   const submissions=data.submissions||[];
   host.innerHTML=submissions.length?submissions.map(submission=>{
    const status=String(submission.status||"PENDING");
    const label=status==="APPROVED"?"Approved":status==="REJECTED"?"Declined":"Waiting for review";
    const itemLink=status==="APPROVED"
     ? (submission.created_item_id
       ? '<a href="/item/'+encodeURIComponent(submission.created_item_id)+'" data-item-view="'+esc(submission.created_item_id)+'">View in Catalog</a>'
       : '<span class="muted">This item was removed by the Owner.</span>')
     : '<span class="muted">'+(status==="REJECTED"?"This request was declined.":"Not visible in Catalog until approval.")+'</span>';
    return '<article class="creator-submission-status"><div><strong>'+esc(submission.name)+'</strong><span class="creator-submission-type">'+(submission.category==="Pants"?"Pants":"Shirt")+'</span></div><span class="creator-submission-state '+status.toLowerCase()+'">'+label+'</span><p class="muted">'+Number(submission.price||0).toLocaleString()+' P$ · '+new Date(submission.created_at+"Z").toLocaleString()+'</p>'+itemLink+'</article>';
   }).join(""):'<div class="creator-submissions-empty">You have not submitted any clothing yet.</div>';
  }catch(error){
   if(isActiveView(view)&&host.isConnected)host.textContent=error.message;
  }
 }
 await loadMySubmissions();
 const creatorPageHost=app.querySelector(".creator-create-page");
 creatorPageHost?.insertAdjacentHTML("beforeend",'<section class="creator-create-card model-creator-card"><h2>New 3D model</h2><p class="muted">Submit a 3D accessory for review. Provide a direct HTTPS link to a .glb or .gltf file. Your model is not published until an Asset Moderator approves it.</p><form id="creatorModelSubmissionForm" class="creator-create-form"><label>Model name<input name="name" maxlength="80" required placeholder="Name your model"></label><label>Description <span class="muted">(optional)</span><textarea name="description" maxlength="500" rows="3" placeholder="Describe the accessory"></textarea></label><label>Price in P$<input name="price" type="number" min="0" max="1000000" step="1" value="50" required></label><label>Direct 3D model link (.glb or .gltf)<input name="model_url" type="url" maxlength="1000" required placeholder="https://example.com/model.glb"></label><label>Preview image link <span class="muted">(optional)</span><input name="image_url" type="url" maxlength="500" placeholder="https://example.com/preview.png"></label><div class="creator-create-actions"><button class="primary" type="submit">Submit model for review</button><span id="creatorModelSubmissionMessage" class="muted" role="status"></span></div></form></section><section class="creator-submissions-section"><div class="creator-submissions-heading"><h2>My 3D model submissions</h2><span class="muted">Review status</span></div><div id="myModelSubmissions" class="creator-submissions-list">Loading submissions...</div></section>');
 const modelHost=document.getElementById("myModelSubmissions");
 async function loadMyModelSubmissions(){
  if(!modelHost)return;
  try{
   const data=await api("/api/creator/model-submissions");
   if(!isActiveView(view)||!modelHost.isConnected)return;
   const submissions=data.submissions||[];
   modelHost.innerHTML=submissions.length?submissions.map(submission=>{
    const status=String(submission.status||"PENDING");
    const label=status==="APPROVED"?"Approved":status==="REJECTED"?"Declined":"Waiting for review";
    const itemLink=status==="APPROVED"&&submission.created_item_id?'<a href="/item/'+encodeURIComponent(submission.created_item_id)+'" data-item-view="'+esc(submission.created_item_id)+'">View in Catalog</a>':'<span class="muted">'+(status==="REJECTED"?"This request was declined.":"Not visible in Catalog until approval.")+'</span>';
    return '<article class="creator-submission-status"><div><strong>'+esc(submission.name)+'</strong><span class="creator-submission-type">3D Model</span></div><span class="creator-submission-state '+status.toLowerCase()+'">'+label+'</span><p class="muted">'+Number(submission.price||0).toLocaleString()+' P$ · '+new Date(submission.created_at+"Z").toLocaleString()+'</p>'+itemLink+'</article>';
   }).join(""):'<div class="creator-submissions-empty">You have not submitted any 3D models yet.</div>';
  }catch(error){if(isActiveView(view)&&modelHost?.isConnected)modelHost.textContent=error.message}
 }
 await loadMyModelSubmissions();
 const modelForm=document.getElementById("creatorModelSubmissionForm");
 const modelMessage=document.getElementById("creatorModelSubmissionMessage");
 modelForm?.addEventListener("submit",async event=>{
  event.preventDefault();
  const data=new FormData(modelForm);
  const name=String(data.get("name")||"").trim();
  const description=String(data.get("description")||"").trim();
  const modelUrl=String(data.get("model_url")||"").trim();
  const imageUrl=String(data.get("image_url")||"").trim();
  const rawPrice=String(data.get("price")||"").trim();
  let validModelUrl=false,validImageUrl=!imageUrl;
  try{const parsed=new URL(modelUrl);validModelUrl=parsed.protocol==="https:"&&/\.(glb|gltf)$/i.test(parsed.pathname)}catch{}
  try{if(imageUrl)validImageUrl=new URL(imageUrl).protocol==="https:"}catch{}
  const price=Number(rawPrice);
  if(!name||name.length>80||description.length>500||!validModelUrl||!validImageUrl||!/^\d+$/.test(rawPrice)||!Number.isSafeInteger(price)||price<0||price>1000000){
   modelMessage.textContent="Check the name, description, price, and HTTPS .glb/.gltf link.";
   return;
  }
  const submit=modelForm.querySelector('button[type="submit"]');
  submit.disabled=true;modelMessage.textContent="Sending model for review...";
  try{
   await api("/api/creator/model-submissions",{method:"POST",body:JSON.stringify({name,description,price,model_url:modelUrl,image_url:imageUrl})});
   if(!isActiveView(view))return;
   modelForm.reset();modelMessage.textContent="Your model was sent for review.";toast("Model submitted");await loadMyModelSubmissions();
  }catch(error){modelMessage.textContent=error.message}
  finally{submit.disabled=false}
 });
 const form=document.getElementById("creatorSubmissionForm");
 const message=document.getElementById("creatorSubmissionMessage");
 const clearCreateValidation=()=>{
  if(message?.dataset.validationError==="true"){
   message.textContent="";
   delete message.dataset.validationError;
  }
 };
 form?.querySelectorAll("input,select,textarea").forEach(field=>{
  field.addEventListener("input",clearCreateValidation);
  field.addEventListener("change",clearCreateValidation);
 });
 form?.addEventListener("submit",async event=>{
  event.preventDefault();
  const submit=form.querySelector('button[type="submit"]');
  const data=new FormData(form);
  const name=String(data.get("name")||"").trim();
  const category=String(data.get("category")||"");
  const description=String(data.get("description")||"").trim();
  if(!name||name.length>80){
   message.dataset.validationError="true";
   message.textContent="Enter an item name between 1 and 80 characters.";
   return;
  }
  if(!CREATABLE_CATEGORIES.includes(category)){
   message.dataset.validationError="true";
   message.textContent="Choose Shirts or Pants.";
   return;
  }
  if(description.length>500){
   message.dataset.validationError="true";
   message.textContent="Description must be 500 characters or less.";
   return;
  }
  const rawPrice=String(data.get("price")??"").trim();
  if(!/^\d+$/.test(rawPrice)){
   message.dataset.validationError="true";
   message.textContent="Price must be a whole number from 0 to 1,000,000 P$.";
   return;
  }
  const price=Number(rawPrice);
  if(!Number.isSafeInteger(price)||price<0||price>1000000){
   message.dataset.validationError="true";
   message.textContent="Price must be a whole number from 0 to 1,000,000 P$.";
   return;
  }
  const robloxReference=parseRobloxClothingReference(data.get("roblox_url"));
  if(!robloxReference){
   message.dataset.validationError="true";
   message.textContent="Enter a valid Roblox catalog link or numeric item ID.";
   return;
  }
  delete message.dataset.validationError;
  const payload={name,category,description,price,roblox_url:robloxReference.url};
  submit.disabled=true;message.textContent="Sending request...";
  try{
   await api("/api/creator/submissions",{method:"POST",body:JSON.stringify(payload)});
   if(!isActiveView(view))return;
   form.reset();message.textContent="Your request was sent to the Owner for review.";
   toast("Clothing submitted for review");
   await loadMySubmissions();
  }catch(error){
   message.dataset.validationError="true";
   message.textContent=error.message;
  }finally{
   submit.disabled=false;
  }
 });
}

async function adminPanel(){
 const view=beginView();
 renderSidebar("admin-panel");
 if(!me||!me.isAdministrator){app.innerHTML='<div class="empty">Administrator badge required.</div>';return}
 const categories=["Hats","Hair","Faces","Shirts","Pants"];
 app.innerHTML='<div class="creator-create-page admin-panel-page">'+
  '<div class="creator-create-heading"><div><h1 class="page-title">Панель администратора</h1><p class="page-subtitle">Отправка новых предметов в каталог Sakura</p></div></div>'+
  '<section class="creator-create-card"><h2>Добавить предмет</h2><p class="muted">Заполни информацию о предмете и добавь его картинку. До проверки владельцем предмет не появится в общем каталоге.</p>'+
  '<form id="adminItemSubmissionForm" class="creator-create-form">'+
   '<label>Цена предмета в Sakura<input name="price" type="number" min="0" max="1000000" step="1" value="50" required></label>'+
   '<label>Валюта<select name="currency"><option value="P$">P$</option><option value="Tix">Tix</option></select></label>'+
   '<label>Категория<select name="category">'+categories.map(category=>'<option value="'+category+'">'+({Hats:"Шляпы",Hair:"Волосы",Faces:"Лица",Shirts:"Футболки",Pants:"Штаны"}[category]||category)+'</option>').join("")+'</select></label>'+
   '<label>Название предмета<input name="name" maxlength="80" required placeholder="Введи название предмета"></label>'+
   '<label>Ссылка на картинку предмета<input name="image_url" type="url" maxlength="500" required placeholder="https://..."></label>'+
   '<label class="admin-limited-option"><input name="is_limited" type="checkbox" value="1"> Сделать предмет Limited</label>'+
   '<label class="admin-limited-stock-field" style="display:none">Количество копий Limited<input name="stock_limit" type="number" min="1" max="1000000" step="1" value="100"></label>'+
   '<img id="adminItemImagePreview" class="creator-review-image-preview" alt="Предпросмотр предмета" hidden>'+
   '<label>Описание <span class="muted">(необязательно)</span><textarea name="description" maxlength="500" rows="3" placeholder="Опиши предмет"></textarea></label>'+
   '<div class="creator-create-actions"><button class="primary" type="submit">Отправить владельцу на проверку</button><span id="adminItemSubmissionMessage" class="muted" role="status"></span></div>'+
  '</form></section>'+
  '<section class="asset-tutorial admin-item-tutorial"><h2>КАК ДОБАВИТЬ ПРЕДМЕТ — ПОЛНЫЙ ГАЙД ДЛЯ НОВИЧКОВ</h2><p class="asset-tutorial-intro">Выполняй шаги по порядку. Скачивать картинку не нужно — понадобится только прямая ссылка на изображение.</p>'+
   '<article><h3>ШАГ 1 — ЗАПОЛНИ ИНФОРМАЦИЮ О ПРЕДМЕТЕ</h3><p>Сначала укажи цену предмета в Sakura. Выбери валюту (<strong>P$</strong> или <strong>Tix</strong>), затем категорию и точное название предмета. Проверь название, чтобы не было ошибок.</p></article>'+
   '<article><h3>ШАГ 2 — ОТКРОЙ МАРКЕТПЛЕЙС ROBLOX</h3><p>Открой <a href="https://www.roblox.com/catalog" target="_blank" rel="noopener noreferrer">маркетплейс Roblox</a> в новой вкладке. Найди предмет, который хочешь добавить в Sakura. Убедись, что выбрал именно его, а не похожую вещь.</p></article>'+
   '<article><h3>ШАГ 3 — ОТКРОЙ СТРАНИЦУ ПРЕДМЕТА</h3><p>Нажми на найденный предмет. Откроется его страница в Roblox. Подожди, пока полностью загрузится предпросмотр или рендер аватара. Проверь, что на изображении показан именно нужный предмет.</p></article>'+
   '<article><h3>ШАГ 4 — ПОДГОТОВЬ ИЗОБРАЖЕНИЕ</h3><p>В окне рендера найди значок <strong>перечёркнутого глаза</strong> и нажми на него, чтобы скрыть аватар, если эта кнопка доступна. Так будет проще выбрать картинку самого предмета. Не копируй ссылку на всю страницу Roblox.</p></article>'+
   '<article><h3>ШАГ 5 — СКОПИРУЙ ССЫЛКУ НА КАРТИНКУ</h3><p>Наведи курсор прямо на картинку предмета и нажми <strong>правой кнопкой мыши</strong>. В появившемся меню выбери <strong>«Копировать адрес изображения»</strong>. Ссылка на картинку скопируется в буфер обмена.</p><p>Если такого пункта нет, открой само изображение в новой вкладке. Затем скопируй адрес из адресной строки браузера.</p></article>'+
   '<article><h3>ШАГ 6 — ВСТАВЬ ССЫЛКУ В SAKURA</h3><p>Вернись в панель администратора Sakura. Вставь скопированную ссылку в поле <strong>«Ссылка на картинку предмета»</strong>. Ниже должен появиться предпросмотр. Проверь, что картинка правильная, а ссылка начинается с <strong>https://</strong>.</p></article>'+
   '<article><h3>ШАГ 7 — ПРОВЕРЬ И ОТПРАВЬ</h3><p>Ещё раз проверь цену, валюту, категорию, название и картинку. Нажми <strong>«Отправить владельцу на проверку»</strong>. Заявка отправится владельцу, но предмет <strong>пока не появится</strong> в публичном каталоге.</p></article>'+
   '<article><h3>ВАЖНО — ПУБЛИКОВАТЬ МОЖЕТ ТОЛЬКО ВЛАДЕЛЕЦ</h3><p>Администраторы могут только отправлять предметы на проверку. Самостоятельно публиковать их нельзя. Владелец проверяет каждую заявку и решает, одобрить её или отклонить. Только после нажатия владельцем кнопки <strong>«Опубликовать»</strong> предмет появится в общем каталоге Sakura.</p></article>'+
   '<article><h3>ЧАСТЫЕ ОШИБКИ</h3><p>Не вставляй ссылку на страницу Roblox вместо ссылки на картинку. Не отправляй нерабочую ссылку, изображение другого предмета или картинку, которую нельзя использовать. Если предпросмотр не загрузился, скопируй адрес изображения заново и проверь его.</p></article>'+
  '</section></div>';
 const form=document.getElementById("adminItemSubmissionForm");
 const message=document.getElementById("adminItemSubmissionMessage");
 const imageInput=form?.querySelector('input[name="image_url"]');
 const preview=document.getElementById("adminItemImagePreview");
 const limitedInput=form?.querySelector('input[name="is_limited"]');
 const limitedStockField=form?.querySelector(".admin-limited-stock-field");
 const updateLimitedStockVisibility=()=>{
  if(limitedStockField)limitedStockField.style.display=limitedInput?.checked?"":"none";
 };
 limitedInput?.addEventListener("change",updateLimitedStockVisibility);
 updateLimitedStockVisibility();
 imageInput?.addEventListener("input",()=>{
  try{
   const value=new URL(imageInput.value.trim());
   if(value.protocol!=="https:")throw new Error();
   preview.src=value.href;preview.hidden=false;
  }catch{preview.removeAttribute("src");preview.hidden=true;}
 });
 preview?.addEventListener("error",()=>{preview.hidden=true;});
 form?.addEventListener("submit",async event=>{
  event.preventDefault();
  if(!isActiveView(view))return;
  const values=new FormData(form);
  const payload={
   price:Number(values.get("price")),
   is_limited:values.get("is_limited")==="1",
   stock_limit:values.get("is_limited")==="1"?Number(values.get("stock_limit")||0):0,
   currency:String(values.get("currency")||"P$"),
   category:String(values.get("category")||""),
   name:String(values.get("name")||"").trim(),
   image_url:String(values.get("image_url")||"").trim(),
   description:String(values.get("description")||"").trim()
  };
  const submit=form.querySelector('button[type="submit"]');
  submit.disabled=true;message.textContent="Отправляем предмет владельцу...";
  try{
   await api("/api/admin/item-submissions",{method:"POST",body:JSON.stringify(payload)});
   if(!isActiveView(view))return;
   form.reset();preview.removeAttribute("src");preview.hidden=true;
   message.textContent="Предмет отправлен! Теперь он ожидает проверки владельцем и пока не виден в общем каталоге.";
   toast("Предмет отправлен владельцу на проверку");
  }catch(error){message.textContent=error.message}
  finally{submit.disabled=false}
 });
}

async function assetModeratorPage(){
 const view=beginView();
 renderSidebar("asset-panel");
 if(!me){app.innerHTML='<div class="empty">Please log in first.</div>';return}
 if(me.role!=="OWNER"&&!me.isAssetModerator){app.innerHTML='<div class="empty">Asset Moderator access required.</div>';return}
 app.innerHTML='<div class="asset-panel-page"><div class="asset-panel-heading"><div><h1 class="page-title">Asset Panel</h1><p class="page-subtitle">Review clothing and 3D model submissions from the Sakura community.</p></div><button type="button" class="button secondary" id="assetQueueRefresh">Refresh queue</button></div><div id="assetQueueList" class="asset-queue-list"><div class="op-profile-empty">Loading pending submissions...</div></div>'+
  '<section class="asset-tutorial"><h2>Как сохранить картинку одежды или аватара</h2><p class="asset-tutorial-intro">Делайте по порядку — каждый шаг очень простой.</p>'+
  '<article><h3>Шаг 1. Откройте оригинальную вещь</h3><p>В нужной заявке найдите ссылку <strong>«Открыть оригинал в Roblox»</strong> и нажмите на неё. Откроется страница этой футболки или штанов на сайте Roblox.</p></article>'+
  '<article><h3>Шаг 2. Найдите нужный рендер</h3><p>На странице найдите большое изображение вещи. Это может быть картинка самой одежды или изображение аватара Roblox, на котором она показана. Нажмите прямо на эту картинку, чтобы открыть её крупнее.</p></article>'+
  '<article><h3>Шаг 3. Сохраните изображение</h3><p>Когда картинка откроется, наведите на неё мышку и нажмите <strong>правой кнопкой</strong>. В меню выберите <strong>«Сохранить изображение как…»</strong>.</p></article>'+
  '<article><h3>Шаг 4. Выберите место</h3><p>Выберите папку на компьютере, например «Загрузки», и нажмите <strong>«Сохранить»</strong>. Всё — картинка сохранена.</p></article>'+
  '<article><h3>Не получается?</h3><p>Вернитесь в Sakura и нажмите <strong>«Открыть картинку предпросмотра»</strong> в заявке. Когда картинка откроется отдельно, нажмите по ней правой кнопкой мыши и выберите «Сохранить изображение как…».</p></article>'+
  '<article><h3>А если это 3D-модель?</h3><p>3D-модель — это не обычная картинка. Её не нужно сохранять через правую кнопку мыши: посмотрите её в окне предпросмотра, покрутите мышкой и проверьте, что она правильно отображается.</p></article></section></div>';
 const host=document.getElementById("assetQueueList");
 async function loadQueue(){
  if(!host)return;
  host.innerHTML='<div class="op-profile-empty">Loading pending submissions...</div>';
  try{
   const [clothingData,modelData]=await Promise.all([api("/api/owner/creator-submissions"),api("/api/asset-moderation/models")]);
   if(!isActiveView(view)||!host.isConnected)return;
   const clothing=clothingData.submissions||[],models=modelData.submissions||[],cards=[];
   for(const item of clothing){
    const assetId=Number(item.asset_id||0);
    const preview=assetId>0?"https://www.roblox.com/asset-thumbnail/image?assetId="+assetId+"&width=420&height=420&format=png":"";
    const original=String(item.roblox_url||"");
    cards.push('<article class="asset-submission-card"><div class="asset-submission-kind">Clothing · '+(item.category==="Pants"?"Pants":"Shirt")+'</div><div class="asset-submission-layout"><div class="asset-submission-preview">'+(preview?'<img src="'+esc(preview)+'" alt="Clothing preview" loading="lazy">':'<div class="asset-preview-missing">No preview available</div>')+'</div><div class="asset-submission-details"><h3>'+esc(item.name)+'</h3><p class="muted">Submitted by <a href="/#profile?username='+encodeURIComponent(item.username)+'" data-profile="'+esc(item.username)+'">'+esc(item.username)+'</a></p><p>'+esc(item.description||"No description provided.")+'</p><p class="asset-submission-meta">'+Number(item.price||0).toLocaleString()+' P$ · '+esc(new Date(item.created_at+"Z").toLocaleString())+'</p>'+(original?'<a class="asset-external-link" href="'+esc(original)+'" target="_blank" rel="noopener noreferrer">Открыть оригинал в Roblox</a>':'')+(preview?'<a class="asset-external-link" href="'+esc(preview)+'" target="_blank" rel="noopener noreferrer">Открыть картинку предпросмотра</a>':'')+'<div class="asset-review-actions"><button class="primary" type="button" data-asset-review="clothing" data-asset-id="'+esc(item.id)+'" data-asset-action="approve">Одобрить</button><button class="button danger-button" type="button" data-asset-review="clothing" data-asset-id="'+esc(item.id)+'" data-asset-action="reject">Отклонить</button></div></div></div></article>');
   }
   for(const item of models){
    const preview=String(item.image_url||"");
    cards.push('<article class="asset-submission-card"><div class="asset-submission-kind">3D Model · Accessory</div><div class="asset-submission-layout"><div class="asset-submission-preview asset-model-preview">'+(preview?'<img src="'+esc(preview)+'" alt="Model preview" loading="lazy">':'')+'<model-viewer src="'+esc(item.model_url)+'" alt="'+esc(item.name)+'" camera-controls auto-rotate rotation-per-second="20deg" shadow-intensity="1" exposure="1" loading="lazy" reveal="auto"></model-viewer></div><div class="asset-submission-details"><h3>'+esc(item.name)+'</h3><p class="muted">Submitted by <a href="/#profile?username='+encodeURIComponent(item.username)+'" data-profile="'+esc(item.username)+'">'+esc(item.username)+'</a></p><p>'+esc(item.description||"No description provided.")+'</p><p class="asset-submission-meta">'+Number(item.price||0).toLocaleString()+' P$ · '+esc(new Date(item.created_at+"Z").toLocaleString())+'</p><a class="asset-external-link" href="'+esc(item.model_url)+'" target="_blank" rel="noopener noreferrer">Открыть файл 3D-модели</a>'+(preview?'<a class="asset-external-link" href="'+esc(preview)+'" target="_blank" rel="noopener noreferrer">Открыть картинку предпросмотра</a>':'')+'<div class="asset-review-actions"><button class="primary" type="button" data-asset-review="model" data-asset-id="'+esc(item.id)+'" data-asset-action="approve">Одобрить</button><button class="button danger-button" type="button" data-asset-review="model" data-asset-id="'+esc(item.id)+'" data-asset-action="reject">Отклонить</button></div></div></div></article>');
   }
   host.innerHTML=cards.length?cards.join(""):'<div class="op-profile-empty">There are no pending asset submissions.</div>';
   host.querySelectorAll("[data-asset-review]").forEach(button=>button.addEventListener("click",async()=>{
    const kind=button.dataset.assetReview,submissionId=button.dataset.assetId,action=button.dataset.assetAction,card=button.closest(".asset-submission-card");
    if(action==="reject"&&!confirm("Reject this submission?"))return;
    card?.querySelectorAll("button").forEach(b=>b.disabled=true);
    try{
     if(kind==="clothing"){
      const submission=clothing.find(entry=>entry.id===submissionId),assetId=Number(submission?.asset_id||0);
      const payload={action};
      if(action==="approve"){payload.image_url=assetId>0?"https://www.roblox.com/asset-thumbnail/image?assetId="+assetId+"&width=420&height=420&format=png":"";payload.price=Number(submission?.price??50);}
      await api("/api/owner/creator-submissions/"+encodeURIComponent(submissionId),{method:"PATCH",body:JSON.stringify(payload)});
     }else{
      await api("/api/asset-moderation/models/"+encodeURIComponent(submissionId),{method:"PATCH",body:JSON.stringify({action})});
     }
     toast(action==="approve"?"Submission approved":"Submission rejected");
     if(isActiveView(view))await loadQueue();
    }catch(error){toast(error.message);card?.querySelectorAll("button").forEach(b=>b.disabled=false)}
   }));
  }catch(error){if(isActiveView(view)&&host.isConnected)host.innerHTML='<div class="op-profile-empty">Could not load submissions: '+esc(error.message)+'</div>'}
 }
 document.getElementById("assetQueueRefresh")?.addEventListener("click",loadQueue);
 await loadQueue();
}
async function owner(){
 const view=beginView();
 renderSidebar("owner");
 if(!me||me.role!=="OWNER"){app.innerHTML='<div class="empty">Owner access required.</div>';return}
 app.innerHTML='<h1 class="page-title">Owner Panel</h1><div id="ownerStats" class="item-grid">Loading...</div>'+
 '<section class="owner-section"><h2>Owner Account</h2><p class="muted">The current password cannot be displayed because Sakura stores only a password hash. While signed in as OWNER, set a new password here.</p><form id="ownerPasswordForm" class="owner-item-form"><label>New password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label>Confirm password<input name="confirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><button class="primary" type="submit">Set new owner password</button><span id="ownerPasswordMessage" class="muted"></span></form></section>'+
 '<section class="owner-section"><h2>Catalog Management</h2><p class="muted">Remove hides an item from the public catalog. Delete permanently removes it from player inventories, resale listings, trades, promo rewards and purchase history.</p><p class="muted">Accessories use real GLB/GLTF 3D models. Add a secure HTTPS model URL to enable the interactive preview. Accessories cannot be listed for sale without a model.</p><button class="button secondary" id="clearPublicCatalog" type="button">Remove all items from catalog</button><form id="newItemForm" class="owner-item-form">'+
 '<label>Item name<input name="name" maxlength="80" required></label>'+
 '<label>Category<select name="category">'+ITEM_CATEGORIES.map(c=>'<option>'+c+'</option>').join("")+'</select></label>'+
 '<label>Item price<input name="price" type="number" min="0" max="1000000" value="50" required></label>'+
  '<label>Price currency<select name="currency"><option value="P$">P$</option><option value="Tix">Tix</option></select></label>'+
 '<label class="owner-toggle"><span>Limited item</span><input name="is_limited" type="checkbox"></label>'+
 '<label class="owner-toggle"><span>Off Sale (visible, cannot buy)</span><input name="is_offsale" type="checkbox"></label>'+
 ' <label>Total stock (0 = unlimited)<input name="stock_limit" type="number" min="0" max="1000000" value="0" step="1"></label>'+
 '<label class="owner-toggle"><span>This item is a Gift</span><input name="is_gift" type="checkbox"></label>'+
 '<div id="ownerGiftOptions" style="display:none">'+
  '<label>Item inside the gift<select name="gift_reward_item_id" id="ownerGiftRewardItem"><option value="">Choose an existing catalog item</option></select></label>'+
  '<label>Gift opens at<input name="gift_opens_at" type="datetime-local"></label>'+
  '<p class="muted">Players can open this gift from their Inventory after the selected date and time. The selected item is guaranteed.</p>'+
 '</div>'+
 '<label>Preview image URL<input name="image_url" type="url" maxlength="500" placeholder="https://..."></label>'+
 '<label>3D model file (.glb, max 1 MB)<input name="model_file" type="file" accept=".glb,model/gltf-binary"></label>'+
 '<label>Or existing 3D model URL<input name="model_url" type="url" maxlength="1000" placeholder="https://...model.glb"></label>'+
 ''+
 ''+
 ''+
 '<label class="owner-description">Description<textarea name="description" maxlength="500" rows="2"></textarea></label>'+
 '<button class="primary" type="submit">Add Item</button><span id="ownerFormMessage" class="muted"></span></form>'+
 '<div id="ownerItems" class="owner-items">Loading items...</div></section>'+
 '<section class="owner-section owner-creator-submissions"><h2>Clothing submissions</h2><p class="muted">Review player Shirts and Pants. The player’s suggested price is prefilled and can be changed before publishing.</p><div id="ownerCreatorSubmissions" class="owner-creator-submissions-list">Loading submissions...</div></section>'+
 '<section class="owner-section owner-creator-submissions"><h2>Administrator item submissions</h2><p class="muted">Administrators can submit items, but only the Owner can publish them into the public Catalog.</p><div id="ownerAdminItemSubmissions" class="owner-creator-submissions-list">Loading admin submissions...</div></section>'+
 '<section class="owner-section"><h2>Game Management</h2><p class="muted">Create game cards with a title, description and thumbnail. All games remain locked and cannot be launched.</p><form id="newGameForm" class="owner-item-form"><label>Game title<input name="title" maxlength="80" required></label><label>Game thumbnail URL<input name="thumbnail_url" type="url" maxlength="500" placeholder="https://..."></label><label>Description<textarea name="description" maxlength="500" rows="3"></textarea></label><button class="primary" type="submit">Create game</button><span id="gameFormMessage" class="muted"></span></form><div id="ownerGames" class="owner-items">Loading games...</div></section><section class="owner-section owner-group-verification"><h2>Group Verification</h2><p class="muted">Give or remove the verified badge for Sakura groups. Only the site owner can change this.</p><div id="ownerGroups" class="owner-group-list">Loading groups...</div></section><section class="owner-section"><h2>User Management</h2><p class="muted">Search accounts to grant Sakura currency, issue warnings, or issue permanent account and IP bans. An IP ban can also affect other people sharing the same public internet connection. OWNER accounts are protected.</p><form id="ownerUserSearch" class="owner-item-form"><label>Username or User ID<input name="q" minlength="1" maxlength="32" required placeholder="Search user"></label><button class="primary" type="submit">Search</button></form><div id="ownerUserResults" class="owner-user-results"></div><div id="ownerUserDetails" class="owner-user-details"></div></section>';
 app.insertAdjacentHTML("beforeend",
  '<section class="owner-section owner-promocode-section"><h2>Promo Code Management</h2><p class="muted">Create codes that grant Sakura currency and one or more items from the catalog. Set a total claim limit and optional expiry date.</p>'+
  '<form id="ownerPromoForm" class="owner-item-form owner-promo-form">'+
  '<label>Promo code<input name="code" minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" placeholder="SAKURA2026" required></label>'+
  '<label>Currency reward amount<input name="reward_amount" type="number" min="0" max="1000000" step="1" value="0"></label>'+
  '<label>Currency<select name="reward_currency"><option value="P$">P$</option><option value="Tix">Tix</option></select></label>'+
  '<label>Reward items (you can select several)<select id="ownerPromoItems" name="item_ids" multiple size="8"></select></label>'+
  '<p class="muted">Leave the amount at 0 to make this an item-only code. You can combine items and currency.</p>'+
  '<label>Maximum total uses<input name="max_uses" type="number" min="1" max="1000000" step="1" placeholder="Unlimited"></label>'+
  '<label>Expires at (optional)<input name="expires_at" type="datetime-local"></label>'+
  '<button class="primary" type="submit">Create promo code</button><span id="ownerPromoMessage" class="muted" role="status"></span>'+
  '</form><div id="ownerPromoList" class="owner-promocode-list">Loading promo codes...</div></section>'
 );

 app.insertAdjacentHTML("beforeend",
  '<section class="owner-section owner-resale-moderation"><div class="owner-resale-heading"><div><h2>Resale Market Moderation</h2><p class="muted">Remove active resale listings. The seller keeps the item and no currency is transferred.</p></div><button class="button secondary" id="ownerResaleRefresh" type="button">Refresh</button></div><div id="ownerResaleListings" class="owner-resale-list">Loading resale listings...</div></section>'
 );

 const ownerResaleListingsHost=document.getElementById("ownerResaleListings");
 async function loadOwnerResaleListings(){
  if(!ownerResaleListingsHost)return;
  ownerResaleListingsHost.textContent="Loading resale listings...";
  try{
   const data=await api("/api/owner/resale-listings");
   if(!isActiveView(view)||!ownerResaleListingsHost.isConnected)return;
   const listings=Array.isArray(data.listings)?data.listings:[];
   ownerResaleListingsHost.innerHTML=listings.length?listings.map(listing=>{
    const createdRaw=String(listing.created_at||"");
    const createdDate=Date.parse(/[zZ]$/.test(createdRaw)?createdRaw:createdRaw.replace(" ","T")+"Z");
    const createdLabel=Number.isFinite(createdDate)?new Date(createdDate).toLocaleString():"";
    const seller=listing.seller_name
     ?'<a href="/#profile?id='+encodeURIComponent(listing.seller_public_id||"")+'" data-profile="'+esc(listing.seller_name)+'">'+esc(listing.seller_name)+'</a>'
     :'Unknown seller';
    return '<article class="owner-resale-row"><div class="owner-resale-details"><strong>'+esc(listing.item_name||"Unknown item")+'</strong><span>Seller: '+seller+'</span><span>Price: '+Number(listing.price||0).toLocaleString()+' '+esc(listing.currency||"P$")+'</span>'+(createdLabel?'<time>'+esc(createdLabel)+'</time>':'')+'</div><button class="button danger-button" type="button" data-owner-remove-resale="'+esc(listing.id)+'">Remove from market</button></article>';
   }).join(""):'<p class="muted owner-resale-empty">There are no active resale listings.</p>';
   ownerResaleListingsHost.querySelectorAll("[data-owner-remove-resale]").forEach(button=>button.addEventListener("click",async()=>{
    const listingId=button.dataset.ownerRemoveResale;
    if(!confirm("Remove this listing from the Resale Market? The seller will keep the item and no currency will be transferred."))return;
    button.disabled=true;button.textContent="Removing...";
    try{
     await api("/api/owner/resale-listings/"+encodeURIComponent(listingId),{method:"DELETE"});
     if(!isActiveView(view))return;
     toast("Listing removed from the Resale Market");
     await loadOwnerResaleListings();
    }catch(error){toast(error.message);button.disabled=false;button.textContent="Remove from market"}
   }));
  }catch(error){
   if(isActiveView(view)&&ownerResaleListingsHost.isConnected)ownerResaleListingsHost.textContent="Could not load resale listings: "+error.message;
  }
 }
 document.getElementById("ownerResaleRefresh")?.addEventListener("click",loadOwnerResaleListings);
 loadOwnerResaleListings();

 const ownerCreatorSubmissionsHost=document.getElementById("ownerCreatorSubmissions");
 async function loadOwnerCreatorSubmissions(){
  if(!ownerCreatorSubmissionsHost)return;
  ownerCreatorSubmissionsHost.textContent="Loading submissions...";
  try{
   const data=await api("/api/owner/creator-submissions");
   if(!isActiveView(view)||!ownerCreatorSubmissionsHost.isConnected)return;
   const submissions=data.submissions||[];
   ownerCreatorSubmissionsHost.innerHTML=submissions.length?submissions.map(submission=>
    '<article class="creator-review-row" data-creator-request="'+esc(submission.id)+'">'+
     '<div class="creator-review-details"><div class="creator-review-title"><h3>'+esc(submission.name)+'</h3><span class="creator-review-type">'+(submission.category==="Pants"?"Pants":"Shirt")+'</span></div>'+
     '<p class="muted">Submitted by <a href="/#profile?id='+encodeURIComponent(submission.creator_public_id||"")+'" data-profile="'+esc(submission.username)+'">'+esc(submission.username)+'</a></p>'+
     (submission.description?'<p class="creator-review-description">'+esc(submission.description)+'</p>':'')+
     '<a class="creator-original-link" href="'+esc(submission.roblox_url)+'" target="_blank" rel="noopener noreferrer">Открыть оригинал в Roblox</a>'+
     '<p class="muted creator-review-date">Submitted '+new Date(submission.created_at+"Z").toLocaleString()+'</p></div>'+
     '<form class="creator-review-form" data-creator-review="'+esc(submission.id)+'">'+
      '<label>Catalog image URL<input name="image_url" type="url" maxlength="500" required placeholder="https://..."></label>'+
      '<img class="creator-review-image-preview" alt="Catalog image preview" hidden>'+
      '<label>Price in P$<input name="price" type="number" min="0" max="1000000" step="1" value="'+Number(submission.price??50)+'" required></label>'+
      '<div class="creator-review-actions"><button class="primary" type="submit">Approve and publish</button><button class="button secondary" type="button" data-creator-reject="'+esc(submission.id)+'">Отклонить</button></div>'+
     '</form></article>'
   ).join(""):'<div class="creator-submissions-empty">No clothing requests are waiting for review.</div>';
   document.querySelectorAll("[data-creator-review]").forEach(form=>{
    const imageInput=form.querySelector('input[name="image_url"]');
    const preview=form.querySelector(".creator-review-image-preview");
    imageInput?.addEventListener("input",()=>{
     const value=imageInput.value.trim();
     try{
      const imageUrl=new URL(value);
      if(imageUrl.protocol!=="https:")throw new Error();
      preview.src=imageUrl.href;preview.hidden=false;
     }catch{preview.removeAttribute("src");preview.hidden=true;}
    });
    preview?.addEventListener("error",()=>{preview.hidden=true;});
    form.addEventListener("submit",async event=>{
     event.preventDefault();
     const button=form.querySelector('button[type="submit"]');
     const values=new FormData(form);
     const image_url=String(values.get("image_url")||"").trim();
     const price=Number(values.get("price"));
     button.disabled=true;button.textContent="Publishing...";
     try{
      const result=await api("/api/owner/creator-submissions/"+encodeURIComponent(form.dataset.creatorReview),{method:"PATCH",body:JSON.stringify({action:"approve",image_url,price})});
      if(!isActiveView(view))return;
      toast("Item published in the catalog");
      await loadOwnerCreatorSubmissions();
     }catch(error){toast(error.message);button.disabled=false;button.textContent="Approve and publish";}
    });
   });
   document.querySelectorAll("[data-creator-reject]").forEach(button=>button.addEventListener("click",async()=>{
    if(!confirm("Reject this clothing submission?"))return;
    button.disabled=true;button.textContent="Rejecting...";
    try{
     await api("/api/owner/creator-submissions/"+encodeURIComponent(button.dataset.creatorReject),{method:"PATCH",body:JSON.stringify({action:"reject"})});
     if(!isActiveView(view))return;
     toast("Submission rejected");
     await loadOwnerCreatorSubmissions();
    }catch(error){toast(error.message);button.disabled=false;button.textContent="Reject";}
   }));
  }catch(error){
   if(isActiveView(view)&&ownerCreatorSubmissionsHost.isConnected)ownerCreatorSubmissionsHost.textContent=error.message;
  }
 }
 loadOwnerCreatorSubmissions();
 const ownerAdminItemSubmissionsHost=document.getElementById("ownerAdminItemSubmissions");
 async function loadOwnerAdminItemSubmissions(){
  if(!ownerAdminItemSubmissionsHost)return;
  ownerAdminItemSubmissionsHost.textContent="Loading admin submissions...";
  try{
   const data=await api("/api/owner/admin-item-submissions");
   if(!isActiveView(view)||!ownerAdminItemSubmissionsHost.isConnected)return;
   const submissions=data.submissions||[];
   ownerAdminItemSubmissionsHost.innerHTML=submissions.length?submissions.map(submission=>
    '<article class="creator-review-row"><div class="creator-review-details"><div class="creator-review-title"><h3>'+esc(submission.name)+'</h3><span class="creator-review-type">'+esc(submission.category)+'</span></div>'+
    '<p class="muted">Submitted by <a href="/#profile?username='+encodeURIComponent(submission.username||"")+'" data-profile="'+esc(submission.username||"")+'">'+esc(submission.username||"Unknown")+'</a></p>'+
    '<p>'+esc(submission.description||"No description provided.")+'</p><p class="muted">'+Number(submission.price||0).toLocaleString()+' '+esc(submission.currency||"P$")+' · '+esc(new Date(submission.created_at+"Z").toLocaleString())+(Number(submission.is_limited)===1?' · LIMITED · '+Number(submission.stock_limit||0).toLocaleString()+' copies':'')+'</p>'+
    '<a class="asset-external-link" href="'+esc(submission.image_url)+'" target="_blank" rel="noopener noreferrer">Open submitted image</a>'+
    '<img class="creator-review-image-preview" src="'+esc(submission.image_url)+'" alt="Submitted item preview" loading="lazy">'+
    '<div class="creator-review-actions"><button class="primary" type="button" data-admin-item-action="approve" data-admin-item-id="'+esc(submission.id)+'">Publish</button><button class="button secondary" type="button" data-admin-item-action="reject" data-admin-item-id="'+esc(submission.id)+'">Reject</button></div></div></article>'
   ).join(""):'<div class="creator-submissions-empty">There are no administrator item submissions waiting for review.</div>';
   ownerAdminItemSubmissionsHost.querySelectorAll("[data-admin-item-action]").forEach(button=>button.addEventListener("click",async()=>{
    const action=button.dataset.adminItemAction,submissionId=button.dataset.adminItemId;
    if(action==="approve"&&!confirm("Publish this item into the public Sakura Catalog?"))return;
    if(action==="reject"&&!confirm("Reject this administrator item submission?"))return;
    button.disabled=true;
    try{
     await api("/api/owner/admin-item-submissions/"+encodeURIComponent(submissionId),{method:"PATCH",body:JSON.stringify({action:action==="approve"?"approve":"reject"})});
     if(!isActiveView(view))return;
     toast(action==="approve"?"Item published in the public Catalog":"Item submission rejected");
     await loadOwnerAdminItemSubmissions();
    }catch(error){toast(error.message);button.disabled=false}
   }));
  }catch(error){
   if(isActiveView(view)&&ownerAdminItemSubmissionsHost.isConnected)ownerAdminItemSubmissionsHost.textContent=error.message;
  }
 }
 loadOwnerAdminItemSubmissions();
 const promoForm=document.getElementById("ownerPromoForm");
 const promoItemSelect=document.getElementById("ownerPromoItems");
 const promoList=document.getElementById("ownerPromoList");
 const promoMessage=document.getElementById("ownerPromoMessage");
 async function loadOwnerPromocodes(){
  if(!promoList)return;
  try{
   const data=await api("/api/owner/promocodes");
   if(!isActiveView(view))return;
   const itemsData=data.items||[];
   promoItemSelect.innerHTML=itemsData.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+' · '+esc(item.category)+'</option>').join("");
   const codes=data.promocodes||[];
   promoList.innerHTML=codes.length?codes.map(code=>{
    const uses=Number(code.usage_count||0);
    const max=code.max_uses===null||code.max_uses===undefined?"Unlimited":Number(code.max_uses).toLocaleString();
    const expiry=code.expires_at?new Date(code.expires_at).toLocaleString():"No expiry";
    const rewards=[];
    if(Number(code.reward_amount)>0)rewards.push(Number(code.reward_amount).toLocaleString()+" "+(code.reward_currency||"P$"));
    if(code.item_names)rewards.push(code.item_names);
    return '<article class="owner-promocode-row"><div class="owner-promocode-details"><strong>'+esc(code.code)+'</strong><span class="muted">'+esc(rewards.join(" + ")||"No rewards")+'</span><span class="muted">Uses: '+uses.toLocaleString()+' / '+max+' · '+esc(expiry)+'</span></div><span class="owner-promocode-status '+(Number(code.is_active)===1?'is-active':'is-disabled')+'">'+(Number(code.is_active)===1?'Active':'Disabled')+'</span><button class="button secondary" type="button" data-toggle-promo="'+esc(code.code)+'" data-next-active="'+(Number(code.is_active)===1?'false':'true')+'">'+(Number(code.is_active)===1?'Disable':'Enable')+'</button></article>';
   }).join(""):'<p class="muted">No promo codes created yet.</p>';
   promoList.querySelectorAll("[data-toggle-promo]").forEach(button=>button.addEventListener("click",async()=>{
    button.disabled=true;
    try{
     await api("/api/owner/promocodes/"+encodeURIComponent(button.dataset.togglePromo),{method:"PATCH",body:JSON.stringify({is_active:button.dataset.nextActive==="true"})});
     await loadOwnerPromocodes();
     toast("Promo code status updated");
    }catch(error){toast(error.message);button.disabled=false}
   }));
  }catch(error){if(promoList)promoList.textContent=error.message}
 }
 promoForm?.addEventListener("submit",async e=>{
  e.preventDefault();
  const values=new FormData(promoForm);
  const code=String(values.get("code")||"").trim().toUpperCase();
  const itemIds=[...promoItemSelect.selectedOptions].map(option=>option.value);
  const rawExpiry=String(values.get("expires_at")||"");
  let expiresAt=null;
  if(rawExpiry){
   const expiryDate=new Date(rawExpiry);
   if(!Number.isFinite(expiryDate.getTime())){promoMessage.textContent="Choose a valid expiry date.";return}
   expiresAt=expiryDate.toISOString();
  }
  const data={
   code,
   reward_amount:Number(values.get("reward_amount")||0),
   reward_currency:String(values.get("reward_currency")||"P$"),
   item_ids:itemIds,
   max_uses:String(values.get("max_uses")||"").trim()||null,
   expires_at:expiresAt
  };
  const button=promoForm.querySelector("button[type=submit]");
  button.disabled=true;promoMessage.textContent="Creating promo code...";
  try{
   await api("/api/owner/promocodes",{method:"POST",body:JSON.stringify(data)});
   promoForm.reset();
   promoMessage.textContent="Promo code created.";
   await loadOwnerPromocodes();
   toast("Promo code created");
  }catch(error){promoMessage.textContent=error.message}
  finally{button.disabled=false}
 });
 loadOwnerPromocodes();
 const userSearch=document.getElementById("ownerUserSearch");
 const userResults=document.getElementById("ownerUserResults");
 const userDetails=document.getElementById("ownerUserDetails");
 const gameForm=document.getElementById("newGameForm");
 const ownerGames=document.getElementById("ownerGames");
 const ownerGroups=document.getElementById("ownerGroups");
 async function loadOwnerGroups(){
  if(!ownerGroups)return;
  try{
   const data=await api("/api/owner/groups");
   if(!isActiveView(view))return;
   const groups=data.groups||[];
   ownerGroups.innerHTML=groups.length?groups.map(group=>'<article class="owner-group-row"><div><strong>'+esc(group.name)+'</strong><span class="muted">Owner: '+esc(group.owner_name)+' · '+Number(group.member_count||0).toLocaleString()+' members</span></div><span class="group-verification-status '+(Number(group.is_verified)===1?'is-verified':'')+'">'+(Number(group.is_verified)===1?'Verified':'Not verified')+'</span><button class="button '+(Number(group.is_verified)===1?'secondary':'')+'" type="button" data-group-verify="'+esc(group.id)+'" data-next-action="'+(Number(group.is_verified)===1?'unverify':'verify')+'">'+(Number(group.is_verified)===1?'Remove tick':'Give tick')+'</button></article>').join(""):'<p class="muted">No groups have been created yet.</p>';
   ownerGroups.querySelectorAll("[data-group-verify]").forEach(button=>button.addEventListener("click",async()=>{
    button.disabled=true;
    try{
     await api("/api/owner/groups/"+encodeURIComponent(button.dataset.groupVerify),{method:"POST",body:JSON.stringify({action:button.dataset.nextAction})});
     toast(button.dataset.nextAction==="verify"?"Group verified":"Group verification removed");
     await loadOwnerGroups();
    }catch(error){toast(error.message);button.disabled=false}
   }));
  }catch(error){ownerGroups.textContent=error.message}
 }
 async function loadOwnerGames(){
  if(!ownerGames)return;
  try{
   const data=await api("/api/owner/games");
   if(!isActiveView(view))return;
   const games=data.games||[];
   ownerGames.innerHTML=games.length?games.map(game=>'<article class="owner-game-row"><div class="owner-game-thumb">'+(game.thumbnail_url?'<img src="'+esc(game.thumbnail_url)+'" alt="">':'')+'</div><div class="owner-game-info"><strong>'+esc(game.title)+'</strong><p class="muted">'+esc(game.description||"")+'</p></div><button class="button secondary" type="button" data-delete-game="'+esc(game.id)+'">Delete</button></article>').join(""):'<p class="muted">No games created.</p>';
   ownerGames.querySelectorAll("[data-delete-game]").forEach(button=>button.addEventListener("click",async()=>{
    if(!confirm("Delete this game card?"))return;
    button.disabled=true;
    try{await api("/api/owner/games/"+encodeURIComponent(button.dataset.deleteGame),{method:"DELETE"});await loadOwnerGames();toast("Game deleted")}
    catch(error){toast(error.message);button.disabled=false}
   }));
  }catch(error){ownerGames.textContent=error.message}
 }
 gameForm?.addEventListener("submit",async e=>{
  e.preventDefault();
  const values=new FormData(gameForm),message=document.getElementById("gameFormMessage");
  const data={title:String(values.get("title")||"").trim(),thumbnail_url:String(values.get("thumbnail_url")||"").trim(),description:String(values.get("description")||"").trim()};
  message.textContent="Creating...";
  try{await api("/api/owner/games",{method:"POST",body:JSON.stringify(data)});gameForm.reset();message.textContent="Game created. It will appear locked on the Games page.";await loadOwnerGames()}
  catch(error){message.textContent=error.message}
 });
 loadOwnerGames();
 loadOwnerGroups();
 async function loadOwnerUser(userId){
  userDetails.innerHTML='<p class="muted">Loading account...</p>';
  try{
   const d=await api("/api/owner/users/"+encodeURIComponent(userId));
   if(!isActiveView(view))return;
   const u=d.user;
   userDetails.innerHTML='<div class="owner-user-card"><h3>'+esc(u.username)+(u.is_verified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</h3><div class="muted">User ID: '+esc(u.public_id)+'</div><p>Role: '+esc(u.role)+' · '+currencyMarkup(u.balance,"P$")+' · '+currencyMarkup(u.tix_balance,"Tix")+' · Status: '+(u.is_banned?'BANNED':'Active')+' · Verified: '+(u.is_verified?'Yes':'No')+' · IP: '+(u.is_ip_banned?'PERMANENTLY BLOCKED':'Not blocked')+'</p>'+(u.is_ip_banned?'<div class="ban-admin-summary"><strong>Permanent IP ban active</strong><p>New registrations and API access from this public IP are blocked. Other people using the same internet connection may also be affected.</p></div>':u.has_recorded_ip?'<p class="muted">Latest public IP recorded. Banning this account will also permanently block that IP.</p>':'<p class="muted">No IP has been recorded for this account yet. IP tracking starts after its next successful sign-in or authenticated visit.</p>')+(u.is_banned?'<div class="ban-admin-summary"><strong>Active ban</strong><p>Reason: '+esc(u.ban_reason||"Account banned by moderation")+'</p><span class="muted">Banned on: '+esc(u.banned_at?new Date(String(u.banned_at).replace(" ","T")+"Z").toLocaleString():"Date unavailable")+'</span></div>':'')+
    (u.role==="OWNER"?'<p class="muted">OWNER accounts cannot be modified.</p>':
    '<div class="owner-user-actions"><form id="ownerCreditForm" class="owner-item-form"><h4>Give Sakura currency</h4><label>Amount<input name="amount" type="number" min="1" max="1000000" required></label><label>Currency<select name="currency"><option value="P$">P$</option><option value="Tix">Tix</option></select></label><label>Note (optional)<input name="reason" maxlength="500"></label><button class="primary" type="submit">Give currency</button></form>'+
    '<form id="ownerWarnForm" class="owner-item-form"><h4>Issue warning</h4><label>Reason<textarea name="reason" minlength="3" maxlength="500" required></textarea></label><button class="primary" type="submit">Send warning</button></form>'+
    (u.is_banned?'<button type="button" class="button" id="ownerUnban">Unban account</button>':'<form id="ownerBanForm" class="owner-item-form"><h4>Ban account</h4><label>Reason<textarea name="reason" minlength="3" maxlength="500" required></textarea></label><button type="submit" class="button secondary">' + (u.has_recorded_ip?'Ban account + IP':'Ban account · IP not recorded') + '</button></form>')+(u.is_ip_banned?'<button type="button" class="button secondary" id="ownerUnbanIp">Remove permanent IP ban</button>':'')+'</div>')+

    (u.role==="OWNER"?"":'<form id="ownerPublicIdForm" class="owner-item-form owner-id-form"><h4>Change public User ID</h4><p class="muted">Must be unique. Existing profile links using the old ID will stop working.</p><label>New numeric ID<input name="publicId" type="number" min="1" max="2147483647" step="1" value="'+Number(u.public_id||0)+'" required></label><button class="primary" type="submit">Save User ID</button></form>')+
    '<h4>Warnings</h4>'+(d.warnings.length?'<ul>'+d.warnings.map(x=>'<li>'+esc(x.reason)+' <span class="muted">('+new Date(x.created_at+"Z").toLocaleString()+')</span></li>').join("")+'</ul>':'<p class="muted">No warnings.</p>')+
    '<h4>Moderation history</h4>'+(d.logs.length?'<ul>'+d.logs.map(x=>'<li><strong>'+esc(x.action)+'</strong> '+esc(x.details)+' <span class="muted">('+new Date(x.created_at+"Z").toLocaleString()+')</span></li>').join("")+'</ul>':'<p class="muted">No actions recorded.</p>')+'</div>';
   const assignedBadges=new Set(u.badges||[]);
   if(u.is_verified)assignedBadges.add("VERIFIED");
   const badgeOptions=[
    ["VERIFIED","Verified"],
    ["ADMINISTRATOR","Administrator"],
    ["ASSET_MODERATOR","Asset Moderator"],
    ["EARLY_SUPPORTER","Early Supporter"],
    ["CONTRIBUTOR","Contributor"],
    ["CREATOR","Creator"],
    ["COMMUNITY_HELPER","Community Helper"]
   ];
   userDetails.querySelector(".owner-user-card")?.insertAdjacentHTML("beforeend",'<section class="owner-badge-manager"><h4>Badges and Permissions</h4><p class="muted">Grant or remove profile badges. Asset Moderator gives access only to Asset Panel.</p>'+badgeOptions.map(([key,label])=>{
    const enabled=assignedBadges.has(key);
    return '<div class="owner-badge-row"><span><strong>'+label+'</strong><small>'+(enabled?'Granted':'Not granted')+'</small></span><button class="button '+(enabled?'secondary':'')+'" type="button" data-owner-badge-toggle="'+key+'" data-enabled="'+(enabled?'1':'0')+'">'+(enabled?'Remove':'Grant')+'</button></div>';
   }).join("")+'</section>');
   userDetails.querySelectorAll("[data-owner-badge-toggle]").forEach(button=>button.addEventListener("click",async()=>{
    const badgeKey=button.dataset.ownerBadgeToggle;
    const action=button.dataset.enabled==="1"?"revoke_badge":"grant_badge";
    button.disabled=true;
    try{
     await api("/api/owner/badges/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action,badgeKey})});
     toast(action==="grant_badge"?"Badge granted":"Badge removed");
     await loadOwnerUser(userId);
     await refreshMe();
    }catch(error){toast(error.message);button.disabled=false}
   }));
   document.getElementById("ownerCreditForm")?.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:"credit",amount:Number(f.get("amount")),currency:String(f.get("currency")||"P$"),reason:String(f.get("reason")||"")})});toast("Currency granted");await loadOwnerUser(userId);await refreshMe();}
    catch(err){toast(err.message)}
   });
   document.getElementById("ownerPublicIdForm")?.addEventListener("submit",async e=>{
    e.preventDefault();
    const publicId=Number(new FormData(e.currentTarget).get("publicId"));
    try{
     await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:"set_public_id",publicId})});
     toast("User ID updated");
     await loadOwnerUser(userId);
    }catch(err){toast(err.message)}
   });
   document.getElementById("ownerWarnForm")?.addEventListener("submit",async e=>{
    e.preventDefault();const reason=String(new FormData(e.currentTarget).get("reason")||"");
    try{await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:"warn",reason})});toast("Warning issued");await loadOwnerUser(userId);}
    catch(err){toast(err.message)}
   });
   document.getElementById("ownerBanForm")?.addEventListener("submit",async e=>{
    e.preventDefault();const reason=String(new FormData(e.currentTarget).get("reason")||"");
    if(!confirm("Permanently ban "+u.username+" and block the latest recorded public IP? Everyone sharing that same internet connection may also lose access. This IP ban will remain even if the account is later unbanned."))return;
    try{await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:"ban",reason})});toast(u.has_recorded_ip?"Account and IP permanently banned":"Account banned; no IP was recorded yet");await loadOwnerUser(userId);}
    catch(err){toast(err.message)}
   });
   document.getElementById("ownerUnban")?.addEventListener("click",async()=>{
    try{await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:"unban"})});toast("Account unbanned; IP ban remains active");await loadOwnerUser(userId);}
    catch(err){toast(err.message)}
   });
   document.getElementById("ownerUnbanIp")?.addEventListener("click",async()=>{
    if(!confirm("Remove the permanent IP ban? This may restore access to everyone using that public internet connection."))return;
    try{await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:"unban_ip"})});toast("Permanent IP ban removed");await loadOwnerUser(userId);}
    catch(err){toast(err.message)}
   });
  }catch(e){userDetails.textContent=e.message}
 }
 userSearch.addEventListener("submit",async e=>{
  e.preventDefault();const q=String(new FormData(userSearch).get("q")||"").trim();userResults.textContent="Searching...";
  try{
   const d=await api("/api/owner/users?q="+encodeURIComponent(q));
   if(!isActiveView(view))return;
   userResults.innerHTML=d.users.length?d.users.map(u=>'<button type="button" class="owner-user-result" data-owner-user-id="'+esc(u.id)+'"><strong>'+esc(u.username)+(u.is_verified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</strong><span>ID '+esc(u.public_id)+' · '+esc(u.role)+' · '+Number(u.balance).toLocaleString()+' P$ · '+Number(u.tix_balance||0).toLocaleString()+' Tix · '+(u.is_banned?'BANNED':'Active')+'</span></button>').join(""):'<p class="muted">No matching users.</p>';
   userResults.querySelectorAll("[data-owner-user-id]").forEach(b=>b.addEventListener("click",()=>loadOwnerUser(b.dataset.ownerUserId)));
   userDetails.innerHTML="";
  }catch(err){userResults.textContent=err.message}
 });
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
    '<div class="owner-item-thumb">'+itemPreview(x)+'</div>'+
    '<div class="owner-item-fields"><input name="name" value="'+esc(x.name)+'" maxlength="80" required>'+
    '<div class="owner-item-subfields"><select name="category">'+ITEM_CATEGORIES.map(c=>'<option value="'+c+'" '+(c===x.category?'selected':'')+'>'+c+'</option>').join("")+'</select><input name="price" type="number" min="0" max="1000000" value="'+Number(x.price)+'" required><select name="currency"><option value="P$" '+((x.currency||"P$")==="P$"?'selected':'')+'>P$</option><option value="Tix" '+(x.currency==="Tix"?'selected':'')+'>Tix</option></select><input name="image_url" type="url" maxlength="500" value="'+esc(x.image_url||"")+'" placeholder="Image URL"><input name="model_url" type="url" maxlength="1000" value="'+esc(x.model_url||"")+'" placeholder="3D model URL (.glb / .gltf)"><label class="owner-inline-check"><input name="is_limited" type="checkbox" '+(Number(x.is_limited)===1?'checked':'')+'> Limited</label><input name="stock_limit" type="number" min="0" max="1000000" step="1" value="'+Number(x.stock_limit||0)+'" placeholder="Total stock (0 = unlimited)"><label class="owner-inline-check"><input name="is_offsale" type="checkbox" '+(Number(x.is_offsale)===1?'checked':'')+'> Off Sale</label></div>'+
    '<textarea name="description" rows="2" maxlength="500">'+esc(x.description||"")+'</textarea><span class="muted">'+(x.is_for_sale?(Number(x.is_offsale)===1?'Off Sale':'For sale'):'Removed from catalog')+' · '+(Number(x.stock_limit)>0?(Number(x.stock_sold||0)+' / '+Number(x.stock_limit)+' sold · '+Math.max(0,Number(x.stock_limit)-Number(x.stock_sold||0))+' left'):(Number(x.stock_sold||0)+' sold · unlimited stock'))+(Number(x.is_gift)===1?' · GIFT → '+esc(x.gift_reward_name||"Missing reward")+' · opens '+(x.gift_opens_at?esc(new Date(x.gift_opens_at).toLocaleString()):"date unavailable"):'')+'</span></div>'+
    '<div class="owner-item-actions"><button class="button" type="submit">Save</button>'+(x.is_for_sale?'<button class="button secondary" type="button" data-remove-item="'+esc(x.id)+'">Remove</button>':'<button class="button" type="button" data-restore-item="'+esc(x.id)+'">Restore</button>')+'<button class="button danger-button" type="button" data-delete-item="'+esc(x.id)+'">Delete permanently</button></div></form>').join(""):'<div class="empty">No catalog items yet.</div>';
   document.querySelectorAll("[data-edit-item]").forEach(form=>form.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(form),id=form.dataset.editItem;
    try{
     const updated={name:String(f.get("name")).trim(),category:String(f.get("category")),price:Number(f.get("price")),currency:String(f.get("currency")||"P$"),image_url:String(f.get("image_url")||""),model_url:String(f.get("model_url")||""),description:String(f.get("description")||""),is_limited:f.get("is_limited")==="on",is_offsale:f.get("is_offsale")==="on",stock_limit:Number(f.get("stock_limit")||0)};
     await api("/api/owner/items/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify(updated)});
     if(!isActiveView(view))return;
     ownerItems=ownerItems.map(item=>item.id===id?{...item,...updated,is_limited:updated.is_limited?1:0,is_offsale:updated.is_offsale?1:0}:item);
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
   document.querySelectorAll("[data-delete-item]").forEach(button=>button.addEventListener("click",async()=>{
    const id=button.dataset.deleteItem;
    const item=ownerItems.find(entry=>entry.id===id);
    if(!confirm("Permanently delete "+(item?.name||"this item")+"? It will be removed from all player inventories, resale listings, active trades, promo rewards and purchase history. This cannot be undone and no refunds will be issued."))return;
    button.disabled=true;
    try{
     await api("/api/owner/items/"+encodeURIComponent(id)+"?permanent=1",{method:"DELETE"});
     if(!isActiveView(view))return;
     ownerItems=ownerItems.filter(entry=>entry.id!==id);
     drawOwnerItems();updateOwnerItemCount();toast("Item permanently deleted");
    }catch(e){toast(e.message);button.disabled=false}
   }));
  }
  drawOwnerItems();
  const newItemForm=document.getElementById("newItemForm");
  if(!newItemForm)return;
  const giftToggle=newItemForm.elements.is_gift;
  const giftOptions=document.getElementById("ownerGiftOptions");
  const giftRewardSelect=document.getElementById("ownerGiftRewardItem");
  const updateGiftOptions=()=>{
   if(giftOptions)giftOptions.style.display=giftToggle?.checked?"":"none";
   if(giftRewardSelect)giftRewardSelect.required=Boolean(giftToggle?.checked);
   if(newItemForm.elements.gift_opens_at)newItemForm.elements.gift_opens_at.required=Boolean(giftToggle?.checked);
  };
  if(giftRewardSelect){
   const rewardOptions=ownerItems.filter(item=>Number(item.is_for_sale)===1&&Number(item.is_offsale)===1&&Number(item.is_gift)!==1);
   giftRewardSelect.innerHTML='<option value="">Choose an Offsale catalog item</option>'+rewardOptions.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+' · '+esc(item.category)+' · Offsale</option>').join("");
  }
  giftToggle?.addEventListener("change",updateGiftOptions);
  updateGiftOptions();
  newItemForm.addEventListener("submit",async e=>{
   e.preventDefault();const f=new FormData(e.target),msg=document.getElementById("ownerFormMessage");msg.textContent="Saving...";
   try{
    const isGift=f.get("is_gift")==="on";
    const giftDateRaw=String(f.get("gift_opens_at")||"");
    let giftOpensAt="";
    if(isGift){
     if(!giftDateRaw)throw new Error("Choose when the gift should open.");
     const parsedGiftDate=new Date(giftDateRaw);
     if(!Number.isFinite(parsedGiftDate.getTime()))throw new Error("Choose a valid gift opening date and time.");
     giftOpensAt=parsedGiftDate.toISOString();
     if(!String(f.get("gift_reward_item_id")||""))throw new Error("Choose the item inside the gift.");
    }
    const data={name:String(f.get("name")).trim(),category:String(f.get("category")),price:Number(f.get("price")),currency:String(f.get("currency")||"P$"),image_url:String(f.get("image_url")||""),model_url:String(f.get("model_url")||""),asset_id:Number(f.get("asset_id")||0),asset_type_id:Number(f.get("asset_type_id")||0),description:String(f.get("description")||""),is_limited:f.get("is_limited")==="on",is_offsale:f.get("is_offsale")==="on",stock_limit:Number(f.get("stock_limit")||0),is_gift:isGift,gift_reward_item_id:isGift?String(f.get("gift_reward_item_id")||""):"",gift_opens_at:giftOpensAt};
    const modelFile=f.get("model_file");
    if(modelFile instanceof File && modelFile.size){
     msg.textContent="Uploading 3D model...";
     const upload=await fetch("/api/owner/models",{method:"POST",credentials:"same-origin",headers:{"content-type":"model/gltf-binary"},body:modelFile});
     let uploaded={};try{uploaded=await upload.json()}catch{}
     if(!upload.ok)throw new Error(uploaded.error||"3D model upload failed.");
     data.model_url=uploaded.url;
    }
    if(data.category==="Accessories"&&!data.model_url)throw new Error("Upload a GLB model (max 1 MB) before listing an accessory.");
    msg.textContent="Saving item...";
    const result=await api("/api/owner/items",{method:"POST",body:JSON.stringify(data)});
    if(!isActiveView(view))return;
    e.target.reset();e.target.elements.price.value=50;e.target.elements.currency.value="P$";updateGiftOptions();msg.textContent="Item added.";
    const giftReward=ownerItems.find(item=>item.id===data.gift_reward_item_id);
    ownerItems.unshift({id:result.id,...data,is_limited:data.is_limited?1:0,is_offsale:data.is_offsale?1:0,is_gift:data.is_gift?1:0,gift_reward_name:giftReward?.name||"",stock_sold:0,is_for_sale:1,created_at:new Date().toISOString(),asset_kind:data.category==="Accessories"?"3D":"IMAGE_ONLY"});
    drawOwnerItems();updateOwnerItemCount();
   }catch(err){msg.textContent=err.message}
  });
 }catch(e){
  if(!isActiveView(view))return;
  const statsHost=document.getElementById("ownerStats"),itemsHost=document.getElementById("ownerItems");
  if(statsHost)statsHost.textContent=e.message;
  if(itemsHost)itemsHost.textContent=e.message;
 }
}

function infoPage(type){
 beginView();
 renderSidebar("");
 const pages={
  about:{title:"About Sakura",body:'<p>Sakura is an independent community revival project. It is not affiliated with or endorsed by Roblox Corporation.</p><p>This build includes account profiles, a virtual catalog, inventory previews and friend requests.</p><p>Sakura currency is an in-site balance only. It has no real-world monetary value.</p>'},
  terms:{title:"Terms of Use",body:'<p>Use Sakura respectfully and do not impersonate other users, abuse the service or attempt to access accounts that are not yours.</p><p>Do not use preview image URLs or descriptions that violate the rights or safety of other people. The project owner may remove catalog entries or accounts that abuse the service.</p><p>Virtual currency and catalog items are for use inside this website only. They cannot be exchanged for real money.</p>'},
  privacy:{title:"Privacy",body:'<p>Sakura stores your username, a password hash, session information, profile description, virtual balance, inventory, friend requests and in-site catalog and purchase records so the service can work.</p><p>Passwords are not stored as plain text. Sign-in uses a secure session cookie. This build does not ask for an email address.</p><p>For abuse prevention, the service temporarily stores hashed network-address identifiers and attempt counters for sign-in, registration and owner recovery. Ten attempts in the 15-minute window trigger a 15-minute cooldown. Expired per-address counters reset when that address is used again, and stale rows are removed during Worker setup.</p><p>Do not reuse an important password and do not share your account credentials with anyone.</p>'}
 };
 const pageData=pages[type]||pages.about;
 app.innerHTML='<article class="info-page"><h1 class="page-title">'+pageData.title+'</h1>'+pageData.body+'<a class="button" href="/#home" data-page="home">Back to Home</a></article>';
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
 else if(name==="create")await createPage();
 else if(name==="resale")await resaleMarketPage();
 else if(name==="groups")await groupsPage();
 else if(name==="group")await groupPage(query.get("id"));
 else if(name==="banned")await bannedAccountPage(query.get("username")||query.get("id"));
 else if(name==="profile")await (query.get("id")?profile(query.get("id"),true):profile(query.get("username")||me?.username));
 else if(name==="item")await showItem(query.get("id"),false);
 else if(name==="users"||name==="community")users();
 else if(name==="rap"||name==="rapleaderboard"||name==="leaderboard")await rapLeaderboardPage();
 else if(name==="friends")await friends();
 else if(name==="about"||name==="terms"||name==="privacy")infoPage(name);
 else if(name==="currency")await currencyPage();
 else if(name==="membership")await membershipPage();
 else if(name==="promocodes")await promocodesPage();
 else if(name==="trades")await tradesPage();
 else if(name==="settings")await settings();
 else if(name==="asset-panel")await assetModeratorPage();
 else if(name==="admin-panel")await adminPanel();
 else if(name==="owner")await owner();
 else home();
}
(async()=>{
 await refreshMe();
 if(detectedBannedAccount){
  history.replaceState({page:"banned",username:detectedBannedAccount.username},"","/#banned?username="+encodeURIComponent(detectedBannedAccount.username));
 }
 await render(currentRoute());
})();
window.setInterval(async()=>{
 if(!me)return;
 refreshFriendRequestCount();
 try{
  const response=await fetch("/api/me",{credentials:"same-origin"});
  const state=await response.json();
  if(state.bannedAccount){
   detectedBannedAccount=state.bannedAccount;
   setUser(null);
   history.replaceState({page:"banned",username:state.bannedAccount.username},"","/#banned?username="+encodeURIComponent(state.bannedAccount.username));
   await render("banned?username="+encodeURIComponent(state.bannedAccount.username));
  }
 }catch{}
},15000);
