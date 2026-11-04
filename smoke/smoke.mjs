import * as lancedb from "@lancedb/lancedb";
import { FlagEmbedding, EmbeddingModel } from "fastembed";

// ---- 1. Local embeddings (no API key) ----
const t0 = Date.now();
const model = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallENV15 });
const texts = [
  "hello world",
  "retrieval augmented generation pipelines",
  "duckduckgo realtime web search",
];
const vecs = [];
for await (const batch of model.embed(texts, 8)) vecs.push(...batch);
console.log(`EMBED OK dim=${vecs[0].length} in ${Date.now() - t0}ms`);

// ---- 2. LanceDB: vector search ----
const db = await lancedb.connect("./data");
const rows = texts.map((text, i) => ({ id: i + 1, text, vector: vecs[i] }));
const tbl = await db.createTable("smoke", rows, { mode: "overwrite" });

const q = await model.queryEmbed("augmented retrieval");
const hits = await tbl.vectorSearch(q).limit(2).toArray();
console.log("VECTOR OK ->", hits.map((h) => h.text));

// ---- 3. LanceDB: full-text search (hybrid half) ----
try {
  await tbl.createIndex("text", { config: lancedb.Index.fts() });
  const fts = await tbl.search("retrieval", "fts", ["text"]).limit(2).toArray();
  console.log("FTS OK ->", fts.map((h) => h.text));
} catch (e) {
  console.log("FTS FAIL ->", e.message);
}

console.log("SMOKE DONE");
