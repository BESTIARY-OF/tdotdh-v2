export function allocateWeightedTickets(families, pass) {
  const normalized = [];
  for (const family of families) {
    const weight = Math.max(0, Math.floor(Number(family.weight) || 0));
    if (weight > 0) normalized.push({ family, weight });
  }
  normalized.sort((a, b) => String(a.family.familyId).localeCompare(String(b.family.familyId)));
  const tickets = [];
  const maxWeight = Math.max(0, ...normalized.map(entry => entry.weight));
  for (let thread = 0; thread < maxWeight; thread += 1) {
    for (const { family, weight } of normalized) {
      if (thread < weight) tickets.push({ presetFingerprint: family.presetFingerprint, familyId: family.familyId, pass, threadId: thread });
    }
  }
  return tickets;
}

export function ticketKey(ticket) {
  return [ticket.presetFingerprint, ticket.familyId, ticket.pass, ticket.threadId].join("/");
}
