// API única de la app: POST /api  { action, ...datos }
// Roles: "enfermera" (secciones I-IV, se auto-registra con un código) y
// "doctor" (además la sección V; sus cuentas las asigna la clínica por variable de entorno, no se auto-registran).
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const env = process.env;
const USE_MEMORY = env.USE_MEMORY === '1';
const JWT_SECRET = env.JWT_SECRET || (USE_MEMORY ? 'dev-secret-only' : '');
const CODES = { enfermera: env.NURSE_CODE || (USE_MEMORY ? 'enfermera123' : '') };

// Acepta el link completo de la hoja (https://docs.google.com/spreadsheets/d/ID/edit)
// o solo el ID, para que se pueda pegar el link tal cual en SHEET_ID.
function extractSheetId(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : s;
}
const SHEET_ID = extractSheetId(env.SHEET_ID);

// Cuentas de doctor(a): las asigna la clínica por variable de entorno, no se auto-registran.
// Formato: usuario:contraseña:Nombre completo — varias cuentas separadas por ";" o saltos de línea.
function doctorAccounts() {
  let raw = env.DOCTOR_ACCOUNTS;
  if (!raw && USE_MEMORY) raw = 'doctor:doctor1234:Doctora Demo';
  return String(raw || '').split(/[\n;]+/).map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [usuario, password, ...rest] = entry.split(':');
    return { usuario: norm(usuario), password: (password || '').trim(), nombre: (rest.join(':').trim() || usuario || '').trim() };
  }).filter((a) => a.usuario && a.password);
}
// Comparación de tiempo constante (evita filtrar la contraseña por tiempos de respuesta).
function safeEqual(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) { crypto.timingSafeEqual(a, a); return false; }
  return crypto.timingSafeEqual(a, b);
}

// ───────────────────────── Esquema de las hojas ─────────────────────────
const SCHEMA = {
  Usuarios: ['id', 'nombre', 'usuario', 'rol', 'hash', 'creado'],
  Pacientes: [
    'id', 'apellidos_nombres', 'fecha_nacimiento', 'sexo', 'ocupacion', 'direccion',
    'lugar_nacimiento', 'dni', 'email', 'estado_civil', 'familiar_responsable',
    'fecha_inscripcion', 'como_se_entero', 'creado_por', 'creado',
  ],
  // Cada visita = una "hoja" de historia clínica: secciones II, III y IV
  Visitas: ['id', 'paciente_id', 'fecha', 'antecedentes', 'familiares', 'vitales', 'registrado_por', 'creado'],
  // Sección V (solo doctor), ligada a una visita — solo texto, sin montos
  Tratamientos: ['id', 'visita_id', 'paciente_id', 'diagnostico', 'sesiones', 'doctor', 'actualizado'],
};
const JSON_COLS = new Set(['antecedentes', 'familiares', 'vitales', 'sesiones']);

// ───────────────────────── Almacenamiento ─────────────────────────
const memory = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []]));
const memoryStore = {
  async all(tab) { return memory[tab].map((r) => ({ ...r })); },
  async append(tab, row) { memory[tab].push({ ...row }); },
  async update(tab, id, row) {
    const i = memory[tab].findIndex((r) => r.id === id);
    if (i < 0) throw new Error('Registro no encontrado');
    memory[tab][i] = { ...row };
  },
};

let sheetsReady;
function sheetsStore() {
  const { JWT } = require('google-auth-library');
  const client = new JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;

  async function call(path, method = 'GET', body) {
    const { token } = await client.getAccessToken();
    const r = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Google Sheets: ${j.error?.message || r.status}`);
    return j;
  }

  // Crea las pestañas y cabeceras la primera vez
  async function ensure() {
    const meta = await call('?fields=sheets.properties.title');
    const have = new Set(meta.sheets.map((s) => s.properties.title));
    const missing = Object.keys(SCHEMA).filter((t) => !have.has(t));
    if (missing.length) {
      await call(':batchUpdate', 'POST', {
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      });
    }
    for (const [tab, cols] of Object.entries(SCHEMA)) {
      const head = await call(`/values/${tab}!1:1`);
      if (!head.values || !head.values[0]) {
        await call(`/values/${tab}!A1?valueInputOption=RAW`, 'PUT', { values: [cols] });
      }
    }
  }
  const ready = () => (sheetsReady ||= ensure().catch((e) => { sheetsReady = null; throw e; }));

  const toRow = (tab, obj) => SCHEMA[tab].map((c) => (obj[c] ?? '') + '');
  const fromRow = (tab, arr) => Object.fromEntries(SCHEMA[tab].map((c, i) => [c, arr[i] ?? '']));

  return {
    async all(tab) {
      await ready();
      const j = await call(`/values/${tab}!A2:Z`);
      return (j.values || []).map((r) => fromRow(tab, r));
    },
    async append(tab, row) {
      await ready();
      await call(`/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, 'POST', {
        values: [toRow(tab, row)],
      });
    },
    async update(tab, id, row) {
      await ready();
      const j = await call(`/values/${tab}!A2:A`);
      const idx = (j.values || []).findIndex((r) => r[0] === id);
      if (idx < 0) throw new Error('Registro no encontrado');
      await call(`/values/${tab}!A${idx + 2}?valueInputOption=RAW`, 'PUT', { values: [toRow(tab, row)] });
    },
  };
}

let sheets;
const db = () => (USE_MEMORY ? memoryStore : (sheets ||= sheetsStore()));

// Las columnas JSON se guardan como texto
const decode = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => {
  if (!JSON_COLS.has(k)) return [k, v];
  try { return [k, v ? JSON.parse(v) : (k === 'sesiones' ? [] : {})]; } catch { return [k, k === 'sesiones' ? [] : {}]; }
}));
const encode = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, JSON_COLS.has(k) ? JSON.stringify(v) : v]));

// ───────────────────────── Seguridad ─────────────────────────
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(pw, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
async function checkPassword(pw, stored) {
  const [salt, hex] = (stored || '').split(':');
  if (!salt || !hex) return false;
  const key = await scrypt(pw, salt, 64);
  const a = Buffer.from(hex, 'hex');
  return a.length === key.length && crypto.timingSafeEqual(a, key);
}
const b64 = (b) => Buffer.from(b).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');
function signToken(payload) {
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + 12 * 3600 * 1000 }));
  return `${body}.${mac(body)}`;
}
function verifyToken(token) {
  const [body, sig] = (token || '').split('.');
  if (!body || !sig) return null;
  const good = mac(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };

// ───────────────────────── Utilidades ─────────────────────────
const uid = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

// Limpia un objeto plano de formulario (solo textos/booleanos, longitud limitada)
function cleanFlat(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o).slice(0, 40)) {
    if (!/^[a-z0-9_]{1,40}$/i.test(k)) continue;
    out[k] = typeof v === 'boolean' ? v : str(v, 500);
  }
  return out;
}
const PATIENT_FIELDS = SCHEMA.Pacientes.filter((c) => !['id', 'creado_por', 'creado'].includes(c));
const cleanPatient = (p) => Object.fromEntries(PATIENT_FIELDS.map((c) => [c, str(p?.[c])]));

// ───────────────────────── Acciones ─────────────────────────
const actions = {
  // ---- públicas ----
  // Solo enfermeras se auto-registran. Las cuentas de doctor las asigna la clínica (DOCTOR_ACCOUNTS).
  async register({ body }) {
    const nombre = str(body.nombre, 80);
    const usuario = norm(body.usuario).replace(/\s+/g, '');
    if (!nombre || !usuario) fail(400, 'Nombre y usuario son obligatorios');
    if (String(body.password || '').length < 8) fail(400, 'La contraseña debe tener al menos 8 caracteres');
    if (!CODES.enfermera) fail(500, 'El servidor no tiene configurado el código de registro (NURSE_CODE)');
    if (String(body.codigo || '') !== CODES.enfermera) fail(403, 'Código de registro incorrecto');
    const [users, doctors] = [await db().all('Usuarios'), doctorAccounts()];
    if (users.some((u) => u.usuario === usuario) || doctors.some((d) => d.usuario === usuario)) fail(409, 'Ese usuario ya existe');
    const user = { id: uid(), nombre, usuario, rol: 'enfermera', hash: await hashPassword(body.password), creado: new Date().toISOString() };
    await db().append('Usuarios', user);
    return session(user);
  },
  async login({ body }) {
    const usuario = norm(body.usuario);
    const password = String(body.password || '');
    const doc = doctorAccounts().find((d) => d.usuario === usuario);
    if (doc) {
      if (!safeEqual(password, doc.password)) fail(401, 'Usuario o contraseña incorrectos');
      return session({ id: 'doctor:' + doc.usuario, nombre: doc.nombre, usuario: doc.usuario, rol: 'doctor' });
    }
    const users = await db().all('Usuarios');
    const user = users.find((u) => u.usuario === usuario);
    if (!user || !(await checkPassword(password, user.hash))) fail(401, 'Usuario o contraseña incorrectos');
    return session(user);
  },

  // ---- autenticadas ----
  async me({ user }) { return { user }; },

  async searchPatients({ body }) {
    const q = norm(body.q);
    const [patients, visits] = await Promise.all([db().all('Pacientes'), db().all('Visitas')]);
    const stats = {};
    for (const v of visits) {
      const s = (stats[v.paciente_id] ||= { visitas: 0, ultima: '' });
      s.visitas++;
      if (v.fecha > s.ultima) s.ultima = v.fecha;
    }
    const list = patients
      .filter((p) => !q || norm(p.apellidos_nombres).includes(q) || norm(p.dni).includes(q))
      .map((p) => ({
        id: p.id, apellidos_nombres: p.apellidos_nombres, dni: p.dni, fecha_nacimiento: p.fecha_nacimiento,
        visitas: stats[p.id]?.visitas || 0, ultima_visita: stats[p.id]?.ultima || '',
      }))
      .sort((a, b) => a.apellidos_nombres.localeCompare(b.apellidos_nombres, 'es'))
      .slice(0, 50);
    return { pacientes: list };
  },

  async createPatient({ body, user }) {
    const p = cleanPatient(body.paciente);
    if (!p.apellidos_nombres) fail(400, 'Apellidos y nombres son obligatorios');
    if (!p.fecha_inscripcion) p.fecha_inscripcion = today();
    if (p.dni) {
      const dup = (await db().all('Pacientes')).find((x) => x.dni && x.dni === p.dni);
      if (dup) fail(409, `Ya existe un paciente con ese DNI: ${dup.apellidos_nombres}`);
    }
    const row = { id: uid(), ...p, creado_por: user.nombre, creado: new Date().toISOString() };
    await db().append('Pacientes', row);
    return { paciente: row };
  },

  async updatePatient({ body }) {
    const all = await db().all('Pacientes');
    const old = all.find((p) => p.id === body.id);
    if (!old) fail(404, 'Paciente no encontrado');
    const p = cleanPatient(body.paciente);
    if (!p.apellidos_nombres) fail(400, 'Apellidos y nombres son obligatorios');
    const row = { ...old, ...p };
    await db().update('Pacientes', old.id, row);
    return { paciente: row };
  },

  async getPatient({ body }) {
    const [patients, visits, treats] = await Promise.all([db().all('Pacientes'), db().all('Visitas'), db().all('Tratamientos')]);
    const paciente = patients.find((p) => p.id === body.id);
    if (!paciente) fail(404, 'Paciente no encontrado');
    const tByVisit = Object.fromEntries(treats.filter((t) => t.paciente_id === paciente.id).map((t) => [t.visita_id, decode(t)]));
    const visitas = visits
      .filter((v) => v.paciente_id === paciente.id)
      .map((v) => ({ ...decode(v), tratamiento: tByVisit[v.id] || null }))
      .sort((a, b) => (b.fecha + b.creado).localeCompare(a.fecha + a.creado));
    return { paciente, visitas };
  },

  // Secciones II, III y IV (enfermera o doctor)
  async addVisit({ body, user }) {
    const patients = await db().all('Pacientes');
    if (!patients.some((p) => p.id === body.paciente_id)) fail(404, 'Paciente no encontrado');
    const row = {
      id: uid(), paciente_id: body.paciente_id, fecha: str(body.fecha, 10) || today(),
      antecedentes: cleanFlat(body.antecedentes), familiares: cleanFlat(body.familiares), vitales: cleanFlat(body.vitales),
      registrado_por: user.nombre, creado: new Date().toISOString(),
    };
    await db().append('Visitas', encode(row));
    return { visita: row };
  },

  // Sección V (SOLO doctor)
  async saveTreatment({ body, user }) {
    if (user.rol !== 'doctor') fail(403, 'Solo el doctor puede completar el esquema de trabajo');
    const visits = await db().all('Visitas');
    const visit = visits.find((v) => v.id === body.visita_id);
    if (!visit) fail(404, 'Visita no encontrada');
    const sesiones = (Array.isArray(body.sesiones) ? body.sesiones : []).slice(0, 40)
      .map((s) => ({ nro: str(s.nro, 20), descripcion: str(s.descripcion, 400), dosificacion: str(s.dosificacion, 200) }))
      .filter((s) => s.nro || s.descripcion || s.dosificacion);
    const treats = await db().all('Tratamientos');
    const old = treats.find((t) => t.visita_id === visit.id);
    const row = {
      id: old?.id || uid(), visita_id: visit.id, paciente_id: visit.paciente_id,
      diagnostico: str(body.diagnostico, 600), sesiones,
      doctor: user.nombre, actualizado: new Date().toISOString(),
    };
    if (old) await db().update('Tratamientos', old.id, encode(row));
    else await db().append('Tratamientos', encode(row));
    return { tratamiento: row };
  },
};
const PUBLIC = new Set(['register', 'login']);

function session(u) {
  const user = { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: u.rol };
  return { token: signToken(user), user };
}

// ───────────────────────── Handler ─────────────────────────
const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  try {
    if (!JWT_SECRET) fail(500, 'Falta configurar JWT_SECRET en el servidor');
    if (!USE_MEMORY && (!SHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY)) {
      fail(500, 'Falta configurar la conexión a Google Sheets (SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY)');
    }
    const body = JSON.parse(event.body || '{}');
    const fn = Object.hasOwn(actions, body.action) ? actions[body.action] : null;
    if (!fn) fail(400, 'Acción desconocida');
    let user = null;
    if (!PUBLIC.has(body.action)) {
      const h = event.headers.authorization || event.headers.Authorization || '';
      user = verifyToken(h.replace(/^Bearer /, ''));
      if (!user) fail(401, 'Sesión no válida');
    }
    return json(200, await fn({ body, user }));
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    console.error(e);
    return json(500, { error: e.message || 'Error interno' });
  }
};
