/** Production must keep the controller/owner of the producer, including allies. */
export function inheritEntityControl(world: any, producerId: number, entityId: number): number {
  const owner = world.get(producerId, 'networkOwner');
  const computer = world.get(producerId, 'computer');
  for (const id of [entityId, ...(world.get(entityId, 'squad')?.soldiers || []).filter((id: unknown) => id != null)]) {
    if (owner) world.add(id, 'networkOwner', { ...owner });
    if (computer) world.add(id, 'computer', { ...computer });
  }
  return entityId;
}
