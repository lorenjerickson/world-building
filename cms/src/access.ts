import type { Access, FieldHook } from 'payload'

type UserWithWorkspace = {
  role?: 'admin' | 'author'
  workspace?: number | string | { id: number | string }
}

export function relationshipID(value: UserWithWorkspace['workspace']): number | string | undefined {
  if (typeof value === 'number' || typeof value === 'string') return value
  return value?.id
}

export const workspaceReadAccess: Access = ({ req: { user } }) => {
  if (!user) return false
  const actor = user as UserWithWorkspace
  if (actor.role === 'admin') return true
  const workspace = relationshipID(actor.workspace)
  return workspace ? { workspace: { equals: workspace } } : false
}

export const authenticated: Access = ({ req: { user } }) => Boolean(user)

export const setActorWorkspace: FieldHook = ({ operation, req, value }) => {
  if (operation === 'create' && req.user) {
    const actor = req.user as UserWithWorkspace
    if (actor.role !== 'admin') return relationshipID(actor.workspace)
  }
  return value
}
