(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SETTINGS = 'little-by-little-completion-alert-settings-v1';
  const PREFIX = 'little-by-little-completion-alert-v1:';
  let api, accountKey = '', pending = null, notice = null, lastSound = 0, ignoredCloses = 0;
  let preferences = { notifications: false };
  let notificationMessage = '';
  const elapsed = at => Math.max(0, Date.now() - at);
  const clock = ms => {
    const seconds = Math.floor(ms / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function write(key, value) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function loadPreferences() {
    const saved = read(SETTINGS);
    preferences = { notifications: saved?.notifications === true };
  }
  function valid(row) {
    return row && typeof row.id === 'string' && row.id.length <= 128 && typeof row.task === 'string' && row.task.length <= 80 && ['focus', 'break'].includes(row.kind) && Number.isFinite(row.at) && row.at > 0 && row.at <= Date.now() && typeof row.silenced === 'boolean';
  }
  function closeNotification() { try { notice?.close(); } catch {} notice = null; }
  function chooseAccount(key) {
    if (key === accountKey) return;
    const wasPending = !!pending;
    api.stopSound(); closeNotification(); pending = null;
    if (wasPending && $('successDialog').open) { ignoredCloses++; $('successDialog').close(); }
    accountKey = key;
    const saved = read(PREFIX + key); pending = valid(saved) ? saved : null;
    lastSound = 0;
    if (pending) queueMicrotask(restore);
  }
  function dismiss() {
    pending = null; write(PREFIX + accountKey, null); api.stopSound(); closeNotification();
    document.body.classList.remove('completion-pending');
    api.refresh();
  }
  function silence() {
    if (!pending) return;
    pending.silenced = true; write(PREFIX + accountKey, pending); api.stopSound(); update(accountKey);
  }
  function renderSettings() {
    const supported = window.isSecureContext && 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    $('notificationToggle').disabled = !supported || permission === 'denied';
    $('notificationToggle').textContent = preferences.notifications && permission === 'granted' ? '关闭系统通知' : permission === 'denied' ? '浏览器已禁止通知' : '开启系统通知';
    $('notificationStatus').textContent = notificationMessage || (!supported ? '当前环境不支持系统通知，仍可使用声音和页面提醒。' : permission === 'denied' ? '可在浏览器的网站权限中允许通知。' : preferences.notifications && permission === 'granted' ? '已开启。切到其他软件时，计时结束会发送系统通知。' : '需要点击开启并允许浏览器权限；网页关闭后无法提醒。');
  }
  function sendNotification() {
    if (!preferences.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      closeNotification();
      notice = new Notification(pending.kind === 'focus' ? '专注时间到，请确认结束' : '休息时间到啦', {
        body: pending.kind === 'focus' ? `「${pending.task}」本轮计时已结束。回到学习小花园查看。` : '回到学习小花园，按自己的节奏继续。',
        tag: 'study-garden-' + pending.id, requireInteraction: true, silent: true
      });
      notice.onclick = () => { window.focus(); if (pending) { api.showCompletion(pending); update(accountKey); } closeNotification(); };
    } catch {
      notificationMessage = '当前环境无法发送系统通知，声音和页面提醒仍可使用。'; renderSettings();
    }
  }
  function begin(row) {
    chooseAccount(api.getKey());
    pending = { id: row.id, kind: row.kind, task: row.task, at: row.at, silenced: false };
    write(PREFIX + accountKey, pending); lastSound = Date.now();
    api.playSound(); sendNotification(); update(accountKey);
  }
  function update(key, current = null) {
    chooseAccount(key);
    if (current && pending) { dismiss(); return false; }
    document.body.classList.toggle('completion-pending', !!pending);
    if (!pending) return false;
    const time = clock(elapsed(pending.at));
    $('timerDigits').textContent = '00:00';
    $('timerStatus').textContent = `已结束 ${time} · 等待确认`;
    $('timerEyebrow').textContent = pending.kind === 'focus' ? '这一轮已结束，请停下来确认' : '休息结束，准备好再继续';
    $('completionElapsed').textContent = `已结束 ${time} · 本轮已结算`;
    document.title = `${Math.floor(Date.now() / 1000) % 2 ? '⏰ ' : ''}计时已结束 ${time} · 一点点`;
    const audible = api.canPlaySound();
    const sounding = !pending.silenced && lastSound > 0 && Date.now() - lastSound < 4200;
    $('stopCompletionAlert').hidden = !sounding || !audible;
    $('completionAlertStatus').textContent = !audible ? '声音已关闭或音量为 0；可在提示音设置中开启。' : pending.silenced ? '声音已停止，完成记录已保存。' : sounding ? '正在播放一次长提醒，可随时停止声音。' : '完成记录已保存，确认后再开始下一步。';
    return true;
  }
  function restore() {
    if (!pending || $('successDialog').open) return;
    api.showCompletion(pending); update(accountKey);
  }
  function initialize(options) {
    api = options; loadPreferences(); renderSettings(); chooseAccount(api.getKey());
    $('notificationToggle').addEventListener('click', async () => {
      notificationMessage = '';
      if (preferences.notifications && Notification.permission === 'granted') preferences.notifications = false;
      else {
        $('notificationToggle').disabled = true;
        try { preferences.notifications = await Notification.requestPermission() === 'granted'; }
        catch { preferences.notifications = false; notificationMessage = '暂时无法申请通知权限，请检查浏览器设置。'; }
      }
      write(SETTINGS, preferences); if (!preferences.notifications) closeNotification(); renderSettings();
    });
    $('stopCompletionAlert').addEventListener('click', silence);
    $('successDialog').addEventListener('cancel', e => { if (pending) { e.preventDefault(); silence(); } });
    $('successDialog').addEventListener('close', () => { if (ignoredCloses) { ignoredCloses--; return; } if (pending && !$('successDialog').open) dismiss(); });
    $('soundBtn').addEventListener('click', renderSettings);
    window.addEventListener('storage', e => {
      if (e.key === SETTINGS) { loadPreferences(); renderSettings(); }
      if (e.key === PREFIX + accountKey) {
        const saved = read(e.key); pending = valid(saved) ? saved : null;
        if (!pending) { api.stopSound(); closeNotification(); $('successDialog').close(); api.refresh(); }
      }
    });
    window.addEventListener('pagehide', () => { api.stopSound(); closeNotification(); });
    restore();
  }
  window.StudyGardenAlerts = { initialize, begin, update, restore, isPending: () => !!pending };
})();
