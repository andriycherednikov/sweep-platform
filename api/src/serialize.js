export function serializeTeam(t) {
  return { code: t.code, name: t.name, group: t.group, pool: t.pool, color: t.color, strength: t.strength }
}
export function serializePerson(p) {
  return { id: p.id, name: p.name, short: p.short, initials: p.initials, av: p.avColor, avatarPath: p.avatarPath }
}
