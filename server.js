const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ==============================
// STATIC DOSYALAR (HTML, PNG, JS)
// ==============================
app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ==============================
// OYUN DURUMU
// ==============================
let players = {};
let arrows = [];
let buildings = [];
let goldMines = [];

// ==============================
// OYUN BAŞLANGIÇ
// ==============================
function createWorld() {
    goldMines = [];
    for (let i = 0; i < 10; i++) {
        goldMines.push({
            x: Math.random() * 3000,
            y: Math.random() * 3000
        });
    }
    console.log("[SİSTEM] Dünya oluşturuldu");
}

createWorld();

// ==============================
// SOCKET BAĞLANTI
// ==============================
io.on("connection", (socket) => {
    console.log("Oyuncu bağlandı:", socket.id);

    // oyuncu oluştur
    players[socket.id] = {
        id: socket.id,
        x: Math.random() * 1000,
        y: Math.random() * 1000,
        name: "Oyuncu",
        gold: 500,
        army: [],
        clan: ""
    };

    socket.emit("init", {
        id: socket.id,
        players,
        goldMines
    });

    // hareket
    socket.on("move", (data) => {
        const p = players[socket.id];
        if (!p) return;
        p.x = data.x;
        p.y = data.y;
    });

    // isim + klan
    socket.on("setName", (data) => {
        if (!players[socket.id]) return;
        players[socket.id].name = data.name;
        players[socket.id].clan = data.clan;
    });

    // OK FIRLATMA ⚔️
    socket.on("shootArrow", (data) => {
        arrows.push({
            x: data.x,
            y: data.y,
            angle: data.angle,
            speed: 10,
            owner: socket.id
        });
    });

    // disconnect
    socket.on("disconnect", () => {
        delete players[socket.id];
        console.log("Oyuncu çıktı:", socket.id);
    });
});

// ==============================
// GAME LOOP
// ==============================
setInterval(() => {

    // ok hareketi
    arrows.forEach((arrow) => {
        arrow.x += Math.cos(arrow.angle) * arrow.speed;
        arrow.y += Math.sin(arrow.angle) * arrow.speed;
    });

    // tüm clientlara gönder
    io.emit("update", {
        players,
        arrows,
        goldMines
    });

}, 1000 / 30); // 30 FPS

// ==============================
// SERVER BAŞLAT
// ==============================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("[BAŞARILI] 6D.IO aktif. Port:", PORT);
});