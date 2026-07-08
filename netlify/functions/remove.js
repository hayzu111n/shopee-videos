// netlify/functions/remove.js
// Apaga uma captura (metadados + midias gravadas) do servidor.
// GET /.netlify/functions/remove?date=2026-07-07&username=fulano

import { connectLambda, getStore } from "@netlify/blobs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

export const handler = async (event) => {
  try {
    connectLambda(event);
    const p = event.queryStringParameters || {};
    const date = (p.date || "").trim();
    const username = (p.username || "").trim().replace(/^@/, "");
    if (!date || !username)
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "date e username obrigatorios" }) };

    const store = getStore("story-shopee");
    const captureId = `${date}:${username}`;
    const meta = await store.get("capture:" + captureId, { type: "json" });

    if (meta && Array.isArray(meta.items)) {
      for (const it of meta.items) {
        await store.delete(`media:${captureId}:${it.idx}`).catch(() => {});
        await store.delete(`poster:${captureId}:${it.idx}`).catch(() => {});
      }
    }
    await store.delete("capture:" + captureId).catch(() => {});

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
