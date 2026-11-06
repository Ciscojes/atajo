# Atajo

Atajo guarda tus enlaces por categoría y los sincroniza entre dispositivos. La interfaz se publica en GitHub Pages y Supabase gestiona la autenticación y la base de datos.

**Aplicación pública:** <https://ciscojes.github.io/atajo/>

[Probar la colección de ejemplo sin cuenta](https://ciscojes.github.io/atajo/?preview)

## Uso

- Cuentas privadas y sincronización entre dispositivos mediante Supabase.
- Creación, edición, búsqueda y favoritos por categorías.
- Orden manual arrastrando los accesos o usando las flechas del teclado.
- Respaldo e importación de la colección en formato JSON.
- Renombrado de categorías y reasignación segura de sus accesos.
- Favicons automáticos con inicial de respaldo cuando un sitio no ofrece icono.
- Tema claro y oscuro, diseño adaptable e instalación como PWA.

La importación añade los accesos del respaldo a la colección actual y omite las
direcciones que ya existen. Quitar una categoría no elimina sus accesos: los
reubica automáticamente en **Sin categoría**.

## Configuración

1. Crea un proyecto gratuito en [Supabase](https://supabase.com/dashboard).
2. Abre **SQL Editor**, pega el contenido de `supabase/schema.sql` y ejecútalo.
3. En **Project Settings > API**, copia la URL del proyecto y la clave pública (`anon` o `publishable`).
4. Edita `config.js`:

```js
window.ATAJO_CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseAnonKey: "TU_CLAVE_PUBLICA",
};
```

La clave pública puede estar en el navegador. No copies nunca la clave `service_role`.

## Autenticación

En Supabase, abre **Authentication > URL Configuration** y configura:

- **Site URL:** `https://TU-USUARIO.github.io/TU-REPOSITORIO/`
- **Redirect URLs:** añade la misma dirección.

Para probar localmente, añade también `http://localhost:8080/` a las URL permitidas.

La aplicación incluye recuperación de contraseña. Añade la URL pública y la
URL local a **Redirect URLs** para que los enlaces enviados por correo regresen
correctamente a Atajo.

Supabase activa por defecto la confirmación por correo. Puedes cambiarla en **Authentication > Providers > Email**.

## Probar localmente

Desde esta carpeta ejecuta:

```bash
python3 -m http.server 8080
```

Luego visita `http://localhost:8080`.

## Pruebas

```bash
npm install
npx playwright install chromium
npm test
```

La suite verifica los flujos principales en escritorio y móvil, recuperación
de contraseña, adaptación responsive y reglas automáticas de accesibilidad. El
despliegue en GitHub Pages se detiene automáticamente si alguna prueba falla.

### Prueba real con Supabase

La prueba de integración inicia sesión mediante la interfaz, crea y edita dos
accesos, cambia su favorito y orden, renombra la categoría, recarga la página
para comprobar la persistencia y elimina los datos técnicos al terminar.

Usa una cuenta confirmada dedicada exclusivamente a pruebas y proporciona sus
credenciales como variables de entorno; nunca las guardes en el repositorio:

```bash
## Crear y confirmar automáticamente una cuenta técnica la primera vez
npm run test:live:setup

## Ejecutar la prueba usando el .env.local ignorado por Git
npm run test:live

## Alternativa: proporcionar las variables solo para una ejecución
ATAJO_TEST_EMAIL="correo-tecnico" \
ATAJO_TEST_PASSWORD="contraseña-tecnica" \
npm run test:live
```

La prueba real está separada de `npm test` para evitar depender de la red o
modificar Supabase durante cada despliegue.

## Publicar en GitHub Pages

Cada `push` a `main` ejecuta las pruebas y, si todas pasan, publica la web
automáticamente mediante GitHub Actions.

## Seguridad

La tabla tiene Row Level Security activado. Cada operación valida que `auth.uid()` coincida con el propietario del enlace, por lo que un usuario autenticado no puede consultar ni modificar los datos de otro.
