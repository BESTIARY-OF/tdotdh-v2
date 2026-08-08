export function allocateWeightedTickets(families, pass) {
  const tickets = [];
  for (const family of families) {
    const weight = Math.max(0, Math.floor(Number(family.weight) || 0));
    for (let thread = 0; thread < weight; thread += 1) {
      tickets.push({ presetFingerprint: family.presetFingerprint, familyId: family.familyId, pass, threadId: thread });
    }
  }
  return tickets.sort((a, b) => a.familyId.localeCompare(b.familyId) || a.threadId - b.threadId);
}

export function ticketKey(ticket) {
  return [ticket.presetFingerprint, ticket.familyId, ticket.pass, ticket.threadId].join("/");
}
