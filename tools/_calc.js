function calcItemEntry(item, entryQty, entryUnit) {
  const rawQty = Math.max(0, Number(entryQty) || 0);
  const u = (entryUnit || item.main_unit || 'pcs').toLowerCase();
  const mainU = (item.main_unit || 'kg').toLowerCase();
  const altU = (item.alt_unit || '').toLowerCase();
  const altFactor = Number(item.alt_factor) || 0;
  const altU2 = (item.alt_unit2 || '').toLowerCase();
  const altU2Factor = Number(item.alt_unit2_factor) || 0;
  let lengthPerPc = Number(item.length_per_pc) || 0;
  let weightPerPc = Number(item.weight_per_pc) || 0;
  const rate = Number(item.rate) || 0;

  // Derive effective factors if not directly specified
  if (weightPerPc <= 0) {
    if (altU === 'pcs' && altFactor > 0) weightPerPc = altFactor;
    else if (altU2 === 'pcs' && altU2Factor > 0) weightPerPc = altU2Factor;
  }
  if (lengthPerPc <= 0) {
    if (altU === 'feet' && altFactor > 0 && altU2 === 'pcs' && altU2Factor > 0) {
      lengthPerPc = Math.round((altU2Factor / altFactor) * 100) / 100;
    } else if (altU2 === 'feet' && altU2Factor > 0 && altU === 'pcs' && altFactor > 0) {
      lengthPerPc = Math.round((altFactor / altU2Factor) * 100) / 100;
    }
  }

  let effectiveQty = rawQty;
  let effectiveUnit = u;
  let prefixPreview = '';

  if (u === 'inch' || u === 'in') {
    effectiveQty = Math.round((rawQty / 12.0) * 1000) / 1000;
    effectiveUnit = 'feet';
    prefixPreview = `${rawQty} in = ${effectiveQty} ft`;
  } else if (u === 'metre' || u === 'meter' || u === 'm') {
    if (mainU !== 'metre' && altU !== 'metre' && altU2 !== 'metre') {
      effectiveQty = Math.round((rawQty * 3.28084) * 1000) / 1000;
      effectiveUnit = 'feet';
      prefixPreview = `${rawQty} m = ${effectiveQty} ft`;
    }
  }

  // Derive main_qty (quantity in main_unit)
  let mainQty = 0;
  if (effectiveUnit === mainU) {
    mainQty = effectiveQty;
  } else if (altU && effectiveUnit === altU && altFactor > 0) {
    // alt_factor means "how many main units one alt unit is" for every unit
    // except kilograms. When the item is counted in pieces, a kilogram is a
    // measure of the material and alt_factor is the weight of one piece, so the
    // conversion goes the other way. Reading it as a multiplier turned 91 kg
    // into 2,757 pieces.
    if (altU === 'kg' && mainU !== 'kg') {
      mainQty = effectiveQty / altFactor;
    } else {
      mainQty = effectiveQty * altFactor;
    }
  } else if (altU2 && effectiveUnit === altU2 && altU2Factor > 0) {
    mainQty = effectiveQty * altU2Factor;
  } else if (effectiveUnit === 'pcs') {
    if (altU === 'pcs' && altFactor > 0) {
      mainQty = effectiveQty * altFactor;
    } else if (altU2 === 'pcs' && altU2Factor > 0) {
      mainQty = effectiveQty * altU2Factor;
    } else if (weightPerPc > 0 && mainU === 'kg') {
      mainQty = effectiveQty * weightPerPc;
    } else if (lengthPerPc > 0 && altU === 'feet' && altFactor > 0) {
      mainQty = effectiveQty * lengthPerPc * altFactor;
    } else {
      mainQty = effectiveQty;
    }
  } else if (effectiveUnit === 'feet') {
    if (altU === 'feet' && altFactor > 0) {
      mainQty = effectiveQty * altFactor;
    } else if (altU2 === 'feet' && altU2Factor > 0) {
      mainQty = effectiveQty * altU2Factor;
    } else if (lengthPerPc > 0) {
      const derivedPcs = effectiveQty / lengthPerPc;
      if (altU2 === 'pcs' && altU2Factor > 0) mainQty = derivedPcs * altU2Factor;
      else if (altU === 'pcs' && altFactor > 0) mainQty = derivedPcs * altFactor;
      else if (weightPerPc > 0 && mainU === 'kg') mainQty = derivedPcs * weightPerPc;
      else mainQty = derivedPcs;
    } else {
      mainQty = effectiveQty;
    }
  } else if (effectiveUnit === 'kg') {
    if (mainU === 'kg') {
      mainQty = effectiveQty;
    } else if (altU === 'kg' && altFactor > 0) {
      mainQty = effectiveQty / altFactor;
    } else if (altU2 === 'kg' && altU2Factor > 0) {
      mainQty = effectiveQty / altU2Factor;
    } else if (mainU === 'pcs' && weightPerPc > 0) {
      mainQty = effectiveQty / weightPerPc;
    } else {
      mainQty = effectiveQty;
    }
  } else {
    mainQty = effectiveQty;
  }

  // Derive weight in kg. This is needed before the amount because every item
  // in this business is priced in rupees per kilogram, whatever unit it is
  // counted in. A 30 kg sheet at 177 is 177 per kg, not 177 per sheet.
  let weight = 0;
  if (mainU === 'kg') {
    weight = mainQty;
  } else if (altU === 'kg' && altFactor > 0) {
    weight = mainQty * altFactor;
  } else if (altU2 === 'kg' && altU2Factor > 0) {
    weight = mainQty * altU2Factor;
  } else if (effectiveUnit === 'kg') {
    weight = effectiveQty;
  } else if (weightPerPc > 0) {
    weight = mainQty * weightPerPc;
  }

  // Derive pcs
  let pcs = 0;
  if (effectiveUnit === 'pcs') {
    pcs = effectiveQty;
  } else if (mainU === 'pcs') {
    pcs = mainQty;
  } else if (altU2 === 'pcs' && altU2Factor > 0) {
    pcs = mainQty / altU2Factor;
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

  // Derive feet
  let feet = 0;
  if (effectiveUnit === 'feet') {
    feet = effectiveQty;
  } else if (altU === 'feet' && altFactor > 0) {
    feet = mainQty / altFactor;
  } else if (altU2 === 'feet' && altU2Factor > 0) {
    feet = mainQty / altU2Factor;
  } else if (lengthPerPc > 0 && pcs > 0) {
    feet = pcs * lengthPerPc;
  }

  // Amount follows the weight. If an item somehow has no weight information at
  // all, fall back to the old unit-times-rate maths so the line is not zero.
  const amount = weight > 0 ? weight * rate : mainQty * rate;

  // Format preview string
  const parts = [];
  if (prefixPreview) parts.push(prefixPreview);
  if (effectiveUnit === 'pcs') {
    if (weight > 0) parts.push(`${Math.round(weight * 10) / 10} kg`);
    if (feet > 0) parts.push(`${Math.round(feet * 10) / 10} ft`);
  } else if (effectiveUnit === 'feet') {
    if (weight > 0) parts.push(`${Math.round(weight * 10) / 10} kg`);
    if (pcs > 0) parts.push(`${Math.round(pcs * 100) / 100} pcs`);
  } else if (effectiveUnit === 'kg') {
    if (pcs > 0 && (altU === 'pcs' || altU2 === 'pcs' || weightPerPc > 0)) parts.push(`${Math.round(pcs * 100) / 100} pcs`);
    if (feet > 0 && (altU === 'feet' || altU2 === 'feet')) parts.push(`${Math.round(feet * 10) / 10} ft`);
  } else {
    if (weight > 0) parts.push(`${Math.round(weight * 10) / 10} kg`);
    if (pcs > 0) parts.push(`${Math.round(pcs * 100) / 100} pcs`);
  }
  const preview = parts.join(' = ');

  const finalPcs = Math.max(1, Math.round(pcs || 1));
  return {
    rawQty,
    entryUnit: u,
    effectiveQty,
    effectiveUnit,
    mainQty,
    pcs: finalPcs,
    weight,
    amount,
    feet,
    preview,
  };
}

module.exports={calcItemEntry};
