function userJwtSecret() {
  return process.env.USER_JWT_SECRET || process.env.JWT_SECRET;
}

function superadminJwtSecret() {
  return process.env.SUPERADMIN_JWT_SECRET || process.env.JWT_SECRET;
}

function accountingSsoJwtSecret() {
  return process.env.ACCOUNTING_SSO_JWT_SECRET || process.env.JWT_SECRET;
}

module.exports = {
  userJwtSecret,
  superadminJwtSecret,
  accountingSsoJwtSecret,
};
