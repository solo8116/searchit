import { RagWorflowParams } from "../workflows";

export type Bindings = {
  DATABASE_URL: string;
  TOKEN: string;
  EXTRACT_URL: string;
  AI: Ai;
  RAG_WORKFLOW: Workflow<RagWorflowParams>;
};
