import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep,
} from "cloudflare:workers";
import { AI_MODELS } from "../constants";
import { Bindings, TExtractedCode } from "../types";
import { RepoCodeSchema, RepoSchema } from "../db/schema";
import { eq } from "drizzle-orm";
import { NonRetryableError } from "cloudflare:workflows";

export type RagWorflowParams = {
  url: string;
  path: string;
  githubToken: string;
  skipPaths?: string[];
};

export class RagWorkflow extends WorkflowEntrypoint<
  Bindings,
  RagWorflowParams
> {
  async run(event: WorkflowEvent<RagWorflowParams>, step: WorkflowStep) {
    // NOTE: Had to use pool and transactions as workers free plan only supports 50 subrequests per requests
    const pool = new Pool({ connectionString: this.env.DATABASE_URL });
    const db = drizzle({ client: pool });

    await db.transaction(async (trx) => {
      const existingRepo = await step.do("Check if repo exists", async () => {
        return await trx
          .select()
          .from(RepoSchema)
          .where(eq(RepoSchema.url, event.payload.url));
      });

      const repoId = existingRepo[0]?.id
        ? existingRepo[0].id
        : await step.do("Insert a new repo", async () => {
            const [newRepo] = await trx
              .insert(RepoSchema)
              .values({
                url: event.payload.url,
              })
              .returning({ id: RepoSchema.id });

            return newRepo.id;
          });

      await step.do("Scrape repo, genrate vector and insert", async () => {
        const response = await fetch(this.env.EXTRACT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: event.payload.url,
            path: event.payload.path,
            token: event.payload.githubToken,
            skipPaths: event.payload.skipPaths,
          }),
        });
        if (!response.ok) {
          throw new NonRetryableError(await response.json());
        }
        const results = ((await response.json()) as TExtractedCode).data;
        const repoCodes = await Promise.all(
          results.map(async ([path, code]) => {
            const [repoCode] = await trx
              .insert(RepoCodeSchema)
              .values({
                cleanedText: code,
                path,
                repoId,
              })
              .returning({
                id: RepoCodeSchema.id,
                path: RepoCodeSchema.path,
                text: RepoCodeSchema.cleanedText,
              });

            return repoCode;
          })
        );
        await step.do("Generate vector embeddings for file", async () => {
          await Promise.all(
            repoCodes.map(async (repoCode) => {
              await step.do(
                `Generate and Insert embedding for repoCode ${repoCode.id}`,
                async () => {
                  const { data } = await this.env.AI.run(AI_MODELS.embeddings, {
                    text: [repoCode.path, repoCode.text],
                  });
                  await trx
                    .update(RepoCodeSchema)
                    .set({ embedding: data[0] })
                    .where(eq(RepoCodeSchema.id, repoCode.id));
                }
              );
            })
          );
        });
      });
    });
  }
}
