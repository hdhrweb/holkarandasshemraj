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

function inferCategory(name, url, category="") {
  if (category && category.trim()) return category.trim().slice(0,80);
  const s=(String(name||"")+" "+String(url||"")).toLowerCase().replace(/[-_/]+/g," ");
  const rules=[
    [/notebook|notepad|paper|register|diary|journal|writing pad/,"Notebooks & Paper"],
    [/marker|pencil|crayon|paint|colour|color|brush|canvas|clay|glue|adhesive|eraser|sharpener|sketch|acrylic|art|craft|geometry|watercolou?r/,"Art & Craft"],
    [/pen|ink|stationery|highlighter|correction|stapler|office supply/,"Stationery"],
    [/school bag|backpack|lunch bag|pencil case|school essential/,"Bags & School Essentials"],
    [/toy|puzzle|game|doll|blocks|plush/,"Toys & Games"],
    [/book|story|novel|workbook|learning|activity book/,"Books & Learning"],
    [/mug|cup|home decor|decor|lamp|organizer|organiser/,"Home & Lifestyle"],
    [/shirt|t-shirt|dress|kurta|clothing|fashion/,"Fashion & Accessories"],
    [/phone|mobile|charger|cable|earphone|headphone|electronic/,"Electronics & Accessories"]
  ];
  for(const [re,cat] of rules) if(re.test(s)) return cat;
  return "Everyday Essentials";
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
function resolveImage(raw, baseUrl) {
  const value = decode(String(raw || "").trim()).replace(/&amp;/g, "&");
  if (!value || /^(data:image\/(?:gif|png);base64,|#|javascript:)/i.test(value)) return "";
  try {
    const u = new URL(value, baseUrl);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch { return ""; }
}
function imageFromTag(tag, baseUrl) {
  const attrs = ["data-src", "data-lazy-src", "data-original", "data-original-src", "data-zoom-image", "data-image", "data-large_image", "data-lazy", "data-srcset", "srcset", "src"];
  for (const key of attrs) {
    const raw = attr(tag, key);
    if (!raw) continue;
    const candidate = key.includes("srcset") ? raw.split(",").map(x => x.trim().split(/\s+/)[0]).filter(Boolean).pop() : raw;
    const resolved = resolveImage(candidate, baseUrl);
    if (resolved && !/transparent|placeholder|spacer/i.test(resolved)) return resolved;
  }
  return "";
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
 let image="";
 const jsonImage=resolveImage(tidy(p.image),url);
 const metadataImage=resolveImage(metas["og:image"]||metas["og:image:url"]||metas["twitter:image"]||"",url);
 if(jsonImage && !/logo|banner|placeholder|sprite|favicon/i.test(jsonImage)) image=jsonImage;
 let raw=offers.price??offers.lowPrice??p.price??metas["product:price:amount"]??metas["og:price:amount"]??null;
 // Camlin product pages sometimes expose the visible MRP without Product JSON-LD price metadata.
 if(raw==null){const visiblePrice=html.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);if(visiblePrice)raw=visiblePrice[1];}
 if(raw&&typeof raw==="object")raw=raw.value??null;
 if(typeof raw==="string"){raw=raw.replace(/[^\d.,]/g,"").replace(/,(?=\d{3}(?:\D|$))/g,"").replace(",",".");raw=raw?Number(raw):null}
 if(typeof raw!=="number"||!Number.isFinite(raw))raw=null;
 let category=tidy(p.category)||metas["product:category"]||"";
 {
  const imgs=[...html.matchAll(/<(?:img|source)\\b[^>]*>/gi)].map(m=>m[0]);
  const ranked=[];
  for(const tag of imgs){
   const candidate=imageFromTag(tag,url);
   if(!candidate || /logo|banner|placeholder|sprite|favicon|payment|social|avatar|tracking|pixel|loader/i.test(candidate+" "+attr(tag,"alt")+" "+attr(tag,"title"))) continue;
   let score=0;
   if(/product|gallery|catalog|catalogue|uploads|media|products?\\//i.test(candidate)) score+=4;
   if(/\\.(jpe?g|png|webp)(?:$|[?&])/i.test(candidate)) score+=2;
   if(/product|pack|shade|marker|pencil|notebook|camlin|camel/i.test(candidate+" "+attr(tag,"alt"))) score+=3;
   ranked.push({url:candidate,score});
  }
  ranked.sort((a,b)=>b.score-a.score);
  image=ranked[0]?.url || image || metadataImage;
 }
 if(!image){
  const styles=[...html.matchAll(/\bstyle\s*=\s*["']([^"']*background(?:-image)?\s*:[^"']*)["']/gi)].map(m=>m[1]);
  for(const style of styles){
   const bg=style.match(/background(?:-image)?\s*:[^;]*url\((?:['"])?([^)'"\s]+)(?:['"])?\)/i);
   if(bg){image=resolveImage(bg[1],url);if(image)break}
  }
 }
 return {name:clean(name).slice(0,180),image,price:raw,oldPrice:null,category:clean(category).slice(0,80),url};
}

function extractListingProducts(html, baseUrl) {
  const found = [];
  const clean = s => decode(String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  for (const m of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = m[0], href = attr(tag, "href");
    if (!href) continue;
    let u; try { u = new URL(href, baseUrl); } catch { continue; }
    if (u.hostname !== new URL(baseUrl).hostname || !u.pathname.toLowerCase().startsWith("/camlin/")) continue;
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|xml|json)$/i.test(u.pathname)) continue;
    const inner = tag.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, "");
    const imageTags = [...inner.matchAll(/<(?:img|source)\b[^>]*>/gi)].map(x => x[0]);
    const imgTag = imageTags[0] || "";
    const imgAlt = attr(imgTag, "alt") || attr(imgTag, "title");
    let cardImage = "";
    for (const candidateTag of imageTags) {
      cardImage = imageFromTag(candidateTag, baseUrl);
      if (cardImage) break;
    }
    // Some catalogue cards use a CSS background image instead of an <img>.
    if (!cardImage) {
      const style = attr(tag, "style") || attr(inner, "style");
      const bg = style.match(/background(?:-image)?\s*:[^;]*url\((?:['"])?([^)'"]+)(?:['"])?\)/i);
      if (bg) cardImage = resolveImage(bg[1], baseUrl);
    }
    const titleAttr = attr(tag, "title") || attr(tag, "aria-label");
    const text = clean(inner.replace(/<img\b[^>]*>/gi, " "));
    const name = (text.match(/.{2,180}/) || [])[0] || imgAlt || titleAttr || "";
    const priceMatch = (inner + " " + (m[0].match(/.{0,80}₹\s*[\d,]+(?:\.\d{1,2})?.{0,40}/) || [""])[0]).match(/(?:₹|Rs\.?\s*)\s*([\d,]+(?:\.\d{1,2})?)/i);
    let price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null;
    let image = cardImage;
    if (!image) {
      const meta = html.match(/<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*>/i);
      if (meta) image = resolveImage(attr(meta[0], "content"), baseUrl);
    }
    if (name.length < 3 || (!image && price === null)) continue;
    found.push({ name: name.slice(0,180), image, price, oldPrice:null, category:inferCategory(name,u.href), url:u.href });
  }
  return found;
}

function addCandidate(candidates, href, text, baseUrl) {
  try {
    const link = new URL(href, baseUrl);
    const base = new URL(baseUrl);
    if (link.hostname !== base.hostname || !["http:","https:"].includes(link.protocol)) return;
    // Keep a /camlin/ scan inside the Camlin catalogue, rather than mixing in the sibling Camel art catalogue.
    if (base.pathname.toLowerCase().startsWith("/camlin") && !link.pathname.toLowerCase().startsWith("/camlin/")) return;
    link.hash = "";
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|xml|json)$/i.test(link.pathname)) return;
    if (/\/(cart|account|login|logout|search|blog|about|contact|policy|privacy|terms|checkout|wishlist|register)(\/|$)/i.test(link.pathname)) return;
    if (link.href === base.href) return;
    const key = link.href;
    const priority = likelyProduct(link.pathname, text) ? 0 : (/\/(products?|p|dp|itm|item)(\/|$)/i.test(link.pathname) ? 0 : 1);
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
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].replace(/^\uFEFF/, "").trim())); } catch {}
  }
}
export async function onRequestPost({ request }) {
  let body; try { body = await request.json(); } catch { return reply({ error: "Send a valid website URL." }, 400); }
  const target = publicUrl(body?.url);
  if (!target) return reply({ error: "Please enter a public http or https website URL." }, 400);
  try {
    const home = await fetchPage(target);
    const candidates = new Map();
    const listingProducts = extractListingProducts(home.html, home.url);
    discoverJsonLd(home.html, candidates, home.url);
    for (const m of home.html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
      const tag = m[0], href = attr(tag, "href");
      const text = decode(tag.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim().slice(0, 180);
      if (href) addCandidate(candidates, href, text, home.url);
    }
    // Read public sitemap URLs, including sitemap indexes.
    const sitemapUrls = new Set([new URL("/sitemap.xml", home.url).href, new URL("/sitemap_index.xml", home.url).href, new URL("/sitemaps", home.url).href]);
    const sitemapQueue = [...sitemapUrls];
    for (let si = 0; si < sitemapQueue.length && si < 8; si++) {
      const sm = sitemapQueue[si];
      try {
        const response = await fetch(sm, {headers: {"user-agent":"Mozilla/5.0 (compatible; HDHRSiteImporter/1.0)","accept":"application/xml,text/xml,text/html,*/*"}, signal:AbortSignal.timeout(5000)});
        if (!response.ok) continue;
        const xml = (await response.text()).slice(0, 1500000);
        for (const match of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
          const loc = decode(match[1].trim());
          if (!loc) continue;
          if (/sitemap/i.test(loc) && /\.xml(?:\?|$)/i.test(loc) && sitemapUrls.size < 12 && !sitemapUrls.has(loc)) {
            sitemapUrls.add(loc); sitemapQueue.push(loc);
          } else addCandidate(candidates, loc, "", home.url);
        }
      } catch {}
    }
    // The supplier's /sitemaps endpoint can be an HTML sitemap, not XML.
    try {
      const sitemapPage = await fetchPage(new URL("/sitemaps", home.url));
      for (const m of sitemapPage.html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
        const tag=m[0], href=attr(tag,"href");
        const label=decode(tag.replace(/<[^>]*>/g," ").replace(/\s+/g," ")).trim().slice(0,180);
        if(href)addCandidate(candidates,href,label,sitemapPage.url);
      }
      discoverJsonLd(sitemapPage.html,candidates,sitemapPage.url);
      listingProducts.push(...extractListingProducts(sitemapPage.html, sitemapPage.url));
    } catch {}
    // Camlin catalogue pages use nested category/product paths and a shared /sitemaps page.
    // Seed the known Camlin categories, then exclude the sibling Camel art catalogue.
    const camlinCatalogue = target.hostname.toLowerCase().endsWith("kokuyocamlin.com") &&
      target.pathname.toLowerCase().replace(/\/$/, "").startsWith("/camlin");
    if (camlinCatalogue) {
      for (const path of [
        "/camlin/notebooks",
        "/camlin/markers-and-pens",
        "/camlin/pencils-and-accessories",
        "/camlin/geometry-box",
        "/camlin/adhesives",
        "/camlin/early-learning",
        "/camlin/office-supplies"
      ]) {
        const url = new URL(path, target.origin).href;
        if (!candidates.has(url)) candidates.set(url, { text: "Camlin category", priority: 0 });
      }
      for (const [url, info] of [...candidates.entries()]) {
        try {
          const parsed = new URL(url);
          if (parsed.hostname.toLowerCase() !== target.hostname.toLowerCase() ||
              !parsed.pathname.toLowerCase().startsWith("/camlin/")) candidates.delete(url);
        } catch { candidates.delete(url); }
      }
    }
    // Always scan category pages directly: homepages often expose only promotional links.
    const categoryUrls = new Set(
      [...candidates.entries()]
        .filter(([u, v]) => /category|collection|catalog|shop|store|stationery|art|book|product|notebook|marker|pen|pencil|adhesive|geometry|early-learning|office-supplies/i.test(u + " " + v.text))
        .map(([u]) => u)
        .slice(0, 20)
    );
    if (camlinCatalogue) {
      for (const path of [
        "/camlin/notebooks/",
        "/camlin/markers-and-pens/",
        "/camlin/pencils-and-accessories/",
        "/camlin/geometry-box/",
        "/camlin/adhesives/",
        "/camlin/early-learning/",
        "/camlin/office-supplies/"
      ]) categoryUrls.add(new URL(path, target.origin).href);
    }
    for (const u of categoryUrls) {
      try {
        const page = await fetchPage(new URL(u));
        discoverJsonLd(page.html, candidates, page.url);
        listingProducts.push(...extractListingProducts(page.html, page.url));
        for (const m of page.html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
          const tag = m[0], href = attr(tag, "href");
          const text = decode(tag.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim().slice(0, 180);
          if (href) addCandidate(candidates, href, text, page.url);
        }
      } catch {}
    }
    const ordered = [...candidates.entries()].sort((a,b)=>a[1].priority-b[1].priority).slice(0,80);
    // Keep supplier requests bounded; large parallel bursts often trigger bot protection.
    const results = new Array(ordered.length);
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= ordered.length) return;
        const [url, info] = ordered[index];
        try {
          const page = await fetchPage(url);
          const item = extract(page.html, page.url, info.text);
          const hasStructuredProduct = /"@type"\s*:\s*"Product"/i.test(page.html) ||
            /"@type"\s*:\s*\[[^\]]*"Product"/i.test(page.html) ||
            /product:price:amount|product:category|og:price:amount/i.test(page.html);
          const pathLooksProduct = /product|item|sku|notebook|marker|pencil|pen|geometry|adhesive|crayon|paint|colour|color|brush|clay|glue|sharpener|eraser|ink/i.test(new URL(page.url).pathname);
          const title = (item.name || "").trim();
          const hasUsefulDetails = !!item.image || item.price !== null;
          if (title.length < 2 || /^(home|about us|contact us|privacy policy|terms and conditions|login|sign in|cart|checkout|shop|products|collections|catalog|search results)$/i.test(title)) { results[index] = null; continue; }
          if (!hasStructuredProduct && !pathLooksProduct && !hasUsefulDetails) { results[index] = null; continue; }
          item.category = inferCategory(item.name, item.url, item.category);
          results[index] = item;
        } catch { results[index] = null; }
      }
    };
    await Promise.all(Array.from({length: Math.min(6, ordered.length)}, () => worker()));
    // Merge listing-card results with the same product page's metadata. Listing cards
    // often have a title but no usable image; do not let them overwrite richer page data.
    const byUrl = new Map();
    for (const p of [...listingProducts, ...results.filter(Boolean)]) {
      const key = (p.url || "").split("?")[0].replace(/\/$/, "").toLowerCase();
      if (!key) continue;
      const prior = byUrl.get(key);
      if (!prior) { byUrl.set(key, { ...p }); continue; }
      byUrl.set(key, {
        ...prior,
        ...p,
        name: (p.name || "").length > (prior.name || "").length ? p.name : (prior.name || p.name),
        image: p.image || prior.image || "",
        price: p.price !== null && p.price !== undefined ? p.price : prior.price,
        oldPrice: p.oldPrice !== null && p.oldPrice !== undefined ? p.oldPrice : prior.oldPrice,
        category: p.category || prior.category || "",
        url: p.url || prior.url
      });
    }
    const products = [...byUrl.values()];
    return reply({ products, scanned: ordered.length, note: products.length ? "" : (ordered.length ? "This supplier is hiding product data from automated requests. Try its category page or paste a sitemap URL." : "No product links found. Paste a category/search-results page or the supplier sitemap URL.") });
  } catch (e) {
    return reply({ error: e?.name === "TimeoutError" ? "The site took too long to respond." : (e?.message || "Could not scan this site.") }, 502);
  }
}
