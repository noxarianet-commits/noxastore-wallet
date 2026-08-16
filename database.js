const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, process.env.DATABASE_FILE || 'data.sqlite');
let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new sqlite3.Database(dbPath);
    dbInstance.configure('busyTimeout', 10000);
  }
  return dbInstance;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function getWibDateTime(dateInput = new Date()) {
  const d = new Date(dateInput);
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const wibTime = new Date(validDate.getTime() + (7 * 60 * 60 * 1000));
  const pad = n => String(n).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return {
    date: `${pad(wibTime.getUTCDate())} ${months[wibTime.getUTCMonth()]} ${wibTime.getUTCFullYear()}`,
    time: `${pad(wibTime.getUTCHours())}:${pad(wibTime.getUTCMinutes())}:${pad(wibTime.getUTCSeconds())} WIB`,
    createdAt: validDate.toISOString()
  };
}

async function initDb() {
  const db = getDb();
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      fullname TEXT,
      brand TEXT,
      userId TEXT,
      email TEXT,
      waContact TEXT,
      mainBalance INTEGER DEFAULT 0,
      qrisBalance INTEGER DEFAULT 0,
      role TEXT DEFAULT 'MEMBER',
      transactionPin TEXT,
      lastIp TEXT,
      lastDevice TEXT,
      lastLocation TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      orderId TEXT,
      merchant TEXT,
      product_name TEXT,
      target TEXT,
      account_name TEXT,
      base_price INTEGER DEFAULT 0,
      adminFee INTEGER DEFAULT 0,
      markup INTEGER DEFAULT 0,
      amount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      type TEXT,
      sn TEXT,
      product_license TEXT,
      note TEXT,
      failureReason TEXT,
      rawResponse TEXT,
      apiMessage TEXT,
      balanceRefunded INTEGER DEFAULT 0,
      date TEXT,
      time TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      idDepo TEXT,
      username TEXT NOT NULL,
      amount INTEGER DEFAULT 0,
      nominalTotal INTEGER DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      paymentUrl TEXT,
      qrUrl TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      transactionId TEXT,
      clientRequestId TEXT,
      username TEXT NOT NULL,
      fullname TEXT,
      destination TEXT,
      method TEXT,
      amount INTEGER DEFAULT 0,
      adminFee INTEGER DEFAULT 0,
      totalDeducted INTEGER DEFAULT 0,
      orderId TEXT,
      merchant TEXT,
      status TEXT,
      gatewayStatus TEXT,
      type TEXT,
      balanceRefunded INTEGER DEFAULT 0,
      apiMessage TEXT,
      failureReason TEXT,
      rawResponse TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS banners (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      imageUrl TEXT NOT NULL,
      link TEXT,
      active INTEGER DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS informations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      contentTitle TEXT,
      content TEXT NOT NULL,
      date TEXT,
      time TEXT,
      active INTEGER DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ppob_visibility (
      sku TEXT PRIMARY KEY,
      active INTEGER DEFAULT 1,
      category TEXT,
      brand TEXT,
      markup INTEGER DEFAULT 0,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Ensure default config exists
  const announcementConfig = await getConfig('announcement');
  if (!announcementConfig) {
    await setConfig('announcement', {
      text: 'Sistem verifikasi otomatis AI OCR saat ini hanya mendukung bukti transaksi DANA.',
      active: true
    });
  }

  const appUpdateConfig = await getConfig('appUpdate');
  if (!appUpdateConfig) {
    await setConfig('appUpdate', {
      version: '1.0.0',
      notes: 'Stable Build',
      forceUpdate: false
    });
  }

  console.log('[SQLite DB] Database initialized successfully using data.sqlite.');
  return db;
}

// CONFIG FUNCTIONS
async function getConfig(key) {
  const row = await get('SELECT value FROM app_config WHERE key = ?', [key]);
  if (row && row.value) {
    try {
      return JSON.parse(row.value);
    } catch (e) {
      return row.value;
    }
  }
  return null;
}

async function setConfig(key, value) {
  const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
  await run(`
    INSERT INTO app_config (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP;
  `, [key, strVal]);
}

// USER FUNCTIONS
async function getUser(username) {
  if (!username) return null;
  const userRow = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!userRow) return null;

  const historyRows = await all('SELECT * FROM transactions WHERE username = ? ORDER BY datetime(createdAt) DESC', [username]);
  const formattedHistory = historyRows.map(h => ({
    ...h,
    balanceRefunded: !!h.balanceRefunded,
    rawResponse: h.rawResponse ? (() => { try { return JSON.parse(h.rawResponse); } catch(e) { return h.rawResponse; } })() : null
  }));

  return {
    ...userRow,
    saldo: userRow.mainBalance,
    pin: userRow.transactionPin,
    history: formattedHistory,
    usedTransactions: [],
    usedRRNs: []
  };
}

async function getUserByUserId(userId) {
  if (!userId) return null;
  const userRow = await get('SELECT username FROM users WHERE userId = ?', [userId]);
  if (!userRow) return null;
  return await getUser(userRow.username);
}

async function getUserByEmail(email) {
  if (!email) return null;
  const target = email.trim().toLowerCase();
  const userRow = await get('SELECT username FROM users WHERE LOWER(email) = ?', [target]);
  if (!userRow) return null;
  return await getUser(userRow.username);
}

async function getUserByWaContact(waContact) {
  if (!waContact) return null;
  const clean = String(waContact).replace(/\D/g, '');
  const userRow = await get('SELECT username FROM users WHERE username = ? OR REPLACE(waContact, "+", "") = ?', [clean, clean]);
  if (!userRow) return null;
  return await getUser(userRow.username);
}

async function getAllUsersMap() {
  const users = await all('SELECT * FROM users');
  const map = {};
  for (const u of users) {
    map[u.username] = await getUser(u.username);
  }
  return map;
}

async function createUser(userData) {
  const { username, fullname, brand, password, userId, email, waContact, mainBalance, role, lastIp, lastDevice, lastLocation } = userData;
  const uName = username;

  await run(`
    INSERT INTO users (
      username, password, fullname, brand, userId, email, waContact,
      mainBalance, qrisBalance, role, transactionPin, lastIp, lastDevice, lastLocation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      fullname = excluded.fullname,
      password = excluded.password,
      mainBalance = excluded.mainBalance;
  `, [
    uName,
    password || '',
    fullname || uName,
    brand || (fullname ? fullname.toUpperCase() : uName),
    userId || uName,
    email || '',
    waContact || uName,
    mainBalance || 0,
    role || 'MEMBER',
    lastIp || '',
    lastDevice || '',
    lastLocation || 'Mencari lokasi...'
  ]);

  return await getUser(uName);
}

async function updateUser(username, updateFields) {
  if (!username) return;
  const fieldMapping = {
    fullname: 'fullname',
    brand: 'brand',
    password: 'password',
    userId: 'userId',
    email: 'email',
    waContact: 'waContact',
    mainBalance: 'mainBalance',
    saldo: 'mainBalance',
    qrisBalance: 'qrisBalance',
    role: 'role',
    transactionPin: 'transactionPin',
    pin: 'transactionPin',
    lastIp: 'lastIp',
    lastDevice: 'lastDevice',
    lastLocation: 'lastLocation'
  };

  const updates = [];
  const params = [];

  for (const [k, v] of Object.entries(updateFields)) {
    const col = fieldMapping[k];
    if (col) {
      updates.push(`${col} = ?`);
      params.push(v);
    }
  }

  if (updates.length > 0) {
    updates.push('updatedAt = CURRENT_TIMESTAMP');
    params.push(username);
    await run(`UPDATE users SET ${updates.join(', ')} WHERE username = ?`, params);
  }
}

async function updateUsernameKey(oldUsername, newUsername) {
  if (!oldUsername || !newUsername) return;
  await run('UPDATE users SET username = ?, waContact = ? WHERE username = ?', [newUsername, newUsername, oldUsername]);
  await run('UPDATE transactions SET username = ? WHERE username = ?', [newUsername, oldUsername]);
  await run('UPDATE payments SET username = ? WHERE username = ?', [newUsername, oldUsername]);
  await run('UPDATE withdrawals SET username = ? WHERE username = ?', [newUsername, oldUsername]);
}

async function deleteUser(username) {
  if (!username) return;
  await run('DELETE FROM users WHERE username = ?', [username]);
  await run('DELETE FROM transactions WHERE username = ?', [username]);
  await run('DELETE FROM payments WHERE username = ?', [username]);
  await run('DELETE FROM withdrawals WHERE username = ?', [username]);
}

async function purgeDatabase() {
  await run('DELETE FROM users;');
  await run('DELETE FROM transactions;');
  await run('DELETE FROM payments;');
  await run('DELETE FROM withdrawals;');
  await run('DELETE FROM banners;');
  await run('DELETE FROM informations;');
  await run('DELETE FROM ppob_visibility;');
  await run('DELETE FROM app_config;');
}

// HISTORY / TRANSACTIONS FUNCTIONS
async function addHistory(username, record) {
  if (!username || !record) return;

  // Auto-create user if missing
  let userExists = await get('SELECT username FROM users WHERE username = ?', [username]);
  if (!userExists) {
    await createUser({ username: username });
  }

  const wib = getWibDateTime(record.createdAt || new Date());
  const txId = record.id || `H-${Date.now()}`;
  const rawResp = typeof record.rawResponse === 'object' && record.rawResponse !== null ? JSON.stringify(record.rawResponse) : (record.rawResponse || null);

  const basePrice = record.base_price !== undefined ? record.base_price : (record.amount - (record.adminFee || record.markup || 0));
  const adminFee = record.adminFee !== undefined ? record.adminFee : (record.markup || 0);
  const markup = record.markup !== undefined ? record.markup : (record.adminFee || 0);

  await run(`
    INSERT INTO transactions (
      id, username, orderId, merchant, product_name, target, account_name,
      base_price, adminFee, markup, amount, status, type, sn, product_license,
      note, failureReason, rawResponse, apiMessage, balanceRefunded, date, time, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      sn = COALESCE(NULLIF(excluded.sn, ''), transactions.sn),
      product_license = COALESCE(NULLIF(excluded.product_license, ''), transactions.product_license),
      note = COALESCE(NULLIF(excluded.note, ''), transactions.note),
      failureReason = COALESCE(NULLIF(excluded.failureReason, ''), transactions.failureReason),
      rawResponse = COALESCE(excluded.rawResponse, transactions.rawResponse),
      apiMessage = COALESCE(NULLIF(excluded.apiMessage, ''), transactions.apiMessage);
  `, [
    txId,
    username,
    record.orderId || '',
    record.merchant || record.product_name || '',
    record.product_name || record.merchant || '',
    record.target || record.phoneNumber || record.noTujuan || '',
    record.account_name || '',
    Math.ceil(Number(basePrice) || 0),
    Math.ceil(Number(adminFee) || 0),
    Math.ceil(Number(markup) || 0),
    Math.ceil(Number(record.amount) || 0),
    record.status || '',
    record.type || '',
    record.sn || record.product_license || record.license || '',
    record.product_license || record.license || record.sn || '',
    record.note || record.sn || record.product_license || '',
    record.failureReason || record.apiMessage || '',
    rawResp,
    record.apiMessage || record.failureReason || '',
    record.balanceRefunded ? 1 : 0,
    record.date || wib.date,
    record.time || wib.time,
    record.createdAt || wib.createdAt
  ]);
}

async function updateHistory(id, updateFields) {
  if (!id || !updateFields) return;
  const allowed = ['status', 'sn', 'product_license', 'note', 'failureReason', 'apiMessage', 'balanceRefunded', 'rawResponse'];
  const updates = [];
  const params = [];

  for (const [k, v] of Object.entries(updateFields)) {
    if (allowed.includes(k)) {
      if (k === 'rawResponse' && typeof v === 'object' && v !== null) {
        updates.push(`${k} = ?`);
        params.push(JSON.stringify(v));
      } else if (k === 'balanceRefunded') {
        updates.push(`${k} = ?`);
        params.push(v ? 1 : 0);
      } else {
        updates.push(`${k} = ?`);
        params.push(v);
      }
    }
  }

  if (updates.length > 0) {
    params.push(id);
    await run(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ? OR orderId = ?`, [...params, id]);
  }
}

async function deleteHistory(username, txId) {
  if (!txId) return;
  await run('DELETE FROM transactions WHERE id = ? AND username = ?', [txId, username]);
}

// PAYMENTS FUNCTIONS
async function getPayment(id) {
  if (!id) return null;
  return await get('SELECT * FROM payments WHERE id = ? OR idDepo = ?', [id, id]);
}

async function getAllPayments() {
  return await all('SELECT * FROM payments ORDER BY datetime(createdAt) DESC');
}

async function addPayment(payment) {
  if (!payment || !payment.id) return;
  await run(`
    INSERT INTO payments (id, idDepo, username, amount, nominalTotal, status, paymentUrl, qrUrl, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      updatedAt = excluded.updatedAt;
  `, [
    payment.id,
    payment.idDepo || null,
    payment.username || '',
    Math.ceil(Number(payment.amount) || 0),
    Math.ceil(Number(payment.nominalTotal) || Number(payment.amount) || 0),
    payment.status || 'PENDING',
    payment.paymentUrl || '',
    payment.qrUrl || '',
    payment.createdAt || new Date().toISOString(),
    payment.updatedAt || new Date().toISOString()
  ]);
}

async function updatePaymentStatus(id, status, updatedAt) {
  if (!id) return;
  const updateTime = updatedAt || new Date().toISOString();
  await run('UPDATE payments SET status = ?, updatedAt = ? WHERE id = ? OR idDepo = ?', [status, updateTime, id, id]);
}

// WITHDRAWALS FUNCTIONS
async function getWithdrawals() {
  const rows = await all('SELECT * FROM withdrawals ORDER BY datetime(createdAt) DESC');
  return rows.map(w => ({
    ...w,
    balanceRefunded: !!w.balanceRefunded,
    rawResponse: w.rawResponse ? (() => { try { return JSON.parse(w.rawResponse); } catch(e) { return w.rawResponse; } })() : null
  }));
}

async function addWithdrawal(w) {
  if (!w || !w.id) return;
  const wib = getWibDateTime(w.createdAt || new Date());
  const rawResp = typeof w.rawResponse === 'object' && w.rawResponse !== null ? JSON.stringify(w.rawResponse) : (w.rawResponse || null);

  await run(`
    INSERT INTO withdrawals (
      id, transactionId, clientRequestId, username, fullname, destination, method,
      amount, adminFee, totalDeducted, orderId, merchant, status, gatewayStatus,
      type, balanceRefunded, apiMessage, failureReason, rawResponse, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      gatewayStatus = excluded.gatewayStatus,
      failureReason = COALESCE(NULLIF(excluded.failureReason, ''), withdrawals.failureReason);
  `, [
    w.id,
    w.transactionId || w.id,
    w.clientRequestId || '',
    w.username || '',
    w.fullname || '',
    w.destination || '',
    w.method || '',
    Math.ceil(Number(w.amount) || 0),
    Math.ceil(Number(w.adminFee) || 0),
    Math.ceil(Number(w.totalDeducted) || 0),
    w.orderId || '',
    w.merchant || '',
    w.status || '',
    w.gatewayStatus || '',
    w.type || '',
    w.balanceRefunded ? 1 : 0,
    w.apiMessage || w.failureReason || '',
    w.failureReason || w.apiMessage || '',
    rawResp,
    w.createdAt || wib.createdAt
  ]);
}

async function getWithdrawalByClientRequestId(clientRequestId) {
  if (!clientRequestId) return null;
  const w = await get('SELECT * FROM withdrawals WHERE clientRequestId = ?', [clientRequestId]);
  if (!w) return null;
  return {
    ...w,
    balanceRefunded: !!w.balanceRefunded
  };
}

async function findDuplicateWithdrawRequest(username, amount, destination, method) {
  const row = await get(`
    SELECT * FROM withdrawals
    WHERE username = ? AND destination = ? AND amount = ? AND UPPER(method) = UPPER(?)
      AND (status = 'DIPROSES' OR gatewayStatus = 'PROCESS')
    ORDER BY datetime(createdAt) DESC LIMIT 1
  `, [username, destination, amount, method]);

  if (!row) return null;
  const now = Date.now();
  if (row.createdAt && (now - new Date(row.createdAt).getTime()) < 30000) {
    return row;
  }
  return null;
}

// BANNERS CRUD
async function getBanners(activeOnly = false) {
  const sql = activeOnly ? 'SELECT * FROM banners WHERE active = 1 ORDER BY datetime(createdAt) DESC' : 'SELECT * FROM banners ORDER BY datetime(createdAt) DESC';
  const rows = await all(sql);
  return rows.map(b => ({ ...b, active: b.active !== 0 }));
}

async function addBanner(banner) {
  await run(`
    INSERT INTO banners (id, title, imageUrl, link, active, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    banner.id,
    banner.title,
    banner.imageUrl,
    banner.link || '',
    banner.active !== false ? 1 : 0,
    banner.createdAt || new Date().toISOString()
  ]);
}

async function updateBanner(id, updateFields) {
  const updates = [];
  const params = [];
  for (const [k, v] of Object.entries(updateFields)) {
    if (['title', 'imageUrl', 'link', 'active'].includes(k)) {
      updates.push(`${k} = ?`);
      params.push(k === 'active' ? (v !== false ? 1 : 0) : v);
    }
  }
  if (updates.length > 0) {
    params.push(id);
    await run(`UPDATE banners SET ${updates.join(', ')} WHERE id = ?`, params);
  }
}

async function deleteBanner(id) {
  await run('DELETE FROM banners WHERE id = ?', [id]);
}

// PRODUCTS CRUD (Mock/DB Products)
async function getProducts(activeOnly = false) {
  return [];
}

async function addProduct(product) {}
async function updateProduct(id, updateFields) {}
async function deleteProduct(id) {}

// INFORMATIONS CRUD
async function getInformations(activeOnly = false) {
  const sql = activeOnly ? 'SELECT * FROM informations WHERE active = 1 ORDER BY datetime(createdAt) DESC' : 'SELECT * FROM informations ORDER BY datetime(createdAt) DESC';
  const rows = await all(sql);
  return rows.map(i => ({ ...i, active: i.active !== 0 }));
}

async function addInformation(info) {
  await run(`
    INSERT INTO informations (id, title, contentTitle, content, date, time, active, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    info.id,
    info.title,
    info.contentTitle || '',
    info.content,
    info.date || '',
    info.time || '',
    info.active !== false ? 1 : 0,
    info.createdAt || new Date().toISOString()
  ]);
}

async function updateInformation(id, updateFields) {
  const updates = [];
  const params = [];
  for (const [k, v] of Object.entries(updateFields)) {
    if (['title', 'contentTitle', 'content', 'date', 'time', 'active'].includes(k)) {
      updates.push(`${k} = ?`);
      params.push(k === 'active' ? (v !== false ? 1 : 0) : v);
    }
  }
  if (updates.length > 0) {
    params.push(id);
    await run(`UPDATE informations SET ${updates.join(', ')} WHERE id = ?`, params);
  }
}

async function deleteInformation(id) {
  await run('DELETE FROM informations WHERE id = ?', [id]);
}

// PPOB VISIBILITY & MARKUP FUNCTIONS
async function getPpobVisibilityMap() {
  const rows = await all('SELECT * FROM ppob_visibility');
  const map = {};
  for (const r of rows) {
    map[r.sku] = {
      sku: r.sku,
      active: r.active !== 0,
      category: r.category || '',
      brand: r.brand || '',
      markup: Number(r.markup) || 0
    };
  }
  return map;
}

async function setPpobVisibility(sku, active, category = '', brand = '', markup = undefined) {
  if (!sku) return;
  const existing = await get('SELECT * FROM ppob_visibility WHERE sku = ?', [sku]);
  const newActive = active !== undefined && active !== null ? (active ? 1 : 0) : (existing ? existing.active : 1);
  const newCat = category || (existing ? existing.category : '');
  const newBrand = brand || (existing ? existing.brand : '');
  const newMarkup = markup !== undefined && markup !== null ? Number(markup) || 0 : (existing ? existing.markup : 0);

  await run(`
    INSERT INTO ppob_visibility (sku, active, category, brand, markup, updatedAt)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(sku) DO UPDATE SET
      active = excluded.active,
      category = excluded.category,
      brand = excluded.brand,
      markup = excluded.markup,
      updatedAt = CURRENT_TIMESTAMP;
  `, [sku, newActive, newCat, newBrand, newMarkup]);

  return {
    sku,
    active: newActive !== 0,
    category: newCat,
    brand: newBrand,
    markup: newMarkup
  };
}

module.exports = {
  initDb,
  getConfig,
  setConfig,
  getUser,
  getUserByUserId,
  getUserByEmail,
  getUserByWaContact,
  getAllUsersMap,
  createUser,
  updateUser,
  updateUsernameKey,
  deleteUser,
  purgeDatabase,
  addHistory,
  updateHistory,
  deleteHistory,
  getPayment,
  getAllPayments,
  addPayment,
  updatePaymentStatus,
  getWithdrawals,
  addWithdrawal,
  getWithdrawalByClientRequestId,
  findDuplicateWithdrawRequest,
  getBanners,
  addBanner,
  updateBanner,
  deleteBanner,
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  getInformations,
  addInformation,
  updateInformation,
  deleteInformation,
  getPpobVisibilityMap,
  setPpobVisibility
};
