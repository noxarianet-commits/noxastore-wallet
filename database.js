const path = require('path');
const fs = require('fs');

let sqlite3 = null;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (err) {
  console.warn('⚠️ [DB Warning] sqlite3 native module failed to load:', err.message);
  console.warn('⚠️ [DB Warning] Server will run smoothly in JSON File DB mode.');
}

const dbPath = path.join(__dirname, process.env.DATABASE_FILE || 'data.sqlite');
let dbInstance = null;

function readJSONFile(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJSONFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

const USERS_FILE = path.join(__dirname, 'users.json');
const BANNERS_FILE = path.join(__dirname, 'banners.json');
const INFORMATIONS_FILE = path.join(__dirname, 'informations.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const PAYMENTS_FILE = path.join(__dirname, 'payments.json');
const WITHDRAWALS_FILE = path.join(__dirname, 'withdrawals.json');
const PPOB_FILE = path.join(__dirname, 'ppob_visibility.json');
const PUSH_SUBS_FILE = path.join(__dirname, 'push_subscriptions.json');
const CHAT_FILE = path.join(__dirname, 'chat_messages.json');

function readJSONUsers() {
  return readJSONFile(USERS_FILE, []);
}

function writeJSONUsers(data) {
  writeJSONFile(USERS_FILE, data);
}

function getDb() {
  if (!sqlite3) return null;
  if (!dbInstance) {
    try {
      dbInstance = new sqlite3.Database(dbPath);
      dbInstance.configure('busyTimeout', 10000);
    } catch (e) {
      console.error('[DB Error] Failed to open SQLite DB:', e.message);
      dbInstance = null;
    }
  }
  return dbInstance;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    if (!db) return resolve({ lastID: Date.now(), changes: 1 });
    db.run(sql, params, function(err) {
      if (err) resolve(this || { lastID: Date.now(), changes: 0 });
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    if (!db) return resolve(null);
    db.get(sql, params, (err, row) => {
      if (err) resolve(null);
      else resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = getDb();
    if (!db) return resolve([]);
    db.all(sql, params, (err, rows) => {
      if (err) resolve([]);
      else resolve(rows || []);
    });
  });
}

function getWibDateTime(dateInput = new Date()) {
  const d = new Date(dateInput);
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  
  try {
    const formatterDate = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
    const formatterTime = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const dateStr = formatterDate.format(validDate).replace(/\./g, '');
    const timeStr = formatterTime.format(validDate).replace(/\./g, ':') + ' WIB';

    return {
      date: dateStr,
      time: timeStr,
      createdAt: validDate.toISOString()
    };
  } catch (e) {
    const pad = n => String(n).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return {
      date: `${pad(validDate.getDate())} ${months[validDate.getMonth()]} ${validDate.getFullYear()}`,
      time: `${pad(validDate.getHours())}:${pad(validDate.getMinutes())}:${pad(validDate.getSeconds())} WIB`,
      createdAt: validDate.toISOString()
    };
  }
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
      isSuspended INTEGER DEFAULT 0,
      suspendReason TEXT,
      lastIp TEXT,
      lastDevice TEXT,
      lastLocation TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Schema migrations
  try { await run('ALTER TABLE users ADD COLUMN isSuspended INTEGER DEFAULT 0'); } catch(e) {}
  try { await run('ALTER TABLE users ADD COLUMN suspendReason TEXT'); } catch(e) {}

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
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      sender TEXT NOT NULL,
      senderName TEXT,
      message TEXT NOT NULL,
      readStatus INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await run(`
    CREATE INDEX IF NOT EXISTS idx_chat_conversation ON chat_messages(conversationId);
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
  if (!sqlite3) {
    const configMap = readJSONFile(CONFIG_FILE, {});
    return configMap[key] !== undefined ? configMap[key] : null;
  }
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
  if (!sqlite3) {
    const configMap = readJSONFile(CONFIG_FILE, {});
    configMap[key] = value;
    writeJSONFile(CONFIG_FILE, configMap);
    return;
  }
  const strVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
  await run(`
    INSERT INTO app_config (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP;
  `, [key, strVal]);
}

// USER FUNCTIONS
async function getUser(username) {
  if (!username) return null;
  if (!sqlite3) {
    const users = readJSONUsers();
    const u = users.find(x => x.username === username || x.name === username || x.email === username);
    if (!u) return null;
    return {
      ...u,
      username: u.username || u.name,
      fullname: u.fullname || u.name || username,
      brand: u.brand || (u.fullname || u.name || username).toUpperCase(),
      email: u.email || '',
      saldo: u.saldo !== undefined ? u.saldo : (u.mainBalance || 0),
      mainBalance: u.mainBalance !== undefined ? u.mainBalance : (u.saldo || 0),
      qrisBalance: u.qrisBalance || 0,
      role: u.role || 'MEMBER',
      pin: u.pin || u.transactionPin || null,
      history: u.history || [],
      usedTransactions: [],
      usedRRNs: []
    };
  }

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
    isSuspended: !!(userRow.isSuspended === 1 || userRow.isSuspended === true),
    suspendReason: userRow.suspendReason || '',
    history: formattedHistory,
    usedTransactions: [],
    usedRRNs: []
  };
}

async function getUserByUserId(userId) {
  if (!userId) return null;
  if (!sqlite3) {
    const users = readJSONUsers();
    const u = users.find(x => x.userId === userId || x.id === userId);
    if (!u) return null;
    return await getUser(u.username || u.name);
  }
  const userRow = await get('SELECT username FROM users WHERE userId = ?', [userId]);
  if (!userRow) return null;
  return await getUser(userRow.username);
}

async function getUserByEmail(email) {
  if (!email) return null;
  const target = email.trim().toLowerCase();
  if (!sqlite3) {
    const users = readJSONUsers();
    const u = users.find(x => (x.email && x.email.trim().toLowerCase() === target) || (x.username && x.username.toLowerCase() === target));
    if (!u) return null;
    return await getUser(u.username || u.name);
  }
  const userRow = await get('SELECT username FROM users WHERE LOWER(email) = ?', [target]);
  if (!userRow) return null;
  return await getUser(userRow.username);
}

async function getUserByWaContact(waContact) {
  if (!waContact) return null;
  const rawStr = String(waContact).trim();
  const clean = rawStr.replace(/\D/g, '');

  if (!sqlite3) {
    const users = readJSONUsers();
    const u = users.find(x => {
      if (!x) return false;
      const xUname = String(x.username || x.name || '').trim();
      const xWa = String(x.waContact || '').trim();
      const xEmail = String(x.email || '').trim().toLowerCase();
      if (xUname.toLowerCase() === rawStr.toLowerCase()) return true;
      if (xEmail && xEmail === rawStr.toLowerCase()) return true;
      if (xWa && xWa === rawStr) return true;

      const uClean = xUname.replace(/\D/g, '');
      const waClean = xWa.replace(/\D/g, '');
      if (clean && (uClean === clean || waClean === clean)) return true;

      if (clean && clean.length >= 8) {
        const norm1 = clean.startsWith('62') ? '0' + clean.slice(2) : clean;
        const norm2 = clean.startsWith('0') ? '62' + clean.slice(1) : clean;
        const target1 = uClean.startsWith('62') ? '0' + uClean.slice(2) : uClean;
        const target2 = waClean.startsWith('62') ? '0' + waClean.slice(2) : waClean;
        if (norm1 === target1 || norm1 === target2 || norm2 === target1 || norm2 === target2) return true;
      }
      return false;
    });
    if (!u) return null;
    return await getUser(u.username || u.name);
  }

  const clean08 = clean.startsWith('62') ? '0' + clean.slice(2) : clean;
  const clean62 = clean.startsWith('0') ? '62' + clean.slice(1) : clean;
  const userRow = await get(
    'SELECT username FROM users WHERE username = ? OR username = ? OR username = ? OR waContact = ? OR waContact = ? OR REPLACE(waContact, "+", "") = ? OR LOWER(email) = ?',
    [rawStr, clean08, clean62, clean08, clean62, clean, rawStr.toLowerCase()]
  );
  if (!userRow) return null;
  return await getUser(userRow.username);
}

async function getAllUsersMap() {
  if (!sqlite3) {
    const users = readJSONUsers();
    const map = {};
    for (const u of users) {
      const uname = u.username || u.name;
      if (uname) {
        map[uname] = await getUser(uname);
      }
    }
    return map;
  }
  const users = await all('SELECT * FROM users');
  const map = {};
  for (const u of users) {
    map[u.username] = await getUser(u.username);
  }
  return map;
}

async function createUser(userData) {
  const { username, fullname, brand, password, userId, email, waContact, mainBalance, role, lastIp, lastDevice, lastLocation } = userData;
  const uName = String(username || '').trim();
  const cleanEmail = String(email || '').trim();
  const cleanWa = String(waContact || uName).trim();

  if (!sqlite3) {
    const users = readJSONUsers();
    let userIdx = users.findIndex(x => (x.username && x.username === uName) || (x.name && x.name === uName) || (cleanEmail && x.email && x.email.toLowerCase() === cleanEmail.toLowerCase()));
    const formattedObj = {
      id: userIdx >= 0 ? users[userIdx].id : users.length + 1,
      username: uName,
      name: fullname || uName,
      fullname: fullname || uName,
      brand: brand || (fullname ? fullname.toUpperCase() : uName),
      password: password || '',
      email: cleanEmail || `${uName}@noxa.com`,
      waContact: cleanWa,
      saldo: mainBalance || 0,
      mainBalance: mainBalance || 0,
      qrisBalance: 0,
      role: role || 'MEMBER',
      created_at: new Date().toISOString()
    };

    if (userIdx >= 0) {
      users[userIdx] = { ...users[userIdx], ...formattedObj };
    } else {
      users.push(formattedObj);
    }
    writeJSONUsers(users);
    return await getUser(uName);
  }

  try {
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
      cleanEmail || '',
      cleanWa,
      mainBalance || 0,
      role || 'MEMBER',
      lastIp || null,
      lastDevice || null,
      lastLocation || null
    ]);
  } catch (err) {
    console.error('[DB Create User SQLite Error]', err.message);
  }

  // Backup sync to JSON DB
  try {
    const users = readJSONUsers();
    let userIdx = users.findIndex(x => x.username === uName);
    const formattedObj = {
      id: userIdx >= 0 ? users[userIdx].id : users.length + 1,
      username: uName,
      name: fullname || uName,
      fullname: fullname || uName,
      brand: brand || (fullname ? fullname.toUpperCase() : uName),
      password: password || '',
      email: cleanEmail || `${uName}@noxa.com`,
      waContact: cleanWa,
      saldo: mainBalance || 0,
      mainBalance: mainBalance || 0,
      qrisBalance: 0,
      role: role || 'MEMBER',
      created_at: new Date().toISOString()
    };
    if (userIdx >= 0) {
      users[userIdx] = { ...users[userIdx], ...formattedObj };
    } else {
      users.push(formattedObj);
    }
    writeJSONUsers(users);
  } catch (e) {}

  return await getUser(uName);
}

async function updateUser(username, updateFields) {
  if (!username) return;
  if (!sqlite3) {
    const users = readJSONUsers();
    const idx = users.findIndex(u => u.username === username || u.name === username);
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...updateFields };
      if (updateFields.saldo !== undefined) users[idx].mainBalance = updateFields.saldo;
      if (updateFields.mainBalance !== undefined) users[idx].saldo = updateFields.mainBalance;
      writeJSONUsers(users);
    }
    return;
  }

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
    isSuspended: 'isSuspended',
    suspended: 'isSuspended',
    suspendReason: 'suspendReason',
    reason: 'suspendReason',
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
      if (col === 'isSuspended') {
        params.push(v === true || v === 'true' || v === 1 ? 1 : 0);
      } else {
        params.push(v);
      }
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
  if (!sqlite3) {
    const users = readJSONUsers();
    const idx = users.findIndex(u => u.username === oldUsername || u.name === oldUsername);
    if (idx !== -1) {
      users[idx].username = newUsername;
      users[idx].name = newUsername;
      users[idx].waContact = newUsername;
      writeJSONUsers(users);
    }
    return;
  }
  await run('UPDATE users SET username = ?, waContact = ? WHERE username = ?', [newUsername, newUsername, oldUsername]);
  await run('UPDATE transactions SET username = ? WHERE username = ?', [newUsername, oldUsername]);
  await run('UPDATE payments SET username = ? WHERE username = ?', [newUsername, oldUsername]);
  await run('UPDATE withdrawals SET username = ? WHERE username = ?', [newUsername, oldUsername]);
}

async function deleteUser(username) {
  if (!username) return;
  if (!sqlite3) {
    let users = readJSONUsers();
    users = users.filter(u => u.username !== username && u.name !== username);
    writeJSONUsers(users);
    return;
  }
  await run('DELETE FROM users WHERE username = ?', [username]);
  await run('DELETE FROM transactions WHERE username = ?', [username]);
  await run('DELETE FROM payments WHERE username = ?', [username]);
  await run('DELETE FROM withdrawals WHERE username = ?', [username]);
}

async function purgeDatabase() {
  if (!sqlite3) {
    writeJSONUsers([]);
    writeJSONFile(BANNERS_FILE, []);
    writeJSONFile(INFORMATIONS_FILE, []);
    writeJSONFile(CONFIG_FILE, {});
    writeJSONFile(PAYMENTS_FILE, []);
    writeJSONFile(WITHDRAWALS_FILE, []);
    writeJSONFile(PPOB_FILE, {});
    return;
  }
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

  if (!sqlite3) {
    const users = readJSONUsers();
    let idx = users.findIndex(u => u.username === username || u.name === username);
    if (idx === -1) {
      await createUser({ username: username });
      return await addHistory(username, record);
    }
    const wib = getWibDateTime(record.createdAt || new Date());
    const txId = record.id || `H-${Date.now()}`;
    const basePrice = record.base_price !== undefined ? record.base_price : (record.amount - (record.adminFee || record.markup || 0));
    const adminFee = record.adminFee !== undefined ? record.adminFee : (record.markup || 0);
    const markup = record.markup !== undefined ? record.markup : (record.adminFee || 0);

    const txItem = {
      id: txId,
      username: username,
      orderId: record.orderId || '',
      merchant: record.merchant || record.product_name || '',
      product_name: record.product_name || record.merchant || '',
      target: record.target || record.phoneNumber || record.noTujuan || '',
      account_name: record.account_name || '',
      base_price: Math.ceil(Number(basePrice) || 0),
      adminFee: Math.ceil(Number(adminFee) || 0),
      markup: Math.ceil(Number(markup) || 0),
      amount: Math.ceil(Number(record.amount) || 0),
      status: record.status || '',
      type: record.type || '',
      sn: record.sn || record.product_license || record.license || '',
      product_license: record.product_license || record.license || record.sn || '',
      note: record.note || record.sn || record.product_license || '',
      failureReason: record.failureReason || record.apiMessage || '',
      rawResponse: record.rawResponse || null,
      apiMessage: record.apiMessage || record.failureReason || '',
      balanceRefunded: !!record.balanceRefunded,
      date: record.date || wib.date,
      time: record.time || wib.time,
      createdAt: record.createdAt || wib.createdAt
    };

    if (!users[idx].history || !Array.isArray(users[idx].history)) {
      users[idx].history = [];
    }

    const hIdx = users[idx].history.findIndex(h => h.id === txId || (record.orderId && h.orderId === record.orderId));
    if (hIdx !== -1) {
      users[idx].history[hIdx] = { ...users[idx].history[hIdx], ...txItem };
    } else {
      users[idx].history.unshift(txItem);
    }
    writeJSONUsers(users);
    return;
  }

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
  if (!sqlite3) {
    const users = readJSONUsers();
    let updated = false;
    for (let u of users) {
      if (u.history && Array.isArray(u.history)) {
        const idx = u.history.findIndex(h => h.id === id || h.orderId === id);
        if (idx !== -1) {
          u.history[idx] = { ...u.history[idx], ...updateFields };
          updated = true;
        }
      }
    }
    if (updated) writeJSONUsers(users);
    return;
  }
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
  if (!sqlite3) {
    const users = readJSONUsers();
    const idx = users.findIndex(u => u.username === username || u.name === username);
    if (idx !== -1 && users[idx].history) {
      users[idx].history = users[idx].history.filter(h => h.id !== txId);
      writeJSONUsers(users);
    }
    return;
  }
  await run('DELETE FROM transactions WHERE id = ? AND username = ?', [txId, username]);
}

// PAYMENTS FUNCTIONS
async function getPayment(id) {
  if (!id) return null;
  if (!sqlite3) {
    const payments = readJSONFile(PAYMENTS_FILE, []);
    return payments.find(p => p.id === id || p.idDepo === id) || null;
  }
  return await get('SELECT * FROM payments WHERE id = ? OR idDepo = ?', [id, id]);
}

async function getAllPayments() {
  if (!sqlite3) {
    return readJSONFile(PAYMENTS_FILE, []);
  }
  return await all('SELECT * FROM payments ORDER BY datetime(createdAt) DESC');
}

async function addPayment(payment) {
  if (!payment || !payment.id) return;
  if (!sqlite3) {
    const payments = readJSONFile(PAYMENTS_FILE, []);
    const idx = payments.findIndex(p => p.id === payment.id || (payment.idDepo && p.idDepo === payment.idDepo));
    const newItem = {
      id: payment.id,
      idDepo: payment.idDepo || null,
      username: payment.username || '',
      amount: Math.ceil(Number(payment.amount) || 0),
      nominalTotal: Math.ceil(Number(payment.nominalTotal) || Number(payment.amount) || 0),
      status: payment.status || 'PENDING',
      paymentUrl: payment.paymentUrl || '',
      qrUrl: payment.qrUrl || '',
      createdAt: payment.createdAt || new Date().toISOString(),
      updatedAt: payment.updatedAt || new Date().toISOString()
    };
    if (idx !== -1) {
      payments[idx] = { ...payments[idx], ...newItem };
    } else {
      payments.unshift(newItem);
    }
    writeJSONFile(PAYMENTS_FILE, payments);
    return;
  }
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
  if (!sqlite3) {
    const payments = readJSONFile(PAYMENTS_FILE, []);
    const idx = payments.findIndex(p => p.id === id || p.idDepo === id);
    if (idx !== -1) {
      payments[idx].status = status;
      payments[idx].updatedAt = updateTime;
      writeJSONFile(PAYMENTS_FILE, payments);
    }
    return;
  }
  await run('UPDATE payments SET status = ?, updatedAt = ? WHERE id = ? OR idDepo = ?', [status, updateTime, id, id]);
}

// WITHDRAWALS FUNCTIONS
async function getWithdrawals() {
  if (!sqlite3) {
    return readJSONFile(WITHDRAWALS_FILE, []);
  }
  const rows = await all('SELECT * FROM withdrawals ORDER BY datetime(createdAt) DESC');
  return rows.map(w => ({
    ...w,
    balanceRefunded: !!w.balanceRefunded,
    rawResponse: w.rawResponse ? (() => { try { return JSON.parse(w.rawResponse); } catch(e) { return w.rawResponse; } })() : null
  }));
}

async function addWithdrawal(w) {
  if (!w || !w.id) return;
  if (!sqlite3) {
    const withdrawals = readJSONFile(WITHDRAWALS_FILE, []);
    const idx = withdrawals.findIndex(x => x.id === w.id);
    const newItem = {
      ...w,
      balanceRefunded: !!w.balanceRefunded
    };
    if (idx !== -1) {
      withdrawals[idx] = { ...withdrawals[idx], ...newItem };
    } else {
      withdrawals.unshift(newItem);
    }
    writeJSONFile(WITHDRAWALS_FILE, withdrawals);
    return;
  }

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
  if (!sqlite3) {
    const withdrawals = readJSONFile(WITHDRAWALS_FILE, []);
    return withdrawals.find(w => w.clientRequestId === clientRequestId) || null;
  }
  const w = await get('SELECT * FROM withdrawals WHERE clientRequestId = ?', [clientRequestId]);
  if (!w) return null;
  return {
    ...w,
    balanceRefunded: !!w.balanceRefunded
  };
}

async function findDuplicateWithdrawRequest(username, amount, destination, method) {
  if (!sqlite3) {
    const withdrawals = readJSONFile(WITHDRAWALS_FILE, []);
    const now = Date.now();
    const row = withdrawals.find(w =>
      w.username === username &&
      w.destination === destination &&
      Number(w.amount) === Number(amount) &&
      String(w.method || '').toUpperCase() === String(method || '').toUpperCase() &&
      (w.status === 'DIPROSES' || w.gatewayStatus === 'PROCESS') &&
      w.createdAt && (now - new Date(w.createdAt).getTime()) < 30000
    );
    return row || null;
  }

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
  if (!sqlite3) {
    const banners = readJSONFile(BANNERS_FILE, []);
    if (activeOnly) return banners.filter(b => b.active);
    return banners;
  }
  const sql = activeOnly ? 'SELECT * FROM banners WHERE active = 1 ORDER BY datetime(createdAt) DESC' : 'SELECT * FROM banners ORDER BY datetime(createdAt) DESC';
  const rows = await all(sql);
  return rows.map(b => ({ ...b, active: b.active !== 0 }));
}

async function addBanner(banner) {
  if (!sqlite3) {
    const banners = readJSONFile(BANNERS_FILE, []);
    const newItem = {
      id: banner.id || `BAN-${Date.now()}`,
      title: banner.title || 'Banner Promo',
      imageUrl: banner.imageUrl || '',
      link: banner.link || '',
      active: banner.active !== false,
      createdAt: banner.createdAt || new Date().toISOString()
    };
    banners.unshift(newItem);
    writeJSONFile(BANNERS_FILE, banners);
    return;
  }
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
  if (!sqlite3) {
    const banners = readJSONFile(BANNERS_FILE, []);
    const idx = banners.findIndex(b => b.id === id);
    if (idx !== -1) {
      banners[idx] = { ...banners[idx], ...updateFields };
      if (updateFields.active !== undefined) banners[idx].active = updateFields.active !== false;
      writeJSONFile(BANNERS_FILE, banners);
    }
    return;
  }
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
  if (!sqlite3) {
    let banners = readJSONFile(BANNERS_FILE, []);
    banners = banners.filter(b => b.id !== id);
    writeJSONFile(BANNERS_FILE, banners);
    return;
  }
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
  if (!sqlite3) {
    const informations = readJSONFile(INFORMATIONS_FILE, []);
    if (activeOnly) return informations.filter(i => i.active);
    return informations;
  }
  const sql = activeOnly ? 'SELECT * FROM informations WHERE active = 1 ORDER BY datetime(createdAt) DESC' : 'SELECT * FROM informations ORDER BY datetime(createdAt) DESC';
  const rows = await all(sql);
  return rows.map(i => ({ ...i, active: i.active !== 0 }));
}

async function addInformation(info) {
  if (!sqlite3) {
    const informations = readJSONFile(INFORMATIONS_FILE, []);
    const newItem = {
      id: info.id || `INF-${Date.now()}`,
      title: info.title || 'Pengumuman',
      contentTitle: info.contentTitle || info.title || 'Info Terbaru',
      content: info.content || '',
      date: info.date || '',
      time: info.time || '',
      active: info.active !== false,
      createdAt: info.createdAt || new Date().toISOString()
    };
    informations.unshift(newItem);
    writeJSONFile(INFORMATIONS_FILE, informations);
    return;
  }
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
  if (!sqlite3) {
    const informations = readJSONFile(INFORMATIONS_FILE, []);
    const idx = informations.findIndex(i => i.id === id);
    if (idx !== -1) {
      informations[idx] = { ...informations[idx], ...updateFields };
      if (updateFields.active !== undefined) informations[idx].active = updateFields.active !== false;
      writeJSONFile(INFORMATIONS_FILE, informations);
    }
    return;
  }
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
  if (!sqlite3) {
    let informations = readJSONFile(INFORMATIONS_FILE, []);
    informations = informations.filter(i => i.id !== id);
    writeJSONFile(INFORMATIONS_FILE, informations);
    return;
  }
  await run('DELETE FROM informations WHERE id = ?', [id]);
}

// PPOB VISIBILITY & MARKUP FUNCTIONS
async function getPpobVisibilityMap() {
  const map = {};
  if (!sqlite3) {
    const rawMap = readJSONFile(PPOB_FILE, {});
    for (const [k, v] of Object.entries(rawMap)) {
      const rawSku = String(k || '').trim();
      const sklSku = rawSku.startsWith('SKL-') ? rawSku : `SKL-${rawSku}`;
      const numSku = rawSku.replace(/^SKL-/, '');
      const entry = {
        sku: sklSku,
        active: v.active !== false,
        category: v.category || '',
        brand: v.brand || '',
        markup: Math.max(0, Math.ceil(Number(v.markup) || 0))
      };
      const existing = map[sklSku];
      if (!existing || entry.markup >= existing.markup) {
        map[rawSku] = entry;
        map[sklSku] = entry;
        map[numSku] = entry;
      }
    }
    return map;
  }

  const rows = await all('SELECT * FROM ppob_visibility');
  for (const r of rows) {
    const rawSku = String(r.sku || '').trim();
    const sklSku = rawSku.startsWith('SKL-') ? rawSku : `SKL-${rawSku}`;
    const numSku = rawSku.replace(/^SKL-/, '');
    const entry = {
      sku: sklSku,
      active: r.active !== 0,
      category: r.category || '',
      brand: r.brand || '',
      markup: Math.max(0, Math.ceil(Number(r.markup) || 0))
    };

    const existing = map[sklSku];
    if (!existing || entry.markup >= existing.markup) {
      map[rawSku] = entry;
      map[sklSku] = entry;
      map[numSku] = entry;
    }
  }
  return map;
}

async function setPpobVisibility(sku, active, category = '', brand = '', markup = undefined) {
  if (!sku) return;
  const rawSku = String(sku).trim();
  const sklSku = rawSku.startsWith('SKL-') ? rawSku : `SKL-${rawSku}`;
  const numSku = rawSku.replace(/^SKL-/, '');

  const existingMap = await getPpobVisibilityMap();
  const existing = existingMap[sklSku] || existingMap[numSku] || existingMap[rawSku] || {};

  const newActive = active !== undefined && active !== null ? (active ? true : false) : (existing.active !== undefined ? existing.active : true);
  const newCat = category || existing.category || '';
  const newBrand = brand || existing.brand || '';
  const newMarkup = markup !== undefined && markup !== null ? Math.max(0, Math.ceil(Number(markup) || 0)) : (existing.markup || 0);

  if (!sqlite3) {
    const map = readJSONFile(PPOB_FILE, {});
    const val = {
      sku: sklSku,
      active: newActive,
      category: newCat,
      brand: newBrand,
      markup: newMarkup
    };

    map[sklSku] = val;
    map[numSku] = val;
    map[rawSku] = val;
    writeJSONFile(PPOB_FILE, map);
    return val;
  }

  // Clean duplicate non-canonical SKU rows first
  await run('DELETE FROM ppob_visibility WHERE sku = ? OR sku = ? OR sku = ?', [sklSku, numSku, rawSku]);

  // Insert canonical row
  await run(`
    INSERT INTO ppob_visibility (sku, active, category, brand, markup, updatedAt)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `, [sklSku, newActive ? 1 : 0, newCat, newBrand, newMarkup]);

  return {
    sku: sklSku,
    active: newActive,
    category: newCat,
    brand: newBrand,
    markup: newMarkup
  };
}

async function bulkSetPpobMarkup(skus, markup) {
  const numMarkup = Math.max(0, Math.ceil(Number(markup) || 0));
  const visMap = await getPpobVisibilityMap();
  let targetSkus = skus;

  if (!targetSkus || targetSkus === 'ALL' || (Array.isArray(targetSkus) && targetSkus.length === 0)) {
    targetSkus = Object.keys(visMap);
  }

  if (!Array.isArray(targetSkus) || targetSkus.length === 0) {
    return { updatedCount: 0, markup: numMarkup };
  }

  let updatedCount = 0;
  for (const rawSku of targetSkus) {
    if (!rawSku) continue;
    const sklSku = rawSku.startsWith('SKL-') ? rawSku : `SKL-${rawSku}`;
    const numSku = rawSku.replace(/^SKL-/, '');
    const existing = visMap[sklSku] || visMap[numSku] || visMap[rawSku] || {};
    const newActive = existing.active !== false;
    const newCat = existing.category || '';
    const newBrand = existing.brand || '';

    if (!sqlite3) {
      const map = readJSONFile(PPOB_FILE, {});
      const val = { sku: sklSku, active: newActive, category: newCat, brand: newBrand, markup: numMarkup };
      map[sklSku] = val;
      map[numSku] = val;
      map[rawSku] = val;
      writeJSONFile(PPOB_FILE, map);
    } else {
      await run('DELETE FROM ppob_visibility WHERE sku = ? OR sku = ? OR sku = ?', [sklSku, numSku, rawSku]);
      await run(`
        INSERT INTO ppob_visibility (sku, active, category, brand, markup, updatedAt)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [sklSku, newActive ? 1 : 0, newCat, newBrand, numMarkup]);
    }
    updatedCount++;
  }

  return { updatedCount, markup: numMarkup };
}

// WEB PUSH SUBSCRIPTIONS
async function savePushSubscription(username, subscription) {
  if (!subscription || !subscription.endpoint) return;
  let subs = readJSONFile(PUSH_SUBS_FILE, []);
  const uName = String(username || 'guest').toLowerCase();

  // Keep strictly 1 active subscription entry per physical endpoint
  subs = subs.filter(s => s.endpoint !== subscription.endpoint);

  subs.push({
    username: uName,
    endpoint: subscription.endpoint,
    keys: subscription.keys || {},
    updatedAt: new Date().toISOString()
  });

  writeJSONFile(PUSH_SUBS_FILE, subs);
}

async function getPushSubscriptions(username = 'all') {
  const subs = readJSONFile(PUSH_SUBS_FILE, []);
  if (!username || username === 'all') {
    const map = new Map();
    subs.forEach(s => { if (s && s.endpoint) map.set(s.endpoint, s); });
    return Array.from(map.values());
  }
  const targetLower = String(username).toLowerCase();
  // Filter STRICTLY for subscriptions registered to this exact target username
  const matched = subs.filter(s => String(s.username || '').toLowerCase() === targetLower);
  const map = new Map();
  matched.forEach(s => { if (s && s.endpoint) map.set(s.endpoint, s); });
  return Array.from(map.values());
}

async function removePushSubscription(endpoint) {
  if (!endpoint) return;
  let subs = readJSONFile(PUSH_SUBS_FILE, []);
  subs = subs.filter(s => s.endpoint !== endpoint);
  writeJSONFile(PUSH_SUBS_FILE, subs);
}

// ============================================
// LIVE CHAT MESSAGE FUNCTIONS
// ============================================
async function saveChatMessage({ conversationId, sender, senderName, message }) {
  if (!conversationId || !message) return null;
  const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowISO = new Date().toISOString();
  const msgObj = {
    id,
    conversationId: String(conversationId).trim(),
    sender: sender === 'cs' ? 'cs' : 'user',
    senderName: senderName || (sender === 'cs' ? 'Customer Service' : conversationId),
    message: String(message).trim(),
    readStatus: 0,
    createdAt: nowISO
  };

  if (!sqlite3) {
    const list = readJSONFile(CHAT_FILE, []);
    list.push(msgObj);
    writeJSONFile(CHAT_FILE, list);
    return msgObj;
  }

  await run(`
    INSERT INTO chat_messages (id, conversationId, sender, senderName, message, readStatus, createdAt)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `, [msgObj.id, msgObj.conversationId, msgObj.sender, msgObj.senderName, msgObj.message, msgObj.createdAt]);

  return msgObj;
}

async function getChatHistory(conversationId) {
  if (!conversationId) return [];
  const cId = String(conversationId).trim();
  if (!sqlite3) {
    const list = readJSONFile(CHAT_FILE, []);
    return list.filter(m => String(m.conversationId).trim() === cId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }
  const rows = await all('SELECT * FROM chat_messages WHERE conversationId = ? ORDER BY createdAt ASC', [cId]);
  return rows || [];
}

async function getAllConversationsSummary() {
  let messages = [];

  if (!sqlite3) {
    messages = readJSONFile(CHAT_FILE, []);
  } else {
    messages = await all('SELECT * FROM chat_messages ORDER BY createdAt ASC') || [];
  }

  const convMap = {};
  for (const m of messages) {
    const cId = String(m.conversationId).trim();
    if (!convMap[cId]) {
      const user = (await getUser(cId)) || {};
      convMap[cId] = {
        conversationId: cId,
        username: user.username || cId,
        fullname: user.fullname || user.name || (user.brand ? user.brand : cId),
        waContact: user.waContact || user.username || cId,
        brand: user.brand || '',
        mainBalance: user.mainBalance !== undefined ? user.mainBalance : (user.saldo !== undefined ? user.saldo : 0),
        role: user.role || 'MEMBER',
        status: user.status || 'active',
        isSuspended: user.isSuspended === true,
        lastMessage: '',
        lastMessageSender: '',
        lastMessageTime: '',
        unreadCount: 0,
        totalMessages: 0
      };
    }

    convMap[cId].lastMessage = m.message;
    convMap[cId].lastMessageSender = m.sender;
    convMap[cId].lastMessageTime = m.createdAt;
    convMap[cId].totalMessages += 1;

    if (m.sender === 'user' && (m.readStatus === 0 || m.readStatus === '0')) {
      convMap[cId].unreadCount += 1;
    }
  }

  const summaries = Object.values(convMap);
  summaries.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
  return summaries;
}

async function markConversationAsRead(conversationId, readerType = 'cs') {
  if (!conversationId) return;
  const cId = String(conversationId).trim();
  const targetSender = readerType === 'cs' ? 'user' : 'cs';

  if (!sqlite3) {
    const list = readJSONFile(CHAT_FILE, []);
    let changed = false;
    for (const m of list) {
      if (String(m.conversationId).trim() === cId && m.sender === targetSender && (m.readStatus === 0 || m.readStatus === '0')) {
        m.readStatus = 1;
        changed = true;
      }
    }
    if (changed) writeJSONFile(CHAT_FILE, list);
    return;
  }

  await run('UPDATE chat_messages SET readStatus = 1 WHERE conversationId = ? AND sender = ?', [cId, targetSender]);
}

async function deleteConversationMessages(conversationId) {
  if (!conversationId) return false;
  const cId = String(conversationId).trim();
  if (!sqlite3) {
    let list = readJSONFile(CHAT_FILE, []);
    list = list.filter(m => String(m.conversationId).trim() !== cId);
    writeJSONFile(CHAT_FILE, list);
    return true;
  }
  await run('DELETE FROM chat_messages WHERE conversationId = ?', [cId]);
  return true;
}

async function deleteSingleChatMessage(messageId) {
  if (!messageId) return false;
  const mId = String(messageId).trim();
  if (!sqlite3) {
    let list = readJSONFile(CHAT_FILE, []);
    list = list.filter(m => String(m.id).trim() !== mId);
    writeJSONFile(CHAT_FILE, list);
    return true;
  }
  await run('DELETE FROM chat_messages WHERE id = ?', [mId]);
  return true;
}

async function autoCleanupOldChatMessages(days = 5) {
  try {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    let deletedCount = 0;
    if (!sqlite3) {
      let list = readJSONFile(CHAT_FILE, []);
      const initialCount = list.length;
      list = list.filter(m => {
        if (!m.createdAt) return false;
        return new Date(m.createdAt).getTime() >= (Date.now() - days * 24 * 60 * 60 * 1000);
      });
      deletedCount = initialCount - list.length;
      if (deletedCount > 0) {
        writeJSONFile(CHAT_FILE, list);
      }
    } else {
      const res = await run('DELETE FROM chat_messages WHERE datetime(createdAt) <= datetime(?) OR createdAt < ?', [cutoffDate, cutoffDate]);
      deletedCount = res && res.changes ? res.changes : 0;
    }
    if (deletedCount > 0) {
      console.log(`[CS Chat Auto-Cleanup] Berhasil menghapus ${deletedCount} pesan chat CS yang lebih dari ${days} hari.`);
    }
    return deletedCount;
  } catch (err) {
    console.error('[CS Chat Auto-Cleanup Error]:', err.message);
    return 0;
  }
}

async function setUserSuspension(username, isSuspended, reason = '') {
  if (!username) return null;
  const target = String(username).trim();
  const suspVal = isSuspended ? 1 : 0;
  const suspReason = String(reason || '').trim();

  if (!sqlite3) {
    let users = readJSONUsers();
    const idx = users.findIndex(u => u.username === target || u.name === target);
    if (idx !== -1) {
      users[idx].isSuspended = isSuspended;
      users[idx].suspendReason = suspReason;
      writeJSONUsers(users);
      return await getUser(target);
    }
    return null;
  }

  await run('UPDATE users SET isSuspended = ?, suspendReason = ?, updatedAt = CURRENT_TIMESTAMP WHERE username = ?', [suspVal, suspReason, target]);

  // Sync to JSON cache
  try {
    let users = readJSONUsers();
    const idx = users.findIndex(u => u.username === target || u.name === target);
    if (idx !== -1) {
      users[idx].isSuspended = isSuspended;
      users[idx].suspendReason = suspReason;
      writeJSONUsers(users);
    }
  } catch (e) {}

  return await getUser(target);
}

module.exports = {
  initDb,
  getWibDateTime,
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
  setPpobVisibility,
  bulkSetPpobMarkup,
  savePushSubscription,
  getPushSubscriptions,
  removePushSubscription,
  saveChatMessage,
  getChatHistory,
  getAllConversationsSummary,
  markConversationAsRead,
  deleteConversationMessages,
  deleteSingleChatMessage,
  autoCleanupOldChatMessages,
  setUserSuspension
};
