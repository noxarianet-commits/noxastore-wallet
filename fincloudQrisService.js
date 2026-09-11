const crypto = require('crypto');
const https = require('https');
const http = require('http');
const QRCode = require('qrcode');

/**
 * FinCloud Dynamic QRIS Service
 * Dokumentasi Resmi: https://fincloud.my.id/docs
 * 
 * Standar Komunikasi:
 * - Host: fincloud.my.id (Port 443)
 * - Jaringan: Wajib IPv4 (family: 4) agar terverifikasi oleh IP Whitelist FinCloud
 * - Content-Type: application/x-www-form-urlencoded
 * - Signature create_invoice: MD5(apikey + nominal + reff_id)
 * - Signature cek_status: MD5(apikey + reff_id)
 * - Signature cancel_invoice: MD5(apikey + reff_id)
 */
class FinCloudQrisService {
  constructor(config = {}) {
    let rawBaseUrl = (config.baseUrl || process.env.FINCLOUD_BASE_URL || 'https://fincloud.my.id').trim();
    
    // Normalisasi: jika base URL mengandung api.fincloud.my.id, ganti ke fincloud.my.id
    if (rawBaseUrl.includes('api.fincloud.my.id')) {
      rawBaseUrl = 'https://fincloud.my.id';
    }
    this.baseUrl = rawBaseUrl.replace(/\/+$/, '');
    this.apiKey = (config.apiKey || process.env.FINCLOUD_API_KEY || 'fc_live_038b7a0ff8fcb9362adfd931abe2dc94').trim();

    // Daftar kandidat path untuk endpoint invoice
    this.invoiceEndpoints = [
      '/api/create_invoice',
      '/create_invoice'
    ];

    // Daftar kandidat path untuk cek status
    this.statusEndpoints = [
      '/api/cek_status',
      '/cek_status'
    ];

    // Daftar kandidat path untuk cancel invoice
    this.cancelEndpoints = [
      '/api/cancel_invoice',
      '/cancel_invoice'
    ];

    console.log(`[FinCloud QRIS] Service diinisialisasi. Base URL: ${this.baseUrl}, API Key: ${this.apiKey ? (this.apiKey.substring(0, 10) + '...') : 'NOT SET'}`);
  }

  /**
   * Helper kalkulasi hash MD5 sesuai spesifikasi FinCloud
   * @param {string} str
   * @returns {string} Hexadecimal lowercase
   */
  md5(str) {
    return crypto.createHash('md5').update(String(str)).digest('hex');
  }

  /**
   * Helper backward compatibility: Signature HMAC jika sewaktu-waktu dibutuhkan
   * @param {string} reffId
   * @param {number|string} nominal
   * @returns {string} Hexadecimal signature
   */
  generateSignature(reffId, nominal) {
    return this.md5(`${this.apiKey}${nominal}${reffId}`);
  }

  /**
   * Helper request HTTP POST dengan form-urlencoded dan IPv4 forcing
   * @param {string} endpointPath - path misal '/api/create_invoice'
   * @param {object} params - parameter key-value
   * @param {number} timeoutMs - batas waktu request dalam ms
   * @returns {Promise<{statusCode: number, data: object, raw: string}>}
   */
  sendFormRequest(endpointPath, params, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const fullUrl = `${this.baseUrl}${endpointPath.startsWith('/') ? endpointPath : '/' + endpointPath}`;
      const urlObj = new URL(fullUrl);
      const postData = new URLSearchParams(params).toString();
      const isHttps = urlObj.protocol === 'https:';
      const transport = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        family: 4, // Wajib IPv4 agar sesuai dengan Whitelist FinCloud
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NoxaWallet/1.0'
        }
      };

      const req = transport.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(responseBody);
            resolve({ statusCode: res.statusCode, data: parsed, raw: responseBody });
          } catch (jsonErr) {
            resolve({ statusCode: res.statusCode, error: 'NON_JSON', raw: responseBody });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout menghubungi FinCloud (${fullUrl}) setelah ${timeoutMs / 1000} detik`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Mengunduh gambar QR dari URL FinCloud dan mengonversi menjadi data:image/png;base64,...
   * Menghindari masalah CORS canvas saat user menekan 'Unduh QRIS' di frontend.
   * @param {string} imageUrl
   * @returns {Promise<string|null>} Base64 data URL
   */
  async fetchImageAsBase64(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
      return null;
    }

    return new Promise((resolve) => {
      try {
        const urlObj = new URL(imageUrl);
        const isHttps = urlObj.protocol === 'https:';
        const transport = isHttps ? https : http;

        const req = transport.get(imageUrl, { family: 4, timeout: 8000 }, (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return resolve(null);
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const contentType = res.headers['content-type'] || 'image/png';
            resolve(`data:${contentType};base64,${buffer.toString('base64')}`);
          });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => {
          req.destroy();
          resolve(null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * 1. Buat Tagihan Dynamic QRIS FinCloud
   * Endpoint: POST /api/create_invoice
   * Payload: apikey, nominal, reff_id, signature (MD5)
   * 
   * @param {number|string} nominal - Nominal deposit (minimal 1000)
   * @param {string} reffId - ID referensi unik internal
   * @returns {Promise<object>} Detail tagihan invoice QRIS
   */
  async createInvoice(nominal, reffId) {
    const numNominal = Math.ceil(parseInt(nominal, 10));
    if (isNaN(numNominal) || numNominal < 1000) {
      throw new Error('Nominal tagihan top up minimal Rp 1.000.');
    }

    const cleanReffId = String(reffId || `TOPUP_${Date.now()}`).trim();
    // Signature resmi FinCloud: MD5(apikey + nominal + reff_id)
    const signature = this.md5(`${this.apiKey}${numNominal}${cleanReffId}`);

    console.log(`[FinCloud QRIS] Membuat invoice: reff_id=${cleanReffId}, nominal=Rp ${numNominal.toLocaleString('id-ID')}, signature=${signature.substring(0, 10)}...`);

    const payload = {
      apikey: this.apiKey,
      nominal: String(numNominal),
      reff_id: cleanReffId,
      signature: signature
    };

    let lastError = null;
    let apiResult = null;

    // Coba endpoint resmi terlebih dahulu (/api/create_invoice lalu /create_invoice)
    for (const endpoint of this.invoiceEndpoints) {
      try {
        console.log(`[FinCloud QRIS] Mencoba endpoint: ${this.baseUrl}${endpoint}`);
        const result = await this.sendFormRequest(endpoint, payload, 20000);

        if (result.data) {
          apiResult = result.data;
          console.log(`[FinCloud QRIS] Respon dari ${endpoint}:`, JSON.stringify(apiResult));
          break;
        } else if (result.statusCode === 404) {
          console.warn(`[FinCloud QRIS] Endpoint ${endpoint} mengembalikan 404, mencoba endpoint alternatif...`);
          continue;
        } else if (result.raw) {
          console.warn(`[FinCloud QRIS] Respon non-JSON dari ${endpoint}:`, result.raw.substring(0, 120));
        }
      } catch (err) {
        lastError = err;
        console.error(`[FinCloud QRIS] Gagal pada ${endpoint}:`, err.message);
      }
    }

    if (!apiResult) {
      throw lastError || new Error('Gagal menghubungi server FinCloud QRIS (tidak ada respon valid).');
    }

    // Periksa status respon FinCloud
    const isSuccess = apiResult.status === true || apiResult.success === true || apiResult.status === 'success';
    if (!isSuccess) {
      const errorMsg = apiResult.msg || apiResult.message || apiResult.error || 'Ditolak oleh FinCloud';
      console.error(`❌ [FinCloud QRIS Ditolak]: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    // Ekstraksi data invoice FinCloud
    const resData = (apiResult.data && typeof apiResult.data === 'object') ? apiResult.data : apiResult;

    const totalAmount = Math.ceil(
      Number(resData.nominal_total || resData.total_bayar || resData.total_amount || resData.amount || numNominal)
    );
    const uniqueCode = totalAmount > numNominal ? (totalAmount - numNominal) : (resData.kode_unik || 0);

    const rawQrString = String(resData.qr_string || resData.qris_string || resData.payload || resData.qr_content || '').trim();
    let qrUrl = String(resData.qr_url || resData.qr_image || resData.invoice_url || '').trim();
    let qrBase64 = String(resData.qr_base64 || '').trim();

    // 1. Jika string QRIS (EMVCo payload) dikembalikan, generate Base64 langsung
    if (rawQrString) {
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

    // 2. Jika qr_url berupa link gambar online dan qr_base64 belum ada, unduh server-side via IPv4
    if (!qrBase64 && qrUrl && qrUrl.startsWith('http')) {
      try {
        const fetchedBase64 = await this.fetchImageAsBase64(qrUrl);
        if (fetchedBase64) {
          qrBase64 = fetchedBase64;
          console.log('[FinCloud QRIS] Berhasil mengunduh gambar QR ke Base64 (CORS-safe).');
        }
      } catch (fetchErr) {
        console.warn('[FinCloud QRIS] Gagal mengunduh gambar QR ke Base64, menggunakan direct URL:', fetchErr.message);
      }
    }

    // Pastikan salah satu format gambar tersedia
    const finalQrImage = qrBase64 || qrUrl;
    if (!finalQrImage && !rawQrString) {
      throw new Error(`FinCloud tidak mengembalikan data QRIS yang valid: ${JSON.stringify(apiResult)}`);
    }

    return {
      success: true,
      status: 'PENDING',
      message: apiResult.msg || apiResult.message || 'Invoice FinCloud Dynamic QRIS berhasil dibuat',
      reff_id: cleanReffId,
      invoice: resData.id_depo || resData.invoice_id || resData.invoice || cleanReffId,
      nominal_awal: numNominal,
      kode_unik: uniqueCode,
      total_amount: totalAmount,
      amount: totalAmount,
      qr_string: rawQrString,
      qr_url: qrUrl || finalQrImage,
      qr_base64: finalQrImage,
      payment_link: resData.invoice_url || qrUrl || '',
      expired_at: resData.expired_at || resData.kadaluarsa || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      raw: apiResult
    };
  }

  /**
   * 2. Pengecekan Status Pembayaran Tagihan QRIS Real-Time
   * Endpoint: POST /api/cek_status
   * Payload: apikey, reff_id, signature (MD5)
   * 
   * @param {string} reffId - ID referensi order kita
   * @returns {Promise<{success: boolean, status: string, rawStatus: string, reff_id: string, amount: number, data: object, raw: object}>}
   */
  async checkInvoiceStatus(reffId) {
    const cleanReffId = String(reffId || '').trim();
    if (!cleanReffId) {
      throw new Error('reff_id wajib diisi untuk cek status.');
    }

    // Signature cek_status FinCloud: MD5(apikey + reff_id)
    const signature = this.md5(`${this.apiKey}${cleanReffId}`);

    const payload = {
      apikey: this.apiKey,
      reff_id: cleanReffId,
      signature: signature
    };

    let apiResult = null;
    let lastError = null;

    for (const endpoint of this.statusEndpoints) {
      try {
        const result = await this.sendFormRequest(endpoint, payload, 15000);
        if (result.data) {
          apiResult = result.data;
          break;
        } else if (result.statusCode === 404) {
          continue;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!apiResult) {
      throw lastError || new Error('Gagal mengecek status ke FinCloud.');
    }

    const resData = (apiResult.data && typeof apiResult.data === 'object') ? apiResult.data : apiResult;
    const rawStatus = String(resData.status || apiResult.status_transaksi || apiResult.status || '').toLowerCase();

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
      amount: Number(resData.nominal_total || resData.total_bayar || resData.nominal || resData.amount || 0),
      data: resData,
      raw: apiResult
    };
  }

  /**
   * 3. Batalkan Tagihan QRIS
   * Endpoint: POST /api/cancel_invoice
   * @param {string} reffId
   */
  async cancelInvoice(reffId) {
    const cleanReffId = String(reffId || '').trim();
    if (!cleanReffId) {
      throw new Error('reff_id wajib diisi untuk cancel invoice.');
    }

    const signature = this.md5(`${this.apiKey}${cleanReffId}`);
    const payload = {
      apikey: this.apiKey,
      reff_id: cleanReffId,
      signature: signature
    };

    for (const endpoint of this.cancelEndpoints) {
      try {
        const result = await this.sendFormRequest(endpoint, payload, 15000);
        if (result.data) {
          return result.data;
        }
      } catch (err) {
        // Continue to fallback
      }
    }

    return { status: false, msg: 'Endpoint cancel_invoice tidak merespon' };
  }

  /**
   * 4. Cek Saldo FinCloud
   * Endpoint: POST /api/cek_saldo
   */
  async checkBalance() {
    try {
      const result = await this.sendFormRequest('/api/cek_saldo', {
        apikey: this.apiKey
      }, 15000);
      return result.data || result;
    } catch (err) {
      return { status: false, msg: err.message };
    }
  }
}

module.exports = FinCloudQrisService;
