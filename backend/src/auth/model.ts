export const ROLES = ['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'PATIENT'] as const;
export type Role = (typeof ROLES)[number];

export interface UserRecord {
  id: number;
  email: string;
  passwordHash: string;
  role: Role;
  fullName: string;
  /** ontology local name of the linked Patient or Doctor individual */
  linkedId: string | null;
  locale: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** What the API exposes about an account (never the hash). */
export interface PublicUser {
  id: number;
  email: string;
  role: Role;
  fullName: string;
  linkedId: string | null;
  locale: string;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export const toPublicUser = (user: UserRecord): PublicUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  fullName: user.fullName,
  linkedId: user.linkedId,
  locale: user.locale,
  active: user.active,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
});

export interface AccessPayload {
  sub: number;
  email: string;
  role: Role;
  linkedId: string | null;
}
