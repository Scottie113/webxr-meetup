import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { JsonStore } from '../server/store/jsonStore.js';
import { testConfig } from './helpers.js';

let app;
beforeEach(() => {
  app = createApp({ store: new JsonStore(null), config: testConfig() });
});

const signup = (body = { name: 'Ada', color: '#123abc', interests: ['webxr'] }) =>
  request(app).post('/api/players').send(body);
const bearer = ({ player, token }) => `Bearer ${player.id}.${token}`;

test('GET /api/health', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.status, 'ok');
});

test('responses carry security headers and hide Express', async () => {
  const res = await request(app).get('/api/health');
  assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  assert.match(res.headers['permissions-policy'], /xr-spatial-tracking=\(self\)/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('GET /api/meta lists interests', async () => {
  const res = await request(app).get('/api/meta').expect(200);
  assert.ok(res.body.interests.includes('webxr'));
});

test('POST /api/players creates a player and returns a token once', async () => {
  const res = await signup().expect(201);
  assert.equal(res.body.player.name, 'Ada');
  assert.equal(res.body.player.tokenHash, undefined);
  assert.ok(res.body.token.length >= 16);

  const me = await request(app).get('/api/players/me').set('Authorization', bearer(res.body)).expect(200);
  assert.equal(me.body.id, res.body.player.id);
});

test('POST /api/players validates input', async () => {
  await signup({ name: '' }).expect(400);
  await signup({ name: '<script>' }).expect(400);
  await signup({ name: 'Ok', color: 'red' }).expect(400);
  const res = await signup({ name: 'Ok', interests: ['a', 'b', 'c', 'd'] }).expect(400);
  assert.equal(res.body.error.code, 'bad_request');
});

test('malformed JSON and oversized bodies are rejected', async () => {
  await request(app).post('/api/players').set('Content-Type', 'application/json').send('{bad').expect(400);
  await signup({ name: 'x'.repeat(20_000) }).expect(413);
});

test('auth is required for /me and room creation', async () => {
  await request(app).get('/api/players/me').expect(401);
  await request(app).get('/api/players/me').set('Authorization', 'Bearer nonsense').expect(401);
  await request(app).post('/api/rooms').send({ name: 'Nope' }).expect(401);
});

test('PATCH /api/players/me updates profile', async () => {
  const { body } = await signup();
  const res = await request(app)
    .patch('/api/players/me')
    .set('Authorization', bearer(body))
    .send({ color: '#00ff00', interests: ['music', 'ai'] })
    .expect(200);
  assert.equal(res.body.color, '#00ff00');
  assert.deepEqual(res.body.interests, ['music', 'ai']);
});

test('rooms can be listed and created', async () => {
  const { body } = await signup();
  const list = await request(app).get('/api/rooms').expect(200);
  assert.ok(list.body.some((r) => r.id === 'plaza' && r.online === 0));
  assert.equal(list.body.filter((r) => r.kind === 'interest').length, 10);

  const created = await request(app)
    .post('/api/rooms')
    .set('Authorization', bearer(body))
    .send({ name: 'Game Devs' })
    .expect(201);
  await request(app).get(`/api/rooms/${created.body.id}`).expect(200);
  await request(app).get('/api/rooms/does-not-exist').expect(404);
});

test('leaderboard returns players', async () => {
  await signup();
  const res = await request(app).get('/api/leaderboard?limit=5').expect(200);
  assert.equal(res.body[0].name, 'Ada');
});

test('unknown API routes return JSON 404', async () => {
  const res = await request(app).get('/api/nope').expect(404);
  assert.equal(res.body.error.code, 'not_found');
});

test('serves the client and Babylon.js vendor bundle', async () => {
  await request(app).get('/').expect(200).expect('Content-Type', /html/);
  await request(app).get('/vendor/babylon/babylon.js').expect(200);
  await request(app).get('/vendor/babylon-loaders/babylonjs.loaders.min.js').expect(200);
});
