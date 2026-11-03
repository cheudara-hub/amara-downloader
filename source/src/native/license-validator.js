// Cryptographic License Verification and Machine ID Binding for AMARA VIP PRO
const crypto = require('node:crypto');
const os = require('node:os');

const LICENSE_SECRET = 'CONFIGURE_PRIVATE_LICENSE_SECRET';

function getMachineFingerprint() {
  try {
    const raw = [os.hostname(), os.userInfo().username, os.platform(), os.arch()].join('-');
    return crypto.createHash('sha256').update(raw).digest('hex').toUpperCase().slice(0, 8);
  } catch {
    return 'VIPMACH1';
  }
}

function hmacSha256Hex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex').toUpperCase().slice(0, 8);
}

function verifyLicenseKey(keyString, currentMachineId = getMachineFingerprint()) {
  if (!keyString || typeof keyString !== 'string') {
    return { valid: false, error: 'License key cannot be empty.' };
  }

  const cleanKey = keyString.trim().toUpperCase();
  const parts = cleanKey.split('-');
  if (parts.length !== 5 || parts[0] !== 'AMARA') {
    return { valid: false, error: 'Invalid key format. Expected: AMARA-{days}D-{machineId}-{token}-{signature}' };
  }

  const daysMatch = parts[1].match(/^(\d+)D$/);
  if (!daysMatch) {
    return { valid: false, error: 'Invalid duration in license key.' };
  }

  const days = parseInt(daysMatch[1], 10);
  const keyMachine = parts[2];
  const token = parts[3];
  const signature = parts[4];

  const data = `${days}:${keyMachine}:${token}`;
  const expectedSig = hmacSha256Hex(LICENSE_SECRET, data);

  if (signature !== expectedSig) {
    return { valid: false, error: 'Invalid license key signature or tampered key.' };
  }

  const cleanUserMach = (currentMachineId || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (keyMachine !== 'ALL' && cleanUserMach && keyMachine !== cleanUserMach) {
    return {
      valid: false,
      error: `This key is locked to PC [${keyMachine}]. It cannot be used on this PC [${cleanUserMach}].`
    };
  }

  return {
    valid: true,
    cleanKey,
    days,
    machineId: keyMachine,
    token
  };
}

function generateLicenseKey(days, machineId = 'ALL', secret = LICENSE_SECRET) {
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  const cleanMach = (machineId || 'ALL').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ALL';
  const data = `${days}:${cleanMach}:${token}`;
  const checksum = hmacSha256Hex(secret, data);
  return `AMARA-${days}D-${cleanMach}-${token}-${checksum}`;
}

module.exports = {
  LICENSE_SECRET,
  getMachineFingerprint,
  verifyLicenseKey,
  generateLicenseKey
};

