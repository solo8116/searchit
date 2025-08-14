ALTER TABLE "embeddings" RENAME TO "repocode";--> statement-breakpoint
ALTER TABLE "repocode" DROP CONSTRAINT "embeddings_repo_id_repos_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repocode" ADD CONSTRAINT "repocode_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
