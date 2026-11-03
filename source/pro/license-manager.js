/**
 * AMARA VIP PRO - License & Single-PC Manager
 * - Cryptographically verifies HMAC-SHA256 signature
 * - Binds activation key strictly to 1 PC (Machine ID)
 * - Provides Sign Out function so user can release/deactivate and change PC
 * - Displays live ticking countdown on header pill
 */
(() => {
  const SECRET = "CONFIGURE_PRIVATE_LICENSE_SECRET";
  const STORAGE_KEY = "amara_vip_license";

  let currentLicense = null;
  let currentMachineId = "VIPMACH1";
  let countdownTimerId = null;

  // Web Crypto HMAC-SHA256
  async function hmacSha256Hex(secret, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
      .slice(0, 8);
  }

  function extractKeyString(rawInput) {
    if (!rawInput || typeof rawInput !== "string") return "";
    const match = rawInput.trim().match(/AMARA-\d+D-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+/i);
    return match ? match[0].toUpperCase() : rawInput.trim().toUpperCase();
  }

  // Verify License Key cryptographic signature & Machine ID binding
  async function verifyLicenseKey(rawKeyString, userMachine) {
    const cleanKey = extractKeyString(rawKeyString);
    if (!cleanKey) {
      return { valid: false, error: "Please enter a License Key." };
    }
    const parts = cleanKey.split("-");
    if (parts.length !== 5 || parts[0] !== "AMARA") {
      return { valid: false, error: "Invalid Key Format. Expected AMARA-{days}D-{machine}-{token}-{signature}" };
    }

    const daysMatch = parts[1].match(/^(\d+)D$/);
    if (!daysMatch) {
      return { valid: false, error: "Invalid duration format in key." };
    }
    const days = parseInt(daysMatch[1], 10);
    const keyMachine = parts[2];
    const token = parts[3];
    const signature = parts[4];

    const data = `${days}:${keyMachine}:${token}`;
    const expectedSig = await hmacSha256Hex(SECRET, data);

    if (signature !== expectedSig) {
      return { valid: false, error: "Invalid License Key or signature check failed." };
    }

    const cleanUserMach = (userMachine || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (keyMachine !== "ALL" && cleanUserMach && keyMachine !== cleanUserMach) {
      return { valid: false, error: `This key is locked to PC [${keyMachine}]. It cannot be used on this PC [${cleanUserMach}].` };
    }

    return { valid: true, cleanKey, days, machine: keyMachine, token };
  }

  function isLicenseActive() {
    return !!(currentLicense && currentLicense.expiryTimestamp && Date.now() < currentLicense.expiryTimestamp);
  }

  async function loadStoredLicense() {
    try {
      if (window.amaraDesktop?.call) {
        const fromDisk = await window.amaraDesktop.call('load-license');
        if (fromDisk && fromDisk.expiryTimestamp) return fromDisk;
      }
    } catch (_) {}

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}

    return null;
  }

  async function saveStoredLicense(licenseData) {
    currentLicense = licenseData;
    try {
      if (licenseData) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(licenseData));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (_) {}

    try {
      if (window.amaraDesktop?.call) {
        if (licenseData) {
          await window.amaraDesktop.call('save-license', licenseData);
        } else {
          await window.amaraDesktop.call('sign-out-license');
        }
      }
    } catch (_) {}
  }

  function formatCountdown(remainingMs) {
    if (remainingMs <= 0) return "⚠️ Expired";
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days >= 36500) return "👑 Lifetime VIP";
    if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  function formatDateTime(timestamp) {
    if (!timestamp) return "N/A";
    const d = new Date(timestamp);
    return d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function updateHeaderDisplay() {
    const pill = document.getElementById("vipLicensePill");
    const countEl = document.getElementById("vipCountdownDisplay");
    const textEl = document.getElementById("vipStatusText");
    if (!pill || !countEl || !textEl) return;

    if (isLicenseActive()) {
      pill.classList.remove("unactivated");
      textEl.textContent = "VIP PRO";
      const remaining = currentLicense.expiryTimestamp - Date.now();
      countEl.textContent = formatCountdown(remaining);
    } else {
      pill.classList.add("unactivated");
      textEl.textContent = "ACTIVATE VIP";
      countEl.textContent = currentLicense ? "Expired" : "No License";
    }
  }

  function startCountdownTimer() {
    if (countdownTimerId) clearInterval(countdownTimerId);
    countdownTimerId = setInterval(() => {
      updateHeaderDisplay();
      const modalCount = document.getElementById("modalVipCountdown");
      if (modalCount && isLicenseActive()) {
        modalCount.textContent = formatCountdown(currentLicense.expiryTimestamp - Date.now());
      }
      if (currentLicense && Date.now() >= currentLicense.expiryTimestamp) {
        updateHeaderDisplay();
        renderModalBody();
      }
    }, 1000);
  }

  function setupHeaderPill() {
    const headerRight = document.querySelector(".header-right");
    if (!headerRight) return;

    let pill = document.getElementById("vipLicensePill");
    if (!pill) {
      pill = document.createElement("button");
      pill.id = "vipLicensePill";
      pill.className = "vip-license-pill unactivated";
      pill.type = "button";
      pill.title = "👑 AMARA VIP License · Click to view status or sign out";
      pill.innerHTML = `
        <span class="vip-crown">👑</span>
        <span class="vip-tag" id="vipStatusText">ACTIVATE VIP</span>
        <span class="vip-countdown" id="vipCountdownDisplay">Checking...</span>
      `;
      headerRight.prepend(pill);
      pill.onclick = () => openModal();
    }
    updateHeaderDisplay();
  }

  function renderModalBody() {
    const container = document.getElementById("vipModalDynamicBody");
    if (!container) return;

    if (isLicenseActive()) {
      const remaining = currentLicense.expiryTimestamp - Date.now();
      container.innerHTML = `
        <div class="vip-status-grid">
          <div class="vip-status-card">
            <div class="vip-status-label">Status</div>
            <div class="vip-status-value" style="color: #4ade80;">Active VIP Member</div>
          </div>
          <div class="vip-status-card">
            <div class="vip-status-label">Bound PC ID</div>
            <div class="vip-status-value" style="color: #5efce3; font-family: monospace;">${currentMachineId}</div>
          </div>
          <div class="vip-status-card full-width">
            <div class="vip-status-label">Time Remaining</div>
            <div class="vip-status-value gold" id="modalVipCountdown">${formatCountdown(remaining)}</div>
          </div>
          <div class="vip-status-card full-width">
            <div class="vip-status-label">Expires On</div>
            <div class="vip-status-value">${formatDateTime(currentLicense.expiryTimestamp)}</div>
          </div>
          <div class="vip-status-card full-width">
            <div class="vip-status-label">License Key</div>
            <div class="vip-status-value" style="font-size: 11px; font-family: monospace; word-break: break-all; color: #a0aec0;">
              ${escapeHtml(currentLicense.key || "")}
            </div>
          </div>
        </div>
        <button type="button" class="vip-btn-signout" id="btnVipSignOut">
          <i class="fa-solid fa-arrow-right-from-bracket"></i> Sign Out License / Change PC
        </button>
      `;

      const btnSignOut = document.getElementById("btnVipSignOut");
      if (btnSignOut) {
        btnSignOut.onclick = async () => {
          if (confirm("Are you sure you want to sign out this PC?\n\nThe license will be removed from this machine so you can activate on another PC.")) {
            await signOut();
          }
        };
      }
    } else {
      container.innerHTML = `
        <div class="vip-machine-box">
          <div class="vip-field-label">
            <span>YOUR MACHINE ID (1-PC LOCK)</span>
            <span style="color: #5efce3;"><i class="fa-solid fa-laptop"></i> Hardware ID</span>
          </div>
          <div class="vip-machine-row">
            <span class="vip-machine-val" id="modalMachineId">${currentMachineId}</span>
            <button type="button" class="vip-btn-copy" id="btnCopyMachineId">
              <i class="fa-regular fa-copy"></i> Copy ID
            </button>
          </div>
          <p class="vip-hint">Copy your Machine ID and send it to your administrator to get your VIP activation key.</p>
        </div>

        <div class="vip-input-wrap">
          <input type="text" id="vipKeyInput" class="vip-key-input" placeholder="AMARA-100D-XXXXXXXX-XXXXXXXX-XXXXXXXX" spellcheck="false" autocomplete="off" />
          <button type="button" class="vip-btn-paste" id="btnPasteKey">
            <i class="fa-regular fa-paste"></i> Paste
          </button>
        </div>

        <button type="button" class="vip-btn-activate" id="btnActivateKey">
          <i class="fa-solid fa-crown"></i> Activate VIP Key
        </button>

        <div class="vip-feedback" id="vipFeedback"></div>
      `;

      const btnCopy = document.getElementById("btnCopyMachineId");
      if (btnCopy) {
        btnCopy.onclick = () => {
          copyText(currentMachineId);
          btnCopy.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
          btnCopy.style.color = "#4ade80";
          setTimeout(() => {
            btnCopy.innerHTML = '<i class="fa-regular fa-copy"></i> Copy ID';
            btnCopy.style.color = "";
          }, 2000);
        };
      }

      const btnPaste = document.getElementById("btnPasteKey");
      if (btnPaste) {
        btnPaste.onclick = async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (text) document.getElementById("vipKeyInput").value = text.trim();
          } catch (_) {}
        };
      }

      const btnAct = document.getElementById("btnActivateKey");
      if (btnAct) {
        btnAct.onclick = async () => {
          const input = document.getElementById("vipKeyInput");
          await handleActivation(input ? input.value : "");
        };
      }
    }
  }

  function setupModal() {
    let overlay = document.getElementById("modalVipOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "modalVipOverlay";
      overlay.className = "vip-modal-overlay hidden";
      overlay.innerHTML = `
        <div class="vip-modal-card" id="vipModalCard">
          <div class="vip-modal-header">
            <div class="vip-modal-title-group">
              <div class="vip-modal-icon-badge">👑</div>
              <div>
                <h2 class="vip-modal-title" id="vipModalTitle">AMARA VIP PRO</h2>
                <p class="vip-modal-subtitle" id="vipModalSubtitle">Single-PC VIP License Management</p>
              </div>
            </div>
            <button type="button" class="vip-modal-close" id="btnCloseVipModal" title="Close">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div id="vipModalDynamicBody"></div>
        </div>
      `;
      document.body.appendChild(overlay);

      const btnClose = document.getElementById("btnCloseVipModal");
      if (btnClose) btnClose.onclick = () => closeModal();

      overlay.onclick = (e) => {
        if (e.target === overlay && isLicenseActive()) {
          closeModal();
        }
      };
    }
  }

  function openModal(forcePrompt = false) {
    const overlay = document.getElementById("modalVipOverlay");
    if (!overlay) return;
    renderModalBody();
    overlay.classList.remove("hidden");
    const closeBtn = document.getElementById("btnCloseVipModal");
    if (closeBtn) {
      closeBtn.style.display = isLicenseActive() ? "flex" : (forcePrompt ? "none" : "flex");
    }
  }

  function closeModal() {
    const overlay = document.getElementById("modalVipOverlay");
    if (overlay) overlay.classList.add("hidden");
  }

  function copyText(text) {
    if (window.amaraDesktop?.call) {
      window.amaraDesktop.call('clipboard-write', text).catch(() => {});
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  function showFeedback(msg, isSuccess = false) {
    const fb = document.getElementById("vipFeedback");
    if (!fb) return;
    fb.className = `vip-feedback ${isSuccess ? 'success' : 'error'}`;
    fb.innerHTML = (isSuccess ? '<i class="fa-solid fa-circle-check"></i> ' : '<i class="fa-solid fa-triangle-exclamation"></i> ') + escapeHtml(msg);
    fb.style.display = "block";
  }

  function shakeModal() {
    const card = document.getElementById("vipModalCard");
    if (!card) return;
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
    setTimeout(() => card.classList.remove("shake"), 450);
  }

  async function handleActivation(rawKey) {
    const keyVal = extractKeyString(rawKey);
    const btn = document.getElementById("btnActivateKey");
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';
      btn.disabled = true;
    }

    try {
      const res = await verifyLicenseKey(keyVal, currentMachineId);
      if (!res.valid) {
        showFeedback(res.error, false);
        shakeModal();
        return;
      }

      const now = Date.now();
      const durationMs = res.days >= 36500 ? (100 * 365 * 86400 * 1000) : (res.days * 86400 * 1000);
      const newLicense = {
        key: res.cleanKey,
        days: res.days,
        activatedAt: now,
        expiryTimestamp: now + durationMs,
        machineId: currentMachineId,
        token: res.token
      };

      await saveStoredLicense(newLicense);
      updateHeaderDisplay();
      renderModalBody();
      showFeedback(`Successfully activated VIP for ${res.days >= 36500 ? 'Lifetime' : res.days + ' days'}!`, true);
      setTimeout(() => closeModal(), 1200);
    } finally {
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-crown"></i> Activate VIP Key';
        btn.disabled = false;
      }
    }
  }

  async function signOut() {
    await saveStoredLicense(null);
    currentLicense = null;
    updateHeaderDisplay();
    renderModalBody();
    if (typeof showToast === 'function') {
      showToast('License signed out. This PC is deactivated.', 'fa-arrow-right-from-bracket');
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  async function init() {
    try {
      if (window.amaraDesktop?.call) {
        const mid = await window.amaraDesktop.call('get-machine-id');
        if (mid) currentMachineId = mid;
      }
    } catch (_) {}

    const stored = await loadStoredLicense();
    if (stored && stored.key) {
      const check = await verifyLicenseKey(stored.key, currentMachineId);
      if (check.valid && stored.expiryTimestamp && Date.now() < stored.expiryTimestamp) {
        currentLicense = stored;
      } else {
        await saveStoredLicense(null);
      }
    }

    setupHeaderPill();
    setupModal();
    startCountdownTimer();

    // If no active license on startup, open activation modal
    if (!isLicenseActive()) {
      setTimeout(() => openModal(false), 500);
    }
  }

  window.licenseManager = {
    init,
    isLicenseActive,
    requireActive: () => {
      if (!isLicenseActive()) {
        openModal(true);
        shakeModal();
        return false;
      }
      return true;
    },
    openModal,
    closeModal,
    signOut,
    getMachineId: () => currentMachineId
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

