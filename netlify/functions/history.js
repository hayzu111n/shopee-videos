// netlify/functions/history.js
// Retorna todo o historico gravado no servidor, agrupado por data.
// GET /.netlify/functions/history

import { connectLambda, getStore } from "@netlify/blobs";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

export const handler = async (event) => {
  try {
    connectLambda(event);
    const store = getStore("story-shopee");
    const { blobs } = await store.list({ prefix: "capture:" });
    const captures = [];
    for (const b of blobs) {
      const meta = await store.get(b.key, { type: "json" });
      if (meta) captures.push(meta);
    }
    // agrupa por data
    const byDate = {};
    for (const c of captures) {
      (byDate[c.date] = byDate[c.date] || []).push(c);
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ byDate }) };
  } catch (err) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
