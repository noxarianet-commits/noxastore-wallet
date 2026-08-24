const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

let baileys = null;
let sock = null;
let isConnected = false;
let qrCodeString = null;
let qrDataUrl = null;
let connectionStatus = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED

const SESSION_DIR = process.env.WA_BOT_SESSION_PATH || path.join(__dirname, 'wa_session');

if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Memory store for OTPs: key = formatted phone, value = { otp, expiresAt, registrationData, attempts }
const otpStore = new Map();

/**
 * Format phone number to WhatsApp JID format (e.g. 08123456789 -> 628123456789@s.whatsapp.net)
 */
function formatPhoneToJid(phone) {
  if (!phone) return null;
  let clean = String(phone).replace(/[^0-9]/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.slice(1);
  } else if (!clean.startsWith('62')) {
    clean = '62' + clean;
  }
  return `${clean}@s.whatsapp.net`;
}

/**
 * Format phone to standard 08xxx format for display
 */
function formatPhoneStandard(phone) {
  if (!phone) return '';
  let clean = String(phone).replace(/[^0-9]/g, '');
  if (clean.startsWith('62')) {
    clean = '0' + clean.slice(2);
  }
  return clean;
}

/**
 * Initialize WhatsApp Bot Connection
 */
async function initWaBot() {
  try {
    if (!baileys) {
      baileys = await import('@whiskeysockets/baileys');
    }

    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    connectionStatus = 'CONNECTING';

    sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      auth: state,
      browser: ['NoxariaNet Wallet OTP', 'Chrome', '1.0.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeString = qr;
        connectionStatus = 'WAITING_QR_SCAN';
        try {
          qrDataUrl = await QRCode.toDataURL(qr);
        } catch (e) {
          qrDataUrl = null;
        }

        console.log('\n==================================================');
        console.log('📱 WHATSAPP BOT QR CODE READY FOR SCANNING!');
        console.log('Buka browser & buka URL /wa-qr atau scan QR dibawah ini:');
        try {
          const terminalQr = await QRCode.toString(qr, { type: 'terminal', small: true });
          console.log(terminalQr);
        } catch (err) {}
        console.log('==================================================\n');
      }

      if (connection === 'close') {
        isConnected = false;
        qrCodeString = null;
        qrDataUrl = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WA-Bot] Connection closed due to: ${lastDisconnect?.error}. Reconnecting: ${shouldReconnect}`);
        connectionStatus = 'DISCONNECTED';

        if (shouldReconnect) {
          setTimeout(() => {
            initWaBot();
          }, 5000);
        } else {
          console.log('[WA-Bot] Logged out from WhatsApp. Clear wa_session folder to re-scan.');
        }
      } else if (connection === 'open') {
        isConnected = true;
        qrCodeString = null;
        qrDataUrl = null;
        connectionStatus = 'CONNECTED';
        console.log('\n✅ [WA-Bot] WHATSAPP BOT CONNECTED SUCCESSFULLY & READY TO SEND OTP!\n');
      }
    });

  } catch (err) {
    console.error('[WA-Bot Init Error]', err);
    connectionStatus = 'ERROR';
  }
}

/**
 * Send WhatsApp text message
 */
async function sendMessage(phone, messageText) {
  const jid = formatPhoneToJid(phone);
  if (!jid) {
    throw new Error('Nomor WhatsApp tidak valid.');
  }

  if (!sock || !isConnected) {
    throw new Error('WhatsApp Bot belum terhubung / belum di-scan QR Code.');
  }

  const result = await sock.sendMessage(jid, { text: messageText });
  return result;
}

/**
 * Generate 6-digit numeric OTP code
 */
function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Send OTP via WhatsApp to user number and save in store
 */
async function sendRegisterOtp(phone, registrationData = {}) {
  const standardPhone = formatPhoneStandard(phone);
  if (!standardPhone || standardPhone.length < 9) {
    throw new Error('Nomor WhatsApp tidak valid.');
  }

  const otpCode = generateOtpCode();
  const expireSeconds = parseInt(process.env.OTP_EXPIRE_SECONDS || '300', 10); // 5 minutes
  const expiresAt = Date.now() + (expireSeconds * 1000);

  const messageText = `🔐 *VERIFIKASI NOXARIANET WALLET*\n\n` +
    `Kode OTP Anda adalah: *${otpCode}*\n\n` +
    ` Kode ini berlaku selama ${Math.ceil(expireSeconds / 60)} menit.\n` +
    `Jangan berikan kode ini kepada siapa pun termasuk pihak NoxariaNet Wallet.\n\n` +
    `_Terima kasih telah mendaftar di NoxariaNet Wallet._`;

  // Try sending via WhatsApp
  await sendMessage(phone, messageText);

  // Save to memory store
  otpStore.set(standardPhone, {
    otp: otpCode,
    expiresAt,
    registrationData,
    attempts: 0
  });

  console.log(`[WA-Bot OTP] Sent OTP ${otpCode} to ${standardPhone}`);
  return { success: true, phone: standardPhone, expiresAt };
}

/**
 * Verify OTP entered by user
 */
function verifyRegisterOtp(phone, inputOtp) {
  const standardPhone = formatPhoneStandard(phone);
  const storedData = otpStore.get(standardPhone);

  if (!storedData) {
    return { success: false, message: 'Kode OTP tidak ditemukan atau belum dikirim. Silakan minta OTP baru.' };
  }

  if (Date.now() > storedData.expiresAt) {
    otpStore.delete(standardPhone);
    return { success: false, message: 'Kode OTP telah kedaluwarsa. Silakan klik Kirim Ulang OTP.' };
  }

  if (storedData.attempts >= 5) {
    otpStore.delete(standardPhone);
    return { success: false, message: 'Terlalu banyak percobaan salah. Silakan minta OTP baru.' };
  }

  if (String(storedData.otp).trim() !== String(inputOtp).trim()) {
    storedData.attempts += 1;
    return { success: false, message: `Kode OTP salah (${storedData.attempts}/5). Periksa kembali pesan WhatsApp Anda.` };
  }

  // OTP verified successfully!
  const regData = storedData.registrationData;
  otpStore.delete(standardPhone);

  return { success: true, phone: standardPhone, registrationData: regData };
}

/**
 * Get current bot status
 */
function getBotStatus() {
  return {
    isConnected,
    connectionStatus,
    hasQr: !!qrCodeString,
    qrCodeString,
    qrDataUrl
  };
}

module.exports = {
  initWaBot,
  sendMessage,
  sendRegisterOtp,
  verifyRegisterOtp,
  getBotStatus,
  formatPhoneStandard,
  formatPhoneToJid
};
