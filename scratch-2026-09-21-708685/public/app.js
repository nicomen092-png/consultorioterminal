// Historias Clínicas · Dr. Paliza Consultorios — frontend sin dependencias
const $app = document.getElementById('app');
const S = {
  token: localStorage.getItem('hc_token'),
  user: JSON.parse(localStorage.getItem('hc_user') || 'null'),
};
const isDoctor = () => S.user?.rol === 'doctor';

// ───────── utilidades ─────────
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '—');
const age = (d) => {
  if (!d) return '';
  const b = new Date(d), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--;
  return isNaN(a) ? '' : a;
};
function toast(msg, bad) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 3000);
}
async function api(action, data = {}) {
  const r = await fetch('/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: JSON.stringify({ action, ...data }),
  });
  const j = await r.json().catch(() => ({ error: 'Respuesta inválida del servidor' }));
  if (r.status === 401 && S.token) { logout(); throw new Error('Tu sesión expiró, ingresa de nuevo'); }
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
function setSession({ token, user }) {
  S.token = token; S.user = user;
  localStorage.setItem('hc_token', token); localStorage.setItem('hc_user', JSON.stringify(user));
}
function logout() {
  S.token = S.user = null;
  localStorage.removeItem('hc_token'); localStorage.removeItem('hc_user');
  location.hash = '#/'; render();
}
// Lee un <form> a objeto: checkbox → bool, radio → valor seleccionado
function readForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.dataset.skip) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

// ───────── componentes de formulario ─────────
const field = (label, name, v = '', o = {}) =>
  `<label class="f ${o.cls || ''}">${label}<input name="${name}" type="${o.type || 'text'}" value="${esc(v)}" ${o.req ? 'required' : ''} ${o.ph ? `placeholder="${o.ph}"` : ''} autocomplete="off"></label>`;
const radios = (name, opts, val) =>
  `<div class="choices">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}" ${val === v ? 'checked' : ''}>${l}</label>`).join('')}</div>`;
const check = (name, label, val) => `<label><input type="checkbox" name="${name}" ${val === true || val === 'true' ? 'checked' : ''}>${label}</label>`;

function shell(content) {
  const u = S.user;
  $app.innerHTML = `
    <header class="topbar"><div class="topbar-in">
      <a class="brand" href="#/"><span>Dr. Paliza<small>CONSULTORIOS</small></span><span class="cross">+</span></a>
      <span class="spacer"></span>
      <div class="who"><b>${esc(u.nombre)}</b><br><span class="badge ${u.rol}">${u.rol}</span></div>
      <button class="btn ghost small" data-act="logout">Salir</button>
    </div></header>
    <main>${content}</main>`;
}

// ───────── vistas ─────────
function viewAuth(mode = 'login') {
  const reg = mode === 'register';
  $app.innerHTML = `
    <div class="auth"><div class="card">
      <a class="brand" style="font-size:24px"><span>Dr. Paliza<small>CONSULTORIOS</small></span><span class="cross">+</span></a>
      <h1>Historias clínicas</h1>
      <div class="sub">Acceso exclusivo para el personal de la clínica</div>
      <div class="tabs">
        <button class="${reg ? '' : 'on'}" data-act="auth-mode" data-mode="login">Ingresar</button>
        <button class="${reg ? 'on' : ''}" data-act="auth-mode" data-mode="register">Crear cuenta de enfermera(o)</button>
      </div>
      <form data-form="${mode}" class="grid">
        ${reg ? field('Nombre completo', 'nombre', '', { req: 1 }) : ''}
        ${field('Usuario', 'usuario', '', { req: 1 })}
        ${field('Contraseña' + (reg ? ' (mín. 8 caracteres)' : ''), 'password', '', { type: 'password', req: 1 })}
        ${reg ? field('Código de registro (te lo da la clínica)', 'codigo', '', { type: 'password', req: 1 }) : ''}
        <button class="btn">${reg ? 'Crear cuenta' : 'Ingresar'}</button>
      </form>
      <div class="err" id="err"></div>
      ${reg
        ? `<div class="sub">Esta cuenta será de enfermera(o). Las cuentas de doctor(a) las crea la clínica; ingresa con el usuario y la contraseña que te dieron.</div>`
        : `<div class="sub">¿Eres enfermera(o) y aún no tienes cuenta? <a href="#" data-act="auth-mode" data-mode="register">Créala aquí</a>.</div>`}
    </div></div>`;
}

let searchTimer;
async function viewHome() {
  shell(`
    <div class="search">
      <input id="q" type="search" placeholder="Buscar paciente por nombre o DNI…" autofocus autocomplete="off">
      <a class="btn" href="#/nuevo">+ Nuevo paciente</a>
    </div>
    <div class="card" style="padding:0"><ul class="plist" id="results"><li class="empty">Cargando…</li></ul></div>`);
  const q = document.getElementById('q');
  const run = async () => {
    try {
      const { pacientes } = await api('searchPatients', { q: q.value });
      document.getElementById('results').innerHTML = pacientes.length
        ? pacientes.map((p) => `
          <li><a href="#/paciente/${p.id}">
            <span class="nm">${esc(p.apellidos_nombres)}</span>
            <span class="meta">${p.dni ? 'DNI ' + esc(p.dni) + ' · ' : ''}${p.visitas} visita${p.visitas === 1 ? '' : 's'}${p.ultima_visita ? '<br>Última: ' + fmtDate(p.ultima_visita) : ''}</span>
          </a></li>`).join('')
        : `<li class="empty">${q.value ? 'No se encontró ningún paciente. <a href="#/nuevo">Crear nuevo</a>' : 'Aún no hay pacientes registrados.'}</li>`;
    } catch (e) { toast(e.message, true); }
  };
  q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(run, 250); });
  run();
}

// Sección I · Filiación
function viewPatientForm(p) {
  const edit = !!p;
  p = p || { fecha_inscripcion: today() };
  shell(`
    <form data-form="patient" data-id="${edit ? p.id : ''}" class="card">
      <div class="section-title"><span class="num">I</span> Filiación ${edit ? '· editar' : '· nuevo paciente'}</div>
      <div class="grid">
        ${field('Apellidos y nombres', 'apellidos_nombres', p.apellidos_nombres, { cls: 'c9', req: 1 })}
        ${field('Fecha de nacimiento', 'fecha_nacimiento', p.fecha_nacimiento, { cls: 'c3', type: 'date' })}
        <label class="f c3">Sexo<select name="sexo">${['', 'Femenino', 'Masculino'].map((s) => `<option ${p.sexo === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        ${field('Ocupación', 'ocupacion', p.ocupacion, { cls: 'c6' })}
        ${field('D.N.I.', 'dni', p.dni, { cls: 'c3' })}
        ${field('Dirección', 'direccion', p.direccion, { cls: 'c9' })}
        ${field('Estado civil', 'estado_civil', p.estado_civil, { cls: 'c3' })}
        ${field('Lugar de nacimiento', 'lugar_nacimiento', p.lugar_nacimiento, { cls: 'c6' })}
        ${field('E-mail', 'email', p.email, { cls: 'c6', type: 'email' })}
        ${field('Familiar responsable', 'familiar_responsable', p.familiar_responsable, { cls: 'c6' })}
        ${field('Fecha de inscripción', 'fecha_inscripcion', p.fecha_inscripcion, { cls: 'c3', type: 'date' })}
        ${field('¿Cómo se enteró del Dr. Paliza?', 'como_se_entero', p.como_se_entero, { cls: 'c6' })}
      </div>
      <div class="actions">
        <button class="btn">${edit ? 'Guardar cambios' : 'Crear paciente y continuar'}</button>
        <a class="btn ghost" href="${edit ? '#/paciente/' + p.id : '#/'}">Cancelar</a>
      </div>
    </form>`);
}

// Secciones II, III, IV · Nueva visita
function viewVisitForm(patient, last) {
  const a = last?.antecedentes || {}, f = last?.familiares || {}, v = {};
  const habit = (key, title, freqs) => `
    <div class="habit"><b>${title}</b>
      ${radios(key + '_usa', [['SI', 'Sí'], ['NO', 'No']], a[key + '_usa'])}
      ${radios(key + '_freq', freqs, a[key + '_freq'])}
    </div>`;
  shell(`
    <div class="sub"><a href="#/paciente/${patient.id}">← ${esc(patient.apellidos_nombres)}</a></div>
    <form data-form="visit" data-pid="${patient.id}" class="card">
      <h2 style="margin-bottom:6px">Nueva visita</h2>
      ${last ? `<div class="sub" style="margin:0 0 12px">Los antecedentes se precargaron con la visita del ${fmtDate(last.fecha)}. Actualízalos si algo cambió.</div>` : ''}
      <div class="grid" style="margin-bottom:16px">${field('Fecha de la visita (H.C.)', 'fecha', today(), { type: 'date', cls: 'c3' })}</div>

      <div class="section-title"><span class="num">II</span> Antecedentes de importancia</div>
      <div class="grid" data-group="antecedentes">
        <div class="c4">${habit('tabaco', 'Tabaco', [['eventual', 'Eventualmente'], ['fines_semana', 'Los fines de semana'], ['frecuente', 'Más frecuente']])}</div>
        <div class="c4">${habit('licor', 'Licor', [['eventual', 'Eventualmente'], ['fines_semana', 'Los fines de semana'], ['frecuente', 'Más frecuente']])}</div>
        <div class="c4">${habit('ejercicios', 'Ejercicios', [['eventual', 'Eventualmente'], ['1x', '1 vez x semana'], ['2x', '2 veces x semana']])}</div>
        ${field('Tipo de sangre', 'tipo_sangre', a.tipo_sangre, { cls: 'c4' })}
        ${field('Alergia', 'alergia', a.alergia, { cls: 'c8' })}
        <div class="c12 choices" style="grid-column:span 12">
          ${check('hipertiroidismo', 'Hipertiroidismo', a.hipertiroidismo)}${check('hipotiroidismo', 'Hipotiroidismo', a.hipotiroidismo)}
          ${check('hta', 'HTA', a.hta)}${check('dm', 'D.M.', a.dm)}
        </div>
        ${field('Otro', 'otro', a.otro, { cls: 'c12' })}
      </div>

      <div class="section-title" style="margin-top:20px"><span class="num">III</span> Antecedentes familiares</div>
      <div class="grid" data-group="familiares">
        <div class="c3 choices">${check('hta', 'HTA', f.hta)}${check('dm', 'D.M.', f.dm)}</div>
        ${field('Otros', 'otros', f.otros, { cls: 'c9' })}
      </div>

      <div class="section-title" style="margin-top:20px"><span class="num">IV</span> Funciones vitales</div>
      <div class="grid" data-group="vitales">
        ${field('P.A.', 'pa', v.pa, { cls: 'c3', ph: '120/80' })}${field('SpO₂ (%)', 'sao2', v.sao2, { cls: 'c3' })}
        ${field('P.R.', 'pr', v.pr, { cls: 'c3' })}${field('Talla (cm)', 'talla', v.talla, { cls: 'c3' })}
        ${field('Peso (kg)', 'peso', v.peso, { cls: 'c3' })}${field('T°', 'temp', v.temp, { cls: 'c3' })}
      </div>

      <div class="sub" style="margin-top:14px">La sección V (esquema de trabajo) la completa el doctor después de la consulta.</div>
      <div class="actions"><button class="btn">Guardar visita</button><a class="btn ghost" href="#/paciente/${patient.id}">Cancelar</a></div>
    </form>`);
}

const pill = (t, on = true) => `<span class="pill ${on ? '' : 'none'}">${esc(t)}</span>`;
const FREQ = { eventual: 'eventualmente', fines_semana: 'fines de semana', frecuente: 'frecuente', '1x': '1 vez/sem', '2x': '2 veces/sem' };
function antecedentPills(a, f) {
  const out = [];
  for (const [k, t] of [['tabaco', 'Tabaco'], ['licor', 'Licor'], ['ejercicios', 'Ejercicios']]) {
    if (a[k + '_usa']) out.push(pill(`${t}: ${a[k + '_usa'] === 'SI' ? 'Sí' + (a[k + '_freq'] ? ' (' + FREQ[a[k + '_freq']] + ')' : '') : 'No'}`, a[k + '_usa'] === 'SI'));
  }
  if (a.tipo_sangre) out.push(pill('Sangre: ' + a.tipo_sangre));
  if (a.alergia) out.push(pill('Alergia: ' + a.alergia));
  for (const [k, t] of [['hipertiroidismo', 'Hipertiroidismo'], ['hipotiroidismo', 'Hipotiroidismo'], ['hta', 'HTA'], ['dm', 'D.M.']]) if (a[k]) out.push(pill(t));
  if (a.otro) out.push(pill('Otro: ' + a.otro));
  const fam = [];
  if (f.hta) fam.push(pill('HTA'));
  if (f.dm) fam.push(pill('D.M.'));
  if (f.otros) fam.push(pill(f.otros));
  return { personal: out.join('') || pill('Sin datos', false), familiar: fam.join('') || pill('Ninguno registrado', false) };
}

// Sección V: editable solo para el doctor
function sectionV(visit) {
  const t = visit.tratamiento;
  const rows = t?.sesiones?.length ? t.sesiones : [];
  if (!isDoctor()) {
    if (!t) return `<div class="lock">🔒 Esquema de trabajo pendiente — lo completa el doctor.</div>`;
    return `
      <div class="lock">🔒 Solo lectura · completado por ${esc(t.doctor)}</div>
      <p><b>Diagnóstico presuntivo:</b> ${esc(t.diagnostico) || '—'}</p>
      <table class="rows"><tr><th>Nro. sesión</th><th>Descripción de tratamiento</th><th>Dosificación</th></tr>
        ${rows.map((r) => `<tr><td class="ro">${esc(r.nro)}</td><td class="ro">${esc(r.descripcion)}</td><td class="ro">${esc(r.dosificacion)}</td></tr>`).join('') || '<tr><td colspan="3" class="ro">—</td></tr>'}
      </table>`;
  }
  return `
    <form data-form="treatment" data-vid="${visit.id}">
      ${field('Diagnóstico presuntivo', 'diagnostico', t?.diagnostico)}
      <table class="rows"><thead><tr><th>Nro. sesión</th><th>Descripción de tratamiento</th><th>Dosificación</th><th></th></tr></thead>
        <tbody>${(rows.length ? rows : [{}]).map(sessionRow).join('')}</tbody></table>
      <button type="button" class="btn ghost small" data-act="add-row">+ Agregar sesión</button>
      <div class="actions"><button class="btn">Guardar esquema de trabajo</button></div>
      ${t ? `<div class="sub">Última edición: ${esc(t.doctor)}</div>` : ''}
    </form>`;
}
const sessionRow = (r = {}) => `<tr>
  <td><input data-c="nro" value="${esc(r.nro)}"></td><td><input data-c="descripcion" value="${esc(r.descripcion)}"></td>
  <td><input data-c="dosificacion" value="${esc(r.dosificacion)}"></td>
  <td><button type="button" class="btn danger small" data-act="del-row" title="Quitar">✕</button></td></tr>`;

async function viewPatient(id) {
  shell('<div class="empty">Cargando historia clínica…</div>');
  const { paciente: p, visitas } = await api('getPatient', { id });
  const A = age(p.fecha_nacimiento);
  shell(`
    <div class="card">
      <div class="phead">
        <div><h1>${esc(p.apellidos_nombres)}</h1><div class="sub">Historia clínica · inscrito el ${fmtDate(p.fecha_inscripcion)}</div></div>
        <div class="actions" style="margin:0">
          <a class="btn" href="#/paciente/${p.id}/visita">+ Nueva visita</a>
          <a class="btn ghost" href="#/paciente/${p.id}/editar">Editar filiación</a>
        </div>
      </div>
      <div class="kv">
        <div><span>Edad</span><b>${A !== '' ? A + ' años' : '—'}</b></div><div><span>Nacimiento</span><b>${fmtDate(p.fecha_nacimiento)}</b></div>
        <div><span>Sexo</span><b>${esc(p.sexo) || '—'}</b></div><div><span>D.N.I.</span><b>${esc(p.dni) || '—'}</b></div>
        <div><span>Ocupación</span><b>${esc(p.ocupacion) || '—'}</b></div><div><span>Estado civil</span><b>${esc(p.estado_civil) || '—'}</b></div>
        <div><span>Dirección</span><b>${esc(p.direccion) || '—'}</b></div><div><span>Lugar de nacimiento</span><b>${esc(p.lugar_nacimiento) || '—'}</b></div>
        <div><span>E-mail</span><b>${esc(p.email) || '—'}</b></div><div><span>Familiar responsable</span><b>${esc(p.familiar_responsable) || '—'}</b></div>
        <div><span>¿Cómo se enteró?</span><b>${esc(p.como_se_entero) || '—'}</b></div>
      </div>
    </div>
    <h2 style="margin:22px 0 12px;font-size:17px">Historial de visitas (${visitas.length})</h2>
    ${visitas.length ? visitas.map((v, i) => visitCard(v, i === 0)).join('') : '<div class="card empty">Este paciente aún no tiene visitas. Crea la primera con “Nueva visita”.</div>'}`);
}
function visitCard(v, open) {
  const pills = antecedentPills(v.antecedentes || {}, v.familiares || {});
  const vt = v.vitales || {};
  const vit = [['P.A.', vt.pa], ['SpO₂', vt.sao2 && vt.sao2 + '%'], ['P.R.', vt.pr], ['Talla', vt.talla && vt.talla + ' cm'], ['Peso', vt.peso && vt.peso + ' kg'], ['T°', vt.temp]];
  return `
    <details class="visit" ${open ? 'open' : ''}>
      <summary>
        <span class="d">${fmtDate(v.fecha)}</span>
        <span class="tag ${v.tratamiento ? 'ok' : 'pending'}">${v.tratamiento ? 'Tratamiento definido' : 'Pendiente del doctor'}</span>
        <span class="s">Registrado por ${esc(v.registrado_por)}</span>
      </summary>
      <div class="vbody">
        <div class="section-title"><span class="num">II</span> Antecedentes de importancia</div><div class="pills">${pills.personal}</div>
        <div class="section-title" style="margin-top:16px"><span class="num">III</span> Antecedentes familiares</div><div class="pills">${pills.familiar}</div>
        <div class="section-title" style="margin-top:16px"><span class="num">IV</span> Funciones vitales</div>
        <div class="pills">${vit.map(([k, x]) => pill(`${k}: ${x || '—'}`, !!x)).join('')}</div>
        <div class="section-title" style="margin-top:20px"><span class="num">V</span> Esquema de trabajo</div>
        ${sectionV(v)}
      </div>
    </details>`;
}

// ───────── router ─────────
async function render() {
  if (!S.token) return viewAuth();
  const [, a, id, b] = location.hash.split('/');
  try {
    if (a === 'nuevo') return viewPatientForm();
    if (a === 'paciente' && id) {
      if (b === 'editar') return viewPatientForm((await api('getPatient', { id })).paciente);
      if (b === 'visita') {
        const { paciente, visitas } = await api('getPatient', { id });
        return viewVisitForm(paciente, visitas[0]);
      }
      return await viewPatient(id);
    }
    return await viewHome();
  } catch (e) { if (S.token) { toast(e.message, true); if (location.hash !== '#/') location.hash = '#/'; } }
}
window.addEventListener('hashchange', render);

// ───────── eventos ─────────
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'logout') logout();
  if (act === 'auth-mode') viewAuth(b.dataset.mode);
  if (act === 'add-row') b.closest('form').querySelector('tbody').insertAdjacentHTML('beforeend', sessionRow());
  if (act === 'del-row') { const tb = b.closest('tbody'); b.closest('tr').remove(); if (!tb.children.length) tb.insertAdjacentHTML('beforeend', sessionRow()); }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form, btn = form.querySelector('button:not([type=button])');
  btn && (btn.disabled = true);
  try {
    if (kind === 'login' || kind === 'register') {
      setSession(await api(kind, readForm(form)));
      location.hash = '#/'; return render();
    }
    if (kind === 'patient') {
      const id = form.dataset.id;
      const paciente = readForm(form);
      const r = id ? await api('updatePatient', { id, paciente }) : await api('createPatient', { paciente });
      toast(id ? 'Filiación actualizada' : 'Paciente creado');
      location.hash = id ? `#/paciente/${id}` : `#/paciente/${r.paciente.id}/visita`;
    }
    if (kind === 'visit') {
      const group = (n) => readForm({ elements: form.querySelectorAll(`[data-group=${n}] [name]`) });
      const fecha = form.querySelector('[name=fecha]').value;
      await api('addVisit', { paciente_id: form.dataset.pid, fecha, antecedentes: group('antecedentes'), familiares: group('familiares'), vitales: group('vitales') });
      toast('Visita guardada');
      location.hash = `#/paciente/${form.dataset.pid}`;
    }
    if (kind === 'treatment') {
      const d = readForm(form);
      const sesiones = [...form.querySelectorAll('tbody tr')].map((tr) => Object.fromEntries([...tr.querySelectorAll('input')].map((i) => [i.dataset.c, i.value])));
      await api('saveTreatment', { visita_id: form.dataset.vid, ...d, sesiones });
      toast('Esquema de trabajo guardado');
      await viewPatient(location.hash.split('/')[2]);
      return;
    }
  } catch (err) {
    const box = document.getElementById('err');
    if (box) box.textContent = err.message; else toast(err.message, true);
  } finally { btn && (btn.disabled = false); }
});

render();
