import { z } from "zod";
import { leadStageNames } from "../../dolibarr/projects/projectRules.js";
import { isIsoDateString } from "../shared/normalization.js";

export const projectInputSchema = z.string().min(1)
  .describe("Project ref (e.g. PJ2511-0004), Dolibarr ID, or (part of) the project title");

export const leadStageSchema = z.enum(leadStageNames)
  .describe("Lead stage: prospection, qualification, proposal, negotiation, pending, won or lost");

export const isoDateSchema = z.string().refine(isIsoDateString, "Expected a valid YYYY-MM-DD date");

export const hoursSchema = z.number().positive().max(100_000);

export const percentSchema = z.number().min(0).max(100);
