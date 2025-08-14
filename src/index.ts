import { instrument } from "@fiberplane/hono-otel";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { Hono } from "hono";
import { Bindings, TAsk, TSite } from "./types";
import { RepoCodeSchema, RepoSchema } from "./db/schema";
import { and, cosineDistance, desc, eq, gt, sql as rawSQL } from "drizzle-orm";
import { AI_MODELS, SYSTEM_PROMT } from "./constants";
import { RagWorkflow } from "./workflows";

const app = new Hono<{ Bindings: Bindings }>().basePath("/api");

app.get("/", (c) => {
  return c.text("Honc! 🪿");
});

app.post("/site", async (c) => {
  try {
    const { url, token, skipPaths } = await c.req.json<TSite>();
    if (!url || !url.startsWith("https://github.com")) {
      return c.json(
        { success: false, message: "github url is required in query" },
        400
      );
    }

    const sql = neon(c.env.DATABASE_URL);
    const db = drizzle(sql);

    const [repo] = await db
      .select()
      .from(RepoSchema)
      .where(eq(RepoSchema.url, url));
    if (repo) {
      return c.json(
        {
          success: false,
          message: `repository already exists in db`,
        },
        400
      );
    }
    const githubToken = token ? token : c.env.TOKEN;
    const instance = await c.env.RAG_WORKFLOW.create({
      params: {
        githubToken,
        path: "/",
        url,
        skipPaths,
      },
    });
    return c.json(
      {
        success: true,
        message: "rag workflow started",
        data: {
          instanceId: instance.id,
          status: (await instance.status()).status,
        },
      },
      201
    );
  } catch (error) {
    console.error(error);
    return c.json({ success: false, message: "internal server error" }, 500);
  }
});

app.get("/workflow/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const instance = await c.env.RAG_WORKFLOW.get(id);
    return c.json({
      success: true,
      message: "rag workflow status fetched successfully",
      data: {
        instanceId: instance.id,
        status: (await instance.status()).status,
      },
    });
  } catch (error) {
    console.error(error);
    return c.json({ success: false, message: "internal server error" }, 500);
  }
});

app.post("/ask", async (c) => {
  const { url, question, token } = await c.req.json<TAsk>();
  const sql = neon(c.env.DATABASE_URL);
  const db = drizzle(sql);
  const repo = await db
    .select()
    .from(RepoSchema)
    .where(eq(RepoSchema.url, url));
  if (repo.length === 0) {
    return c.json({ success: false, message: "repo not found in db" }, 404);
  }
  // NOTE: check if the user has access to the repository
  const githubToken = token ? token : c.env.TOKEN;
  const repoAccess = await fetch(
    `http://api.github.com/repos/${url.replace(
      "https://github.com/",
      ""
    )}/contents`,
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "User-Agent": "MyApp",
      },
    }
  );
  if (!repoAccess.ok) {
    throw new Error(
      `GitHub API responded with status ${repoAccess.status}: ${repoAccess.statusText}`
    );
  }
  var data = await c.env.AI.run(AI_MODELS.embeddings, {
    text: [question],
  });
  const questionEmbedding = data.data[0];

  const similarity = rawSQL<number>`1 - (${cosineDistance(
    RepoCodeSchema.embedding,
    questionEmbedding
  )})`;

  const releventContent = await db
    .select({
      path: RepoCodeSchema.path,
      content: RepoCodeSchema.cleanedText,
      similarity,
    })
    .from(RepoCodeSchema)
    .innerJoin(RepoSchema, eq(RepoCodeSchema.repoId, RepoSchema.id))
    .where(and(eq(RepoSchema.url, url), gt(similarity, 0.3)))
    .orderBy((t) => desc(t.similarity))
    .limit(5);

  const context =
    releventContent.length > 0
      ? `\nContext: ${releventContent
          .map((repoCode) => `${repoCode.path}\n${repoCode.content}\n`)
          .join("\n")}`
      : "";

  console.log(context);
  const response = await c.env.AI.run(AI_MODELS.text_generation, {
    messages: [
      { role: "system", content: SYSTEM_PROMT + context },
      { role: "user", content: question },
    ],
  });
  return c.json(response);
});

export { RagWorkflow };
export default {
  fetch: instrument(app).fetch,
};
