const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function reply(data, status=200) { return new Response(JSON.stringify(data), { status, headers }); }
function publicUrl(value) {
  let u; try { u = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") ||
      /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
      /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  return u;
}
function decode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function attr(tag, key) {
  const m = tag.match(new RegExp("\\b" + key + "\\s*=\\s*[\"']([^\"']*)[\"']", "i"));
  return m ? decode(m[1].trim()) : "";
}
function likelyProduct(url, text) {
  const path = url.toLowerCase();
  const s = (path + " " + text).toLowerCase();
  if (["/cart","/account","/login","/logout","/search","/blog","/about","/contact","/policy","/privacy","/terms","/checkout","/wishlist","/register","/pages","/collections"].some(x=>path.includes(x))) return false;
  if (/^(home|about|contact|login|sign in|register|cart|checkout|blog|faq|privacy policy|terms)$/i.test((text || "").trim())) return false;
  return ["product","products","item","shop","catalog","/p/","/dp/","/itm/"].some(x=>s.includes(x));
}

async function fetchPage(url) {
  let current = url, response;
  for (let i = 0; i < 4; i++) {
    if (!publicUrl(current.href)) throw new Error("Redirect to restricted address blocked.");
    response = await fetch(current.href, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; HDHRSiteImporter/1.0)", "accept": "text/html,application/xhtml+xml" },
      redirect: "manual", signal: AbortSignal.timeout(7000)
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) break;
      current = new URL(location, current); continue;
    }
    break;
  }
  if (!response || !response.ok) throw new Error("Supplier page could not be opened.");
  const type = response.headers.get("content-type") || "";
  if (!/html|xhtml/i.test(type)) throw new Error("The link is not an HTML page.");
  return { html: (await response.text()).slice(0, 900000), url: current.href };
}
function extract(html,url,linkText){
 const metas={};
 for(const tagMatch of html.matchAll(/<meta\\b[^>]*>/gi)){
  const tag=tagMatch[0],k=(tag.match(/\\b(?:property|name)\\s*=\\s*["']([^"']+)["']/i)||[])[1],v=(tag.match(/\\bcontent\\s*=\\s*["']([^"']*)["']/i)||[])[1];
  if(k&&v)metas[k.toLowerCase()]=decode(v);
 }
 const products=[];
 function walkJsonLd(value){
  if(!value||typeof value!=="object")return;
  if(Array.isArray(value)){for(const x of value)walkJsonLd(x);return}
  const types=Array.isArray(value["@type"])?value["@type"]:[value["@type"]];
  if(types.some(t=>/product/i.test(t||"")))products.push(value);
  for(const [k,v] of Object.entries(value))if(k==="@graph"||k==="mainEntity"||k==="mainEntityOfPage"||k==="itemListElement"||Array.isArray(v))walkJsonLd(v);
 }
 for(const block of html.matchAll(/<script\\b[^>]*type\\s*=\\s*["']application\\/ld\\+json["'][^>]*>([\\s\\S]*?)<\\/script>/gi)){try{walkJsonLd(JSON.parse(block[1].replace(/^\\uFEFF/,"").trim()))}catch{}}
 const p=products[0]||{},offers=Array.isArray(p.offers)?p.offers[0]:(p.offers||{});
 const clean=s=>decode(String(s||"").replace(/<[^>]*>/g," ").replace(/\\s+/g," ").trim());
 const tidy=v=>Array.isArray(v)?tidy(v[0]):v&&typeof v==="object"?(v.url||v["@id"]||v.contentUrl||""):typeof v==="string"?decode(v.trim()):"";
 const titleMatch=html.match(/<title\\b[^>]*>([\\s\\S]*?)<\\/title>/i),h1Match=html.match(/<h1\\b[^>]*>([\\s\\S]*?)<\\/h1>/i);
 const name=tidy(p.name)||metas["og:title"]||metas["twitter:title"]||clean(h1Match?.[1])||clean(titleMatch?.[1])||linkText||"";
 let image=tidy(p.image)||metas["og:image"]||metas["og:image:url"]||metas["twitter:image"]||"";
 try{if(image)image=new URL(image,url).href}catch{image=""}
 let raw=offers.price??offers.lowPrice??p.price??metas["product:price:amount"]??metas["og:price:amount"]??null;
 if(raw&&typeof raw==="object")raw=raw.value??null;
 if(typeof raw==="string"){raw=raw.replace(/[^\\d.,]/g,"").replace(/,(?=\\d{3}(?:\\D|$))/g,"").replace(",",".");raw=raw?Number(raw):null}
 if(typeof raw!=="number"||!Number.isFinite(raw))raw=null;
 let category=tidy(p.category)||metas["product:category"]||"";
 if(!image){const im=html.match(/<img\\b[^>]*>/i);if(im){const tag=im[0],src=(tag.match(/\\b(?:src|data-src|data-lazy-src)\\s*=\\s*["']([^"']+)/i)||[])[1];try{image=src?new URL(decode(src),url).href:""}catch{image=""}}}
 return {name:clean(name).slice(0,180),image,price:raw,oldPrice:null,category:clean(category).slice(0,80),url};
}
export async function onRequestPost({ request }) {
  let body; try { body = await request.json(); } catch { return reply({ error: "Send a valid website URL." }, 400); }
  const target = publicUrl(body?.url);
  if (!target) return reply({ error: "Please enter a public http or https website URL." }, 400);
  try {
    const home = await fetchPage(target);
    const candidates = new Map();
    for (const m of home.html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
      const tag = m[0], href = attr(tag, "href");
      const text = decode(tag.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim().slice(0, 140);
      if (!href) continue;
      let link; try { link = new URL(href, home.url); } catch { continue; }
      if (link.hostname !== new URL(home.url).hostname || !["http:","https:"].includes(link.protocol)) continue;
      link.hash = "";
      link.search = "";
      if (link.href === home.url || /\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|xml)$/i.test(link.pathname)) continue;
      if (/\/(cart|account|login|logout|search|blog|about|contact|policy|privacy|terms|checkout|wishlist|register|pages|collections)(\/|$)/i.test(link.pathname)) continue;
      if (!candidates.has(link.href)) candidates.set(link.href, {text, priority: likelyProduct(link.pathname, text) ? 0 : 1});
      if (candidates.size >= 80) break;
    }
    const products = [];
    const orderedCandidates = [...candidates.entries()].sort((a,b)=>a[1].priority-b[1].priority).slice(0,35);
    for (const [url, info] of orderedCandidates) {
      const text = info.text;
      try {
        const page = await fetchPage(url);
        const item = extract(page.html, page.url, text);
        const structuredProduct = /"@type"\s*:\s*"Product"/i.test(page.html) || /"@type"\s*:\s*\[[^\]]*"Product"/i.test(page.html);
        if (item.name && item.name.length > 1 && !/^(home|about us|contact us|privacy policy|terms and conditions|login|sign in|cart|checkout)$/i.test(item.name.trim())) products.push(item);
      } catch {}
    }
    return reply({ products, scanned: orderedCandidates.length, note: products.length ? "" : (orderedCandidates.length ? "Found links, but the shop may block automated product details. Try a category page or another supplier." : "No internal product links found on this page. Paste a category/search-results page rather than a homepage.") });
  } catch (e) {
    return reply({ error: e?.name === "TimeoutError" ? "The site took too long to respond." : (e?.message || "Could not scan this site.") }, 502);
  }
}
