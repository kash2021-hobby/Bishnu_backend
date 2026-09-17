const CASE_TYPES = [
  { id: 'zirconia', label: 'Zirconia' },
  { id: 'dmls', label: 'DMLS' }
];

const CASE_TYPE_IDS = new Set(CASE_TYPES.map((c) => c.id));

const CASE_TYPE_ALIASES = {
  zirconia: ['zirconia'],
  dmls: ['dmls', 'direct metal laser'],
  pfm: ['pfm', 'porcelain fused to metal'],
  full_metal: ['full metal'],
  all_ceramic: ['all ceramic'],
  metal_buccal_facing: ['buccal ceramic facing', 'metal with buccal'],
  base_plate_bite_rim: ['base plate', 'bite rim'],
  wax_trial: ['wax trial'],
  porcelain_laminate_veneer: ['porcelain laminate', 'laminate veneer'],
  bruxzir: ['bruxzir'],
  contact_point: ['contact point'],
  others: ['others', 'other']
};

// Resolve a case_type id from an explicit type (trusted if already a known id)
// and/or free-text work type labels (paper-form wording, legacy records).
function resolveCaseType(explicitType, workTypes) {
  const explicit = String(explicitType || '').toLowerCase().trim();
  if (explicit && CASE_TYPE_IDS.has(explicit)) return explicit;

  const list = Array.isArray(workTypes) ? workTypes : [];
  const hay = `${explicit} ${list.join(' ')}`.toLowerCase();
  if (!hay.trim()) return null;

  for (const type of CASE_TYPES) {
    const aliases = CASE_TYPE_ALIASES[type.id] || [type.label.toLowerCase()];
    if (aliases.some((a) => hay.includes(a))) return type.id;
  }
  return null;
}

module.exports = { CASE_TYPES, CASE_TYPE_IDS, resolveCaseType };
