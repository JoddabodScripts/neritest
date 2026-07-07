/**
 * Permission bitfield mirrored 1:1 from nerimity.js (`src/bitwise.ts`).
 *
 * NeriTest evaluates permissions with the exact same math the SDK's
 * `ServerMember.hasPermission()` uses, so a `403` in the sandbox lines up with
 * a `403` on a real server.
 */

export const RolePermissions = {
  ADMIN: 1,
  SEND_MESSAGE: 2,
  MANAGE_ROLES: 4,
  MANAGE_CHANNELS: 8,
  KICK: 16,
  BAN: 32,
  MENTION_EVERYONE: 64,
  NICKNAME_MEMBER: 128,
  MENTION_ROLES: 256,
} as const;

export type PermissionName = keyof typeof RolePermissions;
export type PermissionBit = (typeof RolePermissions)[PermissionName];

export const hasBit = (permissions: number, bit: number): boolean =>
  (permissions & bit) === bit;

export const addBit = (permissions: number, bit: number): number =>
  permissions | bit;

export const removeBit = (permissions: number, bit: number): number =>
  permissions & ~bit;

/** Combine any mix of permission names / raw bits into a single bitfield. */
export const permissions = (...bits: Array<PermissionName | number>): number =>
  bits.reduce<number>(
    (acc, b) => addBit(acc, typeof b === "number" ? b : RolePermissions[b]),
    0,
  );
