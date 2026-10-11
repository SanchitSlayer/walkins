import { z } from "zod";

export const companyRoleSchema = z.enum(["OWNER", "RECRUITER", "VIEWER"]);

export type CompanyRole = z.infer<typeof companyRoleSchema>;

// What each role at a company may do. The API checks it on every employer
// request (requireCompanyAccess) and the web hides what a role can't do
// using the same table, so the two can't disagree. Recruiters may run any
// of the company's drives, not only their own: on a walk-in day whoever is
// at the desk works it.
export const COMPANY_PERMISSIONS = {
  read: ["OWNER", "RECRUITER", "VIEWER"],
  runDrives: ["OWNER", "RECRUITER"],
  manageBilling: ["OWNER"],
  manageCompany: ["OWNER"],
  managePeople: ["OWNER"],
} as const satisfies Record<string, readonly CompanyRole[]>;

export type CompanyPermission = keyof typeof COMPANY_PERMISSIONS;

export function companyCan(role: CompanyRole, permission: CompanyPermission): boolean {
  return (COMPANY_PERMISSIONS[permission] as readonly CompanyRole[]).includes(role);
}

export const INVITATION_DAYS = 7;

// A person named on a record: who owns a drive, who shortlisted someone.
// current is false once they have left the company, so the record keeps
// their name and says so.
export const personRefSchema = z.object({
  userId: z.string(),
  name: z.string(),
  current: z.boolean(),
});

export const membershipSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: companyRoleSchema,
  company: z.object({ id: z.string(), name: z.string() }),
});

export const memberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  phone: z.string(),
  role: companyRoleSchema,
  // Drives still to run (draft, in review or live) that this person owns,
  // which removing them hands to someone else.
  openDrives: z.number().int(),
});

export const companyInvitationSchema = z.object({
  id: z.string(),
  phone: z.string(),
  name: z.string(),
  role: companyRoleSchema,
  invitedBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

export const peopleSchema = z.object({
  members: z.array(memberSchema),
  invitations: z.array(companyInvitationSchema),
});

// Ten digits, the way people sign in: an invitation is matched to the
// account by exact phone, so "+91 98..." would never match anyone.
export const inviteSchema = z.object({
  phone: z.string().trim().regex(/^\d{10}$/, "errors.validation.invitePhone"),
  name: z.string().trim().min(1).max(80),
  role: companyRoleSchema,
});

// Who takes over the drives a departing person owns. Defaults to whoever is
// removing them, or to an owner when someone leaves by themselves.
export const removeMemberSchema = z.object({ successorId: z.string().min(1).optional() });

export const changeRoleSchema = z.object({ role: companyRoleSchema, successorId: z.string().min(1).optional() });

// What happened to a person's open drives when they left or became a
// viewer, neither of whom can run a drive.
export const handoverSchema = z.object({
  drivesReassigned: z.number().int(),
  successor: personRefSchema.nullable(),
});

export const reassignDriveSchema = z.object({ ownerId: z.string().min(1) });

// What the invitee sees before joining: enough to recognise the company, or
// to notice the invitation was meant for whoever had this number before.
export const myInvitationSchema = z.object({
  id: z.string(),
  companyName: z.string(),
  cityName: z.string(),
  role: companyRoleSchema,
  invitedBy: z.string(),
  expiresAt: z.string(),
});

// A booked interview still ahead. Joining a company makes the account an
// employer's, which would quietly cost the seat, so joining waits until
// these are attended or released.
export const upcomingBookingSchema = z.object({
  roleTitle: z.string(),
  companyName: z.string(),
  startsAt: z.string(),
});

export const myInvitationsSchema = z.object({
  invitations: z.array(myInvitationSchema),
  bookings: z.array(upcomingBookingSchema),
});

export type CompanyInvitation = z.infer<typeof companyInvitationSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type MyInvitation = z.infer<typeof myInvitationSchema>;
export type MyInvitations = z.infer<typeof myInvitationsSchema>;
export type UpcomingBooking = z.infer<typeof upcomingBookingSchema>;
export type People = z.infer<typeof peopleSchema>;
export type PersonRef = z.infer<typeof personRefSchema>;
export type Handover = z.infer<typeof handoverSchema>;
export type Invite = z.infer<typeof inviteSchema>;
