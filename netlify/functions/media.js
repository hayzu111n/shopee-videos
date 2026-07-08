// netlify/functions/media.js
// Serve a midia GRAVADA no servidor (Netlify Blobs).
// GET /.netlify/functions/media?key=media:2026-07-07:fulano:0[&dl=1]
//   dl=1  -> forca download (Content-Disposition: attachment)

import { getStore } from "@netlify/blobs";

export const handler = async (event) => {
  const p = event.queryStringParameters || {};
  const key = p.key;
  if (!key || !/^(media|poster):/.test(key))
    return { statusCode: 400, body: "key invalida" };

  try {
    const store = getStore("story-shopee");
    const res = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!res || !res.data) return { statusCode: 404, body: "nao encontrado" };

    const contentType = (res.metadata && res.metadata.contentType) || "application/octet-stream";
    const isVideo = /video/.test(contentType);
    const buf = Buffer.from(res.data);

    const headers = {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    if (p.dl === "1") {
      headers["Content-Disposition"] =
        `attachment; filename="${isVideo ? "story.mp4" : "story.jpg"}"`;
    }

    return {
      statusCode: 200,
      headers,
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 502, body: "erro: " + String(err.message || err) };
  }
};
