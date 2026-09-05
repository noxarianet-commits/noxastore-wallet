/**
 * Service to handle dynamic QRIS generation via Miraipedia Convert Static to Dynamic API.
 * Converts static QRIS (e.g. DANA Bisnis) into dynamic QRIS with exact locked payment amounts.
 */

class MiraipediaService {
  constructor(config = {}) {
    this.apiUrl = config.apiUrl || process.env.MIRAIPEDIA_API_URL || 'https://qris.miraipedia.my.id/api/convert';
    this.staticQris = config.staticQris || process.env.STATIC_QRIS || '';
  }

  getStaticQris() {
    return this.staticQris || process.env.STATIC_QRIS || '';
  }

  /**
   * Convert static QRIS to dynamic QRIS with specified transaction amount.
   * @param {number|string} amount - Transaction amount in IDR
   * @param {string} [customStaticQris] - Optional custom static QRIS string
   * @param {number} [timeoutMs=15000] - Request timeout in milliseconds
   * @returns {Promise<{success: boolean, qris_string: string, qr_base64: string, amount: number}>}
   */
  async convertStaticToDynamic(amount, customStaticQris = null, timeoutMs = 15000) {
    const numericAmount = Math.ceil(parseInt(amount, 10));
    if (isNaN(numericAmount) || numericAmount < 1000) {
      throw new Error('Nominal transaksi minimal Rp 1.000.');
    }

    const staticQris = customStaticQris || this.getStaticQris();
    if (!staticQris) {
      throw new Error('Static QRIS belum dikonfigurasi di server (.env STATIC_QRIS).');
    }

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

      if (!response.ok || !json) {
        const errorMsg = json?.message || `HTTP ${response.status} dari server convert QRIS`;
        throw new Error(errorMsg);
      }

      if (json.status !== 'success' || !json.data) {
        throw new Error(json.message || 'Respon convert QRIS tidak valid.');
      }

      const { qris_string, qr_base64 } = json.data;
      if (!qr_base64) {
        throw new Error('Gambar QRIS base64 tidak ditemukan dalam respon API.');
      }

      return {
        success: true,
        status: 'success',
        qris_string: qris_string || '',
        qr_base64: qr_base64,
        amount: numericAmount
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Koneksi ke server convert QRIS timeout (lebih dari 15 detik).');
      }
      throw err;
    }
  }
}

module.exports = new MiraipediaService();
