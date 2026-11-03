const assert = require('node:assert/strict');
const { getMachineFingerprint, verifyLicenseKey, generateLicenseKey } = require('../source/src/native/license-validator');

(() => {
  const localMachine = getMachineFingerprint();
  assert.ok(/^[A-Z0-9]{8}$/.test(localMachine), 'Machine fingerprint must be 8 alphanumeric characters');

  // 1. Single PC lock: key for local machine must verify on local machine
  const key30 = generateLicenseKey(30, localMachine);
  const checkPass = verifyLicenseKey(key30, localMachine);
  assert.equal(checkPass.valid, true, 'Key generated for local machine must be valid');
  assert.equal(checkPass.days, 30);
  assert.equal(checkPass.machineId, localMachine);

  // 2. Single PC lock: key for local machine MUST FAIL on a different machine ID
  const checkFail = verifyLicenseKey(key30, 'DIFFPC99');
  assert.equal(checkFail.valid, false);
  assert.ok(checkFail.error.includes('locked to PC'), 'Must report single-PC lock mismatch');

  // 3. Tampered signature detection
  const tampered = key30.slice(0, -2) + (key30.slice(-2) === 'AA' ? 'BB' : 'AA');
  const checkTampered = verifyLicenseKey(tampered, localMachine);
  assert.equal(checkTampered.valid, false);
  assert.ok(checkTampered.error.includes('signature') || checkTampered.error.includes('tampered'));

  // 4. Lifetime duration
  const keyLife = generateLicenseKey(99999, localMachine);
  const checkLife = verifyLicenseKey(keyLife, localMachine);
  assert.equal(checkLife.valid, true);
  assert.equal(checkLife.days, 99999);

  // 5. Universal 'ALL' machine compatibility
  const keyAll = generateLicenseKey(100, 'ALL');
  assert.equal(verifyLicenseKey(keyAll, 'ANYPC001').valid, true);
  assert.equal(verifyLicenseKey(keyAll, 'ANYPC002').valid, true);

  // 6. Malformed keys
  assert.equal(verifyLicenseKey('AMARA-INVALID').valid, false);
  assert.equal(verifyLicenseKey('').valid, false);
  assert.equal(verifyLicenseKey(null).valid, false);

  console.log('PASS: VIP License single-PC locking, verification, signature tampering and duration checks passed.');
})();

