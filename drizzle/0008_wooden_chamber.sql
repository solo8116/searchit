CREATE TYPE "public"."status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "status" "status" DEFAULT 'RUNNING';