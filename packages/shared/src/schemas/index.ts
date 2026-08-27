import { z } from "zod";

export const verificationStatusSchema = z.enum(["PENDING", "VERIFIED", "REJECTED"]);

export const userRoleSchema = z.enum(["CANDIDATE", "EMPLOYER", "ADMIN"]);

export const driveStatusSchema = z.enum(["DRAFT", "PENDING", "LIVE", "EXPIRED", "CANCELLED"]);

export const applicationStateSchema = z.enum([
  "INTERESTED",
  "CONFIRMED",
  "CHECKED_IN",
  "INTERVIEWED",
  "HIRED",
  "NO_SHOW",
  "REJECTED",
]);
