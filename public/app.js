const app=document.getElementById("app");
const accountArea=document.getElementById("accountArea");
const currency=document.getElementById("currency");
const sidebar=document.getElementById("sidebar");
let me=null,items=[],catalogSort="relevance",ownedItemIds=new Set(),ownershipLoaded=true,ownershipUserId=null,pendingPurchases=new Set(),detectedBannedAccount=null;
let activeView=0;
const ITEM_CATEGORIES=["Hats","Hair","Faces","Shirts","Pants","Accessories"];
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
function removeAvatarWhiteBackground(image){
 if(!image||image.dataset.avatarBgProcessed==="1"||!image.naturalWidth||!image.naturalHeight)return;
 image.dataset.avatarBgProcessed="1";
 try{
  const width=image.naturalWidth,height=image.naturalHeight,total=width*height;
  if(total>3000000)return;
  const canvas=document.createElement("canvas");
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext("2d",{willReadFrequently:true});
  if(!context)return;
  context.drawImage(image,0,0,width,height);
  const frame=context.getImageData(0,0,width,height);
  const pixels=frame.data;
  const visited=new Uint8Array(total);
  const queue=new Int32Array(total);
  const isBackground=index=>{
   const offset=index*4,r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2];
   return pixels[offset+3]>0&&r>=238&&g>=238&&b>=238&&Math.max(r,g,b)-Math.min(r,g,b)<=20;
  };
  let head=0,tail=0;
  const add=index=>{
   if(index>=0&&index<total&&!visited[index]&&isBackground(index)){
    visited[index]=1;queue[tail++]=index;
   }
  };
  for(let x=0;x<width;x++){add(x);add((height-1)*width+x);}
  for(let y=0;y<height;y++){add(y*width);add(y*width+width-1);}
  while(head<tail){
   const index=queue[head++],x=index%width,y=(index/width)|0;
   if(x>0)add(index-1);
   if(x+1<width)add(index+1);
   if(y>0)add(index-width);
   if(y+1<height)add(index+width);
  }
  if(!tail)return;
  for(let i=0;i<tail;i++)pixels[queue[i]*4+3]=0;
  context.putImageData(frame,0,0);
  image.src=canvas.toDataURL("image/png");
 }catch(error){
  console.warn("[Sakura avatar] Could not make the render background transparent:",error);
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
  ["membership","icon-nav-robux","Membership"],
  ["games","icon-nav-forum","Games"],
  ["settings","icon-nav-settings","Settings"]
 ];
 sidebar.innerHTML='<div class="sidebar-card">'+
  '<a class="side-user" href="/#profile?id='+encodeURIComponent(me.publicId||"")+'" data-page="profile"><span class="side-avatar">'+avatar()+'</span><span><span class="side-username">'+esc(me.username)+(me.isVerified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</span><span class="side-role">Account</span></span></a>'+
  '<nav class="side-nav">'+links.map(([id,ico,label])=>'<a href="#'+id+'" data-page="'+id+'" class="'+(active===id?'active':'')+'"><span class="side-icon '+ico+'"></span><span>'+label+'</span></a>').join("")+
  '<div class="side-separator"></div>'+
  '<a href="#promocodes" data-page="promocodes" class="side-promo-button '+(active==="promocodes"?"active":"")+'">Promo Codes</a>'+
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
  app.innerHTML='<div class="op-guest"><h1>Welcome to Sakura</h1><p>Join the community and explore the catalog.</p><a class="button" href="#login" data-page="login">Login</a><a class="button" href="#register" data-page="register">Sign Up</a></div>';
  return;
 }
 const name=esc(me.username);
 app.innerHTML='<div class="sakura-home-shell"><div id="accountWarnings"></div>'+
  '<div class="sakura-home-card">'+
   '<div class="op-home-header"><a id="homeAvatar" class="op-home-avatar" href="#profile" data-page="profile">'+avatar(me.username)+'</a><div class="sakura-welcome-copy"><h1><a href="#profile" data-page="profile">Hello, '+name+'!</a></h1><div class="home-balances">'+currencyMarkup(me.balance,"P$","balance-chip")+currencyMarkup(me.tixBalance,"Tix","balance-chip")+'</div></div></div>'+
   '<section class="op-dashboard-section"><div class="op-section-heading"><h3>Friends (<span id="homeFriendCount">0</span>)</h3><a href="#friends" data-page="friends">See All</a></div><div id="homeFriends" class="op-section-content"><div class="op-empty">Loading friends...</div></div></section>'+
   '<div class="sakura-home-columns">'+
    '<section class="op-dashboard-section"><div class="op-section-heading"><h3>Recently Played</h3><a href="#games" data-page="games">See All</a></div><div id="homeRecentGames" class="sakura-empty-panel">Your recently played games will appear here.</div></section>'+
    '<section class="op-dashboard-section"><div class="op-section-heading"><h3>My Favorites</h3><a href="#catalog" data-page="catalog">See All</a></div><div id="homeFavorites" class="sakura-empty-panel">Your favorite items will appear here.</div></section>'+
   '</div>'+
   '<div class="sakura-home-columns sakura-home-bottom">'+
    '<section class="op-dashboard-section"><div class="op-section-heading"><h3>My Feed</h3><a href="#friends" data-page="friends">See All</a></div><div id="homeFeed" class="sakura-feed-panel">No posts yet.</div></section>'+
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
  (stock.finite?'<span class="stock-overlay '+(stock.soldOut?'sold-out':'')+'">'+(stock.soldOut?'Sold out':stock.remaining+' left')+'</span>':"");
}
function itemStockText(x){
 const stock=itemStockState(x);
 return stock.finite?stock.sold+"/"+stock.total+" sold":stock.sold+" sold · unlimited stock";
}
function itemCard(x){return '<article class="item-card"><div class="item-image">'+itemPreview(x)+itemBadgeMarkup(x)+'</div><h3>'+esc(x.name)+'</h3><div class="muted">'+esc(x.category)+'</div><div class="price">'+currencyMarkup(x.price,x.currency||"P$")+'</div>'+(Number(x.stock_limit)>0?'<div class="item-stock-text">'+esc(itemStockText(x))+'</div>':"")+'</article>'}
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
    ownedItemIds=new Set();
    ownershipLoaded=false;
   }else{
    ownedItemIds=new Set((inventoryData.items||[]).map(x=>x.id));
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
 if(!item){app.innerHTML='<div class="empty">Item not found. <a href="#catalog" data-page="catalog">Back to Catalog</a></div>';return}
 if(!resaleSnapshot){try{resaleSnapshot=await api("/api/resale/item/"+encodeURIComponent(item.id))}catch{resaleSnapshot={listings:[]}}}
 if(!isActiveView(view))return;
 const isOwned=ownedItemIds.has(item.id),isOffsale=Number(item.is_offsale)===1,stock=itemStockState(item);
 const resaleEligible=Number(item.is_limited)===1||isOffsale;
 const resaleListings=Array.isArray(resaleSnapshot.listings)?resaleSnapshot.listings:[];
 const myListing=me?resaleListings.find(listing=>listing.seller_id===me.id):null;
 const otherListings=resaleListings.filter(listing=>!me||listing.seller_id!==me.id);
 const sellerMarkup=listing=>'<a href="#profile?id='+encodeURIComponent(listing.seller_public_id||"")+'" data-profile="'+esc(listing.seller_name)+'">'+esc(listing.seller_name)+'</a>'+(Number(listing.seller_verified)===1?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified seller">':'');
 const listingRows=otherListings.length?otherListings.map(listing=>'<article class="resale-offer-row"><div class="resale-offer-seller"><strong>'+sellerMarkup(listing)+'</strong><span class="muted">Seller</span></div><strong class="resale-offer-price">'+currencyMarkup(listing.price,"P$")+'</strong><button class="primary resale-buy-button" type="button" data-resale-buy="'+esc(listing.id)+'" data-item-id="'+esc(item.id)+'" '+(isOwned?'disabled':'')+'>'+(!me?'Log in to buy':isOwned?'Owned':'Buy')+'</button></article>').join(""):'<p class="muted">No player listings for this item yet.</p>';
 const ownListingMarkup=myListing?'<div class="resale-own-listing"><div><strong>Your listing is active</strong><p class="muted">Asking price: '+currencyMarkup(myListing.price,"P$")+'</p></div><button class="button secondary" type="button" id="cancelResaleListing" data-listing-id="'+esc(myListing.id)+'">Remove listing</button></div>':(me&&isOwned&&resaleEligible?'<form id="createResaleListing" class="resale-create-form"><h3>Sell your copy</h3><p class="muted">Set your own price. Your item stays in your inventory until another player buys it.</p><label>Price in P$ <input type="number" name="price" min="1" max="1000000" step="1" value="1" required></label><button class="primary" type="submit">List for sale</button><span id="resaleCreateMessage" class="muted" role="status"></span></form>':"");
 const resalePanel=resaleEligible?'<section class="resale-section"><div class="resale-section-heading"><div><h2>Player Marketplace</h2><p class="muted">Limited and Off Sale items can be resold by players.</p></div><a href="#resale" data-page="resale">Open market</a></div>'+ownListingMarkup+'<div class="resale-offer-list">'+listingRows+'</div></section>':"";
 app.innerHTML='<div class="item-detail-page"><a class="item-back-link" href="#catalog" data-page="catalog">‹ Back to Catalog</a><div class="item-detail-card">'+
  '<div class="item-detail-image" id="itemDetailPreview">'+itemPreview(item)+itemBadgeMarkup(item)+'</div>'+
  '<div class="item-detail-info"><h1>'+esc(item.name)+'</h1><div class="muted">'+esc(item.category)+'</div>'+'<p>'+esc(item.description||"No description available.")+'</p><div class="item-detail-price">'+currencyMarkup(item.price,item.currency||"P$")+'</div>'+(isOffsale?'<p class="offsale-notice">OFF SALE · This item is not available to purchase.</p>':"")+(stock.finite?'<div class="item-detail-stock" id="itemDetailStock">'+esc(itemStockText(item))+'</div>':"")+(isOwned?'<button class="button secondary" id="detailBuy" type="button" disabled>Owned</button>':isOffsale?'<button class="button secondary" id="detailBuy" type="button" disabled>Off Sale</button>':stock.soldOut?'<button class="button secondary" id="detailBuy" type="button" disabled>Sold Out</button>':me&&!ownershipLoaded?'<button class="button secondary" id="detailBuy" type="button" disabled>Inventory check unavailable</button>':'<button class="primary" id="detailBuy" type="button">Buy</button>')+'<button class="button secondary" id="copyItemLink" type="button">Copy item link</button></div>'+
  '</div></div>'+resalePanel;
 if(!isOwned&&!isOffsale&&!stock.soldOut&&(!me||ownershipLoaded))document.getElementById("detailBuy").addEventListener("click",()=>buy(item.id));
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
       '<a href="#" class="active" data-category="All">All Items</a>'+
       '<a href="#" data-category="Hats">Hats</a><a href="#" data-category="Hair">Hair</a>'+
       '<a href="#" data-category="Faces">Faces</a><a href="#" data-category="Shirts">Shirts</a>'+
       '<a href="#" data-category="Pants">Pants</a><a href="#" data-category="Accessories">Accessories</a>'+
      '</nav>'+
      '<div class="catalog-legend"><strong>About</strong><p>Items purchased here belong to your Sakura account.</p></div>'+
     '</div></aside>'+
     '<section class="catalog-results">'+
      '<div class="catalog-results-header"><div><h2 id="catalogCategoryTitle">Featured Items on Sakura</h2><p id="catalogCount" class="muted"></p></div><label class="catalog-sort-label">Sort By: <select id="catalogSort" class="catalog-sort"><option value="relevance">Relevance</option><option value="newest">Recently added</option><option value="price-low">Price (Low to High)</option><option value="price-high">Price (High to Low)</option></select></label></div>'+
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
    console.warn("[Sakura catalog] Inventory state unavailable:",error);
   }
  }
  drawCatalog("All","");
 }catch(e){
  const grid=document.getElementById("catalogGrid");
  if(isActiveView(view)&&grid)grid.textContent=e.message;
  items=[];
  ownedItemIds=new Set();
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
  return '<article class="item-card"><a class="item-image" href="#" data-item-view="'+esc(x.id)+'" aria-label="View '+esc(x.name)+'">'+itemPreview(x)+itemBadgeMarkup(x)+'</a><h3>'+esc(x.name)+'</h3><div class="muted">'+esc(x.category)+'</div>'+'<div class="catalog-asset-kind">'+(x.category==="Accessories"?(x.model_url?"Interactive 3D model":"3D model not uploaded"):"Catalog item")+'</div>'+(stock.finite?'<div class="item-stock-text">'+esc(itemStockText(x))+'</div>':"")+'<div class="price">'+currencyMarkup(x.price,x.currency||"P$")+'</div>'+(ownedItemIds.has(x.id)?'<button class="button secondary" type="button" disabled>Owned</button>':Number(x.is_offsale)===1?'<button class="button secondary offsale-button" type="button" disabled>Off Sale</button>':stock.soldOut?'<button class="button secondary" type="button" disabled>Sold Out</button>':!ownershipLoaded?'<button class="button secondary" type="button" disabled>Checking inventory...</button>':'<button class="button" data-buy="'+esc(x.id)+'">Buy</button>')+'</article>';
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
  me.balance=d.balance;me.tixBalance=d.tixBalance;ownedItemIds.add(itemId);ownershipLoaded=true;
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
  if(detailButton?.isConnected&&!ownedItemIds.has(itemId)){detailButton.disabled=false;detailButton.textContent="Buy"}
 }
}
async function buyResaleListing(listingId,itemId,button){
 if(!me){page("login");return}
 if(button){button.disabled=true;button.textContent="Buying..."}
 try{
  const result=await api("/api/resale/listings/"+encodeURIComponent(listingId)+"/buy",{method:"POST",body:"{}"});
  setUser({...me,balance:Number(result.balance||0),tixBalance:Number(result.tixBalance??me.tixBalance??0)});
  ownedItemIds=new Set();ownershipLoaded=false;
  try{
   const inventoryData=await api("/api/inventory");
   ownedItemIds=new Set((inventoryData.items||[]).map(item=>item.id));
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
 app.innerHTML='<div class="resale-market-page"><div class="resale-market-heading"><div><h1 class="page-title">Resale Market</h1><p class="muted">Limited and Off Sale items listed by Sakura players.</p></div><a class="button secondary" href="#inventory" data-page="inventory">My Inventory</a></div><div id="resaleMarketGrid" class="resale-market-list">Loading listings...</div></div>';
 const host=document.getElementById("resaleMarketGrid");
 try{
  const data=await api("/api/resale/listings");
  if(!isActiveView(view)||!host?.isConnected)return;
  const listings=data.listings||[];
  host.innerHTML=listings.length?listings.map(listing=>'<article class="resale-market-card"><a class="resale-market-image" href="/item/'+encodeURIComponent(listing.item_id)+'" data-item-view="'+esc(listing.item_id)+'">'+itemPreview(listing)+itemBadgeMarkup(listing)+'</a><div class="resale-market-details"><h2><a href="/item/'+encodeURIComponent(listing.item_id)+'" data-item-view="'+esc(listing.item_id)+'">'+esc(listing.name)+'</a></h2><span class="muted">'+esc(listing.category)+' · '+(Number(listing.is_limited)===1?'LIMITED':'OFF SALE')+'</span><div class="resale-market-seller">Seller: <a href="#profile?id='+encodeURIComponent(listing.seller_public_id||"")+'" data-profile="'+esc(listing.seller_name)+'">'+esc(listing.seller_name)+'</a>'+(Number(listing.seller_verified)===1?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified seller">':'')+'</div><strong class="resale-market-price">'+currencyMarkup(listing.price,"P$")+'</strong></div><button class="primary resale-buy-button" type="button" data-resale-buy="'+esc(listing.id)+'" data-item-id="'+esc(listing.item_id)+'" '+''+'>'+(!me?'Log in to buy':'Buy')+'</button></article>').join(""):'<div class="empty">There are no player listings yet.</div>';
  host.querySelectorAll("[data-resale-buy]").forEach(button=>button.addEventListener("click",()=>buyResaleListing(button.dataset.resaleBuy,button.dataset.itemId,button)));
 }catch(error){if(host?.isConnected)host.textContent=error.message}
}

function auth(kind){
 const view=beginView();
 renderSidebar("");
 const reg=kind==="register";
 app.innerHTML='<div class="form"><h2>'+(reg?"Create your Sakura account":"Log in to Sakura")+'</h2><form id="authForm"><label>Username</label><input name="username" required minlength="'+(reg?"3":"1")+'" maxlength="20" autocomplete="username"><label>Password</label><input name="password" type="password" required minlength="8" maxlength="128" autocomplete="'+(reg?"new-password":"current-password")+'"><button class="primary" type="submit">'+(reg?"Sign up":"Log in")+'</button><div id="authError" class="error"></div></form><p class="muted">'+(reg?'Already have an account? <a href="#login" data-page="login">Log in</a>':'New to Sakura? <a href="#register" data-page="register">Sign up</a>')+'</p>'+(reg?'':'<p class="muted"><a href="#owner-recovery" data-page="owner-recovery">Recover PekoraAdmin account</a></p>')+'</div>';
 document.getElementById("authForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.target);
  try{
   const d=await api(reg?"/api/register":"/api/login",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});
   setUser(d.user);
   if(isActiveView(view))page("home");
  }catch(err){
   const error=document.getElementById("authError");
   if(isActiveView(view)&&error){
    if(!reg&&String(err.message).startsWith("This account is banned")){
     error.innerHTML=esc(err.message)+'<p><a href="#banned?username='+encodeURIComponent(String(f.get("username")||""))+'" data-banned-account="'+esc(String(f.get("username")||""))+'">View ban details</a></p>';
    }else error.textContent=err.message;
   }
  }
 });
}
async function ownerRecoveryPage(){
 const view=beginView();
 renderSidebar("");
 app.innerHTML='<div class="form"><h2>Recover Sakura OWNER account</h2><p class="muted">Use the Worker secret OWNER_BOOTSTRAP_SECRET from your Cloudflare settings. This resets the PekoraAdmin password and signs out previous sessions.</p><form id="ownerRecoveryForm"><label>Worker recovery secret<input name="secret" type="password" maxlength="512" required autocomplete="off"></label><label>New password<input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><label>Confirm new password<input name="confirmPassword" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><button class="primary" type="submit">Reset owner password</button><div id="ownerRecoveryMessage" class="error" role="status"></div></form><p class="muted"><a href="#login" data-page="login">Back to login</a></p></div>';
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
function inventoryItemCard(item){
 const eligible=Number(item.is_limited)===1||Number(item.is_offsale)===1;
 const status=item.active_listing_id
  ?'<span class="inventory-listing-status">Listed · '+currencyMarkup(item.active_listing_price,"P$")+'</span>'
  :eligible?'<span class="inventory-resale-hint">Eligible for resale</span>':"";
 return '<article class="item-card inventory-item-card">'+
  '<a class="item-image" href="/item/'+encodeURIComponent(item.id)+'" data-item-view="'+esc(item.id)+'">'+itemPreview(item)+itemBadgeMarkup(item)+'</a>'+
  '<h3><a href="/item/'+encodeURIComponent(item.id)+'" data-item-view="'+esc(item.id)+'">'+esc(item.name)+'</a></h3>'+
  '<div class="muted">'+esc(item.category)+'</div>'+status+
  '</article>';
}
async function inventory(){
 const view=beginView();
 renderSidebar("inventory");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to view your inventory.</div>';return}
 app.innerHTML='<h1 class="page-title">Inventory</h1><p class="inventory-sell-intro">Select an item to view its details and available actions.</p><div id="inventoryGrid" class="item-grid">Loading...</div>';
 const grid=document.getElementById("inventoryGrid");
 try{
  const d=await api("/api/inventory");
  if(!isActiveView(view)||!grid?.isConnected)return;
  const ownedItems=Array.isArray(d.items)?d.items:[];
  grid.innerHTML=ownedItems.length?ownedItems.map(inventoryItemCard).join(""):'<div class="empty">Your inventory is empty. <a href="#catalog" data-page="catalog">Browse the Catalog</a>.</div>';
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
  app.innerHTML='<div class="banned-account-page"><a href="#users" data-page="users" class="item-back-link">‹ Back to People</a>'+
   '<section class="banned-account-card"><div class="ban-status-label">BANNED ACCOUNT</div>'+
   '<div class="banned-account-heading"><div class="banned-account-avatar">'+avatar(account.username)+'</div><div><h1>'+esc(account.username)+'</h1><p class="muted">User ID: '+esc(account.public_id)+' · '+esc(account.role||"USER")+'</p><span class="ban-pill">BANNED</span></div></div>'+
   '<div class="ban-detail-row"><strong>Status</strong><span>Account banned from Sakura</span></div>'+
   '<div class="ban-detail-row"><strong>Reason</strong><p>'+esc(account.ban_reason||"Account banned by Sakura moderation")+'</p></div>'+
   '<div class="ban-detail-row"><strong>Banned on</strong><span>'+esc(bannedDate)+'</span></div>'+
   '<div class="ban-detail-row"><strong>Joined Sakura</strong><span>'+esc(joinedDate)+'</span></div>'+
   '<p class="muted">This account is currently banned. Its profile and inventory are unavailable.</p></section></div>';
 }catch(error){
  if(isActiveView(view))app.innerHTML='<div class="banned-account-page"><section class="banned-account-card"><h1>Banned account not found</h1><p>'+esc(error.message)+'</p><a href="#users" data-page="users">Search People</a></section></div>';
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

async function currencyPage(){
 const view=beginView();
 renderSidebar("currency");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to view your Sakura balances.</div>';return}
 app.innerHTML='<div class="currency-page"><h1 class="page-title">Sakura Currency</h1><section class="info-panel currency-balance-panel"><h2>Your balances</h2><div class="currency-balances">'+currencyMarkup(me.balance,"P$","currency-large")+currencyMarkup(me.tixBalance,"Tix","currency-large")+'</div><p class="muted">P$ and Tix are virtual Sakura currencies used only on this website. They have no real-world monetary value and cannot be withdrawn.</p></section><section class="owner-section"><h2>Recent purchases</h2><div id="currencyHistory" class="currency-history">Loading purchase history...</div></section><a class="button" href="#catalog" data-page="catalog">Browse Catalog</a></div>';
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
  app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to manage your membership.</div>';
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
   '<p class="membership-openpekora-footnote">Memberships are currently free. Daily rewards are virtual Sakura P$ credits, not real Roblox Robux, and are credited at 00:00 Kyiv time.</p>'+
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
  app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to redeem promo codes.</div>';
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

async function gamesPage(){
 const view=beginView();
 renderSidebar("games");
 app.innerHTML='<div class="games-page"><h1 class="page-title">Games</h1><p class="muted">Games created by the Sakura team.</p><div id="gamesGrid" class="games-grid">Loading games...</div></div>';
 try{
  const data=await api("/api/games");
  if(!isActiveView(view))return;
  const host=document.getElementById("gamesGrid");
  const games=data.games||[];
  host.innerHTML=games.length?games.map(game=>'<article class="game-card">'+
   '<div class="game-thumbnail">'+(game.thumbnail_url?'<img src="'+esc(game.thumbnail_url)+'" alt="'+esc(game.title)+'" loading="lazy">':'<div class="game-thumbnail-empty">SAKURA</div>')+'</div>'+
   '<div class="game-card-body"><h2>'+esc(game.title)+'</h2><p>'+esc(game.description||"No description.")+'</p>'+
   '<button class="game-locked-button" type="button" disabled aria-label="Game is locked"><span class="game-lock-icon" aria-hidden="true"></span> Locked</button></div></article>').join(""):'<div class="empty">No games have been added yet.</div>';
 }catch(e){const host=document.getElementById("gamesGrid");if(host)host.textContent=e.message}
}
async function tradesPage(){
 const view=beginView();
 renderSidebar("trades");
 if(!me){app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to trade items.</div>';return}
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
      ownedItemIds=new Set();
      try{
       const inventoryState=await api("/api/inventory");
       ownedItemIds=new Set((inventoryState.items||[]).map(item=>item.id));
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
  (me?'<section class="owner-section"><h2>Create a group</h2><p class="muted">Creating a group costs '+currencyMarkup(100,"P$")+'. The fee is transferred to the Sakura Admin account.</p><form id="groupCreateForm" class="group-create-form"><label>Group name<input name="name" minlength="3" maxlength="32" required placeholder="Your group name"></label><label>Description<textarea name="description" maxlength="300" rows="2" placeholder="What is this group about?"></textarea></label><button class="primary" type="submit">Create group · '+currencyMarkup(100,"P$")+'</button><span id="groupCreateMessage" class="muted"></span></form></section>':'<section class="owner-section"><p>Please <a href="#login" data-page="login">log in</a> to create or join groups.</p></section>')+
  '<section class="owner-section"><h2>All Groups</h2><div id="groupsList" class="groups-list">Loading groups...</div></section></div>';
 const host=document.getElementById("groupsList");
 async function loadGroups(){
  try{
   const data=await api("/api/groups");
   if(!isActiveView(view)||!host?.isConnected)return;
   const groups=data.groups||[];
   host.innerHTML=groups.length?groups.map(group=>'<article class="group-card"><div class="group-card-mark">'+(group.avatar_url?'<img src="'+esc(group.avatar_url)+'" alt="">':esc(String(group.name||"?").slice(0,1).toUpperCase()))+'</div><div class="group-card-info"><h3><a href="#group?id='+encodeURIComponent(group.id)+'" data-group-view="'+esc(group.id)+'">'+esc(group.name)+'</a>'+(Number(group.is_verified)===1?' <img class="verified-badge group-verified-badge" src="/verified.svg" alt="Verified group" title="Verified group">':'')+'</h3><p>'+esc(group.description||"No description.")+'</p><span class="muted">Owner: '+esc(group.owner_name)+' · '+Number(group.member_count||0).toLocaleString()+' members</span></div>'+(me?(Number(group.is_member)===1?'<button class="button secondary" type="button" disabled>Joined</button>':'<button class="button" type="button" data-join-group="'+esc(group.id)+'">Join</button>'):'')+'</article>').join(""):'<div class="empty">No groups yet. Be the first to create one.</div>';
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
  const data={name:String(values.get("name")||"").trim(),description:String(values.get("description")||"").trim()};
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
  const memberList=members.length?members.map(person=>'<article class="group-member"><div class="people-avatar">'+avatar(person.username)+'</div><div class="people-user-info"><strong><a href="#profile?username='+encodeURIComponent(person.username)+'" data-profile="'+esc(person.username)+'">'+esc(person.username)+'</a>'+(person.group_role==="OWNER"?' <span class="group-owner-tag">OWNER</span>':'')+'</strong><span>'+esc(person.account_role||"USER")+' · Joined '+esc(new Date(person.joined_at+"Z").toLocaleDateString())+'</span></div></article>').join(""):'<div class="empty">No members yet.</div>';
  app.innerHTML='<div class="groups-page"><a href="#groups" data-page="groups" class="item-back-link">‹ Back to Groups</a>'+
   '<section class="group-detail-card"><div class="group-detail-heading"><div class="group-detail-avatar">'+mark+'</div><div><h1>'+esc(group.name)+verifiedMark+'</h1><p class="muted">Owner: <a href="#profile?username='+encodeURIComponent(group.owner_name)+'" data-profile="'+esc(group.owner_name)+'">'+esc(group.owner_name)+'</a> · '+Number(group.member_count||0).toLocaleString()+' members</p><span class="muted">Created '+esc(new Date(group.created_at+"Z").toLocaleDateString())+'</span></div></div>'+
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
  document.getElementById("leaveGroupBtn")?.addEventListener("click",async()=>{
   if(!confirm("Leave this group?"))return;
   const button=document.getElementById("leaveGroupBtn");button.disabled=true;
   try{await api("/api/groups/"+encodeURIComponent(groupId)+"/leave",{method:"DELETE"});toast("Left group");await groupPage(groupId)}
   catch(error){toast(error.message);button.disabled=false}
  });
 }catch(error){
  if(isActiveView(view))app.innerHTML='<div class="empty">'+esc(error.message)+' <a href="#groups" data-page="groups">Back to Groups</a></div>';
 }
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
 app.innerHTML='<h1 class="page-title">People</h1><p class="page-subtitle">Search the Sakura community by username or User ID and open user profiles.</p><form id="peopleSearchForm" class="people-search"><input id="userSearch" class="search-input" placeholder="Username or User ID..." minlength="1" maxlength="32" autocomplete="off"><button class="button" type="submit">Search</button></form><div id="peopleHint" class="notice">Type a username or numeric User ID to find a player.</div><div id="userResults" class="people-results"></div>';
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
async function owner(){
 const view=beginView();
 renderSidebar("owner");
 if(!me||me.role!=="OWNER"){app.innerHTML='<div class="empty">Owner access required.</div>';return}
 app.innerHTML='<h1 class="page-title">Owner Panel</h1><div id="ownerStats" class="item-grid">Loading...</div>'+
 '<section class="owner-section"><h2>Owner Account</h2><p class="muted">The current password cannot be displayed because Sakura stores only a password hash. While signed in as OWNER, set a new password here.</p><form id="ownerPasswordForm" class="owner-item-form"><label>New password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label>Confirm password<input name="confirmPassword" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><button class="primary" type="submit">Set new owner password</button><span id="ownerPasswordMessage" class="muted"></span></form></section>'+
 '<section class="owner-section"><h2>Catalog Management</h2><p class="muted">Remove every item from the public catalog. Existing owners keep their inventory.</p><p class="muted">Accessories use real GLB/GLTF 3D models. Add a secure HTTPS model URL to enable the interactive preview. Accessories cannot be listed for sale without a model.</p><button class="button secondary" id="clearPublicCatalog" type="button">Remove all items from catalog</button><form id="newItemForm" class="owner-item-form">'+
 '<label>Item name<input name="name" maxlength="80" required></label>'+
 '<label>Category<select name="category">'+ITEM_CATEGORIES.map(c=>'<option>'+c+'</option>').join("")+'</select></label>'+
 '<label>Item price<input name="price" type="number" min="0" max="1000000" value="50" required></label>'+
  '<label>Price currency<select name="currency"><option value="P$">P$</option><option value="Tix">Tix</option></select></label>'+
 '<label class="owner-toggle"><span>Limited item</span><input name="is_limited" type="checkbox"></label>'+
 '<label class="owner-toggle"><span>Off Sale (visible, cannot buy)</span><input name="is_offsale" type="checkbox"></label>'+
 ' <label>Total stock (0 = unlimited)<input name="stock_limit" type="number" min="0" max="1000000" value="0" step="1"></label>'+
 '<label>Preview image URL<input name="image_url" type="url" maxlength="500" placeholder="https://..."></label>'+
 '<label>3D model file (.glb, max 1 MB)<input name="model_file" type="file" accept=".glb,model/gltf-binary"></label>'+
 '<label>Or existing 3D model URL<input name="model_url" type="url" maxlength="1000" placeholder="https://...model.glb"></label>'+
 ''+
 ''+
 ''+
 '<label class="owner-description">Description<textarea name="description" maxlength="500" rows="2"></textarea></label>'+
 '<button class="primary" type="submit">Add Item</button><span id="ownerFormMessage" class="muted"></span></form>'+
 '<div id="ownerItems" class="owner-items">Loading items...</div></section>'+
 '<section class="owner-section"><h2>Game Management</h2><p class="muted">Create game cards with a title, description and thumbnail. All games remain locked and cannot be launched.</p><form id="newGameForm" class="owner-item-form"><label>Game title<input name="title" maxlength="80" required></label><label>Game thumbnail URL<input name="thumbnail_url" type="url" maxlength="500" placeholder="https://..."></label><label>Description<textarea name="description" maxlength="500" rows="3"></textarea></label><button class="primary" type="submit">Create game</button><span id="gameFormMessage" class="muted"></span></form><div id="ownerGames" class="owner-items">Loading games...</div></section><section class="owner-section owner-group-verification"><h2>Group Verification</h2><p class="muted">Give or remove the verified badge for Sakura groups. Only the site owner can change this.</p><div id="ownerGroups" class="owner-group-list">Loading groups...</div></section><section class="owner-section"><h2>User Management</h2><p class="muted">Search accounts to grant Sakura currency, issue warnings, or ban and unban users. OWNER accounts are protected.</p><form id="ownerUserSearch" class="owner-item-form"><label>Username or User ID<input name="q" minlength="1" maxlength="32" required placeholder="Search user"></label><button class="primary" type="submit">Search</button></form><div id="ownerUserResults" class="owner-user-results"></div><div id="ownerUserDetails" class="owner-user-details"></div></section>';
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
   userDetails.innerHTML='<div class="owner-user-card"><h3>'+esc(u.username)+(u.is_verified?' <img class="verified-badge" src="/verified.svg" alt="Verified" title="Verified account">':'')+'</h3><div class="muted">User ID: '+esc(u.public_id)+'</div><p>Role: '+esc(u.role)+' · '+currencyMarkup(u.balance,"P$")+' · '+currencyMarkup(u.tix_balance,"Tix")+' · Status: '+(u.is_banned?'BANNED':'Active')+' · Verified: '+(u.is_verified?'Yes':'No')+'</p>'+(u.is_banned?'<div class="ban-admin-summary"><strong>Active ban</strong><p>Reason: '+esc(u.ban_reason||"Account banned by moderation")+'</p><span class="muted">Banned on: '+esc(u.banned_at?new Date(String(u.banned_at).replace(" ","T")+"Z").toLocaleString():"Date unavailable")+'</span></div>':'')+
    (u.role==="OWNER"?'<p class="muted">OWNER accounts cannot be modified.</p>':
    '<div class="owner-user-actions"><form id="ownerCreditForm" class="owner-item-form"><h4>Give Sakura currency</h4><label>Amount<input name="amount" type="number" min="1" max="1000000" required></label><label>Currency<select name="currency"><option value="P$">P$</option><option value="Tix">Tix</option></select></label><label>Note (optional)<input name="reason" maxlength="500"></label><button class="primary" type="submit">Give currency</button></form>'+
    '<form id="ownerWarnForm" class="owner-item-form"><h4>Issue warning</h4><label>Reason<textarea name="reason" minlength="3" maxlength="500" required></textarea></label><button class="primary" type="submit">Send warning</button></form>'+
    (u.is_banned?'<button type="button" class="button" id="ownerUnban">Unban account</button>':'<form id="ownerBanForm" class="owner-item-form"><h4>Ban account</h4><label>Reason<textarea name="reason" minlength="3" maxlength="500" required></textarea></label><button type="submit" class="button secondary">Ban account</button></form>')+'</div>')+
    (u.role==="OWNER"?"":'<form id="ownerVerifyForm" class="owner-item-form owner-verify-form"><h4>Verified badge</h4><p class="muted">'+(u.is_verified?'This user has a verified badge.':'This user is not verified.')+'</p><button class="primary" type="submit">'+(u.is_verified?'Remove verified badge':'Give verified badge')+'</button></form>')+
    (u.role==="OWNER"?"":'<form id="ownerPublicIdForm" class="owner-item-form owner-id-form"><h4>Change public User ID</h4><p class="muted">Must be unique. Existing profile links using the old ID will stop working.</p><label>New numeric ID<input name="publicId" type="number" min="1" max="2147483647" step="1" value="'+Number(u.public_id||0)+'" required></label><button class="primary" type="submit">Save User ID</button></form>')+
    '<h4>Warnings</h4>'+(d.warnings.length?'<ul>'+d.warnings.map(x=>'<li>'+esc(x.reason)+' <span class="muted">('+new Date(x.created_at+"Z").toLocaleString()+')</span></li>').join("")+'</ul>':'<p class="muted">No warnings.</p>')+
    '<h4>Moderation history</h4>'+(d.logs.length?'<ul>'+d.logs.map(x=>'<li><strong>'+esc(x.action)+'</strong> '+esc(x.details)+' <span class="muted">('+new Date(x.created_at+"Z").toLocaleString()+')</span></li>').join("")+'</ul>':'<p class="muted">No actions recorded.</p>')+'</div>';
   document.getElementById("ownerCreditForm")?.addEventListener("submit",async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:"credit",amount:Number(f.get("amount")),currency:String(f.get("currency")||"P$"),reason:String(f.get("reason")||"")})});toast("Currency granted");await loadOwnerUser(userId);await refreshMe();}
    catch(err){toast(err.message)}
   });
   document.getElementById("ownerVerifyForm")?.addEventListener("submit",async e=>{
    e.preventDefault();
    try{
     await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:u.is_verified?"unverify":"verify"})});
     toast(u.is_verified?"Verified badge removed":"Verified badge granted");
     await loadOwnerUser(userId);
    }catch(err){toast(err.message)}
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
    if(!confirm("Ban "+u.username+"? Their active sessions will be revoked."))return;
    try{await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:"ban",reason})});toast("Account banned");await loadOwnerUser(userId);}
    catch(err){toast(err.message)}
   });
   document.getElementById("ownerUnban")?.addEventListener("click",async()=>{
    try{await api("/api/owner/users/"+encodeURIComponent(userId),{method:"POST",body:JSON.stringify({action:"unban"})});toast("Account unbanned");await loadOwnerUser(userId);}
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
    '<textarea name="description" rows="2" maxlength="500">'+esc(x.description||"")+'</textarea><span class="muted">'+(x.is_for_sale?(Number(x.is_offsale)===1?'Off Sale':'For sale'):'Removed from catalog')+' · '+(Number(x.stock_limit)>0?(Number(x.stock_sold||0)+' / '+Number(x.stock_limit)+' sold · '+Math.max(0,Number(x.stock_limit)-Number(x.stock_sold||0))+' left'):(Number(x.stock_sold||0)+' sold · unlimited stock'))+'</span></div>'+
    '<div class="owner-item-actions"><button class="button" type="submit">Save</button>'+(x.is_for_sale?'<button class="button secondary" type="button" data-remove-item="'+esc(x.id)+'">Remove</button>':'<button class="button" type="button" data-restore-item="'+esc(x.id)+'">Restore</button>')+'</div></form>').join(""):'<div class="empty">No catalog items yet.</div>';
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
  }
  drawOwnerItems();
  const newItemForm=document.getElementById("newItemForm");
  if(!newItemForm)return;
  newItemForm.addEventListener("submit",async e=>{
   e.preventDefault();const f=new FormData(e.target),msg=document.getElementById("ownerFormMessage");msg.textContent="Saving...";
   try{
    const data={name:String(f.get("name")).trim(),category:String(f.get("category")),price:Number(f.get("price")),currency:String(f.get("currency")||"P$"),image_url:String(f.get("image_url")||""),model_url:String(f.get("model_url")||""),asset_id:Number(f.get("asset_id")||0),asset_type_id:Number(f.get("asset_type_id")||0),description:String(f.get("description")||""),is_limited:f.get("is_limited")==="on",is_offsale:f.get("is_offsale")==="on",stock_limit:Number(f.get("stock_limit")||0)};
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
    e.target.reset();e.target.elements.price.value=50;e.target.elements.currency.value="P$";msg.textContent="Item added.";
    ownerItems.unshift({id:result.id,...data,is_limited:data.is_limited?1:0,is_offsale:data.is_offsale?1:0,stock_sold:0,is_for_sale:1,created_at:new Date().toISOString(),asset_kind:data.category==="Accessories"?"3D":"IMAGE_ONLY"});
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
 app.innerHTML='<article class="info-page"><h1 class="page-title">'+pageData.title+'</h1>'+pageData.body+'<a class="button" href="#home" data-page="home">Back to Home</a></article>';
}
async function avatarPage(){
 const view=beginView();
 renderSidebar("avatar");
 if(!me){
  app.innerHTML='<div class="empty">Please <a href="#login" data-page="login">log in</a> to view your avatar.</div>';
  return;
 }
 const publicId=Number(me.publicId||0);
 if(!publicId){
  app.innerHTML='<div class="empty">Your account does not have a public avatar ID yet.</div>';
  return;
 }
 app.innerHTML='<div class="avatar-page" style="max-width:900px;margin:0 auto;padding:12px 0">'+
  '<h1 class="page-title">Avatar</h1>'+
  '<p class="muted">Your character rendered by OpenPekora RCC.</p>'+
  '<section style="background:transparent;border:0;border-radius:10px;padding:8px 0;margin:14px 0;display:flex;flex-direction:column;align-items:center;gap:12px">'+
   '<div style="width:min(100%,520px);min-height:360px;background-color:#20182b;background-image:linear-gradient(45deg,#30263d 25%,transparent 25%),linear-gradient(-45deg,#30263d 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#30263d 75%),linear-gradient(-45deg,transparent 75%,#30263d 75%);background-size:28px 28px;background-position:0 0,0 14px,14px -14px,-14px 0;border:1px solid #514260;border-radius:8px;display:grid;place-items:center;overflow:hidden">'+
    '<img id="sakuraAvatarImage" alt="3D avatar render" style="display:block;width:100%;height:420px;object-fit:contain;background:transparent" src="/api/avatar/thumbnail/'+publicId+'?refresh='+Date.now()+'">'+
   '</div>'+
   '<div id="sakuraAvatarStatus" class="muted" role="status">Loading OpenPekora render...</div>'+
   '<button class="button primary" id="refreshSakuraAvatar" type="button">Refresh Avatar</button>'+
  '</section>'+
  '<section style="background:transparent;border:1px solid #d9cce7;border-radius:10px;padding:16px;margin:14px 0">'+
   '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px"><h2 style="margin:0">Equipped items</h2><button class="button secondary" id="copyAvatarItemIds" type="button">Copy all item IDs</button></div>'+
   '<div id="sakuraEquippedItems" class="muted">Loading...</div>'+
  '</section></div>';
 const image=document.getElementById("sakuraAvatarImage");
 const status=document.getElementById("sakuraAvatarStatus");
 const refresh=()=>{
  if(!image?.isConnected)return;
  delete image.dataset.avatarBgProcessed;
  status.textContent="Rendering with OpenPekora RCC...";
  image.src="/api/avatar/thumbnail/"+publicId+"?refresh="+Date.now();
 };
 image.addEventListener("load",()=>{
  if(!isActiveView(view))return;
  removeAvatarWhiteBackground(image);
  status.textContent="OpenPekora avatar render loaded.";
 });
 image.addEventListener("error",()=>{if(isActiveView(view))status.textContent="Render failed. Check that the Sakura Renderer and RCCService are running.";});
 document.getElementById("refreshSakuraAvatar")?.addEventListener("click",refresh);
 try{
  const data=await api("/api/avatar");
  if(!isActiveView(view))return;
  const host=document.getElementById("sakuraEquippedItems");
  if(host){
   const equipped=Array.isArray(data.equipped)?data.equipped:[];
   host.innerHTML=equipped.length?equipped.map(item=>{
    const itemId=String(item.id||"");
    const assetId=Number(item.asset_id||0);
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid #e6ddec">'+
     '<div style="min-width:140px"><strong>'+esc(item.name)+'</strong><div class="muted">'+esc(item.category)+(assetId?' · Asset ID: '+assetId:'')+'</div></div>'+
     '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
      '<button class="button secondary" type="button" data-copy-avatar-link="'+esc(itemId)+'">Copy item link</button>'+
      '<button class="button secondary" type="button" data-copy-avatar-id="'+esc(assetId||itemId)+'">'+(assetId?'Copy asset ID':'Copy item ID')+'</button>'+
     '</div></div>';
   }).join(""):'No items equipped yet.';
   host.querySelectorAll("[data-copy-avatar-link]").forEach(button=>{
    button.addEventListener("click",()=>{
     const id=button.dataset.copyAvatarLink;
     copyToClipboard(new URL("/item/"+encodeURIComponent(id),location.origin).href,"Item link copied");
    });
   });
   host.querySelectorAll("[data-copy-avatar-id]").forEach(button=>{
    button.addEventListener("click",()=>copyToClipboard(button.dataset.copyAvatarId,"Item ID copied"));
   });
   document.getElementById("copyAvatarItemIds")?.addEventListener("click",()=>{
    const ids=equipped.map(item=>Number(item.asset_id||0)>0?String(item.asset_id):String(item.id||"")).filter(Boolean);
    if(!ids.length){toast("No Roblox asset IDs on equipped items.");return;}
    copyToClipboard(ids.join(", "),"All avatar asset IDs copied");
   });
  }
 }catch(error){
  if(isActiveView(view)&&document.getElementById("sakuraEquippedItems"))document.getElementById("sakuraEquippedItems").textContent=error.message;
 }
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
 else if(name==="resale")await resaleMarketPage();
 else if(name==="avatar")await avatarPage();
 else if(name==="groups")await groupsPage();
 else if(name==="group")await groupPage(query.get("id"));
 else if(name==="banned")await bannedAccountPage(query.get("username")||query.get("id"));
 else if(name==="profile")await (query.get("id")?profile(query.get("id"),true):profile(query.get("username")||me?.username));
 else if(name==="item")await showItem(query.get("id"),false);
 else if(name==="users"||name==="community")users();
 else if(name==="friends")await friends();
 else if(name==="about"||name==="terms"||name==="privacy")infoPage(name);
 else if(name==="currency")await currencyPage();
 else if(name==="membership")await membershipPage();
 else if(name==="promocodes")await promocodesPage();
 else if(name==="games")await gamesPage();
 else if(name==="trades")await tradesPage();
 else if(name==="settings")await settings();
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
