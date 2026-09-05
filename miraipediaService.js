/**
 * Service to handle dynamic QRIS generation via Miraipedia Convert Static to Dynamic API.
 * Converts static QRIS (e.g. DANA Bisnis) into dynamic QRIS with exact locked payment amounts.
 * Includes automatic local EMVCo CRC16 fallback generator if the external API is unreachable.
 */

const QRCode = require('qrcode');

const DEFAULT_STATIC_QRIS = '00020101021226570011ID.DANA.WWW011893600915303463582702090346358270303UMI51440014ID.CO.QRIS.WWW0215ID10265819355290303UMI520448145303360540410005802ID5916Noxarianet Store6015Kab. Pekalongan61055115563049C78';
const DEFAULT_MIRAIPEDIA_API_URL = 'https://qris.miraipedia.my.id/api/convert';

/**
 * Calculate CRC16-CCITT (Poly: 0x1021, Initial: 0xFFFF) for EMVCo QRIS specification.
 * @param {string} str - QRIS payload without CRC tag value
 * @returns {string} 4-character hex checksum uppercase
 */
function crc16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Convert raw static QRIS string into dynamic QRIS string with locked transaction amount.
 * @param {string} staticPayload - Static QRIS raw string
 * @param {number|string} amount - Nominal pas dalam IDR
 * @returns {string} Dynamic QRIS raw string
 */
function convertStaticPayloadToDynamic(staticPayload, amount) {
  let payload = String(staticPayload).trim();

  // 1. Ubah Tag 010211 (Static) -> 010212 (Dynamic)
  payload = payload.replace('010211', '010212');

  // 2. Hapus tag 54 yang sudah ada jika ada sebelumnya
  // Tag 54 format: 54 + LL + amount (terletak sebelum tag 5802ID)
  payload = payload.replace(/54\d{2}\d+?(?=5802ID)/, '');

  // 3. Format Tag 54 baru
  const amountStr = String(Math.ceil(Number(amount)));
  const amountLen = String(amountStr.length).padStart(2, '0');
  const tag54 = '54' + amountLen + amountStr;

  // Sisipkan Tag 54 setelah Tag 5303360 (IDR)
  const currIndex = payload.indexOf('5303360');
  if (currIndex !== -1) {
    payload = payload.substring(0, currIndex + 7) + tag54 + payload.substring(currIndex + 7);
  } else {
    // Fallback: sisipkan sebelum Tag 5802ID
    const countryIdx = payload.indexOf('5802ID');
    if (countryIdx !== -1) {
      payload = payload.substring(0, countryIdx) + tag54 + payload.substring(countryIdx);
    }
  }

  // 4. Hapus CRC lama (6304XXXX) di bagian belakang
  const crcIndex = payload.lastIndexOf('6304');
  if (crcIndex !== -1) {
    payload = payload.substring(0, crcIndex);
  }

  // 5. Tambahkan tag 6304 dan hitung ulang CRC16
  payload += '6304';
  const checksum = crc16(payload);

  return payload + checksum;
}

class MiraipediaService {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || process.env.MIRAIPEDIA_API_URL || DEFAULT_MIRAIPEDIA_API_URL;
    this.staticQris = config.staticQris || process.env.STATIC_QRIS || DEFAULT_STATIC_QRIS;
  }

  getStaticQris() {
    const envVal = (process.env.STATIC_QRIS || '').trim();
    if (envVal && envVal !== 'undefined' && envVal !== 'null') return envVal;
    const cfgVal = (this.staticQris || '').trim();
    if (cfgVal && cfgVal !== 'undefined' && cfgVal !== 'null') return cfgVal;
    return DEFAULT_STATIC_QRIS;
  }

  /**
   * Generate dynamic QRIS locally using built-in EMVCo algorithm and QRCode generator.
   * Guaranteed to work offline without relying on external endpoints.
   * @param {number|string} amount
   * @param {string} [customStaticQris]
   * @returns {Promise<{success: boolean, qris_string: string, qr_base64: string, amount: number, source: string}>}
   */
  async generateLocalDynamicQris(amount, customStaticQris = null) {
    const numericAmount = Math.ceil(parseInt(amount, 10));
    const staticQris = (customStaticQris || this.getStaticQris() || DEFAULT_STATIC_QRIS).trim();
    const dynamicString = convertStaticPayloadToDynamic(staticQris, numericAmount);

    const base64Data = await QRCode.toDataURL(dynamicString, {
      margin: 2,
      width: 360,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    return {
      success: true,
      status: 'success',
      qris_string: dynamicString,
      qr_base64: base64Data,
      amount: numericAmount,
      source: 'local_generator'
    };
  }

  /**
   * Convert static QRIS to dynamic QRIS with specified transaction amount.
   * Tries Miraipedia API first. Automatically falls back to local EMVCo generator on error.
   * @param {number|string} amount - Transaction amount in IDR
   * @param {string} [customStaticQris] - Optional custom static QRIS string
   * @param {number} [timeoutMs=10000] - Request timeout in milliseconds
   * @returns {Promise<{success: boolean, qris_string: string, qr_base64: string, amount: number}>}
   */
  async convertStaticToDynamic(amount, customStaticQris = null, timeoutMs = 10000) {
    const numericAmount = Math.ceil(parseInt(amount, 10));
    if (isNaN(numericAmount) || numericAmount < 1000) {
      throw new Error('Nominal transaksi minimal Rp 1.000.');
    }

    const staticQris = (customStaticQris || this.getStaticQris() || DEFAULT_STATIC_QRIS).trim();

    const payload = JSON.stringify({
      amount: String(numericAmount),
      qris: String(staticQris).trim()
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payload))
        },
        body: payload,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const json = await response.json().catch(() => null);

      if (!response.ok || !json || json.status !== 'success' || !json.data) {
        const errorMsg = json?.message || `HTTP ${response.status} dari API Miraipedia`;
        console.warn(`[Miraipedia Notice]: API returned non-success (${errorMsg}). Switching to local EMVCo QRIS generator.`);
        return await this.generateLocalDynamicQris(numericAmount, staticQris);
      }

      let { qris_string, qr_base64 } = json.data;

      // Ensure qr_base64 is a valid data URL
      if (qr_base64 && !qr_base64.startsWith('data:image') && !qr_base64.startsWith('http')) {
        qr_base64 = `data:image/png;base64,${qr_base64}`;
      }

      // If qr_base64 is missing but qris_string is present, generate image from qris_string
      if (!qr_base64 && qris_string) {
        qr_base64 = await QRCode.toDataURL(qris_string, { margin: 2, width: 360 });
      }

      return {
        success: true,
        status: 'success',
        qris_string: qris_string || '',
        qr_base64: qr_base64,
        amount: numericAmount,
        source: 'miraipedia_api'
      };
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn(`[Miraipedia Notice]: Request error (${err.message}). Activating seamless local QRIS generator.`);
      return await this.generateLocalDynamicQris(numericAmount, staticQris);
    }
  }
}

module.exports = new MiraipediaService();
