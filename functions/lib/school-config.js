// school-config.js — Lógica pura de la configuración institucional (Fase 5).
// Sin dependencias de Firebase: sanitiza la entrada del onboarding y serializa
// el valor guardado para el cliente. Testeada en scripts/test-school-config.mjs.

// Sanitiza y valida la entrada de adminSaveSchoolConfig.
// Lanza Error('LOGO_URL_INVALID') si el logo no es una URL http(s) y
// Error('PRIMARY_COLOR_INVALID') si el color primario no es un hex #RRGGBB.
function sanitizeSchoolConfigInput(data) {
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const schoolConfig = {
    logoUrl: str(data && data.logoUrl, 2000),
    slogan: str(data && data.slogan, 200),
    directorName: str(data && data.directorName, 120),
    address: str(data && data.address, 200),
    phone: str(data && data.phone, 40),
    email: str(data && data.email, 120),
    primaryColor: str(data && data.primaryColor, 7),
  };
  if (schoolConfig.logoUrl && !/^https?:\/\//.test(schoolConfig.logoUrl)) {
    throw new Error('LOGO_URL_INVALID');
  }
  if (schoolConfig.primaryColor && !/^#[0-9a-fA-F]{6}$/.test(schoolConfig.primaryColor)) {
    throw new Error('PRIMARY_COLOR_INVALID');
  }
  return {
    name: str(data && data.name, 200),
    schoolConfig,
  };
}

// Serializa con valores saneados para el cliente (nunca undefined/null).
function schoolConfigOut(inst) {
  const c = (inst && inst.schoolConfig) || {};
  return {
    logoUrl: typeof c.logoUrl === 'string' ? c.logoUrl : '',
    slogan: typeof c.slogan === 'string' ? c.slogan : '',
    directorName: typeof c.directorName === 'string' ? c.directorName : '',
    address: typeof c.address === 'string' ? c.address : '',
    phone: typeof c.phone === 'string' ? c.phone : '',
    email: typeof c.email === 'string' ? c.email : '',
    primaryColor: typeof c.primaryColor === 'string' ? c.primaryColor : '',
    onboardingDone: c.onboardingDone === true,
  };
}

module.exports = { sanitizeSchoolConfigInput, schoolConfigOut };