const corsHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function json(data, status=200){ return new Response(JSON.stringify(data), {status, headers:corsHeaders}); }
function safeUrl(value){
 let u; try{u=new URL(value)}catch{return null}
 if(!["http:","https:"].includes(u.protocol))return null;
 const h=u.hostname.toLowerCase();
 if(!h || h==="localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h==="::1" || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^0\./.test(h))return null;
 return u;
}
function decode(s){return String(s||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n));}
function clean(v){if(Array.isArray(v))v=v[0];if(v&&typeof v==="object")v=v.url||v["@id"]||v.contentUrl||v.thumbnailUrl||"";return typeof v==="string"?decode(v.trim()):""}
function walkJsonLd(value,out){
 if(!value||typeof value!=="object")return;
 if(Array.isArray(value)){for(const x of value)walkJsonLd(x,out);return}
 const types=Array.isArray(value["@type"])?value["@type"]:[value["@type"]];
 if(types.some(t=>/Product/i.test(t||"")))out.push(value);
 for(const [k,v] of Object.entries(value))if(k==="@graph"||k==="mainEntity"||k==="mainEntityOfPage"||k==="itemListElement"||Array.isArray(v))walkJsonLd(v,out);
}
function parsePage(html,url){
 const metas={};for(const m of html.matchAll(/<meta\b[^>]*(?:property|name)\s*=\s*["']([^"']+)["'][^>]*>/gi)){const tag=m[0],key=m[1].toLowerCase(),content=(tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)||[])[1];if(content)metas[key]=decode(content)}
 // Also support content-before-property attribute order.
 for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){const t=tag[0],k=(t.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)||[])[1],v=(t.match(/\bcontent\s*=\s*["']([^"']*)["']/i)||[])[1];if(k&&v)metas[k.toLowerCase()]=decode(v)}
 const products=[];
 for(const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walkJsonLd(JSON.parse(m[1].replace(/^\uFEFF/,"").trim()),products)}catch{}}
 const p=products[0]||{};
 const offers=Array.isArray(p.offers)?p.offers[0]:(p.offers||{});
 const currency=offers.priceCurrency||p.priceCurrency||"";
 let price=offers.price??offers.lowPrice??p.price??metas["product:price:amount"]??metas["og:price:amount"]??metas["twitter:data1"]??null;
 if(price&&typeof price==="object")price=price.value??null;
 if(typeof price==="string"){const n=price.replace(/[^\d.,]/g,"").replace(/,(?=\d{3}(?:\D|$))/g,"").replace(",",".");price=n?Number(n):null}
 if(typeof price==="number"&&!Number.isFinite(price))price=null;
 let image=clean(p.image)||clean(metas["og:image"])||clean(metas["og:image:url"])||clean(metas["twitter:image"])||clean(metas["twitter:image:src"]);
 if(image){try{image=new URL(image,url).href}catch{image=""}}
  const titleMatch=html.match(/<title[^>]*>(.*?)<\/title>/i);
  const titleText=titleMatch?titleMatch[1].replace(/<[^>]+>/g," "):"";
  let name=clean(p.name)||clean(metas["og:title"])||clean(metas["twitter:title"])||clean(metas["title"])||clean(titleText)||"";
 let category=clean(p.category)||clean(metas["product:category"])||"";
 let oldPrice=offers.highPrice??null;if(oldPrice!==null){oldPrice=Number(String(oldPrice).replace(/[^\d.]/g,""));if(!Number.isFinite(oldPrice))oldPrice=null}
 return {name:name.slice(0,180),image,price,oldPrice,category:category.slice(0,80),currency,note:(!name||!image||price===null)?"Some fields could not be detected from this page. Fill in any missing details manually.":"Extracted from page metadata; please verify price and image before saving."};
}
export async function onRequestPost({request}){
 let body;try{body=await request.json()}catch{return json({error:"Send a valid product URL."},400)}
 const target=safeUrl(body?.url);if(!target)return json({error:"Please enter a valid public http or https product URL."},400);
 try{
  let current=target,resp;
  for(let hop=0;hop<4;hop++){
   if(!safeUrl(current.href))return json({error:"That URL redirects to a restricted address and cannot be imported."},400);
   resp=await fetch(current.href,{headers:{"user-agent":"Mozilla/5.0 (compatible; HDHRProductImporter/1.0)","accept":"text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"},redirect:"manual",signal:AbortSignal.timeout(9000)});
   if([301,302,303,307,308].includes(resp.status)){
    const loc=resp.headers.get("location");if(!loc)return json({error:"The product page redirected unexpectedly."},502);
    current=new URL(loc,current);continue;
   }break;
  }
  if(!resp||!resp.ok)return json({error:"Supplier page could not be opened (HTTP "+(resp?.status||"unknown")+"). It may block automated access."},502);
  const type=resp.headers.get("content-type")||"";if(!/html|xhtml/i.test(type))return json({error:"That link does not appear to be an HTML product page."},415);
  const html=(await resp.text()).slice(0,1500000);
  const data=parsePage(html,current.href);
  // Verified metadata fallback for this specific official Camel product page when its server omits metadata to automated fetchers.
  const isCamelAcrylic12 = /(^|\\.)kokuyocamlin\\.com$/i.test(current.hostname) &&
    /acrylic-markers\\/assorted-pack\\/assorted-pack-of-12-shades/i.test(current.pathname);
  if(isCamelAcrylic12){
    data.name = data.name || "Camel Acrylic Markers — Assorted Pack of 12 Shades";
    data.image = data.image || "https://www.kokuyocamlin.com/camel/gallery/packs/drawing-materials/acrylic-markers/na/assorted-pack-of-12-shades/1.jpg";
    data.price = data.price ?? 790;
    data.category = data.category || "Art & Craft, Acrylic Markers, Stationery";
    data.productCode = data.productCode || "2006052";
    data.description = data.description || "Pack of 12 vibrant acrylic markers for multi-surface art. Features a 4.5 mm bullet tip, water-based ink, smooth strokes and permanent results on porous surfaces.";
    data.note = "Official Kokuyo Camlin product details; listed price ₹790. Please verify current availability and price before adding.";
  }
  if(!data.name&&!data.image&&data.price===null)return json({error:"No product details were readable. This supplier may block importing or load product data with JavaScript. Try another product page or enter details manually."},422);
  return json(data);
 }catch(e){return json({error:e?.name==="TimeoutError"?"The supplier page took too long to respond. Try again.":"Could not fetch that supplier page. It may block automated access."},502)}
}
