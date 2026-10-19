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
function extract(html, url, linkText) {
  const metas = {};
  for (const m of html.matchAll(/<meta\\b[^>]*>/gi)) {
    const tag=m[0], key=(attr(tag,"property")||attr(tag,"name")).toLowerCase(), value=attr(tag,"content");
    if(key&&value) metas[key]=value;
  }
  let title="";
  const titleAt=html.toLowerCase().indexOf("<title");
  const open=titleAt>=0?html.indexOf(">",titleAt):-1;
  const close=open>=0?html.toLowerCase().indexOf("</title>",open):-1;
  if(open>=0&&close>open) title=decode(html.slice(open+1,close).replace(/<[^>]*>/g," ")).trim();
  const clean=s=>decode(String(s||"").replace(/<[^>]*>/g," ").replace(/\\s+/g," ").trim());
  const productJson=html.match(/"name"\\s*:\\s*"([^"]{2,180})"[\\s\\S]{0,1200}?"(?:price|image)"\\s*:/i);
  const name=metas["og:title"]||metas["twitter:title"]||attr((html.match(/<h1\\b[^>]*>/i)||[""])[0],"content")||title||linkText||(productJson?decode(productJson[1]):"");
  let image=metas["og:image"]||metas["twitter:image"]||"";
  if(!image){const im=html.match(/<img\\b[^>]*>/i);if(im) image=attr(im[0],"src")||attr(im[0],"data-src")||attr(im[0],"data-lazy-src");}
  try{if(image) image=new URL(image,url).href;}catch{image="";}
  let rawPrice=metas["product:price:amount"]||metas["og:price:amount"]||"";
  if(!rawPrice){const matches=[...html.matchAll(/(?:itemprop=["']price["'][^>]*content=["']([^"']+)|"price"\\s*:\\s*"?([0-9]+(?:\\.[0-9]+)?))/gi)];if(matches.length)rawPrice=matches[0][1]||matches[0][2]||"";}
  const price=rawPrice!==""&&Number.isFinite(Number(rawPrice))?Number(rawPrice):null;
  const category=metas["product:category"]||"";
  return {name:clean(name).slice(0,180),image,price,oldPrice:null,category:clean(category).slice(0,80),url};
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
      if (link.href === home.url || /\\.(jpg|jpeg|png|gif|webp|svg|pdf|css|js|xml)$/i.test(link.pathname)) continue;
      if (/\\/(cart|account|login|logout|search|blog|about|contact|policy|privacy|terms|checkout|wishlist|register|pages|collections)(\\/|$)/i.test(link.pathname)) continue;
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
        const structuredProduct = /"@type"\\s*:\\s*"Product"/i.test(page.html) || /"@type"\\s*:\\s*\\[[^\\]]*"Product"/i.test(page.html);
        if (item.name && (item.image || item.price !== null || structuredProduct || likelyProduct(url, item.name))) products.push(item);
      } catch {}
    }
    return reply({ products, scanned: orderedCandidates.length, note: products.length ? "" : (orderedCandidates.length ? "Found links, but the shop may block automated product details. Try a category page or another supplier." : "No internal product links found on this page. Paste a category/search-results page rather than a homepage.") });
  } catch (e) {
    return reply({ error: e?.name === "TimeoutError" ? "The site took too long to respond." : (e?.message || "Could not scan this site.") }, 502);
  }
}
