const crypto = require('crypto');
const https = require('https');
const axios = require('axios');
const QRCode = require('qrcode');

// Paksa IPv4 agar selalu cocok dengan IP Whitelist FinCloud
const httpsAgent = new https.Agent({ family: 4, keepAlive: true });

/**
 * FinCloud Dynamic QRIS Service (API v1.0)
 * Khusus menangani:
 * - Pembuatan Tagihan QRIS Dinamis (POST /create_invoice)
 * - Pengecekan Status Pembayaran (POST /cek_status)
 * - Pembatalan Invoice (POST /cancel_invoice)
 * - Signature HMAC-SHA256: hash_hmac('sha256', reff_id + ':' + nominal, apikey)
 */
class FinCloudQrisService {
  constructor(config = {}) {
    this.baseUrl = (config.baseUrl || process.env.FINCLOUD_BASE_URL || 'https://api.fincloud.my.id/v1').replace(/\/+$/, '');
    this.apiKey = config.apiKey || process.env.FINCLOUD_API_KEY || 'fc_live_69d5157fed81422028659ee9fb24241a';

    console.log(`[FinCloud QRIS] Service initialized. Base URL: ${this.baseUrl}, API Key: ${this.apiKey ? (this.apiKey.substring(0, 10) + '...') : 'NOT SET'}`);
  }

  /**
   * Menghasilkan signature HMAC-SHA256 sesuai standar FinCloud:
   * hash_hmac('sha256', reff_id + ':' + nominal, apikey)
   * @param {string} reffId - ID referensi unik tagihan
   * @param {number|string} nominal - Nominal pokok tagihan
   * @returns {string} Hexadecimal signature hash
   */
  generateSignature(reffId, nominal) {
    const payload = `${reffId}:${nominal}`;
    return crypto.createHmac('sha256', this.apiKey).update(payload).digest('hex');
  }

  /**
   * Helper internal untuk HTTP request JSON ke FinCloud API v1.0
   * Memaksa IPv4 via httpsAgent agar cocok dengan IP Whitelist FinCloud
   * @private
   */
  async _request(endpoint, payload = {}) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const url = `${this.baseUrl}${cleanEndpoint}`;

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    const bodyData = {
      apikey: this.apiKey,
      ...payload
    };

    try {
      const res = await axios.post(url, bodyData, {
        headers,
        timeout: 20000,
        httpsAgent
      });

      const parsed = res.data;
      return {
        httpCode: res.status,
        ...(typeof parsed === 'object' && parsed !== null ? parsed : { raw: parsed })
      };
    } catch (err) {
      if (err.response && err.response.data) {
        const errData = err.response.data;
        return {
          httpCode: err.response.status,
          ...(typeof errData === 'object' && errData !== null ? errData : { raw: errData })
        };
      }
      console.error(`[FinCloud QRIS Error] [${cleanEndpoint}]:`, err.message);
      throw err;
    }
  }

  /**
   * 1. Buat Tagihan Dynamic QRIS baru
   * Endpoint: POST /create_invoice
   * @param {number|string} nominal - Nominal pokok tagihan (Min Rp 1.000)
   * @param {string} reffId - ID referensi invoice unik dari sistem kita
   * @returns {Promise<object>} Detail invoice lengkap dari FinCloud
   */
  async createInvoice(nominal, reffId) {
    const numNominal = Math.ceil(parseInt(nominal, 10));
    if (isNaN(numNominal) || numNominal < 1000) {
      throw new Error('Nominal tagihan minimal Rp 1.000.');
    }

    const cleanReffId = String(reffId || `TOPUP_${Date.now()}`).trim();
    const signature = this.generateSignature(cleanReffId, numNominal);

    console.log(`[FinCloud QRIS] Creating invoice: reff_id=${cleanReffId}, nominal=${numNominal}`);

    const res = await this._request('/create_invoice', {
      nominal: numNominal,
      reff_id: cleanReffId,
      signature: signature
    });

    if (!res) {
      throw new Error('Gagal mendapatkan respon dari server FinCloud QRIS.');
    }

    // Ambil data payload dari berbagai kemungkinan struktur respon FinCloud
    const resData = res.data || res;
    const rawQrString = resData.qr_string || resData.qris_string || resData.qr_content || resData.payload || '';
    let qrUrl = resData.qr_url || resData.qr_image || resData.invoice_url || '';
    let qrBase64 = resData.qr_base64 || '';

    // Jika FinCloud mengembalikan string QRIS mentah tanpa gambar base64, generate QR lokal
    if (rawQrString && !qrBase64) {
      try {
        qrBase64 = await QRCode.toDataURL(rawQrString, {
          errorCorrectionLevel: 'M',
          margin: 2,
          scale: 8,
          color: { dark: '#000000', light: '#ffffff' }
        });
      } catch (qrErr) {
        console.warn('[FinCloud QRIS] Gagal generate Base64 dari qr_string:', qrErr.message);
      }
    }

    const totalAmount = Math.ceil(
      Number(resData.nominal_total || resData.total_bayar || resData.total_amount || resData.amount || numNominal)
    );
    const uniqueCode = totalAmount > numNominal ? (totalAmount - numNominal) : (resData.kode_unik || 0);

    return {
      success: res.status === true || res.success === true || res.httpCode === 200,
      status: res.status === true || res.success === true ? 'PENDING' : 'FAILED',
      message: res.msg || res.message || 'Invoice berhasil dibuat',
      reff_id: cleanReffId,
      invoice: resData.id_depo || resData.invoice_id || resData.invoice || cleanReffId,
      nominal_awal: numNominal,
      kode_unik: uniqueCode,
      total_amount: totalAmount,
      amount: totalAmount,
      qr_string: rawQrString,
      qr_url: qrUrl || qrBase64,
      qr_base64: qrBase64 || qrUrl,
      expired_at: resData.expired_at || resData.kadaluarsa || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      raw: res
    };
  }

  /**
   * 2. Pengecekan Status Pembayaran Tagihan QRIS
   * Endpoint: POST /cek_status
   * @param {string} reffId - ID referensi invoice kita
   * @returns {Promise<object>} Status terkini dari FinCloud
   */
  async checkInvoiceStatus(reffId) {
    const cleanReffId = String(reffId || '').trim();
    if (!cleanReffId) {
      throw new Error('reff_id wajib diisi untuk cek status.');
    }

    const res = await this._request('/cek_status', {
      reff_id: cleanReffId
    });

    const resData = res.data || res;
    const rawStatus = String(resData.status || res.status_transaksi || res.status || '').toLowerCase();

    let normalizedStatus = 'PENDING';
    if (['success', 'paid', 'berhasil', 'lunas', 'completed'].includes(rawStatus)) {
      normalizedStatus = 'PAID';
    } else if (['expired', 'kadaluarsa', 'batal', 'cancelled', 'canceled'].includes(rawStatus)) {
      normalizedStatus = 'EXPIRED';
    } else if (['failed', 'gagal'].includes(rawStatus)) {
      normalizedStatus = 'FAILED';
    }

    return {
      success: true,
      status: normalizedStatus,
      rawStatus: rawStatus,
      reff_id: cleanReffId,
      amount: resData.nominal_total || resData.total_bayar || resData.nominal || resData.amount || 0,
      data: resData,
      raw: res
    };
  }

  /**
   * 3. Batalkan Tagihan QRIS yang belum terbayar
   * Endpoint: POST /cancel_invoice (alias: /qris/cancel)
   * @param {string} reffId - ID referensi invoice yang ingin dibatalkan
   * @returns {Promise<object>}
   */
  async cancelInvoice(reffId) {
    const cleanReffId = String(reffId || '').trim();
    if (!cleanReffId) {
      throw new Error('reff_id wajib diisi untuk cancel invoice.');
    }

    return await this._request('/cancel_invoice', {
      reff_id: cleanReffId
    });
  }
}

module.exports = FinCloudQrisService;
