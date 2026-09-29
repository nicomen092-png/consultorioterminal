# Historias Clínicas · Dr. Paliza Consultorios

Frontend estático (`public/`) + una función serverless (`netlify/functions/api.js`) + Google Sheets como base de datos.

## 1. Google Sheets

1. En [Google Cloud Console](https://console.cloud.google.com) crea un proyecto y activa **Google Sheets API**.
2. Crea una **cuenta de servicio** → pestaña *Claves* → *Agregar clave* → JSON. Descárgala (no la subas a GitHub).
3. Crea una hoja de cálculo vacía en Google Sheets y **compártela con el email de la cuenta de servicio** (rol Editor).
4. Copia el link completo de la hoja (la barra de direcciones del navegador) y pégalo tal cual en la variable `SHEET_ID` — la función extrae el ID sola, no hace falta recortarlo.

Las pestañas `Usuarios`, `Pacientes`, `Visitas` y `Tratamientos` se crean solas la primera vez.

## 2. GitHub (por la web, sin terminal)

1. Entra a [github.com/new](https://github.com/new) y crea un repositorio **privado** (por ejemplo `paliza-historias`). No marques "Add a README" — ya tienes uno.
2. En la página del repo recién creado, usa el enlace **"uploading an existing file"**.
3. Arrastra a esa página todo el contenido de esta carpeta: las subcarpetas `netlify/` y `public/`, y los archivos `.gitignore`, `netlify.toml`, `package.json`, `package-lock.json`, `README.md`, `dev-server.js`, `.env.example`.
   - **No subas** `node_modules` — no existe en esta carpeta a propósito; Netlify instala las dependencias solo con `package.json`.
   - **No subas `.env`** si algún día lo creas con tus claves reales; ese archivo es solo para tu máquina.
4. Escribe un mensaje de commit (ej. "Primer prototipo") y confirma con **"Commit changes"**.

## 3. Netlify

1. *Add new site → Import an existing project* → elige el repo de GitHub.
2. Netlify lee `netlify.toml` (publish `public`, functions `netlify/functions`); no hay comando de build.
3. En *Site configuration → Environment variables* agrega:

| Variable | Valor |
|---|---|
| `SHEET_ID` | link completo de la hoja, o solo el ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` del JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` del JSON, tal cual (con los `\n`) |
| `JWT_SECRET` | cadena larga aleatoria |
| `NURSE_CODE` | código para que las enfermeras se registren solas |
| `DOCTOR_ACCOUNTS` | cuentas de doctor(a), ver abajo |

`DOCTOR_ACCOUNTS` — las doctoras/doctores **no se auto-registran**: la clínica les asigna usuario y contraseña con esta variable. Formato `usuario:contraseña:Nombre completo`, y para varias cuentas se separan con `;` o con saltos de línea:

```
dra.paliza:ClaveSegura123:Dra. Paliza
dr.gomez:OtraClave456:Dr. Gómez
```

4. Redeploy. Cada vez que subas un cambio al repo desde la web de GitHub, Netlify vuelve a desplegar solo.

## Desarrollo local (opcional)

Esto no es necesario para probar la app — con GitHub + Netlify ya queda funcionando en la web. Solo sirve si más adelante quieres editar el código en tu computadora con Node.js instalado:

```bash
npm install
npm run dev:local   # datos en memoria — enfermera: código enfermera123 / doctor: usuario "doctor", contraseña "doctor1234"
npm run dev         # con Netlify CLI y tu .env real
```

## Permisos

- **enfermera**: crea/edita la filiación (sección I) y agrega visitas (secciones II–IV). Ve la sección V (esquema de trabajo) en solo lectura, no puede editarla.
- **doctor**: todo lo anterior + completa la sección V. Su cuenta la asigna la clínica por `DOCTOR_ACCOUNTS`, no aparece la opción de registrarse como doctor en la interfaz.

El rol se valida en el servidor (`saveTreatment`), no solo en la interfaz — aunque una enfermera manipule la página, el servidor rechaza el guardado si su rol no es doctor.

La sección V es solo texto (diagnóstico presuntivo + sesiones de tratamiento); no se guarda ningún monto, costo ni abono.
