// Rate is rupees per kilogram on every item in this business, whatever the
  // item is counted in. So the amount always follows the weight, never the
  // piece count. A 30 kg SS sheet rate of 177 is rupees per kg, not per sheet.
  const amount = weight * rate;

  // Derive pcs
  let pcs = 0;
  if (effectiveUnit === 'pcs') {
    pcs = effectiveQty;
  } else if (mainU === 'pcs') {
    pcs = mainQty;
  } else if (altU2 === 'pcs' && altUnit2Factor > 0) {
    pcs = mainQty / altUnit2Factor;
  } else if (altU === 'pcs' && altFactor > 0) {
    pcs = mainQty / altFactor;
  } else if (lengthPerPc > 0 && effectiveUnit === 'feet') {
    pcs = effectiveQty / lengthPerPc;
  } else if (weightPerPc > 0 && mainU === 'kg') {
    pcs = mainQty / weightPerPc;
  } else if (weightPerPc > 0 && effectiveUnit === 'kg') {
    pcs = effectiveQty / weightPerPc;
  } else {
    pcs = Math.max(1, effectiveQty);
  }

  // Derive weight in kg
  let weight2 = 0;