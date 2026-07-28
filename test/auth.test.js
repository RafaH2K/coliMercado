const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const requireAuth = require("../src/middlewares/auth");

function mockRes() {
    const res = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
}

test("bcrypt hash/compare round trip", async () => {
    const hash = await bcrypt.hash("mypassword123", 12);
    assert.equal(await bcrypt.compare("mypassword123", hash), true);
    assert.equal(await bcrypt.compare("wrongpassword", hash), false);
});

test("requireAuth accepts a valid Bearer token", () => {
    const token = jwt.sign({ id: "abc123" }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.user.id, "abc123");
});

test("requireAuth rejects a missing token", () => {
    const req = { headers: {} };
    const res = mockRes();
    requireAuth(req, res, () => assert.fail("next() should not be called"));
    assert.equal(res.statusCode, 401);
});

test("requireAuth rejects a tampered token", () => {
    const token = jwt.sign({ id: "abc123" }, "wrong-secret");
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    requireAuth(req, res, () => assert.fail("next() should not be called"));
    assert.equal(res.statusCode, 401);
});
