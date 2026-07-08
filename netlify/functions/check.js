// netlify/functions/check.js
// Captura os stories de um @usuario, BAIXA cada video/imagem e GRAVA no
// servidor (Netlify Blobs) para o preview nao quebrar quando o story expirar.
// Salva tambem os metadados (links da Shopee etc) agrupados por data + @.
//
// GET /.netlify/functions/check?username=@fulano[&cookie=...]

import { getStore } from "@netlify/blobs";

const APP_ID = "936619743392459";

function igHeaders(cookie) {
  const h = {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
    "X-IG-App-ID": APP_ID,
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.instagram.com/",
    "Origin": "https://www.instagram.com",
  };
  if (cookie) h["Cookie"] = cookie;
  return h;
}

function extractLinks(item) {
  const links = new Set();
  const push = (u) => { if (u && /^https?:\/\//i.test(u)) links.add(u); };
  if (Array.isArray(item.story_cta))
    for (const cta of item.story_cta)
      if (Array.isArray(cta.links)) for (const l of cta.links) push(l.webUri || l.web_uri || l.url);
  if (Array.isArray(item.story_link_stickers))
    for (const s of item.story_link_stickers) {
      const l = s.story_link; if (l) push(l.url || l.webUri || l.web_uri);
    }
  try {
    const raw = JSON.stringify(item);
    const re = /https?:\/\/[^\s"'\\]+/g; let m;
    while ((m = re.exec(raw)) !== null) {
      const u = m[0];
      if (/cdninstagram|fbcdn|instagram\.com\/static|scontent/i.test(u)) continue;
      if (/instagram\.com\/(p|reel|stories|explore|accounts)/i.test(u)) continue;
      push(u);
    }
  } catch (e) {}
  return [...links];
}

function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

async function getProfile(username, headers) {
  const url = "https://www.instagram.com/api/v1/users/web_profile_info/?username=" +
    encodeURIComponent(username);
  const r = await fetch(url, { headers });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(
      `web_profile_info ${r.status}. ` +
      (r.status === 401 || r.status === 403
        ? "IG pediu login/bloqueou — adicione um cookie na aba Cookie IG. "
        : r.status === 404 ? "Usuario nao encontrado. " : "") + t.slice(0, 120)
    );
  }
  const j = await r.json();
  const u = j && j.data && j.data.user;
  if (!u) throw new Error("Resposta inesperada do Instagram.");
  return {
    id: u.id, is_private: u.is_private,
    full_name: u.full_name,
    profile_pic: u.profile_pic_url_hd || u.profile_pic_url,
  };
}

async function getReelItems(userId, headers) {
  const url = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`reels_media ${r.status}`);
  const j = await r.json();
  const reel = (j.reels && (j.reels[userId] || j.reels[String(userId)])) ||
    (Array.isArray(j.reels_media) && j.reels_media[0]);
  return reel && Array.isArray(reel.items) ? reel.items : [];
}

async function downloadToBlob(store, key, mediaUrl, headers) {
  const r = await fetch(mediaUrl, {
    headers: { "User-Agent": headers["User-Agent"], "Referer": "https://www.instagram.com/" },
  });
  if (!r.ok) throw new Error("download " + r.status);
  const buf = await r.arrayBuffer();
  const contentType = r.headers.get("content-type") ||
    (/\.mp4/i.test(mediaUrl) ? "video/mp4" : "image/jpeg");
  await store.set(key, buf, { metadata: { contentType } });
  return contentType;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors, body: "" };
  try {
    const p = event.queryStringParameters || {};
    let username = (p.username || p.user || "").trim().replace(/^@/, "").replace(/\/+$/, "");
    if (!username)
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Informe ?username=@usuario" }) };

    const cookie = process.env.IG_COOKIE || p.cookie || "";
    const headers = igHeaders(cookie);
    const store = getStore("story-shopee");

    const profile = await getProfile(username, headers);
    const date = todayKey();
    const captureId = `${date}:${username}`;

    if (profile.is_private) {
      const meta = {
        date, username, full_name: profile.full_name, profile_pic: profile.profile_pic,
        capturedAt: Date.now(), items: [],
        warning: "Conta privada — nao da pra ver stories.",
      };
      await store.setJSON("capture:" + captureId, meta);
      return { statusCode: 200, headers: cors, body: JSON.stringify(meta) };
    }

    const rawItems = await getReelItems(profile.id, headers);
    const items = [];

    for (let i = 0; i < rawItems.length; i++) {
      const it = rawItems[i];
      const imgs = it.image_versions2 && it.image_versions2.candidates;
      const imageUrl = imgs && imgs.length ? imgs[0].url : null;
      const videoUrl = Array.isArray(it.video_versions) && it.video_versions.length
        ? it.video_versions[0].url : null;
      const isVideo = !!videoUrl;

      const rec = {
        idx: i,
        type: isVideo ? "video" : "image",
        links: extractLinks(it),
        contentType: isVideo ? "video/mp4" : "image/jpeg",
        posterType: "image/jpeg",
        stored: false,
        posterStored: false,
      };

      try {
        const mediaKey = `media:${captureId}:${i}`;
        rec.contentType = await downloadToBlob(store, mediaKey, videoUrl || imageUrl, headers);
        rec.stored = true;
        // poster (thumb) para video
        if (isVideo && imageUrl) {
          try {
            const posterKey = `poster:${captureId}:${i}`;
            rec.posterType = await downloadToBlob(store, posterKey, imageUrl, headers);
            rec.posterStored = true;
          } catch (e) {}
        }
      } catch (e) {
        rec.error = "Falha ao gravar midia: " + (e.message || e);
      }
      items.push(rec);
    }

    const meta = {
      date, username,
      full_name: profile.full_name,
      profile_pic: profile.profile_pic,
      capturedAt: Date.now(),
      count: items.length,
      items,
      warning: items.length ? null : "Nenhum story ativo agora (ou ja expiraram).",
    };
    await store.setJSON("capture:" + captureId, meta);

    return { statusCode: 200, headers: cors, body: JSON.stringify(meta) };
  } catch (err) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
