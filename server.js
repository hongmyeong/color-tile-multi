const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const G = require("./public/game.js");

const app = express();
const srv = http.createServer(app);
const io = new Server(srv);
app.use(express.static(__dirname + "/public"));

const rooms = new Map();
const DUR = 120, MAX = 8, CD = 3; // 게임 시간, 최대 인원, 카운트다운(초)
const SURV = ["snow", "quake", "fog", "night", "thunder", "rain"]; // 서바이벌 방해 이벤트 종류
const TEST = process.env.TEST_MODE === "1"; // 테스트 모드: 켜져 있을 때만 치트(F9)를 허용 (평소엔 꺼 둘 것)
const rnd = () => Math.floor(Math.random() * 2 ** 31);
const newCode = () => {
  let c;
  do c = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms.has(c));
  return c;
};
const pub = (r) => ({
  code: r.code, host: r.host, state: r.state, n: r.n, mode: r.mode, gmode: r.gmode, force: r.force, test: TEST,
  players: [...r.players.values()].map((p) => ({ id: p.id, nick: p.nick, ready: p.ready, st: p.st, score: p.score })),
});
const send = (r) => io.to(r.code).emit("room", pub(r));
const me = (s) => rooms.get(s.data.room);
const scores = (r) => io.to(r.code).emit("scores", [...r.players.values()].map((q) => ({ id: q.id, score: q.score, combo: q.combo || 0, max: q.max || 0 })));

function makeRoom(quick) {
  const r = { code: newCode(), host: null, state: "lobby", n: 12, mode: 1, gmode: "normal", events: [], force: false, quick, players: new Map(), timer: null, endAt: 0 };
  rooms.set(r.code, r);
  return r;
}
function join(s, r, nick) {
  r.players.set(s.id, { id: s.id, nick: String(nick || "").trim().slice(0, 10) || "플레이어" + (100 + Math.floor(Math.random() * 900)), ready: false, st: "lobby", score: 0, board: null });
  s.join(r.code);
  s.data.room = r.code;
  if (!r.host) r.host = s.id;
  send(r);
}
function leave(s) {
  const r = me(s);
  if (!r) return;
  r.players.delete(s.id);
  s.leave(r.code);
  s.data.room = null;
  if (!r.players.size) { clearTimeout(r.timer); rooms.delete(r.code); return; }
  if (r.host === s.id) r.host = r.players.keys().next().value;
  if (r.state === "countdown" && ![...r.players.values()].some((p) => p.st === "playing")) { clearTimeout(r.timer); r.state = "lobby"; }
  if (r.state === "playing" && ![...r.players.values()].some((p) => p.st === "playing")) { end(r); return; }
  if (r.state === "playing") resched(r);
  send(r);
}
function resched(r) {
  const ps = [...r.players.values()].filter((p) => p.st === "playing");
  if (!ps.length) return;
  r.endAt = Math.max(...ps.map((p) => p.endAt || 0));
  clearTimeout(r.timer);
  r.timer = setTimeout(() => end(r), Math.max(0, r.endAt - Date.now()));
}
function end(r) {
  if (r.state !== "playing") return;
  clearTimeout(r.timer);
  r.state = "lobby";
  const ps = [...r.players.values()].filter((p) => p.st === "playing");
  const ranking = ps.map((p) => ({ id: p.id, nick: p.nick, score: p.score, combo: p.max || 0 })).sort(r.gmode === "combo" ? (a, b) => b.combo - a.combo || b.score - a.score : (a, b) => b.score - a.score);
  ps.forEach((p) => { p.ready = false; p.st = "result"; io.to(p.id).emit("end", ranking); });
  send(r);
}

io.on("connection", (s) => {
  s.on("createRoom", ({ nick } = {}, cb = () => {}) => {
    leave(s);
    const r = makeRoom(false);
    join(s, r, nick);
    cb({ ok: true, code: r.code });
  });
  s.on("joinRoom", ({ code, nick } = {}, cb = () => {}) => {
    const r = rooms.get(String(code || "").toUpperCase());
    if (!r) return cb({ ok: false, msg: "존재하지 않는 방 코드입니다." });
    if (r.players.size >= MAX) return cb({ ok: false, msg: "방이 가득 찼습니다." });
    leave(s);
    join(s, r, nick);
    cb({ ok: true, code: r.code });
  });
  s.on("quickMatch", ({ nick } = {}, cb = () => {}) => {
    leave(s);
    let r = [...rooms.values()].find((x) => x.quick && x.state === "lobby" && x.players.size < MAX);
    if (!r) r = makeRoom(true);
    join(s, r, nick);
    cb({ ok: true, code: r.code });
  });
  s.on("nick", (nick, cb) => {
    const done = typeof cb === "function" ? cb : () => {};
    const r = me(s), p = r && r.players.get(s.id);
    if (!p) return done({ ok: false });
    if (p.st === "playing") return done({ ok: false, msg: "게임 중에는 변경할 수 없어요." });
    if (p.ready) return done({ ok: false, msg: "준비 완료 상태에서는 변경할 수 없어요." });
    const v = String(nick || "").trim().slice(0, 10);
    if (!v) return done({ ok: false, msg: "닉네임을 입력해 주세요." });
    p.nick = v;
    send(r);
    done({ ok: true });
  });
  s.on("ready", (v) => {
    const r = me(s), p = r && r.players.get(s.id);
    if (p && p.st === "lobby") { p.ready = !!v; send(r); }
  });
  s.on("settings", ({ force, mode, gmode } = {}) => {
    const r = me(s);
    if (!r || r.host !== s.id || r.state !== "lobby") return;
    if (mode === 1 || mode === 2) r.mode = mode;
    if (["normal", "survival", "combo"].includes(gmode)) r.gmode = gmode;
    r.force = !!force;
    send(r);
  });
  s.on("kick", (id) => {
    const r = me(s);
    if (!r || r.host !== s.id || id === s.id) return;
    const t = io.sockets.sockets.get(id);
    if (t && t.data.room === r.code) { t.emit("kicked"); leave(t); }
  });
  s.on("start", () => {
    const r = me(s);
    if (!r || r.host !== s.id || r.state !== "lobby") return;
    const hp = r.players.get(s.id);
    if (!hp || hp.st !== "lobby") return;
    // 대기실에 있는 사람만 참가 (결과 확인 중인 사람은 제외)
    const ps = [...r.players.values()].filter((p) => p.st === "lobby");
    if (!r.force && ps.some((p) => p.id !== r.host && !p.ready)) return;
    r.state = "countdown";
    ps.forEach((p) => { p.score = 0; p.st = "playing"; });
    const seed = rnd();
    send(r);
    const cd = (n) => {
      if (r.state !== "countdown") return;
      const cur = [...r.players.values()].filter((p) => p.st === "playing");
      if (n > 0) {
        cur.forEach((p) => io.to(p.id).emit("countdown", { n }));
        r.timer = setTimeout(() => cd(n - 1), 1000);
        return;
      }
      r.state = "playing";
      r.endAt = Date.now() + DUR * 1000;
      // 서바이벌: 시작 후 30·60·90초(남은 시간 90·60·30초)에 이벤트 1개씩. 모두 같은 이벤트를 받음
      r.events = r.gmode === "survival" ? [30000, 60000, 90000].map((at) => { const ty = SURV[Math.floor(Math.random() * SURV.length)]; return { at, t: ty, d: ty === "night" ? 5000 : 3000 + Math.floor(Math.random() * 2001) }; }) : [];
      cur.forEach((p) => { p.board = G.makeBoard(seed, r.n); p.endAt = r.endAt; p.combo = 0; p.max = 0; });
      send(r);
      cur.forEach((p) => io.to(p.id).emit("start", { seed, n: r.n, mode: r.mode, ms: DUR * 1000, events: r.events }));
      r.timer = setTimeout(() => end(r), DUR * 1000);
    };
    cd(CD);
  });
  s.on("click", ({ y, x } = {}) => {
    const r = me(s), p = r && r.players.get(s.id);
    if (!p || r.state !== "playing" || p.st !== "playing" || Date.now() > p.endAt + 300) return;
    if (!Number.isInteger(y) || !Number.isInteger(x) || y < 0 || y >= G.H || x < 0 || x >= G.W) return;
    const rem = G.applyClick(p.board, y, x);
    if (rem === null) return;
    if (rem.length) { p.combo = (p.combo || 0) + 1; p.max = Math.max(p.max || 0, p.combo); } else p.combo = 0;
    p.score = rem.length ? p.score + rem.length : Math.max(0, p.score - 1);
    scores(r);
  });
  s.on("reshuffle", () => {
    const r = me(s), p = r && r.players.get(s.id);
    if (!p || r.state !== "playing" || p.st !== "playing") return;
    if (Date.now() > p.endAt) return; // 내 시간이 끝났으면 판갈기 불가
    const seed = rnd();
    p.board = G.makeBoard(seed, r.n);
    p.score = 0;
    p.combo = 0;
    p.max = 0;
    p.endAt = Date.now() + DUR * 1000; // 시간도 초기화
    resched(r);
    s.emit("board", { seed, ms: DUR * 1000, events: r.events });
    scores(r);
  });
  s.on("cheat", () => {
    if (!TEST) return;
    const r = me(s), p = r && r.players.get(s.id);
    if (!p || r.state !== "playing" || p.st !== "playing" || Date.now() > p.endAt + 300) return;
    p.score = 200;
    scores(r);
  });
  s.on("back", () => {
    const r = me(s), p = r && r.players.get(s.id);
    if (p && p.st === "result") { p.st = "lobby"; p.ready = false; send(r); }
  });
  s.on("leave", () => leave(s));
  s.on("disconnect", () => leave(s));
});

const PORT = process.env.PORT || 3000;
srv.listen(PORT, () => { console.log("http://localhost:" + PORT); if (TEST) console.log("!! TEST_MODE 켜짐: 치트 허용 중"); });
