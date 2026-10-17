const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { root, launchBrowser } = require('./helpers.cjs');

const KEY = 'little-by-little-study-v1';
const fileURL = pathToFileURL(path.join(root, 'index.html')).href;
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const task = (id, order) => ({ id, title: '任务 ' + id, category: '复习', parentTitle: '', date: today, done: false, deleted: false, order, updatedAt: Date.now() });
const seed = {
  version: 1, coins: 360, sessions: [{ id: 'old', task: '原记录', minutes: 120, at: Date.now() }, { id: 'old-2', task: '原记录二', minutes: 60, at: Date.now() }],
  redemptions: [], customRewards: [], current: null, selectedMinutes: 5, goal: '检查', sound: false,
  tasks: [task('a', 1024), task('b', 2048)], reflections: []
};

(async () => {
  const browser = await launchBrowser();
  const errors = [];
  browser.on('context', context => context.on('page', page => page.on('pageerror', error => errors.push(error.message))));
  try {
    const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
    await context.addInitScript(({ KEY, seed }) => {
      if (location.protocol === 'about:') return;
      if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(seed));
      window.bufferCount = 0;
      const proto = (window.AudioContext || window.webkitAudioContext).prototype;
      const create = proto.createBuffer;
      proto.createBuffer = function (...args) { window.bufferCount++; return create.apply(this, args); };
    }, { KEY, seed });
    const page = await context.newPage();
    await page.goto(fileURL);
    await page.locator('[data-task-edit="a"]').focus();
    const unchanged = await page.evaluate(KEY => {
      const tasks = document.getElementById('tasksList').firstElementChild;
      const plant = document.getElementById('gardenScenery').firstElementChild;
      const reward = document.getElementById('rewardGrid').firstElementChild;
      const focused = document.activeElement;
      dispatchEvent(new StorageEvent('storage', { key: KEY }));
      return tasks === document.getElementById('tasksList').firstElementChild && plant === document.getElementById('gardenScenery').firstElementChild && reward === document.getElementById('rewardGrid').firstElementChild && focused === document.activeElement;
    }, KEY);
    assert.equal(unchanged, true, 'Unchanged synchronization must preserve DOM and focus');
    await page.locator('[data-task-move="b"][data-direction="-1"]').click();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.taskMove), 'b', 'Sorting must retain keyboard focus');
    await page.locator('[data-task-done="b"]').check();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.taskDone), 'b');

    await page.locator('#ambientPanel summary').click();
    await page.locator('#ambientEnabled').check();
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => window.bufferCount === 1);
    await page.locator('#startBtn').click();
    await page.locator('#startBtn').click();
    await page.waitForFunction(() => document.getElementById('ambientStatus').textContent.includes('正在播放'));
    assert.equal(await page.evaluate(() => window.bufferCount), 1, 'Resume must reuse the generated sound buffer');
    await page.locator('#ambientType').selectOption('white');
    await page.waitForFunction(() => window.bufferCount === 2);
    await page.locator('#resetBtn').click();
    await page.locator('#confirmAction').click();
    await page.evaluate(KEY => {
      const state = JSON.parse(localStorage.getItem(KEY));
      state.sessions.push({ id: 'future', task: '遥远日期', minutes: 17, at: new Date(2250, 5, 1, 12).getTime() });
      localStorage.setItem(KEY, JSON.stringify(state));
      dispatchEvent(new StorageEvent('storage', { key: KEY }));
    }, KEY);
    await page.locator('#historyBtn').click();
    await page.locator('#historyFrom').fill('2000-01-01');
    await page.locator('#historyFrom').dispatchEvent('change');
    await page.locator('#historyTo').fill('2300-12-31');
    await page.locator('#historyTo').dispatchEvent('change');
    await page.locator('#historySearch').fill('遥远日期');
    assert.ok(await page.locator('#historyChart .chart-col').count() <= 120);
    assert.equal(await page.locator('#historyChart .chart-col').last().getAttribute('data-history-to'), '2300-12-31');
    assert.equal(await page.locator('#historyChart .chart-num').evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number(node.textContent), 0)), 17);
    await page.locator('#historyChart .chart-col').filter({ has: page.locator('.chart-num', { hasText: /^17$/ }) }).click();
    assert.match(await page.locator('#historyList').innerText(), /遥远日期/);
    await context.close();

    const accounts = await browser.newContext({ timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
    const origin = 'http://study-garden.test';
    const cloud = 'https://test-cloud.supabase.co';
    const authKey = KEY + ':auth:test-cloud.supabase.co';
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const auth = id => ({ access_token: 'test-access', refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: id.slice(0, 8) + '@example.invalid' } });
    await accounts.route(origin + '/**', route => {
      const filename = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if (filename === 'cloud-config.json') return route.fulfill({ json: { url: cloud, publishableKey: 'sb_publishable_test' } });
      if (!['index.html', 'appearance.css', 'study-tools.css', 'study-tools.js'].includes(filename)) return route.fulfill({ status: 404 });
      const types = { html: 'text/html; charset=utf-8', css: 'text/css', js: 'application/javascript' };
      return route.fulfill({ body: fs.readFileSync(path.join(root, filename)), contentType: types[filename.split('.').at(-1)] });
    });
    let cloudCalls = 0;
    let releaseRefresh, refreshStarted;
    const refreshing = new Promise(resolve => { refreshStarted = resolve; });
    await accounts.route(cloud + '/**', async route => {
      const request = route.request();
      assert.equal(request.method(), 'POST');
      if (request.url().includes('/auth/v1/token?grant_type=refresh_token')) {
        const released = new Promise(resolve => { releaseRefresh = resolve; });
        refreshStarted();
        await released;
        return route.fulfill({ status: 401, json: { message: 'Expired test token' } });
      }
      assert.ok(request.url().endsWith('/rest/v1/rpc/study_garden_merge_v2'));
      assert.equal(request.headers().authorization, 'Bearer test-access');
      cloudCalls++;
      await route.fulfill({ json: { state: request.postDataJSON().p_state, revision: cloudCalls } });
    });
    await accounts.addInitScript(({ KEY, seed, ids, authKey, session }) => {
      if (location.protocol === 'about:') return;
      for (const id of ids) localStorage.setItem(KEY + ':account:' + id, JSON.stringify(seed));
      localStorage.setItem(authKey, JSON.stringify(session));
    }, { KEY, seed, ids, authKey, session: auth(ids[0]) });
    const accountPage = await accounts.newPage();
    await accountPage.goto(origin);
    await accountPage.waitForFunction(() => document.getElementById('cloudStatusText').textContent.startsWith('已同步'));
    const switchTo = async id => {
      await accountPage.evaluate(({ authKey, session }) => {
        localStorage.setItem(authKey, JSON.stringify(session));
        dispatchEvent(new StorageEvent('storage', { key: authKey }));
      }, { authKey, session: auth(id) });
      await accountPage.waitForFunction(email => document.getElementById('signedInEmail').textContent === email && document.getElementById('cloudStatusText').textContent.startsWith('已同步'), auth(id).user.email);
    };
    const readAccount = id => accountPage.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY + ':account:' + id);
    await accountPage.locator('[data-redeem="rest"]').click();
    await switchTo(ids[1]);
    await accountPage.locator('#confirmAction').click();
    assert.equal((await readAccount(ids[1])).coins, 360);
    assert.equal((await readAccount(ids[1])).current, null);
    assert.equal((await readAccount(ids[1])).redemptions.length, 0);
    assert.match(await accountPage.locator('#toast').innerText(), /账号已变化/);
    await accountPage.locator('#editGoalsBtn').click();
    await accountPage.locator('#goalsInput').fill('来自另一账号的编辑');
    await switchTo(ids[0]);
    await accountPage.locator('#goalsForm button[type="submit"]').click();
    assert.ok(!(await readAccount(ids[0])).quickGoals.includes('来自另一账号的编辑'));
    await accountPage.locator('#customDurationBtn').click();
    await accountPage.locator('#durationInput').fill('37');
    await switchTo(ids[1]);
    await accountPage.locator('#durationForm button[type="submit"]').click();
    assert.equal((await readAccount(ids[1])).selectedMinutes, 5);
    assert.ok(cloudCalls >= 4, 'Account-switch checks must exercise sync responses');
    await accountPage.evaluate(({ authKey, session }) => {
      localStorage.setItem(authKey, JSON.stringify({ ...session, expires_at: 1 }));
      dispatchEvent(new StorageEvent('storage', { key: authKey }));
    }, { authKey, session: auth(ids[0]) });
    await refreshing;
    await accountPage.evaluate(({ authKey, session }) => {
      localStorage.setItem(authKey, JSON.stringify(session));
      dispatchEvent(new StorageEvent('storage', { key: authKey }));
    }, { authKey, session: auth(ids[1]) });
    releaseRefresh();
    await accountPage.waitForFunction(() => document.getElementById('accountNavText').textContent === '登录同步' || document.getElementById('cloudStatusText').textContent.startsWith('已同步'));
    const savedAuth = await accountPage.evaluate(authKey => JSON.parse(localStorage.getItem(authKey)), authKey);
    assert.equal(savedAuth?.user.id, ids[1], 'A failed refresh for the previous account must preserve the new account');
    await accounts.close();

    const shared = await browser.newContext({ timezoneId: 'Asia/Shanghai' });
    await shared.addInitScript(({ KEY, seed }) => { if (location.protocol === 'about:') return; if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify({ ...seed, coins: 0, sessions: [], current: { id: 'shared-timer', kind: 'focus', task: '两标签页计时', duration: 300000, remainingMs: 300000, deadline: Date.now() + 300000 } })); }, { KEY, seed });
    const tabs = await Promise.all([shared.newPage(), shared.newPage()]);
    await Promise.all(tabs.map(tab => tab.goto(fileURL)));
    await tabs[0].evaluate(KEY => {
      const state = JSON.parse(localStorage.getItem(KEY));
      state.current.deadline = Date.now() - 1000;
      localStorage.setItem(KEY, JSON.stringify(state));
      dispatchEvent(new StorageEvent('storage', { key: KEY }));
    }, KEY);
    await tabs[0].waitForFunction(KEY => JSON.parse(localStorage.getItem(KEY)).current === null, KEY);
    await tabs[1].waitForFunction(KEY => JSON.parse(localStorage.getItem(KEY)).current === null, KEY);
    const settled = await tabs[0].evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY);
    assert.equal(settled.sessions.length, 1);
    assert.equal(settled.coins, 10);
    await shared.close();
    assert.deepEqual(errors, []);
    console.log('PASS: unchanged DOM/focus, sorting focus, sound buffer reuse, 300-year chart, account-switch confirmation and editors, mocked cloud synchronization, two-tab settlement; no browser errors.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
