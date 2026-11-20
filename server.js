const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const G = require("./public/game.js");

const app = express();
const srv = http.createServer(app);
const io = new Server(srv);
app.use(express.static(__dirname + "/public"));

const rooms = new Map();
const DUR = 120, MAX = 8;
const rnd = () => Math.floor(Math.random() * 2 ** 31);
const newCode = () => {
  let c;
  do c = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms.has(c));
  return c;
};
const pub = (r) => ({
  code: r.code, host: r.host, state: r.state, n: r.n, force: r.force,
  players: [...r.players.values()].map((p) => ({ id: p.id, nick: p.nick, ready: p.ready, score: p.score })),
});
const send = (r) => io.to(r.code).emit("room", pub(r));
const me = (s) => rooms.get(s.data.room);
const scores = (r) => io.to(r.code).emit("scores", [...r.players.values()].map((q) => ({ id: q.id, score: q.score })));

function makeRoom(quick) {
  const r = { code: newCode(), host: null, state: "lobby", n: 10, force: false, quick, players: new Map(), timer: null, endAt: 0 };
  rooms.set(r.code, r);
  return r;
}
function join(s, r, nick) {
  r.players.set(s.id, { id: s.id, nick: String(nick || "").trim().slice(0, 10) || "플레이어" + (100 + Math.floor(Math.random() * 900)), ready: false, score: 0, board: null });
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
  send(r);
}
function end(r) {
  if (r.state !== "playing") return;
  r.state = "lobby";
  const ranking = [...r.players.values()].map((p) => ({ id: p.id, nick: p.nick, score: p.score })).sort((a, b) => b.score - a.score);
  r.players.forEach((p) => { p.ready = false; });
  io.to(r.code).emit("end", ranking);
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
    if (r.state !== "lobby") return cb({ ok: false, msg: "게임이 진행 중입니다." });
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
    if (r.state !== "lobby" || p.ready) return done({ ok: false, msg: "준비 완료 상태에서는 변경할 수 없어요." });
    const v = String(nick || "").trim().slice(0, 10);
    if (!v) return done({ ok: false, msg: "닉네임을 입력해 주세요." });
    p.nick = v;
    send(r);
    done({ ok: true });
  });
  s.on("ready", (v) => {
    const r = me(s), p = r && r.players.get(s.id);
    if (p && r.state === "lobby") { p.ready = !!v; send(r); }
  });
  s.on("settings", ({ n, force } = {}) => {
    const r = me(s);
    if (!r || r.host !== s.id || r.state !== "lobby") return;
    if (n >= 6 && n <= 12) r.n = n | 0;
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
    const ps = [...r.players.values()];
    if (!r.force && ps.some((p) => p.id !== r.host && !p.ready)) return;
    r.state = "playing";
    r.endAt = Date.now() + DUR * 1000;
    const seed = rnd();
    ps.forEach((p) => { p.score = 0; p.board = G.makeBoard(seed, r.n); });
    io.to(r.code).emit("start", { seed, n: r.n, ms: DUR * 1000 });
    send(r);
    r.timer = setTimeout(() => end(r), DUR * 1000);
  });
  s.on("click", ({ y, x } = {}) => {
    const r = me(s), p = r && r.players.get(s.id);
    if (!p || r.state !== "playing" || Date.now() > r.endAt + 300) return;
    if (!Number.isInteger(y) || !Number.isInteger(x) || y < 0 || y >= G.H || x < 0 || x >= G.W) return;
    const rem = G.applyClick(p.board, y, x);
    if (rem === null) return;
    p.score = rem.length ? p.score + rem.length : Math.max(0, p.score - 1);
    scores(r);
  });
  s.on("reshuffle", () => {
    const r = me(s), p = r && r.players.get(s.id);
    if (!p || r.state !== "playing") return;
    const seed = rnd();
    p.board = G.makeBoard(seed, r.n);
    p.score = 0;
    s.emit("board", { seed });
    scores(r);
  });
  s.on("leave", () => leave(s));
  s.on("disconnect", () => leave(s));
});

const PORT = process.env.PORT || 3000;
srv.listen(PORT, () => console.log("http://localhost:" + PORT));
