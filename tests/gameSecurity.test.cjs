const assert = require("node:assert/strict");
const { GAME_ADMIN_PASSWORD, isGameAdminPassword } = require("../.test-dist/utils/gameSecurity.js");

const runGameSecurityTests = () => {
  assert.equal(GAME_ADMIN_PASSWORD, "110326");
  assert.equal(isGameAdminPassword("110326"), true);
  assert.equal(isGameAdminPassword(" 110326 "), false);
  assert.equal(isGameAdminPassword("123456"), false);
  assert.equal(isGameAdminPassword(""), false);
};

module.exports = {
  runGameSecurityTests
};
