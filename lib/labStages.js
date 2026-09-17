const LAB_STAGES = {
  zirconia: [
    'CAD-CAM Design',
    'Ceramics Dentin Process',
    'Finishing',
    'Final Glaze'
  ],
  dmls: [
    'CAD-CAM Design',
    'Metal Finishing',
    'Dentin Ceramics Process',
    'Final Glaze'
  ],
  pfm: [
    'Metal Framework Casting',
    'Porcelain Build-Up',
    'Contouring & Finishing',
    'Final Glaze'
  ],
  full_metal: [
    'Wax-Up & Casting',
    'Metal Finishing',
    'Polishing',
    'Final Check'
  ],
  all_ceramic: [
    'CAD-CAM Design',
    'Ceramic Pressing / Milling',
    'Staining & Characterization',
    'Final Glaze'
  ],
  metal_buccal_facing: [
    'Metal Framework Casting',
    'Buccal Ceramic Facing',
    'Contouring & Finishing',
    'Final Glaze'
  ],
  base_plate_bite_rim: [
    'Model Preparation',
    'Base Plate Fabrication',
    'Bite Rim Setup',
    'Final Trim'
  ],
  wax_trial: [
    'Model Preparation',
    'Wax Pattern Fabrication',
    'Trial Fit',
    'Adjustments & Handover'
  ],
  porcelain_laminate_veneer: [
    'Diagnostic Design',
    'Ceramic Layering',
    'Try-In',
    'Final Glaze'
  ],
  bruxzir: [
    'CAD-CAM Design',
    'Milling',
    'Staining',
    'Final Glaze'
  ],
  contact_point: [
    'Framework Fabrication',
    'Contact Point Adjustment',
    'Finishing',
    'Final Check'
  ],
  others: [
    'Design',
    'Fabrication',
    'Finishing',
    'Final Check'
  ]
};

function stagesFor(caseType) {
  return LAB_STAGES[String(caseType || '').toLowerCase()] || null;
}

module.exports = { LAB_STAGES, stagesFor };
