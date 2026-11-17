/* Roles say what a place on a map is for. That way the game can ask a room for "the fire" instead
 * of an anchor called "hearth". */

/* This file doesn't import anything on purpose, so the map reader can use it without an import
 * loop. */

export type Role = 'principal' | 'plan' | 'advisory' | 'counselor' | 'wall' | 'outfitter' | 'exit'

export const ROLES: Role[] = ['principal', 'plan', 'advisory', 'counselor', 'wall', 'outfitter', 'exit']

export const isRole = (v: unknown): v is Role =>
  typeof v === 'string' && (ROLES as readonly string[]).includes(v)

/* The anchor name used for each role when the room doesn't declare one. */
export const ROLE_BY_CONVENTION: Record<Role, string> = {
  principal: 'principal_desk',
  plan: 'chart_table',
  advisory: 'hearth',
  counselor: 'counselor',
  wall: 'trophy_wall',
  outfitter: 'outfitter',
  exit: 'maw_entrance',
}

const BY_NAME = new Map<string, Role>(ROLES.map((r) => [ROLE_BY_CONVENTION[r], r]))

/* The role this anchor name has by the standard naming, or null. */
export const roleByConvention = (name: string): Role | null => BY_NAME.get(name) ?? null

/* The role an anchor declares in its meta bag, or null. */
export function declaredRole(meta: Record<string, unknown> | undefined, name: string, mapId?: string): Role | null {
  const raw = meta?.role
  if (raw === undefined || raw === null) return null
  /* The meta editor saves every value as text, so anything that isn't a string is a mistake by
   * whoever made the map. */
  if (typeof raw !== 'string') {
    console.warn(`[roles] ${mapId ?? 'map'}: "${name}" declares a role that is not a word, so it claims nothing`)
    return null
  }
  const word = raw.trim().toLowerCase()
  if (!word) return null
  if (!isRole(word)) {
    console.warn(`[roles] ${mapId ?? 'map'}: "${name}" declares the role "${raw}", which is not one of ${ROLES.join(', ')}`)
    return null
  }
  return word
}

export type RoleAnchor = { name: string; meta?: Record<string, unknown> }

/* Which anchor fills each role on this map. Declared roles win, then the standard anchor names fill
 * in the rest. */
export function rolesOf<A extends RoleAnchor>(anchors: readonly A[], mapId?: string): Map<Role, A> {
  const out = new Map<Role, A>()
  const claimed = new Set<string>()
  for (const a of anchors) {
    const role = declaredRole(a.meta, a.name, mapId)
    if (!role) continue
    const had = out.get(role)
    if (had) {
      console.warn(`[roles] ${mapId ?? 'map'}: "${had.name}" and "${a.name}" both claim the role "${role}", so the first one keeps it`)
      continue
    }
    out.set(role, a)
    claimed.add(a.name)
  }
  for (const a of anchors) {
    if (claimed.has(a.name)) continue
    const role = roleByConvention(a.name)
    if (!role || out.has(role)) continue
    out.set(role, a)
    claimed.add(a.name)
  }
  return out
}
