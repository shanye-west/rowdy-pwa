// Emulator-only regression tests. No service-account files or real Auth APIs
// are used: credentials/Auth are stubbed and Firestore targets a demo project.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const admin = require('firebase-admin');

const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host || '', /^(127\.0\.0\.1|localhost):\d+$/, 'A loopback Firestore emulator is required');
const project = 'demo-rowdy-pii';
const app = admin.initializeApp({ projectId: project }, 'player-pii-tests');
const db = app.firestore();
const scriptsDir = path.resolve(__dirname, '..');
const email = 'player@example.invalid';
after(() => app.delete());

async function runLinkScript(filename, id) {
  const errors = [];
  const firestore = Object.assign(() => db, { FieldValue: admin.firestore.FieldValue });
  const fakeAdmin = {
    initializeApp() {},
    credential: { cert: () => ({}) },
    firestore,
    auth: () => ({ getUserByEmail: async () => ({ uid: `uid-${id}`, email }) }),
  };
  const context = {
    exports: {}, __dirname: scriptsDir,
    process: { argv: ['node', filename, `--email=${email}`, `--playerId=${id}`, '--input=fixture.json'] },
    console: { log() {}, error: (...args) => errors.push(args) },
    require(name) {
      if (name === 'firebase-admin') return fakeAdmin;
      if (name === 'path') return path;
      if (name === 'fs') return {
        existsSync: () => true,
        readFileSync: () => JSON.stringify([{ email, playerId: id }]),
      };
      if (name === path.resolve(scriptsDir, '../service-account.json')) return {};
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  const source = fs.readFileSync(path.join(scriptsDir, filename), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  await vm.runInNewContext(compiled, context, { filename });
  assert.deepEqual(errors, []);
}

// The legacy test setup uses REST instead of the Admin SDK. Route only its
// Firestore requests to the emulator, including document names in commits.
function emulatorHttps() {
  return {
    request(url, options, callback) {
      const req = new EventEmitter();
      let body = '';
      req.write = (chunk) => { body += chunk; };
      req.end = () => {
        (async () => {
          let result;
          let statusCode = 200;
          if (url === 'https://oauth2.googleapis.com/token') {
            result = JSON.stringify({ access_token: 'synthetic-emulator-token' });
          } else if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:signUp?')) {
            const input = JSON.parse(body);
            result = JSON.stringify({ localId: `uid-${input.email}`, email: input.email });
          } else {
            const prefix = 'https://firestore.googleapis.com/v1/projects/rowdy-pwa/databases/(default)/documents';
            assert.ok(url.startsWith(prefix), 'Unexpected network request blocked');
            const target = `http://${host}/v1/projects/${project}/databases/(default)/documents${url.slice(prefix.length)}`;
            const response = await fetch(target, {
              method: options.method,
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
              body: body.replaceAll('projects/rowdy-pwa/databases/(default)/documents/', `projects/${project}/databases/(default)/documents/`),
            });
            statusCode = response.status;
            result = await response.text();
          }
          const res = new EventEmitter();
          res.statusCode = statusCode;
          callback(res);
          res.emit('data', result);
          res.emit('end');
        })().catch((error) => req.emit('error', error));
      };
      return req;
    },
  };
}

async function loadSetup(commit = false) {
  const errors = [];
  const context = vm.createContext({
    process: {
      argv: ['node', 'setup-test-auth-2026.js', ...(commit ? ['--commit'] : [])],
      exit: (code) => { throw new Error(`Setup exited ${code}`); },
    },
    URLSearchParams,
    setTimeout: (callback) => { queueMicrotask(callback); },
    console: { log() {}, error: (...args) => errors.push(args) },
    require(name) {
      if (name === 'https') return emulatorHttps();
      if (name === 'os') return { homedir: () => '/synthetic-home' };
      if (name === '/synthetic-home/.config/configstore/firebase-tools.json') {
        return { tokens: { refresh_token: 'synthetic-refresh-token' } };
      }
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  const source = fs.readFileSync(path.join(scriptsDir, 'setup-test-auth-2026.js'), 'utf8');
  await vm.runInContext(source, context, { filename: 'setup-test-auth-2026.js' });
  assert.deepEqual(errors, []);
  return context;
}

for (const filename of ['link-auth-to-player.ts', 'bulk-link-auth.ts']) {
  test(`${filename}: removes legacy public email and preserves private notes on repeated linking`, async () => {
    const id = filename.replace(/[^a-z]/g, '');
    const ref = db.doc(`players/${id}`);
    await ref.set({ displayName: 'Synthetic Player', authUid: 'old-uid', email: 'old@example.invalid' });
    await ref.collection('private').doc('profile').set({ email: 'old@example.invalid', scoutingNotes: 'keep private' });
    await runLinkScript(filename, id);
    await runLinkScript(filename, id);
    assert.deepEqual((await ref.get()).data(), { displayName: 'Synthetic Player', authUid: `uid-${id}` });
    assert.deepEqual((await ref.collection('private').doc('profile').get()).data(), { email, scoutingNotes: 'keep private' });
  });

  test(`${filename}: creates a private profile without adding public PII`, async () => {
    const id = `new-${filename.replace(/[^a-z]/g, '')}`;
    const ref = db.doc(`players/${id}`);
    await ref.set({ displayName: 'New Synthetic Player' });
    await ref.collection('private').doc('profile').delete();
    await runLinkScript(filename, id);
    assert.deepEqual((await ref.get()).data(), { displayName: 'New Synthetic Player', authUid: `uid-${id}` });
    assert.deepEqual((await ref.collection('private').doc('profile').get()).data(), { email });
  });
}

test('REST test setup: every linked player keeps email private and preserves existing notes', async () => {
  const context = await loadSetup();
  const players = vm.runInContext('ALL_PLAYERS', context);
  for (const player of players) {
    const ref = db.doc(`players/${player.id}`);
    await ref.set({ displayName: 'Synthetic Player', email: 'legacy@example.invalid' });
    await ref.collection('private').doc('profile').set({ scoutingNotes: 'keep private' });
  }
  await loadSetup(true);
  for (const player of players) {
    const expectedEmail = `test${player.id.replace(/^_Test/, '').toLowerCase()}@rowdycup.com`;
    const ref = db.doc(`players/${player.id}`);
    const publicData = (await ref.get()).data();
    assert.equal(publicData.authUid, `uid-${expectedEmail}`);
    assert.equal(Object.hasOwn(publicData, 'email'), false);
    assert.equal(Object.hasOwn(publicData, 'scoutingNotes'), false);
    assert.deepEqual((await ref.collection('private').doc('profile').get()).data(), {
      email: expectedEmail, scoutingNotes: 'keep private',
    });
  }
});

test('REST linking: a failed public update leaves the private profile unchanged', async () => {
  const context = await loadSetup();
  const ref = db.doc('players/missing-public-player');
  await ref.delete();
  const profile = ref.collection('private').doc('profile');
  await profile.set({ email: 'old@example.invalid', scoutingNotes: 'keep private' });
  await assert.rejects(vm.runInContext(
    'linkPlayerAuth("synthetic-token", "missing-public-player", "new-uid", "new@example.invalid")', context,
  ), /linkPlayerAuth/);
  assert.deepEqual((await profile.get()).data(), { email: 'old@example.invalid', scoutingNotes: 'keep private' });
  assert.equal((await ref.get()).exists, false);
});
