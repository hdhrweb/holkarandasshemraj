const headers = { "cache-control": "public, max-age=86400, s-maxage=604800" };
function publicUrl(value) {
  let u; try { u = new URL(value); } catch { return null; }
  if (!["http:", "https:"].includes(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") ||
      /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
      /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return null;
  return u;
}
export async function onRequestGet({ request }) {
  const requestUrl = new URL(request.url);
  const target = publicUrl(requestUrl.searchParams.get("url"));
  if (!target) return new Response("Invalid image URL", { status: 400 });
  try {
    let current = target, response;
    for (let i = 0; i < 4; i++) {
      if (!publicUrl(current.href)) return new Response("Blocked image redirect", { status: 400 });
      response = await fetch(current.href, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; HDHRStoreImage/1.0)",
          "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "referer": current.origin + "/"
        },
        redirect: "manual",
        signal: AbortSignal.timeout(8000)
      });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) break;
        current = new URL(location, current);
        continue;
      }
      break;
    }
    if (!response || !response.ok) return new Response("Image source unavailable", { status: 502 });
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/") || type === "image/svg+xml") return new Response("Source did not return a supported image", { status: 415 });
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) return new Response("Image is empty or too large", { status: 413 });
    return new Response(bytes, { status: 200, headers: { ...headers, "content-type": type, "x-content-type-options": "nosniff" } });
  } catch {
    return new Response("Could not load image source", { status: 502 });
  }
}
