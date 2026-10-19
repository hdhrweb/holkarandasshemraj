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
 for(const tagMatch of html.matchAll(/<meta\b[^>]*>/gi)){
  const tag=tagMatch[0],k=(tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)||[])[1],v=(tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)||[])[1];
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
 for(const block of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walkJsonLd(JSON.parse(block[1].replace(/^\uFEFF/,"").trim()))}catch{}}
 const p=products[0]||{},offers=Array.isArray(p.offers)?p.offers[0]:(p.offers||{});
 const clean=s=>decode(String(s||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim());
 const tidy=v=>Array.isArray(v)?tidy(v[0]):v&&typeof v==="object"?(v.url||v["@id"]||v.contentUrl||""):typeof v==="string"?decode(v.trim()):"";
 const titleMatch=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i),h1Match=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
 const name=tidy(p.name)||metas["og:title"]||metas["twitter:title"]||clean(h1Match?.[1])||clean(titleMatch?.[1])||linkText||"";
 let image=tidy(p.image)||metas["og:image"]||metas["og:image:url"]||metas["twitter:image"]||"";
 try{if(image)image=new URL(image,url).href}catch{image=""}
 let raw=offers.price??offers.lowPrice??p.price??metas["product:price:amount"]??metas["og:price:amount"]??null;
 if(raw&&typeof raw==="object")raw=raw.value??null;
 if(typeof raw==="string"){raw=raw.replace(/[^\d.,]/g,"").replace(/,(?=\d{3}(?:\D|$))/g,"").replace(",",".");raw=raw?Number(raw):null}
 if(typeof raw!=="number"||!Number.isFinite(raw))raw=null;
 let category=tidy(p.category)||metas["product:category"]||"";
 if(!image){const im=html.match(/<img\b[^>]*>/i);if(im){const tag=im[0],src=(tag.match(/\b(?:src|data-src|data-lazy-src)\s*=\s*["']([^"']+)/i)||[])[1];try{image=src?new URL(decode(src),url).href:""}catch{image=""}}}
 return {name:clean(name).slice(0,180),image,price:raw,oldPrice:null,category:clean(category).slice(0,80),url};
}
function addCandidate(candidates, href, text, baseUrl) {
  try {
    const link = new URL(href, baseUrl);
    const base = new URL(baseUrl);
    if (link.hostname !== base.hostname || !["http:","https:"].includes(link.protocol)) return;
    link.hash = "";
    if (/\\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|xml|json)$/i.test(link.pathname)) return;
    if (/\\/(cart|account|login|logout|search|blog|about|contact|policy|privacy|terms|checkout|wishlist|register)(\\/|$)/i.test(link.pathname)) return;
    if (link.href === base.href) return;
    const key = link.href;
    const priority = likelyProduct(link.pathname, text) ? 0 : (/\\/(products?|p|dp|itm|item)(\\/|$)/i.test(link.pathname) ? 0 : 1);
    const old = candidates.get(key);
    if (!old || priority < old.priority || (!old.text && text)) candidates.set(key, {text: text || "", priority});
  } catch {}
}
function discoverJsonLd(html, candidates, baseUrl) {
  function walk(v) {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    const types = Array.isArray(v["@type"]) ? v["@type"] : [v["@type"]];
    const isProduct = types.some(t => /product/i.test(t || ""));
    const url = v.url || v["@id"] || v.item?.url || v.item?.["@id"];
    if (isProduct && url) addCandidate(candidates, typeof url === "object" ? (url.url || url["@id"]) : url, v.name || v.item?.name || "", baseUrl);
    if (/ItemList/i.test(types.join(" ")) && Array.isArray(v.itemListElement)) {
      for (const entry of v.itemListElement) {
        const item = entry?.item || entry;
        const u = item?.url || item?.["@id"];
        if (u) addCandidate(candidates, typeof u === "object" ? (u.url || u["@id"]) : u, item?.name || "", baseUrl);
      }
    }
    for (const [k, val] of Object.entries(v)) if (["@graph","mainEntity","mainEntityOfPage","itemListElement","item","hasVariant"].includes(k) || Array.isArray(val)) walk(val);
  }
  for (const m of html.matchAll(/<script\\b[^>]*type\\s*=\\s*["']application\\/ld\\+json["'][^>]*>([\\s\\S]*?)<\\/script>/gi)) {
    try { walk(JSON.parse(m[1].replace(/^\\uFEFF/, "").trim())); } catch {}
  }
}
export async function onRequestPost({ request }) {
  let body; try { body = await request.json(); } catch { return reply({ error: "Send a valid website URL." }, 400); }
  const target = publicUrl(body?.url);
  if (!target) return reply({ error: "Please enter a public http or https website URL." }, 400);
  try {
    const home = await fetchPage(target);
    const candidates = new Map();
    discoverJsonLd(home.html, candidates, home.url);
    for (const m of home.html.matchAll(/<a\\b[^>]*>[\\s\\S]*?<\\/a>/gi)) {
      const tag = m[0], href = attr(tag, "href");
      const text = decode(tag.replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ")).trim().slice(0, 180);
      if (href) addCandidate(candidates, href, text, home.url);
    }
    // Follow category/collection links and collect product links from those pages too.
    const categoryLinks = [...candidates.entries()].filter(([u, v]) => v.priority > 0 && /category|collection|catalog|shop|store|stationery|art|book|product/i.test(u + " " + v.text)).slice(0, 8);
    for (const [u] of categoryLinks) {
      try {
        const page = await fetchPage(u);
        discoverJsonLd(page.html, candidates, page.url);
        for (const m of page.html.matchAll(/<a\\b[^>]*>[\\s\\S]*?<\\/a>/gi)) {
          const tag = m[0], href = attr(tag, "href");
          const text = decode(tag.replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ")).trim().slice(0, 180);
          if (href) addCandidate(candidates, href, text, page.url);
        }
      } catch {}
    }
    const ordered = [...candidates.entries()].sort((a,b)=>a[1].priority-b[1].priority).slice(0,100);
    const results = await Promise.all(ordered.map(async ([url, info]) => {
      try {
        const page = await fetchPage(url);
        const item = extract(page.html, page.url, info.text);
        const hasProductSignals = /"@type"\\s*:\\s*"Product"/i.test(page.html) ||
          /"@type"\\s*:\\s*\\[[^\\]]*"Product"/i.test(page.html) ||
          /product:price:amount|product:category|og:price:amount/i.test(page.html) ||
          /\\/(product|products|item|dp|p)\\//i.test(new URL(page.url).pathname);
        const title = (item.name || "").trim();
        if (!hasProductSignals || title.length < 2 || /^(home|about us|contact us|privacy policy|terms and conditions|login|sign in|cart|checkout|shop|products|collections|catalog)$/i.test(title)) return null;
        item.category = item.category || "";
        return item;
      } catch { return null; }
    }));
    const seen = new Set(), products = [];
    for (const p of results.filter(Boolean)) {
      const key = (p.url || "").split("?")[0].replace(/\\/$/, "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); products.push(p);
    }
    return reply({ products, scanned: ordered.length, note: products.length ? "" : (ordered.length ? "This supplier is hiding product data from automated requests. Try its category page or paste a sitemap URL." : "No product links found. Paste a category/search-results page or the supplier sitemap URL.") });
  } catch (e) {
    return reply({ error: e?.name === "TimeoutError" ? "The site took too long to respond." : (e?.message || "Could not scan this site.") }, 502);
  }
}
