const assert = require('node:assert/strict');
const { loadBrowserModule } = require('./helpers/loadBrowserModule.cjs');
const runRealtimeTests = async () => {
  const names = ['WebSocket', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'];
  const saved = Object.fromEntries(names.map(key => [key, globalThis[key]]));
  const timers = new Map(); let timerId = 0;
  class Socket {
    static OPEN = 1;
    static instances = [];
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; Socket.instances.push(this); }
    open() { this.readyState = 1; this.onopen(); }
    send(data) { this.sent.push(JSON.parse(data)); }
    message(data) { this.onmessage({data: JSON.stringify(data)}); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const runTimer = (ms) => {
    const [id, timer] = [...timers].find(([, timer]) => timer.ms === ms) ?? [];
    assert.ok(timer, `Expected ${ms}ms timer`);
    if (!timer.interval) timers.delete(id);
    timer.fn();
  };
  try {
    globalThis.WebSocket = Socket;
    globalThis.setTimeout = (fn, ms) => { timers.set(++timerId, {fn, ms}); return timerId; };
    globalThis.setInterval = (fn, ms) => { timers.set(++timerId, {fn, ms, interval: true}); return timerId; };
    globalThis.clearInterval = globalThis.clearTimeout = id => timers.delete(id);
    const { createClient } = loadBrowserModule('src/lib/supabaseRestClient.ts');
    const client = createClient('https://example.supabase.co', 'test-key');
    let games = 0, events = 0, subscribed = 0;
    const channel = client.channel('live')
      .on('postgres_changes', {event: '*', schema: 'public', table: 'games'}, () => games++)
      .on('postgres_changes', {event: '*', schema: 'public', table: 'events'}, () => events++)
      .subscribe(status => { if (status === 'SUBSCRIBED') subscribed++; });
    const join = (socket) => {
      socket.open();
      const request = socket.sent[0];
      assert.equal(request.topic, 'realtime:live');
      assert.equal(request.event, 'phx_join');
      assert.equal(request.payload.config.postgres_changes.length, 2);
      socket.message({event: 'phx_reply', ref: request.ref, payload: {status: 'ok', response: {postgres_changes: [{id: 4}, {id: 5}]}}});
    };
    const socket = Socket.instances[0];
    assert.equal(socket.url, 'wss://example.supabase.co/realtime/v1/websocket?apikey=test-key&vsn=1.0.0');
    join(socket);
    assert.equal(subscribed, 1);
    socket.message({event: 'postgres_changes', payload: {ids: [5], data: {schema: 'public', table: 'events', type: 'INSERT'}}});
    assert.equal(events, 1); assert.equal(games, 0);
    runTimer(25000);
    const heartbeat = socket.sent.at(-1);
    assert.equal(heartbeat.topic, 'phoenix'); assert.equal(heartbeat.event, 'heartbeat');
    socket.message({event: 'phx_reply', ref: heartbeat.ref, payload: {status: 'ok'}});
    runTimer(25000); // Unanswered heartbeat causes a reconnect on next interval.
    runTimer(25000);
    runTimer(1000);
    join(Socket.instances[1]); assert.equal(subscribed, 2);
    Socket.instances[1].message({event: 'postgres_changes', payload: {ids: [4]}});
    assert.equal(games, 1);
    Socket.instances[1].message({event: 'phx_error', payload: {}});
    runTimer(1000);
    Socket.instances[2].close(); runTimer(2000);
    // Missing join reply also closes and retries.
    Socket.instances[3].open(); runTimer(10000);
    await client.removeChannel(channel);
    assert.equal(timers.size, 0, 'removeChannel cancels heartbeat, join timeout and backoff');
    const stopped = client.channel('cleanup').subscribe();
    const last = Socket.instances.at(-1); last.open();
    await client.removeChannel(stopped);
    assert.equal(last.sent.at(-1).event, 'phx_leave');
    assert.equal(timers.size, 0);
  } finally { for (const [key, value] of Object.entries(saved)) globalThis[key] = value; }
};
module.exports = { runRealtimeTests };
