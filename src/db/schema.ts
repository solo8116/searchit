import { relations } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const RepoSchema = pgTable("repos", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const RepoRelation = relations(RepoSchema, ({ many }) => ({
  repoCode: many(RepoCodeSchema),
}));

export const RepoCodeSchema = pgTable("repocode", {
  id: uuid("id").primaryKey().defaultRandom(),
  repoId: uuid("repo_id")
    .notNull()
    .references(() => RepoSchema.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  cleanedText: text("cleaned_text").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const RepoCodeRelation = relations(RepoCodeSchema, ({ one }) => ({
  repo: one(RepoSchema, {
    fields: [RepoCodeSchema.repoId],
    references: [RepoSchema.id],
  }),
}));
